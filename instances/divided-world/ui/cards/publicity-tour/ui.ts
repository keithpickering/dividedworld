/** Publicity Tour's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { publicityTour } from '../../../cards/publicity-tour.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import publicityTourCanvas from './art.webp?url';
import publicityTourMark from './mark.svg?url';
import publicityTourArt from './art.json';
import { earnWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'publicity-tour',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: publicityTourCanvas, mark: publicityTourMark, credit: publicityTourArt.credit, tagline: 'Earn more from positive reactions.' },
  summary: `Used on your own character. For ${spanWords(publicityTour.lasts!)}, what it earns from positive reactions is ${earnWords(publicityTour)}. A loss is never made worse.`,
  status: 'Earns more from positive reactions',
  describe: (settings: Settings) =>
    `A Sweet card, ${publicityTour.rarity}, used on your own character, the one playing it. For ${spanWords(publicityTour.lasts!)}, whatever that character earns from a positive reaction (excited or calm) to its posts is ${earnWords(publicityTour)}, and then it stops by itself. It never makes a loss worse. It costs nothing more to use.`,
  logPlay: () => `What that character earns from positive reactions is ${earnWords(publicityTour)} until it ends.`,
};
