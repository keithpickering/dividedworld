/** Rope Break's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { alignmentTag } from '../../../../../engine/ui/cards/faces.ts';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { ropeBreak } from '../../../cards/rope-break.ts';
import { setLastsWords } from '../words.ts';
import ropeBreakCanvas from './art.webp?url';
import ropeBreakMark from './mark.svg?url';
import ropeBreakArt from './art.json';

/*
 * Rope Break (docs/plans/2026-11-15-rope-break-plan.md, task 3): Sweet's cyan, as Hall Pass is. A common Reversal, set face down; it catches
 * by flavor and rarity (`trap.match`), so its words say the flavor and rarity from its rules.
 */
export const ui: CardUi = {
  key: 'rope-break',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: ropeBreakCanvas, mark: ropeBreakMark, credit: ropeBreakArt.credit, tagline: 'Reach the ropes.' },
  summary: 'Set face down on your post. Catches the first Salty common cast there, and takes it into your hand.',
  /* As every Reversal's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  describe: (settings: Settings) =>
    `A Sweet card, ${ropeBreak.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first ${alignmentTag(ropeBreak.trap!.match!.flavors![0]!)} ${ropeBreak.trap!.match!.upTo} card cast on that post is caught: it lands as caught and does nothing, and you take it into your hand. Any other card passes over it, and a card your post's ward turns away never reaches it. It springs once, or ends by itself after ${setLastsWords(settings)}. It costs nothing more to set.`,
};
