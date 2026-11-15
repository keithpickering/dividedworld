/** Hype Up's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { hypeUp } from '../../../cards/hype-up.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import hypeUpCanvas from './art.webp?url';
import hypeUpMark from './mark.svg?url';
import hypeUpArt from './art.json';
import { earnWords, setMoveWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'hype-up',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: hypeUpCanvas, mark: hypeUpMark, credit: hypeUpArt.credit, tagline: 'Give a post a push.' },
  summary: `Cast on a post. For ${spanWords(hypeUp.lasts!)}, what it earns from positive reactions is ${earnWords(hypeUp)}. A loss is never made worse.`,
  status: 'Earns more from positive reactions',
  describe: (settings: Settings) =>
    `A Sweet card, ${hypeUp.rarity}, cast on any post, yours or another's. For ${spanWords(hypeUp.lasts!)}, whatever that post earns its author from a positive reaction (excited or calm) is ${earnWords(hypeUp)}, and then it stops by itself. Only reactions after it lands count, and a post carries one at a time. It never makes a loss worse, and it takes nothing from you. It does not add to the author's own Publicity Tour: while both are up, the larger applies. A Mod Bot earns nothing, so its posts gain nothing from one. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  logPlay: () => `What that post earns from positive reactions is ${earnWords(hypeUp)} until it ends.`,
};
