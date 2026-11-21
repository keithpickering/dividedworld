/** Pop Steal's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { alignmentTag } from '../../../../../engine/ui/cards/faces.ts';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { popSteal } from '../../../cards/pop-steal.ts';
import { setLastsWords } from '../words.ts';
import popStealCanvas from './art.webp?url';
import popStealMark from './mark.svg?url';
import popStealArt from './art.json';

/*
 * Pop Steal (docs/plans/2026-11-20-class-balance-design.md, section 4): Salty's pink, as Card Collector's, and Rope Break's mirror. A common
 * Reversal, set face down; it catches by flavor and rarity (`trap.match`), so its words say the flavor and rarity from its rules.
 */
export const ui: CardUi = {
  key: 'pop-steal',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: popStealCanvas, mark: popStealMark, credit: popStealArt.credit, tagline: 'Steal a Sweet Move.' },
  summary: 'Set face down on your post. The first common Sweet Move played on it is caught: it does nothing, and the card goes to your hand.',
  /* As every Reversal's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  describe: (settings: Settings) =>
    `A Salty card, ${popSteal.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first ${popSteal.trap!.match!.upTo} ${alignmentTag(popSteal.trap!.match!.flavors![0]!)} Move played on that post is caught: it lands as caught and does nothing, and you take it into your hand. Any other card passes over it, and a card your post's ward turns away never reaches it. It springs once, or ends by itself after ${setLastsWords(settings)}. It costs nothing more to set.`,
};
