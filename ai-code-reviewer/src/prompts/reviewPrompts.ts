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
 * @param codeMap - Optional structural map of the repository
 * @param contextFiles - Optional read-only context files (for agentic mode)
 */
export function getUserPrompt(
  fileName: string,
  content: string,
  customGuidelines?: string,
  codeMap?: string,
  contextFiles?: { fileName: string; content: string }[]
): string {
  const guidelinesSection = customGuidelines
    ? `### SECTION 1: HOW TO DO THE REVIEW (CUSTOM GUIDELINES — STRICTLY FOLLOW)
⚠️ **The following are project-specific custom guidelines provided by the repository owner.**
**You MUST strictly adhere to these guidelines. They are the primary source of truth for this review.**
**Do NOT add your own review criteria beyond what is specified here. Only review based on these guidelines.**

${customGuidelines}`
    : `### SECTION 1: HOW TO DO THE REVIEW
${defaultReviewGuidelines}`;

  const codeMapSection = codeMap
    ? `### REPOSITORY STRUCTURE (Read-Only Reference)
Use this to understand the broader codebase architecture. Do NOT review these files — only use them as context.

\`\`\`
${codeMap}
\`\`\`

`
    : '';

  const contextSection = contextFiles && contextFiles.length > 0
    ? `### ADDITIONAL CONTEXT FILES (Read-Only — Do NOT review these)
These files were requested for additional context. Use them to understand the codebase but do NOT generate review comments for them.

${contextFiles.map(f => `#### CONTEXT: ${f.fileName}
\`\`\`
${f.content}
\`\`\``).join('\n\n')}

`
    : '';

  return `
You are a Software Tech Lead performing a pull request review.
Review the following file: **${fileName}**

### IMPORTANT INSTRUCTIONS
- If you have too many comments, pick the top 10 most important ones ONLY.
${customGuidelines ? '- **Custom guidelines are provided below. You MUST strictly follow them and ONLY review based on those guidelines.**' : ''}

${guidelinesSection}

${codeMapSection}${contextSection}### SECTION 2: HOW TO RETURN THE REVIEWED DATA
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

/**
 * Batched user prompt template - reviews multiple files in a single prompt
 * @param files - Array of files with their names and content
 * @param customGuidelines - Optional project-specific guidelines
 * @param codeMap - Optional structural map of the repository
 * @param contextFiles - Optional read-only context files (for agentic mode)
 */
export function getBatchedUserPrompt(
  files: { fileName: string; content: string }[],
  customGuidelines?: string,
  codeMap?: string,
  contextFiles?: { fileName: string; content: string }[]
): string {
  const guidelinesSection = customGuidelines
    ? `### SECTION 1: HOW TO DO THE REVIEW (CUSTOM GUIDELINES — STRICTLY FOLLOW)
⚠️ **The following are project-specific custom guidelines provided by the repository owner.**
**You MUST strictly adhere to these guidelines. They are the primary source of truth for this review.**
**Do NOT add your own review criteria beyond what is specified here. Only review based on these guidelines.**

${customGuidelines}`
    : `### SECTION 1: HOW TO DO THE REVIEW
${defaultReviewGuidelines}`;

  const filesSectionParts = files.map(f => `### FILE: ${f.fileName}
\`\`\`
${f.content}
\`\`\``);

  const codeMapSection = codeMap
    ? `### REPOSITORY STRUCTURE (Read-Only Reference)
Use this to understand the broader codebase architecture. Do NOT review these files — only use them as context.

\`\`\`
${codeMap}
\`\`\`

`
    : '';

  const contextSection = contextFiles && contextFiles.length > 0
    ? `### ADDITIONAL CONTEXT FILES (Read-Only — Do NOT review these)
These files were requested for additional context. Use them to understand the codebase but do NOT generate review comments for them.

${contextFiles.map(f => `#### CONTEXT: ${f.fileName}
\`\`\`
${f.content}
\`\`\``).join('\n\n')}

`
    : '';

  return `
You are a Software Tech Lead performing a pull request review.
Review the following ${files.length} files from a Pull Request:

### IMPORTANT INSTRUCTIONS
- Review ALL files in this PR together, considering cross-file relationships.
- If you have too many comments, pick the top 10 most important ones ONLY.
- Each comment MUST include the filePath of the file it refers to.
${customGuidelines ? '- **Custom guidelines are provided below. You MUST strictly follow them and ONLY review based on those guidelines.**' : ''}

${guidelinesSection}

${codeMapSection}${contextSection}### SECTION 2: HOW TO RETURN THE REVIEWED DATA
Provide your review in valid JSON format.
The output should be a JSON object with a single key "reviews" which is an array of objects.

Each object should have:
- "filePath": The path of the file the comment refers to.
- "startLine": The start line number where the issue is located (1-based integer).
- "endLine": The end line number where the issue is located (1-based integer).
- "severity": One of "critical", "major", "minor".
- "comment": The review comment (include the appropriate severity icon).

Before returning the comments double check each line number against
each comment to ensure it's right. If not then find the right start and end lines and update
the line numbers.

If all the files look good, return an empty array: { "reviews": [] }

### SECTION 3: FILES TO REVIEW

${filesSectionParts.join('\n\n')}
`;
}

/**
 * Agentic planning prompt - asks the AI what files it needs to read for context
 * @param files - Array of changed PR files
 * @param codeMap - Structural map of the repository
 */
export function getPlanningPrompt(
  files: { fileName: string; content: string }[],
  codeMap: string
): string {
  const filesSectionParts = files.map(f => `### FILE: ${f.fileName}
\`\`\`
${f.content}
\`\`\``);

  return `
You are a Software Tech Lead preparing to review a Pull Request.
Before you write any review comments, you need to understand the context.

You have access to the following ${files.length} files that were changed in this PR:
${files.map(f => `- ${f.fileName}`).join('\n')}

You also have a structural map of the entire repository:
### REPOSITORY STRUCTURE
\`\`\`
${codeMap}
\`\`\`

### FILES IN PULL REQUEST
${filesSectionParts.join('\n\n')}

### YOUR TASK
Based on the code changed in the PR and the repository structure, determine if you need to read the full source code of any other files in the repository to properly review this PR.

For example, if a PR modifies a function call to a database service, but the implementation of the database service is NOT in the PR, you should request to read the database service file so you know what it does.

Provide your output in valid JSON format.
The output MUST be a JSON object with a single key "requestedFiles" which is an array of strings (the exact file paths from the repository structure).

If you do NOT need any additional files (the PR is self-contained or simple enough), return an empty array: { "requestedFiles": [] }
Limit your request to a maximum of 5 files to avoid overwhelming the context window.
`;
}
