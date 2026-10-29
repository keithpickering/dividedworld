/**
 * The one way an Edge Function reaches a bucket: Supabase Storage's REST endpoints, with plain
 * fetch and the service key. No vendor client is imported ("Portable by construction"): a
 * self-hosted Supabase answers the same requests. Tests hand the functions a fake that keeps the
 * files in memory; no build session touches a deployed bucket.
 */
export interface Storage {
  /** Stores `bytes` under `name`, never over an existing file. */
  put(name: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Removes the named files; one already gone is no failure. */
  remove(names: readonly string[]): Promise<void>;
}

export function supabaseStorage(o: { url: string; key: string; bucket: string; fetch?: typeof globalThis.fetch }): Storage {
  const send = o.fetch ?? globalThis.fetch;
  const headers = { apikey: o.key, Authorization: `Bearer ${o.key}` };
  return {
    async put(name, bytes, contentType) {
      const r = await send(`${o.url}/storage/v1/object/${o.bucket}/${encodeURIComponent(name)}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes,
      });
      if (!r.ok) throw new Error(`storage: storing ${name} answered HTTP ${r.status}`);
      await r.body?.cancel();
    },
    async remove(names) {
      if (!names.length) return;
      const r = await send(`${o.url}/storage/v1/object/${o.bucket}`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }),
      });
      if (!r.ok) throw new Error(`storage: removing ${names.length} file(s) answered HTTP ${r.status}`);
      await r.body?.cancel();
    },
  };
}
