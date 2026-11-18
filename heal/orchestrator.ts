/**
 * Heal monitor — runs the PSD suite with the Cucumber step healer on (Run A) and, in parallel, acts on
 * every heal event as soon as it appears. Execution, maintenance and defect identification overlap.
 *
 *   npm run test:heal [-- <extra cucumber args, e.g. --tags @smoke>]
 *
 * Events (written by support/step-healer.ts) and what the monitor does with them:
 *   healed        → clean re-run of that scenario with the corrected step file applied and healing off.
 *                   Pass: the fix is VERIFIED (kept for the pull request). Fail: REJECTED (reported).
 *   application   → clean re-run of the scenario to CONFIRM the defect. Still failing: a GitHub issue,
 *                   labelled app-defect (high confidence) or needs-triage; an open issue with the same
 *                   fingerprint gets a comment instead. Passing: NOT REPRODUCED (reported, no issue).
 *   manual-review → Copilot could not heal it: listed for manual review.
 *   environment   → the application did not answer: one environment issue, healing stopped.
 * At most STEP_HEAL_PARALLEL (default 2) re-runs at the same time. When Run A ends, the monitor waits only
 * for the work still in progress, then writes the summary, opens one pull request with all verified
 * fixes, and records the run in heal-history/ (history.jsonl + dashboard.html).
 *
 * Settings:
 *   STEP_HEAL_ISSUES=true   create/comment GitHub issues (otherwise drafts are written to the run folder)
 *   STEP_HEAL_PR=true       push a branch and open a pull request (otherwise a patch is written)
 *   STEP_HEAL_PARALLEL      parallel re-runs (default 2)
 *   HEADLESS                default true
 */
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HealEvent } from '../support/step-healer';

// ─── Setup ──────────────────────────────────────────────────────────────────

const root = process.cwd();
const runId = process.env.RUN_ID ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const runDir = path.join('reports', 'heal-run', runId);
const eventsDir = path.join(runDir, 'events');
const historyDir = 'heal-history';
const issuesEnabled = process.env.STEP_HEAL_ISSUES === 'true';
const prEnabled = process.env.STEP_HEAL_PR === 'true';
const parallel = Number(process.env.STEP_HEAL_PARALLEL ?? 2);
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;

const cucumberBin = path.join(path.dirname(require.resolve('@cucumber/cucumber/package.json')), 'bin', 'cucumber.js');

type Outcome =
  | 'verified' | 'rejected' | 'reused'            // healed (reused: fix verified in an earlier run)
  | 'defect-raised' | 'defect-updated' | 'defect-drafted' | 'not-reproduced' // application
  | 'manual-review' | 'environment';
interface Handled { event: HealEvent; outcome: Outcome; detail: string; issue?: string; seconds: number }

const handled: Handled[] = [];
const verifiedFixes = new Map<string, { content: string; events: HealEvent[] }>(); // file → corrected content
const seen = new Set<string>();
const queue: HealEvent[] = [];
/** Result of a clean re-run: the scenario's outcome and the status of the step the event is about. */
interface Rerun { passed: boolean; output: string; step: string }
const verifications = new Map<string, Promise<Rerun>>(); // one clean re-run per distinct failure
const verifiedFixesFile = path.join(historyDir, 'fixes.json');
let active = 0;
let labelsReady = false;
const started = Date.now();

