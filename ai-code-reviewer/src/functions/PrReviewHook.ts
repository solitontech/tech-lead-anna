import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import azdo, { postReview, setPrVote } from "../utils/azdoClient";
import { reviewWithAI } from "../utils/aiClient";
import { shouldIgnoreFile } from "../config/ignoreFiles";
import { cleanCodeContent } from "../utils/codeCleaner";
import { AzDoWebhookPayload, AzDoIterationsResponse, AzDoChangesResponse, AzDoReviewer } from "../types/azdo";
import { env } from "../config/envVariables";


const REVIEWER_NAME = env.REVIEWER_NAME;

/* ---------- Azure Function ---------- */
app.http("PrReviewHook", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        const payload = await req.json() as AzDoWebhookPayload;
        const eventType = payload.eventType;
        const prId = payload.resource.pullRequestId;

        context.log(`[EVENT] Received ${eventType} for PR ${prId}`);

        // Only process PR Updated (reviewer added) events
        const allowedEvents = ["git.pullrequest.updated"];
        if (!allowedEvents.includes(eventType)) {
            context.log(`[IGNORE] Event type ${eventType} is not in allowed list. Skipping.`);
            return { status: 200 };
        }

        const repoId = payload.resource.repository.id;
        const project = payload.resource.repository.project.name;

        // Fetch the latest PR details from the API to ensure we have the most accurate reviewers list and vote status
        const prRes = await azdo.get<any>(
            `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}?api-version=7.1`
        );
        const reviewers = prRes.data.reviewers || [];

        const reviewer = reviewers.find((r: AzDoReviewer) => r.displayName === REVIEWER_NAME);
        const reviewerId = reviewer?.id;
        const currentVote = reviewer?.vote || 0;

        context.log(`[VOTE CHECK] ${REVIEWER_NAME}'s current vote: ${currentVote}`);

        if (!reviewer) {
            context.log(`[IGNORE] ${REVIEWER_NAME} not requested/present in reviewers. Skipping.`);
            return { status: 200 };
        }

        // If the reviewer has already voted, they have already reviewed this version of the code.
        if (currentVote !== 0) {
            context.log(`[IGNORE] ${REVIEWER_NAME} has already voted (${currentVote}). Skipping to prevent loop.`);
            return { status: 200 };
        }

        // Set a preliminary vote to 'lock' the PR and prevent race conditions from concurrent webhooks
        try {
            context.log(`[VOTE] Setting preliminary 'Waiting for Author' vote to lock the process for ${REVIEWER_NAME}.`);
            await setPrVote(project, repoId, prId, reviewerId!, -5);
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

                const { cleanedContent, lineMap } = cleanCodeContent(content, path);
                const cleanedLineCount = cleanedContent.split('\n').length;
                if (cleanedContent.length !== content.length) {
                    context.log(`  Cleaned ${path}: ${lineCount} -> ${cleanedLineCount} lines (${cleanedContent.length} chars)`);
                }

                if (cleanedLineCount > 1000) {
                    hasRedFlags = true;
                    // For red flags, we just post a top-level file comment
                    await postReview(project, repoId, prId, "🔴 **Architectural Red Flag**: This file exceeds 1000 lines. Please split it into smaller, more focused modules.", path);
                } else {
                    const aiReviews = await reviewWithAI(path, cleanedContent);

                    if (aiReviews.length > 0) {
                        hasIssues = true;
                        context.log(`Posting ${aiReviews.length} issues for ${path}`);

                        // Post each issue as a separate thread
                        for (const review of aiReviews) {
                            // Map the line number back to the original file
                            const originalLine = lineMap[review.line - 1] || review.line;
                            await postReview(project, repoId, prId, review.comment, path, originalLine);
                        }
                    } else {
                        context.log(`No issues found in ${path}`);
                    }
                }
            } catch (err: any) {
                context.log(`Error reviewing ${path}: ${err.message}`);
            }
            // Add a small delay between files to avoid hitting TPM limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // SET VOTE AFTER REVIEW
        if (reviewerId) {
            let vote = 10; // Default: Approved (10)
            if (hasRedFlags) {
                vote = -5; // Waiting for author
            } else if (hasIssues) {
                vote = 5; // Approved with suggestions
            }

            try {
                context.log(`[VOTE] Setting PR vote to ${vote} (Flags: ${hasRedFlags}, Issues: ${hasIssues})`);
                await setPrVote(project, repoId, prId, reviewerId, vote);
            } catch (voteErr: any) {
                context.log(`[VOTE] Failed to set vote: ${voteErr.message}`);
            }
        }

        return { status: 200 };
    }
});

