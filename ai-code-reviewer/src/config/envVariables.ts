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
    REVIEWER_NAME: process.env.REVIEWER_NAME,
    AI_REVIEW_GUIDELINES: process.env.AI_REVIEW_GUIDELINES,
};

// Validate critical environment variables
const missingVars = [];
if (!env.AZDO_ORG_URL) missingVars.push("AZDO_ORG_URL");
if (!env.AZDO_PAT) missingVars.push("AZDO_PAT");
if (!env.AI_API_KEY) missingVars.push("AI_API_KEY");

if (missingVars.length > 0) {
    console.warn(`[CONFIG] Missing critical environment variables: ${missingVars.join(", ")}`);
}
