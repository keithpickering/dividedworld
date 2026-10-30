/**
 * The glass's smoke: procedural fractal noise behind a glass surface, as the boards draw it
 * (docs/plans/2026-10-30-glass-to-the-boards-plan.md, section 6). The surface picks a recipe from
 * the instance's glass (`GlassTheme.smoke.surfaces`), each layer of which is a `<rect>` filtered
 * by feTurbulence, a color matrix that turns the noise into the layer's cloud in its constant
 * color, and a blur. The layers are drawn over an opaque ground (`--kb-glass-ground`), so a page
 * is legible before the smoke draws and when it never does.
 *
 * Under the `low` preference each layer is drawn at a third of its opacity; under `off` no smoke
 * element is drawn and the ground remains. The preference is the player's, read from the root's
 * `data-kb-smoke` (engine/ui/appearance.ts) and followed as it changes. A recipe with a `drift` is a strip wider than its
 * frame that slides back and forth (base.css holds the keyframes and stops them under reduced
 * motion, the device's or the player's override, so the strip and its crop are the same either
 * way). A recipe's `narrow` layers are drawn too, and base.css shows one set or the other at 600px. The filters work in sRGB: the boards were drawn there, and SVG's default
 * linearRGB brightens the noise, which tools/check-glass-contrast.mjs's numbers do not allow for.
 *
 * It says nothing to a screen reader. Where it is not drawn the page loses decoration only.
 *
 * A recipe may carry its own calm (the calm's opacity for its surface, default the theme's): the
 * element that holds a surface's smoke and its text takes useSurfaceStyle's style, so every calm
 * on that text is drawn at the number tools/check-glass-contrast.mjs reads it at.
 */
import { useId, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { GlassSurface, SmokeLayer } from '../types.ts';
import { useSmokeLevel } from '../appearance.ts';
import { surfaceCalm } from './apply.ts';

/** The player's smoke preference (Settings, Accessibility). */
export type SmokeLevel = 'full' | 'low' | 'off';

export interface SmokeProps {
  readonly surface: GlassSurface;
  /** Fixes the level; left out, it is the player's preference (Settings, Accessibility). */
  readonly level?: SmokeLevel;
}

/** The low preference draws a third of each layer's opacity. */
const LOW = 1 / 3;

/** A hex color's channels as the 0 to 1 numbers a color matrix takes. */
function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4)];
}

/** The matrix: every channel set to the layer's color, the alpha row the layer's own. */
function matrix(layer: SmokeLayer): string {
  const [r, g, b] = channels(layer.color);
  return [0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, ...layer.alpha].join(' ');
}

function Layers({ layers, scale, ids, name }: { readonly layers: readonly SmokeLayer[]; readonly scale: number; readonly ids: string; readonly name: string }) {
  return (
    <svg className="kb-smoke-svg" data-kb-smoke-set={name} width="100%" height="100%" preserveAspectRatio="none" focusable="false">
      <defs>
        {layers.map((l, i) => (
          <filter key={i} id={`${ids}-${name}-${i}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={l.frequency.join(' ')} numOctaves={l.octaves} seed={l.seed} />
            <feColorMatrix type="matrix" values={matrix(l)} />
            <feGaussianBlur stdDeviation={l.blur} />
          </filter>
        ))}
      </defs>
      {layers.map((l, i) => (
        <rect key={i} width="100%" height="100%" filter={`url(#${ids}-${name}-${i})`} opacity={l.opacity * scale} />
      ))}
    </svg>
  );
}

export function Smoke({ surface, level: asked }: SmokeProps) {
  const { ui } = useKayfa();
  /* The player's preference, as the root is marked (appearance.ts), unless the caller fixes one. */
  const chosen = useSmokeLevel();
  const level = asked ?? chosen;
  const ids = useId().replace(/:/g, '');
  const { recipes, surfaces } = ui.glass.smoke;
  const recipe = recipes[surfaces[surface]];
  const scale = level === 'low' ? LOW : 1;
  const drift = recipe && level !== 'off' && recipe.drift ? recipe.drift : null;
  const strip: CSSProperties | undefined = drift
    ? ({ width: `${drift.width}px`, '--kb-smoke-seconds': `${drift.seconds}s`, '--kb-smoke-travel': `${drift.travel}px` } as CSSProperties)
    : undefined;
  return (
    <div className="kb-smoke" data-kb-surface={surface} aria-hidden="true">
      <div className="kb-smoke-ground" data-kb-ground="" style={{ background: 'var(--kb-glass-ground)' }} />
      {recipe && level !== 'off' ? (
        <div className="kb-smoke-layers" data-kb-smoke={surfaces[surface]}>
          <div className="kb-smoke-strip" data-kb-drift={drift ? '' : undefined} style={strip}>
            <div className="kb-smoke-wide" data-kb-smoke-wide="">
              <Layers layers={recipe.layers} scale={scale} ids={ids} name="wide" />
            </div>
            {recipe.narrow ? (
              <div className="kb-smoke-narrow" data-kb-smoke-narrow="">
                <Layers layers={recipe.narrow} scale={scale} ids={ids} name="narrow" />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The style a surface's own element carries, beside its smoke: the calm its recipe asks for, so
 * the text on it stands in the calm the contrast guard reads it at (surfaceCalm, apply.ts). The
 * element is the one that holds both the smoke and the surface's text.
 */
export function useSurfaceStyle(surface: GlassSurface): CSSProperties | undefined {
  const { ui } = useKayfa();
  return surfaceCalm(ui.glass, surface) as CSSProperties | undefined;
}
