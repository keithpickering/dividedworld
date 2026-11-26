/**
 * The e2e cost packer's pure parts: key a test, price it, cut the suite into shards by cost.
 *
 * Design docs/plans/2026-11-26-e2e-cost-shards-design.md, sections 2 and 3. Playwright's own
 * `--shard=k/n` cuts by count, and a few specs cost most of the time, so a shard of the heavy
 * ones ran far past the rest. `--cost-shard=k/n` lists the suite, prices every test from the
 * manifest `e2e/cost.json`, packs the whole list into n shards longest first, and runs shard k
 * as a `--test-list`. Every function here is pure; the only file access is `refreshCli` (`--refresh`, see
 * its comment), and this module's self-test is tools/test-e2e-cost.mjs.
 *
 * A KEY is a test's `file › describe › ... › title`: the file relative to e2e/, then each
 * describe title, then the test title, joined by ' › '. It is the line `--test-list` reads.
 * Playwright's list JSON has one top suite per file, titled by the file, and each describe is a
 * nested suite that repeats the `file` field; the file suite's own title is therefore not a
 * describe title and is never added twice.
 *
 * The manifest is `{ measured, specs: { file: { count, mean } }, tests: { key: seconds } }`,
 * and it only gives prices: the live list is the only list of what runs, so a test the manifest
 * has never seen is still packed, at a fallback price.
 *
 * `pack(keys, manifest, n)` returns `{ shards, totals }`: `shards` is n arrays of keys and
 * `totals` is n summed prices, index for index. Input order never matters.
 *
 * `parseCostShard(argv)` takes argv without node and the script. It returns null when
 * `--cost-shard` is absent, else `{ k, n, rest }` with the flag removed. Flags are accepted only
 * as `--x=value` or a bare boolean `--x`. An argument that does not start with `-` is
 * positional, which includes the value in `--workers 2`, and is refused beside `--cost-shard`,
 * since a file filter would make the runner's list differ from the packing's. So a value is
 * always written with `=`. The flags in REFUSED are refused too, n is at most 1000, and
 * `compareRun` is the backstop for anything else that changes which tests run.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Workers per runner (playwright.config.ts) and the minutes a shard should take. */
export const WORKERS = 2;
export const BUDGET_MINUTES = 15;

export const SEP = ' › ';

/** The most shards `--cost-shard` accepts. */
const MAX_SHARDS = 1000;

/**
 * Flags that choose which tests run, or how many times, and so would make the run differ from
 * the packing: refused beside `--cost-shard` in both `--x` and `--x=v` forms. `--repeat-each`
 * is here because the report would hold each key more than once. Anything else that changes the
 * set is caught after the run by `compareRun`.
 */
const REFUSED = ['--shard', '--test-list', '--test-list-invert', '--grep', '-g', '--grep-invert', '--project', '--only-changed', '--last-failed', '--repeat-each', '--tag', '--tag-invert'];

/**
 * Every test's title path ([file, ...describes, title]) in list order.
 * @param {any} listJson @returns {string[][]}
 */
function paths(listJson) {
  const out = [];
  const visit = (suite, titles) => {
    for (const spec of suite.specs ?? []) out.push([...titles, spec.title]);
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
  };
  for (const top of listJson.suites ?? []) visit(top, [top.file ?? top.title]);
  return out;
}

/**
 * The keys of a `playwright test --list --reporter=json` (or a run's json report), in list order.
 * @param {any} listJson @returns {string[]}
 */
export function keysOf(listJson) {
  return paths(listJson).map((p) => p.join(SEP));
}

/**
 * One string per key whose segment holds a bare `›`, one per key listed twice, and one per key that is a prefix of another
 * key in the same file (Playwright would match both). A title holding " › " with its spaces is
 * indistinguishable from a describe in a key, so `listProblems` reads the titles.
 * @param {string[]} keys @returns {string[]}
 */
export function keyProblems(keys) {
  const out = [];
  for (const key of keys) {
    if (key.split(SEP).some((part) => part.includes('›'))) out.push(`"${key}" has a title holding ›, which Playwright splits a test list on`);
  }
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (keys.indexOf(key) !== keys.lastIndexOf(key)) out.push(`"${key}" is listed twice, so its list line would match both tests`);
  }
  const fileOf = (k) => k.split(SEP)[0];
  const byFile = new Map();
  for (const k of keys) byFile.set(fileOf(k), [...(byFile.get(fileOf(k)) ?? []), k]);
  for (const group of byFile.values()) {
    for (const k of group) {
      if (group.some((other) => other !== k && other.startsWith(k + SEP))) out.push(`"${k}" is a prefix of another key in its file and would match both`);
    }
  }
  return out;
}

