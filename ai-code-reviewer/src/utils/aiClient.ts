import OpenAI from "openai";
import { systemPrompt, getUserPrompt } from "../prompts/reviewPrompts";
import { env } from "../config/envVariables";

/**
 * AI Review Comment Interface
 */
export interface AIReviewComment {
    line: number;
    severity: string;
    comment: string;
}

const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY
});

/**
 * Performs a code review using OpenAI's model.
 * Includes retry logic for rate limits.
 */
export async function reviewWithAI(fileName: string, content: string, attempt: number = 1): Promise<AIReviewComment[]> {
    try {
        const completion = await openai.chat.completions.create({
            model: env.OPENAI_MODEL,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: getUserPrompt(fileName, content)
                }
            ],
            response_format: { type: "json_object" }
        });

        const rawContent = completion.choices[0].message.content;
        if (!rawContent) return [];

        try {
            const parsed = JSON.parse(rawContent);
            return parsed.reviews || [];
        } catch (parseErr) {
            console.error("Failed to parse AI JSON response", parseErr);
            return [];
        }

    } catch (err: any) {
        // If Rate Limit (429) and we haven't tried too many times
        if (err.status === 429 && attempt <= 3) {
            const jitter = Math.floor(Math.random() * 1000); // Up to 1s jitter
            const waitTime = (attempt * 2000) + jitter; // 2s + jitter, 4s + jitter...
            console.log(`Rate limit hit for ${fileName}. Retrying in ${waitTime}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return reviewWithAI(fileName, content, attempt + 1);
        }
        throw err;
    }
}
