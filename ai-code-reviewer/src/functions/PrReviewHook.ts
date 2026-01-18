import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import axios from "axios";
import OpenAI from "openai";
import { systemPrompt, getUserPrompt } from "../prompts/reviewPrompts";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { AzDoWebhookPayload, AzDoIterationsResponse, AzDoChangesResponse, AzDoReviewer } from "../types/azdo";

/* ---------- Azure DevOps client ---------- */
const azdo = axios.create({
    baseURL: process.env.AZDO_ORG_URL,
    auth: {
        username: "",
        password: process.env.AZDO_PAT!
    }
});

// Logging interceptor for debugging 404s
azdo.interceptors.request.use(config => {
    console.log(`[AzDo API Request] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    return config;
});

azdo.interceptors.response.use(
    response => response,
    error => {
        if (error.response) {
            console.error(`[AzDo API Error] Status: ${error.response.status}`);
            console.error(`[AzDo API Error] Resource: ${error.config.url}`);
            console.error(`[AzDo API Error] Data:`, error.response.data);
        }
        return Promise.reject(error);
    }
);


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

    const latestIteration = iterationsRes.data.value.slice(-1)[0];
    const latestIterationId = latestIteration.id;
    const commitId = latestIteration.sourceRefCommit.commitId;

    console.log(`Fetching changes for iteration ${latestIterationId} (Commit: ${commitId})...`);
    const changesRes = await azdo.get<any>(
        `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations/${latestIterationId}/changes?api-version=7.1`
    );

    const changes = changesRes.data.changes ||
        changesRes.data.value ||
        changesRes.data.changeEntries ||
        [];

    let combined = "";

    for (const change of changes) {
        if (change.item?.isFolder) continue;

        const path = change.item.path;

        if (shouldIgnoreFile(path)) {
            console.log(`Skipping ignored file: ${path}`);
            continue;
        }

        const fileRes = await azdo.get<string>(
            `/${project}/_apis/git/repositories/${repoId}/items`,
            {
                params: {
                    path,
                    includeContent: true,
                    versionDescriptor: {
                        versionType: "Commit",
                        version: commitId
                    },
                    "api-version": "7.1"
                },
                responseType: 'text'
            }
        );

        console.log(`Fetched ${path} (${fileRes.data.length} chars)`);
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
