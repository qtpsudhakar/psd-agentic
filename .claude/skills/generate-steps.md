---
name: generate-steps
description: Generates Cucumber step definition files (pagename.page.steps.ts) for the PSD (Page Step Definitions) framework from a Gherkin feature file. Use this skill whenever the user wants to generate, scaffold, create, or write step definitions, step files, or page steps from a feature file. Also trigger when the user says "generate steps for", "create step definitions", "implement steps for", "write steps for a feature", or pastes a feature file and asks for implementation. Always use this skill when the task involves producing pagename.page.steps.ts files — never freestyle step definitions without it.
---

# Generate Steps Skill

Generates `steps/pages/<pagename>.page.steps.ts` files for the PSD framework from a Gherkin feature file by exploring the live application with Playwright MCP.

There are **no Page Object Models** in this framework. The step definition file IS the page implementation.

---

## Workflow

### Step 1 — Dry Run
```
npx cucumber-js --dry-run <feature-file>
```
Note every step listed as **Undefined**. These are the only steps to implement. Do not re-implement steps that already exist.

### Step 2 — Identify Pages
Read the feature file and map each undefined step to the page it acts on. Every unique page gets its own file.

**Naming rule:** `steps/pages/<pagename>.page.steps.ts`

Derive page names from the step text and scenario context in the feature file — do not assume a fixed set of pages. The examples below are illustrative only:

| Step text (example) | Page derived | File created |
|---|---|---|
| "I navigate to the login page" | Login | `steps/pages/login.page.steps.ts` |
| "I should be on the dashboard" | Dashboard | `steps/pages/dashboard.page.steps.ts` |
| "I click Add Employee" | PIM | `steps/pages/pim.page.steps.ts` |
| "I fill in the employee form" | PIM (same page) | `steps/pages/pim.page.steps.ts` |

Your feature file will have different pages — read the steps, identify every unique page they touch, and create one file per page. If a step file already exists for a page, add only the missing steps — never duplicate.

### Step 3 — Inspect Each Page Before Writing Any Locator

For every page identified, navigate to it in the live browser and **use the Playwright MCP `browser_snapshot` tool as the primary source, then DOM extraction for anything the snapshot doesn't expose**.

**This step is mandatory. Every locator value must come from what is literally present in the inspection output — never assumed, guessed, or inferred.**

#### 3a — Navigate and Verify Browser Context

1. Call `browser_navigate` with the target URL.
2. **Wait for the call to complete fully before doing anything else.**
3. Call `browser_snapshot` once.
4. Check the snapshot output:
   - If it contains roles and element names → context is live, proceed to 3b.
   - If it returns blank, empty, or `about:blank` → call `browser_navigate` again with the same URL, wait, and retry `browser_snapshot` once.
   - If still blank after retry → **STOP. Do not generate any locators. Report:** *"Browser context is unavailable. Please check the VS Code Playwright MCP browser tab and retry."*
5. Never call `browser_navigate`, `browser_snapshot`, or `browser_evaluate` concurrently — wait for each tool call to complete and verify its output before making the next call.
6. Take a screenshot to confirm the correct page is visible.

#### 3b — Call `browser_snapshot` via Playwright MCP (Primary)

Call the Playwright MCP `browser_snapshot` tool. This delivers the **computed ARIA tree** directly — no JavaScript needed. The MCP already resolves:
- Implicit roles (`<button>` → `button`, `<h1>` → `heading`)
- `aria-labelledby` references automatically
- Excludes `aria-hidden` elements automatically

The snapshot output looks like:
```
- heading "Dashboard" [level=1]
- textbox "Username" [ref=e5]
- button "Login" [ref=e10]
- button "Save" [disabled]
- checkbox "Remember me" [checked]
```

For each element in the snapshot, record:
- `role` — e.g. `button`, `textbox`, `heading`, `link`, `checkbox`
- `name` — the computed accessible name (label text, aria-label, button text)
- `state` — disabled, checked, expanded (useful for assertions)

**This is the ground truth for `getByRole` — if it's not in the snapshot, `getByRole` won't find it.**

#### 3c — DOM Extraction for Attributes Not in the Snapshot (Fallback)

For elements where `browser_snapshot` didn't provide enough to build a unique locator, run `page.evaluate()` via the MCP to extract attributes the ARIA tree doesn't expose:

```javascript
await page.evaluate(() => {
  const results = [];
  const selector = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role=button]', '[role=link]', '[role=tab]', '[role=checkbox]',
    '[role=radio]', '[role=combobox]', '[role=textbox]', '[role=listbox]',
    '[role=menuitem]', '[role=option]', '[role=switch]', '[role=searchbox]',
    '[tabindex]:not([tabindex="-1"])'
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

  return results;
});
```

Use DOM extraction output for: `getByPlaceholder`, `getByTestId`, `getByTitle`, `locator('[name="..."]')`.

