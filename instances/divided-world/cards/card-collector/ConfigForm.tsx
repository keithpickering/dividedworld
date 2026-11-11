/**
 * Card Collector's setting in the play form (the face-down Moves design, section 8): "The card it waits for", a radio group of small card
 * faces (`FacePick`), one for every card of the instance that is cast on a post at or below Card Collector's own rarity, not only the ones in the
 * setter's hand. The engine hands the cast ones over as `castable` (a Gimmick or a Reversal is never among them, since only a card cast
 * on a post can be caught); the rarity is read from the card's rules. What it gives the form is `{ card }`, the key
 * `cardCollector.validateConfig` takes (card-collector.ts). The group is native radios, so the arrow keys move between the
 * faces and Space chooses; the chosen face is outlined, and its tag and rarity are words as well as a shape.
 */
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { cardCollector } from '../card-collector.ts';
import { FacePick } from './FacePick.tsx';

export function ConfigForm({ config, onChange, id, castable = [] }: ConfigFormProps) {
  /* Untouched, nothing is chosen: the play form waits for a card, and the player names it. */
  const chosen = typeof config?.card === 'string' ? config.card : undefined;
  return <FacePick legend="The card it waits for" name={`${id}-catch`} castable={castable} upTo={cardCollector.rarity} chosen={chosen} onChoose={(card) => onChange({ card })} />;
}
