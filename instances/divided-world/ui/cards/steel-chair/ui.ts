/** Steel Chair's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { steelChair, STEEL_CHAIR_LASTS } from '../../../cards/steel-chair.ts';
import steelChairCanvas from './art.webp?url';
import steelChairMark from './mark.svg?url';
import steelChairArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';
import { dentedBy } from './dented.ts';

/* Loaded the first time a post wears it, as every card's effect is (engine/ui/cards/Effects.tsx draws it inside a Suspense). */
const SteelChairEffect = lazy(() => import('../../steel-chair/Effect.tsx').then((m) => ({ default: m.SteelChairEffect })));

/*
 * Steel Chair (docs/plans/2026-11-15-steel-chair-plan.md, task 6): Salty's pink. The effect draws the throw, the dent and the chair
 * (ui/steel-chair/Effect.tsx); nothing about where it lands is saved or sent.
 */
export const ui: CardUi = {
  key: 'steel-chair',
  Effect: SteelChairEffect,
  sounds: [
    'steel-chair.hit', 'steel-chair.settle-1', 'steel-chair.settle-2', 'steel-chair.settle-3', 'steel-chair.settle-4',
    'steel-chair.can-hit', 'steel-chair.can-settle-1', 'steel-chair.can-settle-2',
    'steel-chair.ladder-hit', 'steel-chair.ladder-settle-1', 'steel-chair.ladder-settle-2',
    'steel-chair.extinguisher-hit', 'steel-chair.extinguisher-settle-1', 'steel-chair.extinguisher-settle-2', 'steel-chair.extinguisher-hiss',
  ],
  art: { color: '#ff3d7f', ink: '#14030a', canvas: steelChairCanvas, mark: steelChairMark, credit: steelChairArt.credit, tagline: 'Dent a post.' },
  summary: 'Hits a post with a folding chair and leaves a dent.',
  status: (plays) => dentedBy(plays),
  hint: 'Someone took a chair to this post. The Lens says who.',
  describe: () =>
    `A Salty card, ${steelChair.rarity}. Something is thrown at a post and dents it, usually a folding chair, sometimes a trash can, a step ladder or a fire extinguisher: the words bend into the dent, and the thing drops to the floor under them. A trash can's lid flies off, and a fire extinguisher fills the post with spray that clears by itself in a few seconds. Once it lands it covers none of the words, and it holds nobody. It plays again each time the post scrolls into view, somewhere else each time, and with Game sounds on it clangs each time, unless motion is reduced. Up to ${steelChair.stack} can stack on one post, each with its own dent, and each is gone ${spanWords(STEEL_CHAIR_LASTS)} after it lands. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
};
