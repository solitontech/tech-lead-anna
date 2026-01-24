import { InvocationContext } from "@azure/functions";
import { PlatformAdapter, ReviewStatus } from "../interfaces/PlatformAdapter";
import { reviewWithAI } from "../utils/aiClient";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { cleanCodeContent } from "../utils/codeCleaner";

export class ReviewService {
    constructor(private platform: PlatformAdapter) { }

    async reviewPullRequest(context: InvocationContext): Promise<void> {
        const prId = this.platform.getPRIdentifier();
        context.log(`[REVIEW] Starting review for PR ${prId}`);

        if (!await this.platform.validateWebhook()) {
            context.log(`[IGNORE] Invalid webhook or action`);
            return;
        }

        if (!await this.platform.shouldProcessPR()) {
            context.log(`[IGNORE] PR should not be processed (already reviewed or reviewer not assigned)`);
            return;
        }

        try {
            await this.platform.lockPR();
        } catch (err: any) {
            context.log(`[LOCK] Failed to lock PR: ${err.message}`);
        }

        const files = await this.platform.getChangedFiles();
        context.log(`[FILES] Found ${files.length} changed files`);

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
                    await this.platform.postComment(file.path, undefined, "🔴 **Architectural Red Flag**: This file exceeds 1000 lines.");
                } else {
                    const aiReviews = await reviewWithAI(file.path, content);
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
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const status: ReviewStatus = hasRedFlags ? 'changes_requested' : hasIssues ? 'commented' : 'approved';
        await this.platform.setFinalStatus(status);
        context.log(`[FINAL] Review completed with status: ${status}`);
    }
}
