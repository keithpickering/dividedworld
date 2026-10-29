/**
 * The build, as one list.
 *
 *   npm run build:ci        node tools/build.mjs            what CI runs
 *   npm run build           node tools/build.mjs --check    the same, plus the type check
 *   node tools/build.mjs --list [--check]                   print the steps and stop
 *   node tools/build.mjs --jobs 1                           one step at a time (default: the pool, below)
 *   node tools/build.mjs --from doc-references              resume at the first step whose
 *                                                           command contains that text
 *
 * The shape this replaces, in the project this runner was first built in: a build that lived
 * in package.json as two `&&` chains, thousands of characters on one line, that were supposed
 * to be the same list apart from one step. They were not. A guard had been added to `build:ci`
 * and never to `build`, so for days a local build could not fail on the one guard CI would,
 * and the sentence that `build` is "exactly `build:ci` plus the check" was a claim with
 * nothing reading it. It was found by diffing the two strings, which is not a thing anybody
 * does by eye.
 *
 * So the steps are one array here, in the order they run, and the two npm scripts are
 * one-liners that call this file. The difference between them is a flag, and
 * `problems()` below asserts that the flag adds the type check and nothing else. The
 * same function refuses to start a build whose list names a tool git does not track, a
 * script package.json does not have, a step twice, or a check without the test that
 * drives it red — before step one, rather than late in the run when the missing file is
 * finally reached.
 *
 * What the runner does that an `&&` chain could not:
 *
 * - It says which step failed, by name, at the tail. An `&&` chain ends in npm's
 *   "Lifecycle script failed" with the exit code and nothing else, and the step that
 *   went red is somewhere above it in the scroll. Steps run on a pool of workers, so each
 *   step's output is buffered and printed whole when it ends, under its own `--- [i/N]`
 *   line; nothing in it is filtered or summarised, and every failure is printed again,
 *   with its output, at the tail.
 * - It times every step and lists the slowest at the end, so when the build feels slow
 *   the answer is measured rather than guessed.
 * - It runs every step but the SERIAL ones on `--jobs N` workers (default: the lowest of
 *   the CPUs, the container's CPU quota, the memory over 1.5 GB a worker, and 8), then
 *   the SERIAL ones alone, in order. `--jobs 1` is a serial run. A step failing stops new
 *   dispatch; the running ones finish.
 * - `--from` resumes after a fix. It is refused when CI or NETLIFY is set, because a
 *   skipped guard on a build that publishes is a false green — the flag exists for the
 *   loop in front of a person, and nowhere else.
 *
 * Adding a guard: put its `node tools/x.mjs` line in STEPS, immediately after the
 * `node tools/test-x.mjs` that drives it red. A `check-*.mjs` or `test-*.mjs` that is
 * deliberately *not* part of the build goes in OUTSIDE_THE_BUILD with the reason, or
 * `problems()` will name it. That is the point: a guard nobody wired in was previously
 * indistinguishable from one that was.
 *
 * Copied from currents (docs/plans/port-manifest.md) with its product steps left behind. The
 * Docs workflow's `--docs` subset comes back with the stage that needs it. The SQL suite is
 * outside this list (OUTSIDE_THE_BUILD) and runs in its own workflow, which has the database.
 */

