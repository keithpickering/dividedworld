// The dispatcher: takes net.http_request_queue rows in id order, once each, and hands each to the scheduled function's
// handler as a Request. A fake queue and fake handlers here; the real handlers are Task 1's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { instance as dividedWorld } from "../../supabase/functions/_shared/instance.ts";
import { fakeDeps, KEY } from "../../supabase/functions/_shared/handler-test-kit.ts";
import { drain, REAL, Stalled, UnknownFunction, type DispatchCtx, type QueueRow } from "./dispatch.ts";

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

test("write is a function the dispatcher knows, and one that calls a model: handed over, and skipped at the cost cap", async () => {
  const open = setup([row(1, "write", {})]);
  open.ctx.handlers!.write = async () => new Response("{}", { status: 200 });
  await drain(open.ctx);
  assert.deepEqual(open.ctx.dispatched.map((d) => [d.function, d.status]), [["write", 200]]);
  const capped = setup([row(1, "write", {})], true);
  capped.ctx.handlers!.write = async () => { throw new Error("called past the cap"); };
  await drain(capped.ctx);
  assert.deepEqual(capped.ctx.dispatched.map((d) => [d.function, d.skipped ?? null]), [["write", "cost cap"]]);
  assert.ok(REAL.includes("write"), "the real set holds it, so a rehearsal's sweep is served");
});

test("a handler that never answers stops the run with Stalled naming the function and the request", async () => {
  const { ctx } = setup([row(7, "settle")]);
  ctx.handlers!.settle = () => new Promise<Response>(() => {});
  ctx.stallMs = 30;
  await assert.rejects(() => drain(ctx), (e: unknown) => e instanceof Stalled && /the settle function \(request 7\) has not answered/.test((e as Error).message));
});

test("a path named like an Object property (constructor) is unknown, not resolved", async () => {
  const { ctx } = setup([row(1, "constructor")]);
  await assert.rejects(() => drain(ctx), (e: unknown) => e instanceof UnknownFunction);
});

test("mail is handled by the real mail core with a recording mailer: the row is answered sent, nothing real is sent, and a null admin address makes it wait", async () => {
  const outbox = { id: 5, account: "acct-1", template: "banned", facts: { post: "/p/1", thread: "/t/1", section: "x", note: "n", conduct: "/conduct" }, bar: { outcome: "ban", until: null } };
  for (const adminAddress of ["admin@example.test", null]) {
    // The kit answers instance_settings itself, so the conduct setting rides in on the db it hands out.
    const kit = fakeDeps((fn) => (fn === "mail_due" ? [outbox] : null));
    const db = { rpc: async <T>(fn: string, args: Record<string, unknown>): Promise<T> => (fn === "instance_settings" ? { economy: dividedWorld.settings.economy, conduct: { ...dividedWorld.settings.conduct, adminAddress } } as T : kit.deps.db({} as never).rpc<T>(fn, args)) };
    const calls = { ...kit, deps: { ...kit.deps, db: () => db } };
    const ctx: DispatchCtx = {
      connection: { async sql(_t: string, p?: unknown[]) { return Number(p?.[0] ?? 0) < 1 ? ([{ id: 1, method: "POST", url: "https://x.supabase.co/functions/v1/mail", headers: { apikey: KEY }, body: {} }] as unknown as Record<string, unknown>[]) : []; } },
      deps: { ...calls.deps, fetch: (async () => { throw new Error("the rehearsal's mail must not touch the network"); }) as typeof fetch },
      cap: { reached: () => true }, // mail calls no model: the cost cap never holds it
      lastDrained: 0,
      dispatched: [],
    };
    await drain(ctx);
    const d = ctx.dispatched[0]!;
    assert.equal(d.function, "mail");
    assert.equal(d.status, 200);
    const body = d.body as { status: string; sent?: number; recorded?: { sent: { to: string; replyTo: string | null; idempotencyKey: string }[]; bans: unknown[] } };
    if (adminAddress === null) {
      assert.equal(body.status, "waiting for the admin address");
      assert.equal(calls.calls.filter((c) => c.fn === "record_mail_attempt").length, 0, "nothing is recorded while mail waits");
    } else {
      assert.equal(body.status, "done");
      assert.equal(body.sent, 1);
      assert.deepEqual(body.recorded!.sent.map((m) => [m.to, m.replyTo, m.idempotencyKey]), [["acct-1@rehearsal.invalid", "admin@example.test", "kayfabb-mail-5"]]);
      assert.deepEqual(body.recorded!.bans, [{ account: "acct-1", action: "ban", until: null }]);
      assert.equal(calls.calls.filter((c) => c.fn === "record_mail_attempt" && c.args.kind === "sent").length, 1);
    }
  }
  assert.ok(REAL.includes("mail"));
});
