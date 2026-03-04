import { shouldIgnoreFile } from "../config/ignoreFiles";

/**
 * Extracts a lightweight structural outline from source code content.
 * Captures classes, interfaces, types, functions, and class methods.
 * Uses fast regex-based extraction instead of full AST parsing to minimize overhead.
 */
export function extractOutline(content: string): string[] {
    const lines = content.split('\n');
    const outline: string[] = [];
    let inClass = false;
    let braceDepth = 0;

    for (const line of lines) {
        const trimmed = line.trim();

        // Count braces to know when we enter/exit blocks
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;

        // Skip comments and empty lines for speed
        if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            braceDepth += openBraces - closeBraces;
            if (inClass && braceDepth <= 0) inClass = false;
            continue;
        }

        // Classes
        if (trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+\w+/)) {
            outline.push(trimmed.replace(/\s*\{.*$/, ''));
            inClass = true;
            braceDepth = 0; // reset for this class
        }
        // Interfaces & Types
        else if (trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:interface|type)\s+\w+/) && !inClass) {
            outline.push(trimmed.replace(/\s*\{|=(?!\s*>).*$/, ''));
        }
        // Functions (top-level)
        else if (trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+/) && !inClass) {
            outline.push(trimmed.replace(/\s*\{.*$/, ''));
        }
        // Arrow functions exported (e.g. export const foo = () =>)
        else if (trimmed.match(/^export\s+(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(.*\)\s*=>/) && !inClass) {
            outline.push(trimmed.replace(/\s*\{.*$/, '').replace(/\s*=>.*$/, ''));
        }
        // Methods (if inside class and depth is exactly 1)
        else if (inClass && braceDepth === 1) {
            // Match methods: public methodName(args): type {
            // Must have parens, and ignore control flow keywords
            if (trimmed.match(/^(?:public|private|protected)?\s*(?:async\s+)?(?:get\s+|set\s+)?\w+\s*\(/)) {
                if (!trimmed.match(/^(?:if|for|while|catch|switch|return)\b/)) {
                    outline.push('  ' + trimmed.replace(/\s*\{.*$/, ''));
                }
            }
        }

        braceDepth += openBraces - closeBraces;
        if (inClass && braceDepth <= 0) {
            inClass = false;
            braceDepth = 0;
        }
    }

    return outline;
}

// In-memory cache for code maps (lives for the duration of the Azure Function invocation)
const codeMapCache = new Map<string, string>();

/**
 * Generates a lightweight structural map of the entire repository.
 * Reads all code files and extracts their outlines.
 * Caches the result per commit to avoid redundant regeneration.
 */
export async function generateCodeMap(
    commitId: string,
    filePaths: string[],
    getContent: (path: string) => Promise<string>
): Promise<string> {
    if (codeMapCache.has(commitId)) {
        return codeMapCache.get(commitId)!;
    }

    const mapParts: string[] = [];

    // Filter out ignored files (images, lockfiles, node_modules, etc.)
    const codeFiles = filePaths.filter(path => !shouldIgnoreFile(path));

    // Process all files in parallel with a concurrency limit (to avoid memory/network spikes)
    const CONCURRENCY_LIMIT = 50;

    for (let i = 0; i < codeFiles.length; i += CONCURRENCY_LIMIT) {
        const batch = codeFiles.slice(i, i + CONCURRENCY_LIMIT);

        await Promise.all(batch.map(async (path) => {
            try {
                const content = await getContent(path);
                const outline = extractOutline(content);
                if (outline.length > 0) {
                    mapParts.push(`=== ${path} ===\n${outline.join('\n')}\n`);
                }
            } catch (err) {
                console.error(`[CodeMap] Failed to extract outline for ${path}`, err);
            }
        }));
    }

    // Sort alphabetically for deterministic output
    mapParts.sort();

    const result = mapParts.join('\n');
    codeMapCache.set(commitId, result);

    return result;
}
