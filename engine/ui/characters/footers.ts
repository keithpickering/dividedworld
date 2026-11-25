/**
 * The one line each characters form says beside its buttons ("what will happen"), as the Turn board's footer does
 * (docs/research/2026-11-05-backfill/, boards 23 to 25 and 40). Each is built from the form's state, so it never promises what the
 * preview above it does not; footers.test.ts lists every variant a line can say, which is the copy the owner approves.
 *
 * Plain words about the game, in the glass's own voice and never a character's. A class is named only where the player chose the option
 * that names it, as the previews do (previews.ts).
 */
import { words, type PronounSet } from '../../rules/pronouns.ts';

/** New character's line: what making the character does. It is on the board at once and nobody is told (0428: there is no debut to choose). */
export function newCharacterFooter(o: { readonly name: string; readonly pronouns: PronounSet }): string {
  const w = words(o.pronouns);
  const who = o.name.trim() || 'Your character';
  return `${who} is on the board as soon as you make ${w.them}. Nobody is told, and ${w.their} first post is ${w.their} entrance. ${w.Their} class stays yours alone.`;
}

/** The Reveal overlay's line. */
export function revealFooter(gameWord: string): string {
  return `The reveal is checked by ${gameWord} and posted at once.`;
}
