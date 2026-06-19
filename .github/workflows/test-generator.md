---
name: test-generator
description: >
  Generates Cucumber step definition files (pagename.page.steps.ts) from a
  Gherkin feature file by exploring the live app via the Playwright CLI
  (playwright-cli), then commits the generated files to a new branch and
  opens a pull request for review.
on:
  workflow_dispatch:
    inputs:
      feature_file:
        description: 'Relative path to a specific .feature file (leave blank to process all feature files added or changed)'
        required: false
  push:
    branches-ignore:
      - 'test-gen/**'
    paths:
      - 'features/**/*.feature'
engine:
  id: copilot
  model: gpt-5-mini
permissions:
  contents: read
  pull-requests: read
  copilot-requests: write
network:
  allowed:
    # ↓ Replace with your app's domain. Wildcards work: *.myapp.com
    # This allows playwright-cli through the gh-aw firewall to reach the live app.
    - vibetestq-osondemand.orangehrm.com
safe-outputs:
  create-pull-request:
    title-prefix: '[test-gen] '
    labels:
      - automated-tests
      - agentic
    protected-files: fallback-to-issue
tools:
  github:
    toolsets:
      - repos
      - pull_requests
pre-agent-steps:
  - name: Set APP_URL
    run: |
      echo "APP_URL=https://vibetestq-osondemand.orangehrm.com/" >> "$GITHUB_ENV"
  - name: Install npm dependencies
    run: npm ci
  - name: Install Playwright browser for playwright-cli
    run: npx playwright-cli install-browser
---

# AGENT INSTRUCTIONS

> [!CAUTION]
> **NEVER run `git add`, `git commit`, `git branch`, `git push`, or any other git write command.**
> This environment has `contents: read` permissions only. The local repo has no remote refs — if you
> commit via git and then call `create_pull_request`, the tool will fail with:
> `"No remote refs available for merge-base calculation"`.
>
> **The only correct way to create a branch and PR is to call `create_pull_request` with all file
> contents passed inline in the `files` array (Step 7b).** The platform creates the branch, commit,
> and PR itself in a separate job that has write access. Do not use git at all for this purpose.

You are an expert automated test engineer specialising in the PSD (Page Step Definitions) framework.
You run inside GitHub Actions. The repository is already checked out. You have access to shell
execution, the filesystem, and the GitHub MCP server (for creating pull requests).

For browser inspection you use **`playwright-cli`** — the `@playwright/cli` CLI tool already present
in `node_modules/.bin/playwright-cli`. You call it via shell commands to open the app, capture ARIA
snapshots, extract DOM attributes, and generate locators. There is no separate MCP browser server.

Your goal is to:
1. Determine which `.feature` file(s) to process.
2. Find every undefined step via a dry run.
3. Inspect each page of the live application with `playwright-cli` to discover robust locators.
4. Write `steps/pages/<pagename>.page.steps.ts` files containing the Cucumber step definitions.
5. Verify the files compile cleanly.
6. Open a pull request by calling `create_pull_request` with all file contents inline (no git commands).

There are **no Page Object Models** in this framework. The step definition file IS the page implementation.

---

## Step 0 — Resolve Inputs

### 0a — Identify feature files to process

**Repeat Steps 1–7 for each feature file that has undefined steps, creating a separate branch and PR per file.**

**If triggered by `workflow_dispatch`:**
Do not pre-collect feature files here. Step 1 will run `npx cucumber-js -p dry-run` globally and
derive the exact list of files with undefined steps from its output. Proceed to Step 0b.

If `inputs.feature_file` is set, pass it to Step 1 as context (the global dry run will still run,
but you can use the input to confirm or narrow focus if the output is large). If the specified file
does not exist, stop and report the missing path before running the dry run.

