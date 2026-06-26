# PSD Framework — Standards

This document is the single source of truth for how tests are authored, structured, implemented, and maintained in this framework. All humans and AI agents must follow these standards.

---

## 1. Framework Philosophy

The PSD (Page Step Definitions) framework is built on one principle: **test design belongs in Gherkin, implementation belongs in step files, and nothing else is needed in between.**

The traditional Page Object Model introduces a three-layer stack:

```
Feature File → Step Definition → Page Class → Browser
                                  ^^^^^^^^^^^
                          maintenance burden lives here
```

The PSD framework removes the page class layer entirely:

```
Feature File → Step Definition (IS the page) → Browser
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                  AI generates and heals this
```

**Consequences of this principle:**
- There are no page object classes, no page constructors, no method wrappers, no base page classes.
- Step definitions call Playwright directly — `this.page.fill(...)`, `this.page.click(...)`.
- Adding a new test means writing Gherkin only. The agent generates the TypeScript.
- Fixing a broken test means updating the locator factory function in the step file. No class hierarchy to trace.

---

## 2. Repository Structure

```
psd-agentic/
│
├── features/                        # Gherkin feature files — human-authored, never agent-modified
│   └── <domain>.feature
│
├── steps/
│   └── pages/                       # PSD step files — one per application page
│       ├── login.page.steps.ts
│       ├── dashboard.page.steps.ts
│       ├── pim.page.steps.ts
│       ├── add-employee.page.steps.ts
│       └── personal-details.page.steps.ts
│
├── support/
│   ├── world.ts                     # PSWorld — shared Playwright browser/page context
│   └── hooks.ts                     # Before/After hooks for browser lifecycle
│
├── .github/
│   ├── agents/                      # VS Code agent definitions (.agent.md)
│   ├── workflows/                   # GitHub Actions agentic workflows
│   └── skills/                      # Reusable prompt skills for agents
│
├── docs/                            # Human-readable framework guides
├── cucumber.js                      # Cucumber runner configuration
├── tsconfig.json
└── package.json
```

**Rules:**
- Never add folders outside this structure without updating this document.
- Never place step files directly under `steps/` — they must live under `steps/pages/`.
- Never create a `helpers/`, `utils/`, or `lib/` folder to hold page interaction logic.

---

## 3. Feature File Standards

Feature files are the sole place where test design happens. They are written by humans and are **never modified by agents**.

### 3.1 File Naming and Location

- Location: `features/<domain>.feature`
- Use lowercase kebab-case: `leave-management.feature`, `employee-admin.feature`
- One feature file per functional domain or user workflow.

### 3.2 Feature and Scenario Structure

Every feature file must include:
- A `Feature:` title that names the domain or workflow.
- An `As a / I want / So that` user story in the feature description.
- A `Background:` for steps shared across all scenarios (typically navigation to start page).
- One or more named `Scenario:` blocks.

```gherkin
Feature: End to End Employee Management
  As an HR administrator using the PIM module
  I want to log in and add a new employee with unique details
  So that the employee record is created and available for further management

  Background:
    Given I navigate to the login page

  Scenario: End to End flow for adding emp
    When I login with valid credentials "testadmin" and "Vibetestq@123#"
    Then I should be redirected to the dashboard page
    ...
```

### 3.3 Gherkin Writing Rules

**Write from the user's perspective, never the technical implementation:**

```gherkin
# CORRECT — user intent
When I click on the PIM link
Then I should see the PIM module

# WRONG — technical detail
When I click element with id "menu-pim"
Then the URL should contain "/pim/viewEmployeeList"
```

**Use the Given / When / Then keywords correctly:**
- `Given` — precondition or initial state (navigation to a page, initial data setup)
- `When` — user action (click, fill, submit)
- `Then` — expected outcome or visible change (assertions)
- `And` — continuation of the previous keyword's intent

**Every action `When` step must be followed by a verification `Then` step:**

```gherkin
# CORRECT — action followed by verification
When I click on the PIM link
Then I should see the PIM module

# WRONG — action without verification
When I click on the PIM link
When I click on add button
```

**Each scenario must be self-contained and independently runnable.** Do not rely on state left by a previous scenario in the same file.

**Use `Scenario Outline` with `Examples` tables when the same flow needs multiple data sets:**

```gherkin
Scenario Outline: Login with different user roles
  When I login with valid credentials "<username>" and "<password>"
  Then I should be redirected to the dashboard page

  Examples:
    | username  | password    |
    | adminuser | Admin@123   |
    | hrmanager | Mgr@456     |
```

### 3.4 Step Text Conventions

- Write step text as a complete natural English sentence.
- Use quoted `{string}` parameters for values that vary between runs.
- Keep step text stable — changing step text breaks existing step bindings and forces agent re-generation.
- Reuse existing step text exactly when the action is already implemented in another feature.

