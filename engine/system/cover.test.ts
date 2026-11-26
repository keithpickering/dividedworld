import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveredBody } from './cover.ts';
import type { Cover, CoverPlay } from '../rules/cards.ts';
import type { ReadPlay } from './extras.ts';
import { parse } from '../bbcode/parse.ts';
import { visibleText } from '../bbcode/visible.ts';

const play = (card: string | null, config: unknown = null): ReadPlay => ({ play: 'p', card, at: '2026-01-01T00:00:00Z', by: null, config, state: null, text: null, covered: null });
/** A test card: config is `{ word, words }`, it covers the first `word` in the text with `words`. */
const covers = (card: string | null, p: CoverPlay): readonly Cover[] | null => {
  if (card !== 'swap') return null;
  const c = p.config as { word: string; words: string };
  const from = p.text.indexOf(c.word);
  return from < 0 ? [] : [{ from, to: from + c.word.length, words: c.words }];
};
const swap = (word: string, words: string) => play('swap', { word, words });

test('a cover over plain text replaces the words under it', () => {
  assert.equal(coveredBody('the warp pipe is here', [swap('warp pipe', 'haunted toilet')], covers), 'the haunted toilet is here');
});

test('a cover inside a tag is written inside it', () => {
  assert.equal(coveredBody('a [b]warp[/b] pipe', [swap('warp', 'x')], covers), 'a [b]x[/b] pipe');
});

test('a cover that crosses a tag takes the first node and empties the rest, tags kept', () => {
  assert.equal(coveredBody('[b]warp[/b] pipe', [swap('warp pipe', 'haunted toilet')], covers), '[b]haunted toilet[/b]');
});

test('a cover beside a real quote leaves the quote as written', () => {
  const body = '[quote=11111111-1111-4111-8111-111111111111]warp pipe[/quote]\nwarp pipe';
  const out = coveredBody(body, [swap('warp pipe', 'toilet')], covers);
  assert.equal(out, body.replace(/\nwarp pipe$/, '\ntoilet'));
});

test('of two overlapping covers the later play is kept and the earlier dropped whole', () => {
  const out = coveredBody('one two three', [swap('one two', 'AAA'), swap('two three', 'BBB')], covers);
  assert.equal(out, 'one BBB');
});

test('two covers that do not overlap are both in place', () => {
  assert.equal(coveredBody('one two three', [swap('one', 'AAA'), swap('three', 'BBB')], covers), 'AAA two BBB');
});

test('a play without covers, and a play with no card, return the body itself', () => {
  const body = 'the warp pipe';
  assert.ok(coveredBody(body, [play('plain'), play(null)], covers) === body);
  assert.ok(coveredBody(body, [], covers) === body);
});

test('an out-of-bounds cover is dropped', () => {
  const body = 'abc';
  const bad = (_: string | null, p: CoverPlay): readonly Cover[] => [{ from: -1, to: 2, words: 'x' }, { from: 1, to: 9, words: 'x' }, { from: 2, to: 2, words: 'x' }, { from: 0, to: 1, words: 5 as unknown as string }];
  assert.ok(coveredBody(body, [swap('a', 'b')], bad) === body);
});

test('a cover meeting a text node with no recorded span is skipped whole', () => {
  const body = 'a[noparse][/noparse]b and ab';
  const out = coveredBody(body, [swap('ab', 'X')], (card, p) => { const i = p.text.indexOf('ab'); return [{ from: i, to: i + 2, words: 'X' }]; });
  assert.ok(out === body);
});

test('a cover meeting a line break or a link is skipped whole', () => {
  const body = 'one\n[url=https://x.test]link[/url] two';
  const out = coveredBody(body, [swap('one', 'X')], (_, p) => [{ from: 0, to: 5, words: 'X' }]);
  assert.ok(out === body);
});

test('a play is handed its text lazily: no read, no parse; reads by two plays see one string', () => {
  const body = 'one two';
  const seen: unknown[] = [];
  let reads = 0;
  const probe = (_: string | null, p: CoverPlay): null => {
    const d = Object.getOwnPropertyDescriptor(p, 'text');
    assert.equal(typeof d?.get, 'function', 'text is a getter, so nothing is parsed until a card reads it');
    seen.push(d!.get);
    return null;
  };
  assert.ok(coveredBody(body, [swap('a', 'b'), play(null)], probe) === body);
  assert.equal(seen.length, 2);
  const texts: string[] = [];
  const reader = (_: string | null, p: CoverPlay): null => { reads++; texts.push(p.text, p.text); return null; };
  assert.ok(coveredBody('x [b]y[/b]', [swap('a', 'b'), swap('a', 'b')], reader) === 'x [b]y[/b]');
  assert.equal(reads, 2);
  assert.ok(texts.every((t) => t === 'x y'));
});

/** A test card whose config is a list of covers it gives as they are. */
const fixed = (list: readonly Cover[]): ReadPlay => play('fixed', list);
const given = (card: string | null, p: CoverPlay): readonly Cover[] | null => (card === 'fixed' ? (p.config as readonly Cover[]) : covers(card, p));

test('covers of one play that overlap keep the first', () => {
  assert.equal(coveredBody('one two three', [fixed([{ from: 0, to: 7, words: 'A' }, { from: 4, to: 13, words: 'B' }])], given), 'A three');
});

