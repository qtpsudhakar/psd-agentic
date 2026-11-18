/**
 * Cucumber step healer — GitHub Copilot (Claude Haiku) diagnoses a failing Cucumber step, finishes it
 * from the point of failure, and proposes a corrected step definition file. Off unless STEP_HEAL=true.
 * Step definition files need no changes to use it.
 *
 * Always on (also without STEP_HEAL): `{{run}}` in a step parameter is replaced by a short id that is
 * unique per run, so test data never collides between runs (e.g. "Smith-{{run}}").
 *
 * When a step fails (STEP_HEAL=true):
 *  1. Evidence is captured at once: screenshot, accessibility snapshot, URL (and a Playwright trace of
 *     the scenario, saved when the scenario ends).
 *  2. Environment check: if the application does not answer, healing stops for the rest of the run and
 *     one "environment" event is emitted — no Copilot calls, no defects.
 *  3. Pinpoint + context: the failing statement is marked in the step function; Copilot also gets the
 *     feature file, step statuses, parameters, every step file the scenario uses, the error and the page.
 *  4. Investigate: Copilot may ask for read-only checks of the live page.
 *  5. Verdict (with a confidence):
 *     - APPLICATION → the step fails; an "application" event is emitted.
 *     - STEP → Copilot returns RESUME (statements that finish the step from where it failed) and FILE
 *       (the corrected step definition file). RESUME runs now; if it passes the step counts as passed,
 *       the rest of this run uses the corrected definitions, and a "healed" event carries the corrected file.
 *     - no usable answer within STEP_HEAL_CALLS → the step fails; a "manual-review" event is emitted.
 *  The healer never writes step definition files. The heal monitor (heal/orchestrator.ts) picks up
 *  the events, verifies fixes with a clean re-run, confirms defects, and raises issues / a pull request.
 *
 * Scenarios tagged @no-step-heal are never healed.
 *
 * Settings (environment variables):
 *   STEP_HEAL=true           enable healing
 *   STEP_HEAL_MODEL          Copilot model (default claude-haiku-4.5)
 *   STEP_HEAL_CALLS          Copilot calls per failing step, page checks and retries included (default 5)
 *   STEP_HEAL_MAX            maximum healed steps per Cucumber process (default 5)
 *   STEP_HEAL_TIMEOUT_MS     step timeout while healing is on (default 300000)
 *   STEP_HEAL_DEBUG=true     keep every prompt and reply
 *   STEP_HEAL_EVENTS_DIR     set by the heal monitor: where events are written
 *   RUN_ID                   set by the heal monitor: the run id ({{run}} uses its last 6 characters)
 *   COPILOT_GITHUB_TOKEN     token for the Copilot CLI in CI (locally your `copilot login` is used)
 */
