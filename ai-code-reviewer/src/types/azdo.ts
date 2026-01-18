/**
 * Azure DevOps Webhook and API Types
 */

export interface AzDoWebhookPayload {
    eventType: string;
    resource: AzDoPullRequest;
}

export interface AzDoPullRequest {
    pullRequestId: number;
    reviewers: AzDoReviewer[];
    repository: AzDoRepository;
}

export interface AzDoReviewer {
    displayName: string;
}

export interface AzDoRepository {
    id: string;
    project: {
        name: string;
    };
}

export interface AzDoIteration {
    id: number;
    sourceRefCommit: {
        commitId: string;
    };
}

export interface AzDoIterationsResponse {
    value: AzDoIteration[];
}

export interface AzDoChange {
    item: {
        path: string;
        isFolder?: boolean;
    };
}

export interface AzDoChangesResponse {
    changes: AzDoChange[];
}
