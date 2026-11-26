// jobHealth: when a job reads stopped. The bound is the job's own schedule and grace (design section 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOBS, jobHealth, stoppedJobs, type JobRow } from './jobs.ts';

const at = (d: string) => new Date(`${d}Z`);
const EVERY = '* * * * *';
const row = (job: string, over: Partial<JobRow> = {}): JobRow => ({ job, schedule: EVERY, active: true, firstSeen: '2027-01-01T00:00:00Z', lastOkAt: '2027-03-01T14:02:00Z', grace: null, ...over });
/** Every job a row, running each minute and last good at `lastOkAt`, with `over` for the named job. */
const rows = (named: Record<string, Partial<JobRow>> = {}, base: Partial<JobRow> = {}): JobRow[] => JOBS.map((j) => row(j.name, { ...base, ...(named[j.name] ?? {}) }));
const of = (health: ReturnType<typeof jobHealth>, name: string) => health.find((h) => h.job === name)!;

test("the Jobs page's plain words for staff name its whole run (the owner's words, #1199)", () => {
  assert.equal(JOBS.find((j) => j.name === 'kayfabb-staff')?.about, "Runs the Mod Bots: visits, reports, appeals, patrols and the staff's posts");
});

test('JOBS lists the ten jobs in name order, each frozen, with the function folder or null', () => {
  assert.equal(JOBS.length, 10);
  assert.deepEqual(JOBS.map((j) => j.name), [...JOBS.map((j) => j.name)].sort());
  assert.ok(Object.isFrozen(JOBS) && JOBS.every((j) => Object.isFrozen(j)));
  assert.deepEqual(JOBS.filter((j) => j.fn === null).map((j) => j.name), ['kayfabb-search-rebuild', 'kayfabb-system-tick', 'kayfabb-view-counts']);
  assert.ok(JOBS.filter((j) => j.fn !== null).every((j) => `kayfabb-${j.fn}` === j.name));
});

test('a conceal run at 14:02 is running at 14:12:59 and stopped at 14:13 (every minute, grace 10)', () => {
  const rs = rows({}, { lastOkAt: '2027-03-01T14:02:00Z' });
  assert.equal(of(jobHealth(rs, { 'kayfabb-conceal': 10 }, at('2027-03-01T14:12:59')), 'kayfabb-conceal').stopped, false);
  const stopped = of(jobHealth(rs, { 'kayfabb-conceal': 10 }, at('2027-03-01T14:13:00')), 'kayfabb-conceal');
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.missed, '2027-03-01T14:03:00.000Z');
  assert.equal(stopped.since, '2027-03-01T14:02:00Z');
  assert.equal(stopped.missedRuns, 1);
});

test('a run one minute past the grace reads stopped, and a run exactly at the latest due time reads running', () => {
  const rs = rows({ 'kayfabb-settle': { schedule: '17 8 * * *', lastOkAt: '2027-03-01T08:17:00Z' } });
  // Settle is due 08:17 each day, grace 30: the next due time 2027-03-02 08:17 is missed from 08:47.
  assert.equal(of(jobHealth(rs, {}, at('2027-03-02T08:46:59')), 'kayfabb-settle').stopped, false);
  assert.equal(of(jobHealth(rs, {}, at('2027-03-02T08:47:00')), 'kayfabb-settle').stopped, true);
  const ranOnTime = rows({ 'kayfabb-settle': { schedule: '17 8 * * *', lastOkAt: '2027-03-02T08:17:00Z' } });
  assert.equal(of(jobHealth(ranOnTime, {}, at('2027-03-02T20:00:00')), 'kayfabb-settle').stopped, false, 'a run exactly at the due time is that run');
});

test("settle's first missed run is the 08:17 after lastOkAt, and the runs missed are counted", () => {
  const rs = rows({ 'kayfabb-settle': { schedule: '17 8 * * *', lastOkAt: '2027-03-01T08:20:00Z' } });
  const h = of(jobHealth(rs, {}, at('2027-03-04T12:00:00')), 'kayfabb-settle');
  assert.equal(h.stopped, true);
  assert.equal(h.missed, '2027-03-02T08:17:00.000Z');
  assert.equal(h.missedRuns, 3);
});

test('missed runs stop counting at 99', () => {
  const rs = rows({}, { lastOkAt: '2027-03-01T00:00:00Z' });
  const h = of(jobHealth(rs, {}, at('2027-03-05T00:00:00')), 'kayfabb-conceal');
  assert.equal(h.missedRuns, 99);
  assert.equal(h.missed, '2027-03-01T00:01:00.000Z');
});

test('a job that never ran is measured from firstSeen, and a job with no reference at all is stopped', () => {
  const never = rows({ 'kayfabb-mail': { lastOkAt: null, firstSeen: '2027-03-01T14:00:00Z' } });
  const early = of(jobHealth(never, {}, at('2027-03-01T14:10:30')), 'kayfabb-mail');
  assert.equal(early.stopped, false);
  assert.equal(early.since, '2027-03-01T14:00:00Z');
  assert.equal(of(jobHealth(never, {}, at('2027-03-01T14:11:00')), 'kayfabb-mail').stopped, true);
  const none = rows({ 'kayfabb-mail': { lastOkAt: null, firstSeen: null } });
  const h = of(jobHealth(none, {}, at('2027-03-01T14:00:00')), 'kayfabb-mail');
  assert.deepEqual([h.scheduled, h.stopped, h.since], [true, true, null]);
});