const log = (message: string) => console.log(`\n[monitor] ${message}`); // new line: Cucumber's progress dots have none

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync(eventsDir, { recursive: true });
  pruneVerifiedFixes();
  log(`run ${runId} — Run A with healing on; events in ${eventsDir}`);

  const runA = spawn(process.execPath, [cucumberBin, '--format', 'progress', ...process.argv.slice(2)], { // cucumber.js is the config
    stdio: 'inherit',
    env: { ...process.env, STEP_HEAL: 'true', STEP_HEAL_EVENTS_DIR: eventsDir, RUN_ID: runId, HEADLESS: process.env.HEADLESS ?? 'true' },
  });
  let runADone = false;
  const runAExit = new Promise<number>(resolve => runA.on('exit', code => { runADone = true; resolve(code ?? 1); }));

  // the monitor: pick up events while Run A is still running
  const timer = setInterval(scanEvents, 2000);
  const exitCode = await runAExit;
  const runASeconds = Math.round((Date.now() - started) / 1000);
  log(`Run A finished (exit ${exitCode}) after ${runASeconds}s — waiting for ${active + queue.length} item(s) still in progress`);
  scanEvents();
  while (active > 0 || queue.length > 0) await sleep(1000);
  clearInterval(timer);

  await openPullRequest();
  const summary = writeSummary(exitCode, runASeconds, runADone);
  recordHistory(exitCode, runASeconds);
  console.log(`\n${summary}`);
  process.exitCode = exitCode;
}

function scanEvents(): void {
  if (!fs.existsSync(eventsDir)) return;
  for (const name of fs.readdirSync(eventsDir).filter(n => n.endsWith('.json')).sort()) {
    if (seen.has(name)) continue;
    seen.add(name);
    const event: HealEvent = JSON.parse(fs.readFileSync(path.join(eventsDir, name), 'utf8'));
    log(`event: ${event.type} — "${event.step}" (${event.scenario})`);
    queue.push(event);
  }
  while (active < parallel && queue.length) {
    const event = queue.shift()!;
    active++;
    handle(event).catch(e => log(`error handling ${event.id}: ${e}`)).finally(() => { active--; scanEvents(); });
  }
}

async function handle(event: HealEvent): Promise<void> {
  const t0 = Date.now();
  const done = (outcome: Outcome, detail: string, issue?: string) => {
    handled.push({ event, outcome, detail, issue, seconds: Math.round((Date.now() - t0) / 1000) });
    log(`${outcome}: "${event.step}" — ${detail}${issue ? ` (${issue})` : ''}`);
  };

  switch (event.type) {
    case 'healed': {
      const keep = () => {
        const entry = verifiedFixes.get(event.file!) ?? { content: event.corrected!, events: [] };
        entry.content = event.corrected!;
        entry.events.push(event);
        verifiedFixes.set(event.file!, entry);
      };
      if (event.fromCache === 'verified') {
        keep(); // verified in an earlier run and not merged yet: include it in the pull request again
        return done('reused', `fix verified in run ${event.verifiedInRun} reused — no Copilot call, no re-run`);
      }
      // the same failure healed by several workers is verified once
      const key = event.cacheKey ?? event.id;
      const shared = verifications.has(key);
      if (!shared) verifications.set(key, rerun(event, true));
      let result = await verifications.get(key)!;
      if (!shared && (result.step === 'skipped' || result.step === 'missing')) {
        // an earlier step of the scenario failed in the re-run: wait for the other fixes of this run, then try once more
        await Promise.allSettled([...verifications.entries()].filter(([k]) => k !== key).map(([, p]) => p));
        result = await rerun(event, true);
        if (result.step === 'skipped' || result.step === 'missing') {
          return done('manual-review', `could not verify: an earlier step still fails in the clean re-run: ${lastError(result.output)}`);
        }
      }
      const { passed, output, step } = result;
      // the fix is judged on the healed step: other, unrelated failures later in the scenario do not reject it
      if (step !== 'passed') return done('rejected', `the healed step ${step} in the clean re-run: ${lastError(output)}`);
      keep();
      if (!shared) rememberVerifiedFix(event);
      return done('verified', shared
        ? 'same fix as another worker — verified by that clean re-run'
        : passed
          ? `clean re-run of ${event.feature}:${event.line} passed with the corrected ${event.file}`
          : `the healed step passed in the clean re-run; the scenario still fails later: ${lastError(output)}`);
    }
    case 'application': {
      const { output, step } = await rerun(event, false);
      if (step === 'passed') return done('not-reproduced', 'the step passed on a clean re-run — no issue raised');
      if (step !== 'failed') return done('not-reproduced', `the clean re-run did not reach the step (it was ${step}) — no issue raised: ${lastError(output)}`);
      const { outcome, link } = await raiseDefect(event, output);
      return done(outcome, `confirmed by a clean re-run (confidence ${event.confidence})`, link);
    }
    case 'environment': {
      const { outcome, link } = await raiseEnvironmentIssue(event);
      return done('environment', `application did not answer — ${outcome}`, link);
    }
    default:
      return done('manual-review', event.reason || 'Copilot could not heal the step');
  }
}

