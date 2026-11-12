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
