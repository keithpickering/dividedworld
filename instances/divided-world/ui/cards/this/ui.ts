/** THIS's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { WORDS as THIS_WORDS, thisCard, type ThisConfig } from '../../../cards/this.ts';
import { ConfigForm as ThisConfigForm } from '../../this/ConfigForm.tsx';
import thisCanvas from './art.webp?url';
import thisMark from './mark.svg?url';
import thisArt from './art.json';
import { setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const ThisEffect = lazy(() => import('../../this/Effect.tsx').then((m) => ({ default: m.ThisEffect })));

/*
 * THIS (docs/plans/2026-11-13-this-design.md): Pepperoni's color. A note under the words the caster points at: THIS, an arrow and the
 * caster's own handwriting (ui/this/Effect.tsx); the form picks the phrase and the words (ui/this/ConfigForm.tsx).
 */
export const ui: CardUi = {
  key: 'this',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: thisCanvas, mark: thisMark, credit: thisArt.credit, tagline: 'Point at it.' },
  summary: 'Point at a line of a post and say something about it.',
  status: 'Notes on its words',
  hint: 'Someone pointed at these words. The Lens says who.',
  Effect: ThisEffect,
  ConfigForm: ThisConfigForm,
  describe: () =>
    `A Pepperoni card, ${thisCard.rarity}. You choose words in a post, and the post gets a note under them: THIS, an arrow, and up to ${THIS_WORDS.most} characters of your own after it, or none. The note names nobody; the Lens says who played it. Up to ${thisCard.stack} fit on a post, and they stay. If the author edits the words out, the note moves to the foot of the post and quotes them. ${setMoveWords('the quoting post')} A set one lands only when the quote's own words hold its phrase. It costs nothing more to play.`,
  logPlay: (config) => {
    const { phrase, words } = config as Partial<ThisConfig>;
    return `It pointed at “${phrase ?? ''}” and wrote “THIS${words ? ` ${words}` : ''}”.`;
  },
};