/**
 * One string per test whose path holds a title Playwright's `--test-list` reader cannot match:
 * one holding `›` at all (spaces included), one with leading or trailing whitespace (the reader
 * trims every line and every title token), or one holding a newline (a line is one key).
 * @param {any} listJson @returns {string[]}
 */
export function listProblems(listJson) {
  const out = [];
  for (const path of paths(listJson)) {
    for (const t of path.slice(1)) {
      if (t.includes('›')) out.push(`"${path.join(SEP)}" has a title holding ›: "${t}"`);
      else if (/[\r\n]/.test(t)) out.push(`"${path.join(SEP)}" has a title holding a newline`);
      else if (t !== t.trim()) out.push(`"${path.join(SEP)}" has a title with leading or trailing whitespace: "${t}"`);
      else continue;
      break;
    }
  }
  return out;
}

/** Own-property lookup, so a file or title named `constructor` is not a manifest entry. */
const has = (obj, key) => obj != null && Object.hasOwn(obj, key);

/**
 * The suite's mean seconds per test: total seconds over total count across `specs`, or null with
 * no specs. Computed once per `pack` call and passed to `price`.
 * @param {any} manifest @returns {number | null}
 */
export function suiteMean(manifest) {
  const specs = Object.values(manifest.specs ?? {});
  const count = specs.reduce((t, s) => t + s.count, 0);
  return count > 0 ? specs.reduce((t, s) => t + s.count * s.mean, 0) / count : null;
}

/**
 * A test's estimated seconds: its own entry, else its spec's mean, else the suite's mean per
 * test, else 1. Throws unless the price is finite and above 0, since a zero or NaN price would
 * quietly mis-pack. `mean` is the suite's mean when the caller has it already.
 * @param {string} key @param {{ specs?: Record<string,{count:number,mean:number}>, tests?: Record<string,number> }} manifest
 * @param {number | null} [mean]
 */
export function price(key, manifest, mean = suiteMean(manifest)) {
  const own = has(manifest.tests, key) ? manifest.tests[key] : undefined;
  const file = key.split(SEP)[0];
  const spec = has(manifest.specs, file) ? manifest.specs[file] : undefined;
  const found = typeof own === 'number' ? own : spec ? spec.mean : mean ?? 1;
  if (!Number.isFinite(found) || found <= 0) throw new Error(`price of "${key}" is ${found}, which must be a finite number above 0`);
  return found;
}

/**
 * Longest first: sort by price descending then key ascending, and put each key in the shard with
 * the least total so far, the lowest index winning a tie. n must be a whole number of 1 or more;
 * with more shards than keys the extra shards are empty.
 * @param {string[]} keys @param {any} manifest @param {number} n
 * @returns {{ shards: string[][], totals: number[] }}
 */
export function pack(keys, manifest, n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`pack: the shard count n must be a whole number of 1 or more, got ${n}`);
  const mean = suiteMean(manifest);
  const priced = keys.map((key) => ({ key, cost: price(key, manifest, mean) }));
  priced.sort((a, b) => b.cost - a.cost || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const shards = Array.from({ length: n }, () => []);
  const totals = Array.from({ length: n }, () => 0);
  for (const { key, cost } of priced) {
    let at = 0;
    for (let i = 1; i < n; i += 1) if (totals[i] < totals[at]) at = i;
    shards[at].push(key);
    totals[at] += cost;
  }
  return { shards, totals };
}

/**
 * Reads `--cost-shard=k/n` (integers, 1 <= k <= n, once). Null when absent. Throws, naming the
 * fault, on a malformed or repeated flag, beside `--shard` or `--test-list`, or beside any
 * argument not starting with `-` (see the header).
 * @param {string[]} argv @returns {{ k: number, n: number, rest: string[] } | null}
 */
export function parseCostShard(argv) {
  const mine = argv.filter((a) => a === '--cost-shard' || a.startsWith('--cost-shard='));
  if (mine.length === 0) return null;
  if (mine.length > 1) throw new Error('--cost-shard may be given only once');
  const m = /^--cost-shard=([1-9]\d*)\/([1-9]\d*)$/.exec(mine[0]);
  if (!m) throw new Error(`--cost-shard must look like --cost-shard=k/n with whole numbers, got "${mine[0]}"`);
  const k = Number(m[1]);
  const n = Number(m[2]);
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n)) throw new Error(`--cost-shard=${m[1]}/${m[2]}: k and n must be safe whole numbers`);
  if (n > MAX_SHARDS) throw new Error(`--cost-shard: n may be at most ${MAX_SHARDS}, got ${n}`);
  if (k > n) throw new Error(`--cost-shard=${k}/${n}: k must be between 1 and n`);
  for (const a of argv) {
    const flag = REFUSED.find((f) => a === f || a.startsWith(`${f}=`));
    if (flag) throw new Error(`--cost-shard cannot be combined with ${flag}`);
  }
  const positional = argv.find((a) => !a.startsWith('-'));
  if (positional !== undefined) throw new Error(`--cost-shard refuses the positional argument "${positional}": a file filter would change the list (write flag values as --x=value)`);
  return { k, n, rest: argv.filter((a) => a !== mine[0]) };
}

