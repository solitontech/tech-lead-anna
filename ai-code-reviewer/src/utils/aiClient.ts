import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { systemPrompt, getUserPrompt } from "../prompts/reviewPrompts";
import { env } from "../config/envVariables";
import { AIProvider, PROVIDER_MAPPING } from "../types/providers";

/**
 * AI Review Comment Interface
 */
export interface AIReviewComment {
    line: number;
    severity: string;
    comment: string;
}

/**
 * Performs a code review using the configured AI provider.
 * Includes retry logic for rate limits.
 */
export async function reviewWithAI(fileName: string, content: string, customGuidelines?: string, attempt: number = 1): Promise<AIReviewComment[]> {
    try {
        let rawResponse: string | null = null;
        const envProvider = env.AI_PROVIDER.toLowerCase();
        const provider = PROVIDER_MAPPING[envProvider];

        if (provider === AIProvider.OPENAI) {
            rawResponse = await reviewWithOpenAI(fileName, content, customGuidelines);
        } else if (provider === AIProvider.ANTHROPIC) {
            rawResponse = await reviewWithClaude(fileName, content, customGuidelines);
        } else if (provider === AIProvider.GOOGLE) {
            rawResponse = await reviewWithGemini(fileName, content, customGuidelines);
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
            return reviewWithAI(fileName, content, customGuidelines, attempt + 1);
        }
        throw err;
    }
}

async function reviewWithOpenAI(fileName: string, content: string, customGuidelines?: string): Promise<string | null> {
    const openai = new OpenAI({ apiKey: env.AI_API_KEY });
    const completion = await openai.chat.completions.create({
        model: env.AI_MODEL,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: getUserPrompt(fileName, content, customGuidelines) }
        ],
        response_format: { type: "json_object" }
    });
    return completion.choices[0].message.content;
}

async function reviewWithClaude(fileName: string, content: string, customGuidelines?: string): Promise<string | null> {
    const anthropic = new Anthropic({ apiKey: env.AI_API_KEY });
    const response = await anthropic.messages.create({
        model: env.AI_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
            { role: "user", content: getUserPrompt(fileName, content, customGuidelines) }
        ]
    });

    // Extract text from content blocks
    return response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('\n');
}

async function reviewWithGemini(fileName: string, content: string, customGuidelines?: string): Promise<string | null> {
    const genAI = new GoogleGenerativeAI(env.AI_API_KEY!);
    const model = genAI.getGenerativeModel({
        model: env.AI_MODEL,
        systemInstruction: systemPrompt
    });

    const result = await model.generateContent(getUserPrompt(fileName, content, customGuidelines));
    const response = await result.response;
    return response.text();
}
