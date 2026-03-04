import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { systemPrompt, getUserPrompt, getBatchedUserPrompt, getPlanningPrompt } from "../prompts/reviewPrompts";
import { env } from "../config/envVariables";
import { AIProvider, PROVIDER_MAPPING } from "../types/providers";

/**
 * AI Review Comment Interface
 */
export interface AIReviewComment {
    filePath?: string;
    startLine: number;
    endLine: number;
    severity: string;
    comment: string;
}

/**
 * Performs a code review using the configured AI provider.
 * Includes retry logic for rate limits.
 */
export async function reviewWithAI(
    fileName: string,
    content: string,
    customGuidelines?: string,
    codeMap?: string,
    contextFiles?: { fileName: string; content: string }[],
    attempt: number = 1
): Promise<AIReviewComment[]> {
    try {
        let rawResponse: string | null = null;
        const envProvider = env.AI_PROVIDER.toLowerCase();
        const provider = PROVIDER_MAPPING[envProvider];
        const prompt = getUserPrompt(fileName, content, customGuidelines, codeMap, contextFiles);

        if (provider === AIProvider.OPENAI) {
            rawResponse = await callOpenAI(prompt);
        } else if (provider === AIProvider.ANTHROPIC) {
            rawResponse = await callClaude(prompt);
        } else if (provider === AIProvider.GOOGLE) {
            rawResponse = await callGemini(prompt);
        } else {
            throw new Error(`Unsupported AI provider: ${envProvider}`);
        }

        if (!rawResponse) return [];

        try {
            // Some models might wrap JSON in triple backticks
            const cleanedJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleanedJson);
            return parsed.reviews || [];
        } catch (parseErr) {
            console.error(`Failed to parse ${provider} JSON response`, parseErr);
            console.debug("Raw content:", rawResponse);
            return [];
        }

    } catch (err: any) {
        // Handle rate limits (429) for different providers
        const isRateLimit = err.status === 429 || err.statusCode === 429 || (err.message && err.message.includes("429"));

        if (isRateLimit && attempt <= 3) {
            const jitter = Math.floor(Math.random() * 1000);
            const waitTime = (attempt * 2000) + jitter;
            console.log(`Rate limit hit for ${fileName}. Retrying in ${waitTime}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return reviewWithAI(fileName, content, customGuidelines, codeMap, contextFiles, attempt + 1);
        }
        throw err;
    }
}


/**
 * Performs a batched code review of multiple files using the configured AI provider.
 * Includes retry logic for rate limits.
 */
export async function reviewBatchWithAI(
    files: { fileName: string; content: string }[],
    customGuidelines?: string,
    codeMap?: string,
    contextFiles?: { fileName: string; content: string }[],
    attempt: number = 1
): Promise<AIReviewComment[]> {
    try {
        let rawResponse: string | null = null;
        const envProvider = env.AI_PROVIDER.toLowerCase();
        const provider = PROVIDER_MAPPING[envProvider];
        const prompt = getBatchedUserPrompt(files, customGuidelines, codeMap, contextFiles);

        if (provider === AIProvider.OPENAI) {
            rawResponse = await callOpenAI(prompt);
        } else if (provider === AIProvider.ANTHROPIC) {
            rawResponse = await callClaude(prompt);
        } else if (provider === AIProvider.GOOGLE) {
            rawResponse = await callGemini(prompt);
        } else {
            throw new Error(`Unsupported AI provider: ${envProvider}`);
        }

        if (!rawResponse) return [];

        try {
            const cleanedJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleanedJson);
            return parsed.reviews || [];
        } catch (parseErr) {
            console.error(`Failed to parse ${provider} batch JSON response`, parseErr);
            console.debug("Raw content:", rawResponse);
            return [];
        }

    } catch (err: any) {
        const isRateLimit = err.status === 429 || err.statusCode === 429 || (err.message && err.message.includes("429"));

        if (isRateLimit && attempt <= 3) {
            const jitter = Math.floor(Math.random() * 1000);
            const waitTime = (attempt * 2000) + jitter;
            console.log(`Rate limit hit for batch review. Retrying in ${waitTime}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return reviewBatchWithAI(files, customGuidelines, codeMap, contextFiles, attempt + 1);
        }
        throw err;
    }
}

/**
 * Agentic Context Planning
 * Asks the AI what files it needs to read to understand the PR context.
 */
export async function planReviewContext(
    files: { fileName: string; content: string }[],
    codeMap: string,
    attempt: number = 1
): Promise<string[]> {
    try {
        let rawResponse: string | null = null;
        const envProvider = env.AI_PROVIDER.toLowerCase();
        const provider = PROVIDER_MAPPING[envProvider];
        const prompt = getPlanningPrompt(files, codeMap);

        if (provider === AIProvider.OPENAI) {
            rawResponse = await callOpenAI(prompt);
        } else if (provider === AIProvider.ANTHROPIC) {
            rawResponse = await callClaude(prompt);
        } else if (provider === AIProvider.GOOGLE) {
            rawResponse = await callGemini(prompt);
        } else {
            throw new Error(`Unsupported AI provider: ${envProvider}`);
        }

        if (!rawResponse) return [];

        try {
            const cleanedJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleanedJson);

            if (parsed.requestedFiles && Array.isArray(parsed.requestedFiles)) {
                return parsed.requestedFiles.filter((f: any) => typeof f === 'string');
            }
            return [];
        } catch (parseErr) {
            console.error(`Failed to parse ${provider} planning JSON response`, parseErr);
            console.debug("Raw content:", rawResponse);
            return [];
        }

    } catch (err: any) {
        const isRateLimit = err.status === 429 || err.statusCode === 429 || (err.message && err.message.includes("429"));

        if (isRateLimit && attempt <= 3) {
            const jitter = Math.floor(Math.random() * 1000);
            const waitTime = (attempt * 2000) + jitter;
            console.log(`Rate limit hit for context planning. Retrying in ${waitTime}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return planReviewContext(files, codeMap, attempt + 1);
        }

        console.error("Agentic planning failed, falling back to codemap only", err.message);
        return []; // Fall back to empty requested files
    }
}

// --- Generic provider call functions (used by batch review) ---

async function callOpenAI(prompt: string): Promise<string | null> {
    const openai = new OpenAI({ apiKey: env.AI_API_KEY });
    const completion = await openai.chat.completions.create({
        model: env.AI_MODEL,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
    });
    return completion.choices[0].message.content;
}

async function callClaude(prompt: string): Promise<string | null> {
    const anthropic = new Anthropic({ apiKey: env.AI_API_KEY });
    const response = await anthropic.messages.create({
        model: env.AI_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
            { role: "user", content: prompt }
        ]
    });

    return response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('\n');
}

async function callGemini(prompt: string): Promise<string | null> {
    const genAI = new GoogleGenerativeAI(env.AI_API_KEY!);
    const model = genAI.getGenerativeModel({
        model: env.AI_MODEL,
        systemInstruction: systemPrompt
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
}
