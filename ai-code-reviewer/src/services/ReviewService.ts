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

        const repoGuidelines = await this.getRepoGuidelines(context, files[0].commitId);

        let hasRedFlags = false;
        let hasIssues = false;

        for (const file of files) {
            if (shouldIgnoreFile(file.path)) {
                context.log(`[SKIP] Ignoring file: ${file.path}`);
                continue;
            }

            const result = await this.reviewFile(context, file, repoGuidelines);
            if (result.hasRedFlags) hasRedFlags = true;
            if (result.hasIssues) hasIssues = true;

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const status: ReviewStatus = hasRedFlags ? 'changes_requested' : hasIssues ? 'commented' : 'approved';
        await this.platform.setFinalStatus(status);
        context.log(`[FINAL] Review completed with status: ${status}`);
    }

    private async getRepoGuidelines(context: InvocationContext, commitId: string): Promise<string | null> {
        if (env.AI_REVIEW_GUIDELINES) {
            try {
                const repoGuidelines = await this.platform.getFileContent(env.AI_REVIEW_GUIDELINES, commitId);
                if (repoGuidelines) {
                    context.log(`[CONFIG] Using custom rules from repo: ${env.AI_REVIEW_GUIDELINES}`);
                    return repoGuidelines;
                }
            } catch (err) {
                context.log(`[CONFIG] No custom rules found at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
            }
        } else {
            context.log(`[CONFIG] No custom rules configured, using defaults.`);
        }
        return null;
    }

    private async reviewFile(context: InvocationContext, file: { path: string; commitId: string }, repoGuidelines: string | null): Promise<{ hasRedFlags: boolean, hasIssues: boolean }> {
        let hasRedFlags = false;
        let hasIssues = false;

        try {
            const content = await this.platform.getFileContent(file.path, file.commitId);
            const cleanedContent = cleanCodeContent(content, file.path);
            const cleanedLineCount = cleanedContent.split('\n').length;

            const isMarkdown = file.path.toLowerCase().endsWith('.md');
            if (cleanedLineCount > 1000 && !isMarkdown) {
                hasRedFlags = true;
                await this.platform.postComment(file.path, undefined, "🔴 **Architectural Red Flag**: This file exceeds 1000 lines.");
            } else {
                const aiReviews = await reviewWithAI(file.path, content, repoGuidelines);
                if (aiReviews.length > 0) {
                    hasIssues = true;
                    for (const review of aiReviews) {
                        await this.platform.postComment(file.path, review.line, review.comment);
                    }
                }
            }
        } catch (err: any) {
            context.log(`[ERROR] Failed to review ${file.path}: ${err.message}`);
        }

        return { hasRedFlags, hasIssues };
    }
}
