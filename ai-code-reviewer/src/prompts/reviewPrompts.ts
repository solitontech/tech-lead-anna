/**
 * AI Review Prompts Configuration
 * 
 * This file contains the prompts used for AI-powered code reviews.
 * Modify these prompts to customize the review behavior and focus areas.
 */

/**
 * System prompt - defines the AI's role and persona
 */
export const systemPrompt = "You are Tech Lead Anna, a Software Architect performing a pull request review.";

/**
 * User prompt template - defines what the AI should review and how
 * @param diff - The code changes to review
 */
export function getUserPrompt(diff: string): string {
    return `
You are Tech Lead Anna, a Software Architect performing a pull request review.
Review the following pull request.
1. Ensure good architectural standards
2. Ensure best practices
3. Ensure code quality
4. Ensure security
5. Ensure maintainability

${diff}
`;
}
