import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_QUOTE_MOST, outcomeQuote, withoutLeadingQuote } from './outcome-quote.ts';
import { parse } from './parse.ts';
import { CUT, asTyped, holds, quoteHeld, quoteNorm, quoteSource } from './quoted.ts';

test('a short post is quoted whole, its markup taken out and its whitespace collapsed', () => {
  assert.equal(outcomeQuote('a1', 'Hello  [b]big\nworld[/b]'), '[quote=a1]Hello big world[/quote]\n');
});

test('a long post is cut at a word to the most, then an ellipsis', () => {
  const body = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
  const q = outcomeQuote('a1', body);
  const words = q.slice('[quote=a1]'.length, -'[/quote]\n'.length);
  assert.ok(words.endsWith('…'));
  assert.ok(words.length <= OUTCOME_QUOTE_MOST + 1);
  assert.ok(body.startsWith(words.slice(0, -1)));
  assert.match(words.slice(0, -1), /word\d+$/);
  assert.ok(body.slice(words.length - 1).startsWith(' '));
});

test('words holding a bracket are wrapped in noparse, and a closer inside them cannot end the cover early', () => {
  assert.equal(outcomeQuote('a1', '[noparse][b]hi[/b][/noparse]'), '[quote=a1][noparse][b]hi[/b][/noparse][/quote]\n');
  assert.equal(outcomeQuote('a1', '[noparse]x[/noparse]'), '[quote=a1]x[/quote]\n');
});

test('the room shrinks the words, and no room for a word leaves the quote out', () => {
  assert.equal(outcomeQuote('a1', 'alpha beta gamma', 9), '[quote=a1]alpha…[/quote]\n');
  assert.equal(outcomeQuote('a1', 'alpha beta gamma', 0), '');
  assert.equal(outcomeQuote('a1', '   ', 50), '');
});

test('what it quotes survives the forged-quote check: the words are a run of the version', () => {
  const body = 'one two three four five six seven';
  const q = outcomeQuote('a1', body, 12);
  const words = q.slice('[quote=a1]'.length, -'[/quote]\n'.length);
  assert.ok(quoteNorm(body).includes(quoteNorm(words)));
});

test('the leading quote is skipped, nested ones with it; a body with none, or an unclosed one, is as it stands', () => {
  assert.equal(withoutLeadingQuote('[quote=a1]their [QUOTE]inner[/quote] words[/Quote]\nMine.'), 'Mine.');
  assert.equal(withoutLeadingQuote('Mine [quote=a1]x[/quote]'), 'Mine [quote=a1]x[/quote]');
  assert.equal(withoutLeadingQuote('[quote=a1]never closed'), '[quote=a1]never closed');
  assert.equal(withoutLeadingQuote(`${outcomeQuote('a1', 'Hello [x]')}Filed.`), 'Filed.');
});

test('the quote holds against the forged-quote check for every kind of body, its words the check own source', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const bodies = [
    'plain words here',
    '[b]bold[/b] words',
    'see [url=https://example.com]this link[/url] now',
    'a [code]x=1[/code] b',
    'a [spoiler=Title]hidden[/spoiler] b',
    `a [quote=${uuid}]inner[/quote] b`,
    `${'word '.repeat(100)}end`,
    '[noparse][b]hi[/b] and [i][/noparse] more',
  ];
  for (const body of bodies) {
    const q = outcomeQuote(uuid, body);
    assert.notEqual(q, '', body);
    const held = quoteHeld(parse(q)).get(uuid);
    assert.ok(held && held.length === 1, body);
    assert.ok(holds(quoteSource(parse(body)), held[0]!), body);
    assert.ok(!q.includes('\ufdd0'), body);
  }
});

const wordsOf = (q: string, target = 'a1'): string => q.slice(`[quote=${target}]`.length, -'[/quote]\n'.length);

// Runs of more than eight of one code point are collapsed by `quoteNorm`, so a long body varies its characters.
const astral = (n: number, from = 0): string => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x1f600 + ((i + from) % 50))).join('');

test('the cut counts code points: an astral body over the most is cut at the most, no pair split, the total at most the most and the ellipsis', () => {
  const body = astral(OUTCOME_QUOTE_MOST + 40);
  const w = wordsOf(outcomeQuote('a1', body));
  const cps = Array.from(w);
  assert.equal(cps.length, OUTCOME_QUOTE_MOST + 1);
  assert.equal(cps.at(-1), '…');
  assert.equal(cps.slice(0, -1).join(''), astral(OUTCOME_QUOTE_MOST));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(w));
  // Exactly the most in code points (twice that in UTF-16 units) is whole.
  assert.equal(wordsOf(outcomeQuote('a1', astral(OUTCOME_QUOTE_MOST))), astral(OUTCOME_QUOTE_MOST));
});

test('an astral body cut at a space keeps whole code points and stays within the most', () => {
  const body = `${astral(100)} ${astral(100, 7)} ${astral(100, 13)}`;
  const w = wordsOf(outcomeQuote('a1', body));
  assert.ok(Array.from(w).length <= OUTCOME_QUOTE_MOST + 1);
  assert.equal(w, `${astral(100)} ${astral(100, 7)}…`);
});

