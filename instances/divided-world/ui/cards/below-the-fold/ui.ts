/** Below the Fold's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { belowTheFold } from '../../../cards/below-the-fold.ts';
import belowTheFoldCanvas from './art.webp?url';
import belowTheFoldMark from './mark.svg?url';
import belowTheFoldArt from './art.json';
import { setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const BelowTheFoldEffect = lazy(() => import('../../below-the-fold/Effect.tsx').then((m) => ({ default: m.BelowTheFoldEffect })));

/*
 * Below the Fold (docs/plans/2026-11-11-card-notes-design.md, section 2): Salty's pink. The post is one bar until a reader presses it;
 * the effect draws the bar (ui/below-the-fold/Effect.tsx), and nothing about the fold is saved or sent.
 */
export const ui: CardUi = {
  key: 'below-the-fold',
  Effect: BelowTheFoldEffect,
  foldsRow: true,
  art: { color: '#ff3d7f', ink: '#14030a', canvas: belowTheFoldCanvas, mark: belowTheFoldMark, credit: belowTheFoldArt.credit, tagline: 'Fold a post away.' },
  summary: 'Folds a post behind a bar. Any reader opens it with one press.',
  status: 'Folded behind a bar',
  hint: 'Press the bar to read the post.',
  describe: () =>
    `A Salty card, ${belowTheFold.rarity}. It folds a post behind a bar, for every reader alike: the post's words are still there, and anyone opens them with one press of the bar, which lasts until they leave the page. One fold fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
};
