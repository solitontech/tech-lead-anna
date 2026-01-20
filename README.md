# AI Code Reviewer (Tech Lead Anna)

An intelligent, automated code reviewer built as an Azure Function. It integrates with **Azure DevOps (AzDo)** Pull Requests to provide architectural insights, catch potential issues, and ensure code quality using **OpenAI (GPT)**.

## Overview

This tool acts as a "Software Architect" in your PRs. It listens for PR updates, fetches the changed files, cleans them (removing noise like Swagger docs while maintaining line mapping), and uses AI to post targeted review comments directly onto the relevant lines in Azure DevOps.

### Key Features
- **Architectural Red Flags**: Helps to catch red flags
- **Line-Level Accuracy**: Posts comments against the specific line in question
- **Smart Cleaning**: Strips out noisy documentation (Swagger, etc.) to save tokens without losing context.
- **Robust Integration**: Includes retry logic for rate limits and preliminary voting to prevent race conditions.
- **Flexibility**: The prompt can be easily edited to suit your project's needs.
---

## Technical Breakdown

The application is structured for modularity and maintainability:

| Module | Description |
| :--- | :--- |
| **`PrReviewHook.ts`** | The main Azure Function entry point. Orchestrates the webhook event, iteration fetching, and the review loop. |
| **`aiClient.ts`** | Manages OpenAI communication, retries, and severity mapping. |
| **`azdoClient.ts`** | Centralized client for Azure DevOps REST API, handling authentication, threading, and voting. |
| **`codeCleaner.ts`** | Pre-processes files to reduce token usage while generating a `lineMap` for accurate comment placement. |
| **`envVariables.ts`** | Centralized, validated environment variable configuration. |
| **`reviewPrompts.ts`** | Defines the "Software Architect" persona and specific review criteria. |
| **`ignoreFiles.ts`** | Strategy for skipping non-code files (images, binaries, etc.). |

---

## Deployment Guide: Soliton

If you are a member of the **Soliton** organization, "Tech Lead Anna" is already live and ready to join your PRs.

### Steps to Enable:
1.  Go to your Project in **Azure DevOps**.
2.  Navigate to **Project Settings** > **Service Hooks**.
3.  Click **+** (New Subscription) and select **Web Hooks**.
4.  **Trigger Event**: Choose `Pull request updated`.
5.  **Filter**: Set "Change" to `Reviewers changed`.
6.  **Action (URL)**:
    `https://ai-code-reviewer-atckafdffmcdcbbn.southindia-01.azurewebsites.net/api/PrReviewHook`
7.  **Finish**: You're done! "Tech Lead Anna" will now automatically review any PR where she is added as a reviewer.

*Note: The environment variables and PAT for "Tech Lead Anna" are already managed by Karthikeyan Balasubramanian.*

---

## Deployment Guide: External Organizations

To host your own version of the AI Reviewer, follow these steps:

### 1. Prerequisites
- An **Azure Subscription** to host the Function App.
- An **OpenAI API Key**.
- An **Azure DevOps Personal Access Token (PAT)** with "Code (Read & Write)" and "Threads (Read & Write)" permissions.

### 2. Infrastructure Setup
1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/YourOrg/ai-code-reviewer.git
    cd ai-code-reviewer
    ```
2.  **Deploy to Azure**:
    - Build and deploy using the Azure Functions Core Tools: `func azure functionapp publish <Your-App-Name>`
    - Or use the "Deploy to Azure" button if available in your CI/CD.

### 3. Configuration (Environment Variables)
Set the following variables in your Azure Function App's **Configuration**:

| Variable | Description |
| :--- | :--- |
| `AZDO_ORG_URL` | Your AzDo Org URL (e.g., `https://dev.azure.com/YourOrg`) |
| `AZDO_PAT` | The PAT for the bot account. |
| `OPENAI_API_KEY` | Your OpenAI API key. |
| `OPENAI_MODEL` | The model to use (e.g., `gpt-4o`). |
| `REVIEWER_NAME` | The display name of the bot account (e.g., "AI Architect"). |

### 4. Configure Webhooks
Follow the same steps as the Soliton guide above, but use the URL of **your own** deployed Azure Function.

---

## Development

If you are a developer looking to run or test the AI Reviewer locally, follow these steps:

### 1. Local Configuration
Azure Functions use a `local.settings.json` file for local environment variables. This file is git-ignored for security.

1.  Navigate to the `ai-code-reviewer` directory.
2.  Create a new file named `local.settings.json`.
3.  Add the following structure:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZDO_ORG_URL": "https://dev.azure.com/YourOrg",
    "AZDO_PAT": "your-personal-access-token",
    "OPENAI_API_KEY": "your-openai-api-key",
    "OPENAI_MODEL": "your-preferred-model",
    "REVIEWER_NAME": "your-reviewer-name",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true"
  }
}
```

### 2. Running Locally
Ensure you have the [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) installed.

```bash
cd ai-code-reviewer
npm install
npm run build
func start
```
Your function will now be running at `http://localhost:7071/api/PrReviewHook`.

> **Note**: After any code changes, you must rebuild the project using `npm run build` before the changes take effect in the running function.

### 3. Testing Locally
To test the function without triggering a real webhook from Azure DevOps, you can simulate a request using `curl`.

1. Create a directory for test data: `mkdir -p ai-code-reviewer/test-files`
2. Create a file named `test-payload.json` inside that folder with a sample Azure DevOps webhook payload.
3. While the function is running (`func start`), execute the following command:

```bash
curl -X POST http://localhost:7071/api/PrReviewHook \
  -H "Content-Type: application/json" \
  --data @./ai-code-reviewer/test-files/test-payload.json
```