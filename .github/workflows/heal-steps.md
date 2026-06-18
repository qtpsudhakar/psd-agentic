---
name: heal-steps
description: >
  Self-healing workflow. When test-gen-validate finds failing step definitions,
  this workflow downloads the failure report, re-explores the live app with
  playwright-cli to find the correct locators, fixes the step definitions,
  re-executes only the failing scenarios to confirm the fix, and opens a
  healing pull request targeting the original test-gen branch.
on:
  workflow_dispatch:
    inputs:
      branch:
        description: 'The test-gen branch with failing steps (e.g. test-gen/empmgmt)'
        required: true
      run_id:
        description: 'Run ID of the failed test-gen-validate run (for artifact download)'
        required: true
      pr_number:
        description: 'PR number of the failing test-gen PR'
        required: true
engine:
  id: copilot
  model: gpt-5-mini
permissions:
  contents: read
  pull-requests: read
  actions: read
  copilot-requests: write
network:
  allowed:
    - vibetestq-osondemand.orangehrm.com
safe-outputs:
  create-pull-request:
    title-prefix: '[heal] '
    labels:
      - self-healing
      - automated-tests
    protected-files: fallback-to-issue
tools:
  github:
    toolsets:
      - repos
      - pull_requests
pre-agent-steps:
  - name: Fetch and checkout the failing branch
    env:
      TOKEN: ${{ secrets.GITHUB_TOKEN }}
      BRANCH: ${{ github.event.inputs.branch }}
      REPO: ${{ github.repository }}
    run: |
      git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
      git fetch origin "${BRANCH}"
      git checkout "${BRANCH}"
      echo "Checked out branch: $(git branch --show-current)"
  - name: Set APP_URL
    run: |
      echo "APP_URL=https://vibetestq-osondemand.orangehrm.com/" >> "$GITHUB_ENV"
  - name: Install npm dependencies
    run: npm ci
  - name: Install Playwright browser
    run: npx playwright install --with-deps chromium
  - name: Install Playwright browser for playwright-cli
    run: npx playwright-cli install-browser
  - name: Download failure report from failed validation run
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      RUN_ID: ${{ github.event.inputs.run_id }}
    run: |
      mkdir -p failure-report
      gh run download "${RUN_ID}" \
        --pattern "test-gen-failure-report-*" \
        --dir failure-report/ \
        || { echo "Could not download failure report — run may have expired"; exit 1; }
      # Flatten one extra directory level if gh created one
      find failure-report -name "cucumber-report.json" -not -path "failure-report/cucumber-report.json" \
        -exec mv {} failure-report/cucumber-report.json \; 2>/dev/null || true
      echo "Failure report contents:"
      ls -la failure-report/
---

# AGENT INSTRUCTIONS — Self-Healing Step Definitions

> [!CAUTION]
> **NEVER run `git add`, `git commit`, `git branch`, or `git push`.**
> The only write path is calling `create_pull_request` with all fixed files inline in the `files` array.
> The healing PR targets the original `test-gen` branch (not `main`) so it applies as a patch on top of the generated steps.

You are an expert automated test engineer. A Cucumber test run has failed because one or more
step definitions contain outdated or incorrect Playwright locators. The live application has likely
changed since the steps were generated. Your job is to fix the failing locators by re-exploring
the live app, confirm the fix by re-running the failing scenarios, and open a healing PR.

The app URL is: `https://vibetestq-osondemand.orangehrm.com/` (also in `$APP_URL`).

---

## Step 1 — Parse the Failure Report

Read the Cucumber JSON report to identify exactly what failed:

```bash
cat failure-report/cucumber-report.json
```

From the report, extract for **every failed step**:
- **Step text** — the exact Gherkin step that failed (e.g. `When I click the Submit button`)
- **Error message** — the Playwright error (usually a timeout or element-not-found with the locator name)
- **Scenario name** — the parent scenario (for re-running later)
- **Feature file path** — from the `uri` field in the report

Ignore scenarios with status `passed`, `skipped`, or `pending` — fix only `failed` steps.

---

## Step 2 — Map Failed Steps to Step Definition Files

For each failed step text, find which `.steps.ts` file contains its implementation:

```bash
grep -rn "failed step text fragment" steps/pages/
```

From the match, identify:
- The **step definition file**: `steps/pages/<pagename>.page.steps.ts`
- The **locator const** that the step uses (look at the const arrow function called inside the step body)
- The **current locator value** — what it is now vs what the browser currently exposes

---

## Step 3 — Understand the Navigation Path

Before navigating with `playwright-cli`, check the `Given` step in the same scenario to understand
how to reach the failing page. Open the step definition file and read the `Given` step implementation
to see what URL or navigation sequence it performs.

For login-protected pages: first navigate to the login page, log in, then navigate to the target page.

---

## Step 4 — Re-explore the Failing Page with `playwright-cli`

Open the failing page using the same `playwright-cli` commands as the test generator:

```bash
npx playwright-cli open $APP_URL
```

If the page requires login, navigate through the login flow step by step before capturing locators.

### 4a — Capture ARIA snapshot

```bash
npx playwright-cli snapshot
```

This is the ground truth for what elements currently exist on the page. Compare with the
locators in the step definition file — the failing locator likely references an element whose
role, name, or attribute has changed.

### 4b — DOM extraction for attributes

