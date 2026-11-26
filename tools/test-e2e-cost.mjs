/**
 * tools/e2e-cost.mjs's pure functions, driven red on purpose.
 *
 *   node tools/test-e2e-cost.mjs
 *
 * Every case builds its own small input. The packer's one property that matters, that every key
 * lands in exactly one shard, is asserted by `exactlyOnce`, and the last cases hand that assertion
 * two poison packers (one drops the last key, one puts a key in two shards) and require it to
 * refuse both, so an assertion that has gone quiet fails here rather than reading as green.
 */
import {
  keysOf, keyProblems, listProblems, price, pack, parseCostShard, compareRun, testList, WORKERS, BUDGET_MINUTES,
} from './e2e-cost.mjs';
import { problems } from './check-e2e-cost.mjs';

let failures = 0;
const ok = (name) => console.log(`ok    ${name}`);
const fail = (name, why) => {
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(`      ${why}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** @param {string} name @param {unknown} got @param {unknown} want */
function eq(name, got, want) {
  if (same(got, want)) ok(name);
  else fail(name, `expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`);
}
/** @param {string} name @param {() => unknown} fn @param {RegExp} expected */
function throws(name, fn, expected) {
  try {
    fn();
  } catch (e) {
    if (expected.test(String(e.message))) ok(name);
    else fail(name, `threw "${e.message}", expected ${expected}`);
    return;
  }
  fail(name, 'did not throw');
}
const test = (title) => ({ title, tests: [{ status: 'skipped' }] });

/** A list JSON as Playwright prints it: a file suite, with a describe nested in a describe. */
const LIST = {
  suites: [
    {
      title: 'a.spec.ts', file: 'a.spec.ts',
      specs: [test('top test')],
      suites: [{
        title: 'outer', file: 'a.spec.ts', specs: [test('one')],
        suites: [{ title: 'inner', file: 'a.spec.ts', specs: [test('two'), test('three')] }],
      }],
    },
    { title: 'dir/b.spec.ts', file: 'dir/b.spec.ts', specs: [test('b one')] },
  ],
};
const KEYS = [
  'a.spec.ts › top test',
  'a.spec.ts › outer › one',
  'a.spec.ts › outer › inner › two',
  'a.spec.ts › outer › inner › three',
  'dir/b.spec.ts › b one',
];
eq('keysOf walks specs then nested suites, file first and not repeated', keysOf(LIST), KEYS);
eq('constants', [WORKERS, BUDGET_MINUTES], [2, 15]);

/* ---- price: each of the four branches ---- */
const MAN = {
  measured: null,
  specs: { 'a.spec.ts': { count: 2, mean: 10 }, 'c.spec.ts': { count: 2, mean: 20 } },
  tests: { 'a.spec.ts › outer › one': 99 },
};
eq('price: the test\'s own entry', price('a.spec.ts › outer › one', MAN), 99);
eq('price: else its spec\'s mean', price('a.spec.ts › top test', MAN), 10);
eq('price: else the suite\'s mean, weighted by count ((1*10+3*20)/4)', price('zzz.spec.ts › new', { measured: null, specs: { 'a.spec.ts': { count: 1, mean: 10 }, 'c.spec.ts': { count: 3, mean: 20 } }, tests: {} }), 17.5);
eq('price: else 1 with no specs at all', price('zzz.spec.ts › new', { measured: null, specs: {}, tests: {} }), 1);

/* ---- pack ---- */
const MIXED = Array.from({ length: 20 }, (_, i) => `m${String(i).padStart(2, '0')}.spec.ts › t`);
const MIX_MAN = {
  measured: null,
  specs: Object.fromEntries(MIXED.map((k, i) => [k.split(' › ')[0], { count: 1, mean: ((i * 7) % 13) + 1 }])),
  tests: {},
};
const biggest = (keys, man) => Math.max(...keys.map((k) => price(k, man)));

/**
 * The partition assertion: every key in exactly one shard, one total per shard that is the
 * sum of its prices. Returns a complaint or ''.
 * @param {string[]} keys @param {Record<string, any>} man @param {number} n
 * @param {(keys: string[], man: any, n: number) => { shards: string[][], totals: number[] }} packer
 */
function exactlyOnce(keys, man, n, packer) {
  const { shards, totals } = packer(keys, man, n);
  if (shards.length !== n || totals.length !== n) return `expected ${n} shards and totals`;
  const seen = new Map();
  for (const shard of shards) for (const k of shard) seen.set(k, (seen.get(k) ?? 0) + 1);
  const bad = keys.filter((k) => seen.get(k) !== 1);
  if (bad.length) return `not exactly once: ${bad.join(', ')}`;
  if (seen.size !== keys.length) return 'extra keys in the shards';
  return '';
}

const packed = pack(MIXED, MIX_MAN, 3);
const complaint = exactlyOnce(MIXED, MIX_MAN, 3, pack);
if (complaint === '') ok('pack: every key in exactly one of 3 shards'); else fail('pack: partition', complaint);
const spread = Math.max(...packed.totals) - Math.min(...packed.totals);
if (spread <= biggest(MIXED, MIX_MAN)) ok(`pack: totals differ by ${spread}, no more than the largest price`);
else fail('pack: balance', `totals ${packed.totals} differ by ${spread}`);
eq('pack: totals are each shard\'s summed prices', packed.totals, packed.shards.map((s) => s.reduce((t, k) => t + price(k, MIX_MAN), 0)));
eq('pack: run twice, the same shards', pack(MIXED, MIX_MAN, 3), packed);
eq('pack: shuffled input, the same shards', pack([...MIXED].reverse(), MIX_MAN, 3).shards.map((s) => [...s].sort()), packed.shards.map((s) => [...s].sort()));
eq('pack: shuffled input, the same order inside a shard too', pack([...MIXED].reverse(), MIX_MAN, 3), packed);
eq('pack: a tie goes to the lowest index', pack(['x.spec.ts › a', 'x.spec.ts › b'], { measured: null, specs: {}, tests: {} }, 2).shards, [['x.spec.ts › a'], ['x.spec.ts › b']]);

/* exact result: 5,4,3,3 into 2 is longest first, each into the lightest shard, ties by key then lowest index */
const EXACT = { measured: null, specs: {}, tests: { 'f.spec.ts › a5': 5, 'f.spec.ts › b4': 4, 'f.spec.ts › c3': 3, 'f.spec.ts › d3': 3 } };
eq('pack: exact shards and totals for 5,4,3,3 into 2', pack(['f.spec.ts › d3', 'f.spec.ts › b4', 'f.spec.ts › a5', 'f.spec.ts › c3'], EXACT, 2),
  { shards: [['f.spec.ts › a5', 'f.spec.ts › d3'], ['f.spec.ts › b4', 'f.spec.ts › c3']], totals: [8, 7] });

/* ---- the poison packers, driven red against the assertion ---- */
const dropsLast = (keys, man, n) => {
  const r = pack(keys, man, n);
  const shards = r.shards.map((s) => [...s]);
  const i = shards.findIndex((s) => s.includes(keys[keys.length - 1]));
  shards[i] = shards[i].filter((k) => k !== keys[keys.length - 1]);
  return { shards, totals: r.totals };
};
const doubles = (keys, man, n) => {
  const r = pack(keys, man, n);
  const shards = r.shards.map((s) => [...s]);
  shards[1].push(shards[0][0]);
  return { shards, totals: r.totals };
};
for (const [name, bad, want] of [['drops the last key', dropsLast, /not exactly once/], ['puts a key in two shards', doubles, /not exactly once/]]) {
  const c = exactlyOnce(MIXED, MIX_MAN, 3, bad);
  if (want.test(c)) ok(`the assertion refuses a packer that ${name}`);
  else fail(`the assertion refuses a packer that ${name}`, `got "${c}"`);
}

/* ---- keyProblems ---- */
eq('keyProblems: a clean list has none', keyProblems(KEYS), []);
const stray = keyProblems(['a.spec.ts › foo›bar']);
if (stray.length === 1 && /foo›bar/.test(stray[0])) ok('keyProblems names a title holding ›'); else fail('keyProblems: stray ›', JSON.stringify(stray));
const pre = keyProblems(['a.spec.ts › x', 'a.spec.ts › x › y', 'b.spec.ts › x']);
if (pre.length === 1 && /a\.spec\.ts › x\b/.test(pre[0]) && /prefix/.test(pre[0])) ok('keyProblems names a prefix pair in one file');
else fail('keyProblems: prefix pair', JSON.stringify(pre));
const spaced = listProblems({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [test('left › right')] }] });
if (spaced.length === 1 && /left › right/.test(spaced[0])) ok('listProblems sees a title holding " › " that a key cannot show'); else fail('listProblems', JSON.stringify(spaced));
eq('listProblems: a clean list has none', listProblems(LIST), []);

/* duplicates, and titles Playwright's list reader cannot match */
const dup = keyProblems(['a.spec.ts › x', 'a.spec.ts › y', 'a.spec.ts › x']);
if (dup.length === 1 && /a\.spec\.ts › x/.test(dup[0]) && /twice|duplicate/.test(dup[0])) ok('keyProblems names a key listed twice once'); else fail('keyProblems: duplicate', JSON.stringify(dup));
const listOf = (...titles) => ({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: titles.map(test) }] });
for (const [what, title] of [['trailing space', 'ends '], ['leading space', ' starts'], ['a newline', 'two\nlines'], ['a trailing tab', 'tab\t']]) {
  const found = listProblems(listOf(title));
  if (found.length === 1 && /whitespace|newline/.test(found[0])) ok(`listProblems refuses a title with ${what}`); else fail(`listProblems: ${what}`, JSON.stringify(found));
}
const inner = listProblems({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', suites: [{ title: 'padded ', file: 'a.spec.ts', specs: [test('t')] }] }] });
if (inner.length === 1 && /whitespace/.test(inner[0])) ok('listProblems refuses a describe title with trailing space'); else fail('listProblems: describe', JSON.stringify(inner));

/* ---- price and pack refuse what would mis-pack ---- */
for (const bad of [0, -1, NaN, Infinity]) {
  throws(`price: refuses a price of ${bad}`, () => price('f.spec.ts › t', { specs: {}, tests: { 'f.spec.ts › t': bad } }), /price/);
}
throws('price: refuses a spec mean of 0', () => price('f.spec.ts › t', { specs: { 'f.spec.ts': { count: 1, mean: 0 } }, tests: {} }), /price/);
throws('pack: refuses a bad price rather than mis-packing', () => pack(['f.spec.ts › t'], { specs: {}, tests: { 'f.spec.ts › t': NaN } }, 2), /price/);
for (const bad of [0, -2, 1.5, NaN]) throws(`pack: refuses n = ${bad}`, () => pack(['f.spec.ts › t'], MAN, bad), /shard count|n must/);
const sparse = pack(['f.spec.ts › a', 'f.spec.ts › b'], { specs: {}, tests: {} }, 5);
eq('pack: n above the key count leaves empty shards, each key once', sparse.shards, [['f.spec.ts › a'], ['f.spec.ts › b'], [], [], []]);
eq('pack: and their totals', sparse.totals, [1, 1, 0, 0, 0]);
if (exactlyOnce(['f.spec.ts › a', 'f.spec.ts › b'], { specs: {}, tests: {} }, 5, pack) === '') ok('pack: n above the key count is still exactly once'); else fail('pack: sparse', 'not once');

/* ---- parseCostShard ---- */
eq('parseCostShard: 2/7', parseCostShard(['--cost-shard=2/7']), { k: 2, n: 7, rest: [] });
eq('parseCostShard: other flags pass through in rest', parseCostShard(['--headed', '--cost-shard=1/3', '--retries=1']), { k: 1, n: 3, rest: ['--headed', '--retries=1'] });
eq('parseCostShard: absent means null', parseCostShard(['--headed']), null);
throws('parseCostShard: 0/7', () => parseCostShard(['--cost-shard=0/7']), /cost-shard/);
throws('parseCostShard: 8/7', () => parseCostShard(['--cost-shard=8/7']), /cost-shard/);
throws('parseCostShard: 2/x', () => parseCostShard(['--cost-shard=2/x']), /cost-shard/);
throws('parseCostShard: 2.5/7', () => parseCostShard(['--cost-shard=2.5/7']), /cost-shard/);
throws('parseCostShard: bare flag', () => parseCostShard(['--cost-shard']), /cost-shard/);
throws('parseCostShard: two flags', () => parseCostShard(['--cost-shard=1/7', '--cost-shard=2/7']), /once|twice|two/);
throws('parseCostShard: with --shard', () => parseCostShard(['--cost-shard=1/7', '--shard=1/7']), /--shard/);
throws('parseCostShard: with --test-list', () => parseCostShard(['--cost-shard=1/7', '--test-list=x.txt']), /--test-list/);
throws('parseCostShard: with bare --shard', () => parseCostShard(['--cost-shard=1/7', '--shard']), /--shard/);
throws('parseCostShard: with bare --test-list', () => parseCostShard(['--cost-shard=1/7', '--test-list']), /--test-list/);
for (const flag of ['--test-list-invert', '--test-list-invert=x', '--grep', '--grep=foo', '-g', '-g=foo', '--grep-invert=foo', '--grep-invert', '--project', '--project=chromium', '--only-changed', '--only-changed=main', '--last-failed', '--repeat-each', '--repeat-each=2', '--tag=@x', '--tag-invert=@x']) {
  throws(`parseCostShard: with ${flag}`, () => parseCostShard(['--cost-shard=1/7', flag]), new RegExp(flag.split('=')[0].replace(/-/g, '\\-')));
}
throws('parseCostShard: n above 1000', () => parseCostShard(['--cost-shard=1/1001']), /1000/);
throws('parseCostShard: an n beyond safe integers', () => parseCostShard(['--cost-shard=1/99999999999999999999']), /cost-shard/);
eq('parseCostShard: n of 1000 is the most', parseCostShard(['--cost-shard=1000/1000']), { k: 1000, n: 1000, rest: [] });
throws('parseCostShard: with a positional file filter', () => parseCostShard(['--cost-shard=1/7', 'e2e/x.spec.ts']), /positional|filter/);
throws('parseCostShard: a flag value after a space reads as positional', () => parseCostShard(['--cost-shard=1/7', '--workers', '2']), /positional|filter/);
eq('parseCostShard: positionals alone are not its business', parseCostShard(['e2e/x.spec.ts']), null);

/* ---- compareRun ---- */
const assigned = ['a.spec.ts › top test', 'a.spec.ts › outer › one'];
const report = { suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [test('top test'), test('surprise')] }] };
eq('compareRun: one missing, one extra', compareRun(assigned, report), { missing: ['a.spec.ts › outer › one'], extra: ['a.spec.ts › surprise'] });
eq('compareRun: an exact run has neither', compareRun(KEYS, LIST), { missing: [], extra: [] });

/* ---- testList ---- */
eq('testList: a line each and a final newline', testList(['a › b', 'c › d']), 'a › b\nc › d\n');

/* ---- problems (tools/check-e2e-cost.mjs) ---- */
const CLEAN = {
  manifest: { measured: { run: '123', date: '2026-11-26' }, specs: { 'a.spec.ts': { count: 3, mean: 60 }, 'dir/b.spec.ts': { count: 1, mean: 30 } }, tests: { 'a.spec.ts › top test': 90 } },
  keys: KEYS,
  shards: 2,
};
const withManifest = (patch) => ({ ...CLEAN, manifest: { ...CLEAN.manifest, ...patch } });
eq('problems: a clean manifest and clean keys give none', problems(CLEAN).problems, []);
eq('problems: a null measured is clean', problems(withManifest({ measured: null })).problems, []);
const mustFault = (name, input, re) => {
  const got = problems(input).problems;
  if (got.length > 0 && got.some((p) => re.test(p))) ok(name);
  else fail(name, `expected a problem matching ${re}, got ${JSON.stringify(got)}`);
};
mustFault('problems: a spec with count 0', withManifest({ specs: { ...CLEAN.manifest.specs, 'a.spec.ts': { count: 0, mean: 60 } } }), /a\.spec\.ts.*count/);
mustFault('problems: a negative mean', withManifest({ specs: { ...CLEAN.manifest.specs, 'a.spec.ts': { count: 3, mean: -1 } } }), /a\.spec\.ts.*mean/);
mustFault('problems: a test entry whose spec is missing', withManifest({ tests: { 'gone.spec.ts › x': 5 } }), /gone\.spec\.ts/);
mustFault('problems: a test entry of zero seconds', withManifest({ tests: { 'a.spec.ts › top test': 0 } }), /top test/);
mustFault('problems: measured as a string', withManifest({ measured: 'yesterday' }), /measured/);
mustFault('problems: measured missing its date', withManifest({ measured: { run: '1' } }), /measured/);
mustFault('problems: a key holding ›', { ...CLEAN, keys: [...KEYS, 'a.spec.ts › x › y'], list: { suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [test('x › y')] }] } }, /›/);
mustFault('problems: a prefix pair', { ...CLEAN, keys: [...KEYS, 'a.spec.ts › outer'] }, /prefix/);
mustFault('problems: the list JSON finds a title holding ›', { ...CLEAN, list: { suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [test('Settings › Account')] }] } }, /Settings › Account/);

const ALL = (secs) => ({ manifest: { measured: null, specs: { 'a.spec.ts': { count: 4, mean: secs } }, tests: {} }, keys: ['a.spec.ts › one', 'a.spec.ts › two', 'a.spec.ts › three', 'a.spec.ts › four'], shards: 2 });
const rep = problems(ALL(600)).report;
if (rep.lines.some((l) => /unpriced|fallback/i.test(l) && l.includes('0%'))) ok('report: names the unpriced share (all priced here, 0%)');
else fail('report: names the unpriced share', JSON.stringify(rep));
const noSpecs = problems({ manifest: { measured: null, specs: {}, tests: {} }, keys: ['x.spec.ts › one', 'x.spec.ts › two'], shards: 2 }).report;
if (noSpecs.lines.some((l) => /unpriced|fallback/i.test(l) && l.includes('100%'))) ok('report: an empty manifest is 100% unpriced');
else fail('report: an empty manifest is 100% unpriced', JSON.stringify(noSpecs));
eq('report: busiest is a shard total over WORKERS in minutes', rep.busiestMinutes, (1200 / WORKERS) / 60);
if (rep.lines.some((l) => l.includes('10.0') && l.includes(String(BUDGET_MINUTES)))) ok('report: names the busiest estimate against the budget');
else fail('report: names the busiest estimate against the budget', JSON.stringify(rep.lines));
const over = problems(ALL(1200)).report; // 2400 s per shard, 20 min
if (over.lines.some((l) => /add .*shard.*web\.yml/i.test(l))) ok('report: over the budget says to add a shard');
else fail('report: over the budget says to add a shard', JSON.stringify(over.lines));
if (rep.lines.some((l) => /add .*shard/i.test(l))) fail('report: under the budget must not say to add a shard', JSON.stringify(rep.lines));
else ok('report: under the budget does not say to add a shard');
eq('report: over the budget is not a problem', problems(ALL(1200)).problems, []);

if (failures) {
  console.error(`\n${failures} case${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\nall cases pass');
