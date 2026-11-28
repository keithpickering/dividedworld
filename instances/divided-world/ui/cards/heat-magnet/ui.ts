/** Heat Magnet's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { heatMagnet } from '../../../cards/heat-magnet.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import heatMagnetCanvas from './art.webp?url';
import heatMagnetMark from './mark.svg?url';
import heatMagnetArt from './art.json';
import { earnWords, FIRST_REACTORS, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'heat-magnet',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: heatMagnetCanvas, mark: heatMagnetMark, credit: heatMagnetArt.credit, tagline: 'Earn more from negative votes.' },
  summary: `Used on your own character. For ${spanWords(heatMagnet.lasts!)}, each negative vote on its posts pays ${earnWords(heatMagnet)}.`,
  status: 'Earns more from negative votes',
  describe: (_settings: Settings) =>
    `A Salty card, ${heatMagnet.rarity}, used on your own character, the one playing it. For ${spanWords(heatMagnet.lasts!)}, each negative vote (excited or bored) on its posts pays ${earnWords(heatMagnet)}, whatever its class makes of that vote, and then it stops by itself. ${FIRST_REACTORS} It costs nothing more to use.`,
  logPlay: () => `Each negative vote on that character's posts pays up to ${earnWords(heatMagnet)} until it ends.`,
};