test('a word-less run of the most plus one is cut at the most, with the ellipsis', () => {
  const run = 'ab'.repeat(OUTCOME_QUOTE_MOST / 2 + 1).slice(0, OUTCOME_QUOTE_MOST + 1);
  const w = wordsOf(outcomeQuote('a1', run));
  assert.equal(w, `${run.slice(0, OUTCOME_QUOTE_MOST)}…`);
  assert.equal(Array.from(w).length, OUTCOME_QUOTE_MOST + 1);
  const astralRun = astral(OUTCOME_QUOTE_MOST + 1);
  assert.equal(wordsOf(outcomeQuote('a1', astralRun)), `${astral(OUTCOME_QUOTE_MOST)}…`);
});

test('a cut mark in the source (a quote nested past the depth cap) leaves the first run of words after it when nothing stands before it', () => {
  const deep = `${'[b]'.repeat(16)}[quote=11111111-2222-3333-4444-555555555555]hidden[/quote]${'[/b]'.repeat(16)}`;
  assert.ok(quoteSource(parse(`${deep} tail words`)).includes(CUT));
  const q = outcomeQuote('a1', `${deep} tail words`);
  assert.equal(q, '[quote=a1]tail words[/quote]\n');
  assert.equal(wordsOf(outcomeQuote('a1', `first ${deep} tail words`)), 'first');
  assert.equal(outcomeQuote('a1', deep), '');
});

test('withoutLeadingQuote: leading whitespace, a bare [quote], and words after the closer on the same line', () => {
  assert.equal(withoutLeadingQuote('  \n[quote=a1]x[/quote]\nMine.'), 'Mine.');
  assert.equal(withoutLeadingQuote('[quote]x[/quote]\nMine.'), 'Mine.');
  assert.equal(withoutLeadingQuote('[quote=a1]x[/quote] Mine.'), ' Mine.');
  // The line break after the closer, and blank lines with it, are the quote's own.
  assert.equal(withoutLeadingQuote('[quote=a1]x[/quote]\n\nMine.'), 'Mine.');
});

test('asTyped covers what reads as a tag only: a lone bracket that no tag name follows is left alone', () => {
  assert.equal(asTyped('see [1] and [ b] and [=x]'), 'see [1] and [ b] and [=x]');
  assert.equal(asTyped('see [b]'), '[noparse]see [b][/noparse]');
  assert.equal(asTyped('a [/noparse] b'), '[noparse]a [/noparse[/noparse][noparse]] b[/noparse]');
  assert.equal(outcomeQuote('a1', 'item [1] done'), '[quote=a1]item [1] done[/quote]\n');
});

test('a quote opens at the target\'s own words: a leading quote is skipped, a post that is only a quote quotes its words', () => {
  const q = '11111111-2222-3333-4444-555555555555';
  assert.equal(outcomeQuote('a1', `[quote=${q}]x[/quote] my reply`), '[quote=a1]my reply[/quote]\n');
  assert.equal(outcomeQuote('a1', `  \n[quote=${q}]x[/quote]\nmy reply`), '[quote=a1]my reply[/quote]\n');
  assert.equal(outcomeQuote('a1', `[quote=${q}]a [quote=${q}]x[/quote] b[/quote] after both`), '[quote=a1]after both[/quote]\n');
  assert.equal(outcomeQuote('a1', `[quote=${q}]just this[/quote]`), '[quote=a1]just this[/quote]\n');
  assert.equal(outcomeQuote('a1', `my reply [quote=${q}]x[/quote] more`), '[quote=a1]my reply x more[/quote]\n');
  // A ban entry opens with its own quote of the tipped post: the ruling quotes the entry's words, not the tipped post's.
  assert.equal(outcomeQuote('a1', `[quote=${q}]The tipped post.[/quote]\nBanned: Bob, 1 days.`), '[quote=a1]Banned: Bob, 1 days.[/quote]\n');
});

test('what a leading-quote skip quotes is still a run of the source', () => {
  const q = '11111111-2222-3333-4444-555555555555';
  const body = `[quote=${q}]their words[/quote] my reply, and more of it`;
  const words = wordsOf(outcomeQuote('a1', body));
  assert.ok(quoteSource(parse(body)).includes(quoteNorm(words)));
});

// One contract for room, held to the same table as the database's outcome_quote (supabase/tests/0452-outcome-quotes.sql): room is what the words, the ellipsis and the cover may take in all; the 53 of the markup are out already.
const PARITY: readonly (readonly [string, string, number, string | null])[] = [
  ["whole", "Hello  [b]big\nworld[/b]", 100, "Hello big world"],
  ["cut at a word", "alpha beta gamma", 9, "alpha…"],
  ["hard cut, shrunk by the ellipsis", "abcdefghijklmnop", 6, "abcde…"],
  ["noparse wrap", "[noparse]see [b] now[/noparse]", 40, "[noparse]see [b] now[/noparse]"],
  ["a [/noparse] escape", "a [/noparse] b", 60, "[noparse]a [/noparse[/noparse][noparse]] b[/noparse]"],
  ["astral characters", "😀😁😂 😃😄😅", 5, "😀😁😂…"],
  ["leading quote skipped", "[quote={Q}]first words[/quote] my reply", 100, "my reply"],
  ["no room", "some words", 1, null],
];

test('the parity table: the same (body, room) cases give the same words as the database', () => {
  const Q = '11111111-2222-3333-4444-555555555555';
  for (const [name, body, room, words] of PARITY) {
    assert.equal(outcomeQuote('a1', body.replaceAll('{Q}', Q), room), words === null ? '' : `[quote=a1]${words}[/quote]\n`, name);
  }
});
