/**
 * 4D Chess's settings in the play form: "The Move it waits for", Card Collector's faces (`FacePick`) for every card of the instance cast on a post
 * at or below 4D Chess's own rarity, read from its rules, then "The reactions it pays on", the four kinds of reaction (`QuadrantPick`).
 * What it gives the form is `{ card, quadrant }`, the keys `fourDChess.validateConfig` takes: each choice keeps the other, and the rules refuse it
 * until both are made, which the play form says in the rules' words.
 */
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { QUADRANTS, type Quadrant } from '../../../../engine/rules/types.ts';
import { fourDChess } from '../4d-chess.ts';
import { FacePick } from '../card-collector/FacePick.tsx';
import { QuadrantPick } from '../quadrant-pick/QuadrantPick.tsx';

export function ConfigForm({ config, onChange, id, castable = [] }: ConfigFormProps) {
  const card = typeof config?.card === 'string' ? config.card : undefined;
  const quadrant = QUADRANTS.find((q) => q === config?.quadrant) as Quadrant | undefined;
  return (
    <>
      <FacePick legend="The Move it waits for" name={`${id}-move`} castable={castable} upTo={fourDChess.rarity} chosen={card} onChoose={(key) => onChange({ ...(quadrant ? { quadrant } : {}), card: key })} />
      <QuadrantPick legend="The reactions it pays on" id={id} value={quadrant} onChange={(picked) => onChange({ ...(card ? { card } : {}), ...picked })} />
    </>
  );
}
