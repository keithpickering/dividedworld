/**
 * Main Event (Sweet, rare, Cast on a thread): the thread is pinned to the top of its board's list for a day, then drops back to its
 * bump place by itself (the card mechanic's design, sections 7 and 8). It costs nothing more to play than its price at the machine.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const mainEvent: CardRules<Record<string, never>> = {
  key: 'main-event',
  name: 'Main Event',
  alignment: 'sweet',
  rarity: 'rare',
  reaches: ['thread'],
  lasts: { unit: 'day', count: 1 },
  pins: true,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(mainEvent, target, effects, now),
  validateConfig: () => ok({}),
};
