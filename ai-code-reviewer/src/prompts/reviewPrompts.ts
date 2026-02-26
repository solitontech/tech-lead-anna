/**
 * AI Review Prompts Configuration
 * 
 * This file contains the prompts used for AI-powered code reviews.
 * Modify these prompts to customize the review behavior and focus areas.
 */

import { env } from "../config/envVariables";

/**
 * System prompt - defines the AI's role and persona
 */
export const systemPrompt = `You are a Software Tech Lead performing a pull request review.`;

/**
 * Default guidelines for the AI review process.
 */
const defaultReviewGuidelines = `
- Only comment on specific things that need to be changed or improved. 
- Do not include the original source code in your feedback.
- For anything that is important & needs to be fixed, be firm in your tone, not suggestive
- For anything that is critical or a red flag, use the 🔴 icon.
- For major issues that need fixing, use the 🟡 icon.
- For minor improvements or suggestions, use the 🟢 icon.
- Discard anything that is minor/suggestion 🟢
- Focus on architecture, and just decent coding standards (but no need for perfection)
`;

/**
 * User prompt template - defines what the AI should review for a specific file
 * @param fileName - The name/path of the file being reviewed
 * @param content - The content of the file
 * @param customGuidelines - Optional project-specific guidelines
 */
export function getUserPrompt(fileName: string, content: string, customGuidelines?: string): string {
  const guidelinesSection = customGuidelines
    ? `### SECTION 1: HOW TO DO THE REVIEW (CUSTOM GUIDELINES — STRICTLY FOLLOW)
⚠️ **The following are project-specific custom guidelines provided by the repository owner.**
**You MUST strictly adhere to these guidelines. They are the primary source of truth for this review.**
**Do NOT add your own review criteria beyond what is specified here. Only review based on these guidelines.**

${customGuidelines}`
    : `### SECTION 1: HOW TO DO THE REVIEW
${defaultReviewGuidelines}`;

  return `
You are a Software Tech Lead performing a pull request review.
Review the following file: **${fileName}**

### IMPORTANT INSTRUCTIONS
- If you have too many comments, pick the top 10 most important ones ONLY.
${customGuidelines ? '- **Custom guidelines are provided below. You MUST strictly follow them and ONLY review based on those guidelines.**' : ''}

${guidelinesSection}

### SECTION 2: HOW TO RETURN THE REVIEWED DATA
Provide your review in valid JSON format.
The output should be a JSON object with a single key "reviews" which is an array of objects.

Each object should have:
- "startLine": The start line number where the issue is located (1-based integer).
- "endLine": The end line number where the issue is located (1-based integer).
- "severity": One of "critical", "major", "minor".
- "comment": The review comment (include the appropriate severity icon).

Before returning the comments double check each line number against
each comment to ensure it's right. If not then find the right start and end lines and update
the line numbers.

If the file looks good, return an empty array: { "reviews": [] }

FILE CONTENT FOR ${fileName}:
\`\`\`
${content}
\`\`\`
`;
}
