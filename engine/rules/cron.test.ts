// The cron matcher: the five-field grammar engine/rules/instance.ts accepts, read in UTC as pg_cron reads it.
// The list below is every schedule the migrations and instances/divided-world/settings.ts use today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastDue, matches, nextDue, parseCron } from './cron.ts';

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo - 1, d, h, mi));

test('* * * * * (system tick, search rebuild) matches every minute', () => {
  assert.ok(matches('* * * * *', at(2027, 3, 1, 9, 0)));
  assert.ok(matches('* * * * *', at(2027, 3, 1, 23, 59)));
});
test('*/5 * * * * (filingCron) matches on multiples of five', () => {
  assert.ok(matches('*/5 * * * *', at(2027, 3, 1, 9, 0)));
  assert.ok(matches('*/5 * * * *', at(2027, 3, 1, 9, 55)));
  assert.ok(!matches('*/5 * * * *', at(2027, 3, 1, 9, 3)));
});
test('23 9 * * * (meetingCron) and 37 17 * * * (chatterCron) and 17 8 * * * (settlementCron)', () => {
  assert.ok(matches('23 9 * * *', at(2027, 3, 1, 9, 23)));
  assert.ok(!matches('23 9 * * *', at(2027, 3, 1, 9, 24)));
  assert.ok(!matches('23 9 * * *', at(2027, 3, 1, 10, 23)));
  assert.ok(matches('37 17 * * *', at(2027, 3, 1, 17, 37)));
  assert.ok(matches('17 8 * * *', at(2027, 3, 1, 8, 17)));
});
test('41 * * * * (viewCountCron) matches minute 41 of every hour', () => {
  assert.ok(matches('41 * * * *', at(2027, 3, 1, 0, 41)));
  assert.ok(matches('41 * * * *', at(2027, 3, 1, 13, 41)));
  assert.ok(!matches('41 * * * *', at(2027, 3, 1, 13, 40)));
});
test('ranges, lists and steps with a start', () => {
  assert.ok(matches('0 9-17 * * *', at(2027, 3, 1, 12, 0)));
  assert.ok(!matches('0 9-17 * * *', at(2027, 3, 1, 18, 0)));
  assert.ok(matches('5,10,15 * * * *', at(2027, 3, 1, 1, 10)));
  assert.ok(!matches('5,10,15 * * * *', at(2027, 3, 1, 1, 11)));
  assert.ok(matches('10-30/10 * * * *', at(2027, 3, 1, 1, 20)));
  assert.ok(!matches('10-30/10 * * * *', at(2027, 3, 1, 1, 25)));
  assert.ok(matches('5/20 * * * *', at(2027, 3, 1, 1, 45)));
  assert.ok(!matches('5/20 * * * *', at(2027, 3, 1, 1, 0)));
});
test('day of week: 0 and 7 are both Sunday', () => {
  const sunday = at(2027, 3, 7, 0, 0);
  assert.equal(sunday.getUTCDay(), 0);
  assert.ok(matches('0 0 * * 0', sunday));
  assert.ok(matches('0 0 * * 7', sunday));
  assert.ok(!matches('0 0 * * 1', sunday));
  assert.ok(matches('0 0 * * 1-5', at(2027, 3, 1, 0, 0)));
});
test('day of month and day of week: when both are restricted, either is enough', () => {
  // 2027-03-01 is a Monday. "the 15th or a Monday"
  assert.ok(matches('0 0 15 * 1', at(2027, 3, 1, 0, 0)), 'Monday, not the 15th');
  assert.ok(matches('0 0 15 * 1', at(2027, 3, 15, 0, 0)), 'the 15th (a Monday too)');
  assert.ok(matches('0 0 15 * 1', at(2027, 3, 16, 0, 0)) === false, 'Tuesday the 16th');
  assert.ok(matches('0 0 16 * 1', at(2027, 3, 16, 0, 0)), 'the 16th, not a Monday');
  // Only one restricted: it alone decides.
  assert.ok(!matches('0 0 15 * *', at(2027, 3, 1, 0, 0)));
  assert.ok(!matches('0 0 * * 1', at(2027, 3, 2, 0, 0)));
  assert.ok(matches('0 0 1 3 *', at(2027, 3, 1, 0, 0)));
  assert.ok(!matches('0 0 1 4 *', at(2027, 3, 1, 0, 0)));
});
test('a malformed expression throws rather than matching', () => {
  assert.throws(() => matches('* * * *', new Date()), /five fields/);
  assert.throws(() => matches('61 * * * *', new Date()), /minute/);
  assert.throws(() => matches('MON * * * *', new Date()));
});

