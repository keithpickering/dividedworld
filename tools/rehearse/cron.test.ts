// The cron matcher: the five-field grammar engine/rules/instance.ts accepts, read in UTC as pg_cron reads it.
// The list below is every schedule the migrations and instances/divided-world/settings.ts use today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "./cron.ts";

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo - 1, d, h, mi));

test("* * * * * (system tick, search rebuild) matches every minute", () => {
  assert.ok(matches("* * * * *", at(2027, 3, 1, 9, 0)));
  assert.ok(matches("* * * * *", at(2027, 3, 1, 23, 59)));
});
test("*/5 * * * * (filingCron) matches on multiples of five", () => {
  assert.ok(matches("*/5 * * * *", at(2027, 3, 1, 9, 0)));
  assert.ok(matches("*/5 * * * *", at(2027, 3, 1, 9, 55)));
  assert.ok(!matches("*/5 * * * *", at(2027, 3, 1, 9, 3)));
});
test("23 9 * * * (meetingCron) and 37 17 * * * (chatterCron) and 17 8 * * * (settlementCron)", () => {
  assert.ok(matches("23 9 * * *", at(2027, 3, 1, 9, 23)));
  assert.ok(!matches("23 9 * * *", at(2027, 3, 1, 9, 24)));
  assert.ok(!matches("23 9 * * *", at(2027, 3, 1, 10, 23)));
  assert.ok(matches("37 17 * * *", at(2027, 3, 1, 17, 37)));
  assert.ok(matches("17 8 * * *", at(2027, 3, 1, 8, 17)));
});
test("41 * * * * (viewCountCron) matches minute 41 of every hour", () => {
  assert.ok(matches("41 * * * *", at(2027, 3, 1, 0, 41)));
  assert.ok(matches("41 * * * *", at(2027, 3, 1, 13, 41)));
  assert.ok(!matches("41 * * * *", at(2027, 3, 1, 13, 40)));
});
test("ranges, lists and steps with a start", () => {
  assert.ok(matches("0 9-17 * * *", at(2027, 3, 1, 12, 0)));
  assert.ok(!matches("0 9-17 * * *", at(2027, 3, 1, 18, 0)));
  assert.ok(matches("5,10,15 * * * *", at(2027, 3, 1, 1, 10)));
  assert.ok(!matches("5,10,15 * * * *", at(2027, 3, 1, 1, 11)));
  assert.ok(matches("10-30/10 * * * *", at(2027, 3, 1, 1, 20)));
  assert.ok(!matches("10-30/10 * * * *", at(2027, 3, 1, 1, 25)));
  assert.ok(matches("5/20 * * * *", at(2027, 3, 1, 1, 45)));
  assert.ok(!matches("5/20 * * * *", at(2027, 3, 1, 1, 0)));
});
test("day of week: 0 and 7 are both Sunday", () => {
  const sunday = at(2027, 3, 7, 0, 0);
  assert.equal(sunday.getUTCDay(), 0);
  assert.ok(matches("0 0 * * 0", sunday));
  assert.ok(matches("0 0 * * 7", sunday));
  assert.ok(!matches("0 0 * * 1", sunday));
  assert.ok(matches("0 0 * * 1-5", at(2027, 3, 1, 0, 0)));
});
test("day of month and day of week: when both are restricted, either is enough", () => {
  // 2027-03-01 is a Monday. "the 15th or a Monday"
  assert.ok(matches("0 0 15 * 1", at(2027, 3, 1, 0, 0)), "Monday, not the 15th");
  assert.ok(matches("0 0 15 * 1", at(2027, 3, 15, 0, 0)), "the 15th (a Monday too)");
  assert.ok(matches("0 0 15 * 1", at(2027, 3, 16, 0, 0)) === false, "Tuesday the 16th");
  assert.ok(matches("0 0 16 * 1", at(2027, 3, 16, 0, 0)), "the 16th, not a Monday");
  // Only one restricted: it alone decides.
  assert.ok(!matches("0 0 15 * *", at(2027, 3, 1, 0, 0)));
  assert.ok(!matches("0 0 * * 1", at(2027, 3, 2, 0, 0)));
  assert.ok(matches("0 0 1 3 *", at(2027, 3, 1, 0, 0)));
  assert.ok(!matches("0 0 1 4 *", at(2027, 3, 1, 0, 0)));
});
test("a malformed expression throws rather than matching", () => {
  assert.throws(() => matches("* * * *", new Date()), /five fields/);
  assert.throws(() => matches("61 * * * *", new Date()), /minute/);
  assert.throws(() => matches("MON * * * *", new Date()));
});

test("day of week with a step and 7 inside a range", () => {
  const sun = at(2027, 3, 7, 0, 0), mon = at(2027, 3, 1, 0, 0), tue = at(2027, 3, 2, 0, 0);
  assert.ok(matches("0 0 * * 1-7", sun) && matches("0 0 * * 1-7", mon), "1-7 covers Sunday as 7");
  assert.ok(matches("0 0 * * */2", sun), "*/2 is 0,2,4,6");
  assert.ok(matches("0 0 * * */2", tue));
  assert.ok(!matches("0 0 * * */2", mon));
  assert.ok(matches("0 0 * * 5-7", sun));
  assert.ok(!matches("0 0 * * 5-7", mon));
});
test("day of month with a step", () => {
  assert.ok(matches("0 0 */10 * *", at(2027, 3, 11, 0, 0)));
  assert.ok(matches("0 0 */10 * *", at(2027, 3, 1, 0, 0)), "*/10 from 1: 1, 11, 21, 31");
  assert.ok(!matches("0 0 */10 * *", at(2027, 3, 10, 0, 0)));
});
test("a field starting with * counts as unrestricted for the either-rule (vixie cron, pg_cron)", () => {
  // 2027-03-01 is a Monday; dom */10 matches 1, 11, 21, 31, and dow is restricted to Mondays. Starting with `*`, dom is
  // unrestricted, so both must match (and): Monday the 8th fails, Monday the 1st passes, a non-Monday the 11th fails.
  assert.ok(matches("0 0 */10 * 1", at(2027, 3, 1, 0, 0)));
  assert.ok(!matches("0 0 */10 * 1", at(2027, 3, 8, 0, 0)));
  assert.ok(!matches("0 0 */10 * 1", at(2027, 3, 11, 0, 0)));
  // Same for dow */2 with a restricted dom: both must match.
  assert.ok(matches("0 0 7 * */2", at(2027, 3, 7, 0, 0)), "the 7th is a Sunday");
  assert.ok(!matches("0 0 8 * */2", at(2027, 3, 8, 0, 0)), "the 8th is a Monday");
});
