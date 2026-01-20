/**
 * Environment Variables Configuration
 * Centralizes all process.env access and provides typed access to configuration.
 */

export const env = {
    // Azure DevOps Configuration
    AZDO_ORG_URL: process.env.AZDO_ORG_URL,
    AZDO_PAT: process.env.AZDO_PAT,

    // OpenAI Configuration
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,

    // Reviewer Configuration
    REVIEWER_NAME: process.env.REVIEWER_NAME,
};

// Validate critical environment variables
const missingVars = [];
if (!env.AZDO_ORG_URL) missingVars.push("AZDO_ORG_URL");
if (!env.AZDO_PAT) missingVars.push("AZDO_PAT");
if (!env.OPENAI_API_KEY) missingVars.push("OPENAI_API_KEY");

if (missingVars.length > 0) {
    console.warn(`[CONFIG] Missing critical environment variables: ${missingVars.join(", ")}`);
}