#### 3d — Build the Locator from Inspection Output Only

For each element, work through every strategy in order. **Only use a value if it was present in the `browser_snapshot` output or DOM extraction output.**

```
browser_snapshot has role + name?
  YES → getByRole('<role>', { name: '<name from snapshot>' })  ← most reliable
  NO  ↓
DOM has placeholder?
  YES → getByPlaceholder('<placeholder>')
  NO  ↓
DOM has testId?
  YES → getByTestId('<testId>')
  NO  ↓
DOM has title?
  YES → getByTitle('<title>')
  NO  ↓
Snapshot has text (non-interactive)?
  YES → getByText('<text>')
  NO  ↓
DOM has name attribute?
  YES → locator('<tag>[name="<name>"]')
  NO  ↓
Locator matches more than one element?
  YES → narrow with .filter({ hasText / has / visible })
        or .and(page.getBy...)
  NO  ↓
Container/ancestor context available?
  YES → parent.locator('<child>') or getByRole().filter({ hasText: '...' })
  NO  ↓
Stable semantic CSS class present? (non-layout, non-generated)
  YES → locator('<tag>.<semantic-class>')
  NO  ↓
Re-inspect snapshot and DOM fully — check aria-describedby, aria-owns, sibling text.
  FOUND something → apply above strategies with newly found value
  NO  ↓
Only XPath can solve this? (e.g. parent traversal)
  YES → locator('xpath=<minimal expression>') — minimum only, no long chains
  NO  ↓
LAST RESORT — no distinguishing attribute found anywhere:
  → getByRole('<role>').nth(<n>) or locator(':nth-match(<selector>, <n>)')
    Add a comment on the locator const explaining WHY nth was unavoidable.
```

**Never skip ahead to XPath or nth-match while earlier strategies remain untried.**

#### 3e — Verify Before Finalising

Before writing the locator into code, verify it resolves to **exactly one visible element**:
```javascript
await page.locator('<your locator>').count()  // must return 1
```
If it returns 0 or more than 1 — go back to 3d and try the next strategy.


### Step 4 — Implement Step Definitions
Write each undefined step in the correct `<pagename>.page.steps.ts` file.

**Always follow this file structure:**

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
// Add DataTable to the import above only when a step in this file uses a data table:
// import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';

// ─── <Page Name> Locators ──────────────────────────────────────────────────
// All locators for this page as const arrow functions.
// Navigation calls like this.page.goto() stay in the step body — not here.

const usernameInput   = (w: PSWorld) => w.page.getByLabel('Username').describe('Username input field');
const passwordInput   = (w: PSWorld) => w.page.getByLabel('Password').describe('Password input field');
const loginButton     = (w: PSWorld) => w.page.getByRole('button', { name: 'Login' }).describe('Login submit button');
const dashboardHeader = (w: PSWorld) => w.page.getByRole('heading', { name: 'Dashboard' }).describe('Dashboard page header');

// ─── <Page Name> Steps ─────────────────────────────────────────────────────

Given('I navigate to the login page', async function (this: PSWorld) {
  await this.page.goto('/');
  await expect(loginButton(this)).toBeVisible();
});

When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
  await usernameInput(this).fill(username);
  await passwordInput(this).fill(password);
  await loginButton(this).click();
  // no assertion — the Then step that follows verifies the outcome
});