---

## 4. Step Definition File Standards

Step definition files are the implementation layer of the framework. They are generated by the agent and maintained by the healer agent or the developer.

### 4.1 File Naming and Location

- Location: `steps/pages/<pagename>.page.steps.ts`
- Use lowercase kebab-case matching the page name: `login.page.steps.ts`, `add-employee.page.steps.ts`
- One file per application page.

### 4.2 File Structure

Every step definition file follows this exact structure — **in this order**:

```typescript
// 1. Imports
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// 2. Locator factory functions (one per interactive or verifiable element)
const loginHeading = (w: PSWorld) =>
  w.page.getByRole('heading', { name: 'Login' }).describe('Login page heading');

const usernameInput = (w: PSWorld) =>
  w.page.getByRole('textbox', { name: 'Username' }).describe('Username input field');

const loginButton = (w: PSWorld) =>
  w.page.getByRole('button', { name: 'Login' }).describe('Login submit button');

// 3. Step definitions (Given / When / Then bindings)
Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/auth/login');
  await expect(loginHeading(this)).toBeVisible();
});

When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
  await usernameInput(this).fill(username);
  await passwordInput(this).fill(password);
  await loginButton(this).click();
});
```

**No class, no constructor, no exports other than nothing. The file is a flat module.**

### 4.3 Locator Factory Functions

All locators must be declared as factory functions at the top of the file, before any step definitions.

**Rules:**
- Each factory function takes `(w: PSWorld)` as its only argument and returns a `Locator`.
- Every locator must end with `.describe('...')` — a short human-readable description of the element.
- Name the factory function after the element's purpose: `saveButton`, `employeeIdInput`, `pimHeading`.
- Do not inline locators inside step functions. Define them at the top and call from the step.

```typescript
// CORRECT — factory function at top, called from step
const saveButton = (w: PSWorld) =>
  w.page.getByRole('button', { name: 'Save' }).describe('Save employee button');

When('I save the employee', async function (this: PSWorld) {
  await saveButton(this).click();
});

// WRONG — locator inlined in step
When('I save the employee', async function (this: PSWorld) {
  await this.page.getByRole('button', { name: 'Save' }).click();
});
```

### 4.4 Locator Strategy — Priority Order

Use role-based and accessible locators first. Fall back to data attributes or CSS only when semantic locators are not available.

| Priority | Strategy | Example |
|---|---|---|
| 1 (best) | Role + name | `getByRole('button', { name: 'Save' })` |
| 2 | Label | `getByLabel('Username')` |
| 3 | Placeholder | `getByPlaceholder('Search...')` |
| 4 | Test ID | `getByTestId('save-btn')` |
| 5 | Text content | `getByText('Dashboard')` |
| 6 (last) | CSS selector | `page.locator('.submit-btn')` |

**Never use XPath, index-based locators (`nth-child`), or dynamic attributes that change between sessions.**

### 4.5 Verification in Every Action Step

Every step that performs a user action must verify its outcome before the function returns. Do not leave actions unverified.

```typescript
// CORRECT — navigation verified
Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/auth/login');
  await expect(loginHeading(this)).toBeVisible();   // ← verify page loaded
});

// WRONG — navigation not verified
Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/auth/login');
  // nothing — we don't know if the page loaded
});
```

```typescript
// CORRECT — form save verified
When('I save the employee', async function (this: PSWorld) {
  await saveButton(this).click();
  await expect(personalDetailsHeading(this)).toBeVisible(); // ← verify result
});
```

### 4.6 Sharing State Between Steps

When a step captures a value that a later step needs (e.g. auto-generated employee IDs), store it on `this` using a plain property assignment.

```typescript
// Store the value
Then('I read the employee id from the employee id textbox and store it in a variable', async function (this: PSWorld) {
  const id = await employeeIdInput(this).inputValue();
  (this as any).employeeId = id;
});

// Use it in a later step
Then('I should see the employee record created in the search results', async function (this: PSWorld) {
  const id = (this as any).employeeId;
  await expect(pimSearchResult(this, id)).toBeVisible();
});
```

**Rules:**
- Only store data that genuinely needs to cross step boundaries.
- Use a descriptive property name that reflects its content.
- Do not use global variables, module-level variables, or external files to share state between steps.

### 4.7 Imports

