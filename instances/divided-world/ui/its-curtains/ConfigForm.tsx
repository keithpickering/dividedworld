/**
 * It's Curtains' settings in the play form (docs/plans/2026-11-23-its-curtains-plan.md, Task 6; design 2.7): the fabric. A radiogroup of the six on the list (the
 * rules', `FABRICS`), each a swatch of its mid shade with its name, Red chosen when nothing is. There is no free picker: some colors do not read as cloth, and the log
 * names the fabric. What it gives the form is `{ fabric }`.
 *
 * The swatches' look is Whoops!'s stylesheet and its classes (`kb-whoops-*`), as Hot Box's form's is, so this form carries no rules of its own. It is the engine's glass,
 * out of character: the form says plainly what it sets.
 */
import { useEffect, useId } from 'react';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { FABRICS, type Fabric } from '../../cards/its-curtains.ts';
import '../../cards/whoops/whoops.css';
import { isFabric } from './fabric.ts';

export const DEFAULT_FABRIC: Fabric = 'red';

export function ConfigForm({ config, onChange, id }: ConfigFormProps) {
  const label = useId();
  const fabric = isFabric(config?.fabric) ? config.fabric : DEFAULT_FABRIC;

  /* Untouched, the curtain is Red and the play form holds it, so playing straight away plays it. */
  useEffect(() => {
    if (config?.fabric === undefined) onChange({ fabric: DEFAULT_FABRIC });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <fieldset className="kb-whoops-ink-form">
      <legend id={label} className="kb-whoops-ink-legend">Curtain fabric</legend>
      <div role="radiogroup" aria-labelledby={label} className="kb-whoops-swatches">
        {(Object.entries(FABRICS) as [Fabric, (typeof FABRICS)[Fabric]][]).map(([key, f]) => (
          <label key={key} className="kb-whoops-swatch" title={f.name} style={{ '--kb-ink': f.mid } as React.CSSProperties}>
            <input type="radio" name={`${id}-fabric`} aria-label={f.name} checked={fabric === key} onChange={() => onChange({ fabric: key })} />
            <span aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
