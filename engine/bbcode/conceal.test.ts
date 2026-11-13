import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, MAX_DEPTH } from './parse.ts';
import type { BbNode } from './parse.ts';
import { concealQuotes } from './conceal.ts';

/*
 * concealQuotes empties the contents of every quote of a hidden post, reading a body with parse.ts itself, so the reading cannot drift from the parser's. The corpus
 * (supabase/tests/data/conduct-quote-corpus.json) is the ground truth: each case's body and exactly what must come back. Properties hold it to the parser's own tree.
 */
const HIDDEN = '11111111-1111-4111-8111-111111111111';
const SHOWN = '22222222-2222-4222-8222-222222222222';
const HIDE = new Set([HIDDEN]);
const corpus = JSON.parse(fs.readFileSync(new URL('../../supabase/tests/data/conduct-quote-corpus.json', import.meta.url), 'utf8')) as { name: string; body: string; expect: string }[];
const fill = (s: string) => s.replaceAll('{H}', HIDDEN).replaceAll('{S}', SHOWN);

/** A tree with the contents of each quote of a hidden post emptied, however deep. */
function emptied(nodes: readonly BbNode[], hidden: ReadonlySet<string> = HIDE): BbNode[] {
  return nodes.map((n): BbNode => {
    if (n.type === 'quote' && hidden.has(n.act)) return { ...n, children: [] };
    if (n.type === 'list') return { ...n, items: n.items.map((i) => emptied(i, hidden)) };
    return 'children' in n ? ({ ...n, children: emptied(n.children, hidden) } as BbNode) : n;
  });
}

test('the past-the-cap cases of the corpus were written for the cap of 16: change MAX_DEPTH and write them again', () => {
  // supabase/tests/data/conduct-quote-corpus.json, the cases named "past the cap", spell out sixteen levels; bbcode_walk in SQL carries the same cap
  assert.equal(MAX_DEPTH, 16);
  assert.ok(corpus.filter((c) => c.name.startsWith('past the cap:')).length >= 10);
});

test('the corpus is not empty and holds both cases that change and cases that do not', () => {
  assert.ok(corpus.length >= 78);
  const changed = corpus.filter((c) => c.expect !== c.body);
  assert.ok(changed.length > 20 && changed.length < corpus.length);
});

for (const c of corpus) {
  test(`concealQuotes, corpus case: ${c.name}`, () => {
    assert.equal(concealQuotes(fill(c.body), HIDE), fill(c.expect));
  });
}

test('an empty hidden set changes nothing, and a quote of another post is left alone', () => {
  const body = `a[quote=${HIDDEN}]x[/quote]b[quote=${SHOWN}]y[/quote]`;
  assert.equal(concealQuotes(body, new Set()), body);
  assert.equal(concealQuotes(body, new Set([SHOWN])), `a[quote=${HIDDEN}]x[/quote]b[quote=${SHOWN}][/quote]`);
});

test('a hidden id in upper case is the same id, as the parser reads it', () => {
  // An id with letters: one of digits alone is its own upper case and proves nothing.
  const LETTERS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.notEqual(LETTERS.toUpperCase(), LETTERS);
  assert.equal(concealQuotes(`[quote=${LETTERS.toUpperCase()}]x[/quote]`, new Set([LETTERS])), `[quote=${LETTERS.toUpperCase()}][/quote]`);
});

const PIECES = [
  `[quote=${HIDDEN}]`, `[quote=${SHOWN}]`, `[quote="${HIDDEN}"]`, '[quote=Bob]', '[quote]', '[/quote]', '[b]', '[/b]', '[url=https://e.com/]', '[/url]', '[url]', '[code]', '[/code]',
  '[noparse]', '[/noparse]', '[ispoiler]', '[/ispoiler]', '[spoiler=x]', '[/spoiler]', '[list]', '[*]', '[/list]', '[img]https://e.com/a.png[/img]', '[img]', '[/img]',
  '[video]https://youtu.be/abcdefghijk[/video]', '[video]', 'secret words', ' ', '\n', '[', ']', '[[', `${HIDDEN}`, 'https://e.com/x',
];
function lcg(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function bodies(count: number): string[] {
  const rnd = lcg(7);
  return Array.from({ length: count }, () => Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => PIECES[Math.floor(rnd() * PIECES.length)]).join(''));
}
const SECRET = 'zqxjkv';
const withSecret = (b: string) => b.replaceAll('secret words', SECRET);

