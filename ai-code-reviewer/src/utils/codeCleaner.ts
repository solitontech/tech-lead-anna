/**
 * Utility to clean code content by removing specific blocks like Swagger/OpenAPI documentation
 * or large comment blocks that might clutter the AI review.
 */

/**
 * Removes multi-line comment blocks:
 * 1. /* ... *\/ (Common in TS, C#, C++, Java)
 * 2. """ ... """ (Common in Python docstrings/Swagger)
 * 
 * @param content The raw file content
 * @param path The file path to determine language-specific cleaning if needed
 */
export function cleanCodeContent(content: string, path: string): string {
    let cleaned = content;
    const lowerPath = path.toLowerCase();

    // 1. Remove /* ... */ blocks (Common in JS, TS, C#, C++, etc.)
    // This is often where Swagger/OAS annotations live in these languages
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

    // 2. Remove """ ... """ blocks for Python files
    // Python Swagger libraries often use triple quotes for documentation
    if (lowerPath.endsWith('.py')) {
        cleaned = cleaned.replace(/"""[\s\S]*?"""/g, '');
        // Also catch single-quote triple blocks just in case
        cleaned = cleaned.replace(/'''[\s\S]*?'''/g, '');
    }

    // Optional: Trim trailing spaces and multiple newlines caused by removal
    cleaned = cleaned.replace(/[ \t]+$/gm, '');
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

    return cleaned.trim();
}
