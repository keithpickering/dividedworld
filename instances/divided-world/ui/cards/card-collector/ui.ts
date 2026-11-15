/** Card Collector's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as CardCollectorConfigForm } from '../../../cards/card-collector/ConfigForm.tsx';
import { cardCollector } from '../../../cards/card-collector.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import cardCollectorCanvas from './art.webp?url';
import cardCollectorMark from './mark.svg?url';
import cardCollectorArt from './art.json';

/*
 * The card mechanic's first plays (docs/plans/2026-11-01-card-mechanic-design.md, section 6). Pepperoni's color is the
 * board's --kb-pepperoni, with the dark ink the other faces set on theirs.
 */
export const ui: CardUi = {
  key: 'card-collector',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: cardCollectorCanvas, mark: cardCollectorMark, credit: cardCollectorArt.credit, tagline: 'Take a named card off your post.' },
  summary: `Set face down on your post, naming a card up to ${cardCollector.rarity}. Catches that card when it is cast there, and takes it into your hand.`,
  /* Shown only for a play that names this card; a Set is a card back, whose words are the engine's ("Face down on this post"). */
  status: 'Set, face down to everyone else',
  ConfigForm: CardCollectorConfigForm,
  describe: (settings: Settings) =>
    `A Salty card, ${cardCollector.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. You name the one card it catches, from the cards cast on a post, ${cardCollector.rarity} or commoner. When that card is cast on your post, it is caught: it lands as caught and does nothing, and you take it into your hand. Any other card passes over it. It springs once, or ends by itself after ${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'}. It costs nothing more to set.`,
};
