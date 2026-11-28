/** Class Clown's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { classClown } from '../../../cards/class-clown.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import classClownCanvas from './art.webp?url';
import classClownMark from './mark.svg?url';
import classClownArt from './art.json';
import { earnWords, FIRST_REACTORS, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'class-clown',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: classClownCanvas, mark: classClownMark, credit: classClownArt.credit, tagline: 'Earn more from laughs and eye rolls.' },
  summary: `Used on your own character. For ${spanWords(classClown.lasts!)}, each 😂 and each 🙄 on its posts pays ${earnWords(classClown)}.`,
  status: 'Earns more from laughs',
  describe: (_settings: Settings) =>
    `A Pepperoni card, ${classClown.rarity}, used on your own character, the one playing it. For ${spanWords(classClown.lasts!)}, each 😂 and each 🙄 on its posts pays ${earnWords(classClown)}, whatever its class makes of that reaction, and then it stops by itself. ${FIRST_REACTORS} A 😂 counts where it is the first excited, positive reaction its player leaves on that post, and a 🙄 where it is the first bored, negative one. If another excited, positive reaction came first, a later 😂 pays nothing, and the same goes for a 🙄 after another bored, negative one. It costs nothing more to use.`,
  logPlay: () => `Each 😂 and each 🙄 on that character's posts pays up to ${earnWords(classClown)} until it ends.`,
};
