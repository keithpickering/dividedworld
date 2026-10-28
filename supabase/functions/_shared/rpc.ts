/**
 * The one way an Edge Function reaches the database: a call to one SQL function, through
 * PostgREST's RPC endpoint, with plain fetch. No vendor client is imported ("Portable by
 * construction"): a self-hosted Supabase, or any PostgREST in front of the same migrations,
 * answers the same requests.
 *
 * "Three unrelated timeouts are not a poison pill": a transport failure (a fetch that never
 * answered, a gateway's 502, 503 or 504) is retried on the request itself, a few times, waiting
 * longer each time; a database error is a fact about the request and is thrown at once,
 * carrying the SQLSTATE PostgREST reports. Every SQL function this calls is safe to call twice:
 * a read, or a write that finds its own earlier effect (apply_settlement's already-settled
 * window), so a retry after an answer that was lost on the way back changes nothing.
 */

export class TransportError extends Error {}

export class DatabaseError extends Error {
  readonly code: string;
  readonly status: number;
  /** The SQL function's own words, without PostgREST's detail, which can carry a row's values. */
  readonly reason: string;
  /** The hint the SQL function raised with, if any: what marks a refusal meant for a player. */
  readonly hint: string;
  constructor(message: string, code: string, status: number, reason = message, hint = '') {
    super(message);
    this.code = code;
    this.status = status;
    this.reason = reason;
    this.hint = hint;
  }
}

export interface Db {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export interface PostgrestOptions {
  readonly url: string;
  /** The project's API key: the service key for a job, the anon key for a player's request. */
  readonly key: string;
  /** Who the call is made as: the player's own session token; the key itself when unset. */
  readonly bearer?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How many times a request is sent before a transport failure is thrown. */
  readonly attempts?: number;
  /** How long one request may take before it counts as never answered. */
  readonly timeoutMs?: number;
}

const TRANSPORT_STATUS = new Set([502, 503, 504]);

export function postgrest(options: PostgrestOptions): Db {
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const seen: string[] = [];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (attempt > 1) await sleep(250 * 2 ** (attempt - 2));
        let response: Response;
        try {
          response = await send(`${options.url}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: options.key, Authorization: `Bearer ${options.bearer ?? options.key}` },
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          seen.push(`no answer (${e instanceof Error ? e.message : String(e)})`);
          continue;
        }
        if (TRANSPORT_STATUS.has(response.status)) {
          seen.push(`HTTP ${response.status}`);
          continue;
        }
        const text = await response.text();
        let body: unknown = null;
        try { body = text ? JSON.parse(text) : null; } catch {
          // Not PostgREST's JSON (a proxy's page): an error with the status, or a reply nothing can read.
          if (!response.ok) throw new DatabaseError(`${fn}: HTTP ${response.status} ${text.slice(0, 200)}`, '', response.status);
          throw new DatabaseError(`${fn}: an answer that is not JSON`, '', response.status);
        }
        if (!response.ok) {
          const b = (body ?? {}) as { code?: string; message?: string; details?: string; hint?: string };
          throw new DatabaseError(`${fn}: ${b.message ?? `HTTP ${response.status}`}${b.details ? ` (${b.details})` : ''}`, b.code ?? '', response.status, b.message ?? `HTTP ${response.status}`, b.hint ?? '');
        }
        return body as T;
      }
      throw new TransportError(`${fn}: no answer after ${attempts} attempts: ${seen.join('; ')}`);
    },
  };
}
