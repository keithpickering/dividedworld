import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pacer, planTurns, roundShare, type AwakeSession, type OpenThread } from './turns.ts';

const MIN = 60 * 1000;
const DAY0 = Date.UTC(2026, 10, 22);
const TURNS = { waitHours: 24, perThread: 2, perSession: 3, perDay: 40 };
const reply = (act: string, minutesAgo = 60) => ({ act, author: 'p', at: new Date(DAY0 + 600 * MIN - minutesAgo * MIN).toISOString() });
const open = (staff: string, thread: string, acts: string[], heat = 0, age = 60): OpenThread =>
  ({ staff, thread, heat, replies: acts.map((a, i) => reply(a, age - i)) });
const awake = (staff: string, session = 1, spent = 0, spentByThread: Record<string, number> = {}): AwakeSession =>
  ({ staff, session, spent, spentByThread });
const SLOT = DAY0 + 600 * MIN;

test('roundShare: by round k the day has earned floor(perDay x (k+1) / N), less what is spent', () => {
  assert.equal(roundShare(0, 40, DAY0, 15), 0); // round 0 of 96: floor(40/96)
  assert.equal(roundShare(0, 400, DAY0, 15), 4); // floor(400/96)
  assert.equal(roundShare(0, 40, DAY0 + 12 * 60 * MIN, 15), 20); // round 48: floor(40*49/96) = 20
  assert.equal(roundShare(30, 40, DAY0 + 23 * 60 * MIN + 45 * MIN, 15), 10); // the last round has earned the whole day
});

test('roundShare: with demand in every round the last round still has a turn, and the day never overspends', () => {
  let spent = 0;
  let last = 0;
  for (let k = 0; k < 96; k++) {
    last = roundShare(spent, 60, DAY0 + k * 15 * MIN, 15);
    spent += last;
  }
  assert.ok(last > 0, 'the last round has a turn');
  assert.ok(spent <= 60, 'the day never exceeds perDay');
  assert.equal(spent, 60);
  // not front-loaded: by 14:45 UTC (round 59) well under the whole day is gone
  let by1445 = 0;
  for (let k = 0; k <= 59; k++) by1445 += roundShare(by1445, 60, DAY0 + k * 15 * MIN, 15);
  assert.ok(by1445 <= 37, `only about 37 of 60 by 14:45, got ${by1445}`);
});

test('roundShare: a quiet morning leaves the turns earned so far at 18:00', () => {
  assert.equal(roundShare(0, 96, DAY0 + 18 * 60 * MIN, 15), 73); // round 72: floor(96*73/96)
});

test('roundShare: a once-a-day cron gets the whole day', () => {
  assert.equal(roundShare(0, 40, DAY0, 1440), 40);
});

test('roundShare: a cron that does not divide the day, or runs less than daily, still spends the whole day and no more', () => {
  for (const cron of [7, 25, 2000]) {
    let spent = 0;
    for (let at = 0; at < 24 * 60; at += cron) spent += roundShare(spent, 40, DAY0 + at * MIN, cron);
    assert.equal(spent, 40, `cron every ${cron} minutes`);
  }
});

test('roundShare: a spent day is zero, never below', () => {
  assert.equal(roundShare(40, 40, DAY0, 15), 0);
  assert.equal(roundShare(50, 40, DAY0 + 60 * MIN, 15), 0);
  assert.equal(roundShare(30, 40, DAY0 + 60 * MIN, 15), 0); // spent beyond what is earned
});

test('planTurns: one turn per persona per thread, answering every waiting reply, quoting the newest', () => {
  const plan = planTurns([open('a', 't1', ['r1', 'r2', 'r3'])], [awake('a')], TURNS, SLOT);
  assert.deepEqual(plan, [{ staff: 'a', session: 1, thread: 't1', quoting: 'r3', answers: ['r1', 'r2', 'r3'] }]);
});

test('planTurns: a persona that is not awake gets nothing', () => {
  const plan = planTurns([open('a', 't1', ['r1']), open('b', 't2', ['r2'])], [awake('b')], TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.staff), ['b']);
});

test('planTurns: perThread and perSession count turns already spent in the session', () => {
  const threads = [open('a', 't1', ['r1'], 3), open('a', 't2', ['r2'], 2), open('a', 't3', ['r3'], 1)];
  // perThread 2: a thread with two turns spent is full.
  let plan = planTurns(threads, [awake('a', 1, 2, { t1: 2 })], TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['t2']); // perSession 3: one left
  // perSession: nothing left.
  plan = planTurns(threads, [awake('a', 1, 3)], TURNS, SLOT);
  assert.deepEqual(plan, []);
  // Planned turns count toward the session's cap within the round.
  plan = planTurns(threads, [awake('a', 1, 1)], TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['t1', 't2']);
});

test('planTurns: with no share every capped turn is returned, hottest first', () => {
  const threads = [open('a', 'cool', ['r1'], 1), open('b', 'hot', ['r2'], 9)];
  const plan = planTurns(threads, [awake('a'), awake('b', 2)], TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['hot', 'cool']);
});

test('pacer: with 10,000 available, turns of 8,000, 8,000 and 2,000 take the first two and refuse the third', () => {
  const p = pacer(10000);
  const started: number[] = [];
  for (const size of [8000, 8000, 2000]) {
    if (!p.mayStart()) break;
    started.push(size);
    p.charge(size);
  }
  assert.deepEqual(started, [8000, 8000]);
  assert.equal(p.remaining(), -6000);
  assert.equal(p.mayStart(), false);
});

test('pacer: exactly nothing available, or less, starts nothing', () => {
  assert.equal(pacer(0).mayStart(), false);
  assert.equal(pacer(-1).mayStart(), false);
});

test('planTurns: heat, then waiting replies, then the older wait', () => {
  const threads = [
    open('a', 'few', ['r1'], 5, 10),
    open('b', 'many', ['r2', 'r3'], 5, 10),
    open('c', 'old', ['r4'], 5, 500),
    open('d', 'cold', ['r5', 'r6', 'r7'], 0, 900),
  ];
  const sessions = ['a', 'b', 'c', 'd'].map((s, i) => awake(s, i + 1));
  const plan = planTurns(threads, sessions, TURNS, SLOT);
  assert.deepEqual(plan.map((p) => p.thread), ['many', 'old', 'few', 'cold']);
});

test('planTurns: the same inputs plan the same, whatever order they arrive in; a tie breaks by the slot', () => {
  const threads = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => open(s, `t-${s}`, ['r-' + s], 1, 30));
  const sessions = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => awake(s, i + 1));
  const one = planTurns(threads, sessions, TURNS, SLOT);
  assert.deepEqual(planTurns([...threads].reverse(), [...sessions].reverse(), TURNS, SLOT), one);
  assert.deepEqual(planTurns(threads, sessions, TURNS, SLOT), one);
  const orders = new Set<string>();
  for (let s = 0; s < 20; s++) orders.add(planTurns(threads, sessions, TURNS, SLOT + s * 15 * MIN).map((p) => p.staff).join());
  assert.ok(orders.size > 1, 'the slot changes how a tie breaks');
});

test('planTurns: a thread listed twice for one persona still plans one turn', () => {
  const plan = planTurns([open('a', 't1', ['r1']), open('a', 't1', ['r2'])], [awake('a')], TURNS, SLOT);
  assert.equal(plan.length, 1);
});
