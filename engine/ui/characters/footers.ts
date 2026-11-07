/**
 * The one line each characters form says beside its buttons ("what will happen"), as the Turn board's footer does
 * (docs/research/2026-11-05-backfill/, boards 23 to 25 and 40). Each is built from the form's state, so it never promises what the
 * preview above it does not; footers.test.ts lists every variant a line can say, which is the copy the owner approves.
 *
 * Plain words about the game, in the glass's own voice and never a character's. A class is named only where the player chose the option
 * that names it, as the previews do (previews.ts).
 */
import { words, type PronounSet } from '../../rules/pronouns.ts';
import { withArticle } from './format.ts';

export type FooterTiming = 'now' | 'tally';
export type FooterLoudness = 'silent' | 'announced' | 'with_class';

/** New character's line: what making the character does, for its timing and its loudness (six variants, and a name or class not chosen yet). */
export function newCharacterFooter(o: { readonly name: string; readonly className: string; readonly timing: FooterTiming; readonly loudness: FooterLoudness; readonly pronouns: PronounSet }): string {
  const w = words(o.pronouns);
  const who = o.name.trim() || 'Your character';
  const stays = `${w.Their} class stays yours alone.`;
  const public_ = "That stays public, and can't be taken back.";
  if (o.timing === 'now') {
    if (o.loudness === 'silent') return `${who} is on the board as soon as you make ${w.them}. Nobody is told, and ${w.their} first post is ${w.their} entrance. ${stays}`;
    if (o.loudness === 'announced') return `${who} is on the board as soon as you make ${w.them}, and The System announces ${w.them}. ${stays}`;
    return `${who} is on the board as soon as you make ${w.them}, and The System announces ${w.them} ${o.className ? `as ${withArticle(o.className)}` : 'with the class you choose'}. ${public_}`;
  }
  const waits = `${who} waits, seen by no one but you, and`;
  if (o.loudness === 'silent') return `${waits} appears at the next settlement without a word. ${stays}`;
  if (o.loudness === 'announced') return `${waits} debuts at the next settlement, announced by The System. ${stays}`;
  return `${waits} debuts at the next settlement, announced ${o.className ? `as ${withArticle(o.className)}` : 'with the class you choose'}. ${public_}`;
}

/**
 * The Debut dialog's line. Changing how a waiting character debuts (`tally`) says when it debuts, when that is known (`until`, from
 * untilWords), and that it can be dropped now; dropping it (`now`) says what that does.
 */
export function debutFooter(o: { readonly name: string; readonly timing: FooterTiming; readonly until: string | null; readonly pronouns: PronounSet }): string {
  const w = words(o.pronouns);
  if (o.timing === 'now') return `${o.name} goes on the board at once and can post at once, instead of at the next settlement.`;
  return `${w.They} debut${w.s} at the next settlement${o.until ? `, ${o.until}` : ''}. Until then you can drop ${w.them} now instead.`;
}

/** The Reveal modal's line. */
export function revealFooter(): string {
  return 'The reveal is checked by The System and posted at once.';
}
