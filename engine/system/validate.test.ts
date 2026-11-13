import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutCompletion, repair } from './validate.ts';
import type { Rule } from './validate.ts';

const rules: Rule = {
  type: 'object',
  fields: {
    moves: { type: 'list', max: 6, of: { type: 'string', maxLength: 20 } },
    note: { type: 'string', maxLength: 10, optional: true },
    verdict: { type: 'enum', values: ['upheld', 'overturned'] },
  },
};
const good = { moves: ['a', 'b'], verdict: 'upheld' };

test('a list one over its bound is trimmed to it, and the trim is recorded', () => {
  const r = repair({ ...good, moves: ['1', '2', '3', '4', '5', '6', '7'] }, rules);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual((r.value as { moves: string[] }).moves, ['1', '2', '3', '4', '5', '6']);
  // The poison: a repair that trims and drops the record passes the value check above.
  assert.deepEqual(r.trims, [{ path: 'moves', predicate: 'atMost(6)', before: 7, after: 6 }]);
});

test('a list two over is trimmed too; twelve is rejected naming atMost(6), never cut to fit', () => {
  const eight = repair({ ...good, moves: Array.from({ length: 8 }, (_, i) => String(i)) }, rules);
  assert.equal(eight.ok, true);
  const twelve = repair({ ...good, moves: Array.from({ length: 12 }, (_, i) => String(i)) }, rules);
  assert.deepEqual(twelve, { ok: false, path: 'moves', predicate: 'atMost(6)', trims: [] });
});

test('a string over its length is cut, and the cut is recorded with the path', () => {
  const r = repair({ ...good, moves: ['x'.repeat(25)] }, rules);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal((r.value as { moves: string[] }).moves[0], 'x'.repeat(20));
  assert.deepEqual(r.trims, [{ path: 'moves[0]', predicate: 'maxLength(20)', before: 25, after: 20 }]);
});

test('a missing required field is rejected, never filled', () => {
  const r = repair({ moves: [] }, rules);
  assert.deepEqual(r, { ok: false, path: 'verdict', predicate: 'required', trims: [] });
});

test('a wrong type and a value outside an enum are rejected naming the predicate', () => {
  assert.deepEqual(repair({ ...good, moves: 'nope' }, rules), { ok: false, path: 'moves', predicate: 'isList', trims: [] });
  assert.deepEqual(repair({ ...good, verdict: 'maybe' }, rules), { ok: false, path: 'verdict', predicate: 'oneOf(upheld, overturned)', trims: [] });
  assert.deepEqual(repair('text', rules), { ok: false, path: '', predicate: 'isObject', trims: [] });
});

test('a rejection keeps the trims made before it, so the ledger row can say both', () => {
  const r = repair({ moves: ['1', '2', '3', '4', '5', '6', '7'] }, rules);
  assert.deepEqual(r, { ok: false, path: 'verdict', predicate: 'required', trims: [{ path: 'moves', predicate: 'atMost(6)', before: 7, after: 6 }] });
});

test('an optional field may be absent; the input is never changed in place', () => {
  const input = { ...good, moves: ['1', '2', '3', '4', '5', '6', '7'] };
  const r = repair(input, rules);
  assert.equal(r.ok, true);
  assert.equal(input.moves.length, 7);
});

test('a list under its minimum is rejected, not padded', () => {
  const r = repair({ moves: [] }, { type: 'object', fields: { moves: { type: 'list', min: 1, of: { type: 'string' } } } });
  assert.deepEqual(r, { ok: false, path: 'moves', predicate: 'atLeast(1)', trims: [] });
});

test('a completion is cut at the first stop sequence, and at a newline', () => {
  const a = cutCompletion('The Director says no. END and more', ['END'], 200);
  assert.deepEqual(a, { ok: true, text: 'The Director says no.', trims: [] });
  const b = cutCompletion('first line\nsecond line', ['END'], 200);
  assert.equal(b.ok && b.text, 'first line');
  const c = cutCompletion('a STOP b END c', ['END', 'STOP'], 200);
  assert.equal(c.ok && c.text, 'a');
});

