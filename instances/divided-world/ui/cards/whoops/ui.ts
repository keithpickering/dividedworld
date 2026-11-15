/** Whoops!'s entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as WhoopsConfigForm } from '../../../cards/whoops/ConfigForm.tsx';
import { rgbOf } from '../../../cards/whoops/splat.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import whoopsCanvas from './art.webp?url';
import whoopsMark from './mark.svg?url';
import whoopsArt from './art.json';
import { orbs, setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const WhoopsEffect = lazy(() => import('../../../cards/whoops/Effect.tsx').then((m) => ({ default: m.Effect })));

export const ui: CardUi = {
  key: 'whoops',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: whoopsCanvas, mark: whoopsMark, credit: whoopsArt.credit, tagline: 'Splat a post in ink.' },
  hint: 'Drag across the ink to scrub it off your screen.',
  status: 'Ink on this post',
  summary: 'Splats a post in your ink. Readers scrub it; only the author can wash it.',
  Effect: WhoopsEffect,
  ConfigForm: WhoopsConfigForm,
  /* The play form's name for what a long post adds, said from the rules' own numbers. */
  surcharge: (settings: Settings) => {
    const e = settings.economy;
    return `Long post, +${orbs(e['whoops.perLength'] ?? 0)} per ${e['whoops.lengthStep'] ?? 0} characters`;
  },
  /*
   * Each play's tag and chip takes the color it splatted for its border and glow (the plays-on-a-post design, section 5):
   * the tag on top is the most drawn play, not always the top ink. An ink the card cannot read keeps the alignment's.
   * A Mod Bot's ink may be a color's name, so the tag is given as the hex the splat draws (the engine reads hex).
   */
  tag: (play) => {
    const ink = play.config.color;
    if (typeof ink !== 'string') return undefined;
    try {
      return `#${rgbOf(ink).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return undefined;
    }
  },
  describe: (settings: Settings) => {
    const e = settings.economy;
    return `A Salty card. It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink. ${setMoveWords('the quoting post')} Playing it on a long post costs ${orbs(e['whoops.perLength'] ?? 0)} more for every ${e['whoops.lengthStep'] ?? 0} characters, ${orbs(e['whoops.mostAdded'] ?? 0)} at most.`;
  },
  /* The author's save that washes a layer clean (the rules' `clean`, instances/divided-world/cards/whoops.ts) is the one the log names. */
  logSave: (state: unknown) => (typeof state === 'object' && state !== null && (state as { clean?: unknown }).clean === true
    ? { what: 'Washed clean', said: 'The layer is washed clean, for every reader.' }
    : undefined),
};
