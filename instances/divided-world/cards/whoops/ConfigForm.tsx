/**
 * Whoops!'s settings in the play form (the screens' design, section 11; the Cards board's "Ink color"):
 * the card's own swatches as a radiogroup, Magenta chosen, a picker for any color, and a preview of the
 * ink with the shading it will have on the post. What it gives the form is `{ color }`, a `#rrggbb` hex,
 * which the card's `validateConfig` takes (whoops.ts); the server chooses the seed.
 *
 * The swatches are the card's art, so their colors are written here, in the instance, and nowhere in the
 * engine. The preview draws a fixed splat in the ink with the numbers `shading()` gives it, in SVG, so a
 * dark ink shows its wet highlight and a pale one its outline and darker underside as they will on the post.
 */
import { useEffect, useId } from 'react';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
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

function Preview({ color }: { readonly color: string }) {
  const uid = useId();
  const sh = shading(color);
  const { cx, cy, rx, ry } = PREVIEW.placement;
  const { minX, maxX, minY, maxY } = PREVIEW.bounds;
  const pad = 0.06;
  return (
    <svg
      className="kb-whoops-preview" role="img" aria-label="Preview of the ink"
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={`${uid}-clip`}><path d={PREVIEW.path} /></clipPath>
        <radialGradient id={`${uid}-hi`} cx={cx - rx * 0.2} cy={cy - ry * 0.4} r={rx * 1.1} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="white" stopOpacity={sh.highlight} />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-lo`} cx={cx + rx * 0.25} cy={cy + ry * 0.55} r={rx * 1.5} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="black" stopOpacity="0" />
          <stop offset="1" stopColor="black" stopOpacity={sh.underside} />
        </radialGradient>
      </defs>
      {/* A pale ink's soft shadow around the outside edge, so it has an outline on a white page. */}
      <path
        d={PREVIEW.path} fill={color} data-kb-edge-shadow={sh.edgeShadow}
        style={{ filter: `drop-shadow(0 ${sh.edgeOffset / 360}px ${sh.edgeBlur / 360}px rgb(0 0 0 / ${sh.edgeShadow}))` }}
      />
      <g clipPath={`url(#${uid}-clip)`}>
        <rect x={minX - pad} y={minY - pad} width={maxX - minX + 2 * pad} height={maxY - minY + 2 * pad} fill={`url(#${uid}-hi)`} data-kb-highlight={sh.highlight} />
        <rect x={minX - pad} y={minY - pad} width={maxX - minX + 2 * pad} height={maxY - minY + 2 * pad} fill={`url(#${uid}-lo)`} />
      </g>
    </svg>
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
