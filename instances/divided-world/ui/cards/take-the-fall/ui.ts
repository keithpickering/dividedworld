/** Take the Fall's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { takeTheFall } from '../../../cards/take-the-fall.ts';
import takeTheFallCanvas from './art.webp?url';
import takeTheFallMark from './mark.svg?url';
import takeTheFallArt from './art.json';

export const ui: CardUi = {
  key: 'take-the-fall',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: takeTheFallCanvas, mark: takeTheFallMark, credit: takeTheFallArt.credit, tagline: 'Take the blame for a post.' },
  summary: "Cast on another character's post. The next Mod Bot filing on it lands on your character instead.",
  /* A fall waits as a live play; once a filing spends it the play is no longer live, and the Lens heads the mark with what it did. */
  status: (plays) => (plays.length > 0 ? 'Waiting to take the fall' : 'Took the fall'),
  hint: 'Someone has offered to take the fall for this post.',
  describe: () =>
    `A Sweet card, ${takeTheFall.rarity}, cast face up on a post by another character. The next time a Mod Bot's visit to that post files, its warn points land on the character that played this card instead of the post's author, and a ban they bring is that character's too. Only the points and the ban move: the post keeps its notice. One fits on a post. It waits until a visit files, the first filing uses it up, and it can be played while a visit is open. The character that took the fall can appeal the filing. It costs nothing more to play.`,
};