import * as cucumber from '@cucumber/cucumber';
import { After, AfterStep, Before, BeforeStep, setDefaultTimeout, setDefinitionFunctionWrapper } from '@cucumber/cucumber';
import { CucumberExpression, Expression, ParameterTypeRegistry, RegularExpression } from '@cucumber/cucumber-expressions';
import { execFile, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import type { Locator, Page } from 'playwright';
import type { PSWorld } from './world';

const enabled = process.env.STEP_HEAL === 'true';
const model = process.env.STEP_HEAL_MODEL ?? 'claude-haiku-4.5';
const maxCalls = Number(process.env.STEP_HEAL_CALLS ?? 5);
const maxHeals = Number(process.env.STEP_HEAL_MAX ?? 5);
const stepTimeout = Number(process.env.STEP_HEAL_TIMEOUT_MS ?? 300000);
const resumeActionTimeout = Number(process.env.STEP_HEAL_RESUME_ACTION_TIMEOUT_MS ?? 15000); // a wrong RESUME fails fast
const eventsDir = process.env.STEP_HEAL_EVENTS_DIR;
const runDir = eventsDir ? path.dirname(eventsDir) : path.join('reports', 'step-heal');
const logFile = path.join(runDir, 'step-heals.jsonl');
// {{run}}: 6 hex characters — from RUN_ID (same for every process of a run), otherwise random per process.
// Used in data the app requires to be unique, such as the Employee Id (OrangeHRM allows up to 10 characters).
const runToken = process.env.RUN_ID
  ? crypto.createHash('sha1').update(process.env.RUN_ID).digest('hex').slice(0, 6)
  : crypto.randomBytes(3).toString('hex');
const stepsDir = 'steps';
const fixesDir = path.join(runDir, 'fixes'); // fixes found in this run, shared by all workers
const verifiedFixesFile = path.join('heal-history', 'fixes.json'); // fixes verified in earlier runs

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScenarioState {
  feature: string;
  line: number;
  scenario: string;
  steps: { id: string; text: string; status: string }[];
  skip: boolean;
  healedDefs: StepDef[];
  evidenceDir?: string; // first failure's evidence — the scenario trace is saved there
}
interface CurrentStep { id: string; text: string; type: string }
interface StepDef { pattern: string | RegExp; fn: Function; expression: Expression }
interface Evidence { dir: string; url: string; snapshot: string }
export interface HealEvent {
  id: string;
  type: 'healed' | 'application' | 'manual-review' | 'environment';
  time: string;
  runId?: string;
  feature: string; // posix path
  line: number; // scenario line in the feature file
  scenario: string;
  step: string;
  file?: string; // posix path of the step definition file
  original?: string;
  corrected?: string;
  resume?: string;
  changes?: string[];
  failedStatement?: string;
  error: string;
  errorDetail?: string; // first lines of the error message (expected / received)
  verdict: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  copilotCalls: number;
  probes: number;
  evidence?: string; // posix path of the evidence folder
  url?: string;
  cacheKey?: string; // identifies the same failure across workers and runs
  fromCache?: 'run' | 'verified'; // healed with a fix found earlier in this run / verified in an earlier run
  verifiedInRun?: string;
}
type ProbeStep = { method: string; args?: unknown[] };
type Probe = { probe: 'snapshot' } | { probe: 'url' } | { probe: 'locator'; method?: string; args?: unknown[]; chain?: ProbeStep[] };

// ─── State ──────────────────────────────────────────────────────────────────

const registry = new ParameterTypeRegistry();
const overrides: (StepDef & { file: string; source: string })[] = []; // corrected definitions used for the rest of the run
let healedCount = 0;
let environmentDown = false;
let sequence = 0;

// ─── Registration ───────────────────────────────────────────────────────────

if (enabled) {
  if (!eventsDir) {
    // without the monitor the log and the fix cache only describe this run
    fs.rmSync(logFile, { force: true });
    fs.rmSync(fixesDir, { recursive: true, force: true });
  }
  setDefaultTimeout(stepTimeout);
  console.log(`[step-heal] Cucumber step healer on (model ${model})`); // printed by each Cucumber process

  Before(async function (this: PSWorld, { pickle, gherkinDocument }) {
    (this as any).__heal = {
      feature: pickle.uri.replace(/\\/g, '/'),
      line: scenarioLine(gherkinDocument, pickle.astNodeIds),
      scenario: pickle.name,
      steps: pickle.steps.map(s => ({ id: s.id, text: s.text, status: 'not run' })),
      skip: pickle.tags.some(t => t.name === '@no-step-heal'),
      healedDefs: [],
    } satisfies ScenarioState;
    await this.context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
  });

  BeforeStep(function (this: PSWorld, { pickleStep }) {
    (this as any).__currentStep = { id: pickleStep.id, text: pickleStep.text, type: String(pickleStep.type ?? '') } satisfies CurrentStep;
  });

  AfterStep(function (this: PSWorld, { pickleStep, result }) {
    const step = state(this)?.steps.find(s => s.id === pickleStep.id);
    if (step) step.status = String(result?.status ?? '').toLowerCase();
  });

  After(async function (this: PSWorld, { result }) {
    const st = state(this);
    if (!st) return;
    // keep the trace only for scenarios that had a failure
    await (st.evidenceDir
      ? this.context.tracing.stop({ path: path.join(st.evidenceDir, 'trace.zip') })
      : this.context.tracing.stop()).catch(() => undefined);
    // a heal whose scenario still failed is not trusted for the rest of the run
    if (String(result?.status) !== 'PASSED') {
      for (const d of st.healedDefs) removeOverride(d.pattern);
    }
  });
}

// One wrapper for every step: {{run}} test data always, healing when enabled. Hooks pass through.
setDefinitionFunctionWrapper(function (fn: Function) {
  return async function (this: PSWorld, ...rawArgs: unknown[]) {
    const args = rawArgs.map(a => (typeof a === 'string' ? a.split('{{run}}').join(runToken) : a));
    const step: CurrentStep | undefined = (this as any).__currentStep;
    (this as any).__currentStep = undefined; // hooks that run after this are not steps
    if (!step) return fn.apply(this, args); // a hook, or healing is off

    const override = overrides.find(o => o.expression.match(step.text));
    try {
      return await (override?.fn ?? fn).apply(this, args);
    } catch (error) {
      const st = state(this);
      if (!st || st.skip || environmentDown) throw error;
      const evidence = await captureEvidence(this, st);
      if (!(await applicationAnswers(this))) {
        environmentDown = true;
        emit(baseEvent(st, step, error as Error, 'environment', evidence, 'the application does not answer — healing stopped for this run'));
        throw error;
      }
      if (healedCount >= maxHeals) {
        emit(baseEvent(st, step, error as Error, 'manual-review', evidence, `heal limit (STEP_HEAL_MAX=${maxHeals}) reached`));
        throw error;
      }
      return healStep(this, st, step, args, error as Error, evidence, override);
    }
  };
});

function state(w: PSWorld): ScenarioState | undefined {
  return (w as any).__heal;
}

// ─── Evidence and environment ───────────────────────────────────────────────

async function captureEvidence(w: PSWorld, st: ScenarioState): Promise<Evidence> {
  const dir = path.join(runDir, 'evidence', `${Date.now()}-${process.pid}-${++sequence}`);
  fs.mkdirSync(dir, { recursive: true });
  const url = w.page.url();
  const snapshot = await w.page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '(no snapshot)');
  const screenshot = await w.page.screenshot({ timeout: 10000 }).catch(() => undefined);
  fs.writeFileSync(path.join(dir, 'snapshot.yml'), snapshot);
  fs.writeFileSync(path.join(dir, 'url.txt'), url);
  if (screenshot) {
    fs.writeFileSync(path.join(dir, 'screenshot.png'), screenshot);
    await Promise.resolve(w.attach(screenshot, 'image/png')).catch(() => undefined);
  }
  st.evidenceDir ??= dir;
  return { dir, url, snapshot };
}

