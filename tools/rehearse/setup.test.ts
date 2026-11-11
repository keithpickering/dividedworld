// The timeline and the calendar arithmetic, with no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSpan, timeline } from "./setup.ts";
import { rehearsedInstance } from "./instance.ts";
import { DAY_MS } from "../../engine/rehearsal/generate.ts";
import type { Scenario } from "../../engine/rehearsal/types.ts";

const { instance, content } = rehearsedInstance();
const named = (key: string): Scenario => content.scenarios.find((s) => s.key === key)!;
const base: Scenario = { ...named("small-circle-reign") };

test("day 30: day 1 is the season's 30th day, and backstory comes before it", () => {
  const tl = timeline({ ...base, dayOfSeason: 30, backstoryDays: 3 }, instance);
  assert.equal(tl.day1, tl.seasonStart + 29 * DAY_MS);
  assert.equal(tl.clusterStart, tl.day1 - 3 * DAY_MS);
  assert.equal(tl.day1 % DAY_MS, 0);
});

test("day 1: day 1 is the season's start", () => {
  const tl = timeline({ ...base, dayOfSeason: 1 }, instance);
  assert.equal(tl.day1, tl.seasonStart);
});

test("day 83 (meltdown-handover): day 1 is exactly eight days before the season's end", () => {
  const tl = timeline(named("meltdown-handover"), instance);
  assert.equal(tl.seasonEnd - tl.day1, 8 * DAY_MS);
});

test("a day past the season's end is refused", () => {
  assert.throws(() => timeline({ ...base, dayOfSeason: 91 }, instance), /season is 90 days/);
});

test("a month added to Jan 31 is clamped to the month's end, as Postgres does it", () => {
  assert.equal(addSpan(Date.UTC(2027, 0, 31), { unit: "month", count: 1 }), Date.UTC(2027, 1, 28));
  assert.equal(addSpan(Date.UTC(2028, 0, 31), { unit: "month", count: 1 }), Date.UTC(2028, 1, 29));
  assert.equal(addSpan(Date.UTC(2027, 0, 1), { unit: "month", count: 3 }), Date.UTC(2027, 3, 1));
  assert.equal(addSpan(Date.UTC(2027, 0, 1), { unit: "week", count: 3 }), Date.UTC(2027, 0, 22));
});
