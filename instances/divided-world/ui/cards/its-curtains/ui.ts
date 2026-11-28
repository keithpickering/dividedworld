/** It's Curtains' entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { FABRICS, itsCurtains } from '../../../cards/its-curtains.ts';
import { ConfigForm } from '../../its-curtains/ConfigForm.tsx';
import { isFabric } from '../../its-curtains/fabric.ts';
import itsCurtainsCanvas from './art.webp?url';
import itsCurtainsMark from './mark.svg?url';
import itsCurtainsArt from './art.json';
import { orbs, setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect slot draws one inside a Suspense whose
 * fallback is the post's words (engine/ui/cards/Effects.tsx). The cover the engine mounts over a thread's row loads the same way.
 */
const ItsCurtainsEffect = lazy(() => import('../../its-curtains/Effect.tsx').then((m) => ({ default: m.ItsCurtainsEffect })));
const ItsCurtainsCover = lazy(() => import('../../its-curtains/Cover.tsx').then((m) => ({ default: m.ItsCurtainsCover })));

/*
 * It's Curtains (docs/plans/2026-11-23-its-curtains-design.md; the plan's Task 6): Pepperoni's red. A curtain in a fabric the caster chose hangs over a post, author and
 * all, and each reader opens it for themselves with a press. The engine draws the cover over a thread's row (`coversRow`, ui/its-curtains/Cover.tsx); where a post has no
 * row the effect covers the content area itself (ui/its-curtains/Effect.tsx). Nothing about who opened it is saved or sent.
 */
export const ui: CardUi = {
  key: 'its-curtains',
  Effect: ItsCurtainsEffect,
  Cover: ItsCurtainsCover,
  coversRow: true,
  ConfigForm,
  sounds: ['its-curtains.drumroll', 'its-curtains.crash', 'its-curtains.whoosh', 'its-curtains.tada'],
  art: { color: '#f00000', ink: '#1a0000', canvas: itsCurtainsCanvas, mark: itsCurtainsMark, credit: itsCurtainsArt.credit, tagline: 'Hide it behind a curtain. Ta-da!' },
  summary: 'Hangs a curtain over a post, author and all. Each reader opens it with a press, to a drumroll.',
  status: (plays) => (plays.length > 1 ? `${plays.length} curtains stacked` : 'Behind a curtain'),
  hint: 'Press the curtain to see the post.',
  /* Each play's tag takes the mid shade of its fabric; a fabric the screens do not know says nothing. */
  tag: (play) => {
    const fabric = (play.config as { fabric?: unknown }).fabric;
    return isFabric(fabric) ? FABRICS[fabric].mid : undefined;
  },
  describe: (settings) =>
    `A Pepperoni card, ${itsCurtains.rarity}. It hangs a curtain in the fabric you choose over a post, author and all. Each reader opens it for themselves with one press, and the post's effects start only then. Up to ${itsCurtains.stack} curtains stack, each opened in turn; the second costs ${orbs(settings.economy['itsCurtains.secondAdd'] ?? 0)} more to play and the third ${orbs(settings.economy['itsCurtains.thirdAdd'] ?? 0)} more. ${setMoveWords('the quoting post')}`,
  logPlay: (config) => {
    const fabric = (config as { fabric?: unknown }).fabric;
    return isFabric(fabric) ? `It hung a ${FABRICS[fabric].name} curtain over the post.` : undefined;
  },
};
