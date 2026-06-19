# GitHub Agentic Workflows

This document explains how the GitHub Actions agentic workflows automatically generate and maintain tests whenever feature files are created or modified.

---

## Overview

The framework uses **GitHub Agentic Workflows (gh-aw)** — a GitHub Actions extension that runs AI agents (powered by GitHub Copilot) directly inside a sandboxed CI environment. These workflows turn every feature file push into a fully automated test generation event.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AUTOMATED TEST GENERATION PIPELINE               │
│                                                                     │
│  Developer writes     Push to      GitHub Action     AI Agent       │
│  feature file    ───► GitHub  ───► triggers      ───► explores app  │
│                                                        │            │
│  Human reviews  ◄─── PR opened ◄─── Step files ◄──── generates     │
│  and merges PR         by agent       written         TypeScript    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Workflow: test-generator

### Source File
`.github/workflows/test-generator.md`

This is the **human-editable** workflow definition written in Markdown with YAML frontmatter. Editing this file and running `gh aw compile` regenerates the actual `.lock.yml` workflow.

> **Important:** Never edit `test-generator.lock.yml` directly — it is auto-compiled and will be overwritten.

### Triggers

The workflow starts automatically in two situations:

#### 1. Push to any branch (except `test-gen/**`)

Triggered when any file matching `features/**/*.feature` is added or modified:

```yaml
on:
  push:
    branches-ignore:
      - 'test-gen/**'        # prevents recursive triggers
    paths:
      - 'features/**/*.feature'
```

**When this fires:**
- A developer pushes a new feature file
- A developer modifies an existing feature file (adds/removes scenarios)
- A PR is merged that contains feature file changes

#### 2. Manual dispatch

Any team member can trigger it from the GitHub Actions UI:

- Go to **Actions** → **test-generator**
- Click **Run workflow**
- Optionally specify a single feature file, or leave blank to process all recently changed features

### What the Agent Does (Step by Step)

```
1. SETUP
   ├── npm ci (install dependencies)
   └── npx playwright-cli install-browser (install headless Chromium)

2. DRY RUN
   └── npx cucumber-js --dry-run <feature-file>
       └── identifies which steps are Undefined

3. FEATURE ANALYSIS
   └── reads the .feature file
       └── maps each step to a page name

4. APP EXPLORATION (for each identified page)
   ├── navigates to the page URL via playwright-cli
   ├── takes an accessibility snapshot
   ├── extracts ARIA roles, names, labels
   └── verifies locator uniqueness

5. CODE GENERATION (for each page)
   ├── creates/updates steps/pages/<pagename>.page.steps.ts
   ├── writes locator factory functions at the top
   ├── writes Given/When/Then step implementations
   └── skips any steps already defined elsewhere

6. PULL REQUEST
   ├── commits all generated files to a new branch: test-gen/<name>-<timestamp>
   ├── opens a pull request with title: [test-gen] <feature-file>
   └── applies labels: automated-tests, agentic
```

### Security Model

The workflow enforces strict security boundaries:

| Control | Value | Purpose |
|---|---|---|
| `permissions: contents` | `read` | Cannot push code directly to the repo |
| `permissions: pull-requests` | `read` | Can read existing PRs but not merge them |
| File writes | via GitHub MCP `create_or_update_file` API | All changes go through the GitHub API, not git CLI |
| Network firewall | Explicit `network.allowed` list | Agent can only reach your app's domain |
| Branch isolation | `test-gen/**` branches | Generated code never lands on `main` without human approval |

**The agent cannot:**
- Run `git commit`, `git push`, or any git write commands
- Reach the internet beyond the configured allowed domains
- Merge its own pull request
- Modify feature files

### Protected Files Policy

The workflow uses `protected-files: fallback-to-issue`:
- If a step file already has **human edits** that conflict with the generated output, the agent creates a **GitHub issue** instead of overwriting the file
- The issue describes the conflict and what new steps need to be added

---

## Workflow: agentics-maintenance

### Source File
`.github/workflows/agentics-maintenance.yml`

