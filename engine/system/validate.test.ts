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
  assert.deepEqual(twelve, { ok: false, path: 'moves', predicate: 'atMost(6)' });
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
  assert.deepEqual(r, { ok: false, path: 'verdict', predicate: 'required' });
});

test('a wrong type and a value outside an enum are rejected naming the predicate', () => {
  assert.deepEqual(repair({ ...good, moves: 'nope' }, rules), { ok: false, path: 'moves', predicate: 'isList' });
  assert.deepEqual(repair({ ...good, verdict: 'maybe' }, rules), { ok: false, path: 'verdict', predicate: 'oneOf(upheld, overturned)' });
  assert.deepEqual(repair('text', rules), { ok: false, path: '', predicate: 'isObject' });
});

test('an optional field may be absent; the input is never changed in place', () => {
  const input = { ...good, moves: ['1', '2', '3', '4', '5', '6', '7'] };
  const r = repair(input, rules);
  assert.equal(r.ok, true);
  assert.equal(input.moves.length, 7);
});

test('a list under its minimum is rejected, not padded', () => {
  const r = repair({ moves: [] }, { type: 'object', fields: { moves: { type: 'list', min: 1, of: { type: 'string' } } } });
  assert.deepEqual(r, { ok: false, path: 'moves', predicate: 'atLeast(1)' });
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
