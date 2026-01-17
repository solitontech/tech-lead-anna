import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import axios from "axios";
import OpenAI from "openai";
import { systemPrompt, getUserPrompt } from "../prompts/reviewPrompts";
import { AzDoWebhookPayload, AzDoIterationsResponse, AzDoChangesResponse, AzDoReviewer } from "../types/azdo";

/* ---------- Azure DevOps client ---------- */
const azdo = axios.create({
    baseURL: process.env.AZDO_ORG_URL,
    auth: {
        username: "",
        password: process.env.AZDO_PAT!
    }
});

/* ---------- OpenAI client ---------- */
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/* ---------- Azure Function ---------- */
app.http("PrReviewHook", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        const payload = await req.json() as AzDoWebhookPayload;

        const reviewers = payload?.resource?.reviewers ?? [];
        const annaRequested = reviewers.some(
            (r: AzDoReviewer) => r.displayName === "Tech Lead Anna"
        );

        if (!annaRequested) {
            context.log("Tech Lead Anna not requested. Ignoring event.");
            return { status: 200 };
        }

        const prId = payload.resource.pullRequestId;
        const repoId = payload.resource.repository.id;
        const project = payload.resource.repository.project.name;

        context.log(`Reviewing PR ${prId} in project ${project}`);

        const diff = await getPullRequestDiff(project, repoId, prId);
        const review = await reviewWithAI(diff);
        await postReview(project, repoId, prId, review);

        return { status: 200 };
    }
});

/* ---------- Helpers ---------- */

async function getPullRequestDiff(
    project: string,
    repoId: string,
    prId: number
): Promise<string> {

    const iterationsRes = await azdo.get<AzDoIterationsResponse>(
        `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations?api-version=7.1`
    );

    const latestIterationId = iterationsRes.data.value.slice(-1)[0].id;

    const changesRes = await azdo.get<AzDoChangesResponse>(
        `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations/${latestIterationId}/changes?api-version=7.1`
    );

    let combined = "";

    for (const change of changesRes.data.changes) {
        if (change.item?.isFolder) continue;

        const path = change.item.path;

        const fileRes = await azdo.get(
            `/${project}/_apis/git/repositories/${repoId}/items`,
            {
                params: {
                    path,
                    includeContent: true,
                    versionDescriptor: {
                        versionType: "Branch",
                        version: `refs/pull/${prId}/merge`
                    },
                    "api-version": "7.1"
                }
            }
        );

        combined += `\n\nFILE: ${path}\n${fileRes.data}`;
    }

    return combined.slice(0, 12000); // token safety
}

async function reviewWithAI(diff: string): Promise<string> {
    const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL!,
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: getUserPrompt(diff)
            }
        ]
    });

    return completion.choices[0].message.content ?? "No feedback.";
}

async function postReview(
    project: string,
    repoId: string,
    prId: number,
    review: string
) {
    await azdo.post(
        `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`,
        {
            comments: [
                {
                    parentCommentId: 0,
                    content: `### 🤖 Tech Lead Anna Review\n\n${review}`,
                    commentType: 1
                }
            ],
            status: 1
        }
    );
}
