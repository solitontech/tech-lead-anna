/**
 * Utility to clean code content by removing specific blocks like Swagger/OpenAPI documentation
 * or large comment blocks to determine the "true" size of the file (logic-only).
 * 
 * @param content The raw file content
 * @param path The file path to determine language-specific cleaning if needed
 */
export function cleanCodeContent(content: string, path: string): string {
    let cleaned = content;
    const lowerPath = path.toLowerCase();

    // 1. Remove /* ... */ blocks (Common in JS, TS, C#, C++, etc.)
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

    // 2. Remove """ ... """ blocks for Python files
    if (lowerPath.endsWith('.py')) {
        cleaned = cleaned.replace(/"""[\s\S]*?"""/g, '');
        cleaned = cleaned.replace(/'''[\s\S]*?'''/g, '');
    }

    // 3. Trim trailing spaces and reduce multiple newlines to calculate logic density
    cleaned = cleaned.replace(/[ \t]+$/gm, '');
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

    return cleaned.trim();
}
