/**
 * Where sign-in returns to: the page the visitor was on, kept in the sign-in address as `next`.
 * Only a path on this site is followed; anything else is the index, so a link made by someone
 * else cannot send a signed-in player elsewhere.
 */
export function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  return '/';
}

/** The link to sign in from a page: it carries the page, except for the index and the sign-in pages themselves. */
export function signInHref(path: string, search: string): string {
  if (path === '/' || path === '/sign-in' || path === '/register') return '/sign-in';
  return `/sign-in?next=${encodeURIComponent(path + search)}`;
}