import fs from 'node:fs';
import os from 'node:os';
import { execFileSync, spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Every step of the build, in order. The two doc guards run before anything else, so a
 * docs-only change fails in a second rather than after everything that follows. A check
 * sits immediately after its own test.
 */
export const STEPS = [
  'node tools/test-build-steps.mjs',
  'node tools/test-working-rules.mjs',
  'node tools/check-working-rules.mjs',
  'node tools/test-doc-references.mjs',
  'node tools/check-doc-references.mjs',
  'node tools/test-sql-refusal.mjs',
  'node tools/test-engine-boundary.mjs',
  'node tools/check-engine-boundary.mjs',
  'node tools/test-name-folds.mjs',
  'node tools/check-name-folds.mjs',
  'npm run test:engine',
];

/**
 * The steps that run alone, after the pool, in STEPS order: a step that writes a tree the
 * steps after it read, and every step whose file asserts an absolute wall-clock bound, which a
 * loaded pool could trip. A subset of STEPS, checked by `problems()`. test:engine times the
 * settlement at a busy instance's scale (engine/rules/settle.scale.test.ts).
 */
export const SERIAL = new Set(['npm run test:engine']);

/**
 * `check-*.mjs` and `test-*.mjs` files in tools/ that are deliberately not in STEPS, each
 * with the reason. `problems()` names any such file that is in neither place, so a guard
 * that exists but runs nowhere cannot pass as one that runs. An excuse names a tracked
 * file; one for a file that does not exist yet is stale from the day it is written, and
 * problems() says so. Each excuse arrives with its file.
 */
/** @type {Record<string, string>} */
export const OUTSIDE_THE_BUILD = {
  'tools/test-sql.mjs': 'needs Postgres, which the build does not have; it runs in .github/workflows/sql.yml against a Postgres service, and its refusal of any database but localhost is driven red in the build by tools/test-sql-refusal.mjs',
};

/** What package.json's two build scripts must be, exactly. */
export const SCRIPTS = {
  build: 'node tools/build.mjs --check',
  'build:ci': 'node tools/build.mjs',
};

const NODE_STEP = /^node (tools\/[\w.-]+\.mjs)$/;
const NPM_STEP = /^npm run ([\w:.-]+)$/;
const CHECK_STEP = 'npm run typecheck';

/** The steps for one run: STEPS, with the type check first when asked. */
export function steps({ check = false } = {}) {
  return check ? [CHECK_STEP, ...STEPS] : [...STEPS];
}

/**
 * Follow `npm run x` through package.json until every step is a node or shell command.
 * Returns the flat list; a script that names itself, or a chain the runner cannot
 * spawn, comes back as a `problem` string on the second list.
 */
function expand(list, scripts, seen = []) {
  const flat = [];
  const problems = [];
  for (const s of list) {
    const m = s.match(NPM_STEP);
    if (!m) { flat.push(s); continue; }
    const name = m[1];
    if (seen.includes(name)) { problems.push(`npm run ${name} reaches itself: ${[...seen, name].join(' -> ')}`); continue; }
    if (!(name in scripts)) { problems.push(`${s} names a script package.json does not have`); continue; }
    const sub = expand(scripts[name].split(/\s*&&\s*/), scripts, [...seen, name]);
    flat.push(...sub.flat);
    problems.push(...sub.problems);
  }
  return { flat, problems };
}

/**
 * Everything wrong with a build list, as strings; [] means the build may start.
 *
 * @param {object} input
 * @param {string[]} input.plain       steps() without --check
 * @param {string[]} input.checked     steps() with --check
 * @param {Set<string>} input.tracked  `git ls-files`
 * @param {Record<string,string>} input.scripts  package.json's scripts
 * @param {Record<string,string>} [input.outside]  OUTSIDE_THE_BUILD
 * @param {Set<string>} [input.serial]  SERIAL
 */
export function problems({ plain, checked, tracked, scripts, outside = OUTSIDE_THE_BUILD, serial = SERIAL }) {
  const out = [];

  /* SERIAL: a subset of STEPS. */
  for (const r of serial) if (!plain.includes(r)) out.push(`SERIAL names "${r}", which is not in STEPS`);

  /* Shape: every top-level step is something the runner can spawn. */
  for (const s of plain) {
    if (!NODE_STEP.test(s) && !NPM_STEP.test(s)) {
      out.push(`"${s}" is not a step the runner can spawn (node tools/…, npm run …)`);
    }
  }

  /* --check: prepends the type check, nothing else. */
  if (plain.includes(CHECK_STEP)) out.push('typecheck is in the plain list; it belongs only to --check');
  if (checked[0] !== CHECK_STEP || checked.slice(1).join('\n') !== plain.join('\n')) {
    out.push('--check must prepend exactly one "npm run typecheck" and change nothing else');
  }

  /* Reach: every npm script exists and bottoms out; every node step names a tracked file. */
  const { flat, problems: reach } = expand(plain, scripts);
  out.push(...reach);
  for (const s of flat) {
    const m = s.match(NODE_STEP);
    if (m && !tracked.has(m[1])) out.push(`${s} names a file git does not track`);
  }

  /* Once: no tool step twice, after expansion. Sub-scripts may share a prep step that is
     idempotent and a second long; a guard run twice is the redundancy worth naming. */
  const seen = new Set();
  for (const s of flat) {
    if (!NODE_STEP.test(s)) continue;
    if (seen.has(s)) out.push(`${s} runs twice`);
    seen.add(s);
  }

  /* Coverage: every check/test tool is in the build or excused, and no excuse is stale. */
  const inBuild = new Set(flat.map((s) => s.match(NODE_STEP)?.[1]).filter(Boolean));
  for (const f of tracked) {
    if (!/^tools\/(check|test)-[\w.-]+\.mjs$/.test(f)) continue;
    if (!inBuild.has(f) && !(f in outside)) out.push(`${f} is in neither the build nor OUTSIDE_THE_BUILD`);
  }
  for (const f of Object.keys(outside)) {
    if (!tracked.has(f)) out.push(`OUTSIDE_THE_BUILD names ${f}, which git does not track`);
    if (inBuild.has(f)) out.push(`OUTSIDE_THE_BUILD excuses ${f}, which is in the build`);
  }

  /* Pair: a check travels with the test that drives it red, and the test runs first.
     Every check, an excused one included: an excuse says why the check is not in the
     build, never that it has been seen red. An excused check is absent from the flat
     list, so only the test's existence is asserted for it, not adjacency. */
  for (const f of tracked) {
    const m = f.match(/^tools\/check-([\w.-]+)\.mjs$/);
    if (!m) continue;
    const test = `tools/test-${m[1]}.mjs`;
    if (!tracked.has(test)) { out.push(`${f} has no ${test}`); continue; }
    const at = flat.indexOf(`node ${f}`);
    if (at === -1) continue; // excused checks are covered above
    if (flat[at - 1] !== `node ${test}`) out.push(`${test} must run immediately before ${f}`);
  }

  /* package.json: the two scripts call this file and hold no chain of their own. */
  for (const [name, want] of Object.entries(SCRIPTS)) {
    if (scripts[name] !== want) out.push(`package.json "${name}" is ${JSON.stringify(scripts[name])}; it must be ${JSON.stringify(want)}`);
  }

  return out;
}

/* ---------------------------------------------------------------- the runner ---- */

function tracked() {
  return new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean));
}

