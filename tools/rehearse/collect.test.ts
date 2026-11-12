// The collector's two pure joins: a call to the Act it produced, and a ledger row to the call that made it. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MEETING_PARTS } from "../../engine/system/meeting.ts";
import { meetingParts, pairLedger, takeCall } from "./collect.ts";
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

// A meeting's parts come from its record; each takes the kept call that asked for it, matched on the ask the call's last message ends with.
const asks = Object.fromEntries(MEETING_PARTS.map((p) => [p.key, p.ask]));
const meetingCall = (key: string, at: number, over: Partial<KeptCall> = {}): KeptCall =>
  kept("meeting", null, at, { request: { system: `SYS-${key}`, messages: [{ role: "user", content: "earlier" }, { role: "user", content: `Context. ${asks[key]}` }], meeting: 1 } as unknown as KeptCall["request"], value: { answered: key }, ...over });

test("a part the call was not kept for shows its own error, and the other parts keep their own calls", () => {
  const staff = meetingCall("staff", 2000);
  const self = meetingCall("self", 3000, { replayed: true });
  const record = { parts: [{ part: "moves", outcome: "failed", error: "TRANSPORT-BOOM" }, { part: "staff", outcome: "ok" }, { part: "self", outcome: "ok" }] };
  const parts = meetingParts(record, [staff, self]);
  assert.deepEqual(parts.map((p) => [p.part, p.outcome]), [["moves", "failed"], ["staff", "ok"], ["self", "ok"]]);
  assert.equal(parts[0]!.error, "TRANSPORT-BOOM");
  assert.equal(parts[0]!.sent, null);
  assert.equal(parts[0]!.answer, null);
  assert.equal(parts[0]!.replayed, null);
  assert.equal(parts[1]!.sent?.system, "SYS-staff");
  assert.deepEqual(parts[1]!.answer, { answered: "staff" });
  assert.equal(parts[2]!.sent?.system, "SYS-self");
  assert.equal(parts[2]!.replayed, true);
});

test("a record with no parts gives one unknown entry per kept call, never an invented part or outcome", () => {
  const a = meetingCall("moves", 1000);
  const b = meetingCall("staff", 2000, { error: { message: "NOPE", predicate: "p" }, value: undefined });
  for (const record of [null, {}, { parts: [] }]) {
    const parts = meetingParts(record, [a, b]);
    assert.deepEqual(parts.map((p) => [p.part, p.outcome]), [["unknown", "unknown"], ["unknown", "unknown"]]);
    assert.equal(parts[0]!.error, null);
    assert.equal(parts[1]!.error, "NOPE");
    assert.equal(parts[0]!.sent?.system, "SYS-moves");
  }
});

test("three ok parts each take their own call, whatever order the calls come in", () => {
  const calls = [meetingCall("self", 3000), meetingCall("moves", 1000), meetingCall("staff", 2000)];
  const record = { parts: MEETING_PARTS.map((p) => ({ part: p.key, outcome: "ok" })) };
  const parts = meetingParts(record, calls);
  assert.deepEqual(parts.map((p) => p.sent?.system), ["SYS-moves", "SYS-staff", "SYS-self"]);
  assert.deepEqual(parts.map((p) => p.answer), [{ answered: "moves" }, { answered: "staff" }, { answered: "self" }]);
});