test('a missing row, a null schedule and an inactive row are not scheduled, and stopped', () => {
  const rs = rows({ 'kayfabb-meet': { active: false }, 'kayfabb-staff': { schedule: null } }).filter((r) => r.job !== 'kayfabb-write');
  const health = jobHealth(rs, {}, at('2027-03-01T14:02:30'));
  for (const name of ['kayfabb-meet', 'kayfabb-staff', 'kayfabb-write']) {
    const h = of(health, name);
    assert.deepEqual([h.scheduled, h.stopped, h.missed, h.missedRuns], [false, true, null, 0], name);
  }
  assert.equal(of(health, 'kayfabb-conceal').stopped, false);
});

test('one entry per job in JOBS order, and stoppedJobs keeps the stopped ones', () => {
  const health = jobHealth(rows({ 'kayfabb-mail': { active: false } }), {}, at('2027-03-01T14:02:30'));
  assert.deepEqual(health.map((h) => h.job), JOBS.map((j) => j.name));
  assert.deepEqual(stoppedJobs(health).map((h) => h.job), ['kayfabb-mail']);
});

test("the row's grace beats the argument's, which beats the default", () => {
  // Due each minute, last good 14:02, now 14:20: the 10 minute default has passed; 30 has not; 5 has.
  const now = at('2027-03-01T14:20:00');
  const base = rows({}, { lastOkAt: '2027-03-01T14:02:00Z' });
  assert.equal(of(jobHealth(base, {}, now), 'kayfabb-conceal').stopped, true, 'the default is 10');
  assert.equal(of(jobHealth(base, { 'kayfabb-conceal': 30 }, now), 'kayfabb-conceal').stopped, false, 'the argument beats the default');
  const withRow = rows({ 'kayfabb-conceal': { grace: { 'kayfabb-conceal': 5 } } }, { lastOkAt: '2027-03-01T14:02:00Z' });
  assert.equal(of(jobHealth(withRow, { 'kayfabb-conceal': 30 }, now), 'kayfabb-conceal').stopped, true, "the row's beats the argument");
  const rowWide = rows({ 'kayfabb-conceal': { grace: { 'kayfabb-conceal': 60 } } }, { lastOkAt: '2027-03-01T14:02:00Z' });
  assert.equal(of(jobHealth(rowWide, { 'kayfabb-conceal': 1 }, now), 'kayfabb-conceal').stopped, false);
});

test('a schedule the engine cannot read reads scheduled and stopped with no missed run, and says unreadable', () => {
  for (const schedule of ['30 seconds', '0 0 $ * *']) {
    const rs = rows({ 'kayfabb-mail': { schedule } });
    const h = of(jobHealth(rs, {}, at('2027-03-01T14:02:30')), 'kayfabb-mail');
    assert.deepEqual([h.scheduled, h.stopped, h.missed, h.missedRuns, h.unreadable], [true, true, null, 0, true], schedule);
  }
  const fine = of(jobHealth(rows(), {}, at('2027-03-01T14:02:30')), 'kayfabb-mail');
  assert.equal(fine.unreadable, false);
  const off = of(jobHealth(rows({ 'kayfabb-mail': { schedule: null } }), {}, at('2027-03-01T14:02:30')), 'kayfabb-mail');
  assert.equal(off.unreadable, false);
});

test('an unparseable since reads like no reference: scheduled and stopped, not unreadable', () => {
  for (const over of [{ lastOkAt: 'not a time' }, { lastOkAt: null, firstSeen: 'yesterday-ish' }]) {
    const h = of(jobHealth(rows({ 'kayfabb-mail': over }), {}, at('2027-03-01T14:02:30')), 'kayfabb-mail');
    assert.deepEqual([h.scheduled, h.stopped, h.missed, h.missedRuns, h.unreadable], [true, true, null, 0, false]);
  }
});

test('at may carry seconds: the bound is not rounded to the minute', () => {
  const rs = rows({}, { lastOkAt: '2027-03-01T14:02:00Z' });
  // Due each minute, grace 10: at 14:12:59.999 the bound is 14:02:59, latest due 14:02, running; at 14:13:00 stopped.
  assert.equal(of(jobHealth(rs, {}, new Date('2027-03-01T14:12:59.999Z')), 'kayfabb-conceal').stopped, false);
  assert.equal(of(jobHealth(rs, {}, new Date('2027-03-01T14:13:30Z')), 'kayfabb-conceal').stopped, true);
  assert.equal(of(jobHealth(rs, {}, new Date('2027-03-01T14:13:30Z')), 'kayfabb-conceal').missedRuns, 1);
});

test('a missed count below the cap is exact', () => {
  const rs = rows({}, { lastOkAt: '2027-03-01T14:00:00Z' });
  // Latest due at 14:15 - 10 = 14:05; due 14:01..14:05 is five.
  const h = of(jobHealth(rs, {}, at('2027-03-01T14:15:00')), 'kayfabb-conceal');
  assert.equal(h.missedRuns, 5);
  const three = of(jobHealth(rs, {}, at('2027-03-01T14:13:00')), 'kayfabb-conceal');
  assert.equal(three.missedRuns, 3);
});

test('a schedule firing less often than once in 366 days is never read as stopped', () => {
  const rs = rows({ 'kayfabb-meet': { schedule: '0 0 29 2 *', lastOkAt: '2027-01-01T00:00:00Z' } });
  const h = of(jobHealth(rs, {}, at('2029-06-01T00:00:00')), 'kayfabb-meet');
  assert.deepEqual([h.stopped, h.unreadable], [false, false]);
});