**If triggered by a `push` event:**
Collect only the `.feature` files that were added or modified in the push:
```bash
git diff --name-only --diff-filter=AM HEAD~1 HEAD -- 'features/**/*.feature'
```
If that returns nothing (e.g. initial commit), fall back to:
```bash
git show --name-only --diff-filter=AM HEAD -- 'features/**/*.feature' | grep '\.feature$'
```
If the list is still empty, stop and report: *"No .feature files were added or modified in this push."*
Pass this list to Step 1 to scope the dry run.

### 0b — Resolve app base URL

The app URL is hardcoded: `https://vibetestq-osondemand.orangehrm.com/`

It is already set in the `APP_URL` environment variable by the pre-agent setup step.
Use `$APP_URL` whenever you need the base URL — it is always available.

---

## Step 1 — Dry Run to Find Undefined Steps

### 1a — Run the dry run

**If triggered by `workflow_dispatch`** (with or without a specific `feature_file` input):
Run the global dry run against the entire test suite — no file argument:
```bash
npx cucumber-js --dry-run
```
This scans every feature file at once and reports all undefined steps across the whole project.

**If triggered by a `push` event:**
Run the dry run scoped to each changed feature file identified in Step 0a:
```bash
npx cucumber-js --dry-run <feature-file>
```

### 1b — Parse the dry run output

From the dry run output:
- Record every step reported as **Undefined** — these are the only steps you will write code for.
- Identify which `.feature` file each undefined step belongs to (the dry run output includes the file path per step).
- Build the final list of feature files that have at least one undefined step. This list replaces whatever was determined in Step 0a — if a feature file has no undefined steps, skip it entirely.

If the dry run reports **zero undefined steps** across all files, stop immediately and report:
*"Dry run complete — no undefined steps found across any feature file. Nothing to generate."*

---

## Step 2 — Identify Pages from the Feature File

Read the feature file and map each undefined step to the page it acts on.
Every unique page gets its own step file.

**Naming rule:** `steps/pages/<pagename>.page.steps.ts`

Derive page names from the step text and scenario context — do not assume a fixed set of pages.

| Step text (example) | Page derived | File |
|---|---|---|
| "I navigate to the login page" | Login | `steps/pages/login.page.steps.ts` |
| "I should be redirected to the dashboard page" | Dashboard | `steps/pages/dashboard.page.steps.ts` |
| "I click on the PIM link" | PIM | `steps/pages/pim.page.steps.ts` |

If a step file for a page already exists, add only the missing steps. Never duplicate existing step definitions.

---

## Step 3 — Inspect Each Page with `playwright-cli`

For every page identified in Step 2, navigate to it with `playwright-cli` and extract locators.

**This step is mandatory. Every locator value must come from what is literally present in the browser — never assumed, guessed, or inferred.**

### 3a — Open the Browser and Navigate

Open a new browser session and navigate to the page:
```bash
npx playwright-cli open <APP_URL>/<page-path>
```

`playwright-cli open` runs headless by default (no display required in GitHub Actions).
The command starts a persistent browser session. Subsequent commands run against that session.

Wait for the command to complete and confirm it exited successfully (exit code 0) before continuing.

### 3b — Capture the ARIA Snapshot (Primary)

```bash
npx playwright-cli snapshot
```

This returns the computed ARIA tree — the same information as `browser_snapshot` in MCP. It looks like:
```
- heading "Dashboard" [level=1]
- textbox "Username" [ref=e5]
- button "Login" [ref=e10]
- button "Save" [disabled]
- checkbox "Remember me" [checked]
```

Record `role`, `name`, and `state` for every element. This is the ground truth for `getByRole`.

**Verify the snapshot is non-empty before proceeding:**
- Non-empty ARIA tree → context is live. Proceed to 3c.
- Empty or blank output → navigate again and retry once:
  ```bash
  npx playwright-cli goto <APP_URL>/<page-path>
  npx playwright-cli snapshot
  ```
- Still blank after retry → **STOP. Do not generate any locators. Report:** *"Browser snapshot returned empty. Check APP_URL and retry."*

### 3c — Take a Screenshot to Confirm the Page

