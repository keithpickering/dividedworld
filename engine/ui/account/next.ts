/**
 * Where sign-in returns to: the page the visitor was on, kept in the sign-in address as `next`.
 * Only a path on this site is followed; anything else is the index, so a link made by someone
 * else cannot send a signed-in player elsewhere.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/')) return '/';
  // Resolve it as the browser would: the URL parser drops tabs and newlines and reads a backslash as a
  // slash, so "/\t/evil.example" is another site however the string looks. Only the same origin is followed.
  const origin = globalThis.location.origin;
  let url: URL;
  try { url = new URL(next, origin); } catch { return '/'; }
  if (url.origin !== origin) return '/';
  return url.pathname + url.search + url.hash;
}

/** The link to sign in from a page: it carries the page, except for the index and the sign-in pages themselves. */
export function signInHref(path: string, search: string): string {
  if (path === '/' || path === '/sign-in' || path === '/register') return '/sign-in';
  return `/sign-in?next=${encodeURIComponent(path + search)}`;
}
