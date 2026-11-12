/**
 * The emailed link's token, read from the address's fragment. The email's button opens `/sign-in#token_hash=...` (or
 * `/register#...`): the fragment is never sent to a server, so the screen reads it here, takes it out of the address and
 * holds it in memory until the player presses the button. The shape is the one the `account` function takes (16 to 256 of
 * A-Z, a-z, 0-9, `_` and `-`); anything else is not a link, and the screen shows its ordinary form.
 */
const SHAPE = /^[A-Za-z0-9_-]{16,256}$/u;

export function tokenHashOf(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/u, '')).get('token_hash')?.trim() ?? '';
  return SHAPE.test(value) ? value : null;
}

/*
 * The link in hand, kept in memory above the screen. A press that signs an account in changes the session's account, and the app then
 * starts the routed screen afresh for it and reads its page again (web/src/App.tsx, Shell; engine/ui/router.tsx, `setAccount`): the screen
 * that comes back reads an address that has already lost its fragment, so what the old one held (the token, and whether this page's press
 * signed in) is carried here, in this module's memory alone: no history entry, no storage, no address.
 *
 * The hold exists only while a `LinkHandKeeper` (LinkHand.tsx) is mounted: it turns keeping on, and off at its unmount. With keeping off
 * nothing is held (the link lives in the screen's own state) and a read forgets whatever an earlier keeper left, so the hold cannot
 * outlive what drops it. The keeper also drops the link as soon as the address is not the page it was held for.
 */
interface Hand { tokenHash: string | null; pressed: boolean; path: string | null }
const hand: Hand = { tokenHash: null, pressed: false, path: null };
let keeping = false;

/** A keeper mounted (true) or unmounted (false). Off leaves the hand to be forgotten at the next read, so a simulated unmount and remount loses nothing. */
export function keepLink(on: boolean): void { keeping = on; }

/** What a screen starts with: the address's token if it carries one (a new visit, which replaces what was held), else the one held for this page. */
export function linkAtMount(hash: string, path: string): { readonly tokenHash: string | null; readonly pressed: boolean } {
  const fresh = tokenHashOf(hash);
  if (!keeping) { forgetLink(); return { tokenHash: fresh, pressed: false }; }
  if (fresh !== null) { hand.tokenHash = fresh; hand.pressed = false; hand.path = path; }
  else if (hand.path !== path) forgetLink();
  return { tokenHash: hand.tokenHash, pressed: hand.tokenHash !== null && hand.pressed };
}

/** The screen set its link aside (null), or holds it (with the page it is for). */
export function holdLink(tokenHash: string | null, path: string | null = hand.path): void {
  if (tokenHash === null) { forgetLink(); return; }
  if (!keeping) return;
  hand.tokenHash = tokenHash;
  hand.path = path;
}

/** Whether a press of the held link has signed in (or is signing in), for a screen that starts afresh under the account it signed in. */
export function markPressed(pressed: boolean): void { if (keeping) hand.pressed = pressed; }

/** Drops the link, if it was held for another page than this one. */
export function forgetLinkOutside(path: string): void { if (hand.path !== path) forgetLink(); }

/** Drops the link whatever the page. */
export function forgetLink(): void { hand.tokenHash = null; hand.pressed = false; hand.path = null; }

/** For tests: no keeper, nothing held. */
export function resetLink(): void { keeping = false; forgetLink(); }
