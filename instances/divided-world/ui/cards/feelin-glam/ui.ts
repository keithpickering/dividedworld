/** Feelin' Glam's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { feelinGlam } from '../../../cards/feelin-glam.ts';
import feelinGlamCanvas from './art.webp?url';
import feelinGlamMark from './mark.svg?url';
import feelinGlamArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

/*
 * Feelin' Glam (docs/plans/2026-11-11-card-notes-part-2-plan.md): Sweet's cyan. A Move on a thread whose plays are handed to Feelin' Fab's
 * effect (`drawnBy`), so it draws nothing of its own; a post from its week keeps the level after the week ends.
 */
export const ui: CardUi = {
  key: 'feelin-glam',
  drawnBy: 'feelin-fab',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: feelinGlamCanvas, mark: feelinGlamMark, credit: feelinGlamArt.credit, tagline: 'Give a whole thread a rainbow.' },
  summary: `Cast on a thread. Every post there gets one more level of Feelin' Fab's rainbow for ${spanWords(feelinGlam.lasts!)}, and posts written in that time keep it.`,
  status: (plays) => (plays.length > 0 ? 'One more rainbow level here' : 'Kept by posts from its week'),
  hint: "A Feelin' Glam: every post in this thread glows one level more.",
  describe: () =>
    `A Sweet card, ${feelinGlam.rarity}, cast on a thread from its title. For ${spanWords(feelinGlam.lasts!)}, every post in the thread is drawn with one more level of Feelin' Fab's rainbow, up to Feelin' Fab's three. It takes none of a post's three Feelin' Fab places. A post written in the thread during that time keeps its extra level after it; every other post loses it when the time is up. If an admin ends the card, every post loses the level. One fits on a thread at a time. ${setMoveWords("the quoting post's thread")} It costs nothing more to play.`,
};
