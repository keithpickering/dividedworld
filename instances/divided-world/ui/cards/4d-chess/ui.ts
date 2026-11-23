/** 4D Chess's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as FourDChessConfigForm } from '../../../cards/4d-chess/ConfigForm.tsx';
import { fourDChess } from '../../../cards/4d-chess.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import fourDChessCanvas from './art.webp?url';
import fourDChessMark from './mark.svg?url';
import fourDChessArt from './art.json';
import { rideShare, setLastsWords } from '../words.ts';

export const ui: CardUi = {
  key: '4d-chess',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: fourDChessCanvas, mark: fourDChessMark, credit: fourDChessArt.credit, tagline: 'Get paid for the Move you saw coming.' },
  summary: `Set face down on your post, naming a Move up to ${fourDChess.rarity} and a reaction. If that Move lands there, those reactions pay you.`,
  /* As every Reversal's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  ConfigForm: FourDChessConfigForm,
  describe: (settings: Settings) =>
    `A Salty card, ${fourDChess.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. You name one Move, ${fourDChess.rarity} or commoner, and one of the four kinds of reaction. When that Move is cast on your post, this springs and shows itself; the Move lands as usual and its caster keeps everything it earns, and from then on each vote of your kind on that Move pays you ${rideShare()}. A Move cast by one of your own characters springs it and pays you nothing. It springs once, or comes back to your hand after ${setLastsWords(settings)} if nothing springs it. It costs nothing more to set.`,
};
