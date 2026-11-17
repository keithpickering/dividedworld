/** Heat Magnet's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { heatMagnet } from '../../../cards/heat-magnet.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import heatMagnetCanvas from './art.webp?url';
import heatMagnetMark from './mark.svg?url';
import heatMagnetArt from './art.json';
import { earnWords, FIRST_REACTORS, LARGEST, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'heat-magnet',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: heatMagnetCanvas, mark: heatMagnetMark, credit: heatMagnetArt.credit, tagline: 'Earn more from negative reactions.' },
  summary: `Used on your own character. For ${spanWords(heatMagnet.lasts!)}, each negative reaction to its posts pays ${earnWords(heatMagnet)}.`,
  status: 'Earns more from negative reactions',
  describe: (settings: Settings) =>
    `A Salty card, ${heatMagnet.rarity}, used on your own character, the one playing it. For ${spanWords(heatMagnet.lasts!)}, each negative reaction (excited or bored) to its posts pays ${earnWords(heatMagnet)}, whatever its class makes of that reaction, and then it stops by itself. ${FIRST_REACTORS} ${LARGEST} It costs nothing more to use.`,
  logPlay: () => `Each negative reaction to that character's posts pays ${earnWords(heatMagnet)} until it ends.`,
};