/** The application answers if its base URL responds without a server error within 10 s. */
async function applicationAnswers(w: PSWorld): Promise<boolean> {
  const url = w.baseUrl || w.page.url();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

// ─── Healing ────────────────────────────────────────────────────────────────

async function healStep(
  w: PSWorld, st: ScenarioState, step: CurrentStep, args: unknown[], originalError: Error, evidence: Evidence,
  override?: StepDef & { file: string; source: string },
): Promise<unknown> {
  const event = baseEvent(st, step, originalError, 'manual-review', evidence, '');
  const file = override?.file ?? locate(step.text);
  if (!file) {
    event.reason = 'step definition file not found';
    return finish(w, event, originalError);
  }
  event.file = file.replace(/\\/g, '/');
  const original = fs.readFileSync(file, 'utf8');
  const source = override?.source ?? original; // what actually ran
  const fn = functionOf(source, step.text);
  const failedLine = fn ? failedLineOf(originalError, file, fn) : undefined;
  if (fn && failedLine) event.failedStatement = `line ${failedLine}: ${lines(source)[failedLine - 1].trim()}`;
  const key = cacheKey(event.file, fn?.pattern ?? step.text, fn && failedLine ? lines(source)[failedLine - 1].trim() : '', original);
  event.cacheKey = key;

  const conversation: string[] = [];
  const healed = (fix: CachedFix, fromCache?: HealEvent['fromCache']) => {
    install(st, file, fix.corrected);
    healedCount++;
    Object.assign(event, {
      type: 'healed',
      verdict: 'STEP',
      reason: fix.reason,
      confidence: fix.confidence,
      original,
      corrected: fix.corrected,
      resume: fix.resume.trim(),
      changes: changedLines(original, fix.corrected),
      fromCache,
      verifiedInRun: fix.verifiedInRun,
    });
    return finish(w, event);
  };

  // 1. A fix already known for exactly this failure: verified in an earlier run, or found earlier in this run.
  for (const [known, from] of [[verifiedFix(key), 'verified'], [runFix(key), 'run']] as const) {
    if (!known) continue;
    const problem = await tryFix(w, file, original, source, known, fn, failedLine, args);
    if (!problem) return healed(known, from);
    conversation.push(`A fix that worked before (${from === 'verified' ? `verified in run ${known.verifiedInRun}` : 'found earlier in this run'}) did not work now: ${problem}\nThat fix was:\nREASON: ${known.reason}\nRESUME:\n${known.resume}\nChanged lines:\n${changedLines(original, known.corrected).join('\n')}`);
  }

  // 2. Another worker is healing the same failure right now: wait for its fix instead of asking Copilot too.
  const claim = await claimOrWait(key);
  if (claim.fix) {
    const problem = await tryFix(w, file, original, source, claim.fix, fn, failedLine, args);
    if (!problem) return healed(claim.fix, 'run');
    conversation.push(`A fix found by another worker did not work here: ${problem}`);
  }

  // 3. Ask Copilot.
  let error = originalError;
  try {
    for (let call = 1; call <= maxCalls; call++) {
      event.copilotCalls = call;
      console.log(`[step-heal] "${step.text}" — asking Copilot (${model}), call ${call}...`);
      const snapshot = call === 1 ? evidence.snapshot : undefined; // the page as it was when the step failed
      const question = await prompt(w, st, step, args, file, source, fn, failedLine, error, conversation, snapshot);
      const reply = await askCopilot(question);
      if (process.env.STEP_HEAL_DEBUG === 'true') debugDump(event, call, question, reply);
      const answer = parse(reply);

      if (answer.probes) {
        event.probes += answer.probes.length;
        conversation.push(`You asked for: ${JSON.stringify(answer.probes)}\nResults:\n${await runProbes(w.page, answer.probes)}`);
        continue;
      }
      event.confidence = answer.confidence;
      if (answer.verdict === 'APPLICATION') {
        Object.assign(event, { type: 'application', verdict: 'APPLICATION', reason: answer.reason });
        return finish(w, event, originalError);
      }
      if (answer.verdict !== 'STEP' || !answer.file || !answer.resume) {
        conversation.push('Your answer did not follow the required format. Answer with PROBES, or with VERDICT/CONFIDENCE/REASON (and RESUME and FILE for STEP).');
        continue;
      }

      Object.assign(event, { verdict: 'STEP', reason: answer.reason });
      const fix: CachedFix = {
        corrected: answer.file.replace(/\r?\n/g, original.includes('\r\n') ? '\r\n' : '\n'),
        resume: answer.resume,
        reason: answer.reason,
        confidence: answer.confidence,
      };
      const problem = await tryFix(w, file, original, source, fix, fn, failedLine, args);
      if (problem) {
        error = new Error(problem);
        conversation.push(`Your proposal did not work: ${problem}. Correct it; probe the page again if needed.`);
        continue;
      }
      saveRunFix(key, fix); // other workers (and later failures in this run) reuse it
      return healed(fix);
    }
  } finally {
    if (claim.owned) releaseClaim(key);
  }

  event.reason ||= `Copilot (${model}) could not heal the step within ${maxCalls} calls`;
  return finish(w, event, originalError);
}

// ─── Fix cache ──────────────────────────────────────────────────────────────

interface CachedFix { corrected: string; resume: string; reason: string; confidence: HealEvent['confidence']; verifiedInRun?: string }

/**
 * The same failure = same step definition file, same step, same failing statement, same file content.
 * When the file changes (a fix is merged, someone edits it), old cache entries no longer match.
 */
function cacheKey(file: string, pattern: string, failedStatement: string, original: string): string {
  const content = crypto.createHash('sha1').update(original.replace(/\r\n/g, '\n')).digest('hex');
  return crypto.createHash('sha1').update([file, pattern, failedStatement, content].join('\n')).digest('hex').slice(0, 16);
}

/** Fixes verified by the heal monitor in earlier runs (kept until the step file changes). */
function verifiedFix(key: string): CachedFix | undefined {
  if (!fs.existsSync(verifiedFixesFile)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(verifiedFixesFile, 'utf8'))[key];
  } catch {
    return undefined;
  }
}

