import { PlatformAdapter, FileChange, ReviewStatus } from "../interfaces/PlatformAdapter";
import { AzDoIterationsResponse, AzDoWebhookPayload } from "../types/azdo";
import azdo, { postReview, setPrVote } from "../utils/azdoClient";
import { env } from "../config/envVariables";

/**
 * Azure DevOps Platform Adapter
 */
export class AzDoAdapter implements PlatformAdapter {
    private project: string;
    private repoId: string;
    private prId: number;
    private reviewerId?: string;

    constructor(private payload: AzDoWebhookPayload) {
        this.project = payload.resource.repository.project.name;
        this.repoId = payload.resource.repository.id;
        this.prId = payload.resource.pullRequestId;
    }

    async validateWebhook(): Promise<boolean> {
        return this.payload.eventType === "git.pullrequest.updated";
    }

    async shouldProcessPR(): Promise<boolean> {
        const encodedProject = encodeURIComponent(this.project);
        const prRes = await azdo.get<any>(
            `/${encodedProject}/_apis/git/repositories/${this.repoId}/pullRequests/${this.prId}?api-version=7.1`
        );
        const reviewers = prRes.data.reviewers || [];
        const reviewer = reviewers.find((r: any) => r.displayName === env.AZDO_REVIEWER_NAME);

        if (!reviewer) return false;

        this.reviewerId = reviewer.id;
        // Process only if not voted yet (vote === 0)
        return reviewer.vote === 0;
    }

    async lockPR(): Promise<void> {
        if (!this.reviewerId) throw new Error("Reviewer not identified");
        await setPrVote(this.project, this.repoId, this.prId, this.reviewerId, -5); // Waiting for author
    }

    async getChangedFiles(): Promise<FileChange[]> {
        const encodedProject = encodeURIComponent(this.project);
        const iterationsRes = await azdo.get<AzDoIterationsResponse>(
            `/${encodedProject}/_apis/git/repositories/${this.repoId}/pullRequests/${this.prId}/iterations?api-version=7.1`
        );

        if (!iterationsRes.data.value?.length) return [];

        const latestIteration = iterationsRes.data.value.slice(-1)[0];
        const latestIterationId = latestIteration.id;
        const commitId = latestIteration.sourceRefCommit.commitId;

        const changesRes = await azdo.get<any>(
            `/${encodedProject}/_apis/git/repositories/${this.repoId}/pullRequests/${this.prId}/iterations/${latestIterationId}/changes?api-version=7.1`
        );

        const changes = changesRes.data.changes || changesRes.data.value || changesRes.data.changeEntries || [];
        return changes
            .filter((c: any) => !c.item?.isFolder)
            .map((c: any) => ({
                path: c.item.path,
                commitId: commitId
            }));
    }

    async getFileContent(path: string, commitId: string): Promise<string> {
        const encodedProject = encodeURIComponent(this.project);
        const res = await azdo.get<any>(
            `/${encodedProject}/_apis/git/repositories/${this.repoId}/items`,
            {
                params: {
                    path,
                    includeContent: true,
                    versionDescriptor: {
                        versionType: "Commit",
                        version: commitId
                    }
                }
            }
        );
        return res.data.content || "";
    }

    async postComment(path: string, line: number | undefined, comment: string): Promise<void> {
        await postReview(this.project, this.repoId, this.prId, comment, path, line);
    }

    async setFinalStatus(status: ReviewStatus): Promise<void> {
        if (!this.reviewerId) return;

        const voteMap: Record<ReviewStatus, number> = {
            'approved': 10,
            'commented': 5,
            'changes_requested': -5
        };

        const vote = voteMap[status];
        await setPrVote(this.project, this.repoId, this.prId, this.reviewerId, vote);
    }

    getPRIdentifier(): string {
        return `AzDo:${this.project}/${this.prId}`;
    }
}
