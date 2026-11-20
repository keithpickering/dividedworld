/**
 * The text of a quote and the source of a version (engine/bbcode/quoted.ts): `quoteNorm`, `holds`, the walk's separators and its cut mark. The fixtures that hold
 * `quoteHeld` and `quoteSource` to the database's `bbcode_walk` are in plain.fixtures.ts, run by plain.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parse.ts';
import { CUT, holds, quoteHeld, quoteNorm, quotePieces, quoteSource, quoteWords } from './quoted.ts';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('quoteNorm composes, collapses every run of whitespace to one space and trims', () => {
  assert.equal(quoteNorm('  a \n\t b\u3000\u3000c\u00a0 '), 'a b c');
  assert.equal(quoteNorm('cafe\u0301'), 'caf\u00e9');
  assert.equal(quoteNorm(''), '');
});

test('quoteNorm reads a run of more than eight of one code point as eight, by code point', () => {
  assert.equal(quoteNorm('n' + 'o'.repeat(20)), 'n' + 'o'.repeat(8));
  assert.equal(quoteNorm('o'.repeat(8)), 'o'.repeat(8));
  assert.equal(quoteNorm('\u{1F600}'.repeat(12)), '\u{1F600}'.repeat(8));
});

test('quoteNorm removes one ellipsis at each end with the space beside it, and keeps one in the middle', () => {
  assert.equal(quoteNorm('... a ...'), 'a');
  assert.equal(quoteNorm('…a…'), 'a');
  assert.equal(quoteNorm('...... x ... y ......'), 'x ... y');
  assert.equal(quoteNorm('.. a ..'), '.. a ..');
  assert.equal(quoteNorm('... ... a'), '... a');
});

test('quoteNorm never touches the cut mark', () => {
  assert.equal(quoteNorm(`a ${CUT} b`), `a ${CUT} b`);
});

test('quotePieces splits on the cut mark, and nothing is a list of none', () => {
  assert.deepEqual(quotePieces(`a b ${CUT} c`), ['a b', 'c']);
  assert.deepEqual(quotePieces(''), []);
  assert.deepEqual(quotePieces('x'), ['x']);
});

test('holds: every piece stands in order, each at or after the end of the one before', () => {
  assert.equal(holds('one two three', ['one', 'three']), true);
  assert.equal(holds('one two three', ['three', 'one']), false);
  assert.equal(holds('abc', ['ab', 'bc']), false, 'overlapping pieces are refused');
  assert.equal(holds('abcabc', ['abc', 'abc']), true);
  assert.equal(holds('abc', ['abc', 'abc']), false);
  assert.equal(holds('abc', ['abc', 'c']), false);
});

test('holds: an empty piece list, or empty pieces, hold', () => {
  assert.equal(holds('x', []), true);
  assert.equal(holds('', ['']), true);
  assert.equal(holds('x', ['', '']), true);
  assert.equal(holds('x', ['', 'x', '']), true);
  assert.equal(holds('x', ['y']), false);
});

test('the cut mark is never emitted from text', () => {
  assert.equal(quoteSource(parse(`a${CUT}b [code]c${CUT}d[/code] [noparse]e${CUT}f[/noparse]`)), 'ab cd ef');
  assert.equal(quoteWords(parse(`x${CUT}y`)), 'xy');
});

test('quoteWords: blocks stand as a separator, inline tags do not', () => {
  assert.equal(quoteWords(parse('a[b]b[/b]c[center]d[/center]e')), 'abc\nd\ne');
  assert.equal(quoteWords(parse('a[hr]b')), 'a\nb');
});

test('quoteHeld lists each quote of an Act in the order the openers stand', () => {
  const held = quoteHeld(parse(`[quote=${A}]one[/quote][quote=${A}]two[/quote]`));
  assert.deepEqual([...held], [[A, [['one'], ['two']]]]);
});

test('quoteNorm reads every member of the whitespace class as a space (the SQL class in quote_norm is the same list)', () => {
  const members = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
  for (const cp of members) assert.equal(quoteNorm(`a${String.fromCodePoint(cp)}b`), 'a b', `U+${cp.toString(16)}`);
  assert.equal(quoteNorm('a\u200bb'), 'a\u200bb', 'a zero width space is not whitespace');
});
