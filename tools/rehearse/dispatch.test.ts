// The dispatcher: takes net.http_request_queue rows in id order, once each, and hands each to the scheduled function's
// handler as a Request. A fake queue and fake handlers here; the real handlers are Task 1's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drain, UnknownFunction, type DispatchCtx, type QueueRow } from "./dispatch.ts";

function setup(rows: QueueRow[], capped = false) {
  const seen: { name: string; body: unknown; auth: string | null; method: string }[] = [];
  const queue = [...rows];
  const handler = (name: string) => async (req: Request) => {
    seen.push({ name, body: await req.json(), auth: req.headers.get("apikey"), method: req.method });
    return new Response(JSON.stringify({ ran: name }), { status: 200 });
  };
  const ctx: DispatchCtx = {
    connection: {
      // Stands in for `select ... from net.http_request_queue where id > $1 order by id`.
      async sql(_text: string, params?: unknown[]) {
        const after = Number(params?.[0] ?? 0);
        return queue.filter((r) => r.id > after).sort((a, b) => a.id - b.id) as unknown as Record<string, unknown>[];
      },
    },
    deps: {} as DispatchCtx["deps"],
    cap: { reached: () => capped },
    handlers: { meet: handler("meet"), chatter: handler("chatter"), staff: handler("staff"), settle: handler("settle") },
    lastDrained: 0,
    dispatched: [],
  };
  return { ctx, seen, queue };
}
const row = (id: number, name: string, body: unknown = { slot: "s" }): QueueRow => ({
  id, method: "POST", url: `https://x.supabase.co/functions/v1/${name}`, headers: { apikey: "k", "Content-Type": "application/json" }, body,
});

test("requests are handed over in id order, once each", async () => {
  const { ctx, seen, queue } = setup([row(3, "settle"), row(1, "meet"), row(2, "staff")]);
  await drain(ctx);
  assert.deepEqual(seen.map((s) => s.name), ["meet", "staff", "settle"]);
  assert.equal(seen[0]!.auth, "k");
  assert.equal(seen[0]!.method, "POST");
  assert.deepEqual(seen[0]!.body, { slot: "s" });
  await drain(ctx);
  assert.equal(seen.length, 3, "a second drain hands over nothing again");
  queue.push(row(4, "chatter"));
  await drain(ctx);
  assert.deepEqual(seen.map((s) => s.name), ["meet", "staff", "settle", "chatter"]);
  assert.deepEqual(ctx.dispatched.map((d) => [d.function, d.status]), [["meet", 200], ["staff", 200], ["settle", 200], ["chatter", 200]]);
  assert.deepEqual(ctx.dispatched[0]!.body, { ran: "meet" });
});

test("poison: a path with no handler throws UnknownFunction naming it", async () => {
  const { ctx, seen } = setup([row(1, "meet"), row(2, "mystery")]);
  await assert.rejects(() => drain(ctx), (e: unknown) => e instanceof UnknownFunction && /mystery/.test((e as Error).message));
  assert.deepEqual(seen.map((s) => s.name), ["meet"], "the run stops at it");
});

test("a capped model function is skipped and recorded; settle still runs", async () => {
  const { ctx, seen } = setup([row(1, "meet"), row(2, "chatter"), row(3, "staff"), row(4, "settle")], true);
  await drain(ctx);
  assert.deepEqual(seen.map((s) => s.name), ["settle"]);
  assert.deepEqual(ctx.dispatched.map((d) => [d.function, d.skipped ?? null]), [["meet", "cost cap"], ["chatter", "cost cap"], ["staff", "cost cap"], ["settle", null]]);
  assert.equal(ctx.lastDrained, 4);
});

test("a path named like an Object property (constructor) is unknown, not resolved", async () => {
  const { ctx } = setup([row(1, "constructor")]);
  await assert.rejects(() => drain(ctx), (e: unknown) => e instanceof UnknownFunction);
});
