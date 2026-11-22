import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTurns, roundShare, type AwakeSession, type OpenThread } from './turns.ts';

const MIN = 60 * 1000;
const DAY0 = Date.UTC(2026, 10, 22);
const TURNS = { waitHours: 24, perThread: 2, perSession: 3, perDay: 40 };
const reply = (act: string, minutesAgo = 60) => ({ act, author: 'p', at: new Date(DAY0 + 600 * MIN - minutesAgo * MIN).toISOString() });
const open = (staff: string, thread: string, acts: string[], heat = 0, age = 60): OpenThread =>
  ({ staff, thread, heat, replies: acts.map((a, i) => reply(a, age - i)) });
const awake = (staff: string, session = 1, spent = 0, spentByThread: Record<string, number> = {}): AwakeSession =>
  ({ staff, session, spent, spentByThread });
const SLOT = DAY0 + 600 * MIN;

test('roundShare: the day left over the rounds left, rounded up', () => {
  assert.equal(roundShare(0, 40, DAY0, 15), 1); // 96 rounds left: ceil(40/96)
  assert.equal(roundShare(0, 400, DAY0, 15), 5); // ceil(400/96)
  assert.equal(roundShare(30, 40, DAY0 + 23 * 60 * MIN + 45 * MIN, 15), 10); // the last round takes all that is left
  assert.equal(roundShare(0, 40, DAY0 + 23 * 60 * MIN + 30 * MIN, 15), 20); // two rounds left
});

test('roundShare: a spent day is zero, never below', () => {
  assert.equal(roundShare(40, 40, DAY0, 15), 0);
  assert.equal(roundShare(50, 40, DAY0 + 60 * MIN, 15), 0);
});

test('planTurns: one turn per persona per thread, answering every waiting reply, quoting the newest', () => {
  const plan = planTurns([open('a', 't1', ['r1', 'r2', 'r3'])], [awake('a')], 5, TURNS, SLOT);
  assert.deepEqual(plan, [{ staff: 'a', session: 1, thread: 't1', quoting: 'r3', answers: ['r1', 'r2', 'r3'] }]);
});

test('planTurns: a persona that is not awake gets nothing', () => {
  const plan = planTurns([open('a', 't1', ['r1']), open('b', 't2', ['r2'])], [awake('b')], 5, TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.staff), ['b']);
});

test('planTurns: perThread and perSession count turns already spent in the session', () => {
  const threads = [open('a', 't1', ['r1'], 3), open('a', 't2', ['r2'], 2), open('a', 't3', ['r3'], 1)];
  // perThread 2: a thread with two turns spent is full.
  let plan = planTurns(threads, [awake('a', 1, 2, { t1: 2 })], 9, TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['t2']); // perSession 3: one left
  // perSession: nothing left.
  plan = planTurns(threads, [awake('a', 1, 3)], 9, TURNS, SLOT);
  assert.deepEqual(plan, []);
  // Planned turns count toward the session's cap within the round.
  plan = planTurns(threads, [awake('a', 1, 1)], 9, TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['t1', 't2']);
});

test('planTurns: the share caps the round and the hotter thread goes first', () => {
  const threads = [open('a', 'cool', ['r1'], 1), open('b', 'hot', ['r2'], 9)];
  const plan = planTurns(threads, [awake('a'), awake('b', 2)], 1, TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['hot']);
  assert.deepEqual(planTurns(threads, [awake('a'), awake('b', 2)], 0, TURNS, SLOT), []);
});

test('planTurns: heat, then waiting replies, then the older wait', () => {
  const threads = [
    open('a', 'few', ['r1'], 5, 10),
    open('b', 'many', ['r2', 'r3'], 5, 10),
    open('c', 'old', ['r4'], 5, 500),
    open('d', 'cold', ['r5', 'r6', 'r7'], 0, 900),
  ];
  const sessions = ['a', 'b', 'c', 'd'].map((s, i) => awake(s, i + 1));
  const plan = planTurns(threads, sessions, 9, TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['many', 'old', 'few', 'cold']);
});

test('planTurns: the same inputs plan the same, whatever order they arrive in; a tie breaks by the slot', () => {
  const threads = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => open(s, `t-${s}`, ['r-' + s], 1, 30));
  const sessions = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => awake(s, i + 1));
  const one = planTurns(threads, sessions, 3, TURNS, SLOT);
  assert.deepEqual(planTurns([...threads].reverse(), [...sessions].reverse(), 3, TURNS, SLOT), one);
  assert.deepEqual(planTurns(threads, sessions, 3, TURNS, SLOT), one);
  const orders = new Set<string>();
  for (let s = 0; s < 20; s++) orders.add(planTurns(threads, sessions, 3, TURNS, SLOT + s * 15 * MIN).map((p) => p.staff).join());
  assert.ok(orders.size > 1, 'the slot changes how a tie breaks');
});

test('planTurns: a thread listed twice for one persona still plans one turn', () => {
  const plan = planTurns([open('a', 't1', ['r1']), open('a', 't1', ['r2'])], [awake('a')], 5, TURNS, SLOT);
  assert.equal(plan.length, 1);
});