Then('I should be on the dashboard', async function (this: PSWorld) {
  await expect(dashboardHeader(this)).toBeVisible();
});
```

### Step 5 — Handle Data from the Feature File
All test data comes from Gherkin — never hardcode or generate data inside steps.

**Inline parameters:**
```typescript
When('I login with valid credentials {string} and {string}', async function (this: PSWorld, username: string, password: string) {
  await usernameInput(this).fill(username);
  await passwordInput(this).fill(password);
});
```

**Data tables:**
```typescript
When('I add a new employee with the following details:', async function (this: PSWorld, dataTable: DataTable) {
  const data = dataTable.rowsHash();
  await firstNameInput(this).fill(data['First Name']);
  await lastNameInput(this).fill(data['Last Name']);
});
```

Add `DataTable` to the `@cucumber/cucumber` import line — never as a separate import.

---

## Locator Const Rules

- Every locator is a `const` arrow function **at the top of the file**, before any step.
- Signature: `(w: PSWorld) => w.page.<locator>.describe('<plain English description>')`.
- `.describe()` is **mandatory** on every locator — never omit it.
- Call in steps as `locatorName(this)` — **never** write `this.page.getBy...` inline in a step body.
- Navigation (`this.page.goto()`) stays directly in the step body — not in a locator const.
- Name by purpose, not HTML structure: `loginButton` not `submitBtn`.
- One locator per const — even if only used in one step.

**Why `.describe()` matters:**

Without: `Error: getByRole('button', { name: 'Login' }) resolved to 3 elements`
With: `Error: Login submit button resolved to 3 elements`

---

## Locator Strategy

**Every locator value must come from the Step 3b `browser_snapshot` output or Step 3c DOM extraction — never assumed or inferred.**

Work through every strategy in order. Only proceed to the next when the current one is not possible or produces more than one match.

| Priority | Strategy | When to use |
|---|---|---|
| 1 | `getByRole('<role>', { name: '...' })` | Role + name/ariaLabel present in DOM |
| 2 | `getByLabel('<label>')` | Form control with associated label |
| 3 | `getByPlaceholder('<placeholder>')` | Input with placeholder, no label |
| 4 | `getByTestId('<testId>')` | data-testid present |
| 5 | `getByTitle('<title>')` | title attribute present |
| 6 | `getByText('<text>')` | Non-interactive elements; use getByRole for interactive |
| 7 | `locator('[name="<name>"]')` | Form elements with name attribute |
| 8 | `.filter({ hasText / has / visible })` | Multiple matches — narrow down with filter |
| 9 | `.and(page.getBy...)` | Combine two locators to get unique match |
| 10 | `parent.locator('<child>')` | Scope to ancestor container |
| 11 | `locator('<tag>.<semantic-class>')` | Stable non-generated CSS class |
| 12 | Re-inspect DOM fully | Check aria-describedby, aria-owns, sibling text |
| 13 | `locator('xpath=<minimal expression>')` | **Only for what CSS/role cannot do** e.g. parent traversal |
| 14 | `getByRole().nth(n)` or `:nth-match()` | **Absolute last resort** — document why in a comment |

Always chain `.describe('<plain English description>')` on every locator.

**Never use:**
- Any value not present in the Step 3b extraction output
- Long XPath chains — only minimal XPath for parent traversal or attribute combos impossible in CSS
- `.nth()` without exhausting all other strategies first
- Auto-generated or hash-based IDs (e.g. `id="input_3842"`)
- Layout-only class names (e.g. `.oxd-padding-cell`)
- Assumed attribute values — if the extraction returned `null`, it does not exist

---

## Assertion Rules

| Step | `expect` required? | When |
|---|---|---|
| `Then` | ✅ **Mandatory** | Always — `Then` IS the assertion |
| `Given` | ⚠️ Need basis | Only when navigation/setup must be confirmed before proceeding |
| `When` | ⚠️ Need basis | Only when an action triggers a state change that must be confirmed |

---

## Critical Rules

- **NEVER use Page Object Models.** The step definition IS the implementation.
- **DO NOT modify** `support/world.ts` or `support/hooks.ts`.
- **Only implement undefined steps** from the dry run — never re-implement existing ones.
- **One file per page** — all steps for the same page go in the same file.
- **All locators at the top** — declared as `const` before the first step.
- **Never inline locators** inside step bodies — always use the named const.
- **Always use `.describe()`** on every locator — never omit it.
- **Never hallucinate locators.** Every role name, label, placeholder, testId, or class used in a locator must be literally present in the Step 3b `browser_snapshot` output or Step 3c DOM extraction output. If it was not observed in the live browser — do not use it.
- **Never fall back to assumptions if the browser is unavailable.** If `browser_snapshot` returns blank or about:blank after a retry — STOP. Do not generate any locators. Report the browser context failure. Prior knowledge of the application is never a substitute for live inspection.
- **One MCP tool call at a time.** Never call `browser_navigate`, `browser_snapshot`, or `browser_evaluate` concurrently. Wait for each call to complete and verify its output before making the next call.
- **Verify context before inspecting.** Always confirm `browser_snapshot` returns a non-blank ARIA tree before proceeding. If blank — navigate again and retry once before stopping.
- **Explore before you code** — confirm every locator in the live browser first. No locator may be written from memory, assumption, or prior knowledge of the app.
- **XPath only as second-to-last resort.** Use XPath only for cases that CSS and role-based locators cannot handle — e.g. parent traversal (`xpath=..`). Use the minimum XPath expression needed. Never use long XPath chains.
- **nth-match is the absolute last resort.** Only use `getByRole().nth(n)` or `:nth-match()` when every other strategy including XPath has been exhausted. Always add a comment on the locator const explaining why nth was unavoidable.
- **Create files directly** — never ask for confirmation, never present code in chat for the user to copy.

---

## Done Criteria

1. `npx cucumber-js --dry-run` reports **zero undefined steps**.
2. Every step file compiles without TypeScript errors (`npx tsc --noEmit`).
3. Every `Then` has at least one `expect(...)`. `Given`/`When` assert only on need basis.
4. Every locator const has `.describe()` with a plain English description.
5. No locators are inlined inside step bodies.
6. All files written directly to `steps/pages/` — not presented as chat output.
7. Every locator value (role name, label, placeholder, testid) was observed in the live accessibility tree or DOM — none were assumed or inferred.