/**
 * What a run's json report holds against what was assigned.
 * @param {string[]} assigned @param {any} reportJson
 * @returns {{ missing: string[], extra: string[] }}
 */
export function compareRun(assigned, reportJson) {
  const ran = new Set(keysOf(reportJson));
  const want = new Set(assigned);
  return { missing: assigned.filter((k) => !ran.has(k)), extra: [...ran].filter((k) => !want.has(k)) };
}

/** The `--test-list` file text: one key a line, ending with a newline. @param {string[]} keys */
export function testList(keys) {
  return keys.map((k) => `${k}\n`).join('');
}

/** The least price a measured test may be recorded at: a 0 ms pass would break "a price above 0". */
export const FLOOR_SECONDS = 0.1;
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * Each key of a json report with its outcome and results. Playwright's test-level `status` is its
 * outcome: "expected" (passed, or failed as `test.fail` said), "flaky" (failed, then passed on a
 * retry), "unexpected" (failed), or "skipped", which is also what a test whose only result was
 * "interrupted" reads as. A key listed twice keeps its first.
 * @param {any} report @returns {Map<string, { status: string, results: any[] }>}
 */
function outcomesOf(report) {
  const out = new Map();
  const keys = keysOf(report);
  const tests = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) tests.push(spec.tests?.[0] ?? { status: 'skipped', results: [] });
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const top of report.suites ?? []) visit(top);
  keys.forEach((key, i) => { if (!out.has(key)) out.set(key, { status: tests[i].status, results: tests[i].results ?? [] }); });
  return out;
}

/**
 * Seconds a test cost in this run, or null when its final outcome is not a pass (failed, skipped,
 * interrupted by globalTimeout, or absent from the report). A flaky test did pass in the end, and
 * the shard spent every attempt's time on it, so the price is the sum of all its results'
 * durations, as for any passed test.
 */
function measured(outcome) {
  if (!outcome || (outcome.status !== 'expected' && outcome.status !== 'flaky')) return null;
  if (outcome.results.length === 0 || outcome.results.some((r) => r.status === 'interrupted' || r.status === 'skipped')) return null;
  const ms = outcome.results.reduce((t, r) => t + (Number.isFinite(r.duration) ? r.duration : 0), 0);
  return Math.max(FLOOR_SECONDS, ms / 1000);
}

/**
 * The manifest a CI run's shards give. `shards` is one `{ assigned: { k, n, commit, keys }, report }`
 * per downloaded folder. Refuses (one error naming every fault) unless the n values agree, k covers
 * 1 to n once each, every commit is the same and no key is assigned twice. A test's price is the
 * seconds it took when it passed (see `measured`), else `price(key, old)`, so a failed or
 * cancelled shard is never read as fast. Each spec's count is its assigned tests and its mean (to
 * 0.01 s) their mean price; a test keeps its own entry (to 0.1 s, at least 0.1 s) only where its
 * price is above twice or below half that mean. Anything the run did not assign is dropped.
 * `date` is YYYY-MM-DD. Pure: `old` is not changed.
 * @param {any} old @param {{ assigned: any, report: any }[]} shards @param {string} date @param {string} run
 */
