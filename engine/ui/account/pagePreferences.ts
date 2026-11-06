/**
 * The account's preferences as the page knows them: one holder for the whole page, so no screen's own copy (and boot's, read once when
 * the page loaded, least of all) stands in for what the account has now. Every screen that saves preferences (`usePreferenceSaves`:
 * Settings, the welcome page's Before you start, the tips' provider) reads from it and writes to it, so a choice made on one is the
 * starting point of a choice made on the next, and a screen that mounts later (going from Settings back to a board) starts from what
 * was last chosen, not from what the page loaded with.
 *
 * It keeps one account at a time. Writing for another account drops the last one's, and `clear` (a screen with nobody signed in) drops
 * everything, so one account's choices never stand in for another's. `subscribe` tells every screen when the held value changes, which
 * is how a screen open beside another shows the other's choice.
 *
 * Engine code: it names no card and no instance.
 */
import type { Preferences } from '../data/api.ts';

type Listener = (account: string, prefs: Preferences) => void;

let held: { readonly account: string; readonly prefs: Preferences } | null = null;
const listeners = new Set<Listener>();

export const pagePreferences = {
  /** What the page last knew the account to have, or undefined for an account it knows nothing of. */
  get: (account: string): Preferences | undefined => (held?.account === account ? held.prefs : undefined),
  set(account: string, prefs: Preferences): void {
    held = { account, prefs };
    for (const l of [...listeners]) l(account, prefs);
  },
  /** Nobody is signed in: nothing is held. */
  clear(): void { held = null; },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
