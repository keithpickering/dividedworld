import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_QUOTE_MOST, outcomeQuote, withoutLeadingQuote } from './outcome-quote.ts';
import { quoteNorm } from './quoted.ts';

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
