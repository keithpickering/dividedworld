/** Feelin' Fab's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { feelinFab } from '../../../cards/feelin-fab.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import feelinFabCanvas from './art.webp?url';
import feelinFabMark from './mark.svg?url';
import feelinFabArt from './art.json';
import { setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const FeelinFabEffect = lazy(() => import('../../feelin-fab/Effect.tsx').then((m) => ({ default: m.FeelinFabEffect })));

/*
 * The onboarding's first card (docs/plans/2026-11-02-onboarding-design.md, section 5), the Face's own: Sweet's cyan, as Force Field is.
 * Its rainbow grows with each Feelin' Fab on the post, up to three.
 */
export const ui: CardUi = {
  key: 'feelin-fab',
  Effect: FeelinFabEffect,
  art: { color: '#2ee6ff', ink: '#03141a', canvas: feelinFabCanvas, mark: feelinFabMark, credit: feelinFabArt.credit, tagline: 'Give a post a rainbow.' },
  /* Up to the rules' `stack` can be on a post; the status counts the plays there. */
  status: (plays) => `${Math.min(plays.length, feelinFab.stack!)} of ${feelinFab.stack} stacked`,
  hint: "A Feelin' Fab: the more of them on a post, the more it glows.",
  summary: 'Gives a post a rainbow behind its words. Up to three can stack, and each makes it grander.',
  describe: (_settings: Settings) =>
    `A Sweet card, common. It gives a post a rainbow behind its words, which stay as readable as ever, and each one more on the post makes it grander. Up to three can be on one post, and it stays as long as the post does. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
};
