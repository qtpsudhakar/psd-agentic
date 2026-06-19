# PSD Framework — Architecture

## Overview

The PSD (Page Step Definitions) framework is an AI-native test automation system. It replaces the traditional three-layer Page Object Model stack (test → page class → browser) with a flatter two-layer design where step definitions talk directly to Playwright.

```
┌───────────────────────────────────────────────────────────┐
│  TRADITIONAL POM (3 layers)                               │
│                                                           │
│  Feature File → Step Definition → Page Class → Browser   │
│                                    ^^^^^^^^^^^^           │
│                         maintenance burden lives here     │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│  PSD FRAMEWORK (2 layers)                                 │
│                                                           │
│  Feature File → Step Definition (IS the page) → Browser  │
│                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^         │
│                     AI generates & heals this             │
└───────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
psd-agentic/
│
├── features/                    # Gherkin feature files — human-authored test designs
│   └── empmgmt.feature
│
├── steps/
│   └── pages/                   # PSD step files — one per application page
│       ├── login.page.steps.ts
│       ├── dashboard.page.steps.ts
│       ├── pim.page.steps.ts
│       ├── add-employee.page.steps.ts
│       └── personal-details.page.steps.ts
│
├── support/
│   ├── world.ts                 # PSWorld — shared Playwright browser/page context
│   └── hooks.ts                 # Before/After hooks for browser lifecycle
│
├── .github/
│   ├── agents/                  # VS Code agent definitions (.agent.md)
│   │   ├── test-generator.agent.md
│   │   └── test-healer.agent.md
│   ├── workflows/               # GitHub Actions agentic workflows (.md source + .lock.yml compiled)
│   │   ├── test-generator.md    ← edit this
│   │   ├── test-generator.lock.yml  ← auto-compiled, do not edit
│   │   └── agentics-maintenance.yml
│   └── skills/                  # Reusable prompt skills
│
├── cucumber.js                  # Cucumber runner config (paths, baseUrl, timeouts)
├── tsconfig.json
└── package.json
```

---

## Core Components

### 1. Feature Files (`features/`)

Written by humans in plain Gherkin. Each feature file represents a user story or workflow. These files are the **sole source of truth** for what to test — they are never modified by agents.

```gherkin
Feature: End to End Employee Management

  Background:
    Given I navigate to the login page

  Scenario: End to End flow for adding emp
    When I login with valid credentials "testadmin" and "Vibetestq@123#"
    Then I should be redirected to the dashboard page
    When I click on the PIM link
    ...
```

### 2. Page Step Definition Files (`steps/pages/`)

One file per application page. Each file:
- Declares locator **factory functions** at the top (functions that return `Locator` objects)
- Implements Cucumber `Given`/`When`/`Then` step bindings below
- Has **no class**, **no constructor**, **no inheritance**

```typescript
// Locator factory functions — defined once, reused across steps
const usernameInput = (w: PSWorld) =>
  w.page.getByRole('textbox', { name: 'Username' }).describe('Username input field');

const loginButton = (w: PSWorld) =>
  w.page.getByRole('button', { name: 'Login' }).describe('Login submit button');

// Step definitions — directly use Playwright APIs
Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/auth/login');
  await expect(loginHeading(this)).toBeVisible();
});
```

**Naming convention:** `steps/pages/<pagename>.page.steps.ts`

### 3. PSWorld (`support/world.ts`)

The shared test context injected into every step via Cucumber's `this` binding. Provides:

| Property | Type | Purpose |
|---|---|---|
| `this.page` | `Page` | Playwright page — all browser interactions |
| `this.context` | `BrowserContext` | Browser context (cookies, storage) |
| `this.baseUrl` | `string` | Base URL loaded from `cucumber.js` worldParameters |

```typescript
export class PSWorld extends World {
  get page(): Page { ... }
  get context(): BrowserContext { ... }
  async initPlaywright(): Promise<void> { ... }
  async closeContext(): Promise<void> { ... }
}
```

### 4. Cucumber Config (`cucumber.js`)

Controls test execution. Key settings:

