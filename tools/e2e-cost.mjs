/**
 * The e2e cost packer's pure parts: key a test, price it, cut the suite into shards by cost.
 *
 * Design docs/plans/2026-11-26-e2e-cost-shards-design.md, sections 2 and 3. Playwright's own
 * `--shard=k/n` cuts by count, and a few specs cost most of the time, so a shard of the heavy
 * ones ran far past the rest. `--cost-shard=k/n` lists the suite, prices every test from the
 * manifest `e2e/cost.json`, packs the whole list into n shards longest first, and runs shard k
 * as a `--test-list`. Every function here is pure; the CLI that reads files arrives with the
 * refresh, and this module's self-test is tools/test-e2e-cost.mjs.
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

/** Workers per runner (playwright.config.ts) and the minutes a shard should take. */
export const WORKERS = 2;
export const BUDGET_MINUTES = 15;

const SEP = ' › ';

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
  const own = manifest.tests?.[key];
  const spec = manifest.specs?.[key.split(SEP)[0]];
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
