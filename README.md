# PSD Framework — Cucumber + Playwright + AI Agents

An AI-native test automation framework using **Page Step Definitions (PSD)** — write Gherkin, agents generate and heal the TypeScript.

## Quick Start

```bash
npm install
npx playwright install
npm test
```

## Allure reporting

```bash
npm run test:allure
npm run allure:report
```

The Allure results are written to the `allure-results` directory and the generated HTML report is placed in the `allure-report` directory.

## Running tests

```bash
npm test                                                         # all features
npx cucumber-js --dry-run                                        # list undefined steps without a browser
npx cucumber-js --profile files features/empmgmt.feature         # only the named feature file(s)
npx cucumber-js --profile files features/empmgmt.feature:9       # only one scenario (file:line)
npx cucumber-js --profile files @reports/rerun.txt               # only the scenarios that failed last time
```

With the default profile, Cucumber **adds** named files to the configured `paths` and still runs every
feature. The `files` profile (bottom of `cucumber.js`) has no `paths`, so only what you name runs.

## Self-healing runs: execution, maintenance and defects in parallel

```bash
npm run test:heal                                   # the suite with healing on + the heal monitor
npm run test:heal -- --profile files features/empadmin.feature   # extra arguments go to Cucumber
```

Two parts work side by side. Step definition files need **no changes** to use either of them.

| Part | File | What it does |
|---|---|---|
| **Cucumber step healer** (inside the run) | `support/step-healer.ts` | When a Cucumber step fails, GitHub Copilot (Claude Haiku 4.5, through the Copilot CLI) finds out why, finishes the step from the statement that failed, and proposes a corrected step definition file. The scenario continues. Off unless `STEP_HEAL=true`. |
| **Heal monitor** (beside the run) | `heal/orchestrator.ts` | Starts the run (Run A) with healing on, picks up each heal event as soon as it appears, verifies fixes and confirms defects with clean re-runs (at most 2 at a time), then writes the summary, one pull request with the verified fixes, and the trend history. |

```
Run A (healing on)                     Heal monitor (parallel)
step fails → healed ─────────────────► clean re-run of that scenario with the fix, healing off → ✅ verified / ❌ rejected
step fails → APPLICATION ────────────► clean re-run → same step fails again → GitHub issue (else "not reproduced")
step fails → Copilot gave up ────────► 👀 manual review
application not answering ───────────► one environment issue, healing stopped
Run A ends ──────────────────────────► waits only for work in progress → summary, pull request, history
```

### The Cucumber step healer, when a step fails

1. **Evidence** is captured at once: screenshot (also attached to the HTML report), accessibility
   snapshot, URL, and the scenario's Playwright trace.
2. **Environment check**: if the app does not answer, healing stops for the run and one environment event
   is raised; no Copilot calls are spent on a broken environment.
3. **Known fix?** A fix verified in an earlier run (not merged yet) or found earlier in this run is reused
   without a Copilot call. If another worker is healing the same failure right now, it waits for that fix.
4. **Pinpoint and context**: the failing statement is read from the error stack. Copilot sees the step
   function statement by statement, plus the feature file, the scenario's step statuses, the parameters,
   every step definition file the scenario uses, the error and the page as it was when the step failed:
   ```
    16   Then('I read the employee id from the employee id textbox and store it in a variable', ...
    17 ✗   const id = await employeeIdInput(this).inputValue();   <-- FAILED HERE
    18 ·   (this as any).employeeId = id;
   ```
5. **Investigate**: Copilot asks for read-only checks of the live page (snapshot, URL, or a locator's
   count, visibility, text and value, including chained locators). It must probe every new locator before
   proposing it, and only use one that matches exactly one visible element.
6. **Verdict, with a confidence (high / medium / low)**:
   - **APPLICATION**: the app does not behave as the feature file says. The step fails.
   - **STEP**: Copilot returns **RESUME** (the statements still to run, adapted to the current page) and
     **FILE** (the corrected step definition file). The file must compile with the project's TypeScript and
     keep the same step texts and imports; RESUME may not drop an assertion or define steps. RESUME runs
     now, so the step finishes without repeating what already ran, and the rest of the run uses the
     corrected definitions.
   - No usable answer within `STEP_HEAL_CALLS`: **manual review**.

The healer never writes step definition files; only fixes verified by the heal monitor are kept.

### The heal monitor, per event

| Event | Action | Result |
|---|---|---|
| healed | clean re-run of that scenario (copy of the suite + verified fixes + this fix, healing off) | ✅ **verified** when the healed step passes, ❌ **rejected** when it fails. If the re-run stopped at an earlier step, it waits for the run's other fixes and tries once more, else 👀 manual review |
| healed with a fix verified in an earlier run | none | ♻️ **reused** (no Copilot call, no re-run); included in the pull request again |
| application | clean re-run of the scenario | 🐞 **issue** when the same step fails again; 〰️ **not reproduced** otherwise |
| manual review | none | 👀 listed in the summary |
| environment | none | 🌐 one environment issue |

- **Issues** are labelled `app-defect` (confidence high) or `needs-triage` (medium/low). Each carries a
  fingerprint (page, step, kind of error); an open issue with the same fingerprint gets a comment instead.
