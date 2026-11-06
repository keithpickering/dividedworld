/**
 * The calm: a region of a page where the smoke is taken away, so the words in it stand on a
 * quieter pixel than the smoke's worst (docs/plans/2026-11-05-backfill-boards-design.md, section 3;
 * the boards draw it as a hole in the smoke, a rectangle blurred by a 60px Gaussian). One region is
 * a page's column, its aside, a dialog's body or one of the HUD's panels, not a line of text: a
 * `CalmRegion` registers its border box with the nearest `Smoke`, and the smoke draws one rect for
 * it (`.kb-smoke-calm`, calm.css), at the calm's opacity (`--kb-glass-calm-opacity`, or the
 * surface's own, `useSurfaceStyle`), blurred by `--kb-glass-calm-feather` (the phone's is half of
 * it).
 *
 * How the rect takes smoke away. The smoke is a field of layer elements, each a CSS `mask-image` of
 * its own noise over an opaque ground (Smoke.tsx). A calm is a rect in the ground's color laid on
 * the layers, inside the smoke's frame and under everything else, so it:
 *   - only takes smoke away: the layers composite over an opaque ground, so a ground-colored rect
 *     at the calm's opacity leaves exactly what masking the layers by one minus that opacity would
 *     (lerp from the smoked pixel to the ground), and the ground itself is never touched;
 *   - never paints over content, and no column's overflow clips it: it lives in the smoke, behind the
 *     page, not inside the column, so nothing clips it but the smoke's own frame;
 *   - costs a scroll nothing to move: the rect is one compositor layer and a scroll only changes its
 *     `translate`. A true SVG `<mask>` (Chromium 153 does honor `mask: url(#id)` on an HTML element)
 *     was weighed first and would be repainted, blur included, on the main thread whenever a
 *     region's offset changes, which is every scrolled frame; a canvas-drawn mask image has the
 *     same cost and a PNG encode besides.
 *
 * The rect is the region's box drawn out by `--kb-glass-calm-reach` blurs on each side (calm.css),
 * so the blur's falloff lies outside the box and every word inside the box is on the calm in full,
 * which is the model tools/check-glass-contrast.mjs reads a calm by.
 *
 * Where a region's box is. Measured in the smoke's own pixels (the frame's box, taken out of the
 * region's, over the frame's zoom: smoke-frame.ts, shared with Smoke.tsx's placement), when a
 * region is added or removed, when it or anything that can move it changes size or is inserted or
 * removed beside it, when the window resizes, when something scrolls (the page moves its regions
 * under a fixed smoke), and when an overlay says it has placed itself (`FIELD_PLACED`): all gathered
 * into one `requestAnimationFrame`, which reads every box and then writes only what changed. The
 * rect is cut to the frame and a margin past it, since what lies further off is never seen, so a
 * long page keeps no long layer. A region with no smoke around it (a screen drawn on the board, a
 * test), or with `calm={false}`, registers nothing: it is its element and no more.
 *
 * Regions are few by design: a page's column, an aside, a dialog's body, a HUD piece, never one per
 * post or per list item. Each is watched with its ancestors and the siblings before them (up to
 * SIBLINGS each), and the whole set is bounded by MAX_WATCHED, so a page that broke the rule would
 * lose the watching of its far boxes (the rects would follow scroll and resize still) and not its
 * frame rate.
 */
import {
  createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState,
  type ComponentPropsWithRef, type ElementType, type RefObject,
} from 'react';
import { FIELD_PLACED } from './field.ts';
import { fixedAncestor, frameOf } from './smoke-frame.ts';

/** What a smoke gives the regions inside it. */
interface CalmField { readonly register: (id: string, el: HTMLElement) => () => void }

const CalmContext = createContext<CalmField | null>(null);
export const CalmScope = CalmContext.Provider;

/**
 * The attribute a region's element carries, for the layout check and the contrast measurement (e2e/glass-layout-page.ts,
 * e2e/glass-text-page.ts) to find regions by. It is the same on every region, so two renderings of a screen are the same markup. The
 * region's rect in the smoke points back at its element by the property `kbRegion` (a reference, not an attribute), which is how
 * the measurement finds the rect a region draws.
 */