/** The tree with each cut's Acts left out, and the Acts of every cut in document order (a cut's Acts are not in the tree beyond the node: what a hidden quote inside it held is gone once emptied). */
function cutsOf(nodes: readonly BbNode[]): { tree: BbNode[]; acts: string[][] } {
  const acts: string[][] = [];
  const walk = (list: readonly BbNode[]): BbNode[] => list.map((n): BbNode => {
    if (n.type === 'cut') { acts.push([...n.acts]); return { type: 'cut', acts: [] }; }
    if (n.type === 'list') return { ...n, items: n.items.map(walk) };
    return 'children' in n ? ({ ...n, children: walk(n.children) } as BbNode) : n;
  });
  const tree = walk(nodes);
  return { tree, acts };
}
const subsequence = (small: readonly string[], big: readonly string[]) => { let at = 0; for (const x of big) if (at < small.length && small[at] === x) at++; return at === small.length; };

test('property: the same holds for bodies nested past the cap, where a cut stands in the tree and keeps what is left of its Acts', () => {
  const rnd = lcg(41);
  const OPEN = [`[quote=${SHOWN}]`, `[quote=${SHOWN}]`, `[quote=${SHOWN}]`, `[quote=${SHOWN}]`, '[quote=Bob]', '[b]', `[quote=${HIDDEN}]`];
  let cuts = 0;
  let cutBefore = 0;
  for (let k = 0; k < 1500; k++) {
    const levels = Array.from({ length: Math.floor(rnd() * (MAX_DEPTH + 8)) }, () => OPEN[Math.floor(rnd() * OPEN.length)]).join('');
    const tail = () => Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => PIECES[Math.floor(rnd() * PIECES.length)]).join('');
    const body = withSecret(levels + tail() + (rnd() < 0.5 ? '[/quote]'.repeat(Math.floor(rnd() * 6)) : '') + tail());
    const once = concealQuotes(body, HIDE);
    assert.equal(concealQuotes(once, HIDE), once, `idempotent: ${JSON.stringify(body)}`);
    const before = cutsOf(emptied(parse(body)));
    const after = cutsOf(parse(once));
    assert.deepEqual(after.tree, before.tree, `tree: ${JSON.stringify(body)}`);
    assert.equal(after.acts.length, before.acts.length);
    after.acts.forEach((a, i) => assert.ok(subsequence(a, before.acts[i]!), `a cut's Acts only lose what was inside an emptied quote: ${JSON.stringify(body)}`));
    cuts += after.acts.length;
    cutBefore += cutsOf(parse(body)).acts.length;
  }
  assert.ok(cutBefore > 300 && cuts > 30, `${cutBefore} cuts before, ${cuts} after`);
});

test('property: idempotent, parses to the input tree with hidden quotes emptied, and no byte moves outside an emptied span', () => {
  for (const raw of bodies(4000)) {
    const body = withSecret(raw);
    const once = concealQuotes(body, HIDE);
    assert.equal(concealQuotes(once, HIDE), once, `idempotent: ${JSON.stringify(body)}`);
    assert.deepEqual(parse(once), emptied(parse(body)), `tree: ${JSON.stringify(body)}`);
    assert.ok(once.length <= body.length);
  }
});

test('property: a hidden quote\'s inner text never survives where the parser reads a real quote, wherever it sits', () => {
  const rnd = lcg(11);
  let read = 0;
  for (let k = 0; k < 2000; k++) {
    const inner = `${SECRET}${k}`;
    const body = `${bodies(1)[0] ?? ''}[quote=${HIDDEN}]${inner}[/quote]${bodies(1 + Math.floor(rnd() * 2)).join('')}`;
    const out = concealQuotes(body, HIDE);
    // the words are the post's own, and stay, when the parser does not read a quote of the hidden post around them (inside code, noparse, a bad link and the like)
    const quoted = JSON.stringify(parse(body)).includes(`"act":"${HIDDEN}"`);
    if (quoted) read++;
    assert.equal(out.includes(inner) && JSON.stringify(parse(out)).includes(`"text":"${inner}`) && quoted, false, `leak: ${JSON.stringify(body)}`);
  }
  assert.ok(read > 200);
});

test('property: a body of a hidden quote of 40,000 characters is read in time that grows with its length alone', () => {
  const time = (n: number) => { const b = `[quote=${HIDDEN}]` + '[quote=zz][b]'.repeat(n / 13) + '[/quote]'; const t = performance.now(); concealQuotes(b, HIDE); return performance.now() - t; };
  time(10000);
  const small = Math.min(time(10000), time(10000));
  const big = Math.min(time(40000), time(40000));
  assert.ok(big < Math.max(small * 12, 50), `${small} ms at 10k, ${big} ms at 40k`);
});

