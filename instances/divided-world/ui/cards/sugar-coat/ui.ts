/** Sugar Coat's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { sugarCoat } from '../../../cards/sugar-coat.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import sugarCoatCanvas from './art.webp?url';
import sugarCoatMark from './mark.svg?url';
import sugarCoatArt from './art.json';
import { spanWords } from '../words.ts';

/*
 * The Gimmicks of the card types design (docs/plans/2026-11-11-card-types-design.md, section 8). Their art is placeholder, in each card's flavor's color.
 */
export const ui: CardUi = {
  key: 'sugar-coat',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: sugarCoatCanvas, mark: sugarCoatMark, credit: sugarCoatArt.credit, tagline: 'Only Sweet cards land on your post.' },
  summary: `Used on your post. Turns away Salty and Pepperoni cards for ${spanWords(sugarCoat.lasts!)}.`,
  status: 'Turning away Salty and Pepperoni cards',
  describe: (settings: Settings) =>
    `A Sweet card, ${sugarCoat.rarity}, used on one of your own posts. For ${spanWords(sugarCoat.lasts!)}, every Salty or Pepperoni card cast there is turned away before it lands, whatever its rarity, and its caster is told so; a Sweet card lands as usual. It does not stop a card from being set face down there. It costs nothing more to use.`,
};