test('covers that change a length are written from the end back, so each lands on its own words', () => {
  assert.equal(coveredBody('one two three', [fixed([{ from: 0, to: 3, words: 'a much longer one' }, { from: 8, to: 13, words: '3' }])], given), 'a much longer one two 3');
});

test('words are written as text: markup in them forges no quote and swallows no tag', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const words = `[/b][quote=${id}]x`;
  const out = coveredBody('warp [b]pipe[/b]', [swap('warp pipe', words)], covers);
  const nodes = parse(out);
  assert.ok(!JSON.stringify(nodes).includes('"quote"'), 'no real quote');
  assert.equal(visibleText(nodes), words);
  const tail = coveredBody('a b c', [swap('a', 'x[')], covers);
  assert.equal(visibleText(parse(tail)), 'x[ b c');
  const tag = coveredBody('a b]c', [swap('a b', 'x[')], covers);
  assert.equal(visibleText(parse(tag)), 'x[]c');
});

test('a cover crossing a spoiler edge writes into the first node and empties the rest, tags kept', () => {
  assert.equal(coveredBody('warp [spoiler=t]pipe[/spoiler]', [swap('warp pipe', 'toilet')], covers), 'toilet[spoiler=t][/spoiler]');
});

test('covers at the very start and the very end of the body', () => {
  assert.equal(coveredBody('one two three', [fixed([{ from: 0, to: 3, words: 'A' }, { from: 8, to: 13, words: 'B' }])], given), 'A two B');
});

test('two touching covers do not overlap and both land', () => {
  assert.equal(coveredBody('onetwo', [fixed([{ from: 0, to: 3, words: 'A' }, { from: 3, to: 6, words: 'B' }])], given), 'AB');
});

test('a cover over a quote separator is skipped whole', () => {
  const body = 'a[quote=11111111-1111-4111-8111-111111111111]q[/quote]b';
  assert.ok(coveredBody(body, [fixed([{ from: 0, to: 3, words: 'X' }])], given) === body);
});

test('a cover that splits a surrogate pair is dropped', () => {
  const body = '😀 warp';
  assert.ok(coveredBody(body, [fixed([{ from: 1, to: 4, words: 'X' }])], given) === body);
  assert.ok(coveredBody(body, [fixed([{ from: 0, to: 1, words: 'X' }])], given) === body);
  assert.equal(coveredBody(body, [fixed([{ from: 3, to: 7, words: 'X' }])], given), '😀 X');
});

test('the longest post an instance holds (20,000 characters, about 4,000 covers by each of three plays) is covered under a second; a bound, not a claim of linearity', () => {
  const body = 'warp '.repeat(4000);
  const all = (w: string): ReadPlay => play('fixed', Array.from({ length: 4000 }, (_, i) => ({ from: i * 5, to: i * 5 + 4, words: w })));
  const t = Date.now();
  const out = coveredBody(body, [all('aa'), all('bb'), all('cc')], given);
  const ms = Date.now() - t;
  assert.equal(out, 'cc '.repeat(4000));
  assert.ok(ms < 1000, `took ${ms} ms`);
});

const plainOf = (body: string, from: number, to: number, words: string): string => {
  const t = visibleText(parse(body));
  return t.slice(0, from) + words + t.slice(to);
};

test('words next to the body\'s own brackets never join them into a tag', () => {
  for (const [body, word, words] of [['[warp]', 'warp', 'b'], ['[/quote]', '/q', 'b]'], ['[spoiler', 'spoiler', 'b]'], ['x[ y', 'x', 'b'], ['a] b', 'b', 'c]']] as const) {
    const out = coveredBody(body, [swap(word, words)], covers);
    const at = visibleText(parse(body)).indexOf(word);
    const nodes = parse(out);
    assert.equal(visibleText(nodes), plainOf(body, at, at + word.length, words), `${body} -> ${out}`);
    assert.ok(nodes.every((n) => n.type === 'text' || n.type === 'noparse'), `${body} -> ${out}`);
  }
});

test('an ordinary edit with no brackets near stays bare', () => {
  assert.equal(coveredBody('the warp pipe', [swap('warp pipe', 'haunted toilet')], covers), 'the haunted toilet');
});

test('random bodies with stray brackets read, with a cover on them, as the board shows them', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alphabet = ['[', ']', 'b', '/', 'q', 'u', 'o', 't', 'e', '=', ' ', 'i', 'x'];
  for (let n = 0; n < 1500; n++) {
    const body = Array.from({ length: 1 + rnd(12) }, () => alphabet[rnd(alphabet.length)]!).join('');
    const vis = visibleText(parse(body));
    if (vis.length < 2 || vis.includes('\n')) continue;
    const from = rnd(vis.length - 1);
    const to = from + 1 + rnd(Math.min(3, vis.length - from));
    const words = Array.from({ length: rnd(4) }, () => alphabet[rnd(alphabet.length)]!).join('');
    const out = coveredBody(body, [fixed([{ from, to, words }])], given);
    assert.equal(visibleText(parse(out)), out === body ? vis : plainOf(body, from, to, words), `${JSON.stringify(body)} ${from}-${to} ${JSON.stringify(words)} -> ${JSON.stringify(out)}`);
  }
});
