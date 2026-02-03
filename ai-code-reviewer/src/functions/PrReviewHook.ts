import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AzDoWebhookPayload } from "../types/azdo";
import { AzDoAdapter } from "../adapters/AzDoAdapter";
import { ReviewService } from "../services/ReviewService";

/* ---------- Azure Function ---------- */
app.http("PrReviewHook", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        try {
            const payload = await req.json() as AzDoWebhookPayload;
            context.log(`[AzDo] Received webhook for PR ${payload.resource.pullRequestId}`);

            const adapter = new AzDoAdapter(payload);
            const reviewService = new ReviewService(adapter);

            await reviewService.reviewPullRequest(context);

            return { status: 200, body: "Review completed." };
        } catch (error: any) {
            context.error(`[AzDo] Failed to process PR review: ${error.message}`);
            return { status: 500, body: error.message };
        }
    }
});