/** Fixes found earlier in this run, by any worker. */
function runFix(key: string): CachedFix | undefined {
  const file = path.join(fixesDir, `${key}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

function saveRunFix(key: string, fix: CachedFix): void {
  fs.mkdirSync(fixesDir, { recursive: true });
  const target = path.join(fixesDir, `${key}.json`);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(fix, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

/** Claims the failure for this worker, or waits for the worker that already claimed it to publish its fix. */
async function claimOrWait(key: string): Promise<{ owned: boolean; fix?: CachedFix }> {
  fs.mkdirSync(fixesDir, { recursive: true });
  const lock = path.join(fixesDir, `${key}.lock`);
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    return { owned: true };
  } catch {
    console.log('[step-heal] another worker is healing the same failure — waiting for its fix');
    for (let i = 0; i < 150 && fs.existsSync(lock); i++) {
      const fix = runFix(key);
      if (fix) return { owned: false, fix };
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { owned: false, fix: runFix(key) };
  }
}

function releaseClaim(key: string): void {
  fs.rmSync(path.join(fixesDir, `${key}.lock`), { force: true });
}

/** Validates a fix and runs its RESUME code. Returns the problem, or undefined when the step is complete. */
async function tryFix(
  w: PSWorld, file: string, original: string, source: string, fix: CachedFix,
  fn: FnRange | undefined, failedLine: number | undefined, args: unknown[],
): Promise<string | undefined> {
  const problem = validateFile(file, original, fix.corrected) ?? validateResume(fix.resume, source, fn, failedLine);
  if (problem) return `rejected: ${problem}`;
  try {
    w.page.setDefaultTimeout(resumeActionTimeout);
    try {
      await compileResume(file, fix.corrected, fix.resume, fn).apply(w, args); // finish the step from where it failed
    } finally {
      w.page.setDefaultTimeout(30000); // the action timeout the world sets
    }
    return undefined;
  } catch (e) {
    return `RESUME failed: ${firstLine(e as Error)}`;
  }
}

/** Uses the corrected definitions for the rest of this run (in this worker). */
function install(st: ScenarioState, file: string, corrected: string): void {
  const defs = loadModule(file, corrected).defs;
  for (const d of defs) {
    removeOverride(d.pattern);
    overrides.push({ ...d, file, source: corrected });
  }
  st.healedDefs.push(...defs);
}

function baseEvent(st: ScenarioState, step: CurrentStep, error: Error, type: HealEvent['type'], evidence: Evidence | undefined, reason: string): HealEvent {
  return {
    id: `${Date.now()}-${process.pid}-${++sequence}`,
    type,
    time: new Date().toISOString(),
    runId: process.env.RUN_ID,
    feature: st.feature,
    line: st.line,
    scenario: st.scenario,
    step: step.text,
    error: firstLine(error),
    errorDetail: String(error?.message ?? error).split('\n').slice(0, 8).join('\n').trim(),
    verdict: type === 'environment' ? 'ENVIRONMENT' : 'UNKNOWN',
    reason,
    confidence: 'unknown',
    copilotCalls: 0,
    probes: 0,
    evidence: evidence?.dir.replace(/\\/g, '/'),
    url: evidence?.url,
  };
}

/** Logs, attaches to the report, emits the event, and rethrows the error unless the step was healed. */
async function finish(w: PSWorld, event: HealEvent, error?: Error): Promise<undefined> {
  emit(event);
  const label = { healed: 'STEP HEALED', application: 'APPLICATION FAILURE', 'manual-review': 'MANUAL REVIEW NEEDED', environment: 'ENVIRONMENT DOWN' }[event.type];
  const text = [
    `${label}: ${event.step}`,
    event.fromCache === 'verified' ? `reused the fix verified in run ${event.verifiedInRun} — no Copilot call (that fix is not merged yet)` : '',
    event.fromCache === 'run' ? 'reused a fix found earlier in this run — no Copilot call' : '',
    event.failedStatement ? `failed at ${event.failedStatement}` : '',
    `verdict: ${event.verdict} (confidence ${event.confidence}) — ${event.reason}`,
    `copilot calls: ${event.copilotCalls}, page probes: ${event.probes}`,
    event.file ? `file: ${event.file}` : '',
    event.resume ? `resumed with:\n${event.resume}` : '',
    event.changes?.length ? `proposed file changes (verified by a clean re-run before they are kept):\n${event.changes.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  console.log(`[step-heal] ${text.split('\n').join('\n[step-heal]   ')}`);
  await Promise.resolve(w.attach(text, 'text/plain')).catch(() => undefined);
  if (error) throw error;
  return undefined;
}

/** Writes the event for the heal monitor (atomically) and appends it to the run log. */
function emit(event: HealEvent): void {
  fs.mkdirSync(runDir, { recursive: true });
  const { original, corrected, ...summary } = event;
  fs.appendFileSync(logFile, JSON.stringify(summary) + '\n');
  if (!eventsDir) return;
  fs.mkdirSync(eventsDir, { recursive: true });
  const target = path.join(eventsDir, `${event.id}.json`);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(event, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

function debugDump(event: HealEvent, call: number, question: string, reply: string): void {
  const dir = path.join(runDir, 'debug');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${event.id}-call${call}-prompt.md`), question);
  fs.writeFileSync(path.join(dir, `${event.id}-call${call}-reply.md`), reply);
}

function removeOverride(pattern: string | RegExp): void {
  const i = overrides.findIndex(o => String(o.pattern) === String(pattern));
  if (i >= 0) overrides.splice(i, 1);
}

// ─── Copilot prompt ─────────────────────────────────────────────────────────

async function prompt(
  w: PSWorld, st: ScenarioState, step: CurrentStep, args: unknown[], file: string, source: string,
  fn: FnRange | undefined, failedLine: number | undefined, error: Error, conversation: string[], failureSnapshot?: string,
): Promise<string> {
  const snapshot = failureSnapshot ?? await w.page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '(no snapshot)');
  const featureText = fs.existsSync(st.feature) ? fs.readFileSync(st.feature, 'utf8') : '';
  const related = relatedFiles(st, file);

  const parts = [
    'You are healing a failing Cucumber step in a Playwright + TypeScript test suite (PSD framework: one step',
    'definition file per page under steps/pages/, locators are const functions with .describe() at the top, steps call',
    'them; imports are exactly @cucumber/cucumber, expect from @playwright/test, and PSWorld from ../../support/world).',
    'Do not use any tools; you can only answer. The test is paused at the point of failure with the browser open.',
    '',
    `## Feature file ${st.feature}`, featureText.trim(),
    `({{run}} in a parameter is replaced at run time by "${runToken}")`,
    '',
    `## Scenario "${st.scenario}" — step status`,
    ...st.steps.map(s => `- [${s.id === step.id ? 'FAILED' : s.status}] ${s.text}`),
    '',
    `## Failing step (${step.type}): ${step.text}`,
    `Parameters passed to the step function: ${JSON.stringify(args.filter(a => typeof a !== 'function'))}`,
    '',
    '## Step definition function, statement by statement',
    fn ? markStatements(source, fn, failedLine) : '(could not locate the function)',
    failedLine ? '' : '(the failing line could not be determined from the stack — use the error)',
    '',
    `## Error\n${String(error.stack ?? error.message).split('\n').slice(0, 10).join('\n')}`,
    '',
    `## Full step definition file ${file}`, '```ts', source, '```',
    ...related.flatMap(r => ['', `## Other step definition file used by this scenario: ${r.file}`, '```ts', r.text, '```']),
    '',
    `## ${failureSnapshot ? 'Page when the step failed' : 'Current page'} — URL ${w.page.url()}`,
    'Accessibility snapshot:', snapshot.slice(0, conversation.length ? 4000 : 7000),
    ...(conversation.length ? ['', '## Earlier in this conversation', ...conversation] : []),
    '',
    '## Rules',
    '- The feature file is the specification. If the application shows an error, does not save data, shows a',
    '  different message or value than the feature expects, or a page/control the feature needs no longer exists,',
    '  the verdict is APPLICATION. Short-lived messages (toasts) may be gone from the page — use the error text too.',
    '- The verdict is STEP when the step definition is wrong: a locator that no longer matches the element on the',
    '  page, a missing wait, a wrong element, or code that does not do what the step text says.',
    '- Statements marked ✓ already ran and changed the page. Do not repeat them unless the page shows they had no effect.',
    '- RESUME: TypeScript statements that finish this step from the CURRENT page state — the FAILED statement',
    '  (corrected) and every statement after it, adapted if needed. It runs inside the step function: `this` is the',
    '  world (this.page), the step parameters are available by their names, and the locator consts and `expect`',
    '  of the corrected FILE are in scope. Keep every expect(...) that had not passed yet. Write only the statements —',
    '  never wrap them in Given/When/Then.',
    '- FILE: the complete corrected step definition file. Keep every step text (the strings in Given/When/Then) and',
    '  every import exactly as they are, keep the PSD style, use only roles/names/texts seen on the page, never',
    '  remove or weaken an expect(...), never change an expected value that comes from the step parameters, no',
    '  sleeps, no try/catch.',
    '- Before answering STEP, PROBE every new or changed locator exactly as you will write it (use "chain" for',
    '  chained locators). Propose it only when the probe returned count=1 and visible=true. If an element has no',
    '  accessible name, scope it to a labelled container (e.g. its form group filtered by the label text).',
    '- CONFIDENCE: high when the evidence is unambiguous, medium when likely, low when you are unsure.',
    '',
    '## Answer format — exactly one of:',
    'A) To inspect the live page first (read-only), a JSON array after "PROBES:", e.g.',
    'PROBES: [{"probe":"snapshot"},{"probe":"url"},{"probe":"locator","method":"getByRole","args":["heading",{"name":"Personal Details"}]}]',
    '   locator methods: getByRole, getByText, getByLabel, getByPlaceholder, getByTestId, locator (CSS).',
    '   Each locator probe returns count, visible, text and value of the first match.',
    '   Chained locators use "chain", e.g. {"probe":"locator","chain":[{"method":"locator","args":[".oxd-input-group"]},',
    '   {"method":"filter","args":[{"hasText":"Employee Id"}]},{"method":"getByRole","args":["textbox"]}]}',
    '   (chain methods: the locator methods above, filter with hasText/hasNotText, first, last, nth).',
    'B) The application is at fault:',
    'VERDICT: APPLICATION', 'CONFIDENCE: high|medium|low', 'REASON: <one sentence>',
    'C) The step definition is at fault:',
    'VERDICT: STEP', 'CONFIDENCE: high|medium|low', 'REASON: <one sentence>',
    'RESUME:', '```ts', '<statements>', '```',
    'FILE:', '```ts', '<complete corrected file>', '```',
  ];
  let text = parts.join('\n');
  if (text.length > 28000) text = text.replace(snapshot.slice(0, 7000), snapshot.slice(0, 2500)); // Windows command-line limit
  return text;
}

function parse(answer: string): {
  probes?: Probe[]; verdict?: string; confidence: HealEvent['confidence']; reason: string; resume?: string; file?: string;
} {
  // fields only count at the start of a line (optionally in bold), never inside explanatory prose
  const field = (name: string, value: string) => new RegExp(`^[ \\t>*_]*${name}[*_]*:[*_]*[ \\t]*${value}`, 'im');
  const verdict = field('VERDICT', '(STEP|APPLICATION)\\b').exec(answer)?.[1]?.toUpperCase();
  const probeJson = field('PROBES', '(\\[[\\s\\S]*\\])').exec(answer)?.[1];
  if (probeJson && !verdict) {
    try {
      const probes = JSON.parse(probeJson);
      if (Array.isArray(probes)) return { probes: probes.slice(0, 8), confidence: 'unknown', reason: '' };
    } catch { /* fall through */ }
  }
  const confidence = (field('CONFIDENCE', '(high|medium|low)\\b').exec(answer)?.[1]?.toLowerCase() ?? 'unknown') as HealEvent['confidence'];
  const block = (name: string) => new RegExp(`${name}:\\s*\`\`\`(?:ts|typescript)?\\s*\\n([\\s\\S]*?)\`\`\``, 'i').exec(answer)?.[1];
  return {
    verdict,
    confidence,
    reason: field('REASON', '(.+)').exec(answer)?.[1]?.replace(/^[*_\s]+|[*_\s]+$/g, '') ?? 'no reason given',
    resume: block('RESUME'),
    file: block('FILE'),
  };
}

/** Runs `copilot -p` without tools, MCP servers or custom instructions: it can only answer. */
function askCopilot(text: string): Promise<string> {
  const args = [
    '-p', text, '-s',
    '--model', model,
    '--available-tools=',
    '--disable-builtin-mcps',
    '--no-custom-instructions',
    '--no-ask-user',
    '--no-auto-update',
  ];
  // On Windows the `copilot` command is a .cmd shim, so run its script with node directly.
  const [cmd, cmdArgs] = process.platform === 'win32'
    ? [process.execPath, [path.join(execSync('npm root -g').toString().trim(), '@github', 'copilot', 'npm-loader.js'), ...args]]
    : ['copilot', args];
  return new Promise(resolve => {
    execFile(cmd, cmdArgs, { timeout: 90000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) console.warn(`[step-heal] Copilot CLI failed: ${(stderr || err.message).split('\n')[0]}`);
      resolve(stdout ?? '');
    });
  });
}

// ─── Live page probes (read-only) ───────────────────────────────────────────

async function runProbes(page: Page, probes: Probe[]): Promise<string> {
  const out: string[] = [];
  for (const p of probes) {
    try {
      if (p.probe === 'snapshot') out.push(`snapshot:\n${(await page.locator('body').ariaSnapshot({ timeout: 5000 })).slice(0, 4000)}`);
      else if (p.probe === 'url') out.push(`url: ${page.url()}`);
      else if (p.probe === 'locator') {
        const l = p.chain ? probeChain(page, p.chain) : probeLocator(page, p.method ?? '', p.args ?? []);
        const count = await l.count();
        const first = l.first();
        const visible = count ? await first.isVisible() : false;
        const text = count ? (await first.innerText({ timeout: 2000 }).catch(() => '')).slice(0, 200) : '';
        const value = count ? await first.inputValue({ timeout: 1000 }).catch(() => undefined) : undefined;
        const label = p.chain ? p.chain.map(c => `${c.method}(${JSON.stringify(c.args ?? []).slice(1, -1)})`).join('.') : `${p.method}(${JSON.stringify(p.args ?? []).slice(1, -1)})`;
        out.push(`${label}: count=${count} visible=${visible} text=${JSON.stringify(text)}${value !== undefined ? ` value=${JSON.stringify(value)}` : ''}`);
      } else out.push(`unknown probe ${JSON.stringify(p)}`);
    } catch (e) {
      out.push(`${JSON.stringify(p)}: error ${firstLine(e as Error)}`);
    }
  }
  return out.join('\n');
}

/** A chained locator, e.g. locator(".oxd-input-group").filter({hasText:"Employee Id"}).getByRole("textbox"). */
function probeChain(page: Page, chain: ProbeStep[]): Locator {
  if (!Array.isArray(chain) || !chain.length || chain.length > 6) throw new Error('chain must have 1 to 6 steps');
  let current: Page | Locator = page;
  for (const { method, args = [] } of chain) {
    if (method === 'filter') {
      const o = (args[0] ?? {}) as Record<string, unknown>;
      const opts = Object.fromEntries(Object.entries(o).filter(([k, v]) => ['hasText', 'hasNotText'].includes(k) && typeof v === 'string'));
      if (current === page) throw new Error('filter needs a locator before it');
      current = (current as Locator).filter(opts);
    } else if (['first', 'last'].includes(method)) {
      if (current === page) throw new Error(`${method} needs a locator before it`);
      current = method === 'first' ? (current as Locator).first() : (current as Locator).last();
    } else if (method === 'nth') {
      if (current === page || typeof args[0] !== 'number') throw new Error('nth needs a locator and a number');
      current = (current as Locator).nth(args[0]);
    } else {
      current = probeLocator(current, method, args);
    }
  }
  if (current === page) throw new Error('empty chain');
  return current as Locator;
}

function probeLocator(page: Page | Locator, method: string, args: unknown[]): Locator {
  const [first, options] = args as [unknown, Record<string, unknown> | undefined];
  if (typeof first !== 'string') throw new Error('first argument must be a string');
  const opts = options && typeof options === 'object'
    ? Object.fromEntries(Object.entries(options).filter(([k, v]) => ['name', 'exact', 'level'].includes(k) && ['string', 'boolean', 'number'].includes(typeof v)))
    : undefined;
  switch (method) {
    case 'getByRole': return page.getByRole(first as Parameters<Page['getByRole']>[0], opts as Parameters<Page['getByRole']>[1]);
    case 'getByText': return page.getByText(first, opts);
    case 'getByLabel': return page.getByLabel(first, opts);
    case 'getByPlaceholder': return page.getByPlaceholder(first, opts);
    case 'getByTestId': return page.getByTestId(first);
    case 'locator': return page.locator(first);
    default: throw new Error(`method ${method} is not allowed`);
  }
}

// ─── Step definition files ──────────────────────────────────────────────────

function stepFiles(): string[] {
  return (fs.readdirSync(stepsDir, { recursive: true }) as string[])
    .filter(f => f.endsWith('.steps.ts'))
    .map(f => path.join(stepsDir, f));
}

function locate(text: string): string | undefined {
  return stepFiles().find(file => loadModule(file, fs.readFileSync(file, 'utf8')).defs.some(d => d.expression.match(text)));
}

/** The other step definition files this scenario uses — so Copilot sees the whole flow. */
function relatedFiles(st: ScenarioState, exclude: string): { file: string; text: string }[] {
  const files = new Set(st.steps.map(s => overrides.find(o => o.expression.match(s.text))?.file ?? locate(s.text)));
  files.delete(exclude);
  return [...files].filter((f): f is string => !!f).map(file => ({
    file,
    text: overrides.find(o => o.file === file)?.source ?? fs.readFileSync(file, 'utf8'),
  }));
}

/**
 * Compiles a step definition file in memory and collects its Given/When/Then registrations (and exports)
 * without registering anything with Cucumber. Other imports (world, Playwright) resolve to loaded modules.
 */
function loadModule(file: string, source: string): { defs: StepDef[]; exports: Record<string, unknown> } {
  const absolute = path.resolve(file);
  // compile with the TypeScript compiler the project already uses (reports syntax errors like a build would)
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: absolute,
    reportDiagnostics: true,
  });
  const syntaxError = out.diagnostics?.find(d => d.category === ts.DiagnosticCategory.Error);
  if (syntaxError) throw new Error(ts.flattenDiagnosticMessageText(syntaxError.messageText, ' '));
  const code = out.outputText;
  const defs: StepDef[] = [];
  const register = (pattern: string | RegExp, a: unknown, b?: unknown) => {
    const fn = (typeof a === 'function' ? a : b) as Function;
    const expression = typeof pattern === 'string' ? new CucumberExpression(pattern, registry) : new RegularExpression(pattern, registry);
    defs.push({ pattern, fn, expression });
  };
  const stub = { ...cucumber, Given: register, When: register, Then: register, defineStep: register };
  const realRequire = createRequire(absolute);
  const localRequire = (id: string) => (id === '@cucumber/cucumber' ? stub : realRequire(id));
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    localRequire, module, module.exports, absolute, path.dirname(absolute));
  return { defs, exports: module.exports };
}

