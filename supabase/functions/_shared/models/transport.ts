/**
 * What the model adapters share: one HTTP attempt, and how it can end.
 *
 * "Three unrelated timeouts are not a poison pill": an attempt that never answered (a throw, or a
 * request past its timeout), a 5xx or a 429 is a `TransportFailure`, which index.ts retries on
 * the request itself; any other refusal (a 400, a 401, a 404) is a `ProviderRefusal`, a fact about
 * the request, thrown at once. Adapters make one attempt each and never retry; `fetch` only, no
 * vendor client ("Portable by construction").
 */

export class TransportFailure extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

export class ProviderRefusal extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface Wire {
  readonly fetch: typeof globalThis.fetch;
  /** How long one attempt may take before it counts as never answered. */
  readonly timeoutMs: number;
  readonly now: () => number;
}

/** POSTs JSON and returns the parsed answer. A secret in `headers` is never put in an error. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, wire: Wire): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), wire.timeoutMs);
  try {
    let response: Response;
    try {
      response = await wire.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      throw new TransportFailure(controller.signal.aborted ? `no answer within ${wire.timeoutMs} ms` : `no answer (${e instanceof Error ? e.message : String(e)})`);
    }
    const text = await response.text().catch(() => '');
    if (response.status >= 500 || response.status === 429) throw new TransportFailure(`HTTP ${response.status}`, response.status);
    if (!response.ok) throw new ProviderRefusal(`HTTP ${response.status} ${text.slice(0, 200)}`, response.status);
    try { return JSON.parse(text); } catch { throw new TransportFailure('an answer that is not JSON', response.status); }
  } finally {
    clearTimeout(timer);
  }
}
