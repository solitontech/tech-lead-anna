# Context Awareness: Implementation Tasks

Context is controlled by a single environment variable `CONTEXT_MODE` with three progressive levels. Each level includes everything from the levels above it.

| `CONTEXT_MODE` | What the AI sees |
| :--- | :--- |
| `batch` | All changed files together in one prompt |
| `codemap` | Batch + structural outline of the entire repo |
| `agentic` | Codemap + full source of files the AI requests (two-pass) |

---

## Phase 1: Batch PR Review (`CONTEXT_MODE=batch`)

**Goal:** Instead of reviewing each file in isolation, send all changed files together in a single AI call so the AI can see cross-file relationships within the PR.

### 1.1. Add `CONTEXT_MODE` and `MAX_BATCH_TOKENS` environment variables
- **File:** `src/config/envVariables.ts`
- **Task:** Add:
  ```ts
  CONTEXT_MODE: process.env.CONTEXT_MODE,
  MAX_BATCH_TOKENS: process.env.MAX_BATCH_TOKENS,
  ```

### 1.2. Add `filePath` to `AIReviewComment` interface
- **File:** `src/utils/aiClient.ts` (lines 11-16)
- **Task:** Add an optional `filePath?: string` field to the `AIReviewComment` interface.

### 1.3. Create a batched prompt function
- **File:** `src/prompts/reviewPrompts.ts`
- **Task:** Create a new `getBatchedUserPrompt(files: { fileName: string; content: string }[], customGuidelines?: string): string` function.
- **Details:**
  - Concatenate all file contents into a single prompt, each wrapped with a clear header like `### FILE: src/services/Foo.ts`
  - The JSON response format should include `filePath` alongside `startLine`, `endLine`, `severity`, and `comment`
  - Keep the existing `getUserPrompt()` unchanged (for fallback / per-file mode)

### 1.4. Create a batched AI review function
- **File:** `src/utils/aiClient.ts`
- **Task:** Create a new `reviewBatchWithAI(files: { fileName: string; content: string }[], customGuidelines?: string): Promise<AIReviewComment[]>` function.
- **Details:**
  - Similar to `reviewWithAI()` but uses the new `getBatchedUserPrompt()`
  - Each returned `AIReviewComment` must include a `filePath` field
  - Same retry logic for rate limits

### 1.5. Add a token/size estimation utility
- **File:** New file — `src/utils/tokenEstimator.ts`
- **Task:** Create a simple function `estimateTokens(text: string): number` that approximates token count (e.g., `Math.ceil(text.length / 4)`).
- **Details:**
  - Used to decide whether batching is feasible or if we need to fall back to per-file review
  - Default budget: 60,000 tokens (configurable via `MAX_BATCH_TOKENS`)

### 1.6. Refactor `ReviewService` to support batched review
- **File:** `src/services/ReviewService.ts`
- **Task:** When `CONTEXT_MODE` is `batch` (or `codemap` or `agentic`), modify `reviewPullRequest()` to:
  1. Fetch all file contents first (existing loop stays, but just fetches — no AI call yet)
  2. Run the 1000-line red flag check per file (keep as-is)
  3. Concatenate non-red-flag files and estimate tokens
  4. If under `MAX_BATCH_TOKENS` → call `reviewBatchWithAI()` once
  5. If over → fall back to per-file `reviewWithAI()` (current behavior)
- **Details:**
  - The `allComments` array remains the single collection point
  - Sorting + slicing logic stays the same

---

## Phase 2: Code Map (`CONTEXT_MODE=codemap`)

**Goal:** Give the AI a lightweight structural map of the entire repository — file names, class names, and function signatures — so it knows *what exists* in the codebase without needing to read every file's implementation.

**Prerequisite:** Phase 1 (batch) must be implemented first. Codemap mode includes batch behavior automatically.

### 2.1. Add `getRepoFilePaths()` to `PlatformAdapter` interface
- **File:** `src/interfaces/PlatformAdapter.ts`
- **Task:** Add optional method: `getRepoFilePaths?(commitId: string): Promise<string[]>`
- **Details:**
  - Returns a flat list of all file paths in the repo at a given commit
  - Used by the code map generator to know which files to outline
  - Optional so adapters that don't support it can skip

### 2.2. Implement `getRepoFilePaths()` in GitHubAdapter
- **File:** `src/adapters/GitHubAdapter.ts`
- **Task:** Implement using `octokit.git.getTree({ owner, repo, tree_sha: commitSha, recursive: 'true' })` to list all files

### 2.3. Implement `getRepoFilePaths()` in AzDoAdapter
- **File:** `src/adapters/AzDoAdapter.ts`
- **Task:** Implement using the AzDo Items API with `recursionLevel=Full` to list all file paths

