/**
 * Where sign-in returns to: the page the visitor was on, kept in the sign-in address as `next`.
 * Only a path on this site is followed; anything else is the index, so a link made by someone
 * else cannot send a signed-in player elsewhere. The rule is engine/rules/next.ts, the one the account
 * function applies to the `next` it puts in the emailed link; it bounds a path at 512 characters.
 */
import { sameSitePath } from '../../rules/next.ts';

export function safeNext(next: string | null): string {
  return sameSitePath(next, globalThis.location.origin) ?? '/';
}

/** The link to sign in from a page: it carries the page, except for the index and the sign-in pages themselves. */
export function signInHref(path: string, search: string): string {
  if (path === '/' || path === '/sign-in' || path === '/register') return '/sign-in';
  return `/sign-in?next=${encodeURIComponent(path + search)}`;
}

/** The link to register from a page: it carries the page as `next` the way signInHref does, so the account opens back where the visitor was. */
export function registerHref(path: string, search: string): string {
  if (path === '/' || path === '/sign-in' || path === '/register') return '/register';
  return `/register?next=${encodeURIComponent(path + search)}`;
}