An auto-generated maintenance workflow that runs daily. It handles:
- Updating agent workflow definitions when new versions are available
- Cleaning up expired discussions/issues
- Updating pull request branches when they fall behind
- Generating activity reports

This workflow runs automatically — no user action required.

---

## Agent Definitions

### `.github/agents/test-generator.agent.md`

The agent instruction set for the Test Definition Generator. This file defines:
- The agent's persona and primary goal
- Detailed step-by-step workflow instructions
- Rules for locator discovery and quality
- Code generation patterns and conventions
- Error handling and recovery procedures

This is also the agent file used by the **VS Code custom agent** `@Test Definition Generator`.

### `.github/agents/test-healer.agent.md`

The agent instruction set for the Test Healer. This file defines:
- The failure classification system
- Locator exploration strategy
- Rules for what the agent may and may not change
- Verification steps after applying fixes

This is also the agent file used by the VS Code custom agent `@Test Healer`.

---

## Pull Request Workflow

After the test-generator runs, the team follows this review process:

```
[test-gen] empmgmt.feature — PR #42
│
├── Files changed:
│   ├── steps/pages/login.page.steps.ts       (new or updated)
│   ├── steps/pages/dashboard.page.steps.ts   (new or updated)
│   ├── steps/pages/pim.page.steps.ts         (new or updated)
│   └── steps/pages/add-employee.page.steps.ts (new or updated)
│
├── Review checklist:
│   ✅ All feature steps have an implementation
│   ✅ Locators use getByRole / getByLabel (ARIA-based)
│   ✅ Then steps include expect() assertions
│   ✅ No duplicate step definitions
│   ✅ No page classes or helper objects introduced
│
└── Merge → tests run on next CI pipeline execution
```

---

## Configuring the Workflow for Your App

To adapt the `test-generator` workflow for a different application:

### 1. Update the allowed domain

In `.github/workflows/test-generator.md`, change:
```yaml
network:
  allowed:
    - your-app-domain.example.com
```

### 2. Update the base URL

In the `pre-agent-steps` section:
```yaml
pre-agent-steps:
  - name: Set APP_URL
    run: |
      echo "APP_URL=https://your-app-domain.example.com/" >> "$GITHUB_ENV"
```

Also update `cucumber.js`:
```javascript
worldParameters: {
  baseUrl: 'https://your-app-domain.example.com/',
},
```

### 3. Recompile the workflow

After editing the `.md` source file:
```bash
gh aw compile
```

This regenerates `.github/workflows/test-generator.lock.yml`.

---

## Local vs CI Agents — Comparison

| Aspect | VS Code Agent (Local) | GitHub Agentic Workflow (CI) |
|---|---|---|
| Invocation | `@Test Definition Generator` in chat | Push to `features/` or manual dispatch |
| Browser | Playwright MCP server (`localhost:3000`) | `playwright-cli` installed in CI |
| File writes | Direct to workspace files | Via GitHub MCP API → PR branch |
| Network | Your local network | Firewall-restricted to `network.allowed` |
| Output | Files written immediately | Pull request opened for review |
| Best for | Active development, quick iteration | Team collaboration, code review |
| Requires | MCP server running locally | GitHub Actions + Copilot enabled |

---

## Troubleshooting Workflow Failures

### Workflow doesn't trigger on push

Check that your push is to a branch not matching `test-gen/**` and that the modified file is inside `features/**/*.feature`.

### Agent can't reach the app

The app's domain must be listed in `network.allowed`. Check the workflow logs for `blocked by firewall` errors.

### PR not created — "No remote refs" error

This happens if someone added a `git commit` or `git push` command to the agent instructions. The workflow has `contents: read` only. All file writes must go through the `create_or_update_file` GitHub MCP tool. Remove any git write commands from the agent instructions.

### Step file conflict — issue created instead of PR

The agent detected existing human edits that conflict with the generated output. Review the created issue, manually merge the new steps into the existing file, then close the issue.

### `playwright-cli` install fails in CI

Check the Node.js version. Run `npx playwright-cli --version` locally to verify the package is available, then check that `pre-agent-steps` in the workflow includes both `npm ci` and `npx playwright-cli install-browser`.