export function refresh(old, shards, date, run) {
  const faults = [];
  if (shards.length === 0) throw new Error('refresh: no shards were given');
  const ns = [...new Set(shards.map((s) => s.assigned.n))];
  if (ns.length > 1) faults.push(`the shards disagree on n: ${ns.join(', ')}`);
  const n = ns[0];
  const seen = new Map();
  for (const { assigned: a } of shards) seen.set(a.k, (seen.get(a.k) ?? 0) + 1);
  if (Number.isInteger(n) && ns.length === 1) {
    for (let k = 1; k <= n; k += 1) if (!seen.has(k)) faults.push(`shard ${k} of ${n} is missing`);
  }
  for (const [k, c] of seen) {
    if (c > 1) faults.push(`k=${k} appears in ${c} folders`);
    else if (Number.isInteger(n) && ns.length === 1 && !(Number.isInteger(k) && k >= 1 && k <= n)) faults.push(`k=${k} is outside 1 to ${n}`);
  }
  const commits = [...new Set(shards.map((s) => s.assigned.commit))];
  if (commits.length > 1) faults.push(`the shards were run at different commits: ${commits.join(', ')}`);
  const owner = new Map();
  for (const { assigned: a } of shards) {
    for (const key of a.keys) {
      if (owner.has(key) && owner.get(key) !== a.k) faults.push(`"${key}" is assigned to two shards (${owner.get(key)} and ${a.k})`);
      owner.set(key, a.k);
    }
  }
  if (faults.length > 0) throw new Error(`refresh refused: ${faults.join('; ')}`);

  const mean = suiteMean(old);
  /** @type {Map<string, number[]>} */
  const byFile = new Map();
  /** @type {Map<string, number>} */
  const prices = new Map();
  for (const { assigned, report } of shards) {
    const outcomes = outcomesOf(report);
    for (const key of assigned.keys) {
      const p = measured(outcomes.get(key)) ?? price(key, old, mean);
      prices.set(key, p);
      const file = key.split(SEP)[0];
      byFile.set(file, [...(byFile.get(file) ?? []), p]);
    }
  }
  const specs = {};
  const tests = {};
  for (const file of [...byFile.keys()].sort()) {
    const ps = byFile.get(file);
    specs[file] = { count: ps.length, mean: round(ps.reduce((t, p) => t + p, 0) / ps.length, 2) };
  }
  for (const key of [...prices.keys()].sort()) {
    const p = prices.get(key);
    const m = specs[key.split(SEP)[0]].mean;
    if (p > 2 * m || p < m / 2) tests[key] = Math.max(FLOOR_SECONDS, round(p, 1));
  }
  return { measured: { run, date }, specs, tests };
}

/** The file text: two-space indent and a final newline. The keys are sorted by `refresh`. */
export function manifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * `--refresh <dir> --run <id> [--out <path>]`: reads each `<dir>/e2e-timings-*` folder's
 * assigned.json and results.json, takes the date (UTC, YYYY-MM-DD) from the newest report's
 * stats.startTime, writes the manifest (default e2e/cost.json) and prints each shard's estimate.
 * @param {string[]} argv
 */
export function refreshCli(argv) {
  const arg = (name) => {
    const hit = argv.find((a) => a.startsWith(`${name}=`));
    if (hit) return hit.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dir = arg('--refresh');
  const run = arg('--run');
  const out = arg('--out') ?? 'e2e/cost.json';
  if (!dir || !run) throw new Error('usage: node tools/e2e-cost.mjs --refresh <dir> --run <id> [--out <path>]');
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('e2e-timings-')).map((d) => d.name).sort();
  if (folders.length === 0) throw new Error(`no e2e-timings-* folder in ${dir}`);
  const faults = [];
  const shards = [];
  for (const name of folders) {
    const read = (file) => {
      const path = `${dir}/${name}/${file}`;
      if (!fs.existsSync(path)) { faults.push(`${name} has no ${file}`); return null; }
      return JSON.parse(fs.readFileSync(path, 'utf8'));
    };
    const assigned = read('assigned.json');
    const report = read('results.json');
    if (assigned && report) shards.push({ assigned, report });
  }
  if (faults.length > 0) throw new Error(`refresh refused: ${faults.join('; ')}`);
  const times = shards.map((s) => Date.parse(s.report.stats?.startTime));
  if (times.some((t) => Number.isNaN(t))) throw new Error('refresh refused: a report has no stats.startTime');
  const date = new Date(Math.max(...times)).toISOString().slice(0, 10);
  const manifest = refresh(readManifest(out), shards, date, run);
  fs.writeFileSync(out, manifestText(manifest));
  const n = shards[0].assigned.n;
  const keys = shards.flatMap((s) => s.assigned.keys);
  const { totals } = pack(keys, manifest, n);
  const lines = [`wrote ${out} from run ${run} (${date}): ${Object.keys(manifest.specs).length} specs, ${Object.keys(manifest.tests).length} test entries`];
  totals.forEach((t, i) => lines.push(`shard ${i + 1}/${n}: ${(t / WORKERS / 60).toFixed(1)} min over ${WORKERS} workers (budget ${BUDGET_MINUTES})`));
  return lines.join('\n');
}

function readManifest(path) {
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : { measured: null, specs: {}, tests: {} };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    if (!process.argv.includes('--refresh') && !process.argv.some((a) => a.startsWith('--refresh='))) throw new Error('usage: node tools/e2e-cost.mjs --refresh <dir> --run <id> [--out <path>]');
    console.log(refreshCli(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
