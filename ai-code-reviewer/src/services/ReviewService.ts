import { InvocationContext } from "@azure/functions";
import { PlatformAdapter, ReviewStatus } from "../interfaces/PlatformAdapter";
import { reviewWithAI } from "../utils/aiClient";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { cleanCodeContent } from "../utils/codeCleaner";
import { env } from "../config/envVariables";
import { LoggerService } from "./LoggerService";

export class ReviewService {
    constructor(private platform: PlatformAdapter) { }

    async reviewPullRequest(context: InvocationContext): Promise<void> {
        const prId = this.platform.getPRIdentifier();
        const logger = LoggerService.create({
            context,
            prIdentifier: prId,
            enableDebug: !!process.env.DEBUG,
        });

        try {
            await this.executeReview(logger);
        } finally {
            logger.dispose();
        }
    }

    private async executeReview(logger: LoggerService): Promise<void> {
        const prId = this.platform.getPRIdentifier();
        logger.info("REVIEW", `Starting review for PR ${prId}`);

        logger.info("VALIDATE", "Validating webhook");
        if (!await this.platform.validateWebhook()) {
            logger.info("IGNORE", "Invalid webhook or action");
            return;
        }

        logger.info("REVIEW", "Checking if PR should be processed");
        if (!await this.platform.shouldProcessPR()) {
            logger.info("IGNORE", "PR should not be processed (already reviewed or reviewer not assigned)");
            return;
        }

        try {
            logger.info("LOCK", "Locking PR to prevent race conditions");
            await this.platform.lockPR();
        } catch (err: any) {
            logger.warn("LOCK", `Failed to lock PR: ${err.message}`);
        }

        logger.info("FILES", "Fetching changed files");
        const files = await this.platform.getChangedFiles();
        logger.info("FILES", `Found ${files.length} changed files`);

        if (files.length === 0) return;

        // Fetch custom guidelines from repo if configured
        let repoGuidelines: string = null;
        if (env.AI_REVIEW_GUIDELINES) {
            try {
                // Use the commitId of the first file to fetch the guidelines from the same version of code
                repoGuidelines = await this.platform.getFileContent(env.AI_REVIEW_GUIDELINES, files[0].commitId);
                if (repoGuidelines && repoGuidelines.trim().length > 0) {
                    logger.info("CONFIG", `Using custom rules from repo: ${env.AI_REVIEW_GUIDELINES}`);
                } else if (repoGuidelines && repoGuidelines.trim().length === 0) {
                    logger.warn("CONFIG", `Custom rules file is empty at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
                } else {
                    logger.info("CONFIG", `No custom rules found at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
                }
            } catch (err) {
                logger.warn("CONFIG", `Error fetching custom rules at ${env.AI_REVIEW_GUIDELINES}, using defaults.`);
            }
        } else {
            logger.info("CONFIG", "No custom rules configured, using defaults.");
        }

        let hasRedFlags = false;
        let hasIssues = false;
        const MAX_REVIEW_COMMENTS = 15;
        const SEVERITY_PRIORITY: Record<string, number> = { critical: 0, major: 1, minor: 2 };

        // Collect all comments from all files first
        const allComments: { filePath: string; startLine?: number; endLine?: number; severity: string; comment: string }[] = [];

        for (const file of files) {
            if (shouldIgnoreFile(file.path)) {
                logger.debug("SKIP", `Ignoring file: ${file.path}`);
                continue;
            }

            try {
                const content = await this.platform.getFileContent(file.path, file.commitId);
                const cleanedContent = cleanCodeContent(content, file.path);
                const cleanedLineCount = cleanedContent.split('\n').length;

                const isMarkdown = file.path.toLowerCase().endsWith('.md');
                if (cleanedLineCount > 1000 && !isMarkdown) {
                    hasRedFlags = true;
                    allComments.push({
                        filePath: file.path,
                        severity: 'critical',
                        comment: "🔴 **Architectural Red Flag**: This file exceeds 1000 lines."
                    });
                    logger.warn("REVIEW", `File ${file.path} exceeds 1000 lines — red flag added`);
                } else {
                    logger.info("AI", `Reviewing file: ${file.path} (${cleanedLineCount} lines)`);
                    const aiReviews = await reviewWithAI(file.path, content, repoGuidelines, 1, logger);
                    if (aiReviews.length > 0) {
                        hasIssues = true;
                        for (const review of aiReviews) {
                            allComments.push({
                                filePath: file.path,
                                startLine: review.startLine,
                                endLine: review.endLine,
                                severity: review.severity,
                                comment: review.comment
                            });
                        }
                        logger.info("AI", `Found ${aiReviews.length} issues in ${file.path}`);
                    } else {
                        logger.info("AI", `No issues found in ${file.path}`);
                    }
                }
            } catch (err: any) {
                logger.error("REVIEW", `Failed to review ${file.path}`, err);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Sort by severity priority (critical first, then major, then minor)
        allComments.sort((a, b) => (SEVERITY_PRIORITY[a.severity] ?? 3) - (SEVERITY_PRIORITY[b.severity] ?? 3));

        // Post only the top N most critical comments
        const topComments = allComments.slice(0, MAX_REVIEW_COMMENTS);
        logger.info("REVIEW", `Collected ${allComments.length} total comments, posting top ${topComments.length}`);

        for (const comment of topComments) {
            await this.platform.postComment(comment.filePath, comment.startLine, comment.endLine, comment.comment);
        }

        const status: ReviewStatus = hasRedFlags ? 'changes_requested' : hasIssues ? 'commented' : 'approved';
        await this.platform.setFinalStatus(status);
        logger.info("FINAL", `Review completed with status: ${status}`);

        if (logger.getLogFilePath()) {
            logger.info("LOG", `Full review log saved to: ${logger.getLogFilePath()}`);
        }
    }
}
