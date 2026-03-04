import { InvocationContext } from "@azure/functions";
import { PlatformAdapter, ReviewStatus } from "../interfaces/PlatformAdapter";
import { reviewWithAI, reviewBatchWithAI, planReviewContext } from "../utils/aiClient";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { cleanCodeContent } from "../utils/codeCleaner";
import { env } from "../config/envVariables";
import { estimateTokens, getMaxBatchTokens } from "../utils/tokenEstimator";
import { generateCodeMap } from "../utils/codeMapGenerator";

export class ReviewService {
    constructor(private platform: PlatformAdapter) { }

    async reviewPullRequest(context: InvocationContext): Promise<void> {
        const prId = this.platform.getPRIdentifier();
        context.log(`[REVIEW] Starting review for PR ${prId}`);

        context.log(`[VALIDATE] Validating webhook`);
        if (!await this.platform.validateWebhook()) {
            context.log(`[IGNORE] Invalid webhook or action`);
            return;
        }

        context.log(`[REVIEW] Checking if PR should be processed`);
        if (!await this.platform.shouldProcessPR()) {
            context.log(`[IGNORE] PR should not be processed (already reviewed or reviewer not assigned)`);
            return;
        }

        try {
            context.log(`[LOCK] Locking PR to prevent race conditions`);
            await this.platform.lockPR();
        } catch (err: any) {
            context.log(`[LOCK] Failed to lock PR: ${err.message}`);
        }

        context.log(`[FILES] Fetching changed files`);
        const files = await this.platform.getChangedFiles();
        context.log(`[FILES] Found ${files.length} changed files`);

        if (files.length === 0) return;

        // Fetch custom guidelines from repo if configured
        let repoGuidelines: string = null;
        if (env.AI_REVIEW_GUIDELINES) {
            try {
                // Use the commitId of the first file to fetch the guidelines from the same version of code
                repoGuidelines = await this.platform.getFileContent(env.AI_REVIEW_GUIDELINES, files[0].commitId);
                if (repoGuidelines && repoGuidelines.trim().length > 0) {
                    context.log(`[CONFIG] Using custom rules from repo: ${env.AI_REVIEW_GUIDELINES}`);
                } else if (repoGuidelines && repoGuidelines.trim().length === 0) {
                    context.log(`[CONFIG] Custom rules file is empty at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
                } else {
                    context.log(`[CONFIG] No custom rules found at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
                }
            } catch (err) {
                context.log(`[CONFIG] Error fetching custom rules at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
            }
        } else {
            context.log(`[CONFIG] No custom rules configured, using defaults.`);
        }

        let hasRedFlags = false;
        let hasIssues = false;
        const MAX_REVIEW_COMMENTS = env.MAX_REVIEW_COMMENTS ? parseInt(env.MAX_REVIEW_COMMENTS, 10) : undefined;
        const SEVERITY_PRIORITY: Record<string, number> = { critical: 0, major: 1, minor: 2 };
        const contextMode = env.CONTEXT_MODE?.toLowerCase();
        const isBatchMode = contextMode === 'batch' || contextMode === 'codemap' || contextMode === 'agentic';

        // Collect all comments from all files first
        const allComments: { filePath: string; startLine?: number; endLine?: number; severity: string; comment: string }[] = [];

        // Phase 1: Fetch all file contents and run pre-checks
        const reviewableFiles: { fileName: string; content: string }[] = [];

        for (const file of files) {
            if (shouldIgnoreFile(file.path)) {
                context.log(`[SKIP] Ignoring file: ${file.path}`);
                continue;
            }

            try {
                const content = await this.platform.getFileContent(file.path, file.commitId);
                const isCleaningEnabled = String(env.ENABLE_CODE_CLEANING).toLowerCase() === 'true';
                const cleanedContent = isCleaningEnabled ? cleanCodeContent(content, file.path) : content;
                const cleanedLineCount = cleanedContent.split('\n').length;

                const isMarkdown = file.path.toLowerCase().endsWith('.md');
                if (cleanedLineCount > 1000 && !isMarkdown) {
                    hasRedFlags = true;
                    allComments.push({
                        filePath: file.path,
                        severity: 'critical',
                        comment: "🔴 **Architectural Red Flag**: This file exceeds 1000 lines."
                    });
                    context.log(`[REVIEW] File ${file.path} exceeds 1000 lines — red flag added`);
                } else {
                    // Add to reviewable files for AI review
                    reviewableFiles.push({ fileName: file.path, content });
                }
            } catch (err: any) {
                context.error(`[REVIEW] Failed to fetch ${file.path}: ${err.message}`);
            }
        }

        // Phase 2: AI Review — batch or per-file depending on CONTEXT_MODE and token budget
        if (reviewableFiles.length > 0) {
            let codeMap: string | undefined = undefined;

            if (contextMode === 'codemap' || contextMode === 'agentic') {
                if (this.platform.getRepoFilePaths) {
                    try {
                        context.log(`[CONTEXT] Generating code map for repository`);
                        const allPaths = await this.platform.getRepoFilePaths(files[0].commitId);
                        codeMap = await generateCodeMap(files[0].commitId, allPaths, async (path) => {
                            return await this.platform.getFileContent(path, files[0].commitId);
                        });
                        context.log(`[CONTEXT] Code map generated (${codeMap.split('\n').length} lines)`);
                    } catch (err: any) {
                        context.log(`[CONTEXT] Failed to generate code map: ${err.message}`);
                    }
                } else {
                    context.log(`[CONTEXT] Platform adapter does not support getRepoFilePaths. Skipping code map.`);
                }
            }

            let contextFiles: { fileName: string; content: string }[] | undefined = undefined;
            if (contextMode === 'agentic' && codeMap) {
                context.log(`[AGENTIC] Planning review context...`);
                try {
                    const requestedFilePaths = await planReviewContext(reviewableFiles, codeMap);

                    if (requestedFilePaths.length > 0) {
                        context.log(`[AGENTIC] AI requested ${requestedFilePaths.length} context files`);
                        contextFiles = [];
                        for (const path of requestedFilePaths.slice(0, 5)) { // Enforce max 5 hard limit
                            try {
                                const content = await this.platform.getFileContent(path, files[0].commitId);
                                contextFiles.push({ fileName: path, content });
                            } catch (err: any) {
                                context.log(`[AGENTIC] Failed to fetch context file ${path}: ${err.message}`);
                            }
                        }
                    } else {
                        context.log(`[AGENTIC] AI decided no additional context files are needed.`);
                    }
                } catch (err: any) {
                    context.error(`[AGENTIC] Planning failed, proceeding with code map only: ${err.message}`);
                }
            }

            if (isBatchMode) {
                const totalContent = reviewableFiles.map(f => f.content).join('\n');
                const estimatedTokens = estimateTokens(totalContent);
                const maxTokens = getMaxBatchTokens(env.MAX_BATCH_TOKENS);

                if (estimatedTokens <= maxTokens) {
                    // Batch review: send all files in one prompt
                    context.log(`[AI] Batch reviewing ${reviewableFiles.length} files (~${estimatedTokens} tokens, budget: ${maxTokens})`);
                    try {
                        const aiReviews = await reviewBatchWithAI(reviewableFiles, repoGuidelines, codeMap, contextFiles);
                        if (aiReviews.length > 0) {
                            hasIssues = true;
                            for (const review of aiReviews) {
                                allComments.push({
                                    filePath: review.filePath || reviewableFiles[0].fileName,
                                    startLine: review.startLine,
                                    endLine: review.endLine,
                                    severity: review.severity,
                                    comment: review.comment
                                });
                            }
                            context.log(`[AI] Batch review found ${aiReviews.length} issues across ${reviewableFiles.length} files`);
                        } else {
                            context.log(`[AI] Batch review found no issues`);
                        }
                    } catch (err: any) {
                        context.error(`[AI] Batch review failed, falling back to per-file review: ${err.message}`);
                        // Fall back to per-file review
                        await this.reviewFilesIndividually(reviewableFiles, repoGuidelines, codeMap, contextFiles, allComments, context);
                        hasIssues = hasIssues || allComments.length > 0;
                    }
                } else {
                    // Token budget exceeded — fall back to per-file review
                    context.log(`[AI] Batch too large (~${estimatedTokens} tokens, budget: ${maxTokens}), falling back to per-file review`);
                    await this.reviewFilesIndividually(reviewableFiles, repoGuidelines, codeMap, contextFiles, allComments, context);
                    hasIssues = hasIssues || allComments.length > 0;
                }
            } else {
                // No CONTEXT_MODE set — per-file review (original behavior)
                await this.reviewFilesIndividually(reviewableFiles, repoGuidelines, codeMap, contextFiles, allComments, context);
                hasIssues = hasIssues || allComments.length > 0;
            }
        }

        // Sort by severity priority (critical first, then major, then minor)
        allComments.sort((a, b) => (SEVERITY_PRIORITY[a.severity] ?? 3) - (SEVERITY_PRIORITY[b.severity] ?? 3));

        // Post only the top N most critical comments or post all if no limit
        const topComments = MAX_REVIEW_COMMENTS !== undefined
            ? allComments.slice(0, MAX_REVIEW_COMMENTS)
            : allComments;

        context.log(`[REVIEW] Collected ${allComments.length} total comments, posting ${topComments.length}`);

        for (const comment of topComments) {
            await this.platform.postComment(comment.filePath, comment.startLine, comment.endLine, comment.comment);
        }

        const status: ReviewStatus = hasRedFlags ? 'changes_requested' : hasIssues ? 'commented' : 'approved';
        await this.platform.setFinalStatus(status);
        context.log(`[FINAL] Review completed with status: ${status}`);
    }

    /**
     * Reviews files individually (one AI call per file).
     * Used as default mode or as fallback when batch mode exceeds token budget.
     */
    private async reviewFilesIndividually(
        files: { fileName: string; content: string }[],
        repoGuidelines: string | null,
        codeMap: string | undefined,
        contextFiles: { fileName: string; content: string }[] | undefined,
        allComments: { filePath: string; startLine?: number; endLine?: number; severity: string; comment: string }[],
        context: InvocationContext
    ): Promise<void> {
        for (const file of files) {
            try {
                context.log(`[AI] Reviewing file: ${file.fileName}`);
                const aiReviews = await reviewWithAI(file.fileName, file.content, repoGuidelines, codeMap, contextFiles);
                if (aiReviews.length > 0) {
                    for (const review of aiReviews) {
                        allComments.push({
                            filePath: file.fileName,
                            startLine: review.startLine,
                            endLine: review.endLine,
                            severity: review.severity,
                            comment: review.comment
                        });
                    }
                    context.log(`[AI] Found ${aiReviews.length} issues in ${file.fileName}`);
                } else {
                    context.log(`[AI] No issues found in ${file.fileName}`);
                }
            } catch (err: any) {
                context.error(`[REVIEW] Failed to review ${file.fileName}: ${err.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
