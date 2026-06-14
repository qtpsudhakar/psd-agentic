---
name: heal-tests
description: Run a Cucumber feature file, identify failed steps from the JSON report, fix the broken step definition code using live Playwright MCP exploration, and re-run to verify.
---

<command-name>heal-tests</command-name>

# Skill: heal-tests

Invoke this skill when the user types `/heal-tests [feature-file-path]`.

## What you must do

You are running the PSD test-healing workflow. Follow every step below in order. Do not skip steps.

---

### 0. Resolve the feature file

If the user provided a path, use it directly.
If no path was given, list `features/*.feature` and ask the user which one to target.

---

### 1. Run the feature file

```
npx cucumber-js <feature-file>
```

Wait for completion. This always writes `cucumber-report.json` at the project root.

---

### 2. Parse failures from cucumber-report.json

Read `cucumber-report.json`. Collect every step where `result.status === "failed"`.

For each failure, extract:
- **Step text** — `steps[].name`
- **Step file + line** — `steps[].match.location` (e.g. `steps/pages/dashboard.page.steps.ts:28`)
- **Error message** — `steps[].result.error_message`
- **Scenario** — `elements[].name`

Print a numbered list before doing any work:

```
Failures:
1. Scenario: "End to End flow"
   Step:  "I should see the PIM module is accessible"
   File:  steps/pages/dashboard.page.steps.ts:28
   Error: locator('...').first() — element(s) not found (timeout 10000ms)
```

If there are zero failures, report "All steps passed" and stop.

---

### 3. Classify each failure

| Error pattern | Type | Fix approach |
|---|---|---|
| `element(s) not found` / locator timeout | Locator broken | Explore live UI, replace locator |
| `toBeVisible` / `toBeEnabled` timeout | Locator broken or timing | Fix locator; use built-in auto-waiting matchers |
| `Expected ... to equal/contain` | Wrong assertion value | Explore live UI, correct the expected value |
| Navigation / `page.goto` error | URL broken | Check `cucumber.js` baseUrl, fix navigation |
| TypeScript / syntax error | Code error | Read file, fix syntax — no browser needed |

---

### 4. Read the failing step definition

Open the file and line from `match.location`. Read the full step body to understand what it does and where it breaks.

---

### 5. Explore the live app (for locator and assertion failures)

Base URL: **`https://vibetestq-osondemand.orangehrm.com/`** (confirm from `cucumber.js` → `worldParameters.baseUrl`).

1. Navigate to the app and execute all **passing** preceding steps to reach the correct page state.
2. Take a screenshot to confirm you are on the right page.
3. Inspect the DOM / accessibility tree to find the correct element.
4. Confirm the locator matches exactly one visible element.

**Locator priority:**
1. `getByRole('...', { name: '...' })` — always try first
2. `getByLabel()` / `getByPlaceholder()` / `getByText()` / `getByAltText()`
3. `getByTestId()`
4. `locator('.class:has-text(...)')` — last resort
5. Never XPath. Never bare `.nth(0)` without a scoping context.

---

### 6. Fix the step definition

Edit only the **body** of the failing step:

- Never change the step text or regex — that breaks the Gherkin binding.
- Never touch passing step definitions.
- Never modify `support/world.ts` or `support/hooks.ts`.
- Replace the broken locator or correct the assertion value.
- Keep the `expect(...)` assertion — correct it, never delete it.
- Use Playwright's built-in auto-waiting matchers (`toBeVisible`, `toBeEnabled`) instead of `waitForTimeout`.

---

### 7. Re-run and verify

```
npx cucumber-js <feature-file>
```

Read the new `cucumber-report.json`.

- **All previously-failed steps now pass** → report a summary of what was fixed and what changed.
- **Some steps still fail** → go back to step 3 for those steps only. Repeat up to **3 times** total.
- **Still failing after 3 attempts** → stop and report what was tried and what the remaining error is. Do not guess further.

---

## Hard rules — never violate these

- **Fix only failing steps.** Passing steps are off-limits.
- **Feature files are the contract.** Never modify them.
- **Explore before you fix.** For any locator or assertion failure, confirm the correct value in the live browser before writing it.
- **Minimal change.** Fix the broken line(s) only — no refactoring, no cleanup.
- **All data stays in the feature file.** Do not introduce hardcoded values or generated data in step bodies.
- **Always keep assertions.** Fix them if the expected value is wrong, but never remove them.
