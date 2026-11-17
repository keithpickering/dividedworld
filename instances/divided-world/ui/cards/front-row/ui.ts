/** Front Row's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { frontRow } from '../../../cards/front-row.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import frontRowCanvas from './art.webp?url';
import frontRowMark from './mark.svg?url';
import frontRowArt from './art.json';
import { earnWords, spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'front-row',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: frontRowCanvas, mark: frontRowMark, credit: frontRowArt.credit, tagline: 'Earn more from your cards\' reactions.' },
  summary: `Used on your own character. For ${spanWords(frontRow.lasts!)}, each reaction to a card it plays pays ${earnWords(frontRow)}.`,
  status: "Earns more from its cards' reactions",
  describe: (settings: Settings) =>
    `A Pepperoni card, ${frontRow.rarity}, used on your own character, the one playing it. For ${spanWords(frontRow.lasts!)}, each reaction to a card that character plays, whatever the reaction, pays ${earnWords(frontRow)}, and then it stops by itself. A card it plays is a Move it casts, a Gimmick it uses, or a Reversal of its own when it springs. Reactions to its posts are not counted. It counts reactions from players who first react to the card while it is up. It costs nothing more to use.`,
  logPlay: () => `Each reaction to a card that character plays pays ${earnWords(frontRow)} until it ends.`,
};
