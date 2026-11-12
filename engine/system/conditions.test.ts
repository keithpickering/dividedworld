import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITIONS, CONDITION_KEYS, ACTIVITY_DAYS, conditionProblem, dueProblem } from './conditions.ts';

const UUID = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ref = { role: 'fangames', beat: 'split' };
const bad = (c: unknown) => conditionProblem(c);

test('the catalog is the design\'s five keys, each said in plain words', () => {
  assert.deepEqual([...CONDITION_KEYS], ['phase', 'beatLanded', 'boardActivity', 'moveReversed', 'demandResolved']);
  assert.deepEqual(CONDITIONS.map((c) => c.key), [...CONDITION_KEYS]);
  assert.ok(CONDITIONS.length > 0);
  for (const c of CONDITIONS) assert.ok(c.plain.trim() !== '', c.key);
});

test('a key outside the list is refused, naming it', () => {
  const p = bad({ kind: 'weather' });
  assert.equal(p?.path, 'kind');
  assert.equal(p?.predicate, 'oneOf(phase, beatLanded, boardActivity, moveReversed, demandResolved)');
  assert.match(p!.said, /"weather"/);
  assert.equal(bad({})?.path, 'kind');
  assert.equal(bad(null)?.path, 'kind');
  assert.equal(bad('phase')?.path, 'kind');
});

test('phase: a phase that has begun, or days before the end, or both', () => {
  assert.equal(bad({ kind: 'phase', phase: 'reign' }), null);
  assert.equal(bad({ kind: 'phase', phase: 'meltdown' }), null);
  assert.equal(bad({ kind: 'phase', daysBeforeEnd: 7 }), null);
  assert.equal(bad({ kind: 'phase', phase: 'meltdown', daysBeforeEnd: 3 }), null);
  assert.equal(bad({ kind: 'phase' })?.predicate, 'atLeastOneOf(phase, daysBeforeEnd)');
  assert.equal(bad({ kind: 'phase', phase: 'summer' })?.predicate, 'oneOf(honeymoon, reign, meltdown)');
  assert.equal(bad({ kind: 'phase', daysBeforeEnd: 0 })?.predicate, 'atLeast(1)');
  assert.equal(bad({ kind: 'phase', daysBeforeEnd: 366 })?.predicate, 'atMost(365)');
  assert.equal(bad({ kind: 'phase', daysBeforeEnd: 1.5 })?.predicate, 'isInteger');
  assert.equal(bad({ kind: 'phase', phase: 'reign', days: 2 })?.predicate, 'noParam');
});

test('beatLanded: the key of an earlier beat', () => {
  assert.equal(bad({ kind: 'beatLanded', beat: 'split' }), null);
  assert.equal(bad({ kind: 'beatLanded', beat: 'picking-apart' }), null);
  assert.equal(bad({ kind: 'beatLanded' })?.predicate, 'required');
  assert.equal(bad({ kind: 'beatLanded', beat: 'Split' })?.predicate, 'isKey');
  assert.equal(bad({ kind: 'beatLanded', beat: 4 })?.predicate, 'isString');
  assert.equal(bad({ kind: 'beatLanded', beat: 'split', after: 1 })?.predicate, 'noParam');
});

test('boardActivity: a board, a window, and above or below a number or another board', () => {
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 7, above: 10 }), null);
  assert.equal(bad({ kind: 'boardActivity', board: ref, days: 7, below: 0 }), null);
  assert.equal(bad({ kind: 'boardActivity', board: ref, days: 7, above: { role: 'minus', beat: 'split' } }), null);
  assert.equal(bad({ kind: 'boardActivity', board: ref, days: ACTIVITY_DAYS.most, below: UUID }), null);
  assert.equal(bad({ kind: 'boardActivity', days: 7, above: 1 })?.path, 'board');
  assert.equal(bad({ kind: 'boardActivity', board: 'general', days: 7, above: 1 })?.predicate, 'isBoard');
  assert.equal(bad({ kind: 'boardActivity', board: { role: 'fangames' }, days: 7, above: 1 })?.predicate, 'isBoard', 'a role means a beat\'s role outside its bundle');
  assert.equal(bad({ kind: 'boardActivity', board: UUID, above: 1 })?.path, 'days');
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 0, above: 1 })?.predicate, `atLeast(${ACTIVITY_DAYS.least})`);
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: ACTIVITY_DAYS.most + 1, above: 1 })?.predicate, `atMost(${ACTIVITY_DAYS.most})`);
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 7 })?.predicate, 'exactlyOneOf(above, below)');
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 7, above: 1, below: 2 })?.predicate, 'exactlyOneOf(above, below)');
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 7, above: -1 })?.predicate, 'atLeast(0)');
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 7, above: 100001 })?.predicate, 'atMost(100000)');
  assert.equal(bad({ kind: 'boardActivity', board: UUID, days: 7, above: 'many' })?.predicate, 'isBoard');
});

test('moveReversed takes nothing', () => {
  assert.equal(bad({ kind: 'moveReversed' }), null);
  assert.equal(bad({ kind: 'moveReversed', by: 'admin' })?.predicate, 'noParam');
});

test('demandResolved: met or failed', () => {
  assert.equal(bad({ kind: 'demandResolved', outcome: 'met' }), null);
  assert.equal(bad({ kind: 'demandResolved', outcome: 'failed' }), null);
  assert.equal(bad({ kind: 'demandResolved', outcome: 'late' })?.predicate, 'oneOf(met, failed)');
  assert.equal(bad({ kind: 'demandResolved' })?.predicate, 'required');
});

test('a due point: a phase, days into it, days before the end', () => {
  assert.equal(dueProblem({ phase: 'reign', daysIntoPhase: 7 }), null);
  assert.equal(dueProblem({ daysBeforeEnd: 2 }), null);
  assert.equal(dueProblem({ phase: 'meltdown' }), null);
  assert.equal(dueProblem({})?.predicate, 'atLeastOneOf(phase, daysIntoPhase, daysBeforeEnd)');
  assert.equal(dueProblem({ daysIntoPhase: 3 })?.predicate, 'requires(phase)', 'days into a phase need the phase');
  assert.equal(dueProblem({ phase: 'summer' })?.predicate, 'oneOf(honeymoon, reign, meltdown)');
  assert.equal(dueProblem({ daysBeforeEnd: -1 })?.predicate, 'atLeast(0)');
  assert.equal(dueProblem({ phase: 'reign', moon: 1 })?.predicate, 'noParam');
});
