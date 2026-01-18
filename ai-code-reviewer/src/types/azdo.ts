/**
 * Azure DevOps Webhook and API Types
 */

export interface AzDoWebhookPayload {
    subscriptionId: string;
    notificationId: number;
    id: string;
    eventType: string;
    publisherId: string;
    message: {
        text: string;
        html: string;
        markdown: string;
    };
    detailedMessage: {
        text: string;
        html: string;
        markdown: string;
    };
    resource: AzDoPullRequest;
    resourceVersion: string;
}

export interface AzDoPullRequest {
    pullRequestId: number;
    status: string;
    title: string;
    description: string;
    sourceRefName: string;
    targetRefName: string;
    mergeStatus: string;
    lastMergeSourceCommit: {
        commitId: string;
        url: string;
    };
    lastMergeTargetCommit: {
        commitId: string;
        url: string;
    };
    lastMergeCommit: {
        commitId: string;
        url: string;
    };
    reviewers: AzDoReviewer[];
    repository: AzDoRepository;
}

export interface AzDoReviewer {
    reviewerUrl: string;
    vote: number;
    displayName: string;
    id: string;
    uniqueName: string;
    imageUrl: string;
    isContainer: boolean;
}

export interface AzDoRepository {
    id: string;
    name: string;
    url: string;
    project: {
        id: string;
        name: string;
        url: string;
        state: string;
        visibility: string;
        lastUpdateTime: string;
    };
}

export interface AzDoIteration {
    id: number;
    description: string;
    author: any;
    createdDate: string;
    updatedDate: string;
    sourceRefCommit: {
        commitId: string;
    };
}

export interface AzDoIterationsResponse {
    count: number;
    value: AzDoIteration[];
}

export interface AzDoChange {
    item: {
        objectId: string;
        originalObjectId: string;
        path: string;
        isFolder?: boolean;
        url: string;
    };
    changeType: string;
}

export interface AzDoChangesResponse {
    count: number;
    changes: AzDoChange[];
}
