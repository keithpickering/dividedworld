/**
 * Mooch's setting in the play form: "The reactions to mooch", one of the four kinds of reaction, which the instance's own labels name
 * (`QuadrantPick`). What it gives the form is `{ quadrant }`, the key `mooch.validateConfig` takes; untouched, nothing is chosen and the
 * play form waits for the player to name one.
 */
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { QUADRANTS, type Quadrant } from '../../../../engine/rules/types.ts';
import { QuadrantPick } from '../quadrant-pick/QuadrantPick.tsx';

export function ConfigForm({ config, onChange, id }: ConfigFormProps) {
  const quadrant = QUADRANTS.find((q) => q === config?.quadrant) as Quadrant | undefined;
  return <QuadrantPick legend="The reactions to mooch" id={id} value={quadrant} onChange={onChange} />;
}
