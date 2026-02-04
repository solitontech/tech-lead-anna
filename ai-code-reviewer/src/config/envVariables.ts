/**
 * Environment Variables Configuration
 * Centralizes all process.env access and provides typed access to configuration.
 */

export const env = {
    // Azure DevOps Configuration
    AZDO_ORG_URL: process.env.AZDO_ORG_URL,
    AZDO_PAT: process.env.AZDO_PAT,

    // AI Configuration
    AI_PROVIDER: process.env.AI_PROVIDER.toLowerCase(),
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,

    // Reviewer Configuration
    AZDO_REVIEWER_NAME: process.env.AZDO_REVIEWER_NAME,
    GITHUB_REVIEWER_NAME: process.env.GITHUB_REVIEWER_NAME,
    AI_REVIEW_GUIDELINES: process.env.AI_REVIEW_GUIDELINES,

    // GitHub App Configuration
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

// Validate critical environment variables
const missingVars = [];
if (!env.AI_API_KEY) missingVars.push("AI_API_KEY");

// Platform-specific validation
const hasAzDo = !!(env.AZDO_ORG_URL && env.AZDO_PAT);
const hasGitHub = !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);

if (!hasAzDo && !hasGitHub) {
    missingVars.push("Platform Config (AzDo or GitHub)");
}

if (missingVars.length > 0) {
    console.warn(`[CONFIG] Missing critical environment variables: ${missingVars.join(", ")}`);
}