/** RESUME runs as a function appended to the corrected file, so its locator consts and imports are in scope. */
function compileResume(file: string, corrected: string, resume: string, fn: FnRange | undefined): Function {
  const params = fn?.params ?? 'this: any';
  const source = `${corrected}\nexport async function __resume(${params}) {\n${resume}\n}\n`;
  const exported = loadModule(file, source).exports.__resume;
  if (typeof exported !== 'function') throw new Error('RESUME did not compile to a function');
  return exported as Function;
}

const FORBIDDEN = /\b(require\s*\(|import\s*\(|process\b|child_process|eval\s*\(|new\s+Function|globalThis|__dirname|__filename)|\bfs\./;

function importsOf(source: string): string {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort().join(',');
}

function validateFile(file: string, original: string, corrected: string): string | undefined {
  const body = corrected.split(/\r?\n/).filter(l => !/^\s*import\s/.test(l)).join('\n');
  if (FORBIDDEN.test(body)) return 'the file uses require/import()/process/fs/eval, which is not allowed';
  if (importsOf(corrected) !== importsOf(original)) return 'imports were changed — keep them exactly as they are';
  let proposed: StepDef[];
  try {
    proposed = loadModule(file, corrected).defs;
  } catch (e) {
    return `the file does not compile: ${firstLine(e as Error)}`;
  }
  const before = loadModule(file, original).defs.map(d => String(d.pattern)).sort().join('\n');
  const after = proposed.map(d => String(d.pattern)).sort().join('\n');
  return before === after ? undefined : 'step texts were changed, added or removed — keep them exactly as they are';
}

function validateResume(resume: string, source: string, fn: FnRange | undefined, failedLine: number | undefined): string | undefined {
  if (FORBIDDEN.test(resume)) return 'RESUME uses require/import()/process/fs/eval, which is not allowed';
  if (/\btry\s*\{|waitForTimeout|setTimeout/.test(resume)) return 'RESUME may not use try/catch or fixed waits';
  if (/\b(Given|When|Then|defineStep)\s*\(/.test(resume)) return 'RESUME must be the statements themselves, not a Given/When/Then definition (a definition never runs)';
  if (fn && failedLine) {
    const remaining = lines(source).slice(failedLine - 1, fn.end).join('\n');
    const needed = (remaining.match(/expect\(/g) ?? []).length;
    const given = (resume.match(/expect\(/g) ?? []).length;
    if (given < needed) return `RESUME has ${given} expect(...) but the statements still to run have ${needed} — keep every assertion`;
  }
  return undefined;
}

// ─── Locating the scenario and the failing statement ────────────────────────

/** The line of the scenario (or Examples row) in the feature file, for re-running exactly that scenario. */
function scenarioLine(doc: any, astNodeIds: readonly string[]): number {
  const found = new Map<string, number>();
  const visit = (children: any[]) => {
    for (const child of children ?? []) {
      if (child.rule) visit(child.rule.children);
      const scenario = child.scenario;
      if (!scenario) continue;
      found.set(scenario.id, scenario.location.line);
      for (const ex of scenario.examples ?? []) for (const row of ex.tableBody ?? []) found.set(row.id, row.location.line);
    }
  };
  visit(doc?.feature?.children);
  for (const id of [...astNodeIds].reverse()) if (found.has(id)) return found.get(id)!;
  return 0;
}

interface FnRange { start: number; end: number; params: string; pattern: string } // 1-based line numbers

function lines(source: string): string[] {
  return source.split(/\r?\n/);
}

function functionOf(source: string, stepText: string): FnRange | undefined {
  const ls = lines(source);
  const strip = (l: string) => l.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
  for (let i = 0; i < ls.length; i++) {
    const m = /^\s*(Given|When|Then)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/.exec(ls[i]);
    if (!m) continue;
    if (!new CucumberExpression(m[3].replace(/\\(.)/g, '$1'), registry).match(stepText)) continue;
    let depth = 0;
    let opened = false;
    let end = i;
    for (let j = i; j < ls.length; j++) {
      for (const ch of strip(ls[j])) {
        if (ch === '{') { depth++; opened = true; }
        if (ch === '}') depth--;
      }
      if (opened && depth === 0) { end = j; break; }
    }
    const params = /async\s+function\s*\(([^)]*)\)/.exec(ls.slice(i, i + 4).join(' '))?.[1]?.trim() || 'this: any';
    return { start: i + 1, end: end + 1, params, pattern: m[3].replace(/\\(.)/g, '$1') };
  }
  return undefined;
}

function failedLineOf(error: Error, file: string, fn: FnRange): number | undefined {
  const target = path.resolve(file).toLowerCase().replace(/\\/g, '/');
  for (const frame of String(error.stack ?? '').split('\n')) {
    const m = /\(?((?:file:\/\/\/)?[^()\s]+):(\d+):(\d+)\)?\s*$/.exec(frame.trim());
    if (!m) continue;
    const framePath = decodeURIComponent(m[1].replace(/^file:\/\/\//, '')).toLowerCase().replace(/\\/g, '/');
    const line = Number(m[2]);
    if (framePath === target && line >= fn.start && line <= fn.end) return line;
  }
  return undefined;
}

function markStatements(source: string, fn: FnRange, failedLine: number | undefined): string {
  return lines(source).slice(fn.start - 1, fn.end).map((text, k) => {
    const n = fn.start + k;
    const mark = !failedLine || n === fn.start || n === fn.end || !text.trim() ? '   '
      : n < failedLine ? ' ✓ ' : n === failedLine ? ' ✗ ' : ' · ';
    return `${String(n).padStart(3)}${mark}${text}${n === failedLine ? '   <-- FAILED HERE' : ''}`;
  }).join('\n') + (failedLine ? '\n(✓ executed, ✗ failed, · not executed)' : '');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function firstLine(error: Error): string {
  return String(error?.message ?? error).split('\n')[0];
}

function changedLines(before: string, after: string): string[] {
  const a = lines(before);
  const b = lines(after);
  return [
    ...a.filter(l => l.trim() && !b.includes(l)).map(l => `- ${l.trim()}`),
    ...b.filter(l => l.trim() && !a.includes(l)).map(l => `+ ${l.trim()}`),
  ];
}
