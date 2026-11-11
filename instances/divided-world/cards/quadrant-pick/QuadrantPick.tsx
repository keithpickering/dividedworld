/**
 * The kind of reaction a card names in the play form, a radio group of the four quadrants, each labeled by the instance's own word for it
 * (`InstanceUi.quadrantLabels`, read from the engine's context): Mooch's "The reactions to mooch" and 4D Chess's "The reactions it pays on".
 * What it gives the form is `{ quadrant }`, the key the card's `validateConfig` takes. The group is native radios (`ChoicePick`), so the arrow
 * keys move between them and Space chooses, as Card Collector's faces do.
 */
import { QUADRANTS, type Quadrant } from '../../../../engine/rules/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { ChoicePick } from './ChoicePick.tsx';

export interface QuadrantPickProps {
  /** The group's name, which is its legend: what the choice is for. */
  readonly legend: string;
  /** Unique on the page, so two groups keep their choices apart. */
  readonly id: string;
  /** The quadrant chosen now, or undefined before the player has chosen. */
  readonly value: Quadrant | undefined;
  readonly onChange: (picked: { readonly quadrant: Quadrant }) => void;
}

export function QuadrantPick({ legend, id, value, onChange }: QuadrantPickProps) {
  const { ui } = useKayfa();
  return (
    <ChoicePick
      legend={legend} name={`${id}-quadrant`} value={value}
      options={QUADRANTS.map((q) => ({ value: q, label: ui.quadrantLabels[q] }))}
      onChoose={(q) => onChange({ quadrant: q as Quadrant })}
    />
  );
}
