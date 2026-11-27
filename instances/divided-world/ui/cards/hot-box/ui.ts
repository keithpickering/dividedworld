/** Hot Box's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { HOT_BOX_THINS, hotBox } from '../../../cards/hot-box.ts';
import { inkName } from '../../../cards/whoops/names.ts';
import { rgbOf } from '../../../cards/whoops/splat.ts';
import { ConfigForm as HotBoxConfigForm } from '../../hot-box/ConfigForm.tsx';
import hotBoxCanvas from './art.webp?url';
import hotBoxMark from './mark.svg?url';
import hotBoxArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const HotBoxEffect = lazy(() => import('../../hot-box/Effect.tsx').then((m) => ({ default: m.HotBoxEffect })));

/*
 * Hot Box (docs/plans/2026-11-15-wave-1-cards-design.md, section 2.2): Salty's smoke over a post's words, in the caster's color,
 * cleared by a reader on their own screen (ui/hot-box/Effect.tsx); the form picks the color (ui/hot-box/ConfigForm.tsx).
 */
export const ui: CardUi = {
  key: 'hot-box',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: hotBoxCanvas, mark: hotBoxMark, credit: hotBoxArt.credit, tagline: 'Smoke out a post.' },
  summary: 'Fills a post with smoke in your color. Readers wave it away to read, and it rolls back in.',
  status: 'Smoke on this post',
  hint: 'Point at the words to part the smoke.',
  Effect: HotBoxEffect,
  ConfigForm: HotBoxConfigForm,
  /* Each play's tag takes the color of its smoke, as the hex the effect draws (a Mod Bot's may be a color's name). */
  tag: (play) => {
    const smoke = play.config.color;
    if (typeof smoke !== 'string') return undefined;
    try {
      return `#${rgbOf(smoke).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return undefined;
    }
  },
  describe: () =>
    `A Salty card, ${hotBox.rarity}. It fills a post with smoke in the color you choose. Under the smoke the words can't be read: a reader points at them to clear a patch, or holds Wave the smoke to clear the post line by line, and the smoke rolls back in. It is the same for every reader, the post's author and you included. It lasts ${spanWords(HOT_BOX_THINS)}, thinning as it goes, then clears by itself. One fits on a post at a time. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  /* A color the card cannot read says nothing, rather than the name `inkName` gives it ("ink"). */
  logPlay: (config) => {
    const smoke = (config as { color?: unknown }).color;
    if (typeof smoke !== 'string') return undefined;
    try {
      rgbOf(smoke);
    } catch {
      return undefined;
    }
    return `It smoked the post in ${inkName(smoke)}.`;
  },
};
