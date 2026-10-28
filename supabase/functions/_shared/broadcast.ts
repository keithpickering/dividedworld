/**
 * Live updates: a broadcast on a thread's or a board's channel, carrying a public projection the
 * SQL function already returned (supabase/migrations/0008_realtime.sql says why no table is
 * published instead). Every channel is private, so only a signed-in player hears it.
 *
 * A broadcast is sent after its write has committed and is best effort: a reader who misses one
 * sees the change on their next load, so a transport failure (no answer, a 5xx, a 429) is
 * retried once and then logged, and any other refusal (a 401, a 413) is logged at once, since
 * it will not change. Nothing is ever thrown into the answer of an action that succeeded. A
 * retry after a timeout may repeat a message Realtime took; act/core.ts says how each event
 * converges anyway.
 */

export interface Broadcast {
  readonly topic: string;
  readonly event: string;
  readonly payload: unknown;
}

export function broadcaster(options: { url: string; key: string; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> }) {
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async send(messages: readonly Broadcast[]): Promise<boolean> {
      if (!messages.length) return true;
      const body = JSON.stringify({ messages: messages.map((m) => ({ ...m, private: true })) });
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) await sleep(250);
        try {
          const response = await send(`${options.url}/realtime/v1/api/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: options.key, Authorization: `Bearer ${options.key}` },
            body,
            signal: AbortSignal.timeout(5_000),
          });
          await response.body?.cancel();
          if (response.ok) return true;
          if (response.status < 500 && response.status !== 429) break;
        } catch { /* no answer: once more, then give up */ }
      }
      console.error('broadcast failed', messages.map((m) => `${m.topic}/${m.event}`).join(', '));
      return false;
    },
  };
}
