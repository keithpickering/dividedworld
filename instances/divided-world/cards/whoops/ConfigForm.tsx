/**
 * Whoops!'s settings in the play form (the screens' design, section 11; the Cards board's "Ink color"):
 * the card's own swatches as a radiogroup, Magenta chosen, a picker for any color, and a preview of the
 * ink with the shading it will have on the post. What it gives the form is `{ color }`, a `#rrggbb` hex,
 * which the card's `validateConfig` takes (whoops.ts); the server chooses the seed.
 *
 * The swatches are the card's art, so their colors are written here, in the instance, and nowhere in the
 * engine. The preview is a canvas: a fixed splat painted by the same `paintSplat` the post uses, on a 360 by 220
 * box, and it says its `shading()` in data attributes, so a dark ink shows its wet highlight and a pale one its outline and darker underside as they will on the post.
 */
import { useEffect, useId, useRef } from 'react';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { paintSplat } from './paint.ts';
import { luminance, makeSplat, shading } from './splat.ts';
import './whoops.css';
import { SWATCHES } from './names.ts';

/** The Cards board's six inks, in its order. */
/* The swatches are the names' (names.ts), so the readout calls an ink what the form called it. */
export { SWATCHES };

export const DEFAULT_INK = SWATCHES[0].color;

/** A splat for the preview: any seed. */
const PREVIEW = makeSplat(20261029);

/** The ink as `#rrggbb` in lowercase if it is one the preview can draw; the default if it is not. */
function drawable(color: unknown): string {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return DEFAULT_INK;
  try {
    luminance(color);
    return color.toLowerCase();
  } catch {
    return DEFAULT_INK;
  }
}

/** The preview's box, CSS px. */
const PREVIEW_BOX = { w: 360, h: 220 } as const;

function Preview({ color }: { readonly color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sh = shading(color);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, PREVIEW_BOX.w, PREVIEW_BOX.h);
    g.drawImage(paintSplat(PREVIEW, color, PREVIEW_BOX, 1), 0, 0);
  }, [color]);
  return (
    <canvas
      ref={ref} className="kb-whoops-preview" role="img" aria-label="Preview of the ink" width={PREVIEW_BOX.w} height={PREVIEW_BOX.h}
      style={{ objectFit: 'contain' }} data-kb-highlight={sh.highlight} data-kb-edge-shadow={sh.edgeShadow}
    />
  );
}

export function ConfigForm({ config, onChange, id }: ConfigFormProps) {
  const label = useId();
  const color = drawable(config?.color);
  const swatch = SWATCHES.find((s) => s.color === color);

  /* Untouched, the ink is Magenta and the play form holds it, so playing straight away plays Magenta. */
  useEffect(() => {
    if (config?.color === undefined) onChange({ color: DEFAULT_INK });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <fieldset className="kb-whoops-ink-form">
      <legend id={label} className="kb-whoops-ink-legend">Ink color</legend>
      <div role="radiogroup" aria-labelledby={label} className="kb-whoops-swatches">
        {SWATCHES.map((s) => (
          <label key={s.color} className="kb-whoops-swatch" style={{ '--kb-ink': s.color } as React.CSSProperties}>
            <input type="radio" name={`${id}-ink`} aria-label={s.name} checked={swatch?.color === s.color} onChange={() => onChange({ color: s.color })} />
            <span aria-hidden="true" />
          </label>
        ))}
      </div>
      <div className="kb-whoops-pick">
        <label htmlFor={`${id}-any`} className="kb-whoops-pick-label">Any color</label>
        <input id={`${id}-any`} type="color" value={color} onChange={(e) => onChange({ color: e.target.value.toLowerCase() })} />
        <Preview color={color} />
      </div>
    </fieldset>
  );
}
