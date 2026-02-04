# Tech Lead Anna - AI Code Reviewer

An intelligent, automated code reviewer built as an Azure Function. It provides architectural insights, catches potential issues, and ensures code quality for **Azure DevOps (AzDo)** and **GitHub** Pull Requests using LLMs like **OpenAI (GPT)**, **Anthropic (Claude)**, and **Google (Gemini)**.

## Overview

Tech Lead Anna acts as a senior reviewer in your PRs. She:
-   **Analyze changes** in real-time when a PR is opened or updated.
-   **Catches Architectural Red Flags** (e.g., massive files > 1000 lines).
-   **Provides Line-Level Feedback** directly on the code.
-   **Supports Multiple AI Providers** out of the box.
-   **Minimizes Noise** by ignoring binaries, assets, and documentation blocks.

---

## Technical Breakdown

The application follows an **Adapter Pattern** for easy extension to new platforms:

| Module | Description |
| :--- | :--- |
| **`ReviewService.ts`** | Core, platform-agnostic review orchestration logic. |
| **`PlatformAdapter.ts`** | Interface defining how to interact with a code host. |
| **`AzDoAdapter.ts`** | Adapter for Azure DevOps REST API. |
| **`GitHubAdapter.ts`** | Adapter for GitHub App API (using Octokit). |
| **`aiClient.ts`** | Handles multi-LLM communication (OpenAI, Claude, Gemini). |
| **`codeCleaner.ts`** | Strips out noisy comments for architectural analysis. |
| **`reviewPrompts.ts`** | Defines the "Tech Lead" persona and review guidelines. |

---

## Configuration (Environment Variables)

| Variable | Description |
| :--- | :--- |
| `AI_PROVIDER` | `openai`, `anthropic` (or `claude`), or `google` (or `gemini`). |
| `AI_API_KEY` | Your API key for the selected AI provider. |
| `AI_MODEL` | The specific model to use (e.g., `gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`). |
| `AI_REVIEW_GUIDELINES`| (Optional) Filename in the repo root containing custom rules (e.g., `.ai-review-rules.md`). Defaults to senior tech lead guidelines if not found. |

### Azure DevOps Specifics
| Variable | Description |
| :--- | :--- |
| `AZDO_ORG_URL` | Your AzDo Org URL (e.g., `https://dev.azure.com/YourOrg`). |
| `AZDO_PAT` | Personal Access Token with Code/Threads Read & Write permissions. |
| `AZDO_REVIEWER_NAME` | The display name used for AzDo reviewer identification (e.g., `Tech Lead Anna`). Falls back to `REVIEWER_NAME` if not set. |

### GitHub Specifics
| Variable | Description |
| :--- | :--- |
| `GITHUB_APP_ID` | Your GitHub App's ID. |
| `GITHUB_APP_PRIVATE_KEY` | Your GitHub App's private key (PEM format). Use `\\n` for newlines if setting as a single-line string. |
| `GITHUB_REVIEWER_NAME` | The display name/slug used for GitHub reviewer identification (e.g., `tech-lead-anna`). Falls back to `REVIEWER_NAME` if not set. |

---

## Deployment Guide

### Azure Function Setup
1.  **Deploy to Azure**: `func azure functionapp publish <Your-App-Name>`
2.  **Set Configuration**: Add the environment variables above in the Azure Portal.

### Connecting to Azure DevOps
1.  **Service Hook**: Create a `Web Hook` for the `Pull request updated` event.
2.  **Filter**: Set to `Reviewers changed`.
3.  **URL**: `https://<your-app>.azurewebsites.net/api/PrReviewHook`

### Connecting to GitHub (as an App)
1.  **Create App**: Go to Developer Settings > GitHub Apps > New GitHub App.
2.  **Permissions**: Set `Pull Requests: Read & Write` and `Contents: Read`.
3.  **Webhook**: Point the App's webhook to `https://<your-app>.azurewebsites.net/api/GitHubReviewHook`.
4.  **Install**: Install the app on your desired organizations or repositories.

---

## Features In Detail

### Custom Review Guidelines
You can customize the reviewer's behavior per repository without changing any environment variables:
1.  Set `AI_REVIEW_GUIDELINES` to a filename like `.ai-rules.md`.
2.  Add that file to your repository root.
3.  Tech Lead Anna will fetch this file at runtime (matching the PR's commit) and prioritize those instructions.
4.  If the file is missing, she falls back to her high-standard "Software Architect" default persona.

---

## Local Development

1.  **Clone & Install**: `npm install`
2.  **Configure**: Create `ai-code-reviewer/local.settings.json` with all the env variables.
3.  **Build**: `npm run build`
4.  **Run**: `func start`

### Local Testing

To test the reviewer locally without triggering actual webhooks:

#### 1. Create Test Payload

Create a test payload file at `ai-code-reviewer/test-files/test-payload.json` with the appropriate format for your platform:

**For Azure DevOps:**
```json
{
    "eventType": "git.pullrequest.updated",
    "resource": {
        "pullRequestId": 123,
        "repository": {
            "id": "your-repo-id",
            "project": {
                "name": "Your Project Name"
            }
        },
        "reviewers": [
            {
                "id": "reviewer-id",
                "displayName": "Tech Lead Anna",
                "vote": 0
            }
        ]
    }
}
```

**For GitHub:**
```json
{
    "action": "opened",
    "pull_request": {
        "number": 123,
        "head": {
            "sha": "abc123def456"
        },
        "base": {
            "repo": {
                "owner": {
                    "login": "your-org"
                },
                "name": "your-repo"
            }
        }
    },
    "repository": {
        "owner": {
            "login": "your-org"
        },
        "name": "your-repo"
    },
    "installation": {
        "id": 12345678
    }
}
```

#### 2. Start the Function

```bash
cd ai-code-reviewer
npm run build
func start
```

#### 3. Trigger the Review

**For Azure DevOps:**
```bash
curl -X POST http://localhost:7071/api/PrReviewHook \
  -H "Content-Type: application/json" \
  --data @./ai-code-reviewer/test-files/test-payload.json
```

**For GitHub:**
```bash
curl -X POST http://localhost:7071/api/GitHubReviewHook \
  -H "Content-Type: application/json" \
  --data @./ai-code-reviewer/test-files/test-payload.json
```

#### 4. Monitor Output

Watch the terminal for logs showing:
- Webhook validation
- File retrieval
- AI analysis
- Comment posting

**Note:** Make sure your test payload references an actual PR in your configured Azure DevOps organization or GitHub repository, as the function will attempt to fetch real PR data.


---