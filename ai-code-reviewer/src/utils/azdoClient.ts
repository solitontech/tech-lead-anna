import axios, { AxiosInstance } from "axios";
import { env } from "../config/envVariables";

/**
 * Azure DevOps Client Utility
 * Handles communication with Azure DevOps REST API
 */

const azdo: AxiosInstance = axios.create({
    baseURL: env.AZDO_ORG_URL,
    auth: {
        username: "",
        password: env.AZDO_PAT
    }
});

// Logging interceptor for debugging 404s and progress
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

/**
 * Post a review comment/thread to an Azure DevOps Pull Request
 */
export async function postReview(
    project: string,
    repoId: string,
    prId: number,
    content: string,
    filePath?: string,
    lineNumber?: number
) {
    const threadBody: any = {
        comments: [
            {
                parentCommentId: 0,
                content: content,
                commentType: 1
            }
        ],
        status: 1
    };

    if (filePath && lineNumber) {
        threadBody.threadContext = {
            filePath: filePath,
            rightFileStart: { line: lineNumber },
            rightFileEnd: { line: lineNumber }
        };
    } else if (filePath) {
        threadBody.threadContext = {
            filePath: filePath
        };
    }

    await azdo.post(
        `/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`,
        threadBody
    );
}

/**
 * Set the vote of a reviewer on a Pull Request
 */
export async function setPrVote(
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

export default azdo;
