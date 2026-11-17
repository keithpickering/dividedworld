/** Sweet Heat's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { sweetHeat } from '../../../cards/sweet-heat.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import sweetHeatCanvas from './art.webp?url';
import sweetHeatMark from './mark.svg?url';
import sweetHeatArt from './art.json';
import { earnWords, LARGEST, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'sweet-heat',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: sweetHeatCanvas, mark: sweetHeatMark, credit: sweetHeatArt.credit, tagline: 'Earn more from excited reactions.' },
  summary: `Used on your own character. For ${spanWords(sweetHeat.lasts!)}, each excited reaction to its posts, positive or negative, pays ${earnWords(sweetHeat)}.`,
  status: 'Paid more for excited reactions',
  describe: (settings: Settings) =>
    `A Pepperoni card, ${sweetHeat.rarity}, used on your own character, the one playing it. For ${spanWords(sweetHeat.lasts!)}, each excited reaction to its posts, positive or negative, pays ${earnWords(sweetHeat)}, whatever its class makes of that reaction, and then it stops by itself. It counts reactions from players who first react to a post while it is up. ${LARGEST} It costs nothing more to use.`,
  logPlay: () => `Each excited reaction to that character's posts, positive or negative, pays ${earnWords(sweetHeat)} until it ends.`,
};
