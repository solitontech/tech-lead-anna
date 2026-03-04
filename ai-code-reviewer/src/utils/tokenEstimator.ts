/**
 * Token Estimation Utility
 * 
 * Provides a fast, approximate token count for text content.
 * Used to determine whether batched review is feasible within the token budget.
 * 
 * The estimation uses a ~4 characters per token heuristic, which is a reasonable
 * approximation for English text and code across most LLM tokenizers.
 */

const DEFAULT_MAX_BATCH_TOKENS = 60000;

/**
 * Estimates the number of tokens in a text string.
 * Uses a ~4 characters per token heuristic.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Returns the configured max batch token budget.
 * Falls back to DEFAULT_MAX_BATCH_TOKENS if not set or invalid.
 */
export function getMaxBatchTokens(envValue?: string): number {
    if (envValue) {
        const parsed = parseInt(envValue, 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return DEFAULT_MAX_BATCH_TOKENS;
}
