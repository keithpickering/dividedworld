/** Publicity Tour's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { publicityTour } from '../../../cards/publicity-tour.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import publicityTourCanvas from './art.webp?url';
import publicityTourMark from './mark.svg?url';
import publicityTourArt from './art.json';
import { earnWords, FIRST_REACTORS, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'publicity-tour',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: publicityTourCanvas, mark: publicityTourMark, credit: publicityTourArt.credit, tagline: 'Earn more from positive votes.' },
  summary: `Used on your own character. For ${spanWords(publicityTour.lasts!)}, each positive vote on its posts pays ${earnWords(publicityTour)}.`,
  status: 'Earns more from positive votes',
  describe: (_settings: Settings) =>
    `A Sweet card, ${publicityTour.rarity}, used on your own character, the one playing it. For ${spanWords(publicityTour.lasts!)}, each positive vote (excited or calm) on its posts pays ${earnWords(publicityTour)}, whatever its class makes of that vote, and then it stops by itself. ${FIRST_REACTORS} It costs nothing more to use.`,
  logPlay: () => `Each positive vote on that character's posts pays up to ${earnWords(publicityTour)} until it ends.`,
};
