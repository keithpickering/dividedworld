/** Glitter Bomb's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { glitterBomb } from '../../../cards/glitter-bomb.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import glitterBombCanvas from './art.webp?url';
import glitterBombMark from './mark.svg?url';
import glitterBombArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const GlitterBombEffect = lazy(() => import('../../glitter-bomb/Effect.tsx').then((m) => ({ default: m.GlitterBombEffect })));

/*
 * The first cards beyond a post (docs/plans/2026-11-01-card-mechanic-design.md, section 8). Glitter Bomb is Pepperoni's color; Main Event is Sweet's, as Force Field is.
 */
export const ui: CardUi = {
  key: 'glitter-bomb',
  Effect: GlitterBombEffect,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: glitterBombCanvas, mark: glitterBombMark, credit: glitterBombArt.credit, tagline: 'Make a character sparkle.' },
  summary: 'Cast on a character. Every post by that character sparkles for a week, and posts written in that time keep it.',
  status: 'Sparkling every post by that character',
  logPlay: () => 'Posts that character writes before it ends keep their sparkle after it ends.',
  describe: (settings: Settings) =>
    `A Pepperoni card, ${glitterBomb.rarity}, cast from any post by the character it lands on. For ${spanWords(glitterBomb.lasts!)}, every one of that character's posts sparkles, wherever it is. When the week is up, the posts written during it keep their sparkle after it ends, settled; every other post stops. It falls on that mask alone. ${setMoveWords("the quoting post's character")} It costs nothing more to play.`,
};
