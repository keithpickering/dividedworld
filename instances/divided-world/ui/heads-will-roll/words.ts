/** Heads Will Roll's rules in plain words (the card's Lens and the Vending Machine), read from the card's settings with the orbit's own defaults where none is set. Apart from ui.ts so a test can read it without the art. */
import type { Settings } from '../../../../engine/rules/types.ts';
import { headsWillRoll } from '../../cards/heads-will-roll.ts';
import { setMoveWords } from '../cards/words.ts';
import { ORBIT } from './orbit.ts';

export function describeWords(settings: Settings): string {
  const base = settings.cardSettings["headsWillRoll.reelBase"] ?? ORBIT.defaults.reelBase;
  return `A Pepperoni card, ${headsWillRoll.rarity}. The post's reactions come loose as heads. To react, a reader catches a head by pressing it, and the usual grace to take it back applies; a kind not yet on the post joins at one, and the React head opens the picker with only new kinds. By keyboard or switch, press Enter or Space on a head to reel it in: the reaction lands after about ${base} seconds, and a second press cancels. With reduced motion the heads stand still and every press reels in. On the post's author's own screen the heads cannot be pressed. Whether the room pumps or taxes the post is settled by its reactions, as for every Pepperoni play, and the author has no clear. One fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`;
}
