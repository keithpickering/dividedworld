/** Stick Around's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import stickAroundCanvas from './art.webp?url';
import stickAroundMark from './mark.svg?url';
import stickAroundArt from './art.json';
import { setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const StickAroundEffect = lazy(() => import('../../stick-around/Effect.tsx').then((m) => ({ default: m.StickAroundEffect })));

export const ui: CardUi = {
  key: 'stick-around',
  Effect: StickAroundEffect,
  takeover: true,
  art: { color: '#2ee6ff', ink: '#03141a', canvas: stickAroundCanvas, mark: stickAroundMark, credit: stickAroundArt.credit, tagline: 'Hold a reader on a post.' },
  summary: 'Holds a reader on the post until they check your sentence, or break free.',
  status: 'Holding you on this post',
  describe: (settings: Settings) =>
    `A Sweet card. Once the post settles in view, whoever reads it is pulled to it and the post fills their screen: they read it there, and get out by checking the caster's sentence to certify they read it, or by scrolling hard past either end of it (or pressing Break free, or Esc) to fill a bar that drains whenever they stop, which frees them for that visit. The post's author and the caster are never held. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
};