/*
 * A hidden post's words are absent at any depth ("A quote past the cap is cut, never text", docs/plans/2026-11-13-quote-cut-plan.md, Task 1). Every depth is written from MAX_DEPTH, never as a
 * number, so these follow the cap. A real quote of the hidden post past the cap is a `cut`: the parser still reports its span, and its words are emptied at any depth.
 */
const WORDS = 'zqxjkvdeepwords';
const levels = (n: number, id: string) => Array.from({ length: n }, (_, i) => `[quote=${id.replace(/.$/u, String(i % 10))}]`);
/** `n` real quotes of visible posts around one real quote of the hidden post, which holds the words: the hidden quote is level `n + 1`. */
function pyramid(n: number, words = WORDS): string {
  return levels(n, SHOWN).join('') + `[quote=${HIDDEN}]${words}[/quote]` + '[/quote]'.repeat(n);
}
const DEPTHS: [string, number][] = [['1', 1], ['MAX_DEPTH', MAX_DEPTH], ['MAX_DEPTH + 1', MAX_DEPTH + 1], ['MAX_DEPTH + 8', MAX_DEPTH + 8], ['200', 200]];

for (const [label, depth] of DEPTHS) {
  test(`a hidden post's words are absent when its quote is the innermost of a pyramid ${label} deep`, () => {
    const body = `before ${pyramid(depth - 1)} after`;
    const out = concealQuotes(body, HIDE);
    assert.equal(out.includes(WORDS), false, `the words survive at depth ${depth}`);
    assert.ok(out.includes(`[quote=${HIDDEN}]`), 'the quote\'s id is kept');
  });
}

test(`a hidden post's words are absent when the first MAX_DEPTH levels are [b] and its quote is the next tag`, () => {
  const body = '[b]'.repeat(MAX_DEPTH) + `[quote=${HIDDEN}]${WORDS}[/quote]` + '[/b]'.repeat(MAX_DEPTH);
  assert.equal(concealQuotes(body, HIDE).includes(WORDS), false);
});

test('a hidden post\'s words are absent when level MAX_DEPTH + 1 quotes a visible post and level MAX_DEPTH + 3 quotes the hidden one', () => {
  const open = (n: number) => `[quote=${SHOWN}]`.repeat(n);
  const inner = `[quote=${HIDDEN}]${WORDS}[/quote]`;
  // MAX_DEPTH levels of visible quotes, then level MAX_DEPTH + 1 and + 2 (visible), and + 3 (hidden)
  const body = open(MAX_DEPTH + 2) + inner + '[/quote]'.repeat(MAX_DEPTH + 2);
  assert.equal(concealQuotes(body, HIDE).includes(WORDS), false);
});

test('property: a hidden quote\'s words never survive in a quote of the hidden post outside code, noparse and ispoiler, at any depth', () => {
  const rnd = lcg(23);
  const WRAP: [string, string, boolean][] = [
    [`[quote=${SHOWN}]`, '[/quote]', false], ['[quote=Bob]', '[/quote]', false], ['[b]', '[/b]', false], ['[i]', '[/i]', false],
    ['[code]', '[/code]', true], ['[noparse]', '[/noparse]', true], ['[ispoiler]', '[/ispoiler]', true],
  ];
  let counted = 0;
  let deep = 0;
  for (let k = 0; k < 2000; k++) {
    const inner = `${SECRET}${k}end`;
    // (no wrapper is a quote of the hidden post itself: that would empty the words by its own, shallow quote)
    // a depth from 0 to 2 * MAX_DEPTH + 8, and from time to time a pyramid far deeper
    const n = rnd() < 0.1 ? 100 + Math.floor(rnd() * 150) : Math.floor(rnd() * (2 * MAX_DEPTH + 8));
    const exemptAt = rnd() < 0.3 ? Math.floor(rnd() * n) : -1; // one level that is code, noparse or ispoiler
    let open = '';
    let close = '';
    let exempt = false;
    for (let i = 0; i < n; i++) {
      const w = i === exemptAt ? WRAP[4 + Math.floor(rnd() * 3)]! : WRAP[Math.floor(rnd() * 4)]!;
      if (w[2]) exempt = true;
      open += w[0];
      close = w[1] + close;
    }
    const body = `${open}[quote=${HIDDEN}]${inner}[/quote]${close}`;
    if (exempt) continue; // the words are the post's own there, and stay or not as the parser reads them
    const out = concealQuotes(body, HIDE);
    counted++;
    if (n >= MAX_DEPTH) deep++; // the hidden quote is level n + 1
    assert.equal(out.includes(inner), false, `leak at depth ${n}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  assert.ok(counted > 1000 && deep > 400, `${counted} counted, ${deep} deep`);
});
