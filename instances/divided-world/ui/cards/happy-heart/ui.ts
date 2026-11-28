/** Happy Heart's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { happyHeart } from '../../../cards/happy-heart.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import happyHeartCanvas from './art.webp?url';
import happyHeartMark from './mark.svg?url';
import happyHeartArt from './art.json';

/*
 * The discipline cards (docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 9): Moves only ever cast face up, so none holds a face-down sentence, and none draws or
 * configures anything. Sweet's cyan, and Salty's pink for Tattle-Tale. Their words are the glass's: plain and true, never in character. The warn points a Happy Heart
 * takes are the lightest band's, the targeting cap is the settings', and "twice" is said only while the rules' weight is 2.
 */
export const ui: CardUi = {
  key: 'happy-heart',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: happyHeartCanvas, mark: happyHeartMark, credit: happyHeartArt.credit, tagline: 'Take a notch off a warn bar.' },
  summary: "Cast on a character. Takes the oldest points off that character's warn bar.",
  status: 'Took points off a warn bar',
  hint: "A Happy Heart took warn points off a character's bar.",
  describe: (settings: Settings) => {
    const lightest = Math.min(...Object.values(settings.warnBar.bands));
    return `A Sweet card, ${happyHeart.rarity}, cast from any post by the character it lands on. It takes the oldest ${lightest} warn point${lightest === 1 ? '' : 's'} off that character's warn bar at once, as many as the lightest breach lands, or as many as are left. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.`;
  },
};
