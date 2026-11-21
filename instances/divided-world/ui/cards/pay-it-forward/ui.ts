/** Pay It Forward's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { alignmentTag } from '../../../../../engine/ui/cards/faces.ts';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { payItForward } from '../../../cards/pay-it-forward.ts';
import { setLastsWords } from '../words.ts';
import payItForwardCanvas from './art.webp?url';
import payItForwardMark from './mark.svg?url';
import payItForwardArt from './art.json';

/*
 * Pay It Forward (docs/plans/2026-11-20-refund-outcome-plan.md, task 8): Sweet's cyan, as Rope Break and the other Sweet cards. A face-down
 * Reversal that springs on a Sweet cast up to a rarity and hands the cast's card back to its caster, so its words say the flavor and the rarity
 * from its rules. It has no effect and no form: a face-down card is drawn as the engine's card back.
 */
/* Read when the words are said, not when this module loads, so they follow the rules. */
const match = () => payItForward.trap!.match!;
const flavor = () => alignmentTag(match().flavors![0]!);

export const ui: CardUi = {
  key: 'pay-it-forward',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: payItForwardCanvas, mark: payItForwardMark, credit: payItForwardArt.credit, tagline: `Give a ${flavor()} Move back to its player.` },
  summary: `Set face down on your post. The first ${flavor()} Move, up to ${match().upTo}, played on it lands, and the card goes back to its player's hand.`,
  /* As every Reversal's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  describe: (settings: Settings) =>
    `A ${alignmentTag(payItForward.alignment)} card, ${payItForward.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first ${flavor()} Move, up to ${match().upTo}, played on that post springs it and shows it: that Move lands as usual, and the card goes back to its player's hand (the card, not any price paid to play it). A Mod Bot's Move passes over it. A rarer Move passes over it, and a Move your post's ward turns away never reaches it. It springs once, or comes back to your hand after ${setLastsWords(settings)}. It costs nothing more to set.`,
};
