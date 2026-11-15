/** Class Clown's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { classClown } from '../../../cards/class-clown.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import classClownCanvas from './art.webp?url';
import classClownMark from './mark.svg?url';
import classClownArt from './art.json';
import { earnWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'class-clown',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: classClownCanvas, mark: classClownMark, credit: classClownArt.credit, tagline: 'Earn more from laughs and eye rolls.' },
  summary: `Used on your own character. For ${spanWords(classClown.lasts!)}, what it earns from 😂 and 🙄 is ${earnWords(classClown)}. A loss is never made worse.`,
  status: 'Earns more from laughs',
  describe: (settings: Settings) =>
    `A Pepperoni card, ${classClown.rarity}, used on your own character, the one playing it. For ${spanWords(classClown.lasts!)}, whatever that character earns from a 😂 or a 🙄 on its posts is ${earnWords(classClown)}, and then it stops by itself. It never makes a loss worse. It costs nothing more to use.`,
  logPlay: () => `What that character earns from 😂 and 🙄 is ${earnWords(classClown)} until it ends.`,
};
