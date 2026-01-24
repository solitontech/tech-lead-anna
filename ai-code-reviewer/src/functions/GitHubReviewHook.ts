import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { GitHubWebhookPayload } from "../types/github";
import { GitHubAdapter } from "../adapters/GitHubAdapter";
import { ReviewService } from "../services/ReviewService";

/**
 * GitHub Pull Request Review Hook
 */
app.http("GitHubReviewHook", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        try {
            const payload = await req.json() as GitHubWebhookPayload;
            context.log(`[GitHub] Received webhook for PR #${payload.pull_request.number}`);

            // Validation and adapter initialization
            const adapter = new GitHubAdapter(payload);
            const reviewService = new ReviewService(adapter);

            await reviewService.reviewPullRequest(context);

            return { status: 200, body: "Review completed." };
        } catch (error: any) {
            context.error(`[GitHub] Failed to process PR review: ${error.message}`);
            return { status: 500, body: error.message };
        }
    }
});
