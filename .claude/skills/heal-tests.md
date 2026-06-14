---
name: heal-steps
description: Diagnoses and fixes failing Cucumber step definitions in the PSD (Page Step Definitions) framework. Use this skill whenever tests are failing, a step definition is broken, a locator is not found, an assertion is wrong, or a feature file run produces errors. Also trigger when the user says "fix failing steps", "heal the tests", "steps are broken", "locator not found", "fix the step", "tests are failing", "cucumber run failed", or shares a test error and asks for a fix. Always use this skill when the task involves diagnosing or repairing pagename.page.steps.ts files — never attempt to fix step definitions without it.
---

# Heal Steps Skill

Diagnoses and fixes broken `steps/pages/<pagename>.page.steps.ts` files in the PSD framework by running the feature, parsing the JSON report, exploring the live app with Playwright MCP, and applying the minimal fix needed.

There are **no Page Object Models** in this framework. The step definition file IS the page implementation.

---

## Workflow

### Step 1 — Run the Feature File
```
npx cucumber-js <feature-file>
```
Wait for it to complete. The run writes `cucumber-report.json` at the project root.

### Step 2 — Parse the JSON Report for Failures
Read `cucumber-report.json`. For every step where `result.status === "failed"`, extract:

| Field | Where in JSON | What it tells you |
|---|---|---|
| Step text | `steps[].name` | Which step failed |
| Step file + line | `steps[].match.location` | Exact location in the step definition file |
| Error message | `steps[].result.error_message` | Why it failed |
| Scenario name | `elements[].name` | Context for the failure |

Print a numbered failure list before doing any fixing:
```
Failures found:
1. "I should see the PIM module is accessible"
   File: steps/pages/dashboard.page.steps.ts:28
   Error: locator('...').first() — element(s) not found
```

If there are no failures — report that and stop. Do not touch any files.

### Step 3 — Classify Each Failure
Read the `error_message` and classify before taking any action:

| Error pattern | Classification | Fix strategy |
|---|---|---|
| `element(s) not found` / `locator ... not found` | **Locator broken** | Explore live page, find correct locator |
| `Expected: visible` / `toBeVisible` timeout | **Locator broken or timing** | Explore and fix locator; add `waitFor` if needed |
| `Expected ... to equal` / `toContain` | **Assertion wrong** | Explore live page, verify actual value, fix assertion |
| `page.goto` / navigation error | **Navigation broken** | Check `baseUrl` in `cucumber.js`, fix the `goto` call |
| TypeScript compile error | **Syntax/type error** | Read the file, fix the syntax — no browser exploration needed |

Print the classification for each failure before proceeding.

### Step 4 — Read the Failing Step Definition
Open the step file at the exact line from `steps[].match.location`. Read:
- The full step body — what it is trying to do and where it breaks
- The locator const block at the **top of the file** — the broken locator is defined there, not inline

### Step 5 — Inspect the Live App with Playwright MCP
For **Locator broken** and **Assertion wrong** failures only:

1. Call `browser_navigate` with the application base URL (from `cucumber.js`).
2. **Wait for the call to complete fully before doing anything else.**
3. Call `browser_snapshot` once to verify the context is live.
   - If blank or `about:blank` → call `browser_navigate` again, wait, and retry `browser_snapshot` once.
   - If still blank after retry → **STOP. Report:** *"Browser context is unavailable. Please check the VS Code Playwright MCP browser tab and retry."* Do not attempt any fix.
4. Never call `browser_navigate`, `browser_snapshot`, or `browser_evaluate` concurrently — wait for each to complete before making the next call.
5. Replay all **passing** steps that precede the failed step to reach the correct state.
6. Take a screenshot to confirm you are on the right page.

#### 5a — Call `browser_snapshot` via Playwright MCP (Primary)

Call the Playwright MCP `browser_snapshot` tool. This delivers the **computed ARIA tree** directly — no JavaScript needed. The MCP already resolves implicit roles, `aria-labelledby` references, and excludes `aria-hidden` elements.

The snapshot output looks like:
```
- heading "Dashboard" [level=1]
- textbox "Username" [ref=e5]
- button "Login" [ref=e10]
- button "Save" [disabled]
- checkbox "Remember me" [checked]
```

This is the ground truth: if the broken element's role + name appear here, `getByRole` will find it.

Record from the snapshot:
- `role` — computed role of the broken element
- `name` — computed accessible name
- `state` — disabled, checked, expanded (useful for assertion failures)

#### 5b — DOM Extraction for Attributes Not in the Snapshot (Fallback)

For attributes the `browser_snapshot` doesn't expose, run `page.evaluate()` via the MCP:

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

Use DOM extraction for: `getByPlaceholder`, `getByTestId`, `getByTitle`, `locator('[name="..."]')`.

#### 5c — Choose Replacement Locator from Inspection Output Only

Work through the full Locator Strategy priority table below. Use only values present in the `browser_snapshot` output or DOM extraction — never guess or infer. Verify the replacement resolves to **exactly one visible element** using `page.locator(...).count()` before writing it into code.

For **Syntax/type error** failures — skip this step entirely, go directly to Step 6.

### Step 6 — Fix the Step Definition
Edit only what is broken:

| Classification | What to fix |
|---|---|
| **Locator broken** | Update the locator const at the top of the file — replace only the broken const |
| **Assertion wrong** | Fix the `expect(...)` value in the step body to match the actual UI value |
| **Navigation broken** | Fix the `this.page.goto()` call in the step body |
| **Syntax/type error** | Fix the compile error in place |

