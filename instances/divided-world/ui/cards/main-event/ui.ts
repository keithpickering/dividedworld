/** Main Event's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { mainEvent } from '../../../cards/main-event.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import mainEventCanvas from './art.webp?url';
import mainEventMark from './mark.svg?url';
import mainEventArt from './art.json';
import { setMoveWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'main-event',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: mainEventCanvas, mark: mainEventMark, credit: mainEventArt.credit, tagline: 'Pin a thread to the top of its board.' },
  summary: `Cast on a thread. Pins it to the top of its board for ${spanWords(mainEvent.lasts!)}.`,
  status: "Pinned to its board's top",
  describe: (_settings: Settings) =>
    `A Sweet card, ${mainEvent.rarity}, cast on a thread from its title. For ${spanWords(mainEvent.lasts!)}, the thread is pinned above the first page of its board's list, and then it drops back to its place by itself. ${setMoveWords("the quoting post's thread")} It costs nothing more to play.`,
};
