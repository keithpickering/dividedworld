/**
 * Where sign-in returns to, as one rule for the browser (engine/ui/account/next.ts) and the account
 * function (supabase/functions/account/core.ts): a path on the instance's own site, or nothing.
 * The origin is a parameter, so no DOM global is read here and both sides can import it.
 */

/** The longest `next` followed; it rides in an emailed link and a request body, which stay short. */
export const NEXT_MAX = 512;

/**
 * `next` as a path, query and fragment on `origin`, or null. A string that starts with `/`, is at most
 * NEXT_MAX characters and resolves against `origin` to that same origin; anything else is null.
 */
export function sameSitePath(next: unknown, origin: string): string | null {
  if (typeof next !== 'string' || !next.startsWith('/') || next.length > NEXT_MAX) return null;
  // Resolve it as the browser would: the URL parser drops tabs and newlines and reads a backslash as a
  // slash, so "/\t/evil.example" is another site however the string looks. Only the same origin is followed.
  let url: URL;
  try { url = new URL(next, origin); } catch { return null; }
  if (url.origin !== origin) return null;
  return url.pathname + url.search + url.hash;
}
