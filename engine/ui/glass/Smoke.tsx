/**
 * The glass's smoke: one field of clouds behind every glass surface (the glass polish design,
 * section 6; docs/plans/2026-10-30-glass-to-the-boards-plan.md, section 6, for what it replaced).
 * The field is the instance's (`GlassTheme.smoke.field`): each layer's noise and its drift. A
 * surface is a window onto it: it picks a recipe (`smoke.recipes`), which gives each layer a color
 * and an opacity, and draws each layer as an element whose `mask-image` is the layer's noise,
 * rasterized once for the whole page (field.ts), and whose `background-color` is the recipe's
 * color. The elements are laid over an opaque ground (`--kb-glass-ground`), so a page is legible
 * before the rasters are ready and when they never are.
 *
 * Windows line up. Each layer is as wide as the viewport (and its own drift travel more) and is
 * moved by minus its window's own place in the viewport, so the HUD's tab, the hand drawer, a glass
 * page and an overlay show the same clouds in the same place. A window's place is read when it
 * mounts, when the window resizes or scrolls, when its own box changes size (a drawer opening) and
 * when an overlay says it has placed itself (`FIELD_PLACED`). Inside a zoomed window (the HUD below
 * 1440px is drawn with CSS `zoom`) the layers are sized and moved in the window's own pixels, the
 * zoom taken from its box, so they are still the viewport's size and place on the screen.
 *
 * The drift is one clock. Each layer's animation starts at a negative delay of the time since the
 * page loaded (modulo its own run, there and back), so a window that mounts later is in phase with
 * one already drawn, and a crossing never restarts it: the delay is kept for a window's life. base.css
 * holds the keyframes and stops them under reduced motion, the device's or the player's override.
 *
 * Moving between surfaces keeps the elements and changes only their color, which base.css fades
 * over the motion feel's screen duration. A layer a recipe gives opacity 0 is still drawn, in
 * transparent color, so a crossing to a surface that uses it fades it in. Under the `low`
 * preference each layer is drawn at a third of its opacity; under `off` no smoke element is drawn
 * and the ground remains, and the rasters are given back once no window wants them. The preference
 * is the player's, read from the root's `data-kb-smoke-level` (engine/ui/appearance.ts) and
 * followed as it changes. Below 600px the field's narrow layers are drawn, in the recipe's
 * `narrowColors` or else its first colors, the same rule tools/check-glass-contrast.mjs composites.
 *
 * It says nothing to a screen reader. Where it is not drawn the page loses decoration only.
 *
 * A recipe may carry its own calm (the calm's opacity for its surface, default the theme's): the
 * element that holds a surface's smoke and its text takes useSurfaceStyle's style, so every calm
 * on that text is drawn at the number tools/check-glass-contrast.mjs reads it at.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { GlassSurface, LayerColor, SmokeRecipe } from '../types.ts';
import { useSmokeLevel } from '../appearance.ts';
import { surfaceCalm } from './apply.ts';
import { useFieldEnv, useFieldRasters } from './field.ts';

/** The player's smoke preference (Settings, Accessibility). */
export type SmokeLevel = 'full' | 'low' | 'off';

export interface SmokeProps {
  readonly surface: GlassSurface;
  /** Fixes the level; left out, it is the player's preference (Settings, Accessibility). */
  readonly level?: SmokeLevel;
}

/** The low preference draws a third of each layer's opacity. */
const LOW = 1 / 3;

/**
 * Dispatched on `window` by a surface that has moved itself (an overlay, placed by its anchor), so the
 * windows it holds measure their place again: a placement is made after its children mount.
 */
export const FIELD_PLACED = 'kb-field-placed';

/** A layer's color where a recipe names none (a recipe with fewer colors than the field has layers): none of it. */
const NONE: LayerColor = { color: '#000000', opacity: 0 };

