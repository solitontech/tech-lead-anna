/**
 * Result of the code cleaning process.
 */
export interface CleanedCode {
    cleanedContent: string;
    /**
     * Array mapping cleaned line index to original line number (1-based).
     * e.g., lineMap[0] = 5 means the first line of cleaned content was line 5 in the original file.
     */
    lineMap: number[];
}

/**
 * Utility to clean code content by removing specific blocks like Swagger/OpenAPI documentation
 * or large comment blocks that might clutter the AI review, while maintaining a line map.
 * 
 * @param content The raw file content
 * @param path The file path to determine language-specific cleaning if needed
 */
export function cleanCodeContent(content: string, path: string): CleanedCode {
    let mapLines = content.split('\n');
    const lowerPath = path.toLowerCase();

    // 1. Replace multi-line comments with blank lines to preserve line count temporarily
    const preserveLines = (text: string, pattern: RegExp) => {
        return text.replace(pattern, (match) => {
            const linesCount = match.split('\n').length;
            // Return newlines - 1 to keep the count the same (the last newline is usually outside the match or part of the last line)
            // But actually, we want to replace the whole block with the same number of newlines.
            return '\n'.repeat(linesCount - 1);
        });
    };

    let intermediate = content;
    intermediate = preserveLines(intermediate, /\/\*[\s\S]*?\*\//g);
    if (lowerPath.endsWith('.py')) {
        intermediate = preserveLines(intermediate, /"""[\s\S]*?"""/g);
        intermediate = preserveLines(intermediate, /'''[\s\S]*?'''/g);
    }

    // 2. Split and filter to remove empty/unwanted lines while tracking original line numbers
    const lines = intermediate.split('\n');
    const finalLines: string[] = [];
    const lineMap: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i].trimEnd();
        // Skip empty lines to save tokens, but record the original line number for non-empty lines
        if (text.trim() !== '') {
            finalLines.push(text);
            lineMap.push(i + 1);
        }
    }

    return {
        cleanedContent: finalLines.join('\n'),
        lineMap: lineMap
    };
}
