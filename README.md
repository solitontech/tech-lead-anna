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
| **`LoggerService.ts`** | Unified logging utility directly to Azure InvocationContext with support for tags and log levels. |

---

## Observability & Logging

Tech Lead Anna uses a centralized `LoggerService` that ties directly into Azure's `InvocationContext`. This ensures that all logs, warnings, and errors are captured cleanly in **Azure Application Insights** or the Azure Portal Log Stream.

- **Contextual Logging**: Every log entry is prefixed with a timestamp, severity level (`INFO`, `WARN`, `ERROR`, `DEBUG`), and a context tag (e.g., `[REVIEW]`, `[AI]`, `[FILES]`).
- **Debugging**: Enable verbose logging by setting the `DEBUG=true` environment variable.

---

## Configuration (Environment Variables)

| Variable | Description |
| :--- | :--- |
| `AI_PROVIDER` | `openai`, `anthropic` (or `claude`), or `google` (or `gemini`). |
| `AI_API_KEY` | Your API key for the selected AI provider. |
| `AI_MODEL` | The specific model to use (e.g., `gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`). |
| `AI_REVIEW_GUIDELINES`| (Optional) Filename in the repo root containing custom rules (e.g., `.ai-review-rules.md`). Defaults to senior tech lead guidelines if not found. |
| `DEBUG` | (Optional) Set to `true` to enable verbose debug-level logging. Useful for troubleshooting. |

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

#### Prerequisites
- **Azure Subscription**: Active Azure account with permissions to create resources
- **Visual Studio Code**: Latest version
- **VS Code Extensions**: 
  - **Azure Functions** extension (by Microsoft)
  - **Azure Resources** extension (by Microsoft) - usually installed automatically with Azure Functions extension
- **Node.js**: Version 18.x or higher (Azure Functions runtime requirement)
- **Azure Functions Core Tools**: Install via `npm install -g azure-functions-core-tools@4`

#### Step 1: Install VS Code Azure Extensions

