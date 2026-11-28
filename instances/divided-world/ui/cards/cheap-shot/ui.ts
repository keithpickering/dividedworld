/** Cheap Shot's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { cheapShot } from '../../../cards/cheap-shot.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import cheapShotCanvas from './art.webp?url';
import cheapShotMark from './mark.svg?url';
import cheapShotArt from './art.json';
import { spanWords } from '../words.ts';

/** The rarity the pierce reaches, read from the card's rules. Every sentence below names it, so this throws rather than let a card with no pierce stand. */
const upTo = (() => {
  if (cheapShot.gimmick?.kind !== 'pierce') throw new Error('Cheap Shot has no pierce in its rules');
  return cheapShot.gimmick.upTo;
})();

export const ui: CardUi = {
  key: 'cheap-shot',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: cheapShotCanvas, mark: cheapShotMark, credit: cheapShotArt.credit, tagline: 'Your next Move slips past defenses.' },
  summary: `Used on your own character. Its next Move within ${spanWords(cheapShot.lasts!)} can't be turned away or caught by a card up to ${upTo}.`,
  status: 'Lining up a cheap shot',
  describe: (_settings: Settings) =>
    `A Salty card, ${cheapShot.rarity}, used on your own character. Its next Move within ${spanWords(cheapShot.lasts!)} gets past any card that would turn it away or catch it, up to ${upTo}. A card set face down that it gets past stays face down, and only you are told. It does nothing for a Move that lands from a quote. That Move uses it up, whatever was in the way. It costs nothing more to use.`,
  logPlay: () => `That character's next Move can't be turned away or caught by a card up to ${upTo}.`,
};
