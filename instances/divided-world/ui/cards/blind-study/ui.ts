/** Blind Study's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { blindStudy } from '../../../cards/blind-study.ts';
import blindStudyCanvas from './art.webp?url';
import blindStudyMark from './mark.svg?url';
import blindStudyArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const BlindStudyEffect = lazy(() => import('../../blind-study/Effect.tsx').then((m) => ({ default: m.BlindStudyEffect })));

export const ui: CardUi = {
  key: 'blind-study',
  Effect: BlindStudyEffect,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: blindStudyCanvas, mark: blindStudyMark, credit: blindStudyArt.credit, tagline: 'React in the dark.' },
  summary: "Hides a post's reaction totals from everyone but its author and you.",
  status: "Hiding this post's reaction totals",
  hint: 'You can still react. The totals show when the card ends.',
  describe: () =>
    `A Pepperoni card, ${blindStudy.rarity}. For ${spanWords(blindStudy.lasts!)} the post's reaction totals are shown to nobody but the post's author and whoever played the card. Everyone can still react. Settlement counts every reaction as it always does. When the card ends the totals show. One fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  logPlay: () => `It hides the post's reaction totals for ${spanWords(blindStudy.lasts!)}.`,
};