1. Open **Visual Studio Code**
2. Go to **Extensions** (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for **"Azure Functions"**
4. Click **"Install"** on the "Azure Functions" extension by Microsoft
5. This will also install the Azure Account and Azure Resources extensions
6. After installation, you'll see an **Azure icon** (A) in the left sidebar

#### Step 2: Sign in to Azure (in VS Code)

1. Click the **Azure icon** in the VS Code sidebar
2. In the **Resources** section, click **"Sign in to Azure..."**
3. A browser window will open for authentication
4. Sign in with your Azure account credentials
5. After successful login, close the browser and return to VS Code
6. You should now see your Azure subscriptions in the sidebar

#### Step 3: Create Azure Function App (Using Azure Portal)

1. Navigate to [Azure Portal](https://portal.azure.com)
2. Click **"Create a resource"** → Search for **"Function App"**
3. Click **"Create"** and fill in the details:

   **Basics Tab:**
   - **Subscription**: Select your subscription
   - **Resource Group**: Create new or use existing (e.g., `rg-tech-lead-anna`)
   - **Function App Name**: Choose a globally unique name (e.g., `tech-lead-anna-prod`)
   - **Do you want to deploy code or container image?**: Select **Code**
   - **Runtime Stack**: Select **Node.js**
   - **Version**: Select **18 LTS** or higher
   - **Region**: Choose a region close to your DevOps infrastructure (e.g., East US, West Europe)
   - **Operating System**: **Linux** (recommended for Node.js)
   
   **Hosting Tab:**
   - **Plan Type**: 
     - **Consumption (Serverless)**: Pay-per-execution, auto-scaling (recommended for most cases)
     - **Premium**: For faster cold starts and VNet integration
     - **App Service Plan**: For dedicated resources
   - **Storage Account**: Create new or select existing
     - If creating new, use a name like `techleadannastorage` (lowercase, no hyphens)

   **Monitoring Tab:**
   - **Enable Application Insights**: **Yes** (highly recommended)
   - **Application Insights**: Create new or select existing
     - If creating new, use default name or customize (e.g., `tech-lead-anna-insights`)

4. Click **"Review + Create"**
5. Review your configuration and click **"Create"**
6. Wait for deployment to complete (typically 2-3 minutes)
7. Click **"Go to resource"** when deployment completes

#### Step 4: Deploy Your Code (Using VS Code)

Now that the Function App exists in Azure, deploy your code from VS Code:

1. In VS Code, open the `ai-code-reviewer` folder
2. Click the **Azure icon** in the sidebar
3. In the **Resources** section, expand your subscription → **Function App**
4. You should see your newly created Function App (e.g., `tech-lead-anna-prod`)
5. Right-click on your Function App → **"Deploy to Function App..."**
6. Confirm the deployment when prompted:
   - VS Code may ask: "Are you sure you want to deploy to [your-app-name]?"
   - Click **"Deploy"**
7. VS Code will:
   - Build your TypeScript code (`npm run build`)
   - Package the application
   - Upload to Azure
   - Configure the runtime
8. Monitor the **Output** panel (View → Output → Azure Functions) for deployment progress
9. You'll see a notification when deployment completes successfully: "Deployment to [your-app-name] completed"

#### Step 5: Configure Environment Variables (Using VS Code)

1. In Azure Portal, go to **Settings** → **Environment variables** (or **Configuration**)
2. Click **"+ New application setting"** for each variable:

### Connecting to Azure DevOps

#### Step 1: Create Personal Access Token (PAT)

1. Navigate to your Azure DevOps organization: `https://dev.azure.com/{YourOrgName}`
2. Click on your **User Settings** icon (top right) → **Personal access tokens**
3. Click **"+ New Token"**
4. Configure the token:
   - **Name**: `Tech Lead Anna - Code Reviewer`
   - **Organization**: Select your organization
   - **Expiration**: Choose an appropriate duration (e.g., 90 days, 1 year, or custom)
   - **Scopes**: Click **"Show all scopes"** and select:
     - ✅ **Code** → **Read** (to fetch PR files and diffs)
     - ✅ **Code** → **Status** (to read PR status)
     - ✅ **Code** → **Write** (to post review comments)
     - ✅ **Pull Request Threads** → **Read & Write** (to create and manage comment threads)
5. Click **"Create"**
6. **IMPORTANT**: Copy the token immediately and store it securely (e.g., in a password manager)
   - You won't be able to see it again
   - This is the value for your `AZDO_PAT` environment variable

#### Step 2: Configure Service Hook in Azure DevOps

Service Hooks allow Azure DevOps to send webhook notifications to your Azure Function when PR events occur.

1. Navigate to your Azure DevOps **Project**
2. Go to **Project Settings** (bottom left corner)
3. Under **General**, click **Service hooks**
4. Click **"+ Create subscription"**

#### Step 3: Select Service Type

1. In the "New Service Hooks Subscription" dialog, select **Web Hooks**
2. Click **"Next"**

#### Step 4: Configure Trigger Event

1. **Trigger on this type of event**: Select **"Pull request updated"**
2. Configure filters to control when the webhook fires:
3. Click **"Next"**

#### Step 5: Configure Action (Webhook URL)

1. **URL**: Enter your Azure Function endpoint
   ```
   https://<function-app-name>.azurewebsites.net/api/PrReviewHook
   ```
   - Replace `<function-app-name>` with your actual Function App name
   - Get this URL from Azure Portal → Function App → Functions → PrReviewHook → "Get Function URL"

2. Click **"Finish"** to create the subscription

#### Step 6: Verify Service Hook Configuration

1. Back in the **Service hooks** page, you should see your new subscription
2. Click on it to view details
3. Check the **History** tab to see webhook delivery attempts
4. Look for:
   - ✅ **Succeeded** status (green checkmark)
   - ❌ **Failed** status indicates issues (click to see error details)

#### Step 7: Test the Integration

**Method 1: Add Reviewer to Existing PR**
1. Open any Pull Request in your Azure DevOps repository
2. Click **"Add reviewer"**
3. Search for and add a user/group named **"Tech Lead Anna"** (or the name matching `AZDO_REVIEWER_NAME`)
   - **Note**: You may need to create a dummy user or use a specific identifier
   - Alternatively, configure the service hook to trigger on other events (e.g., PR creation)
4. Monitor your Azure Function logs:
   - Azure Portal → Function App → Monitoring → Log stream
   - Or Application Insights → Live Metrics
5. Within 1-2 minutes, you should see:
   - Webhook received
   - PR files fetched
   - AI analysis initiated
   - Comments posted to the PR

### Connecting to GitHub (as an App)
1.  **Create App**: Go to Developer Settings > GitHub Apps > New GitHub App.
2.  **Permissions**: Set `Pull Requests: Read & Write` and `Contents: Read`.
3.  **Webhook**: Point the App's webhook to `https://<your-app>.azurewebsites.net/api/GitHubReviewHook`.
4.  **Install**: Install the app on your desired organizations or repositories.

---

## Custom Review Guidelines
You can customize the reviewer's behavior per repository without changing any environment variables:
1.  Set `AI_REVIEW_GUIDELINES` to a filename like `.ai-rules.md`.
2.  Add that file to your repository root.
3.  Tech Lead Anna will fetch this file at runtime use those instructions.
4.  If no custom instructions are provided, then the AI reviewer will use the default instructions provided in the `reviewPromots.ts` file.

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