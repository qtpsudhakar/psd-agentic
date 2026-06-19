# Healing Test Failures

This guide explains what to do when tests fail and how the Test Healer agent diagnoses and fixes broken step definitions automatically.

---

## Why Tests Break

In the PSD framework, tests can break for four reasons:

| Cause | Example | What breaks |
|---|---|---|
| **Locator broken** | The app was updated — a button's label changed | `steps/pages/*.page.steps.ts` locator factory function |
| **Assertion wrong** | Expected text changed (e.g. page title updated) | `expect(...)` assertion in a `Then` step |
| **Navigation broken** | App URL structure changed | `this.page.goto(...)` call |
| **Syntax/type error** | TypeScript compile failure after a manual edit | Step file won't compile |

The Test Healer agent handles all four cases automatically.

---

## Step 1 — Run the Tests and See What Failed

```bash
npx cucumber-js features/your-feature.feature
```

Or run all features:

```bash
npm test
```

The run always writes two report files:
- `cucumber-report.json` — machine-readable, used by the healer agent
- `cucumber-report.html` — human-readable, open in a browser

---

## Step 2 — Open the HTML Report (Optional)

Open `cucumber-report.html` in your browser for a visual summary:

```bash
start cucumber-report.html   # Windows
open cucumber-report.html    # macOS
```

Failed steps are highlighted in red with the full error message.

---

## Step 3 — Invoke the Test Healer

### Option A: VS Code Agent (Recommended for Local Failures)

Open GitHub Copilot Chat and type:

```
@Test Healer heal failures in features/empmgmt.feature
```

The agent will:
1. Run the feature file
2. Read `cucumber-report.json` to find every failed step
3. Print a numbered list of failures with file location and error
4. Classify each failure (locator, assertion, navigation, syntax)
5. Navigate the live app for each locator/assertion failure
6. Find the correct element using the Playwright MCP accessibility snapshot
7. Update **only** the broken locator factory function or assertion — nothing else

> **Prerequisite:** The Playwright MCP server must be running:
> ```bash
> npx @playwright/mcp@latest --port 3000
> ```

### Option B: Manual Workflow Dispatch (CI Healer)

In GitHub:
1. Go to **Actions** → **test-healer** (if configured)
2. Click **Run workflow**
3. Enter the feature file path

---

## What the Healer Changes (and What It Does Not)

### The healer WILL change:
- The locator value inside a factory function (e.g. `getByRole('button', { name: 'Submit' })` → `getByRole('button', { name: 'Save' })`)
- An assertion's expected value (e.g. `toHaveText('Welcome')` → `toHaveText('Dashboard')`)
- A navigation URL (e.g. `goto('/login')` → `goto('/auth/login')`)
- TypeScript syntax errors introduced by prior edits

### The healer WILL NOT change:
- Feature files (`.feature`) — step text is never modified
- Step signatures — the Gherkin binding string is never changed
- Other passing steps — only failing steps are touched
- `support/world.ts` or `support/hooks.ts`

---

## Understanding the Failure Classification

When the healer runs, it prints a classified failure list before making any changes:

```
Failures found:
1. "I should see the PIM module is accessible"
   File: steps/pages/dashboard.page.steps.ts:28
   Error: locator('.nav-item').first() — element(s) not found
   Classification: LOCATOR BROKEN → will explore live page

2. "Then the employee count should be displayed"
   File: steps/pages/pim.page.steps.ts:45
   Error: Expected: "Total 10 Records" | Received: "Total 12 Records"
   Classification: ASSERTION WRONG → will explore live page

3. "I navigate to the login page"
   File: steps/pages/login.page.steps.ts:12
   Error: page.goto: net::ERR_NAME_NOT_RESOLVED
   Classification: NAVIGATION BROKEN → check baseUrl in cucumber.js
```

This list lets you verify the healer's plan before it writes any files.

---

## Manual Healing (When Agent Is Not Available)

If you need to fix a step manually:

### 1. Find the failing locator

Open `cucumber-report.json` and look for:
```json
{
  "name": "I should see the PIM module",
  "match": { "location": "steps/pages/dashboard.page.steps.ts:28" },
  "result": {
    "status": "failed",
    "error_message": "locator ... not found"
  }
}
```

### 2. Open the step file at the given line

The error points to the step body. The locator factory is declared at the top of the file. Find the const that the step is calling.

### 3. Inspect the live app

Navigate to the page in your browser. Open DevTools and inspect the element. Use the **Accessibility tree** panel (DevTools → Elements → Accessibility tab) to find the ARIA role and accessible name.

### 4. Update the locator factory function

```typescript
// Before (broken):
const pimNavLink = (w: PSWorld) =>
  w.page.locator('.nav-item-pim').describe('PIM navigation link');

// After (fixed):
const pimNavLink = (w: PSWorld) =>
  w.page.getByRole('link', { name: 'PIM' }).describe('PIM navigation link');
```

### 5. Re-run to verify

```bash
npx cucumber-js features/empmgmt.feature
```

---

## Preventing Failures

### Use ARIA-based locators (most stable)

```typescript
// Most stable — uses semantic role and accessible name
w.page.getByRole('button', { name: 'Save' })
w.page.getByRole('textbox', { name: 'Username' })
w.page.getByRole('link', { name: 'PIM' })

// Good — uses visible label text
w.page.getByLabel('First Name')

// Fragile — breaks when CSS class names change
w.page.locator('.btn-primary.save-action')  // avoid

// Very fragile — breaks when DOM structure changes
w.page.locator('div > form > div:nth-child(3) > input')  // avoid
```

### Add explicit waits for dynamic content

```typescript
// Wait for a specific element to appear before asserting
await expect(successBanner(this)).toBeVisible({ timeout: 10000 });
```

### Use `.describe()` on every locator

This makes error messages self-explanatory:
```typescript
const saveButton = (w: PSWorld) =>
  w.page.getByRole('button', { name: 'Save' }).describe('Save employee button');
// Error will read: "Save employee button: element not found"
// instead of: "getByRole('button', { name: 'Save' }): element not found"
```