```bash
npx playwright-cli eval "() => {
  const sel = ['button','a[href]','input','select','textarea',
    '[role=button]','[role=link]','[role=tab]','[role=checkbox]',
    '[role=combobox]','[role=textbox]','[role=menuitem]'].join(', ');
  return JSON.stringify(Array.from(document.querySelectorAll(sel)).map(el => ({
    tag:         el.tagName.toLowerCase(),
    text:        el.textContent?.trim().slice(0,80) || null,
    placeholder: el.getAttribute('placeholder') || null,
    testId:      el.getAttribute('data-testid') || null,
    name:        el.getAttribute('name') || null,
    ariaLabel:   el.getAttribute('aria-label') || null,
    role:        el.getAttribute('role') || null,
    visible:     el.offsetParent !== null,
  })), null, 2);
}"
```

### 4c — Close the browser

```bash
npx playwright-cli close
```

---

## Step 5 — Identify the Correct Replacement Locator

Using the ARIA snapshot and DOM extraction, find the updated locator for the failing element.

Apply the same priority order as the test generator:

| Priority | Strategy | When |
|---|---|---|
| 1 | `getByRole('<role>', { name: '...' })` | Role + name in snapshot |
| 2 | `getByLabel('<label>')` | Form control with label |
| 3 | `getByPlaceholder('<text>')` | Input with placeholder |
| 4 | `getByTestId('<id>')` | data-testid present |
| 5 | `getByText('<text>')` | Non-interactive element |
| 6 | `locator('[name="<name>"]')` | Form name attribute |

**Never guess a locator.** Only use values literally present in the snapshot or DOM extraction output.

---

## Step 6 — Apply the Fix

Update the failing `const` locator arrow function at the top of the step definition file.

**Only change the locator value** — do not alter the step text, step structure, or any passing steps.

Before:
```typescript
const submitButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Submit' }).describe('Submit button');
```

After (example — use the actual value from the snapshot):
```typescript
const submitButton = (w: PSWorld) => w.page.getByRole('button', { name: 'Save' }).describe('Submit button');
```

Keep the `.describe()` text unchanged — it describes intent, not the current DOM value.

If multiple locators in the same file are broken, fix all of them before moving to Step 7.

---

## Step 7 — Re-run Only the Failing Scenarios

Run only the scenarios that were originally failing to confirm the fix:

```bash
npx cucumber-js <feature-file> --name "<scenario name>"
```

If multiple scenarios failed across multiple feature files, run each:

```bash
npx cucumber-js <feature-file-1> --name "<scenario-1>"
npx cucumber-js <feature-file-2> --name "<scenario-2>"
```

**Evaluate the result:**

- **All pass** → proceed to Step 8 (create healing PR)
- **Still failing** → attempt one more locator correction (re-run Steps 4–6 for the remaining failures)
- **Still failing after second attempt** → stop. Call `create_pull_request` with a `body` that documents
  what was tried and what the browser currently shows. Mark the PR title as `[needs-manual-fix]`.

---

## Step 8 — Create the Healing Pull Request

### 8a — Determine branch and base names

- **Failing branch input**: `${{ github.event.inputs.branch }}` (e.g. `test-gen/empmgmt`)
- **Healing branch**: append `-healed` → `test-gen/empmgmt-healed`
- **Base branch**: the original failing branch → `test-gen/empmgmt`

The healing PR targets the original `test-gen` branch, not `main`. Once merged, the original
PR (`test-gen/empmgmt → main`) automatically picks up the fixes.

### 8b — Call `create_pull_request`

```json
{
  "type": "create_pull_request",
  "draft": false,
  "branch": "test-gen/<basename>-healed",
  "base": "test-gen/<basename>",
  "commit_message": "fix(heal): correct locators in <pagename>.page.steps.ts\n\nSelf-healed by the heal-steps agentic workflow.\nOriginal failing PR: #<pr_number>",
  "title": "fix locators in <pagename>.page.steps.ts (PR #<pr_number>)",
  "body": "## Self-Healing Fix\n\nThis PR corrects locators that drifted from the live application.\n\n**Target PR**: #<pr_number> (`test-gen/<basename>`)\n\n### What changed\n\n| File | Locator | Was | Now |\n|------|---------|-----|-----|\n| `steps/pages/<pagename>.page.steps.ts` | `<constName>` | `<old value>` | `<new value>` |\n\n### Validation\n\nThe failing scenarios were re-run after the fix and passed:\n- ✅ <scenario name>\n\n### How to apply\n\nMerge this PR into `test-gen/<basename>`. The original PR will pick up the fix automatically and the `test-gen-validate` workflow will re-run.\n\n🤖 Self-healed by the [heal-steps](/.github/workflows/heal-steps.md) agentic workflow.",
  "files": [
    {
      "path": "steps/pages/<pagename>.page.steps.ts",
      "content": "<full corrected file content>"
    }
  ]
}
```

Replace all `<placeholders>` with actual values. Include one entry in `files` for each fixed step definition file.

---

## Critical Rules

- **Fix only what failed.** Do not modify passing steps, passing locators, or unrelated files.
- **Never hallucinate locators.** Every locator value must be literally present in the `playwright-cli snapshot` or `eval` output.
- **One healing attempt maximum.** If scenarios still fail after two locator correction rounds, open the PR anyway with documentation of what was found. Do not loop.
- **Never run git write commands.** All changes go through `create_pull_request` inline `files`.
- **Do not modify `support/world.ts` or `support/hooks.ts`.**
- **The healing PR targets the original `test-gen` branch**, not `main`.
- **Close the browser** with `playwright-cli close` after each page inspection.

---

## Done Criteria

1. Every scenario that was `failed` in the input report is now `passed` (or the PR documents why it cannot be auto-healed).
2. A healing PR is open targeting `test-gen/<basename>` with the corrected locator(s) in the `files` array.
3. The PR body lists exactly which locator changed, from what to what.
4. No locators were changed that were not broken.