export const CALM_REGION = 'data-kb-calm-region';

/**
 * Further than the blur can reach from a region's edge (the reach and the blur's own tail, in blurs, times the largest feather a
 * theme sets), so a rect cut here is cut where it is no longer seen. In the smoke's own px.
 */
const MARGIN = 720;

/** The siblings before a watched box that are watched with it, and the most boxes watched for one smoke. */
const SIBLINGS = 50;
/* The budget is spent in registration order, which is fine because regions are few by design. */
export const MAX_WATCHED = 400;

type RegionProps<T extends ElementType> = {
  readonly as?: T;
  /** False for an element that is a region only in some layouts (the HUD's mask picker, inside the plate's own region on the Main board): it is then its element and nothing more. */
  readonly calm?: boolean;
} & Omit<ComponentPropsWithRef<T>, 'as'>;

/**
 * A region of calm: renders `as` (default `div`) with its props, and tells the nearest Smoke where its border box is.
 * It adds no padding and no box of its own; the calm is drawn in the smoke, not on the element.
 */
export function CalmRegion<T extends ElementType = 'div'>({ as, calm = true, ref, ...rest }: RegionProps<T>) {
  const Tag: ElementType = as ?? 'div';
  const field = useContext(CalmContext);
  const id = useId();
  /*
   * Registered by the ref and not an effect: the element a region renders can change under it (`as` changing, a busy placeholder
   * becoming the section it stands for) while the component stays, and a registration kept for an element that has gone would calm
   * a box that is not on the page.
   */
  const caller = useRef(ref);
  caller.current = ref;
  const set = useCallback((el: HTMLElement) => {
    const give = (to: HTMLElement | null) => {
      const r = caller.current;
      if (typeof r === 'function') r(to);
      else if (r) (r as { current: HTMLElement | null }).current = to;
    };
    give(el);
    const un = field && calm ? field.register(id, el) : undefined;
    /* Given back, React does not call this ref with null on the way out, so the caller's ref is cleared here. */
    return () => { un?.(); give(null); };
  }, [field, calm, id]);
  return <Tag {...rest} ref={set} {...(calm ? { [CALM_REGION]: '' } : {})} />;
}

export interface Entry { readonly id: string; readonly el: HTMLElement }

/**
 * The registry a Smoke keeps: the regions standing on it, the context value that registers them, and a ref callback for each
 * rect the smoke draws, which is where a measure writes. `frame` is the smoke's own element; `active` false (nothing is drawn)
 * measures and listens to nothing.
 */