/** `#rrggbb` at `alpha`, as the color a layer's background is. */
function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1e6) / 1e6})`;
}

/** Where a window stands in the viewport, in the window's own pixels, and how much it is zoomed. */
interface Placement { readonly x: number; readonly y: number; readonly zoom: number }
const HOME: Placement = { x: 0, y: 0, zoom: 1 };

/**
 * The element's place in the viewport, kept current. Measured in a layout effect on mount, so the
 * first frame it draws is already in place, and then on the events that move or resize a window,
 * at most once a frame. `active` false (nothing is drawn) listens to nothing.
 */
function usePlacement(ref: { readonly current: HTMLElement | null }, active: boolean): Placement {
  const [at, setAt] = useState<Placement>(HOME);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      /* Laid out at `offsetWidth` of its own pixels and drawn `r.width` wide: the zoom, 1 where either is nothing (a hidden drawer, jsdom). */
      const zoom = el.offsetWidth > 0 && r.width > 0 ? r.width / el.offsetWidth : 1;
      setAt((was) => (was.x === r.left / zoom && was.y === r.top / zoom && was.zoom === zoom ? was : { x: r.left / zoom, y: r.top / zoom, zoom }));
    };
    measure();
    let frame: number | null = null;
    const soon = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; measure(); }); };
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    /* Told by a surface that has just moved itself: measured now, not a frame later, so the clouds are never drawn for a frame at the unplaced offset. */
    window.addEventListener(FIELD_PLACED, measure);
    /* A drawer's `hidden` ending, or a box changing size, moves nothing the events above hear. */
    const grown = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    grown?.observe(el);
    return () => {
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', soon, true);
      window.removeEventListener(FIELD_PLACED, measure);
      grown?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref, active]);
  return at;
}

export function Smoke({ surface, level: asked }: SmokeProps) {
  const { ui } = useKayfa();
  /* The player's preference, as the root is marked (appearance.ts), unless the caller fixes one. */
  const chosen = useSmokeLevel();
  const level = asked ?? chosen;
  const { recipes, surfaces, field } = ui.glass.smoke;
  const recipe: SmokeRecipe | undefined = recipes[surfaces[surface]];
  const env = useFieldEnv();
  /* Below 600px, the field's narrow layers, in the recipe's narrow colors or its first colors (check-glass-contrast.mjs's narrowColorsOf). */
  const isNarrow = env.narrow && field.narrow !== undefined && field.narrow.length > 0;
  const layers = isNarrow ? field.narrow! : field.layers;
  const colors: readonly LayerColor[] = !recipe ? [] : isNarrow ? recipe.narrowColors ?? recipe.colors.slice(0, layers.length) : recipe.colors;
  const drawn = recipe !== undefined && level !== 'off' && layers.length > 0;
  const urls = useFieldRasters(drawn ? layers : null, env);
  const root = useRef<HTMLDivElement>(null);
  const at = usePlacement(root, drawn);
  /*
   * The page's clock when each layer's element was first drawn, kept for that element's life: a crossing does not restart
   * the drift. An element is drawn only once its raster is ready, so the animation starts then, and the delay must be
   * read then (a window that mounted earlier would otherwise start its layers out of phase with a later window's).
   * A layer not drawn is forgotten, so one that comes back (smoke back from Off, a width class crossed) is read afresh.
   */
  const born = useRef(new Map<string, number>());
  const scale = level === 'low' ? LOW : 1;
  if (!recipe || level === 'off') born.current.clear();
  return (
    <div ref={root} className="kb-smoke" data-kb-surface={surface} aria-hidden="true">
      <div className="kb-smoke-ground" data-kb-ground="" style={{ background: 'var(--kb-glass-ground)' }} />
      {recipe && level !== 'off' ? (
        <div className="kb-smoke-layers" data-kb-smoke={surfaces[surface]}>
          {layers.map((layer, i) => {
            const url = urls[i];
            const key = `${isNarrow ? 'n' : 'w'}${i}`;
            if (!url) { born.current.delete(key); return null; }
            if (!born.current.has(key)) born.current.set(key, (typeof performance === 'undefined' ? 0 : performance.now()) / 1000);
            const { color, opacity } = colors[i] ?? NONE;
            const { seconds, travel } = layer.drift;
            const style = {
              width: `${(env.view.width + travel) / at.zoom}px`,
              height: `${env.view.height / at.zoom}px`,
              backgroundColor: rgba(color, opacity * scale),
              '--kb-field-mask': `url("${url}")`,
              '--kb-field-x': `${-at.x}px`,
              '--kb-field-y': `${-at.y}px`,
              '--kb-field-seconds': `${seconds}s`,
              '--kb-field-travel': `${travel / at.zoom}px`,
              '--kb-field-delay': `-${born.current.get(key)! % (2 * seconds)}s`,
            } as CSSProperties;
            return <div key={key} className="kb-smoke-layer" style={style} />;
          })}
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