test('a completion over its length is capped and the cap recorded; only empty output is rejected', () => {
  const a = cutCompletion('y'.repeat(50), [], 40);
  assert.deepEqual(a, { ok: true, text: 'y'.repeat(40), trims: [{ path: '', predicate: 'maxLength(40)', before: 50, after: 40 }] });
  assert.deepEqual(cutCompletion('', [], 40), { ok: false, predicate: 'nonEmpty' });
  assert.deepEqual(cutCompletion('  \n  ', [], 40), { ok: false, predicate: 'nonEmpty' });
  assert.deepEqual(cutCompletion('END tail', ['END'], 40), { ok: false, predicate: 'nonEmpty' });
});

test('a completion that begins with a newline is cut after the leading whitespace, and only output empty after that is rejected', () => {
  assert.deepEqual(cutCompletion('\nThe Director sighs.', [], 100), { ok: true, text: 'The Director sighs.', trims: [] });
  assert.deepEqual(cutCompletion(' \n\nThe Director\nMore', ['\n\n'], 100), { ok: true, text: 'The Director', trims: [] });
  assert.deepEqual(cutCompletion(' \n\t\n', [], 100), { ok: false, predicate: 'nonEmpty' });
});

test('a trim never leaves half an emoji, and records the length it really left', () => {
  const r = repair('a😀b', { type: 'string', maxLength: 2 });
  assert.deepEqual(r, { ok: true, value: 'a', trims: [{ path: '', predicate: 'maxLength(2)', before: 4, after: 1 }] });
  const c = cutCompletion('a😀b', [], 2);
  assert.deepEqual(c, { ok: true, text: 'a', trims: [{ path: '', predicate: 'maxLength(2)', before: 4, after: 1 }] });
  assert.deepEqual(repair('a😀b', { type: 'string', maxLength: 3 }), { ok: true, value: 'a😀', trims: [{ path: '', predicate: 'maxLength(3)', before: 4, after: 3 }] });
});

test('a trim never empties a string that had text: an emoji at the cut is kept whole rather than dropped to nothing', () => {
  assert.deepEqual(repair('😀b', { type: 'string', maxLength: 1, minLength: 1 }), { ok: true, value: '😀', trims: [{ path: '', predicate: 'maxLength(1)', before: 3, after: 2 }] });
  assert.deepEqual(cutCompletion('😀b', [], 1), { ok: true, text: '😀', trims: [{ path: '', predicate: 'maxLength(1)', before: 3, after: 2 }] });
});

test('an any rule passes a value of any type unchanged, and an absent optional one is left out', () => {
  const rule: Rule = { type: 'object', fields: { words: { type: 'string' }, extra: { type: 'any', optional: true } } };
  for (const extra of [5, 'teal', ['a'], { color: 5 }, true]) {
    assert.deepEqual(repair({ words: 'x', extra }, rule), { ok: true, value: { words: 'x', extra }, trims: [] });
  }
  assert.deepEqual(repair({ words: 'x' }, rule), { ok: true, value: { words: 'x' }, trims: [] });
  assert.deepEqual(repair({ words: 'x', extra: null }, rule), { ok: true, value: { words: 'x' }, trims: [] });
});

test('a completion asked for many lines keeps them; one line stays the default', () => {
  const three = 'first line\nsecond line\nthird line';
  assert.deepEqual(cutCompletion(three, [], 200), { ok: true, text: 'first line', trims: [] });
  assert.deepEqual(cutCompletion(three, [], 200, 'one'), { ok: true, text: 'first line', trims: [] });
  assert.deepEqual(cutCompletion(three, [], 200, 'many'), { ok: true, text: three, trims: [] });
});

test('under many lines a stop sequence still cuts, long runs of newlines collapse to two, and the end is trimmed', () => {
  assert.deepEqual(cutCompletion('one\ntwo\nQuote: three', ['\nQuote:'], 200, 'many'), { ok: true, text: 'one\ntwo', trims: [] });
  assert.deepEqual(cutCompletion('one\n\n\n\n\ntwo\n \n\t\n\nthree \n\n', [], 200, 'many'), { ok: true, text: 'one\n\ntwo\n\nthree', trims: [] });
  // A stop that opens the answer is found before the leading newline is dropped: the model began a new post.
  assert.deepEqual(cutCompletion('\nQuote: someone else', ['\nQuote:'], 200, 'many'), { ok: false, predicate: 'nonEmpty' });
});

