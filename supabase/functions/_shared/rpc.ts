/**
 * The one way an Edge Function reaches the database: a call to one SQL function, through
 * PostgREST's RPC endpoint, with plain fetch. No vendor client is imported ("Portable by
 * construction"): a self-hosted Supabase, or any PostgREST in front of the same migrations,
 * answers the same requests.
 *
 * "Three unrelated timeouts are not a poison pill": a transport failure is retried on the
 * request itself, a few times, waiting longer each time; a database error is a fact about the
 * request and is thrown at once, carrying the SQLSTATE PostgREST reports.
 *
 * Which transport failures are retried turns on whether the call is safe to repeat
 * (`safeToRepeat`). A 503 says the request never reached a database that ran it, so every call
 * is retried on one. A fetch that failed after it may have been sent, a timeout, a 502 (an
 * upstream that may have committed before its answer broke) or a 504 may each follow a write
 * that committed and an answer lost on the way back:
 * those are retried only for a read, or a write that finds its own earlier effect
 * (apply_settlement's already-settled window). A post or a purchase is not repeated on a guess;
 * its failure is thrown, and the player decides whether to try again.
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

/**
 * Whether an error is PostgREST's refusal of the session itself (a bearer it cannot verify, or one
 * whose role may not call the function): a 401 with no hint. A refusal a SQL function raises for a
 * player carries its hint, and is not this.
 */
export function sessionRefused(e: unknown): boolean {
  if (!(e instanceof DatabaseError) || e.status !== 401 || e.hint !== '') return false;
  // Logged, since a wrong publishable key answers the same way and would otherwise only say "sign in" to every player. Its code
  // alone (PGRST301 for a bearer PostgREST cannot verify, 42501 for a role that may not call, none from the gateway): never
  // the answer's text, which a gateway may fill with what it was sent.
  console.warn('the session was refused:', e.code || 'no code, so the gateway refused the request');
  return true;
}

/** The hint a SQL function raises with when the account is barred (0150_conduct.sql, refuse_if_barred), so the client reads its session again. */
export const BARRED_HINT = 'kayfabb.barred';

/** The answer for a barred account's refusal, in its plain words and the hint the client recognizes; null for any other error. */
export function barredAnswer(e: unknown): { readonly status: 403; readonly body: { readonly error: string; readonly hint: typeof BARRED_HINT } } | null {
  return e instanceof DatabaseError && e.hint === BARRED_HINT ? { status: 403, body: { error: e.reason, hint: BARRED_HINT } } : null;
}

export interface Db {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export interface PostgrestOptions {
  readonly url: string;
  /** The project's API key, sent in apikey: the secret key for the service, the publishable key for a player's request. */
  readonly key: string;
  /** Who the call is made as: the player's own session token. Unset, no Authorization is sent, and the gateway acts as the key's role. */
  readonly bearer?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How many times a request is sent before a transport failure is thrown. */
  readonly attempts?: number;
  /** How long one request may take before it counts as never answered. */
  readonly timeoutMs?: number;
  /** Whether a function may be sent again after a failure that may have followed its commit; every one, unless said. */
  readonly safeToRepeat?: (fn: string) => boolean;
}

/** The request never reached a database that ran it. */
const NEVER_RAN = new Set([503]);
/** It may have run, its answer lost. */
const MAY_HAVE_RUN = new Set([502, 504]);

export function postgrest(options: PostgrestOptions): Db {
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const safeToRepeat = options.safeToRepeat ?? (() => true);
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const seen: string[] = [];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (attempt > 1) await sleep(250 * 2 ** (attempt - 2));
        let response: Response;
        try {
          response = await send(`${options.url}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: options.key, ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}) },
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          seen.push(`no answer (${e instanceof Error ? e.message : String(e)})`);
          if (!safeToRepeat(fn)) break;
          continue;
        }
        if (NEVER_RAN.has(response.status) || MAY_HAVE_RUN.has(response.status)) {
          seen.push(`HTTP ${response.status}`);
          await response.body?.cancel();
          if (MAY_HAVE_RUN.has(response.status) && !safeToRepeat(fn)) break;
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
      throw new TransportError(`${fn}: no answer after ${seen.length} attempt(s): ${seen.join('; ')}`);
    },
  };
}