// ─── Verified fix cache (kept between runs in heal-history/fixes.json) ──

interface VerifiedFix {
  file: string;
  contentHash: string; // hash of the step file the fix applies to
  corrected: string;
  resume: string;
  reason: string;
  confidence: string;
  verifiedInRun: string;
  verifiedAt: string;
}

function contentHash(text: string): string {
  return crypto.createHash('sha1').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

function readVerifiedFixes(): Record<string, VerifiedFix> {
  try {
    return JSON.parse(fs.readFileSync(verifiedFixesFile, 'utf8'));
  } catch {
    return {};
  }
}

/** Saved under the event's cache key, so the step healer reuses it for the same failure in later runs. */
function rememberVerifiedFix(event: HealEvent): void {
  if (!event.cacheKey || !event.file || !event.original || !event.corrected) return;
  const fixes = readVerifiedFixes();
  fixes[event.cacheKey] = {
    file: event.file,
    contentHash: contentHash(event.original),
    corrected: event.corrected,
    resume: event.resume ?? '',
    reason: event.reason,
    confidence: event.confidence,
    verifiedInRun: runId,
    verifiedAt: new Date().toISOString(),
  };
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(verifiedFixesFile, JSON.stringify(fixes, null, 2));
}

/** Drops fixes whose step file has changed since (merged, or edited by hand): they no longer apply. */
function pruneVerifiedFixes(): void {
  const fixes = readVerifiedFixes();
  const keep = Object.fromEntries(Object.entries(fixes).filter(([, f]) =>
    fs.existsSync(f.file) && contentHash(fs.readFileSync(f.file, 'utf8')) === f.contentHash));
  const dropped = Object.keys(fixes).length - Object.keys(keep).length;
  if (dropped) {
    fs.writeFileSync(verifiedFixesFile, JSON.stringify(keep, null, 2));
    log(`${dropped} verified fix(es) dropped from the cache — their step files have changed`);
  }
  if (Object.keys(keep).length) log(`${Object.keys(keep).length} verified fix(es) not merged yet — reused if the same failure happens`);
}

// ─── Clean re-runs ──────────────────────────────────────────────────────────

/**
 * Re-runs one scenario from the start, healing off, in its own copy of the suite — the original files plus
 * every fix verified so far, plus (for a healed event) this event's corrected file.
 */
async function rerun(event: HealEvent, withFix: boolean): Promise<Rerun> {
  const workspace = path.join(runDir, 'verify', event.id);
  for (const part of ['features', 'steps', 'support']) {
    fs.cpSync(part, path.join(workspace, part), { recursive: true });
  }
  for (const file of ['cucumber.js', 'tsconfig.json']) fs.copyFileSync(file, path.join(workspace, file));
  for (const [file, fix] of verifiedFixes) fs.writeFileSync(path.join(workspace, file), fix.content);
  if (withFix && event.file && event.corrected) fs.writeFileSync(path.join(workspace, event.file), event.corrected);

  const args = [cucumberBin, '--profile', 'files', '--format', 'summary', '--format', 'json:rerun.json', `${event.feature}:${event.line}`];
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(workspace),
      env: { ...process.env, STEP_HEAL: 'false', STEP_HEAL_EVENTS_DIR: '', RUN_ID: `${runId}v${event.id.slice(-4)}`, HEADLESS: 'true' },
    });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('exit', code => {
      fs.writeFileSync(path.join(workspace, 'rerun.log'), output);
      resolve({ passed: code === 0, output, step: stepStatus(workspace, event) });
    });
  });
}