export function useCalmRegions(frame: RefObject<HTMLElement | null>, active: boolean) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const field = useRef<CalmField>({
    register: (id, el) => {
      setEntries((was) => [...was, { id, el }]);
      return () => setEntries((was) => was.filter((e) => e.id !== id));
    },
  });
  const rects = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new WeakMap<Entry, (el: HTMLElement | null) => void>());
  /** The ref callback of an entry's rect: where a measure writes, and the rect's pointer back to its region's element. */
  const refOf = (entry: Entry) => {
    const { id, el: region } = entry;
    let f = refs.current.get(entry);
    if (!f) {
      f = (el) => {
        if (el) { rects.current.set(id, el); (el as HTMLElement & { kbRegion?: HTMLElement }).kbRegion = region; } else rects.current.delete(id);
      };
      refs.current.set(entry, f);
    }
    return f;
  };

  useLayoutEffect(() => {
    const root = frame.current;
    if (!active || !root || entries.length === 0) return;
    /* A write is made only where the value changed, so a scroll writes the place and nothing else. */
    const put = (rect: HTMLElement, name: string, value: string) => { if (rect.style.getPropertyValue(name) !== value) rect.style.setProperty(name, value); };
    const measure = () => {
      /* Every box is read before any rect is written: a frame costs one layout, not one for each region. */
      const f = frameOf(root);
      const w = f.width > 0 ? f.width / f.zoom : 0;
      const h = f.height > 0 ? f.height / f.zoom : 0;
      const read = entries.flatMap(({ id, el }) => {
        const rect = rects.current.get(id);
        return rect ? [{ rect, b: el.getBoundingClientRect() }] : [];
      });
      for (const { rect, b } of read) {
        let x = (b.left - f.left) / f.zoom;
        let y = (b.top - f.top) / f.zoom;
        let right = x + b.width / f.zoom;
        let bottom = y + b.height / f.zoom;
        /* Cut to the frame and a margin: past it the blur is not seen. A frame with no size (jsdom) cuts nothing. */
        if (w > 0) { x = Math.max(x, -MARGIN); right = Math.min(right, w + MARGIN); }
        if (h > 0) { y = Math.max(y, -MARGIN); bottom = Math.min(bottom, h + MARGIN); }
        /* A box with no size (an element laid out `display: contents`, a hidden panel) has nothing to calm. */
        const none = right - x <= 0 || bottom - y <= 0 || b.width <= 0 || b.height <= 0;
        if (rect.hidden !== none) rect.hidden = none;
        put(rect, '--kb-calm-x', `${x}px`);
        put(rect, '--kb-calm-y', `${y}px`);
        put(rect, 'width', `${Math.max(0, right - x)}px`);
        put(rect, 'height', `${Math.max(0, bottom - y)}px`);
      }
      watch();
    };
    let pending: number | null = null;
    const soon = () => { if (pending === null) pending = requestAnimationFrame(() => { pending = null; measure(); }); };
    /*
     * A region moves without changing size when something above it does: a sibling before it, or before one of its ancestors, grows or
     * shrinks (a title wraps, a line loads), or one is inserted or removed (a banner, a loaded lede). So each region is watched with its
     * ancestors and the siblings before them, which is every box whose size can move it, up to the page: sizes by a ResizeObserver,
     * and insertions and removals by a MutationObserver on the ancestors' children. The set is found again at every measure, since the
     * page it was found on has since changed, and is bounded (MAX_WATCHED).
     */
    const grown = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    const changed = typeof MutationObserver === 'function' ? new MutationObserver(soon) : null;
    grown?.observe(root);
    const sized = new Set<Element>();
    const watch = () => {
      const want = new Set<Element>();
      const parents = new Set<Element>();
      for (const e of entries) {
        for (let a: Element | null = e.el; a && a !== document.body && want.size < MAX_WATCHED; a = a.parentElement) {
          want.add(a);
          if (a !== e.el) parents.add(a);
          let n = 0;
          for (let sib = a.previousElementSibling; sib && n < SIBLINGS && want.size < MAX_WATCHED; sib = sib.previousElementSibling, n++) want.add(sib);
        }
      }
      for (const el of sized) if (!want.has(el)) { grown?.unobserve(el); sized.delete(el); }
      for (const el of want) if (!sized.has(el)) { grown?.observe(el); sized.add(el); }
      changed?.disconnect();
      for (const p of parents) changed?.observe(p, { childList: true });
    };
    measure();
    window.addEventListener('resize', soon);
    /* Page scrolling moves a region under the page's fixed smoke; inside a fixed element (the HUD, an overlay) the page scrolling moves nothing, and only a scroll in it can. */
    const fixed = fixedAncestor(root);
    const scroller: Window | HTMLElement = fixed !== null && entries.every((e) => fixed.contains(e.el)) ? fixed : window;
    scroller.addEventListener('scroll', soon, true);
    window.addEventListener(FIELD_PLACED, soon);
    /* Late faces and images move text without any box being told. */
    document.fonts?.addEventListener?.('loadingdone', soon);
    window.addEventListener('load', soon);
    return () => {
      document.fonts?.removeEventListener?.('loadingdone', soon);
      window.removeEventListener('load', soon);
      window.removeEventListener('resize', soon);
      scroller.removeEventListener('scroll', soon, true);
      window.removeEventListener(FIELD_PLACED, soon);
      grown?.disconnect();
      changed?.disconnect();
      if (pending !== null) cancelAnimationFrame(pending);
    };
  }, [frame, active, entries]);

  return { entries, field: field.current, refOf };
}
