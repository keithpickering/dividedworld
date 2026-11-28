/** Thick Skin's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { thickSkin } from '../../../cards/thick-skin.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { fractionWords } from '../../../../../engine/ui/copy-words.ts';
import thickSkinCanvas from './art.webp?url';
import thickSkinMark from './mark.svg?url';
import thickSkinArt from './art.json';
import { spanWords } from '../words.ts';

/**
 * The cushion's share in words, read from the card's rules: "half" is the rules' own word for it, and "halved" and "half as much" are said
 * only of a share of one half. A share with any other word makes every sentence below a mistake, so this throws rather than let one stand.
 */
const { half, halved } = (() => {
  if (thickSkin.gimmick?.kind !== 'cushion') throw new Error('Thick Skin has no cushion in its rules');
  const word = fractionWords(thickSkin.gimmick.share);
  if (word !== 'half') throw new Error(`Thick Skin's sentences say "halved" and "half as much", and its share is ${word}`);
  return { half: word, halved: 'halved' };
})();

export const ui: CardUi = {
  key: 'thick-skin',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: thickSkinCanvas, mark: thickSkinMark, credit: thickSkinArt.credit, tagline: 'Lose half as much from reactions.' },
  summary: `Used on your own character. For ${spanWords(thickSkin.lasts!)}, what it loses from reactions is ${halved}.`,
  status: 'Loses half as much from reactions',
  describe: (_settings: Settings) =>
    `A Sweet card, ${thickSkin.rarity}, used on your own character, the one playing it. For ${spanWords(thickSkin.lasts!)}, whenever a reaction to something that character did costs it Aura, ${half} of that loss is given back, and then it stops by itself. A loss counted from a whole settlement window's reactions, and not from one reaction, is ${halved} where this card is still up when that window ends. It changes nothing the character earns, and nothing it loses for any other reason. It costs nothing more to use.`,
  logPlay: () => `What that character loses from reactions is ${halved} until it ends.`,
};
