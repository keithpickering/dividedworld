/** Whoopee Cushion's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { alignmentTag } from '../../../../../engine/ui/cards/faces.ts';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { whoopeeCushion } from '../../../cards/whoopee-cushion.ts';
import { cushionShare, setLastsWords } from '../words.ts';
import whoopeeCushionCanvas from './art.webp?url';
import whoopeeCushionMark from './mark.svg?url';
import whoopeeCushionArt from './art.json';

/*
 * Whoopee Cushion (docs/plans/2026-11-20-whoopee-cushion-plan.md, task 6): Pepperoni's face colors, as THIS's and Whodunnit's. A common
 * Reversal that rides any common cast, whatever its flavor, so its words say the flavor, rarity and share from its rules.
 */
export const ui: CardUi = {
  key: 'whoopee-cushion',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: whoopeeCushionCanvas, mark: whoopeeCushionMark, credit: whoopeeCushionArt.credit, tagline: 'Get paid when a common card lands.' },
  summary: `Set face down on your post. The first ${whoopeeCushion.rarity} cast there lands, and every reaction to it pays you ${cushionShare()}.`,
  /* As every Reversal's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  describe: (settings: Settings) =>
    `A ${alignmentTag(whoopeeCushion.alignment)} card, ${whoopeeCushion.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first ${whoopeeCushion.rarity} card cast on that post, of any flavor, springs it and shows it: that card lands as usual and its caster keeps everything it earns, and from then on each vote it draws, of any kind, pays you ${cushionShare()}. A card cast by one of your own characters springs it and pays you nothing. A rarer card passes over it, and a card your post's ward turns away never reaches it. It springs once, or comes back to your hand after ${setLastsWords(settings)} if nothing springs it. It costs nothing more to set.`,
};