/** argv and a spawn shape for one step; the shapes are the two `problems()` admits. */
function command(step) {
  let m;
  if ((m = step.match(NODE_STEP))) return { file: process.execPath, args: [m[1]] };
  if ((m = step.match(NPM_STEP))) {
    /* Under npm, npm_execpath is npm's own entry point — spawn it with this node, which
       is portable and avoids a shell. Run bare, fall back to whatever `npm` resolves to. */
    if (process.env.npm_execpath) return { file: process.execPath, args: [process.env.npm_execpath, 'run', m[1]] };
    return { file: 'npm', args: ['run', m[1]], shell: process.platform === 'win32' };
  }
  throw new Error(`no spawn shape for "${step}"`);
}

const fmt = (ms) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

/* ------------------------------------------------------------------ the pool ---- */

const MAX_JOBS = 8;
const BYTES_PER_JOB = 1.5 * 1024 ** 3;
export const BUDGET_MS = 600_000;

/**
 * The worker count when `--jobs` is not given: the lowest of the CPUs, the memory over 1.5 GB a
 * worker, and 8. `os.availableParallelism()` does not see a container's CPU quota, so the quota is
 * read from the cgroup (v2 `cpu.max`, else v1 `cpu.cfs_quota_us` over `cpu.cfs_period_us`) and
 * counts as the CPUs when it is lower; likewise `os.totalmem()` is the host's, so a container's
 * own limit (`process.constrainedMemory()`) counts when it is non-zero and lower. The files' text
 * is passed in, so a test needs no container. Returns what it chose and how each limit was read,
 * for the summary line.
 *
 * @param {{ available: number, cpuMax?: string|null, v1Quota?: string|null, v1Period?: string|null, totalMem: number, constrainedMem?: number }} input
 */