Every step file must import from exactly these three sources and no others:

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';
```

- Do not import from `@playwright/test` for anything other than `expect`.
- Do not import helper utilities, shared constants, or external modules.
- Do not import from other step files.

---

## 5. PSWorld and Support Layer Standards

### 5.1 PSWorld (`support/world.ts`)

`PSWorld` is the shared Playwright context injected into every step via Cucumber's `this` binding.

| Member | Type | Purpose |
|---|---|---|
| `this.page` | `Page` | Playwright page — all browser interactions |
| `this.context` | `BrowserContext` | Browser context for cookies and storage |
| `this.baseUrl` | `string` | Base URL from `cucumber.js` worldParameters |

**Rules:**
- Never access `this.page` outside of a step definition or hook.
- Never modify `world.ts` to add page-specific helpers or shared state.
- Never store page-level state (e.g. element references, captured text) on `PSWorld` — use `(this as any).propertyName` in the step file.

### 5.2 Hooks (`support/hooks.ts`)

- `Before`: calls `this.initPlaywright()` to create a browser context and page for each scenario.
- `After`: calls `this.closeContext()` to tear down the context after each scenario.
- `AfterAll`: closes the shared browser process after the entire run.

**Rules:**
- Do not add scenario-specific logic to hooks.
- Do not add data setup or teardown logic to hooks — put it in `Background:` steps in the feature file.
- `setDefaultTimeout` is set once in `hooks.ts` and applies globally. Do not override per-step.

### 5.3 Timeouts

| Timeout | Value | Where Set |
|---|---|---|
| Cucumber step timeout | 120 000 ms | `hooks.ts` — `setDefaultTimeout` |
| Playwright action timeout | 30 000 ms | `world.ts` — `page.setDefaultTimeout` |
| Playwright navigation timeout | 60 000 ms | `world.ts` — `page.setDefaultNavigationTimeout` |
| `expect` assertion timeout | 10 000 ms | `world.ts` — `expect.configure` |

Do not change individual step timeouts inline. If a step regularly exceeds these limits, investigate the application or the locator strategy.

---

## 6. Cucumber Configuration Standards (`cucumber.js`)

```javascript
module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['support/world.ts', 'support/hooks.ts', 'steps/**/*.steps.ts'],
    requireModule: ['ts-node/register'],
    format: ['pretty', 'html:cucumber-report.html', 'json:cucumber-report.json', 'rerun:reports/rerun.txt'],
    worldParameters: {
      baseUrl: 'https://your-app.example.com/',
    },
    timeout: 120000,
    retry: 0,
    parallel: 1,
  }
};
```

**Rules:**
- `baseUrl` is the only environment-specific value. It may also be overridden via the `AUT_BASE_URL` environment variable.
- `retry` should remain `0`. Flaky tests must be fixed, not silently retried.
- `parallel` is `1` by default to avoid cross-scenario state contamination. Increase only if scenarios are proven independent.
- Always generate both `json` and `html` reports. The JSON report is consumed by the healer agent.
- The `rerun:reports/rerun.txt` format enables selective re-runs of failed scenarios.

---

## 7. TypeScript Standards

### 7.1 Compiler Configuration

The `tsconfig.json` is set to strict TypeScript (`"strict": true`). All step files must compile without errors.

### 7.2 Type Safety in Steps

- Use `this: PSWorld` in every step function signature.
- When accessing dynamically stored properties (shared state), use `(this as any).propertyName`.
- Do not use `any` for Playwright API calls — types are inferred automatically.

### 7.3 Async / Await

- Every step function must be declared `async`.
- Every Playwright call and every `expect` call must be `await`-ed.
- Never use `.then()` chains. Always use `async / await`.

```typescript
// CORRECT
When('I save the employee', async function (this: PSWorld) {
  await saveButton(this).click();
});