**Locator const rules when fixing:**
- The fixed locator stays as a `const` arrow function at the top of the file — never moved inline.
- Signature: `(w: PSWorld) => w.page.<locator>.describe('<plain English description>')`.
- `.describe()` is **mandatory** — never remove or omit it when fixing.
- Navigation calls (`this.page.goto()`) stay in the step body — do NOT wrap in a locator const.

**Locator strategy when choosing a replacement:**
Follow the full priority order in the Locator Strategy section below — start from priority 1 and work down. Only use XPath (priority 13) for cases CSS and role locators cannot handle. Only use nth-match (priority 14) when every other strategy has been exhausted — add a comment explaining why.

**Never use:** long XPath chains, bare `.nth()` without exhausting all other strategies, auto-generated or hash-based IDs, layout-only class names.

**Assertion rules when fixing:**

| Step type | `expect` required? | Heal the assertion? |
|---|---|---|
| `Then` | ✅ Mandatory | ❌ Never remove or skip — `Then` IS the assertion. If it fails, fix the locator or the expected value it checks, not the assertion itself. |
| `Given` | ⚠️ Need basis only | ✅ Fix or remove if wrong — keep only if navigation/setup must be verified before proceeding |
| `When` | ⚠️ Need basis only | ✅ Fix or remove if wrong — keep only if a state change must be confirmed before the next step |

### Step 7 — Re-run and Verify
```
npx cucumber-js <feature-file>
```

Read the new `cucumber-report.json`:

- **All failures now pass** → report a fix summary:
  ```
  Fixed:
  1. "I should see the PIM module is accessible" — updated pimNavLink locator from
     locator('.menu-item').first() to getByRole('link', { name: 'PIM' })
  ```
- **Some still fail** → return to Step 3 for those steps only. Repeat up to **3 attempts total**.
- **Still failing after 3 attempts** → stop and report:
  ```
  Could not automatically heal after 3 attempts:
  1. "..." — last error: <error message>
     Suggested next step: <manual investigation hint>
  ```

---

## Locator Strategy

**Every replacement locator value must come from the Step 5a `browser_snapshot` or Step 5b DOM extraction — never assumed or inferred.**

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
- Any value not present in the Step 5 DOM extraction output
- Long XPath chains — only minimal XPath for parent traversal or attribute combos impossible in CSS
- `.nth()` without exhausting all other strategies first
- Auto-generated or hash-based IDs (e.g. `id="input_3842"`)
- Layout-only class names (e.g. `.oxd-padding-cell`)
- Assumed attribute values — if the extraction returned `null`, it does not exist

---

## Critical Rules

- **Fix only failing steps.** Never touch passing step definitions.
- **Never change the step text or regex.** The Gherkin binding is the contract — it is always correct.
- **Never change feature files.** The Gherkin is the source of truth.
- **DO NOT modify** `support/world.ts` or `support/hooks.ts`.
- **Fix files directly.** Never ask for confirmation before editing. Apply fixes to the workspace immediately.
- **Explore before you fix.** For locator and assertion failures, always call `browser_snapshot` first, then DOM extraction if needed. Never fix a locator from memory or assumption.
- **Never hallucinate locators.** Every replacement locator value must come from the Step 5a `browser_snapshot` output or Step 5b DOM extraction — never assumed or inferred.
- **Never fall back to assumptions if the browser is unavailable.** If `browser_snapshot` returns blank or about:blank after a retry — STOP. Do not fix any locators. Report the browser context failure. Prior knowledge of the application is never a substitute for live inspection.
- **One MCP tool call at a time.** Never call `browser_navigate`, `browser_snapshot`, or `browser_evaluate` concurrently. Wait for each call to complete and verify its output before making the next call.
- **Verify context before inspecting.** Always confirm `browser_snapshot` returns a non-blank ARIA tree before proceeding. If blank — navigate again and retry once before stopping.
- **Minimal changes.** Fix the broken locator const or assertion only — do not refactor surrounding code.
- **Locator consts stay at the top.** Never move a locator inline into a step body when fixing.
- **Always use `.describe()`.** Never omit or remove it from any locator const.
- **Never inline locators.** Fix the named const — never write `this.page.getBy...` inside a step body.
- **XPath only as second-to-last resort.** Use only for what CSS and role locators cannot do (e.g. parent traversal). Minimum expression only — no long chains.
- **nth-match is the absolute last resort.** Only use `getByRole().nth(n)` or `:nth-match()` when every other strategy including XPath has been exhausted. Add a comment on the const explaining why.
- **`Then` must always assert.** Every `Then` step must retain at least one `expect(...)`. If a `Then` fails, fix the locator or expected value it checks — never remove the assertion.
- **`Given` and `When` assert on need basis only.** Fix or remove assertions in these steps if wrong — keep only if a state change or setup must be confirmed.
- **Max 3 attempts.** Stop and report if the fix cannot be determined after 3 re-runs.

---

## Done Criteria

1. `npx cucumber-js <feature-file>` reports **zero failed steps**.
2. Every previously-failing step now passes — no passing steps were touched.
3. Every fixed locator const retains `.describe()` with a plain English description.
4. No locators were moved inline into step bodies during fixing.
5. Every replacement locator value was observed in the `browser_snapshot` or DOM extraction — none were assumed or inferred. If browser inspection was unavailable at any point, this is explicitly reported and no locators were generated without live verification.
6. Any XPath locator used is the minimum expression needed and is justified. Any nth locator has a comment explaining why all other strategies were exhausted.
7. All fixes applied directly to step definition files in the workspace — not presented as chat output.
8. A clear summary of what was changed and why has been reported.