- **One pull request per run** with every verified fix, its reason and changed lines. Never merged
  automatically.
- **Fix cache**: verified fixes are kept in `heal-history/fixes.json` until their step file changes, so
  the same failure is healed once, not every run.
- **Trend history**: each run is added to `heal-history/history.jsonl`; `heal-history/dashboard.html`
  shows passed/failed per run, heals, verified/rejected/reused fixes, defects and Copilot calls.
- Locally, issues and the pull request are only **drafted** under `reports/heal-run/<run>/` (`issues/`,
  `verified-fixes/`, `summary.md`). Set `STEP_HEAL_ISSUES=true` and `STEP_HEAL_PR=true` to create them
  (needs `gh` signed in). `reports/` and `heal-history/` are git-ignored.

**Run folder** `reports/heal-run/<run>/`: `events/`, `evidence/<id>/` (screenshot, snapshot, trace, URL),
`fixes/` (fixes found in this run), `verify/<id>/rerun.log`, `step-heals.jsonl`, `summary.md`, `issues/`,
`verified-fixes/`, `debug/` (with `STEP_HEAL_DEBUG=true`).

| Variable | Default | Meaning |
|---|---|---|
| `STEP_HEAL` | off | `true` turns the step healer on (`npm run test:heal` sets it) |
| `STEP_HEAL_MODEL` | `claude-haiku-4.5` | Copilot model |
| `STEP_HEAL_CALLS` | `5` | Copilot calls per failing step, page checks and retries included |
| `STEP_HEAL_MAX` | `5` | maximum healed steps per Cucumber process |
| `STEP_HEAL_TIMEOUT_MS` | `300000` | step timeout while healing is on |
| `STEP_HEAL_RESUME_ACTION_TIMEOUT_MS` | `15000` | action timeout while a proposed RESUME runs |
| `STEP_HEAL_PARALLEL` | `2` | clean re-runs at the same time |
| `STEP_HEAL_ISSUES` | off | `true` creates or comments GitHub issues |
| `STEP_HEAL_PR` | off | `true` pushes a branch and opens the pull request |
| `STEP_HEAL_DEBUG` | off | `true` keeps every Copilot prompt and reply |
| `COPILOT_GITHUB_TOKEN` | none | Copilot token in CI (locally your `copilot login` is used) |

Requirements: the GitHub Copilot CLI (`npm install -g @github/copilot`) with access to Claude Haiku 4.5.
Scenarios tagged `@no-step-heal` are never healed.

**Unique test data**: `{{run}}` in a step parameter is replaced with 6 hex characters that are unique per
run, e.g. `"Smith-{{run}}"`, so data never collides between runs. This works with or without healing.

## GitHub workflows

| Workflow | Kind | Trigger | What it does |
|---|---|---|---|
| `test-generator` | agentic (gh-aw, Claude Haiku 4.5) | push to `features/**/*.feature`, or manual | Generates the missing step definitions with `playwright-cli`, **runs the feature**, fixes its own new steps (max 3 runs), and opens a `[test-gen]` PR with the step files and a markdown verification report (`test-reports/<feature>.md`); the full report is the run artifact `psd-cucumber-report`. |
| `test-executor` | agentic (gh-aw, Claude Haiku 4.5) | push to `main` changing `features/`, `steps/`, `support/` or `cucumber.js`, or manual | Runs all features, re-runs failures once to rule out flakiness, reproduces each failure with `playwright-cli`, fixes step-definition failures, raises `[app-defect]` issues for application failures, and opens a `[test-heal]` PR only if step files changed. |
| `psd-heal-run` | GitHub Actions | manual (optional tag expression) | Runs `npm run test:heal` with issues and the pull request switched on, writes the job summary, keeps the history and fix cache in the Actions cache, and uploads reports, evidence and the dashboard as `psd-step-heal-report`. |
| `daily-repo-status`, `agentics-maintenance` | agentic / maintenance | schedule | Unchanged. |

The agentic workflows are compiled from their `.md` sources: edit the `.md`, then run
`gh aw compile`; never edit the `.lock.yml` files. All three need the `COPILOT_GITHUB_TOKEN` secret
(fine-grained personal access token with the "Copilot Requests" permission). `psd-heal-run` also needs
**Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

## Documentation

| Guide | Description |
|---|---|
| [Architecture](./docs/ARCHITECTURE.md) | Framework design, components, and data flow |
| [Writing Tests](./docs/WRITING-TESTS.md) | How to create feature files and trigger test generation |
| [Healing Failures](./docs/HEALING-FAILURES.md) | How to diagnose and fix broken step definitions |
| [GitHub Agentic Workflows](./docs/AGENTIC-WORKFLOWS.md) | How automated workflows generate and maintain tests |

## Core Concept

> Write Gherkin → agent generates steps → tests run. No manual page classes. No maintenance layers.

Steps follow a Page-Step-Definition (PSD) pattern under `steps/pages/`. Playwright objects are provided via `PSWorld` in `support/world.ts`. AI agents (VS Code `@Test Definition Generator`, `@Test Healer`) and GitHub Agentic Workflows handle all TypeScript generation and healing automatically.
