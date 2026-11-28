/** Heads Will Roll's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { headsWillRoll } from '../../../cards/heads-will-roll.ts';
import headsWillRollCanvas from './art.webp?url';
import headsWillRollMark from './mark.svg?url';
import headsWillRollArt from './art.json';
import { setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const HeadsWillRollEffect = lazy(() => import('../../heads-will-roll/Effect.tsx').then((m) => ({ default: m.HeadsWillRollEffect })));

/*
 * Heads Will Roll (docs/plans/2026-11-27-season-two-cards-design.md, section 2): Pepperoni's color. The post's live reaction tiles come loose and orbit inside its content area, a head for each kind
 * and one more to react with, and a reader catches one to react. The post's row draws one plain line instead of tiles while it is up (`drawsReactions`). Nothing about it is saved on the play or sent.
 */
export const ui: CardUi = {
  key: 'heads-will-roll',
  Effect: HeadsWillRollEffect,
  drawsReactions: true,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: headsWillRollCanvas, mark: headsWillRollMark, credit: headsWillRollArt.credit, tagline: 'Knock the reactions loose.' },
  summary: "Knocks a post's reactions loose: they orbit inside it, and a reader catches one to react.",
  status: 'Reactions loose',
  hint: "This post's reactions have come loose. Catch one to react.",
  describe: (settings: Settings) => {
    const s = settings.cardSettings;
    const base = s['headsWillRoll.reelBase'] ?? 0;
    return `A Pepperoni card, ${headsWillRoll.rarity}. The post's reactions come loose and roll round inside it as heads: the heaviest drift like suns and the lighter ones circle them, an Overreaction's head counting ${s['headsWillRoll.overMass'] ?? 1} times as heavy. To react, a reader catches a head by pressing it, and the usual grace to take it back applies; a kind not yet on the post joins at one, and the React head, which orbits too, opens the picker with only new kinds. By keyboard or switch, press Enter or Space on a head to reel it in: the reaction lands after about ${base} seconds, a little longer for a fast head, and a second press cancels. With reduced motion the heads stand still and every press reels in. On the post's author's own screen the heads orbit but cannot be pressed. Whether the room pumps or taxes the post is settled by its reactions, as for every Pepperoni play, and the author has no clear. One fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`;
  },
};
