/** Hall Pass's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import hallPassCanvas from './art.webp?url';
import hallPassMark from './mark.svg?url';
import hallPassArt from './art.json';

/*
 * Hall Pass (docs/plans/2026-11-07-face-down-moves-design.md, section 4): Sweet's cyan, as Force Field is. A Gimmick, set face down
 * like Card Collector; what it springs on is a Mod Bot's visit, so it names no card.
 */
export const ui: CardUi = {
  key: 'hall-pass',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: hallPassCanvas, mark: hallPassMark, credit: hallPassArt.credit, tagline: "Wave a Mod Bot's visit away." },
  summary: "Set face down on your post. Ends the next Mod Bot visit to it when the visit starts.",
  /* As Card Collector's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  describe: (settings: Settings) =>
    `A Sweet card, uncommon, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The next time a Mod Bot's visit to that post starts, the visit ends there and then, before the Mod Bot does anything to the post; the visit's own posts stay. It springs once, or ends by itself after ${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'} if no visit comes. It costs nothing more to set.`,
};
