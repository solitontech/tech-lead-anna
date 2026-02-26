/**
 * List of files and extensions to ignore during the code review process.
 * Includes metadata, lock files, build artifacts, and tool config for common ecosystems.
 */
export const ignoredFiles = [

    // --- Node.js / JavaScript ---
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',               // Bun lock file
    'node_modules',
    '.npmrc',
    '.nvmrc',                  // Node version manager
    '.node-version',

    // --- TypeScript ---
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.spec.json',
    'tsconfig.lib.json',
    'tsconfig.build.json',
    '.tsbuildinfo',            // TypeScript incremental build cache

    // --- Linters & Formatters ---
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.mjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.json',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    'prettier.config.js',
    'prettier.config.cjs',
    '.editorconfig',
    '.stylelintrc',
    '.stylelintrc.json',
    'stylelint.config.js',

    // --- Bundlers & Build Tools ---
    'vite.config.js',
    'vite.config.ts',
    'vite.config.mts',
    'webpack.config.js',
    'webpack.config.ts',
    'webpack.config.cjs',
    'rollup.config.js',
    'rollup.config.ts',
    'esbuild.config.js',
    'esbuild.config.ts',
    'swc.config.js',
    '.swcrc',
    '.babelrc',
    '.babelrc.js',
    '.babelrc.json',
    'babel.config.js',
    'babel.config.cjs',
    'babel.config.ts',

    // --- Test Config ---
    'jest.config.js',
    'jest.config.ts',
    'jest.config.cjs',
    'jest.config.mjs',
    'vitest.config.js',
    'vitest.config.ts',
    'playwright.config.js',
    'playwright.config.ts',
    'karma.conf.js',
    'cypress.config.js',
    'cypress.config.ts',

    // --- CSS / Tailwind / PostCSS ---
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'postcss.config.js',
    'postcss.config.cjs',
    '.browserslistrc',

    // --- React (Next.js) ---
    'next.config.js',
    'next.config.ts',
    'next.config.mjs',
    'next-env.d.ts',           // Auto-generated Next.js type declarations

    // --- Angular ---
    'angular.json',
    '.angular',
    'karma.conf.js',           // Angular default test runner config

    // --- Monorepo & Workspace Tools ---
    'nx.json',
    'workspace.json',
    'lerna.json',
    'turbo.json',
    '.turbo',
    'rush.json',

    // --- Minified / Generated Assets ---
    '.min.js',
    '.min.css',
    '.map',                    // Source maps
    '.chunk.js',

    // --- Python ---
    'requirements.txt',
    'requirements-dev.txt',
    'requirements-test.txt',
    'Pipfile',
    'Pipfile.lock',
    'poetry.lock',
    'uv.lock',                 // uv package manager lock file
    'uv.toml',                 // uv config
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    'MANIFEST.in',
    'tox.ini',
    'pytest.ini',
    '.pytest.ini',
    '.flake8',
    'mypy.ini',
    '.mypy.ini',
    '.python-version',         // pyenv version file
    '.pyc',
    '.pyo',
    '__pycache__',

    // --- C# / .NET ---
    '.csproj',
    '.vbproj',
    '.fsproj',
    '.sln',
    '.user',
    '.suo',
    'App.config',
    'packages.config',
    'Web.config',
    '.nupkg',
    'NuGet.Config',
    'nuget.config',
    'global.json',             // .NET SDK version pin
    'Directory.Build.props',
    'Directory.Build.targets',
    'Directory.Packages.props',
    '.props',
    '.targets',

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
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    '.gitignore',
    '.gitattributes',
    '.funcignore',
    '.dockerignore',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    '.DS_Store',
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
