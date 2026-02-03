/**
 * Supported AI Providers
 */
export enum AIProvider {
    OPENAI = "openai",
    ANTHROPIC = "anthropic",
    GOOGLE = "google"
}

export const PROVIDER_MAPPING: Record<string, AIProvider> = {
    "openai": AIProvider.OPENAI,
    "gpt": AIProvider.OPENAI,
    "chatgpt": AIProvider.OPENAI,
    "anthropic": AIProvider.ANTHROPIC,
    "claude": AIProvider.ANTHROPIC,
    "google": AIProvider.GOOGLE,
    "gemini": AIProvider.GOOGLE
};