test('day of week with a step and 7 inside a range', () => {
  const sun = at(2027, 3, 7, 0, 0), mon = at(2027, 3, 1, 0, 0), tue = at(2027, 3, 2, 0, 0);
  assert.ok(matches('0 0 * * 1-7', sun) && matches('0 0 * * 1-7', mon), '1-7 covers Sunday as 7');
  assert.ok(matches('0 0 * * */2', sun), '*/2 is 0,2,4,6');
  assert.ok(matches('0 0 * * */2', tue));
  assert.ok(!matches('0 0 * * */2', mon));
  assert.ok(matches('0 0 * * 5-7', sun));
  assert.ok(!matches('0 0 * * 5-7', mon));
});
test('day of month with a step', () => {
  assert.ok(matches('0 0 */10 * *', at(2027, 3, 11, 0, 0)));
  assert.ok(matches('0 0 */10 * *', at(2027, 3, 1, 0, 0)), '*/10 from 1: 1, 11, 21, 31');
  assert.ok(!matches('0 0 */10 * *', at(2027, 3, 10, 0, 0)));
});
test('a field starting with * counts as unrestricted for the either-rule (vixie cron, pg_cron)', () => {
  // 2027-03-01 is a Monday; dom */10 matches 1, 11, 21, 31, and dow is restricted to Mondays. Starting with `*`, dom is
  // unrestricted, so both must match (and): Monday the 8th fails, Monday the 1st passes, a non-Monday the 11th fails.
  assert.ok(matches('0 0 */10 * 1', at(2027, 3, 1, 0, 0)));
  assert.ok(!matches('0 0 */10 * 1', at(2027, 3, 8, 0, 0)));
  assert.ok(!matches('0 0 */10 * 1', at(2027, 3, 11, 0, 0)));
  // Same for dow */2 with a restricted dom: both must match.
  assert.ok(matches('0 0 7 * */2', at(2027, 3, 7, 0, 0)), 'the 7th is a Sunday');
  assert.ok(!matches('0 0 8 * */2', at(2027, 3, 8, 0, 0)), 'the 8th is a Monday');
});

// lastDue: the latest minute <= at the expression matches.
const iso = (d: Date | null) => (d === null ? null : d.toISOString());
test('lastDue: every minute is the minute itself, seconds dropped', () => {
  assert.equal(iso(lastDue('* * * * *', new Date(Date.UTC(2027, 2, 1, 9, 5, 42)))), '2027-03-01T09:05:00.000Z');
});
test('lastDue: */5 and 41 * * * *', () => {
  assert.equal(iso(lastDue('*/5 * * * *', at(2027, 3, 1, 9, 58))), '2027-03-01T09:55:00.000Z');
  assert.equal(iso(lastDue('41 * * * *', at(2027, 3, 1, 9, 40))), '2027-03-01T08:41:00.000Z');
  assert.equal(iso(lastDue('41 * * * *', at(2027, 3, 1, 0, 40))), '2027-02-28T23:41:00.000Z');
});
test('lastDue: a daily schedule, before and after the time on the same day', () => {
  assert.equal(iso(lastDue('17 8 * * *', at(2027, 3, 1, 8, 16))), '2027-02-28T08:17:00.000Z');
  assert.equal(iso(lastDue('17 8 * * *', at(2027, 3, 1, 8, 18))), '2027-03-01T08:17:00.000Z');
  assert.equal(iso(lastDue('17 8 * * *', at(2027, 3, 1, 23, 59))), '2027-03-01T08:17:00.000Z');
});
test('lastDue: a daily schedule across a month end', () => {
  assert.equal(iso(lastDue('23 9 * * *', at(2027, 3, 1, 9, 22))), '2027-02-28T09:23:00.000Z');
  assert.equal(iso(lastDue('23 9 * * *', at(2027, 5, 1, 0, 0))), '2027-04-30T09:23:00.000Z');
});
test('lastDue: a leap day is found four years back or is null within 366 days', () => {
  assert.equal(iso(lastDue('0 0 29 2 *', at(2028, 3, 1, 0, 0))), '2028-02-29T00:00:00.000Z');
  assert.equal(iso(lastDue('0 0 29 2 *', at(2029, 3, 2, 0, 0))), null, '367 days on');
  assert.equal(iso(lastDue('0 0 29 2 *', at(2029, 3, 1, 0, 0))), '2028-02-29T00:00:00.000Z', '366 days on is still in reach');
});
test('lastDue: both day fields restricted, either matches', () => {
  // 2027-03-16 is a Tuesday and the 15th a Monday: on the 16th the latest "15th or a Monday" is the 15th.
  assert.equal(iso(lastDue('0 0 15 * 1', at(2027, 3, 16, 12, 0))), '2027-03-15T00:00:00.000Z');
  // 2027-03-12 is a Friday; "the 10th or a Monday": Monday the 8th.
  assert.equal(iso(lastDue('0 0 10 * 1', at(2027, 3, 12, 12, 0))), '2027-03-10T00:00:00.000Z');
  assert.equal(iso(lastDue('0 0 10 * 1', at(2027, 3, 9, 12, 0))), '2027-03-08T00:00:00.000Z');
});
test('lastDue: at exactly on a due minute is that minute', () => {
  assert.equal(iso(lastDue('17 8 * * *', at(2027, 3, 1, 8, 17))), '2027-03-01T08:17:00.000Z');
  assert.equal(iso(lastDue('*/5 * * * *', at(2027, 3, 1, 9, 55))), '2027-03-01T09:55:00.000Z');
});
test('lastDue: a malformed expression throws', () => {
  assert.throws(() => lastDue('* * * *', new Date()), /five fields/);
});