export function defaultJobs({ available, cpuMax = null, v1Quota = null, v1Period = null, totalMem, constrainedMem = 0 }) {
  let cpus = Math.max(1, available);
  let cpuHow = 'os.availableParallelism()';
  let quota = null;
  let quotaHow = '';
  const v2 = String(cpuMax ?? '').trim().split(/\s+/);
  if (v2.length === 2 && v2[0] !== 'max' && Number(v2[0]) > 0 && Number(v2[1]) > 0) { quota = Number(v2[0]) / Number(v2[1]); quotaHow = 'cgroup cpu.max'; }
  else if (Number(v1Quota) > 0 && Number(v1Period) > 0) { quota = Number(v1Quota) / Number(v1Period); quotaHow = 'cgroup v1 cfs quota'; }
  if (quota !== null) {
    const q = Math.max(1, Math.floor(quota));
    if (q < cpus) { cpus = q; cpuHow = quotaHow; }
  }
  let memBytes = totalMem;
  let memHow = 'os.totalmem()';
  if (constrainedMem > 0 && constrainedMem < memBytes) { memBytes = constrainedMem; memHow = 'process.constrainedMemory()'; }
  const byMemory = Math.max(1, Math.floor(memBytes / BYTES_PER_JOB));
  return { jobs: Math.min(cpus, byMemory, MAX_JOBS), cpus, cpuHow, memBytes, memHow };
}

