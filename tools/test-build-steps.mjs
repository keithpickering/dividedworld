/**
 * tools/build.mjs's `problems()`, driven red on purpose.
 *
 *   node tools/test-build-steps.mjs
 *
 * Every case starts from the real step list, the real `git ls-files` and the real
 * package.json, and breaks exactly one thing — because a checker proved against a
 * synthetic list proves only that it can read the list. The last case asserts the real
 * inputs pass, so a `problems()` that has gone quiet fails here rather than reading as
 * green.
 *
 * The case this file exists for is the first: two lists that differ by one guard. That
 * is exactly how a `build` and a `build:ci` drift when they are `&&` chains, and it is
 * the one thing a person cannot see across thousands of characters on one line. The
 * second case this file exists for is the pair rule: a check without the test that
 * drives it red, which is a guard nobody has ever seen work.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { steps, problems, runSteps, defaultJobs, SERIAL, OUTSIDE_THE_BUILD, SCRIPTS } from './build.mjs';

const TRACKED = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean));
const PKG = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
const REAL = { plain: steps(), checked: steps({ check: true }), tracked: TRACKED, scripts: PKG, outside: OUTSIDE_THE_BUILD };

let failures = 0;

/** @param {string} name @param {object} input @param {RegExp} expected */
function red(name, input, expected) {
  const found = problems({ ...REAL, ...input });
  if (found.some((p) => expected.test(p))) {
    console.log(`ok    ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(`      expected a complaint matching ${expected}`);
  console.error(found.length ? `      got:${found.map((f) => `\n        - ${f}`).join('')}` : '      got: no complaints at all');
}

const drop = (list, step) => list.filter((s) => s !== step);
/* The working-rules test, moved from its place before its check to the end of the list. */
const moved = (list) => {
  const out = list.filter((s) => s !== 'node tools/test-working-rules.mjs');
  out.push('node tools/test-working-rules.mjs');
  return out;
};
/* The guard the drift cases remove and double. It has to be a step that is really in
   STEPS, or dropping it changes nothing. */
const HERO = 'node tools/check-doc-references.mjs';
const HERO_FILE = HERO.slice('node '.length);
const HERO_STEM = HERO_FILE.slice('tools/'.length).replace(/\.mjs$/, '');

/* ---- the two lists drifting apart, both ways round ---- */
red('the checked list has a step the plain one lacks',
  { plain: drop(REAL.plain, HERO) }, /--check must prepend exactly one/);
red('the plain list has a step the checked one lacks',
  { checked: drop(REAL.checked, HERO) }, /--check must prepend exactly one/);
red('typecheck leaks into the plain list',
  { plain: ['npm run typecheck', ...REAL.plain] }, /typecheck is in the plain list/);

/* ---- reach ---- */
red('a step names a tool git does not track',
  { plain: [...REAL.plain, 'node tools/check-nothing-here.mjs'], checked: [...REAL.checked, 'node tools/check-nothing-here.mjs'] },
  /check-nothing-here\.mjs names a file git does not track/);
red('a step names an npm script package.json lacks',
  { plain: [...REAL.plain, 'npm run test:nowhere'], checked: [...REAL.checked, 'npm run test:nowhere'] },
  /names a script package\.json does not have/);
red('an npm script reaches a dead tool through a sub-script',
  { plain: [...REAL.plain, 'npm run test:sql'], checked: [...REAL.checked, 'npm run test:sql'], scripts: { ...PKG, 'test:sql': 'node tools/test-gone.mjs' } },
  /test-gone\.mjs names a file git does not track/);
red('an npm script names itself',
  { plain: [...REAL.plain, 'npm run test:sql'], checked: [...REAL.checked, 'npm run test:sql'], scripts: { ...PKG, 'test:sql': 'npm run push:check', 'push:check': 'npm run test:sql' } },
  /reaches itself/);
red('a step the runner cannot spawn',
  { plain: [...REAL.plain, 'esbuild src/x.ts'], checked: [...REAL.checked, 'esbuild src/x.ts'] }, /not a step the runner can spawn/);

/* ---- once ---- */
red('a guard listed twice',
  { plain: [...REAL.plain, HERO], checked: [...REAL.checked, HERO] }, new RegExp(`${HERO_STEM}\\.mjs runs twice`));

/* ---- coverage ---- */
red('a check tool exists and runs nowhere',
  { tracked: new Set([...TRACKED, 'tools/check-orphan.mjs', 'tools/test-orphan.mjs']) }, /check-orphan\.mjs is in neither the build nor OUTSIDE_THE_BUILD/);
red('a test tool exists and runs nowhere',
  { tracked: new Set([...TRACKED, 'tools/test-orphan.mjs']) }, /test-orphan\.mjs is in neither/);
red('an excuse for a tool that is in the build',
  { outside: { ...OUTSIDE_THE_BUILD, [HERO_FILE]: 'no reason' } }, new RegExp(`excuses ${HERO_FILE}, which is in the build`));
red('an excuse for a tool git does not track',
  { outside: { ...OUTSIDE_THE_BUILD, 'tools/test-vanished.mjs': 'gone' } }, /names tools\/test-vanished\.mjs, which git does not track/);
red('a check without its test',
  { tracked: new Set([...TRACKED, 'tools/check-orphan.mjs']) },
  /check-orphan\.mjs has no tools\/test-orphan\.mjs/);
red('an excused check without its test',
  { tracked: new Set([...TRACKED, 'tools/check-excused.mjs']), outside: { ...OUTSIDE_THE_BUILD, 'tools/check-excused.mjs': 'excused, and still needs its test' } },
  /check-excused\.mjs has no tools\/test-excused\.mjs/);
red('a check whose test is not immediately before it',
  { plain: moved(REAL.plain), checked: ['npm run typecheck', ...moved(REAL.plain)] },
  /test-working-rules\.mjs must run immediately before tools\/check-working-rules\.mjs/);

/* ---- package.json ---- */
red('the chain creeps back into package.json',
  { scripts: { ...PKG, build: 'node tools/test-build-steps.mjs && node tools/build.mjs --check' } }, /package\.json "build" is/);
red('build:ci stops calling the runner',
  { scripts: { ...PKG, 'build:ci': 'tsc --noEmit' } }, /package\.json "build:ci" is/);
if (PKG.build !== SCRIPTS.build || PKG['build:ci'] !== SCRIPTS['build:ci']) {
  failures += 1;
  console.error('FAIL  package.json build scripts are not the two one-liners SCRIPTS names');
} else {
  console.log('ok    package.json build scripts are the two one-liners');
}

/* ---- SERIAL: a subset of STEPS ---- */
red('SERIAL names a step that is not in STEPS',
  { serial: new Set([...SERIAL, 'node tools/check-nowhere.mjs']) }, /SERIAL names "node tools\/check-nowhere\.mjs", which is not in STEPS/);

/* ---- the runner, on a fake step list ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A fake spawn: `plan[step]` is { status, signal, out, ms, never }. It records dispatch order, what ran alone and what was killed.
 * @param {Record<string, any>} plan @param {any} opts */
function fakeRun(plan, { all, jobs, serial = new Set(), start = 0, check = false, clock, abort, budgetMs }) {
  const spawned = [];
  const logs = [];
  const errs = [];
  const killed = [];
  let live = 0;
  let maxLive = 0;
  const events = [];
  const spawn = (step, onData) => {
    const p = plan[step] ?? {};
    spawned.push(step);
    live += 1; maxLive = Math.max(maxLive, live);
    events.push(`start ${step}`);
    if (p.out) onData(p.out);
    const done = p.never ? new Promise(() => {}) : sleep(p.ms ?? 2).then(() => { live -= 1; events.push(`end ${step}`); if (clock) clock.t += p.advance ?? 0; return { status: 'status' in p ? p.status : 0, signal: p.signal }; });
    return { done, kill: () => { killed.push(step); } };
  };
  const done = runSteps({ all, jobs, serial, start, check, spawn, abort, budgetMs, now: clock ? () => clock.t : undefined, log: (s) => logs.push(s), error: (s) => errs.push(s) });
  return done.then((code) => ({ code, spawned, logs: logs.join('\n'), errs: errs.join('\n'), maxLive, events, killed }));
}
const test = async (name, fn) => {
  try { const why = await fn(); if (why === true) console.log(`ok    ${name}`); else { failures += 1; console.error(`FAIL  ${name}${why ? `\n      ${why}` : ''}`); } }
  catch (e) { failures += 1; console.error(`FAIL  ${name}\n      threw ${e?.stack ?? e}`); }
};
{
  const ABCD = ['a', 'b', 'c', 'd'];
  const r1 = await fakeRun({ b: { status: 3, out: 'boom\nline two\n', ms: 3 }, a: { ms: 25 } }, { all: ABCD, jobs: 2 });
  await test('a failing step stops new dispatch, the running one finishes, its output is printed whole, and the exit status is its own',
    () => r1.code === 3 && r1.spawned.join() === 'a,b' && r1.events.includes('end a') && r1.errs.includes('boom\nline two\n') && /2 of 4 did not run/.test(r1.errs) || JSON.stringify(r1));
  const r2 = await fakeRun({ b: { status: 3 } }, { all: ['a', 'b', 'c', 's'], jobs: 2, serial: new Set(['s']) });
  await test('a pool failure runs no SERIAL step after it, and exits non-zero', () => r2.code === 3 && !r2.spawned.includes('s') || JSON.stringify(r2));
  const r3 = await fakeRun({ s: { status: 5, out: 'serial boom\n' } }, { all: ['a', 's', 'b'], jobs: 2, serial: new Set(['s']) });
  await test('a SERIAL failure exits non-zero, with its output', () => r3.code === 5 && r3.errs.includes('serial boom') || JSON.stringify(r3));
  const r4 = await fakeRun({}, { all: ['a', 's', 'b', 'c', 't'], jobs: 3, serial: new Set(['s', 't']) });
  await test('exit 0 only when every step was spawned once and returned 0', () => r4.code === 0 && r4.spawned.length === 5 && new Set(r4.spawned).size === 5 && /5 step\(s\)/.test(r4.logs) || JSON.stringify(r4));
  await test('SERIAL steps run alone, after the pool, in STEPS order', () => r4.spawned.slice(3).join() === 's,t' && r4.events.indexOf('start s') > r4.events.lastIndexOf('end c') && r4.events.indexOf('start t') > r4.events.indexOf('end s') || r4.events.join());
  const r5 = await fakeRun({ a: { ms: 8 }, b: { ms: 2 } }, { all: ['a', 'b', 'c', 'd'], jobs: 1 });
  await test('--jobs 1 runs in order, one at a time', () => r5.spawned.join() === 'a,b,c,d' && r5.maxLive === 1 || JSON.stringify(r5));
  const r6 = await fakeRun({ b: { signal: 'SIGKILL', status: null } }, { all: ['a', 'b', 'c'], jobs: 1 });
  await test('a step that dies by a signal makes the run exit non-zero', () => r6.code === 1 && /died \(SIGKILL\)/.test(r6.errs) || JSON.stringify(r6));
  const r7 = await fakeRun({ 'npm run typecheck': { ms: 15, out: 'types\n' } }, { all: ['npm run typecheck', 'a', 'b'], jobs: 4, check: true });
  await test('--check runs the type check first and alone', () => r7.events.slice(0, 2).join() === 'start npm run typecheck,end npm run typecheck' || r7.events.join());
  const r8 = await fakeRun({}, { all: ['a', 'b', 'c'], jobs: 1, start: 1 });
  await test('--from starts dispatch at the step it names', () => r8.spawned.join() === 'b,c' || r8.spawned.join());
  const r10 = await (async () => { const logs = []; const errs = []; const code = await runSteps({ all: ['a', 'bad', 'c'], jobs: 1, serial: new Set(), spawn: (step) => { if (step === 'bad') throw new Error('EAGAIN'); return { done: Promise.resolve({ status: 0 }), kill() {} }; }, log: (t) => logs.push(t), error: (t) => errs.push(t) }); return { code, errs: errs.join('\n') }; })();
  await test('a step that cannot be spawned is a recorded failure, not a rejection', () => r10.code === 1 && /bad.*could not be spawned: EAGAIN/s.test(r10.errs) || JSON.stringify(r10));
  const r9 = await fakeRun({ b: { status: 3, out: 'once only\n' }, a: { ms: 20 } }, { all: ['a', 'b'], jobs: 2 });
  await test('a failure prints its output once at the tail and a FAIL line in the stream', () => /FAIL exited 3/.test(r9.logs) && /^FAIL  b exited 3/m.test(r9.errs) && r9.errs.split('once only').length === 2 && !r9.logs.includes('once only') || JSON.stringify(r9));
  const clock = { t: 0 };
  const slow = await fakeRun({ a: { advance: 700_000 } }, { all: ['a'], jobs: 1, clock });
  await test('the warning appears past the budget', () => /warning: the build took .*over 10 minutes; the slowest steps are above/.test(slow.logs) && slow.code === 0 || JSON.stringify(slow));
  const clock2 = { t: 0 };
  const quick = await fakeRun({ a: { advance: 599_000 } }, { all: ['a'], jobs: 1, clock: clock2 });
  await test('and does not appear under it', () => !/warning:/.test(quick.logs) && quick.code === 0 || JSON.stringify(quick));
  let stop;
  const ab = await Promise.all([fakeRun({ hang: { never: true, out: 'half a line of output' } }, { all: ['hang', 'ok'], jobs: 2, abort: { on: (cb) => { stop = cb; } } }), sleep(20).then(() => stop())]).then(([r]) => r);
  await test('on a signal the runner prints every running step\'s buffer under its name and exits 1, never 0', () => ab.code === 1 && /hang/.test(ab.errs) && ab.errs.includes('half a line of output') && ab.killed.join() === 'hang' && !/step\(s\) in/.test(ab.logs) || JSON.stringify(ab));
}
{
  const GB = 1024 ** 3;
  const base = { available: 16, totalMem: 64 * GB };
  const eq = (a, b) => a === b || `${a} != ${b}`;
  await test('default workers honour a cgroup v2 cpu.max of 200000 100000 (2)', () => eq(defaultJobs({ ...base, cpuMax: '200000 100000\n' }).jobs, 2));
  await test('and a cpu.max of "max 100000" is no limit', () => eq(defaultJobs({ ...base, cpuMax: 'max 100000\n' }).jobs, 8));
  await test('default workers honour a cgroup v1 quota of 150000 over 100000 (1)', () => eq(defaultJobs({ ...base, v1Quota: '150000', v1Period: '100000' }).jobs, 1));
  await test('a v1 quota of -1 is no limit', () => eq(defaultJobs({ ...base, v1Quota: '-1', v1Period: '100000' }).jobs, 8));
  await test('default workers are capped at 8', () => eq(defaultJobs({ available: 64, totalMem: 512 * GB }).jobs, 8));
  await test('default workers follow memory at 1.5 GB a worker', () => eq(defaultJobs({ available: 16, totalMem: 6 * GB }).jobs, 4));
  await test('a container\'s own memory limit counts when it is lower than the host\'s, and the source is named', () => {
    const d = defaultJobs({ available: 16, totalMem: 64 * GB, constrainedMem: 3 * GB });
    return d.jobs === 2 && /constrainedMemory/.test(d.memHow) || JSON.stringify(d);
  });
  await test('a zero constrained memory is no limit, and there is always at least one worker', () => defaultJobs({ available: 1, totalMem: 1 * GB, constrainedMem: 0 }).jobs === 1 && /totalmem/.test(defaultJobs({ ...base }).memHow));
}

/* ---- and the real thing passes ---- */
const real = problems(REAL);
if (real.length) {
  failures += 1;
  console.error(`FAIL  the committed step list has ${real.length} problem(s):${real.map((f) => `\n        - ${f}`).join('')}`);
} else {
  console.log(`ok    the committed step list passes (${REAL.plain.length} steps, ${REAL.checked.length} with --check)`);
}

if (failures) {
  console.error(`\n${failures} failure(s) in test-build-steps`);
  process.exit(1);
}
console.log('\nall build-steps cases pass');