### 2.4. Create a code map generator utility
- **File:** New file — `src/utils/codeMapGenerator.ts`
- **Task:** Create `generateCodeMap(filePaths: string[], getContent: (path: string) => Promise<string>): Promise<string>`
- **Details:**
  - For each file, extract a lightweight outline: exports, class names, function signatures (name + parameters + return type), and interface definitions
  - Use regex-based extraction (simpler) or a lightweight AST parser like `@typescript-eslint/parser` (more robust)
  - Return a formatted string like:
    ```
    === src/services/ReviewService.ts ===
    class ReviewService
      reviewPullRequest(context: InvocationContext): Promise<void>

    === src/interfaces/PlatformAdapter.ts ===
    interface FileChange { path: string; commitId: string; isFolder?: boolean }
    interface PlatformAdapter
      validateWebhook(): Promise<boolean>
      getChangedFiles(): Promise<FileChange[]>
      getFileContent(path: string, commitId: string): Promise<string>
      ...
    ```
  - Skip binary files and files matching the ignore list

### 2.5. Add caching for the code map (optional optimization)
- **File:** `src/utils/codeMapGenerator.ts`
- **Task:** Cache the generated code map per commit SHA to avoid regenerating it for every file in per-file mode
- **Details:**
  - Simple in-memory `Map<string, string>` keyed by commit SHA
  - Since Azure Functions are short-lived, this cache only needs to survive one invocation

### 2.6. Update prompts to accept a code map
- **File:** `src/prompts/reviewPrompts.ts`
- **Task:** Update `getUserPrompt()` and `getBatchedUserPrompt()` to accept an optional `codeMap?: string` parameter
- **Details:**
  - Include the code map in a clearly labeled section: `### REPOSITORY STRUCTURE (Read-Only Reference)`
  - Instruct the AI: "Use this to understand the broader codebase architecture. Do NOT review these files — only use them as context."

### 2.7. Integrate the code map into ReviewService
- **File:** `src/services/ReviewService.ts`
- **Task:** When `CONTEXT_MODE` is `codemap` or `agentic`:
  1. Fetch all repo file paths via `platform.getRepoFilePaths()`
  2. Call `generateCodeMap()` to build the structural outline
  3. Pass the code map string to the prompt functions

---

## Phase 3: Agentic Review (`CONTEXT_MODE=agentic`)

**Goal:** Let the AI decide what additional files it needs to see, fetch them, and include them as read-only context for the actual review. This mode automatically includes codemap behavior.

**Prerequisite:** Phases 1 and 2 must be implemented first. Agentic mode includes both batch and codemap behavior automatically.

### 3.1. Create a planning prompt
- **File:** `src/prompts/reviewPrompts.ts`
- **Task:** Create `getPlanningPrompt(changedFiles: string[], allRepoPaths: string[]): string`
- **Details:**
  - Input: list of changed file paths + list of all repo file paths
  - Ask the AI: *"Based on these changed files, which other files from the repository would you need to read to do a thorough code review? Return a JSON array of file paths. Maximum 10 files."*
  - Output format: `{ "requestedFiles": ["src/types/foo.ts", ...] }`

### 3.2. Create a planning AI function
- **File:** `src/utils/aiClient.ts`
- **Task:** Create `planReviewContext(changedFiles: string[], allRepoPaths: string[]): Promise<string[]>`
- **Details:**
  - Calls the AI with the planning prompt
  - Parses and returns the list of requested file paths
  - Cap at 10 files to control cost

### 3.3. Update prompts to accept read-only context files
- **File:** `src/prompts/reviewPrompts.ts`
- **Task:** Update `getUserPrompt()` and `getBatchedUserPrompt()` to accept an optional `contextFiles: { fileName: string; content: string }[]` parameter
- **Details:**
  - Context files are clearly labeled as "READ-ONLY — do NOT generate review comments for these files"
  - This prevents the AI from reviewing unchanged context files

### 3.4. Integrate two-pass flow in ReviewService
- **File:** `src/services/ReviewService.ts`
- **Task:** When `CONTEXT_MODE` is `agentic`:
  1. After fetching changed files (Phase 1) and generating the code map (Phase 2), get all repo file paths via `platform.getRepoFilePaths()` (already done in Phase 2)
  2. Call `planReviewContext()` with changed file paths + all repo paths (Pass 1)
  3. Fetch the AI-requested files via `platform.getFileContent()`
  4. Include them as read-only context alongside the changed files and code map in the review prompt (Pass 2)
- **Details:**
  - Falls back to `codemap` mode if the planning call fails
  - Log which files the AI requested for observability

---

## Summary Table

| Phase | CONTEXT_MODE | Impact | Effort | New Files | Modified Files |
|-------|-------------|--------|--------|-----------|----------------|
| **1** | `batch` | 🟢 High | 🟢 Low | `tokenEstimator.ts` | `reviewPrompts.ts`, `aiClient.ts`, `ReviewService.ts`, `envVariables.ts` |
| **2** | `codemap` | 🟡 Medium | 🟡 Medium | `codeMapGenerator.ts` | `PlatformAdapter.ts`, `GitHubAdapter.ts`, `AzDoAdapter.ts`, `ReviewService.ts`, `reviewPrompts.ts` |
| **3** | `agentic` | 🟢 High | 🟡 Medium | — | `reviewPrompts.ts`, `aiClient.ts`, `ReviewService.ts` |

> [!TIP]
> Start with **Phase 1** (batch) for the biggest immediate win. Then add **Phase 2** (codemap) for structural awareness. **Phase 3** (agentic) builds on top of both and gives the AI maximum flexibility to request exactly the context it needs.