/** What `defaultJobs` is given on this machine. */
function machine() {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  return {
    available: os.availableParallelism(),
    cpuMax: read('/sys/fs/cgroup/cpu.max'),
    v1Quota: read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'),
    v1Period: read('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    totalMem: os.totalmem(),
    constrainedMem: typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0,
  };
}

/**
 * Runs `all` (the steps of one run, the type check first when it is there): the type check alone,
 * then every non-SERIAL step on `jobs` workers in dispatch order, then the SERIAL steps one at a
 * time. On a failure no new step starts, the running ones finish, and every failure is printed
 * with its output and the count of steps not run. Returns the exit status: 0 only when every step
 * from `start` was spawned once and returned 0, else the first failure's status, or 1 when it
 * died by a signal or the run was aborted.
 *
 * `spawn(step)` returns `{ done: Promise<{ status: number|null, signal?: string, error?: string }>, kill() }`
 * and calls `onData(text)` as the step prints; `abort` is `{ on(cb) }`, called on SIGTERM or SIGINT.
 *
 * @param {object} o
 * @param {string[]} o.all @param {number} o.jobs @param {Set<string>} [o.serial] @param {number} [o.start]
 * @param {(step: string, onData: (text: string) => void) => { done: Promise<any>, kill: () => void }} o.spawn
 * @param {() => number} [o.now] @param {(s: string) => void} [o.log] @param {(s: string) => void} [o.error]
 * @param {{ on: (cb: () => void) => void }} [o.abort] @param {boolean} [o.check] @param {string} [o.how] @param {number} [o.budgetMs]
 */
export async function runSteps({ all, jobs, serial = SERIAL, start = 0, spawn, now = Date.now, log = console.log, error = console.error, abort, check = false, how = '', budgetMs = BUDGET_MS }) {
  const total = all.length;
  const tag = (i) => `[${String(i + 1).padStart(3)}/${total}]`;
  const indices = all.map((_, i) => i).filter((i) => i >= start);
  const first = check && all[0] === CHECK_STEP && start === 0 ? [0] : [];
  const pool = indices.filter((i) => !first.includes(i) && !serial.has(all[i]));
  const alone = indices.filter((i) => !first.includes(i) && serial.has(all[i]));
  const phases = [first, pool, alone].filter((p) => p.length);
  const timings = [];
  const spawned = new Map();
  const results = new Map();
  /** @type {{ i: number, step: string, ms: number, how: string, out: string, status: number|null }[]} */
  const failures = [];
  const running = new Map();
  let aborted = false;
  const t0 = now();

  /** @type {(v?: any) => void} */
  let abortResolve = () => {};
  const aborting = new Promise((resolve) => { abortResolve = resolve; });
  abort?.on(() => {
    if (aborted) return;
    aborted = true;
    for (const [i, r] of running) {
      error(`\n--- ${tag(i)} ${all[i]}  (still running when the build was stopped)\n${r.buffer()}`);
      try { r.kill(); } catch { /* it has gone already */ }
    }
    error(`\nFAIL  stopped by a signal after ${fmt(now() - t0)}; ${running.size} step(s) were still running, printed above.`);
    abortResolve();
  });

  const one = async (i) => {
    const step = all[i];
    spawned.set(i, (spawned.get(i) ?? 0) + 1);
    log(`started ${tag(i)} ${step}`);
    const chunks = [];
    const t = now();
    /* A step that cannot be spawned (an unknown shape, EAGAIN under load) is a failure like any other, never a rejection that orphans the rest. */
    let child;
    try { child = spawn(step, (text) => chunks.push(text)); } catch (e) { child = { done: Promise.resolve({ status: null, error: `could not be spawned: ${e?.message ?? e}` }), kill() {} }; }
    running.set(i, { buffer: () => chunks.join(''), kill: () => child.kill() });
    const r = await Promise.race([Promise.resolve(child.done).catch((e) => ({ status: null, error: String(e?.message ?? e) })), aborting.then(() => null)]);
    running.delete(i);
    if (r === null) return;
    const ms = now() - t;
    timings.push({ step, ms });
    results.set(i, r.status);
    const out = chunks.join('');
    if (r.status === 0) { log(`\n--- ${tag(i)} ${step}\n${out}${out === '' || out.endsWith('\n') ? '' : '\n'}    ok ${fmt(ms)}`); return; }
    const why = r.status === null ? `died (${r.signal ?? r.error ?? 'no status'})` : `exited ${r.status}`;
    failures.push({ i, step, ms, how: why, out, status: r.status });
    log(`\n--- ${tag(i)} ${step}\n    FAIL ${why} after ${fmt(ms)}; its output is printed again at the end`);
  };

  for (const phase of phases) {
    const width = phase === pool ? jobs : 1;
    const queue = [...phase];
    await Promise.race([aborting, Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
      while (queue.length && !failures.length && !aborted) await one(/** @type {number} */ (queue.shift()));
    }))]);
    if (aborted) return 1;
    if (failures.length) break;
  }

  const wall = now() - t0;
  const slow = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const overBudget = wall > budgetMs;
  if (failures.length) {
    for (const f of failures) error(`\nFAIL  ${f.step} ${f.how} after ${fmt(f.ms)}\n${f.out}`);
    const ran = [...spawned.keys()].length;
    error(`      ${failures.length} step(s) failed; ${indices.length - ran} of ${indices.length} did not run. ${fmt(wall)} so far.${how ? ` ${how}` : ''}`);
    if (!process.env.CI && !process.env.NETLIFY) error(`      after a fix, to rerun the first failure alone: ${failures[0].step}`);
    return failures[0].status ?? 1;
  }
  const clean = indices.every((i) => spawned.get(i) === 1 && results.get(i) === 0);
  log(`\n${clean ? 'ok   ' : 'FAIL '} ${timings.length} step(s) in ${fmt(wall)}${check ? ' (with typecheck)' : ''}${how ? `; ${how}` : ''}. Slowest:`);
  for (const { step, ms } of slow) log(`      ${fmt(ms).padStart(6)}  ${step}`);
  if (overBudget) log(`warning: the build took ${fmt(wall)}, over 10 minutes; the slowest steps are above`);
  return clean ? 0 : 1;
}