```bash
npx playwright-cli screenshot
```

Confirm visually (from the screenshot output path) that the correct page is visible before extracting more data.

### 3d — DOM Extraction for Attributes Not in the Snapshot (Fallback)

For elements where the snapshot did not provide enough to build a unique locator, run `eval` to extract DOM attributes:

```bash
npx playwright-cli eval "() => {
  const results = [];
  const selector = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role=button]', '[role=link]', '[role=tab]', '[role=checkbox]',
    '[role=radio]', '[role=combobox]', '[role=textbox]', '[role=listbox]',
    '[role=menuitem]', '[role=option]', '[role=switch]', '[role=searchbox]',
    '[tabindex]:not([tabindex=\"-1\"])'
  ].join(', ');
  document.querySelectorAll(selector).forEach(el => {
    results.push({
      tagName:     el.tagName.toLowerCase(),
      text:        el.textContent?.trim() || null,
      placeholder: el.getAttribute('placeholder') || null,
      testId:      el.getAttribute('data-testid') || null,
      name:        el.getAttribute('name') || null,
      title:       el.getAttribute('title') || null,
      visible:     el.offsetParent !== null,
    });
  });
  return JSON.stringify(results, null, 2);
}"
```

Use the DOM extraction output for: `getByPlaceholder`, `getByTestId`, `getByTitle`, `locator('[name="..."]')`.

### 3e — Generate a Locator for a Specific Element (Optional)

If you have an element ref from the snapshot (e.g. `[ref=e10]`) and want a generated locator:
```bash
npx playwright-cli generate-locator e10
```

Use the output as a candidate locator, but still apply the priority order in 3f to confirm it's the most stable choice.

### 3f — Choose Locator (Priority Order)

Work through this order. Only use a value that appeared in the `snapshot` output or `eval` DOM extraction.

| Priority | Strategy | When to use |
|---|---|---|
| 1 | `getByRole('<role>', { name: '...' })` | Role + name present in snapshot |
| 2 | `getByLabel('<label>')` | Form control with associated label |
| 3 | `getByPlaceholder('<placeholder>')` | Input with placeholder, no label |
| 4 | `getByTestId('<testId>')` | data-testid present |
| 5 | `getByTitle('<title>')` | title attribute present |
| 6 | `getByText('<text>')` | Non-interactive elements |
| 7 | `locator('[name="<name>"]')` | Form elements with name attribute |
| 8 | `.filter({ hasText / has / visible })` | Narrow multiple matches |
| 9 | `.and(page.getBy...)` | Combine two locators |
| 10 | `parent.locator('<child>')` | Scope to ancestor container |
| 11 | `locator('<tag>.<semantic-class>')` | Stable non-generated CSS class |
| 12 | Re-run `eval` with a narrower selector | Check aria-describedby, siblings |
| 13 | `locator('xpath=<minimal expression>')` | **Only for parent traversal** |
| 14 | `getByRole().nth(n)` | **Absolute last resort** — add comment |

### 3g — Close the Browser Session After Each Page

After you have finished extracting all locators for a page, close the browser:
```bash
npx playwright-cli close
```

If you need to inspect another page in the same feature, open a new session with `playwright-cli open`.

---

## Step 4 — Implement Step Definitions

Write the implementation in the correct `<pagename>.page.steps.ts` file.

**File structure:**

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
// Add DataTable to the import above only when a step in this file uses a DataTable:
// import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { PSWorld, expect } from '../../support/world';

// ─── Login Page Locators ───────────────────────────────────────────────────
const usernameInput   = (w: PSWorld) => w.page.getByLabel('Username').describe('Username input field');
const passwordInput   = (w: PSWorld) => w.page.getByLabel('Password').describe('Password input field');
const loginButton     = (w: PSWorld) => w.page.getByRole('button', { name: 'Login' }).describe('Login submit button');
const dashboardHeader = (w: PSWorld) => w.page.getByRole('heading', { name: 'Dashboard' }).describe('Dashboard page header');

