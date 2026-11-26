/** Whodunnit's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { whodunnit } from '../../../cards/whodunnit.ts';
import whodunnitCanvas from './art.webp?url';
import whodunnitMark from './mark.svg?url';
import whodunnitArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const WhodunnitEffect = lazy(() => import('../../whodunnit/Effect.tsx').then((m) => ({ default: m.WhodunnitEffect })));

/*
 * The veils and the local reaction (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 11): Pepperoni's color and ink, as Class Clown's face
 * takes them. The veils' effects (ui/whodunnit, ui/blind-study) draw almost nothing: the engine withholds the author and the totals, and these
 * say so to the Lens. Overreaction has no effect: its row and its picker entry are the engine's, and its form is the glass's.
 */
export const ui: CardUi = {
  key: 'whodunnit',
  Effect: WhodunnitEffect,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: whodunnitCanvas, mark: whodunnitMark, credit: whodunnitArt.credit, tagline: 'Who wrote this?' },
  summary: 'Hides who wrote a post from everyone, for a while.',
  status: "Hiding this post's author",
  hint: 'No other player can see who wrote this post until the card ends.',
  describe: () =>
    `A Pepperoni card, ${whodunnit.rarity}. For ${spanWords(whodunnit.lasts!)} no other player can see who wrote the post: its name, picture and profile are replaced by a stand-in everywhere on the forum, in search and in alerts too. Anyone who read it before remembers. The author is still paid for the post and still sees that it is theirs. When the card ends the name comes back, and the post says so. It is refused on a staff post and on a post a Mod Bot has been to, and no Mod Bot visits the post while its author is hidden. One fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  logPlay: () => `It hides the post's author for ${spanWords(whodunnit.lasts!)}.`,
};
