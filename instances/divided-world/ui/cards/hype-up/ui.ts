/** Hype Up's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { hypeUp } from '../../../cards/hype-up.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import hypeUpCanvas from './art.webp?url';
import hypeUpMark from './mark.svg?url';
import hypeUpArt from './art.json';
import { earnWords, LARGEST, setMoveWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'hype-up',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: hypeUpCanvas, mark: hypeUpMark, credit: hypeUpArt.credit, tagline: 'Give a post a push.' },
  summary: `Cast on a post. For ${spanWords(hypeUp.lasts!)}, each positive reaction to it pays its author ${earnWords(hypeUp)}.`,
  status: 'Earns more from positive reactions',
  describe: (settings: Settings) =>
    `A Sweet card, ${hypeUp.rarity}, cast on any post, yours or another's. For ${spanWords(hypeUp.lasts!)}, each positive reaction (excited or calm) to that post pays its author ${earnWords(hypeUp)}, whatever their class makes of it, and then it stops by itself. Only reactions after it lands count, and a post carries one at a time. It takes nothing from you. ${LARGEST} A Mod Bot earns nothing, so its posts gain nothing from one. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  logPlay: () => `Each positive reaction to that post pays its author ${earnWords(hypeUp)} until it ends.`,
};