/** The real spawn: piped, merged output, the shapes `command()` admits. */
function realSpawn(step, onData) {
  const { file, args, shell } = command(step);
  const child = spawnChild(file, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: Boolean(shell), env: process.env });
  /* utf8 decoding per stream, so a character split across two chunks is not broken. */
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const done = new Promise((resolve) => {
    child.on('error', (e) => resolve({ status: null, error: e.message }));
    child.on('close', (status, signal) => resolve({ status, signal: signal ?? undefined }));
    /* 'close' waits for the pipes, which a grandchild the step left running (a server, a browser) holds open; the exit itself is the answer, after a moment for the last output. */
    child.on('exit', (status, signal) => setTimeout(() => resolve({ status, signal: signal ?? undefined }), 2000).unref());
  });
  return { done, kill: () => child.kill('SIGTERM') };
}

async function main(argv) {
  const check = argv.includes('--check');
  const list = argv.includes('--list');
  const fromAt = argv.indexOf('--from');
  const from = fromAt >= 0 ? argv[fromAt + 1] : null;
  if (fromAt >= 0 && !from) {
    console.error('  build: --from needs the text of a step to start at, e.g. --from doc-references');
    return 2;
  }
  if (from && (process.env.CI || process.env.NETLIFY)) {
    console.error('  build: --from skips steps, and a skipped guard on a build that publishes is a false green. Refused under CI/NETLIFY.');
    return 2;
  }
  const jobsAt = argv.indexOf('--jobs');
  if (argv.some((a) => a.startsWith('--jobs='))) { console.error('  build: write --jobs N with a space, e.g. --jobs 4'); return 2; }
  const jobsArg = jobsAt >= 0 ? argv[jobsAt + 1] : null;
  if (jobsAt >= 0 && !/^[1-9]\d*$/.test(String(jobsArg))) {
    console.error('  build: --jobs needs a whole number of workers, at least 1, e.g. --jobs 4');
    return 2;
  }

  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
  const bad = problems({ plain: steps(), checked: steps({ check: true }), tracked: tracked(), scripts });
  if (bad.length) {
    console.error(`  build: ${bad.length} problem(s) with the step list in tools/build.mjs — nothing was run:`);
    for (const b of bad) console.error(`    - ${b}`);
    return 1;
  }

  const all = steps({ check });
  if (list) {
    for (const s of all) console.log(s);
    return 0;
  }

  let start = 0;
  if (from) {
    start = all.findIndex((s) => s.includes(from));
    if (start < 0) {
      console.error(`  build: no step contains "${from}". Try --list.`);
      return 2;
    }
    console.log(`  build: resuming at step ${start + 1} of ${all.length}; ${start} step(s) before it were NOT run`);
  }

  const m = machine();
  const d = defaultJobs(m);
  const jobs = jobsArg ? Number(jobsArg) : d.jobs;
  const gb = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
  const how = `jobs ${jobs}${jobsArg ? ' (--jobs)' : ''}; ${d.cpus} CPU(s) from ${d.cpuHow}; memory ${gb(d.memBytes)} from ${d.memHow}, os.totalmem() ${gb(m.totalMem)}`;
  console.log(`  build: ${how}`);

  const handlers = [];
  const abort = { on: (cb) => { for (const sig of ['SIGTERM', 'SIGINT']) { process.on(sig, cb); handlers.push([sig, cb]); } } };
  const code = await runSteps({
    all, jobs, start, check, how, abort, spawn: realSpawn,
  });
  for (const [sig, cb] of handlers) process.off(sig, cb);
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  process.exit(await main(process.argv.slice(2)));
}