// WRONG
When('I save the employee', function (this: PSWorld) {
  return saveButton(this).click();
});
```

---

## 8. Running Tests

### 8.1 Commands

| Command | Purpose |
|---|---|
| `npm test` | Run all features headless |
| `npm run test:headed` | Run all features with browser visible |
| `npm run test:headless` | Explicitly headless |
| `npx cucumber-js features/my.feature` | Run a single feature file |
| `npx cucumber-js --dry-run` | Check for undefined step bindings without running |

### 8.2 Re-running Failed Scenarios

After a partial failure, re-run only the failed scenarios:

```bash
npx cucumber-js @reports/rerun.txt
```

### 8.3 Reports

After every run, two reports are written:

| File | Purpose |
|---|---|
| `cucumber-report.html` | Human-readable — open in browser |
| `cucumber-report.json` | Machine-readable — consumed by the healer agent |

Do not delete these files between runs — the healer agent depends on the JSON report to identify failures.

---

## 9. Agent Standards

### 9.1 Test Generator Agent

**Purpose:** Given a new feature file with undefined steps, generate all required `*.page.steps.ts` files.

**Invocation:**
- VS Code: `@Test Definition Generator` in Copilot Chat
- GitHub: automatic on push to `features/**/*.feature`; or manual workflow dispatch

**What the agent does:**
1. Runs `npx cucumber-js --dry-run` to list undefined steps.
2. Reads the feature file to map each step to an application page.
3. Navigates the live app using Playwright MCP to inspect the DOM and accessibility tree.
4. Generates locator factory functions from real element data.
5. Writes `steps/pages/<pagename>.page.steps.ts` following these standards exactly.
6. Opens a pull request with the generated files (CI) or writes directly to disk (VS Code).

**What the agent must never do:**
- Modify feature files.
- Create page object classes.
- Add helper files or utility modules.
- Deviate from the locator factory function pattern.

### 9.2 Test Healer Agent

**Purpose:** Diagnose and fix failing step definitions without changing feature files or step text.

**Invocation:**
- VS Code: `@Test Healer heal failures in features/<name>.feature`
- GitHub: manual workflow dispatch on CI failure

**What the healer does:**
1. Runs the feature file and reads `cucumber-report.json`.
2. Classifies each failure: locator broken, assertion wrong, navigation broken, or TypeScript error.
3. Navigates the live app for each broken locator and finds the correct element.
4. Updates only the broken locator factory function, assertion value, or URL — nothing else.

**What the healer must never change:**
- Feature files.
- Step binding strings (the quoted text in `Given(...)`, `When(...)`, `Then(...)`).
- Passing steps.
- `support/world.ts` or `support/hooks.ts`.

### 9.3 Failure Classification

| Failure type | Root cause | What changes |
|---|---|---|
| Locator broken | App UI updated — element label/role changed | Locator factory function body |
| Assertion wrong | Expected text or state changed in the app | `expect(...)` expected value |
| Navigation broken | URL structure changed | `this.page.goto(...)` path |
| TypeScript error | Syntax error from a prior edit | Compilation fix in step file |

---

## 10. CI/CD and GitHub Workflow Standards

### 10.1 Agentic Workflow Source Files

- Workflow source files live at `.github/workflows/<name>.md` — these are human-editable Markdown with YAML frontmatter.
- Compiled workflow files are at `.github/workflows/<name>.lock.yml` — these are auto-generated and must **never be edited manually**.
- To change a workflow, edit the `.md` source file and run `gh aw compile`.

### 10.2 Test Generation Trigger

The `test-generator` workflow fires automatically when any file matching `features/**/*.feature` is pushed to any branch except branches matching `test-gen/**`. The `test-gen/**` branch prefix is used by the agent's own commits to prevent infinite recursion.

### 10.3 Branch and PR Convention

| Situation | Branch name | Created by |
|---|---|---|
| Agent generates new steps | `test-gen/<feature-name>-<timestamp>` | Test generator agent |
| Developer adds feature | any feature branch | Developer |
| Healer fixes failures | opened as a commit on current branch | Healer agent |

---

## 11. What is Forbidden

The following practices are explicitly forbidden in this framework.

| Forbidden | Reason |
|---|---|
| Page object classes | They reintroduce the maintenance layer PSD eliminates |
| Locators inlined inside step bodies | Prevents reuse and makes healing harder |
| Missing `.describe(...)` on locators | Makes failure messages unreadable |
| Global variables for shared state | Breaks scenario isolation |
| `retry` greater than 0 | Hides flaky tests rather than fixing them |
| Editing `.lock.yml` workflow files | Overwritten on next compile |
| Editing feature files from the agent | Feature files are the human-authored contract |
| Changing step binding strings during healing | Breaks the Gherkin-to-code contract |
| `any` typed Playwright API calls | Defeats TypeScript safety |
| XPath or index-based locators | Fragile, breaks on minor DOM changes |

---

## 12. Checklist — Before Committing

Use this checklist when adding or changing any test artifact.

### Feature file
- [ ] Written from the user's perspective, not the technical implementation
- [ ] Every `When` action step is followed by a `Then` verification step
- [ ] Scenario is self-contained and can run independently
- [ ] Step text is stable (not likely to change just because the UI changes)

### Step definition file
- [ ] File is at `steps/pages/<pagename>.page.steps.ts`
- [ ] All locators are factory functions defined at the top of the file
- [ ] Every locator ends with `.describe('...')`
- [ ] No locators are inlined inside step bodies
- [ ] Every action step includes a verification before it returns
- [ ] `this: PSWorld` is declared in every step function signature
- [ ] Every Playwright call and `expect` call is `await`-ed
- [ ] File compiles with no TypeScript errors (`npx tsc --noEmit`)

### After a test run
- [ ] `cucumber-report.html` reviewed for unexpected failures
- [ ] `cucumber-report.json` present and not deleted
- [ ] No failing scenarios left unaddressed

