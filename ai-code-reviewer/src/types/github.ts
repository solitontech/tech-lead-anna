/**
 * Simple GitHub Webhook Payload types
 */
export interface GitHubWebhookPayload {
    action: string;
    pull_request: {
        number: number;
        head: {
            sha: string;
        };
        base: {
            repo: {
                owner: {
                    login: string;
                };
                name: string;
            };
        };
    };
    repository: {
        owner: {
            login: string;
        };
        name: string;
    };
    installation: {
        id: number;
    };
}
