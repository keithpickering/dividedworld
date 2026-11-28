/** Heads Will Roll's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import headsWillRollCanvas from './art.webp?url';
import headsWillRollMark from './mark.svg?url';
import headsWillRollArt from './art.json';
import { describeWords } from '../../heads-will-roll/words.ts';

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
  summary: "Knocks a post's reactions loose. A reader catches one to react.",
  status: 'Reactions loose',
  hint: "This post's reactions have come loose. Catch one to react.",
  describe: describeWords,
};
