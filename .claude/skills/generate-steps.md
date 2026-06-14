---
name: generate-steps
description: Explore a live app with Playwright MCP, identify pages from a Gherkin feature file, and generate steps/pages/<pagename>.page.steps.ts step definition files.
---

<command-name>generate-steps</command-name>

# Skill: generate-steps

Invoke this skill when the user types `/generate-steps [feature-file-path]`.

## What you must do

You are running the PSD test-generation workflow. Follow every step below in order. Do not skip steps.

### 0. Gather project context (do this once before anything else)

Read these two files so you have the facts you need before touching the browser or writing code:

| File | What to extract |
|---|---|
| `cucumber.js` | `worldParameters.baseUrl` — this is the URL to navigate to when exploring |
| feature file | Step text and any inline parameters or data tables — these define what data the steps receive |

Current known values (verify against the files in case they changed):
- **baseUrl:** `https://vibetestq-osondemand.orangehrm.com/`

### 1. Resolve the feature file

If the user provided a path as an argument, use it directly.
If no path was given, list `features/*.feature` and ask the user which one to use.

### 2. Dry run — find undefined steps

Run:
```
npx cucumber-js --dry-run <feature-file>
```

Parse the output and collect every step marked **Undefined**. Print a numbered list of them so the user can see what will be implemented. If all steps are already defined, report that and stop.

### 3. Identify pages from the feature file

Read the feature file. Map each step (defined or undefined) to the page it operates on. Derive the output file name for each page using the rule:

```
steps/pages/<pagename>.page.steps.ts
```

Print a table: Step text → Page → File.

### 4. Explore the application with Playwright MCP

For each page identified in step 3:
1. Navigate to that page in the live browser (run any preceding steps that are already defined to reach the correct state).
2. Take a screenshot.
3. Inspect the accessibility tree / DOM to discover locators for every element the undefined steps will interact with.
4. Record the best locator using the priority order below — confirm it returns exactly one element before moving on.

**Locator priority:**
1. `getByRole('...', { name: '...' })` — always try first
2. `getByLabel()` / `getByPlaceholder()` / `getByText()` / `getByAltText()`
3. `getByTestId()`
4. `locator('css:has-text(...)')` / `locator('.class:near(...)')` — last resort
5. Never XPath. Never bare `.nth(0)` without scoping context.

### 5. Write the step definitions

For each undefined step, write the implementation in the correct `steps/pages/<pagename>.page.steps.ts` file.

**If the file does not exist**, create it with this header:
```typescript
import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PSWorld } from '../../support/world';
```

**If the file already exists**, append only the new steps — never duplicate an existing step definition.

Every step must:
- Cast `this` as `PSWorld`: `async function (this: PSWorld)`
- Use `this.page` for all Playwright actions
- **Receive all data from the feature file** — never hardcode or generate values inside step code
- End with at least one `expect(...)` assertion that confirms the resulting UI state

**Data passing patterns — match the pattern used in the feature file:**

Inline string parameters:
```typescript
When('I login with valid credentials {string} and {string}',
  async function (this: PSWorld, username: string, password: string) {
    await this.page.getByLabel('Username').fill(username);
    await this.page.getByLabel('Password').fill(password);
  });
```

Data table (import `DataTable` from `@cucumber/cucumber`):
```typescript
When('I add a new employee with the following details:',
  async function (this: PSWorld, dataTable: DataTable) {
    const data = dataTable.rowsHash();
    await this.page.getByLabel('First Name').fill(data['First Name']);
    await this.page.getByLabel('Last Name').fill(data['Last Name']);
  });
```

### 6. Verify

After writing all files, run:
```
npx cucumber-js --dry-run <feature-file>
```
again. Every previously-undefined step must now show as **Skipped** (not Undefined) — dry-run skips execution but confirms the step definition exists. Report the result to the user.

---

## Hard rules — never violate these

- **No Page Object Models.** The step file IS the implementation.
- **Do not modify** `support/world.ts` or `support/hooks.ts`.
- **All test data comes from the feature file** — step parameters, data tables, or Examples tables. Never generate or hardcode data in step code.
- **Explore before you code.** Never write a locator you haven't confirmed in the live browser.
- **One file per page.** All steps for a given page live in the same `<pagename>.page.steps.ts`.
- **Always assert after acting.** Every user action must be followed by an `expect(...)`.
- **Import `expect` from `@playwright/test`**, not from chai or any other library.
