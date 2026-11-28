/** Super Happy Heart's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { superHappyHeart } from '../../../cards/super-happy-heart.ts';
import superHappyHeartCanvas from './art.webp?url';
import superHappyHeartMark from './mark.svg?url';
import superHappyHeartArt from './art.json';

export const ui: CardUi = {
  key: 'super-happy-heart',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: superHappyHeartCanvas, mark: superHappyHeartMark, credit: superHappyHeartArt.credit, tagline: 'Empty a warn bar.' },
  summary: "Cast on a character. Empties that character's warn bar.",
  status: 'Emptied a warn bar',
  hint: "A Super Happy Heart emptied a character's warn bar.",
  describe: () =>
    `A Sweet card, ${superHappyHeart.rarity}, cast from any post by the character it lands on. It takes every point off that character's warn bar at once. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.`,
};
