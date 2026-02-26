import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { InvocationContext } from "@azure/functions";
import { PlatformAdapter, FileChange, ReviewStatus } from "../interfaces/PlatformAdapter";
import { GitHubWebhookPayload } from "../types/github";
import { env } from "../config/envVariables";

/**
 * GitHub Adapter using GitHub App Authentication
 */
export class GitHubAdapter implements PlatformAdapter {
    private octokit: Octokit;
    private owner: string;
    private repo: string;
    private prNumber: number;
    private headSha: string;
    private context: InvocationContext;

    constructor(private payload: GitHubWebhookPayload, context: InvocationContext) {
        this.owner = payload.repository.owner.login;
        this.repo = payload.repository.name;
        this.prNumber = payload.pull_request.number;
        this.headSha = payload.pull_request.head.sha;
        this.context = context;

        this.octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: env.GITHUB_APP_ID,
                privateKey: env.GITHUB_APP_PRIVATE_KEY,
                installationId: payload.installation.id,
            },
        });
    }

    async validateWebhook(): Promise<boolean> {
        const allowedActions = ["review_requested"];
        return allowedActions.includes(this.payload.action);
    }

    async shouldProcessPR(): Promise<boolean> {
        // First, check if the bot is assigned as a reviewer
        const { data: pr } = await this.octokit.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: this.prNumber,
        });

        const botName = env.GITHUB_REVIEWER_NAME.toLowerCase().replace(/\s+/g, '-');

        // Check if bot is in requested_reviewers (users or teams)
        const isRequestedReviewer = pr.requested_reviewers?.some(
            (reviewer: any) => reviewer.login?.toLowerCase().includes(botName)
        ) || pr.requested_teams?.some(
            (team: any) => team.name?.toLowerCase().includes(botName)
        );

        // If not assigned as reviewer, don't process
        if (!isRequestedReviewer) {
            return false;
        }

        // Second, check if a review by our bot already exists for this head SHA to avoid loops
        const { data: reviews } = await this.octokit.pulls.listReviews({
            owner: this.owner,
            repo: this.repo,
            pull_number: this.prNumber,
        });

        const hasReviewed = reviews.some(r =>
            r.user?.login.toLowerCase().includes(botName) &&
            r.commit_id === this.headSha
        );

        return !hasReviewed;
    }

    async lockPR(): Promise<void> {
        // Post a simple comment to indicate processing has started
        await this.octokit.issues.createComment({
            owner: this.owner,
            repo: this.repo,
            issue_number: this.prNumber,
            body: `🤖 **${env.GITHUB_REVIEWER_NAME}** is reviewing this Pull Request...`,
        });
    }

    async getChangedFiles(): Promise<FileChange[]> {
        const { data: files } = await this.octokit.pulls.listFiles({
            owner: this.owner,
            repo: this.repo,
            pull_number: this.prNumber,
        });

        return files.map(f => ({
            path: f.filename,
            commitId: this.headSha
        }));
    }

    async getFileContent(path: string, commitId: string): Promise<string> {
        const { data }: any = await this.octokit.repos.getContent({
            owner: this.owner,
            repo: this.repo,
            path: path,
            ref: commitId,
        });

        if (data.content) {
            return Buffer.from(data.content, "base64").toString("utf-8");
        }
        return "";
    }

    async postComment(path: string, startLine: number | undefined, endLine: number | undefined, comment: string): Promise<void> {
        if (endLine && endLine > 0) {
            try {
                // Prepare review comment parameters
                const reviewComment: any = {
                    owner: this.owner,
                    repo: this.repo,
                    pull_number: this.prNumber,
                    body: comment,
                    commit_id: this.headSha,
                    path: path,
                    line: endLine,  // Required: end line
                    side: "RIGHT"
                };

                // Add multi-line support if startLine is different from endLine
                if (startLine && startLine < endLine) {
                    reviewComment.start_line = startLine;
                    reviewComment.start_side = "RIGHT";
                }

                await this.octokit.pulls.createReviewComment(reviewComment);
            } catch (error: any) {
                // If line can't be resolved (422 error), fall back to file-level comment
                if (error.status === 422) {
                    const lineInfo = startLine && startLine < endLine
                        ? `Lines ${startLine}-${endLine}`
                        : `Line ${endLine}`;
                    this.context.log(`[GitHub] ${lineInfo} for file ${path} not in diff, posting as file-level comment`);
                    await this.octokit.issues.createComment({
                        owner: this.owner,
                        repo: this.repo,
                        issue_number: this.prNumber,
                        body: `**File: ${path}** (${lineInfo} not in diff, posting as file-level comment)\n\n${comment}`,
                    });
                } else {
                    throw error; // Re-throw other errors
                }
            }
        } else {
            // General file-level comment
            await this.octokit.issues.createComment({
                owner: this.owner,
                repo: this.repo,
                issue_number: this.prNumber,
                body: `**File: ${path}**\n\n${comment}`,
            });
        }
    }

    async setFinalStatus(status: ReviewStatus): Promise<void> {
        const eventMap: Record<ReviewStatus, "APPROVE" | "REQUEST_CHANGES" | "COMMENT"> = {
            'approved': "APPROVE",
            'changes_requested': "REQUEST_CHANGES",
            'commented': "COMMENT"
        };

        const body = status === 'approved'
            ? `✅ Pull Request approved by **${env.GITHUB_REVIEWER_NAME}**.`
            : status === 'changes_requested'
                ? `🔴 Major issues found by **${env.GITHUB_REVIEWER_NAME}**. Please address the feedback.`
                : `🟡 Suggestions provided by **${env.GITHUB_REVIEWER_NAME}** for improvement.`;

        await this.octokit.pulls.createReview({
            owner: this.owner,
            repo: this.repo,
            pull_number: this.prNumber,
            event: eventMap[status],
            body: body,
        });
    }

    getPRIdentifier(): string {
        return `GitHub:${this.owner}/${this.repo}#${this.prNumber}`;
    }
}
