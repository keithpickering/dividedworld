import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from './parse.ts';
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
  assert.equal(concealQuotes(`[quote=${HIDDEN.toUpperCase()}]x[/quote]`, HIDE), `[quote=${HIDDEN.toUpperCase()}][/quote]`);
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
