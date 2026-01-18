import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import axios from "axios";
import OpenAI from "openai";
import { systemPrompt, getUserPrompt } from "../prompts/reviewPrompts";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { cleanCodeContent } from "../utils/codeCleaner";
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
        const eventType = payload.eventType;
        const prId = payload.resource.pullRequestId;

        context.log(`[EVENT] Received ${eventType} for PR ${prId}`);

        // Only process PR Updated (code push) events
        // Ignore comment events and other noisy updates
        const allowedEvents = ["git.pullrequest.updated"];
        if (!allowedEvents.includes(eventType)) {
            context.log(`[IGNORE] Event type ${eventType} is not in allowed list. Skipping.`);
            return { status: 200 };
        }

        const reviewers = payload?.resource?.reviewers ?? [];
        const annaReviewer = reviewers.find((r: AzDoReviewer) => r.displayName === "Tech Lead Anna");
        const annaReviewerId = annaReviewer?.id;
        const annaCurrentVote = annaReviewer?.vote || 0;

        context.log(`[VOTE CHECK] Anna's current vote: ${annaCurrentVote}`);

        if (!annaReviewer) {
            context.log("[IGNORE] Tech Lead Anna not requested/present in reviewers. Skipping.");
            return { status: 200 };
        }

        // If Anna has already voted, she has already reviewed this version of the code.
        if (annaCurrentVote !== 0) {
            context.log(`[IGNORE] Anna has already voted (${annaCurrentVote}). Skipping to prevent loop.`);
            return { status: 200 };
        }

        const repoId = payload.resource.repository.id;
        const project = payload.resource.repository.project.name;

        // Set a preliminary vote to 'lock' the PR and prevent race conditions from concurrent webhooks
        try {
            context.log(`[VOTE] Setting preliminary 'Waiting for Author' vote to lock the process.`);
            await setPrVote(project, repoId, prId, annaReviewerId!, -5);
        } catch (voteErr: any) {
            context.log(`[VOTE] Failed to set preliminary vote: ${voteErr.message}`);
        }

        context.log(`Reviewing PR ${prId} in project ${project} file by file`);

        let hasRedFlags = false;
        let hasIssues = false;
        const allReviews: string[] = [];

        const iterationsRes = await azdo.get<AzDoIterationsResponse>(
            `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations?api-version=7.1`
        );

        if (!iterationsRes.data.value?.length) {
            context.log("No iterations found. Skipping.");
            return { status: 200 };
        }

        const latestIteration = iterationsRes.data.value.slice(-1)[0];
        const latestIterationId = latestIteration.id;
        const commitId = latestIteration.sourceRefCommit.commitId;

        const changesRes = await azdo.get<any>(
            `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations/${latestIterationId}/changes?api-version=7.1`
        );

        const changes = changesRes.data.changes || changesRes.data.value || changesRes.data.changeEntries || [];

        for (const change of changes) {
            if (change.item?.isFolder) continue;

            const path = change.item.path;

            if (shouldIgnoreFile(path)) {
                context.log(`Skipping ignored file: ${path}`);
                continue;
            }

            try {
                const fileRes = await azdo.get<any>(
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
                        }
                    }
                );

                const content = fileRes.data.content || "";
                const lineCount = content.split('\n').length;
                context.log(`Fetched ${path} (${lineCount} lines, ${content.length} chars)`);

                const cleanedContent = cleanCodeContent(content, path);
                const cleanedLineCount = cleanedContent.split('\n').length;
                if (cleanedContent.length !== content.length) {
                    context.log(`  Cleaned ${path}: ${lineCount} -> ${cleanedLineCount} lines (${cleanedContent.length} chars)`);
                }

                let review: string;
                if (cleanedLineCount > 1000) {
                    hasRedFlags = true;
                    review = "⚠️ **Architectural Red Flag**: This file exceeds 1000 lines. Please split it into smaller, more focused modules to ensure maintainability and testability. A second round of review will be required after refactoring.";
                } else {
                    review = await reviewWithAI(path, cleanedContent);
                }

                if (!review.toUpperCase().includes("LGTM")) {
                    hasIssues = true;
                    context.log(`Adding feedback for ${path}`);
                    allReviews.push(`#### 📄 File: \`${path}\`\n\n${review}`);
                } else {
                    context.log(`No issues found in ${path}`);
                }
            } catch (err: any) {
                context.log(`Error reviewing ${path}: ${err.message}`);
            }
            // Add a small delay between files to avoid hitting TPM limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (allReviews.length > 0) {
            const combinedContent = `### 🤖 Tech Lead Anna Review Summary\n\n${allReviews.join('\n\n---\n\n')}`;
            context.log(`Posting combined review for PR ${prId}`);
            await postReview(project, repoId, prId, combinedContent);
        }

        // SET VOTE AFTER REVIEW
        if (annaReviewerId) {
            let vote = 10; // Default: Approved (10)
            if (hasRedFlags) {
                vote = -5; // Waiting for author
            } else if (hasIssues) {
                vote = 5; // Approved with suggestions
            }

            try {
                context.log(`[VOTE] Setting PR vote to ${vote} (Flags: ${hasRedFlags}, Issues: ${hasIssues})`);
                await setPrVote(project, repoId, prId, annaReviewerId, vote);
            } catch (voteErr: any) {
                context.log(`[VOTE] Failed to set vote: ${voteErr.message}`);
            }
        }

        return { status: 200 };
    }
});

/* ---------- Helpers ---------- */

async function reviewWithAI(fileName: string, content: string, attempt: number = 1): Promise<string> {
    try {
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL!,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: getUserPrompt(fileName, content)
                }
            ]
        });

        return completion.choices[0].message.content ?? "LGTM";
    } catch (err: any) {
        // If Rate Limit (429) and we haven't tried too many times
        if (err.status === 429 && attempt <= 3) {
            const jitter = Math.floor(Math.random() * 1000); // Up to 1s jitter
            const waitTime = (attempt * 2000) + jitter; // 2s + jitter, 4s + jitter...
            console.log(`Rate limit hit for ${fileName}. Retrying in ${waitTime}ms... (Attempt ${attempt})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return reviewWithAI(fileName, content, attempt + 1);
        }
        throw err;
    }
}

async function postReview(
    project: string,
    repoId: string,
    prId: number,
    content: string
) {
    await azdo.post(
        `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`,
        {
            comments: [
                {
                    parentCommentId: 0,
                    content: content,
                    commentType: 1
                }
            ],
            status: 1
        }
    );
}

async function setPrVote(
    project: string,
    repoId: string,
    prId: number,
    reviewerId: string,
    vote: number
) {
    const encodedProject = encodeURIComponent(project);
    await azdo.put(
        `/${encodedProject}/_apis/git/repositories/${repoId}/pullRequests/${prId}/reviewers/${reviewerId}?api-version=7.1`,
        { vote }
    );
}