test('nextDue: strictly after, across a day and a month end, and null past 366 days', () => {
  assert.equal(iso(nextDue('17 8 * * *', at(2027, 3, 1, 8, 17))), '2027-03-02T08:17:00.000Z');
  assert.equal(iso(nextDue('17 8 * * *', at(2027, 3, 1, 8, 16))), '2027-03-01T08:17:00.000Z');
  assert.equal(iso(nextDue('* * * * *', new Date(Date.UTC(2027, 2, 1, 9, 5, 42)))), '2027-03-01T09:06:00.000Z');
  assert.equal(iso(nextDue('23 9 * * *', at(2027, 2, 28, 9, 23))), '2027-03-01T09:23:00.000Z');
  assert.equal(iso(nextDue('0 0 29 2 *', at(2027, 3, 1, 0, 0))), '2028-02-29T00:00:00.000Z');
  assert.equal(iso(nextDue('0 0 29 2 *', at(2028, 3, 1, 0, 0))), null, 'the next is four years on');
});

test('nextDue: across a month end and with the either-rule', () => {
  assert.equal(iso(nextDue('30 23 * * *', at(2027, 2, 28, 23, 30))), '2027-03-01T23:30:00.000Z');
  assert.equal(iso(nextDue('0 0 1 * *', at(2027, 1, 31, 12, 0))), '2027-02-01T00:00:00.000Z');
  assert.equal(iso(nextDue('0 0 1 * *', at(2027, 2, 28, 12, 0))), '2027-03-01T00:00:00.000Z');
  // "the 10th or a Monday": after Friday 2027-03-05 the next is Monday the 8th, then the 10th, then Monday the 15th.
  assert.equal(iso(nextDue('0 0 10 * 1', at(2027, 3, 5, 12, 0))), '2027-03-08T00:00:00.000Z');
  assert.equal(iso(nextDue('0 0 10 * 1', at(2027, 3, 8, 0, 0))), '2027-03-10T00:00:00.000Z');
  assert.equal(iso(nextDue('0 0 10 * 1', at(2027, 3, 10, 0, 0))), '2027-03-15T00:00:00.000Z');
});

test('a parsed schedule is accepted wherever an expression is, and reads the same', () => {
  const p = parseCron('17 8 * * *');
  assert.equal(iso(lastDue(p, at(2027, 3, 1, 8, 18))), iso(lastDue('17 8 * * *', at(2027, 3, 1, 8, 18))));
  assert.equal(iso(nextDue(p, at(2027, 3, 1, 8, 17))), '2027-03-02T08:17:00.000Z');
  assert.ok(matches(p, at(2027, 3, 1, 8, 17)));
  assert.throws(() => parseCron('30 seconds'), /five fields/);
  assert.throws(() => parseCron('0 0 $ * *'));
});
