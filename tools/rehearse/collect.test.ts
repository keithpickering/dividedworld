// The collector's two pure joins: a call to the Act it produced, and a ledger row to the call that made it. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pairLedger, takeCall } from "./collect.ts";
import type { KeptCall } from "./models.ts";

const MIN = 60_000;
const kept = (duty: string, staff: string | null, at: number, over: Partial<KeptCall> = {}): KeptCall =>
  ({ at, duty, staff, key: `${duty}${at}`, replayed: false, request: { duty } as KeptCall["request"], trims: [], cost: 0, ...over });

test("a call attaches to the Act made at or just after it, in its own duty and Mod", () => {
  const calls = [kept("chatter", "a", 1000), kept("chatter", "b", 1500), kept("filing", null, 1000)];
  const used = new Set<KeptCall>();
  assert.equal(takeCall(calls, used, "chatter", "b", 2000), calls[1]);
  assert.equal(takeCall(calls, used, "chatter", "b", 2000), null, "a call attaches once");
  assert.equal(takeCall(calls, used, "chatter", null, 2000), calls[0], "no Mod named: any Mod of the duty");
});

test("an Act with no call nearby shows none; a call after the Act, or past the bound, never attaches", () => {
  const calls = [kept("chatter", "a", 10 * MIN), kept("chatter", "a", 100 * MIN)];
  const used = new Set<KeptCall>();
  assert.equal(takeCall(calls, used, "chatter", "a", 5 * MIN), null, "the call is after the Act");
  assert.equal(takeCall(calls, used, "chatter", "a", 20 * MIN), null, "the call is more than two minutes before");
  assert.equal(takeCall(calls, used, "chatter", "a", 10 * MIN + 90_000), calls[0]);
});

test("a dropped call does not attach to a later Act", () => {
  const dropped = kept("patrolJudge", "a", 10 * MIN, { error: { message: "no", predicate: "p" } });
  const used = new Set<KeptCall>();
  assert.equal(takeCall([dropped], used, "patrolJudge", "a", 30 * MIN), null);
});

test("ledger rows pair with calls by duty, Mod and meeting, within a tick; a key whose counts differ is one note", () => {
  const calls = [kept("chatter", "a", 1000), kept("chatter", "a", 2000), kept("filing", null, 3000)];
  const row = (id: number, duty: string, staff: string | null, ms: number) => ({ id, ms, duty, staff, meeting: null, cost: 5 });
  const r = pairLedger([row(1, "chatter", "a", 1100), row(2, "chatter", "a", 2100), row(3, "chatter", "a", 2200), row(4, "chatter", "a", 2300), row(5, "patrolJudge", "b", 500)], calls);
  assert.equal(r.pairs.get(calls[0]!)?.id, 1);
  assert.equal(r.pairs.get(calls[1]!)?.id, 2);
  assert.deepEqual(r.unmatched.map((x) => x.id), [3, 4, 5]);
  assert.equal(r.notes.length, 3, r.notes.join("\n"));
  assert.ok(r.notes.some((n) => n.includes("chatter") && n.includes("4 ledger rows") && n.includes("2 kept calls")), r.notes.join("\n"));
  assert.ok(r.notes.some((n) => n.includes("filing") && n.includes("no ledger row")));
});

test("a row far from every call in its key is unmatched", () => {
  const calls = [kept("chatter", "a", 0)];
  const r = pairLedger([{ id: 1, ms: 10 * MIN, duty: "chatter", staff: "a", meeting: null, cost: 1 }], calls);
  assert.equal(r.pairs.size, 0);
  assert.equal(r.unmatched.length, 1);
});
