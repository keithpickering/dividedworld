/**
 * What every Edge Function here shares at its edge: the environment it needs, and the service
 * key a caller must hold. A scheduled job is called by pg_cron with the service key from Vault
 * (supabase/migrations/0004_schedule.sql); the comparison takes the same time whatever the
 * bearer is, so how long a refusal takes says nothing about how close a guess was.
 */
import { postgrest, type Db } from './rpc.ts';

export function environment(get: (name: string) => string | undefined): { url: string; key: string } {
  const url = get('SUPABASE_URL');
  const key = get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return { url, key };
}

export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Whether a request carries the service key as its bearer. */
export function fromTheService(request: Request, key: string): boolean {
  const header = request.headers.get('Authorization') ?? '';
  return sameSecret(header, `Bearer ${key}`);
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function serviceDb(env: { url: string; key: string }): Db {
  return postgrest({ url: env.url, key: env.key });
}

/**
 * The headers a browser needs to call a function from the site: any origin, since the session
 * travels in the Authorization header and never a cookie, so another origin gains nothing.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

/** A request's JSON body, or null when it is not JSON or longer than `most` bytes. */
export async function boundedJson(request: Request, most: number): Promise<{ tooLong: boolean; body: unknown }> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > most) return { tooLong: true, body: null };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > most) return { tooLong: true, body: null };
  try { return { tooLong: false, body: JSON.parse(text) }; } catch { return { tooLong: false, body: null }; }
}
