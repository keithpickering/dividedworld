/** Required Reading's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { requiredReading } from '../../../cards/required-reading.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import requiredReadingCanvas from './art.webp?url';
import requiredReadingMark from './mark.svg?url';
import requiredReadingArt from './art.json';
import { earnWords, FIRST_REACTORS, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'required-reading',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: requiredReadingCanvas, mark: requiredReadingMark, credit: requiredReadingArt.credit, tagline: 'Earn more from calm praise on a post.' },
  summary: `Used on your post. For ${spanWords(requiredReading.lasts!)}, each calm positive vote on it pays ${earnWords(requiredReading)}.`,
  status: 'Paid more for calm positive votes',
  describe: (_settings: Settings) =>
    `A Sweet card, ${requiredReading.rarity}, used on one of your own posts. For ${spanWords(requiredReading.lasts!)}, each calm positive vote on that post pays its author ${earnWords(requiredReading)}, whatever their class makes of it, and then it stops by itself. ${FIRST_REACTORS} A post carries one at a time. It costs nothing more to use.`,
  logPlay: () => `Each calm positive vote on that post pays up to ${earnWords(requiredReading)} until it ends.`,
};
