export interface FileChange {
    path: string;
    commitId: string;
    isFolder?: boolean;
}

export type ReviewStatus = 'approved' | 'changes_requested' | 'commented';

export interface PlatformAdapter {
    validateWebhook(): Promise<boolean>;
    shouldProcessPR(): Promise<boolean>;
    lockPR(): Promise<void>;
    getChangedFiles(): Promise<FileChange[]>;
    getFileContent(path: string, commitId: string): Promise<string>;
    postComment(path: string, line: number | undefined, comment: string): Promise<void>;
    setFinalStatus(status: ReviewStatus): Promise<void>;
    getPRIdentifier(): string;
}