```javascript
module.exports = {
  default: {
    paths: ['features/**/*.feature'],     // which features to run
    require: ['support/world.ts', 'support/hooks.ts', 'steps/**/*.steps.ts'],
    worldParameters: {
      baseUrl: 'https://your-app.example.com/', // AUT base URL
    },
    timeout: 120000,    // step timeout in ms
    retry: 0,           // retries on failure
    parallel: 1,        // concurrent scenarios
  }
};
```

---

## Agent Architecture

The framework has two AI agents:

### Test Definition Generator Agent

**Purpose:** Given a feature file, generates all required `*.page.steps.ts` files from scratch.

**How it works:**
1. Runs `npx cucumber-js --dry-run` to find undefined steps
2. Reads the feature file to identify which pages are involved
3. Navigates each page in the live app using **Playwright MCP** (accessibility snapshot + DOM inspection)
4. Generates locator factory functions from real element data
5. Writes `steps/pages/<pagename>.page.steps.ts` files

**Invocation:**
- In VS Code: `@Test Definition Generator` in the Copilot chat
- In GitHub: automatic on push to `features/**/*.feature`, or manual via workflow dispatch

### Test Healer Agent

**Purpose:** Diagnoses and fixes failing step definitions without changing feature files or step signatures.

**How it works:**
1. Runs the feature file and reads `cucumber-report.json`
2. Identifies failures and classifies them (locator broken, assertion wrong, navigation error, etc.)
3. Opens the failing step definition at the exact failing line
4. Navigates the live app to find the correct locator or assertion value
5. Updates only the broken implementation — not the step signature

**Invocation:**
- In VS Code: `@Test Healer` in the Copilot chat
- On CI: triggered when a test run reports failures (manual workflow dispatch)

---

## GitHub Agentic Workflow Architecture

```
Developer pushes feature file
         │
         ▼
┌─────────────────────────┐
│  GitHub Actions trigger  │
│  test-generator workflow │
└─────────────┬───────────┘
              │
              ▼
┌─────────────────────────┐     ┌──────────────────────────┐
│  gh-aw agent sandbox    │────►│  Live app (allowed URLs)  │
│  - Copilot model        │◄────│  Playwright CLI browser   │
│  - GitHub MCP server    │     └──────────────────────────┘
│  - Firewall proxy       │
└─────────────┬───────────┘
              │  generates step files
              ▼
┌─────────────────────────┐
│  New branch: test-gen/* │
│  Commits step files     │
│  Opens pull request     │
│  Labels: automated-tests│
│          agentic        │
└─────────────────────────┘
              │
              ▼
         Human review
         & merge PR
```

**Security model:** The workflow runs with `contents: read` permissions. All file writes are done via the GitHub MCP server's `create_or_update_file` API — no direct git write commands are used.

**Network firewall:** The agent can only reach domains explicitly listed in the workflow's `network.allowed` list. All other outbound traffic is blocked.

---

## Data Flow: Test Execution

```
cucumber.js
    │  reads config
    ▼
cucumber-js runner
    │  loads
    ├── support/world.ts        (PSWorld class registered)
    ├── support/hooks.ts        (Before: initPlaywright, After: closeContext)
    └── steps/**/*.steps.ts     (all step definitions registered)
    │
    │  for each scenario
    ▼
Before hook  →  PSWorld.initPlaywright()  →  chromium.launch() + newContext() + newPage()
    │
    ▼
Steps execute in order
    │  each step: this.page.goto() / fill() / click() / expect()
    ▼
After hook   →  PSWorld.closeContext()
    │
    ▼
Reports written:
  cucumber-report.html
  cucumber-report.json
  reports/rerun.txt
  allure-results/
```

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Test DSL | Gherkin / Cucumber | `@cucumber/cucumber` latest |
| Browser automation | Playwright | `playwright` latest |
| Language | TypeScript | `typescript` latest |
| Test assertions | Playwright Test expect | `@playwright/test` latest |
| Reporting | HTML report + Allure | built-in + `allure-cucumberjs` |
| Agent runtime (local) | VS Code Copilot Chat | `.agent.md` custom agents |
| Agent runtime (CI) | GitHub Agentic Workflows | `gh-aw` v0.79+ |
| Browser MCP (local) | Playwright MCP server | `http://localhost:3000/mcp` |
| Browser CLI (CI) | `playwright-cli` | installed in workflow pre-steps |
