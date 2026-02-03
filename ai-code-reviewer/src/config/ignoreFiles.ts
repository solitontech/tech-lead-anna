/**
 * List of files and extensions to ignore during the code review process.
 * Includes metadata, lock files, and build artifacts for common environments.
 */
export const ignoredFiles = [
    // --- Node.js / JavaScript ---
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'node_modules',
    '.npmrc',

    // --- Python ---
    'requirements.txt',
    'Pipfile',
    'Pipfile.lock',
    'poetry.lock',
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    '.pyc',
    '.pyo',
    '__pycache__',

    // --- C# / .NET ---
    '.csproj',
    '.vbproj',
    '.sln',
    '.user',
    '.suo',
    'App.config',
    'packages.config',
    'Web.config',
    '.nupkg',

    // --- C++ ---
    '.vcxproj',
    '.filters',
    '.o',
    '.obj',
    '.out',
    '.pdb',
    '.lib',
    '.a',

    // --- General Config & Metadata ---
    '.env',
    'env.example',
    '.env.example',
    '.gitignore',
    '.funcignore',
    '.dockerignore',
    'Dockerfile',
    'docker-compose.yml',
    'LICENSE',
    'README.md',
    '.DS_Store'
];

/**
 * Checks if a given file path should be ignored based on its name or extension.
 */
export function shouldIgnoreFile(path: string): boolean {
    const fileName = path.split('/').pop()?.toLowerCase() || '';
    return ignoredFiles.some(ignored => {
        const lowerIgnored = ignored.toLowerCase();
        // Check if it's an exact match or if the file ends with the extension (e.g., .pyc)
        return fileName === lowerIgnored || fileName.endsWith(lowerIgnored);
    });
}
