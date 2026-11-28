/** Sweet Heat's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { sweetHeat } from '../../../cards/sweet-heat.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import sweetHeatCanvas from './art.webp?url';
import sweetHeatMark from './mark.svg?url';
import sweetHeatArt from './art.json';
import { earnWords, FIRST_REACTORS, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'sweet-heat',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: sweetHeatCanvas, mark: sweetHeatMark, credit: sweetHeatArt.credit, tagline: 'Earn more from excited votes.' },
  summary: `Used on your own character. For ${spanWords(sweetHeat.lasts!)}, each excited vote on its posts, positive or negative, pays ${earnWords(sweetHeat)}.`,
  status: 'Paid more for excited votes',
  describe: (_settings: Settings) =>
    `A Pepperoni card, ${sweetHeat.rarity}, used on your own character, the one playing it. For ${spanWords(sweetHeat.lasts!)}, each excited vote on its posts, positive or negative, pays ${earnWords(sweetHeat)}, whatever its class makes of that vote, and then it stops by itself. ${FIRST_REACTORS} It costs nothing more to use.`,
  logPlay: () => `Each excited vote on that character's posts, positive or negative, pays up to ${earnWords(sweetHeat)} until it ends.`,
};
