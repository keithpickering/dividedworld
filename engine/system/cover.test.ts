import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveredBody } from './cover.ts';
import type { Cover, CoverPlay } from '../rules/cards.ts';
import type { ReadPlay } from './extras.ts';

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
