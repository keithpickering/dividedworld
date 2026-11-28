/** Last Word's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { lastWord } from '../../../cards/last-word.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import lastWordCanvas from './art.webp?url';
import lastWordMark from './mark.svg?url';
import lastWordArt from './art.json';
import { spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'last-word',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: lastWordCanvas, mark: lastWordMark, credit: lastWordArt.credit, tagline: 'Stop quotes of your post.' },
  summary: `Used on your post. Nobody can quote it for ${spanWords(lastWord.lasts!)}.`,
  status: 'Stopping quotes of this post',
  describe: (_settings: Settings) =>
    `A Salty card, ${lastWord.rarity}, used on one of your own posts. For ${spanWords(lastWord.lasts!)}, a post that quotes it is refused before it is written, for everyone alike, you included; a reply without the quote always goes through. It cannot share a post with a card set face down: take that card back first, and no card can be set face down there until it ends. It costs nothing more to use.`,
  logPlay: () => 'Nobody can quote that post until it ends.',
};
