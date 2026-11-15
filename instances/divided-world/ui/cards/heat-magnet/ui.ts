/** Heat Magnet's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { heatMagnet } from '../../../cards/heat-magnet.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import heatMagnetCanvas from './art.webp?url';
import heatMagnetMark from './mark.svg?url';
import heatMagnetArt from './art.json';
import { earnWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'heat-magnet',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: heatMagnetCanvas, mark: heatMagnetMark, credit: heatMagnetArt.credit, tagline: 'Earn more from negative reactions.' },
  summary: `Used on your own character. For ${spanWords(heatMagnet.lasts!)}, what it earns from negative reactions is ${earnWords(heatMagnet)}. A loss is never made worse.`,
  status: 'Earns more from negative reactions',
  describe: (settings: Settings) =>
    `A Salty card, ${heatMagnet.rarity}, used on your own character, the one playing it. For ${spanWords(heatMagnet.lasts!)}, whatever that character earns from a negative reaction (excited or bored) to its posts is ${earnWords(heatMagnet)}, and then it stops by itself. It never makes a loss worse. It costs nothing more to use.`,
  logPlay: () => `What that character earns from negative reactions is ${earnWords(heatMagnet)} until it ends.`,
};
