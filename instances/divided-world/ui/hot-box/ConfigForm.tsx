/**
 * Hot Box's settings in the play form (hot box plan, Task 5; design 2.2): the smoke's color. Whoops!'s six swatches
 * as a radiogroup with the first chosen, and a picker for any color, laid out as Whoops!'s ink form is without its
 * splat preview. What it gives the form is `{ color }`, a `#rrggbb` hex.
 *
 * The swatches' look is Whoops!'s stylesheet and its classes (`kb-whoops-*`): the same six colors drawn the same way,
 * so this form carries no rules of its own.
 */
import { useEffect, useId } from 'react';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { SWATCHES } from '../../cards/whoops/names.ts';
import '../../cards/whoops/whoops.css';

export const DEFAULT_COLOR = SWATCHES[0].color;

/** The color as lowercase `#rrggbb` if it is one; the default if it is not. */
function hexOf(color: unknown): string {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_COLOR;
}

export function ConfigForm({ config, onChange, id }: ConfigFormProps) {
  const label = useId();
  const color = hexOf(config?.color);
  const swatch = SWATCHES.find((s) => s.color === color);

  /* Untouched, the smoke is the first swatch and the play form holds it, so playing straight away plays it. */
  useEffect(() => {
    if (config?.color === undefined) onChange({ color: DEFAULT_COLOR });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <fieldset className="kb-whoops-ink-form">
      <legend id={label} className="kb-whoops-ink-legend">Smoke color</legend>
      <div role="radiogroup" aria-labelledby={label} className="kb-whoops-swatches">
        {SWATCHES.map((s) => (
          <label key={s.color} className="kb-whoops-swatch" style={{ '--kb-ink': s.color } as React.CSSProperties}>
            <input type="radio" name={`${id}-smoke`} aria-label={s.name} checked={swatch?.color === s.color} onChange={() => onChange({ color: s.color })} />
            <span aria-hidden="true" />
          </label>
        ))}
      </div>
      <div className="kb-whoops-pick">
        <label htmlFor={`${id}-any`} className="kb-whoops-pick-label">Any color</label>
        <input id={`${id}-any`} type="color" value={color} onChange={(e) => onChange({ color: e.target.value.toLowerCase() })} />
      </div>
    </fieldset>
  );
}
