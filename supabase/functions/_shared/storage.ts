/**
 * The one way an Edge Function reaches a bucket: Supabase Storage's REST endpoints, with plain
 * fetch and the service key. No vendor client is imported ("Portable by construction"): a
 * self-hosted Supabase answers the same requests. Tests hand the functions a fake that keeps the
 * files in memory; no build session touches a deployed bucket.
 *
 * "Three unrelated timeouts are not a poison pill": a 5xx, a 429 or a request that never answered
 * is asked again here, on the request itself, and only that; after the last attempt it is a
 * TransportError, said with every attempt, as rpc.ts does for the database.
 */
import { TransportError } from './rpc.ts';

export interface Storage {
  /** Stores `bytes` under `name`, never over an existing file. */
  put(name: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Removes the named files; one already gone is no failure. */
  remove(names: readonly string[]): Promise<void>;
}

const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export function supabaseStorage(o: {
  url: string; key: string; bucket: string; fetch?: typeof globalThis.fetch;
  attempts?: number; timeoutMs?: number; pause?: (ms: number) => Promise<void>;
}): Storage {
  const send = o.fetch ?? globalThis.fetch;
  const attempts = o.attempts ?? 4;
  const timeoutMs = o.timeoutMs ?? 30_000;
  const pause = o.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers = { apikey: o.key, Authorization: `Bearer ${o.key}` };
  const at = (name: string) => `${o.url}/storage/v1/object/${o.bucket}/${encodeURIComponent(name)}`;
  const request = async (where: string, init: RequestInit, what: string) => {
    const seen: string[] = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await pause(250 * 2 ** (attempt - 2));
      try {
        const r = await send(where, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (r.status >= 500 || r.status === 429) { seen.push(`HTTP ${r.status}`); await r.body?.cancel(); continue; }
        return r;
      } catch (e) {
        seen.push(`no answer (${(e as Error)?.name === 'TimeoutError' ? `none in ${timeoutMs} ms` : (e as Error)?.message ?? e})`);
      }
    }
    throw new TransportError(`storage: ${what}: no answer after ${seen.length} attempt(s): ${seen.join('; ')}`);
  };
  return {
    // A name taken (409, or 400 with Storage's own word for it) is the file an attempt whose
    // answer was lost stored, when its bytes are these; other bytes are refused. Names are random,
    // so nothing else takes one.
    async put(name, bytes, contentType) {
      const r = await request(at(name), { method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes }, `storing ${name}`);
      await r.body?.cancel();
      if (r.ok) return;
      if (r.status === 400 || r.status === 409) {
        const there = await request(at(name), { method: 'GET', headers }, `reading ${name}`);
        if (there.ok) {
          if (await sha256(new Uint8Array(await there.arrayBuffer())) === await sha256(bytes)) return;
          throw new Error(`storage: ${name} is already there, and is another file`);
        }
        await there.body?.cancel();
      }
      throw new Error(`storage: storing ${name} answered HTTP ${r.status}`);
    },
    async remove(names) {
      if (!names.length) return;
      const r = await request(`${o.url}/storage/v1/object/${o.bucket}`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }),
      }, `removing ${names.length} file(s)`);
      await r.body?.cancel();
      if (!r.ok) throw new Error(`storage: removing ${names.length} file(s) answered HTTP ${r.status}`);
    },
  };
}
