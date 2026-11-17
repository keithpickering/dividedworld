/** Required Reading's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { requiredReading } from '../../../cards/required-reading.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import requiredReadingCanvas from './art.webp?url';
import requiredReadingMark from './mark.svg?url';
import requiredReadingArt from './art.json';
import { earnWords, LARGEST, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'required-reading',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: requiredReadingCanvas, mark: requiredReadingMark, credit: requiredReadingArt.credit, tagline: 'Earn more from calm praise on a post.' },
  summary: `Used on your post. For ${spanWords(requiredReading.lasts!)}, each calm positive reaction to it pays ${earnWords(requiredReading)}.`,
  status: 'Paid more for calm positive reactions',
  describe: (settings: Settings) =>
    `A Sweet card, ${requiredReading.rarity}, used on one of your own posts. For ${spanWords(requiredReading.lasts!)}, each calm positive reaction to that post pays its author ${earnWords(requiredReading)}, whatever their class makes of it, and then it stops by itself. Only reactions after it is played count, and a post carries one at a time. ${LARGEST} It costs nothing more to use.`,
  logPlay: () => `Each calm positive reaction to that post pays ${earnWords(requiredReading)} until it ends.`,
};