test('under many lines a leading space is kept as one space, never a newline, so a continuation joins its sentence', () => {
  assert.deepEqual(cutCompletion('   \n\n\n\nfoo', [], 200, 'many'), { ok: true, text: ' foo', trims: [] });
  assert.deepEqual(cutCompletion(' and so on', [], 200, 'many'), { ok: true, text: ' and so on', trims: [] });
  assert.deepEqual(cutCompletion('\n\nfoo', [], 200, 'many'), { ok: true, text: 'foo', trims: [] });
  assert.deepEqual(cutCompletion('ing it', [], 200, 'many'), { ok: true, text: 'ing it', trims: [] });
});

test('an answer that is only newlines is rejected under one line and under many', () => {
  assert.deepEqual(cutCompletion('\n\n\n', [], 200, 'one'), { ok: false, predicate: 'nonEmpty' });
  assert.deepEqual(cutCompletion('\n\n\n', [], 200, 'many'), { ok: false, predicate: 'nonEmpty' });
  assert.deepEqual(cutCompletion(' \n \n', [], 200, 'many'), { ok: false, predicate: 'nonEmpty' });
});

test('under many lines the cap counts the kept leading space, and CRLF runs collapse as newlines do', () => {
  const capped = cutCompletion(` ${'x'.repeat(300)}`, [], 200, 'many');
  assert.deepEqual(capped, { ok: true, text: ` ${'x'.repeat(199)}`, trims: [{ path: '', predicate: 'maxLength(200)', before: 301, after: 200 }] });
  assert.deepEqual(cutCompletion('a\r\n\r\n\r\n\r\nb', [], 200, 'many'), { ok: true, text: 'a\n\nb', trims: [] });
});

test('a string over its bound is cut at the last space within it, where that keeps half the bound, and the trim is recorded', () => {
  assert.deepEqual(repair('a happy little tree in a quiet field', { type: 'string', maxLength: 20 }), {
    ok: true, value: 'a happy little tree', trims: [{ path: '', predicate: 'maxLength(20)', before: 36, after: 19 }],
  });
  const word = repair('x'.repeat(30), { type: 'string', maxLength: 20 });
  assert.ok(word.ok && word.value === 'x'.repeat(20), 'no space: cut at the bound');
  const early = repair('ab cdefghijklmnopqrstuvwxyz', { type: 'string', maxLength: 20 });
  assert.ok(early.ok && early.value === 'ab cdefghijklmnopqrs', 'a space before half the bound is not used');
  const comma = repair('one, two, three, four', { type: 'string', maxLength: 12 });
  assert.ok(comma.ok && comma.value === 'one, two', 'the trailing comma is dropped');
  const dash = repair('well - and then some more', { type: 'string', maxLength: 12 });
  assert.ok(dash.ok && dash.value === 'well - and', JSON.stringify(dash));
  const nl = repair('first line\nsecond line goes on', { type: 'string', maxLength: 16 });
  assert.ok(nl.ok && nl.value === 'first line', `a newline is a place to cut: ${JSON.stringify(nl)}`);
  const punct = repair('-- - ----', { type: 'string', maxLength: 4 });
  assert.ok(punct.ok && String(punct.value).length > 0, `a cut that leaves only punctuation is never empty: ${JSON.stringify(punct)}`);
});

test('cutCompletion cuts at a pattern\'s first match as well as at the stops, whichever comes first', () => {
  const pattern = /-{2,}\s*Posted by /;
  const a = cutCompletion('a b -- Posted by X: c', [], 200, 'many', pattern);
  assert.ok(a.ok && a.text === 'a b');
  const b = cutCompletion('posted by my friend', [], 200, 'many', pattern);
  assert.ok(b.ok && b.text === 'posted by my friend');
  const stopFirst = cutCompletion('one END two -- Posted by X', ['END'], 200, 'many', pattern);
  assert.ok(stopFirst.ok && stopFirst.text === 'one');
  const patternFirst = cutCompletion('one -- Posted by X two END', ['END'], 200, 'many', pattern);
  assert.ok(patternFirst.ok && patternFirst.text === 'one');
  const none = cutCompletion('a b -- Posted by X: c', [], 200, 'many');
  assert.ok(none.ok && none.text === 'a b -- Posted by X: c');
});