/** Status of the event's step in the clean re-run (from its Cucumber JSON report). */
function stepStatus(workspace: string, event: HealEvent): string {
  const file = path.join(workspace, 'rerun.json');
  if (!fs.existsSync(file)) return 'missing';
  try {
    const features = JSON.parse(fs.readFileSync(file, 'utf8')) as any[];
    for (const feature of features) {
      for (const element of feature.elements ?? []) {
        if (element.type !== 'scenario' || element.line !== event.line) continue;
        const step = (element.steps ?? []).find((s: any) => !s.hidden && s.name === event.step);
        return step?.result?.status ?? 'missing';
      }
    }
  } catch { /* unreadable report */ }
  return 'missing';
}

function lastError(output: string): string {
  const line = output.split('\n').find(l => /Error|failed|Timeout/i.test(l) && !/^\s*at /.test(l));
  return (line ?? output.split('\n').filter(Boolean).slice(-1)[0] ?? 'unknown').trim().slice(0, 200);
}

// ─── Issues ─────────────────────────────────────────────────────────────────

/** Same page + same step + same kind of error = same defect. */
function fingerprint(event: HealEvent): string {
  const page = (event.url ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/\/\d+(?=\/|$)/g, '/:id');
  const errorKind = event.error.replace(/["'`][^"'`]*["'`]/g, '"…"').replace(/\d+/g, 'N').slice(0, 120);
  return crypto.createHash('sha1').update(`${page}|${event.step.replace(/"[^"]*"/g, '"…"')}|${errorKind}`).digest('hex').slice(0, 12);
}

async function raiseDefect(event: HealEvent, rerunOutput: string): Promise<{ outcome: Outcome; link: string }> {
  const fp = fingerprint(event);
  const labels = event.confidence === 'high' ? ['app-defect'] : ['needs-triage'];
  const title = `[app-defect] ${event.scenario}: ${event.step}`.slice(0, 120);
  const body = [
    `## Defect`,
    event.reason,
    '',
    `| | |`, `|---|---|`,
    `| Feature | \`${event.feature}:${event.line}\` |`,
    `| Scenario | ${event.scenario} |`,
    `| Failing step | \`${event.step}\` |`,
    event.failedStatement ? `| Failed statement | \`${event.failedStatement}\` |` : '',
    `| Page | ${event.url ?? ''} |`,
    `| Copilot verdict | APPLICATION, confidence **${event.confidence}** (${event.copilotCalls} call(s), ${event.probes} page check(s)) |`,
    `| Confirmed | the scenario failed again on a clean re-run, healing off |`,
    `| Run | ${runUrl ?? runId} |`,
    '',
    '## Error', '```', event.errorDetail ?? event.error, '```',
    '## Clean re-run', '```', lastError(rerunOutput), '```',
    '## Evidence',
    `Screenshot, accessibility snapshot and Playwright trace: \`${event.evidence}\`${runUrl ? ' in the run artifact `psd-step-heal-report`' : ''}.`,
    '',
    `<!-- heal-fingerprint: ${fp} -->`,
    '🤖 Raised by the PSD heal monitor.',
  ].filter(l => l !== '').join('\n');
  return fileIssue(fp, title, body, labels, `Seen again in run ${runUrl ?? runId} — scenario "${event.scenario}", confidence ${event.confidence}.`);
}

async function raiseEnvironmentIssue(event: HealEvent): Promise<{ outcome: Outcome; link: string }> {
  const host = (event.url ?? '').replace(/^(https?:\/\/[^/]+).*/, '$1');
  const fp = crypto.createHash('sha1').update(`environment|${host}`).digest('hex').slice(0, 12);
  const body = [
    '## Environment down',
    `The application at ${host} did not answer during run ${runUrl ?? runId}; healing was stopped.`,
    '', `First failing step: \`${event.step}\` in "${event.scenario}"`, '```', event.error, '```',
    `<!-- heal-fingerprint: ${fp} -->`, '🤖 Raised by the PSD heal monitor.',
  ].join('\n');
  return fileIssue(fp, `[environment] ${host} did not answer`, body, ['environment'], `Down again in run ${runUrl ?? runId}.`);
}

/** Creates the issue, comments on an open one with the same fingerprint, or writes a draft. */
async function fileIssue(fp: string, title: string, body: string, labels: string[], comment: string): Promise<{ outcome: Outcome; link: string }> {
  if (!issuesEnabled) {
    const file = path.join(runDir, 'issues', `${fp}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# ${title}\n\nlabels: ${labels.join(', ')}\n\n${body}\n`);
    return { outcome: labels[0] === 'environment' ? 'environment' : 'defect-drafted', link: `draft ${file.replace(/\\/g, '/')}` };
  }
  await ensureLabels();
  const existing = JSON.parse(await gh(['issue', 'list', '--state', 'open', '--search', `"heal-fingerprint: ${fp}" in:body`, '--json', 'number,url', '--limit', '1']) || '[]');
  if (existing.length) {
    await gh(['issue', 'comment', String(existing[0].number), '--body', comment]);
    return { outcome: labels[0] === 'environment' ? 'environment' : 'defect-updated', link: existing[0].url };
  }
  const bodyFile = path.join(runDir, `issue-${fp}.md`);
  fs.writeFileSync(bodyFile, body);
  const url = (await gh(['issue', 'create', '--title', title, '--body-file', bodyFile, ...labels.flatMap(l => ['--label', l])])).trim();
  return { outcome: labels[0] === 'environment' ? 'environment' : 'defect-raised', link: url };
}

async function ensureLabels(): Promise<void> {
  if (labelsReady) return;
  const labels: [string, string, string][] = [
    ['app-defect', 'd73a4a', 'Application defect confirmed by the PSD heal monitor'],
    ['needs-triage', 'fbca04', 'Possible application defect — Copilot was not sure'],
    ['environment', '5319e7', 'The application under test did not answer'],
  ];
  for (const [name, color, description] of labels) {
    await gh(['label', 'create', name, '--color', color, '--description', description, '--force']).catch(() => '');
  }
  labelsReady = true;
}

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

// ─── Pull request ───────────────────────────────────────────────────────────

async function openPullRequest(): Promise<void> {
  if (!verifiedFixes.size) return;
  const patchDir = path.join(runDir, 'verified-fixes');
  for (const [file, fix] of verifiedFixes) {
    fs.mkdirSync(path.dirname(path.join(patchDir, file)), { recursive: true });
    fs.writeFileSync(path.join(patchDir, file), fix.content);
  }
  if (!prEnabled) {
    log(`verified fixes written to ${patchDir} (set STEP_HEAL_PR=true to open a pull request)`);
    return;
  }
  const base = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const branch = `step-heal/${runId}`;
  await git(['switch', '-c', branch]);
  for (const [file, fix] of verifiedFixes) fs.writeFileSync(file, fix.content);
  await git(['add', ...verifiedFixes.keys()]);
  await git(['commit', '-m', `test(heal): verified PSD step definition fixes from run ${runId}`]);
  await git(['push', 'origin', branch]);
  const body = [
    `Step definition fixes found by the Cucumber step healer in run ${runUrl ?? runId}.`,
    'Each fix was **verified by a clean re-run** of its scenario (healing off) before it was included.',
    '',
    ...[...verifiedFixes].flatMap(([file, fix]) => [
      `### \`${file}\``,
      ...fix.events.map(e => `- **${e.step}** (${e.scenario}) — ${e.reason} _(confidence ${e.confidence}${e.fromCache === 'verified' ? `, verified in run ${e.verifiedInRun}` : ''})_`),
      '```diff', ...(fix.events[fix.events.length - 1]?.changes ?? []), '```', '',
    ]),
    'Review that only locators, waits or step code changed — no step texts, assertions or expected values.',
    '',
    '🤖 Generated by the PSD heal monitor. Never merged automatically.',
  ].join('\n');
  const bodyFile = path.join(runDir, 'pr-body.md');
  fs.writeFileSync(bodyFile, body);
  const url = (await gh(['pr', 'create', '--base', base, '--head', branch, '--title', `[step-heal] Verified PSD step fixes (run ${runId})`, '--body-file', bodyFile])).trim();
  log(`pull request: ${url}`);
  handled.push({ event: { step: 'pull request' } as HealEvent, outcome: 'verified', detail: url, seconds: 0 });
  await git(['switch', base]).catch(() => '');
}

// ─── Summary and history ────────────────────────────────────────────────────

function runAResults(): { total: number; passed: number; failed: number } {
  const file = 'cucumber-report.json';
  if (!fs.existsSync(file)) return { total: 0, passed: 0, failed: 0 };
  const features = JSON.parse(fs.readFileSync(file, 'utf8')) as any[];
  const scenarios = features.flatMap(f => f.elements ?? []).filter((e: any) => e.type === 'scenario');
  const failed = scenarios.filter((s: any) => (s.steps ?? []).some((st: any) => st.result?.status !== 'passed' && st.result?.status !== 'skipped')).length;
  return { total: scenarios.length, passed: scenarios.length - failed, failed };
}

function count(outcomes: Outcome[]): number {
  return handled.filter(h => h.event.type && outcomes.includes(h.outcome)).length;
}

function writeSummary(exitCode: number, runASeconds: number, runADone: boolean): string {
  const a = runAResults();
  const icon: Record<Outcome, string> = {
    verified: '✅ fix verified', rejected: '❌ fix rejected', reused: '♻️ verified fix reused', 'defect-raised': '🐞 defect raised',
    'defect-updated': '🐞 defect updated', 'defect-drafted': '🐞 defect (draft)', 'not-reproduced': '〰️ not reproduced',
    'manual-review': '👀 manual review', environment: '🌐 environment',
  };
  const rows = handled.filter(h => h.event.type).map(h =>
    `| ${h.event.scenario} | ${h.event.step} | ${icon[h.outcome]} | ${h.detail.replace(/\|/g, '/')} | ${h.issue ?? ''} | ${h.seconds}s |`);
  const md = [
    `## PSD heal run ${runId}`,
    '',
    `Run A: **${a.passed}/${a.total} scenarios passed** in ${runASeconds}s (exit ${exitCode}${runADone ? '' : ', did not finish'}). ` +
      `Total time including the parallel work: ${Math.round((Date.now() - started) / 1000)}s.`,
    '',
    rows.length ? '| Scenario | Step | Outcome | Detail | Issue | Took |\n|---|---|---|---|---|---|\n' + rows.join('\n') : 'No step failed.',
    '',
    verifiedFixes.size ? `Verified fixes: ${[...verifiedFixes.keys()].map(f => `\`${f}\``).join(', ')}` : '',
    handled.find(h => h.event.step === 'pull request') ? `Pull request: ${handled.find(h => h.event.step === 'pull request')!.detail}` : '',
    `Run folder: \`${runDir.replace(/\\/g, '/')}\``,
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(runDir, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  return md;
}

function recordHistory(exitCode: number, runASeconds: number): void {
  const a = runAResults();
  const events = handled.filter(h => h.event.type).map(h => h.event);
  const entry = {
    runId,
    date: new Date().toISOString(),
    scenarios: a.total,
    passed: a.passed,
    failed: a.failed,
    heals: events.filter(e => e.type === 'healed').length,
    verified: count(['verified']),
    reused: count(['reused']),
    fromRunCache: events.filter(e => e.fromCache === 'run').length,
    rejected: count(['rejected']),
    defects: count(['defect-raised', 'defect-updated', 'defect-drafted']),
    notReproduced: count(['not-reproduced']),
    manualReview: count(['manual-review']),
    environment: count(['environment']),
    copilotCalls: events.reduce((n, e) => n + (e.copilotCalls ?? 0), 0),
    runASeconds,
    totalSeconds: Math.round((Date.now() - started) / 1000),
    exitCode,
  };
  fs.mkdirSync(historyDir, { recursive: true });
  fs.appendFileSync(path.join(historyDir, 'history.jsonl'), JSON.stringify(entry) + '\n');
  const history = fs.readFileSync(path.join(historyDir, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  fs.writeFileSync(path.join(historyDir, 'dashboard.html'), dashboard(history));
  log(`history: ${history.length} run(s) — ${path.join(historyDir, 'dashboard.html')}`);
}

function dashboard(history: any[]): string {
  const last = history.slice(-30);
  const max = Math.max(1, ...last.map(h => h.scenarios));
  const bar = (h: any, i: number) => {
    const x = i * 28 + 8;
    const hp = (h.passed / max) * 120;
    const hf = (h.failed / max) * 120;
    return `<g><title>${h.runId}: ${h.passed} passed, ${h.failed} failed, ${h.heals} healed</title>` +
      `<rect x="${x}" y="${140 - hp - hf}" width="20" height="${hf}" fill="var(--bad)"/>` +
      `<rect x="${x}" y="${140 - hp}" width="20" height="${hp}" fill="var(--good)"/></g>`;
  };
  const totals = (k: string) => history.reduce((n, h) => n + (h[k] ?? 0), 0);
  const tile = (label: string, value: number) => `<div class="tile"><div class="v">${value}</div><div class="l">${label}</div></div>`;
  const rows = [...history].reverse().slice(0, 50).map(h =>
    `<tr><td>${h.runId}</td><td>${h.date.slice(0, 16).replace('T', ' ')}</td><td>${h.passed}/${h.scenarios}</td><td>${h.heals}</td>` +
    `<td>${h.verified}</td><td>${(h.reused ?? 0) + (h.fromRunCache ?? 0)}</td><td>${h.rejected}</td><td>${h.defects}</td><td>${h.notReproduced}</td><td>${h.manualReview}</td>` +
    `<td>${h.environment}</td><td>${h.copilotCalls}</td><td>${h.runASeconds}s / ${h.totalSeconds}s</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PSD heal dashboard</title><style>
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--good:#1a7f37;--bad:#cf222e;--card:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--good:#3fb950;--bad:#f85149;--card:#161b22}}
body{background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;margin:0;padding:16px;max-width:1100px}
h1{font-size:20px}.tiles{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 12px;min-width:110px}
.v{font-size:22px;font-weight:600}.l{color:var(--muted);font-size:12px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:6px;text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:600}svg{max-width:100%}
</style></head><body><h1>PSD heal dashboard</h1><p style="color:var(--muted)">${history.length} run(s). Bars: scenarios passed (green) and failed (red) in Run A, last ${last.length} runs.</p>
<div class="tiles">${tile('steps healed', totals('heals'))}${tile('fixes verified', totals('verified'))}${tile('fixes reused', totals('reused') + totals('fromRunCache'))}${tile('fixes rejected', totals('rejected'))}${tile('defects', totals('defects'))}${tile('not reproduced', totals('notReproduced'))}${tile('manual review', totals('manualReview'))}${tile('environment', totals('environment'))}${tile('Copilot calls', totals('copilotCalls'))}</div>
<svg viewBox="0 0 ${last.length * 28 + 16} 150" height="150" role="img" aria-label="Scenarios passed and failed per run">${last.map(bar).join('')}</svg>
<div class="wrap"><table><thead><tr><th>Run</th><th>Date (UTC)</th><th>Passed</th><th>Healed</th><th>Verified</th><th>Reused</th><th>Rejected</th><th>Defects</th><th>Not repr.</th><th>Manual</th><th>Env.</th><th>Copilot</th><th>Run A / total</th></tr></thead><tbody>${rows}</tbody></table></div>
</body></html>`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
