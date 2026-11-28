/** Heads Will Roll's rules in plain words (the card's Lens and the Vending Machine), read from the card's settings with the orbit's own defaults where none is set. Apart from ui.ts so a test can read it without the art. */
import type { Settings } from '../../../../engine/rules/types.ts';
import { headsWillRoll } from '../../cards/heads-will-roll.ts';
import { setMoveWords } from '../cards/words.ts';
import { ORBIT } from './orbit.ts';

export function describeWords(settings: Settings): string {
  const s = settings.cardSettings;
  const base = s["headsWillRoll.reelBase"] ?? ORBIT.defaults.reelBase;
  return `A Pepperoni card, ${headsWillRoll.rarity}. The post's reactions come loose and roll round inside it as heads: the heaviest drift like suns and the lighter ones circle them, an Overreaction's head counting ${s["headsWillRoll.overMass"] ?? ORBIT.defaults.overMass} times as heavy. To react, a reader catches a head by pressing it, and the usual grace to take it back applies; a kind not yet on the post joins at one, and the React head, which orbits too, opens the picker with only new kinds. By keyboard or switch, press Enter or Space on a head to reel it in: the reaction lands after about ${base} seconds, a little longer for a fast head, and a second press cancels. With reduced motion the heads stand still and every press reels in. On the post's author's own screen the heads orbit but cannot be pressed. Whether the room pumps or taxes the post is settled by its reactions, as for every Pepperoni play, and the author has no clear. One fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`;
}
