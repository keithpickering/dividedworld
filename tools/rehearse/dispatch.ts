// The dispatcher stands in for the Edge runtime. A job that calls a function leaves its request in the shim's
// net.http_request_queue; after each minute's jobs, `drain` takes every new request in id order and hands it, as a
// Request, to the same `handle` the deployed function runs (supabase/functions/<name>/handler.ts), with the
// rehearsal's JobDeps. A path with no handler stops the run and names the path, so a new function is never skipped.
import type { JobDeps } from "../../supabase/functions/_shared/handler.ts";

export type Handler = (request: Request, deps: JobDeps) => Promise<Response>;
/** The cost cap (Task 5): once it is reached, the model-calling functions are not called. */
export interface CostCap {
  reached(): boolean;
}
export interface QueueRow {
  id: number;
  method: string;
  url: string;
  headers: Record<string, string> | null;
  body: unknown;
}
export interface Dispatched {
  at: number;
  function: string;
  status?: number;
  body?: unknown;
  skipped?: "cost cap";
}
export interface DispatchCtx {
  connection: { sql(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> };
  deps: JobDeps;
  cap: CostCap;
  /** Replaces the real handlers (tests). */
  handlers?: Record<string, Handler>;
  /** The last queue id handed over. */
  lastDrained: number;
  dispatched: Dispatched[];
}

export class UnknownFunction extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`no handler for ${path}: the dispatcher knows meet, chatter, staff, settle and write`);
    this.name = "UnknownFunction";
    this.path = path;
  }
}

const MODEL_FUNCTIONS = new Set(["meet", "chatter", "staff", "write"]);
export const REAL = ["meet", "chatter", "staff", "settle", "write"];

async function handlerFor(ctx: DispatchCtx, name: string, path: string): Promise<Handler> {
  if (ctx.handlers) {
    const h = Object.hasOwn(ctx.handlers, name) ? ctx.handlers[name] : undefined;
    if (!h) throw new UnknownFunction(path);
    return h;
  }
  if (!REAL.includes(name)) throw new UnknownFunction(path);
  return (await import(`../../supabase/functions/${name}/handler.ts`)).handle as Handler;
}

export async function drain(ctx: DispatchCtx): Promise<void> {
  const rows = (await ctx.connection.sql(
    "select id::int8 as id, method, url, headers, body from net.http_request_queue where id > $1 order by id",
    [ctx.lastDrained],
  )) as unknown as QueueRow[];
  for (const row of rows) {
    const path = new URL(row.url).pathname;
    const name = /^\/functions\/v1\/([^/]+)\/?$/.exec(path)?.[1] ?? "";
    const handler = await handlerFor(ctx, name, path);
    ctx.lastDrained = Number(row.id);
    if (ctx.cap.reached() && MODEL_FUNCTIONS.has(name)) {
      ctx.dispatched.push({ at: Date.now(), function: name, skipped: "cost cap" });
      continue;
    }
    const request = new Request(row.url, { method: row.method, headers: row.headers ?? {}, body: JSON.stringify(row.body) });
    const response = await handler(request, ctx.deps);
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON: keep the text
    }
    ctx.dispatched.push({ at: Date.now(), function: name, status: response.status, body });
  }
}
