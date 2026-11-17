/** Steel Chair's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { steelChair, STEEL_CHAIR_LASTS } from '../../../cards/steel-chair.ts';
import steelChairCanvas from './art.webp?url';
import steelChairMark from './mark.svg?url';
import steelChairArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

/* Loaded the first time a post wears it, as every card's effect is (engine/ui/cards/Effects.tsx draws it inside a Suspense). */
const SteelChairEffect = lazy(() => import('../../steel-chair/Effect.tsx').then((m) => ({ default: m.SteelChairEffect })));

/*
 * Steel Chair (docs/plans/2026-11-15-steel-chair-plan.md, task 6): Salty's pink. The effect draws the throw, the dent and the chair
 * (ui/steel-chair/Effect.tsx); nothing about where it lands is saved or sent.
 */
export const ui: CardUi = {
  key: 'steel-chair',
  Effect: SteelChairEffect,
  sounds: ['steel-chair.hit', 'steel-chair.settle-1', 'steel-chair.settle-2', 'steel-chair.settle-3', 'steel-chair.settle-4'],
  art:{ color: '#ff3d7f', ink: '#14030a', canvas: steelChairCanvas, mark: steelChairMark, credit: steelChairArt.credit, tagline: 'Dent a post.' },
  summary: 'Hits a post with a folding chair and leaves a dent.',
  status: (plays) => (plays.length <= 1 ? 'Dented by a chair' : `Dented by ${plays.length} chairs`),
  hint: 'Someone took a chair to this post. The Lens says who.',
  describe: () =>
    `A Salty card, ${steelChair.rarity}. A folding chair is thrown at a post and dents it: the words bend into the dent, and the chair drops to the floor under them. It covers none of the words and holds nobody. It plays again each time the post scrolls into view, somewhere else each time; with Game sounds on, it clangs the first time. Up to ${steelChair.stack} can stack on one post, each with its own dent, and each is gone ${spanWords(STEEL_CHAIR_LASTS)} after it lands. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
};