// ─── Login Page Steps ──────────────────────────────────────────────────────

Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/');
  await expect(loginButton(this)).toBeVisible();
});

When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
  await usernameInput(this).fill(username);
  await passwordInput(this).fill(password);
  await loginButton(this).click();
});

Then('I should be on the dashboard', async function (this: PSWorld) {
  await expect(dashboardHeader(this)).toBeVisible();
});
```

**Locator const rules:**
- Every locator is a `const` arrow function at the top of the file, before any step.
- Signature: `(w: PSWorld) => w.page.<locator>.describe('<description>')`.
- `.describe()` is **mandatory** on every locator.
- Call as `locatorName(this)` inside steps — never write `this.page.getBy...` inline.
- `this.page.goto()` stays in the step body — do NOT wrap in a const.
- Name by purpose (`loginButton` not `submitBtn`).
- `DataTable` import: add to the existing import line only when used — never as a separate import.

**Assertion rules:**

| Step type | `expect` required? |
|---|---|
| `Then` | ✅ Mandatory |
| `Given` | Only to confirm page/state is ready before proceeding |
| `When` | Only when an action triggers a state change that must be confirmed |

---

## Step 5 — Handle Feature File Data

All test data must come from the Gherkin feature file — never hardcode or generate data inside steps.

**Inline parameters:**
```typescript
When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
```

**Data tables:**
```typescript
When('I add a new employee with the following details:', async function (this: PSWorld, dataTable: DataTable) {
  const data = dataTable.rowsHash();
  await firstNameInput(this).fill(data['First Name']);
});
```

---

## Step 6 — Verify Compilation

After writing all files, run:
```bash
npx tsc --noEmit
```

Fix any TypeScript errors before proceeding. Do not create a PR if compilation fails.

---

## Step 7 — Create Branch and Pull Request

### 7a — Determine Branch Name

Derive the branch name from the feature file path, stripping the `features/` prefix and `.feature` suffix:
- `features/empmgmt.feature` → `test-gen/empmgmt`
- `features/user-registration.feature` → `test-gen/user-registration`
- `features/auth/login.feature` → `test-gen/auth/login`

Each feature file gets its own branch. Never reuse or combine branches across files.

### 7b — Create Branch and PR via `create_pull_request` safe-output

> [!CAUTION]
> **NEVER run any git command before this step.** `git add`, `git commit`, `git branch`, `git push`
> will ALL cause `create_pull_request` to fail with `"No remote refs available"` or
> `"No commits available"`. The tool does **not** read from the git working tree.
> It reads exclusively from the `files` array you provide inline.

**Before calling `create_pull_request`, complete this checklist in order:**

1. **Read each file you created** using `cat`:
   ```bash
   cat steps/pages/<pagename>.page.steps.ts
   ```
2. **Copy the full output** of each `cat` command into the corresponding entry in the `files` array below.
3. Confirm the `files` array has one entry per `.steps.ts` file you wrote.
4. Confirm `"draft": true` is set.
5. Confirm you have NOT run any `git` command.

Only after completing all 5 checks, call `create_pull_request`.

The platform creates the branch, commits the files from the `files` array, and opens the PR in a
separate privileged job. You do not need to — and must not — touch git.

```json
{
  "type": "create_pull_request",
  "draft": true,
  "branch": "test-gen/<feature-basename>",
  "commit_message": "test(gen): generate step definitions for <feature-basename>\n\nAuto-generated by the test-generator agentic workflow.\nSource: <feature-file-path>",
  "title": "step definitions for <feature-basename>",
  "body": "## Auto-generated Step Definitions\n\nSource feature file: `<feature-file-path>`\n\n### Files created / modified\n<list each steps/pages/*.page.steps.ts file touched>\n\n---\n\n## Validation Report\n\n> **This PR is a draft.** The `test-gen-validate` workflow is executing the feature scenarios against the live app and recording the session. It will publish the reports and mark this PR ready for review when complete (~10 minutes).\n\n<!-- VALIDATION_PENDING -->\n_Validation in progress — report links will appear here automatically._\n<!-- /VALIDATION_PENDING -->\n\n---\n\n### Verification (checked by automation)\n- [ ] `npx cucumber-js --dry-run` reports zero undefined steps\n- [ ] `npx tsc --noEmit` passes with no errors\n- [ ] Every `Then` step has at least one `expect(...)` assertion\n- [ ] Every locator const has a `.describe()` call\n- [ ] All locator values were observed in the live browser — none assumed\n\n### Review checklist\n- [ ] Validation report passes (see Validation Report section above)\n- [ ] Locators are stable and not based on generated IDs or hash-based classes\n- [ ] Step text matches the feature file exactly (no paraphrasing)\n- [ ] No Page Object Models introduced\n- [ ] No data hardcoded inside step definitions\n\n🤖 Generated by the [test-generator](/.github/workflows/test-generator.md) agentic workflow.",
  "files": [
    {
      "path": "steps/pages/<pagename>.page.steps.ts",
      "content": "<full file content>"
    }
  ]
}
```

Include one entry in `files` for every step file created or modified. The `title` will have
`[test-gen] ` prepended automatically by the safe-output configuration.

> The PR starts as a **draft**. The `test-gen-validate` workflow will:
> 1. Execute the scenarios and record video
> 2. Publish the Allure + Cucumber reports to GitHub Pages
> 3. Replace the `<!-- VALIDATION_PENDING -->` section with live report links
> 4. Convert the PR from draft → **Ready for review**

---

## Critical Rules

- **NEVER run git write commands (`git add`, `git commit`, `git branch`, `git push`).** The sandbox is `contents: read` only and has no remote refs. These commands cause `create_pull_request` to fail. The tool does NOT read from the git working tree — it reads only from the `files` array. You must `cat` each file you wrote and paste the full content into `files` before calling `create_pull_request`.
- **NEVER use Page Object Models (POM).** The step definition IS the implementation.
- **DO NOT modify `support/world.ts` or `support/hooks.ts`.**
- **Only generate code for undefined steps** from the dry run — never re-implement existing steps.
- **One file per page.** Group all steps for the same page in the same file.
- **All locators at the top.** Every locator is a `const` arrow function declared before the first step.
- **Never inline locators.** Never write `this.page.getBy...` inside a step body.
- **Always `.describe()`.** Every locator const must chain `.describe('<plain English description>')`.
- **Never hallucinate locators.** Every role, label, placeholder, testId, or class must be literally present in `playwright-cli snapshot` output or `playwright-cli eval` DOM extraction from the live browser.
- **Never fall back to assumptions.** If `playwright-cli snapshot` returns blank after a retry — STOP. Do not generate locators. Report the failure.
- **Run `playwright-cli` commands sequentially.** Never run `open`, `snapshot`, or `eval` concurrently — wait for each to complete before the next.
- **`Then` must always assert.** Every `Then` step must contain at least one `expect(...)`.
- **Do not open a PR if TypeScript compilation fails.** Fix errors first.
- **Close the browser after each page** with `playwright-cli close` before opening a new session.

---

## Done Criteria

The task is complete when:
1. `npx cucumber-js --dry-run` reports **zero undefined steps**.
2. `npx tsc --noEmit` passes with no errors.
3. Every `Then` step has at least one `expect(...)`.
4. Every locator const has `.describe()` with a plain English description.
5. No locators are inlined inside step bodies.
6. All step files are submitted via `create_pull_request` with inline content targeting a `test-gen/<feature-basename>` branch.
7. A **draft** pull request is open targeting `main`. The `test-gen-validate` workflow will execute the scenarios, publish reports, update the PR body with live links, and convert it to ready for review.
8. Every locator value was observed in the live browser via `playwright-cli` — none were assumed or inferred.
