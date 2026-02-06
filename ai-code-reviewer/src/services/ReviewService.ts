import { InvocationContext } from "@azure/functions";
import { PlatformAdapter, ReviewStatus } from "../interfaces/PlatformAdapter";
import { reviewWithAI } from "../utils/aiClient";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { cleanCodeContent } from "../utils/codeCleaner";
import { env } from "../config/envVariables";

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
        const repoGuidelines = await this.fetchCustomGuidelines(context, files[0]?.commitId);

        let hasRedFlags = false;
        let hasIssues = false;

        for (const file of files) {
            if (shouldIgnoreFile(file.path)) {
                context.log(`[SKIP] Ignoring file: ${file.path}`);
                continue;
            }

            try {
                const content = await this.platform.getFileContent(file.path, file.commitId);
                const cleanedContent = cleanCodeContent(content, file.path);
                const cleanedLineCount = cleanedContent.split('\n').length;

                const isMarkdown = file.path.toLowerCase().endsWith('.md');
                if (cleanedLineCount > 1000 && !isMarkdown) {
                    hasRedFlags = true;
                    await this.platform.postComment(file.path, undefined, undefined, "🔴 **Architectural Red Flag**: This file exceeds 1000 lines.");
                } else {
                    const aiReviews = await reviewWithAI(file.path, content, repoGuidelines);
                    if (aiReviews.length > 0) {
                        hasIssues = true;
                        for (const review of aiReviews) {
                            await this.platform.postComment(file.path, review.startLine, review.endLine, review.comment);
                        }
                    }
                }
            } catch (err: any) {
                context.log(`[ERROR] Failed to review ${file.path}: ${err.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const status: ReviewStatus = hasRedFlags ? 'changes_requested' : hasIssues ? 'commented' : 'approved';
        await this.platform.setFinalStatus(status);
        context.log(`[FINAL] Review completed with status: ${status}`);
    }

    /**
     * Fetches custom review guidelines from the repository if configured.
     * @param context - The invocation context for logging
     * @param commitId - The commit ID to fetch the guidelines from
     * @returns The custom guidelines content, or null if not found/configured
     */
    private async fetchCustomGuidelines(context: InvocationContext, commitId?: string): Promise<string | null> {
        if (!env.AI_REVIEW_GUIDELINES) {
            context.log(`[CONFIG] No custom rules configured, using defaults.`);
            return null;
        }

        if (!commitId) {
            context.log(`[CONFIG] No commit ID available, using defaults.`);
            return null;
        }

        try {
            // Use the commitId to fetch the guidelines from the same version of code
            const repoGuidelines = await this.platform.getFileContent(env.AI_REVIEW_GUIDELINES, commitId);

            if (repoGuidelines && repoGuidelines.trim().length > 0) {
                context.log(`[CONFIG] Using custom rules from repo: ${env.AI_REVIEW_GUIDELINES}`);
                return repoGuidelines;
            } else if (repoGuidelines && repoGuidelines.trim().length === 0) {
                context.log(`[CONFIG] Custom rules file is empty at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
                return null;
            } else {
                context.log(`[CONFIG] No custom rules found at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
                return null;
            }
        } catch (err) {
            context.log(`[CONFIG] Error fetching custom rules at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
            return null;
        }
    }
}
