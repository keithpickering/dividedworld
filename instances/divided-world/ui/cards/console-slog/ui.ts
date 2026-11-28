/** Console Slog's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { consoleSlog } from '../../../cards/console-slog.ts';
import consoleSlogCanvas from './art.webp?url';
import consoleSlogMark from './mark.svg?url';
import consoleSlogArt from './art.json';
import { orbs, setMoveWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const ConsoleSlogEffect = lazy(() => import('../../console-slog/Effect.tsx').then((m) => ({ default: m.ConsoleSlogEffect })));

/*
 * Console Slog (docs/plans/2026-11-27-season-two-cards-design.md, section 3): Salty's pink. The post's content area is an empty command prompt, and a reader
 * mashes keys, or taps, to type it out; their place is kept in their browser and the last character out releases them on every device. Nothing about it
 * is saved on the play or sent.
 */
export const ui: CardUi = {
  key: 'console-slog',
  Effect: ConsoleSlogEffect,
  art: { color: '#ff3d7f', ink: '#14030a', canvas: consoleSlogCanvas, mark: consoleSlogMark, credit: consoleSlogArt.credit, tagline: 'Make them type it out.' },
  summary: 'Turns a post into a command prompt. A reader mashes keys to type it out.',
  status: 'Typed out by key presses',
  hint: 'Press any key, or tap, to type this post out. A steady rhythm types faster.',
  surcharge: (settings: Settings) => {
    const e = settings.economy;
    return `Long post, +${orbs(e['consoleSlog.perLength'] ?? 0)} per ${e['consoleSlog.lengthStep'] ?? 0} characters`;
  },
  describe: (settings: Settings) => {
    const e = settings.economy;
    return `A Salty card, ${consoleSlog.rarity}. It turns a post into an empty command prompt, and a reader types the post out by pressing keys or tapping. A steady rhythm types faster. Each reader works through the post once on their own screen, the post's author and whoever played the card among them, and then has it as written for good, on every device. A reader's place is kept in their browser. Links work once all of it is typed. One fits on a post. ${setMoveWords('the quoting post')} Playing it on a long post costs ${orbs(e['consoleSlog.perLength'] ?? 0)} more for every ${e['consoleSlog.lengthStep'] ?? 0} characters, ${orbs(e['consoleSlog.mostAdded'] ?? 0)} at most.`;
  },
};
