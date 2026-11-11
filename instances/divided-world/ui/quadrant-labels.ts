/**
 * What this instance calls the four kinds of reaction, the board's own words for them. The label map is `InstanceUi.quadrantLabels`; it lives here so a
 * card's words (`cards.ts`) can name a quadrant a play chose, as the instance does, without `index.ts` and `cards.ts` importing each other.
 */
import type { Quadrant } from '../../../engine/rules/types.ts';

// Placeholders until the owner names them.
export const quadrantLabels: Readonly<Record<Quadrant, string>> = Object.freeze({
  excitedNegative: 'Heat',
  excitedPositive: 'Hype',
  boredNegative: 'Groan',
  calmPositive: 'Calm',
});
