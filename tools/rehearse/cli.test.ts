// parseArgs is pure: it turns argv into the run's options or a refusal that says why. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli.ts";
import type { Scenario } from "../../engine/rehearsal/types.ts";

const base: Scenario = {
  key: "tiny", seed: 1, players: 4, charactersPerPlayer: { least: 2, most: 3 }, startThreads: 2, backstoryDays: 1,
  dayOfSeason: 5, days: 7, postsPerDay: { least: 5, most: 10 }, reactionsPerPost: { least: 0, most: 2 }, costCapDollars: 5,
};
const known = [base, { ...base, key: "other" }];

test("a scenario alone runs in record mode with its own values", () => {
  const r = parseArgs(["tiny"], known);
  assert.ok(r.ok);
  assert.equal(r.mode, "record");
  assert.deepEqual(r.scenario, base);
  assert.equal(r.keep, false);
  assert.equal(r.profile, undefined);
});

test("the mode flags pick the mode, and only one may be given", () => {
  for (const [flag, mode] of [["--stub", "stub"], ["--offline", "offline"], ["--fresh", "fresh"]] as const) {
    const r = parseArgs(["tiny", flag], known);
    assert.ok(r.ok && r.mode === mode);
  }
  const two = parseArgs(["tiny", "--stub", "--fresh"], known);
  assert.ok(!two.ok);
  assert.match(two.error, /one of --stub, --offline, --fresh/);
});

test("--days, --seed, --cap and --profile override the scenario", () => {
  const r = parseArgs(["tiny", "--days", "2", "--seed", "9", "--cap", "0.5", "--profile", "playtest", "--keep"], known);
  assert.ok(r.ok);
  assert.equal(r.scenario.days, 2);
  assert.equal(r.scenario.seed, 9);
  assert.equal(r.scenario.costCapDollars, 0.5);
  assert.equal(r.scenario.profile, "playtest");
  assert.equal(r.profile, "playtest");
  assert.equal(r.keep, true);
});

test("any scenario field is a flag; a range is least-most, and one number means both ends", () => {
  const r = parseArgs(["tiny", "--players", "6", "--postsPerDay", "1-3", "--reactionsPerPost", "2"], known);
  assert.ok(r.ok);
  assert.equal(r.scenario.players, 6);
  assert.deepEqual(r.scenario.postsPerDay, { least: 1, most: 3 });
  assert.deepEqual(r.scenario.reactionsPerPost, { least: 2, most: 2 });
});

test("an unknown scenario lists the known ones", () => {
  const r = parseArgs(["nope"], known);
  assert.ok(!r.ok);
  assert.match(r.error, /Unknown scenario "nope"/);
  assert.match(r.error, /tiny/);
  assert.match(r.error, /other/);
  const none = parseArgs([], known);
  assert.ok(!none.ok);
  assert.match(none.error, /tiny/);
});

test("an unknown flag, a missing value and a bad number are refused with the usage", () => {
  for (const argv of [["tiny", "--bogus"], ["tiny", "--days"], ["tiny", "--days", "x"], ["tiny", "--postsPerDay", "3-1"], ["tiny", "--profile", "other"], ["tiny", "--key", "z"], ["tiny", "extra"]]) {
    const r = parseArgs(argv, known);
    assert.ok(!r.ok, argv.join(" "));
    assert.match(r.error, /Usage: npm run rehearse/);
  }
});

test("--strong and --light name a model each, and a tier left out stays out", () => {
  const both = parseArgs(["tiny", "--strong", "claude-opus-5-5", "--light", "claude-haiku-5-5"], known);
  assert.ok(both.ok);
  assert.deepEqual(both.tiers, { strong: "claude-opus-5-5", light: "claude-haiku-5-5" });
  const one = parseArgs(["tiny", "--light", "claude-sonnet-5-5"], known);
  assert.ok(one.ok);
  assert.deepEqual(one.tiers, { light: "claude-sonnet-5-5" });
  const none = parseArgs(["tiny"], known);
  assert.ok(none.ok);
  assert.deepEqual(none.tiers, {});
});

test("a model the price table does not list is refused with the list", () => {
  for (const argv of [["tiny", "--strong", "gpt-9"], ["tiny", "--light", "claude-opus-4"], ["tiny", "--strong"]]) {
    const r = parseArgs(argv, known);
    assert.ok(!r.ok, argv.join(" "));
    assert.match(r.error, /--(strong|light)/);
  }
  const r = parseArgs(["tiny", "--strong", "gpt-9"], known);
  assert.ok(!r.ok);
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) assert.match(r.error, new RegExp(m));
});
