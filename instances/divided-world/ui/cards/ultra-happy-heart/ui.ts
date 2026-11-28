/** Ultra Happy Heart's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ultraHappyHeart } from '../../../cards/ultra-happy-heart.ts';
import ultraHappyHeartCanvas from './art.webp?url';
import ultraHappyHeartMark from './mark.svg?url';
import ultraHappyHeartArt from './art.json';

export const ui: CardUi = {
  key: 'ultra-happy-heart',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: ultraHappyHeartCanvas, mark: ultraHappyHeartMark, credit: ultraHappyHeartArt.credit, tagline: 'End a ban on the spot.' },
  summary: 'Cast on a banned character. Ends the ban at once.',
  status: 'Ended a ban',
  hint: "An Ultra Happy Heart ended a character's ban.",
  describe: () =>
    `A Sweet card, ${ultraHappyHeart.rarity}, cast from any post by a banned character. It ends that character's ban at once. The ban stays on the record and still counts toward how long that character's next ban is this season, and the warn bar is not touched. If the character is not banned the play is refused and you keep the card. Any character that isn't banned can play it, one of your own included. It is always cast face up. It costs nothing more to play.`,
};
