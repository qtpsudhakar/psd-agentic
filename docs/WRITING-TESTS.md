# Writing Tests with the PSD Framework

This guide explains how to create automated tests. In the PSD framework, **you only write Gherkin**. The agent generates all the TypeScript code.

---

## Overview: What You Do vs What the Agent Does

| You | Agent |
|---|---|
| Write the `.feature` file in plain English | Reads your feature file |
| Describe user journeys in Gherkin scenarios | Explores the live app to find locators |
| Push the file to the repository | Generates `steps/pages/*.page.steps.ts` files |
| Review and merge the pull request | Opens a PR with the generated step definitions |

---

## Step 1 — Write the Feature File

Create a new file in the `features/` directory. Use standard Gherkin syntax.

**File naming:** `features/<domain>.feature`

### Example

```gherkin
Feature: Employee Leave Management
  As an HR administrator
  I want to manage employee leave requests
  So that leave records are tracked accurately

  Background:
    Given I navigate to the login page

  Scenario: Approve a pending leave request
    When I login with valid credentials "adminuser" and "Password123"
    Then I should be redirected to the dashboard page
    When I click on the Leave module
    Then I should see the Leave management page
    When I select a pending leave request
    Then I should see the leave request details
    When I click the Approve button
    Then the leave request status should be "Approved"
```

### Gherkin Best Practices

**Write steps from the user's perspective — not the technical implementation:**

```gherkin
# GOOD — describes user intent
When I click on the PIM link
Then I should see the PIM module

# AVOID — describes technical details
When I click element with id "menu-pim"
Then the URL should contain "/pim/viewEmployeeList"
```

**Use Background for steps that repeat across all scenarios in the feature:**

```gherkin
Background:
  Given I navigate to the login page

Scenario: Scenario A
  When I login with valid credentials "user1" and "pass1"
  ...

Scenario: Scenario B
  When I login with valid credentials "user2" and "pass2"
  ...
```

**Use data tables for testing multiple values:**

```gherkin
Scenario Outline: Login with multiple user roles
  When I login with valid credentials "<username>" and "<password>"
  Then I should be redirected to the dashboard page

  Examples:
    | username   | password       |
    | adminuser  | Admin@123      |
    | hrmanager  | Manager@456    |
```

**Keep each scenario independent** — every scenario should be able to run on its own.

---

## Step 2 — Identify What Pages Are Involved

Each step in your scenario acts on a specific page. The agent will create one step definition file per page. Before writing steps, mentally map your steps to pages:

| Step | Page |
|---|---|
| `I navigate to the login page` | Login |
| `I login with valid credentials ...` | Login |
| `I should be redirected to the dashboard page` | Dashboard |
| `I click on the Leave module` | Dashboard |
| `I should see the Leave management page` | Leave |
| `I select a pending leave request` | Leave |

The agent uses this mapping automatically — you don't need to write it down.

---

## Step 3 — Trigger Test Generation

### Option A: Push to GitHub (Automatic)

Commit and push your feature file. The `test-generator` workflow triggers automatically:

```bash
git add features/leave-management.feature
git commit -m "feat: add leave management test scenario"
git push origin main
```

The workflow will:
1. Detect the new/changed `.feature` file
2. Run the AI agent in a sandboxed environment
3. Navigate your live app to find correct locators
4. Generate step definition files
5. Open a pull request named `[test-gen] leave-management.feature`

### Option B: Use the VS Code Agent (Local)

Open GitHub Copilot Chat in VS Code and type:

```
@Test Definition Generator generate steps for features/leave-management.feature
```

The agent will run locally, use the Playwright MCP browser, and write the files directly into your workspace.

> **Prerequisite for local use:** The Playwright MCP server must be running. It is started automatically when VS Code opens the workspace if configured, or start it manually:
> ```bash
> npx @playwright/mcp@latest --port 3000
> ```

### Option C: Manual Workflow Dispatch

In the GitHub repository:
1. Go to **Actions** → **test-generator**
2. Click **Run workflow**
3. Optionally enter a specific feature file path, or leave blank to process all changed features

---

## Step 4 — Review the Pull Request

The agent opens a PR with:
- Branch name: `test-gen/<feature-name>-<timestamp>`
- Labels: `automated-tests`, `agentic`
- Step definition files in `steps/pages/`

**What to look for in the review:**

1. **Step coverage** — every step in your feature file has an implementation
2. **Locator quality** — locators use ARIA roles and accessible names (preferred over CSS selectors or XPaths)
3. **Assertions** — `Then` steps include `expect(...).toBeVisible()` or equivalent
4. **No duplicate step definitions** — if a step already exists in another file, it should not be redefined

Merge the PR when satisfied. The tests are now ready to run.

---

## Step 5 — Run the Tests

```bash
# Run all tests
npm test

# Run a specific feature file
npx cucumber-js features/leave-management.feature

# Dry run — verify all steps are defined without running the browser
npx cucumber-js --dry-run

# Run with Allure reporting
npm run test:allure
```

---

## Understanding the Generated Step File

A generated step file looks like this:

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─────────────────────────────────────────────
// Locator factory functions
// ─────────────────────────────────────────────
const leaveMenuItem = (w: PSWorld) =>
  w.page.getByRole('link', { name: 'Leave' }).describe('Leave menu item');

const pendingRequestRow = (w: PSWorld) =>
  w.page.getByRole('row').filter({ hasText: 'Pending' }).first()
    .describe('First pending leave request row');

const approveButton = (w: PSWorld) =>
  w.page.getByRole('button', { name: 'Approve' }).describe('Approve leave button');

// ─────────────────────────────────────────────
// Step definitions
// ─────────────────────────────────────────────
When('I click on the Leave module', async function (this: PSWorld) {
  await leaveMenuItem(this).click();
});

Then('I should see the Leave management page', async function (this: PSWorld) {
  await expect(w.page.getByRole('heading', { name: 'Leave' })).toBeVisible();
});

When('I select a pending leave request', async function (this: PSWorld) {
  await pendingRequestRow(this).click();
});

When('I click the Approve button', async function (this: PSWorld) {
  await approveButton(this).click();
});

Then('the leave request status should be {string}', async function (this: PSWorld, status: string) {
  await expect(w.page.getByText(status)).toBeVisible();
});
```

**Key patterns:**
- Locators are **factory functions** (not stored properties) — they take `PSWorld` and return a `Locator`
- Each locator has a `.describe(...)` label for better error messages
- Steps use `this` typed as `PSWorld` to access the Playwright page
- `Then` steps always include an assertion (`expect`)

---

## What NOT to Do

**Do not write step definitions manually** — let the agent generate them. Manual step code bypasses the locator discovery process and often results in brittle selectors.

**Do not add page classes or helper objects** — the PSD framework has no page object layer. Steps access `this.page` directly.

**Do not duplicate step definitions** — if a step text already exists in another page's step file, the same step text cannot be defined again. Use consistent step wording across features.

**Do not put locators inside step bodies** — locators belong at the top of the file as factory functions, not inline inside the step.

```typescript
// WRONG — locator inside step body
When('I click the approve button', async function (this: PSWorld) {
  await this.page.locator('#approve-btn').click(); // ← do not do this
});

// CORRECT — locator as factory function at top of file, referenced in step
const approveButton = (w: PSWorld) =>
  w.page.getByRole('button', { name: 'Approve' });

When('I click the Approve button', async function (this: PSWorld) {
  await approveButton(this).click(); // ← clean, descriptive, reusable
});
```
