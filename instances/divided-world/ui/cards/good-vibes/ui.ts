/** Good Vibes's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { goodVibes } from '../../../cards/good-vibes.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import goodVibesCanvas from './art.webp?url';
import goodVibesMark from './mark.svg?url';
import goodVibesArt from './art.json';
import { priceAdd, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'good-vibes',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: goodVibesCanvas, mark: goodVibesMark, credit: goodVibesArt.credit, tagline: 'Salty cards cost more here.' },
  summary: `Used on a thread your own character started. For ${spanWords(goodVibes.lasts!)}, casting a Salty card there costs ${priceAdd(goodVibes)} more.`,
  status: `Salty cards cost ${priceAdd(goodVibes)} more here`,
  describe: (settings: Settings) =>
    `A Sweet card, ${goodVibes.rarity}, used on a thread your own character started. For ${spanWords(goodVibes.lasts!)}, casting a Salty card in that thread, or on a post in it, costs ${priceAdd(goodVibes)} more, for everyone, and then it stops by itself. It costs nothing more to use.`,
  logPlay: () => `Casting a Salty card in that thread costs ${priceAdd(goodVibes)} more until it ends.`,
};
