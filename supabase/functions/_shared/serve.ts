/**
 * What every Edge Function here shares at its edge: the environment it needs, and the key a
 * scheduled caller must hold. KayfaBB takes Supabase's publishable and secret keys alone
 * (docs/plans/2026-11-02-api-keys-design.md): on the platform they arrive as JSON objects of
 * every key by its name, and in the CLI's local stack and self-hosted Supabase as one of each.
 * A scheduled job is called by pg_cron with the secret key named kayfabb_jobs, read from Vault
 * (the migration after 0069_tips_settings.sql that sends it in apikey); the comparison takes the
 * same time whatever is sent, so how long a refusal takes says nothing about how close a guess was.
 * No message here ever holds a key's value, only its name.
 */
import { postgrest, type Db } from './rpc.ts';

export type Environment = {
  url: string;
  /** The functions' own way to the Data API, Storage, Realtime and Auth: the `default` secret key. */
  secret: string;
  /** The key a player's calls go out with: the `default` publishable key. */
  publishable: string;
  /** The key settle, meet and seed accept: the secret key named kayfabb_jobs, or null where the project has none. */
  jobs: string | null;
};

/** A JSON object of strings, by name, or a throw naming the variable and not its value. */
function namedKeys(name: string, raw: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || Object.values(parsed).some((v) => typeof v !== 'string')) {
    throw new Error(`${name} is not a JSON object of strings`);
  }
  return parsed as Record<string, string>;
}

/** A key, or undefined where it is unset or empty; refused by its name when it has the legacy JWT shape. */
function notLegacy(which: string, key: string | undefined): string | undefined {
  if (key?.startsWith('eyJ')) {
    throw new Error(`${which} is a legacy JWT key; KayfaBB takes the publishable and secret keys (sb_publishable_…, sb_secret_…)`);
  }
  return key || undefined;
}

export function environment(get: (name: string) => string | undefined): Environment {
  const url = get('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL must be set');

  const secrets = get('SUPABASE_SECRET_KEYS');
  const publishables = get('SUPABASE_PUBLISHABLE_KEYS');
  let secret: string | undefined;
  let jobs: string | undefined;
  if (secrets !== undefined) {
    const named = namedKeys('SUPABASE_SECRET_KEYS', secrets);
    secret = notLegacy('the secret key named default', named.default);
    // Never `default`: a key leaked from anywhere else must not run a settlement (the design's section 1).
    jobs = notLegacy('the secret key named kayfabb_jobs', named.kayfabb_jobs);
  } else {
    secret = notLegacy('SUPABASE_SECRET_KEY', get('SUPABASE_SECRET_KEY'));
    jobs = secret;
  }
  const publishable = publishables !== undefined
    ? notLegacy('the publishable key named default', namedKeys('SUPABASE_PUBLISHABLE_KEYS', publishables).default)
    : notLegacy('SUPABASE_PUBLISHABLE_KEY', get('SUPABASE_PUBLISHABLE_KEY'));

  if (!secret) throw new Error('no secret key: make a secret key named default, or set SUPABASE_SECRET_KEY');
  if (!publishable) throw new Error('no publishable key: make a publishable key named default, or set SUPABASE_PUBLISHABLE_KEY');
  return { url, secret, publishable, jobs: jobs ?? null };
}

export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Whether a request carries the jobs key in its apikey header. Authorization is ignored: a
 * scheduled caller holds no session. With no jobs key (`null`), no request is from the service.
 */
export function fromTheService(request: Request, jobs: string | null): boolean {
  if (jobs === null) return false;
  return sameSecret(request.headers.get('apikey') ?? '', jobs);
}

/**
 * The 401 a service-called function answers, logged with the same plain line where the project
 * has no jobs key, so the operator reads which key to make. It names a key, never a value.
 */
export function notTheService(jobs: string | null, what: string): Response {
  if (jobs === null) {
    const missing = 'this project has no secret key named kayfabb_jobs';
    console.error(missing);
    return json(401, { error: missing });
  }
  return json(401, { error: what });
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function serviceDb(env: { url: string; secret: string }): Db {
  return postgrest({ url: env.url, key: env.secret });
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
