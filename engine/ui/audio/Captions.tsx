/**
 * The caption stack (the sound stack plan, Task 3; look A of docs/research/2026-11-11-laugh-track-bench/01-bench.html): the words of what the page plays,
 * for a reader with the sound off and for one with it on. A stack of up to three lines above the HUD's seam, newest nearest the HUD, each a slim chamfered
 * glass tray holding the words in white monospace capitals on black, led by a dot in the caption's ink where it has one, and followed by `×N` where the
 * same words have been said N times. A held caption (a loop's build-up) is italic and stands among them. The stored words stay sentence case; the
 * capitals are CSS.
 *
 * The lines move as the toasts move (alerts/Toasts.tsx): each enters with a fade and a rise of the feel's distance and leaves with a fade, with the times
 * and ease of the glass's motion feel, and the rest slide to make room. With the feel off (the Motion setting, or the device's reduced motion) a line is a
 * plain element that appears and goes where it stands.
 *
 * It is always in the page with a polite live region, visually hidden, as the toasts' announcer is. The region holds the store's announcements
 * (captions.ts): a new say's words at once, and for a line said again and again its total ("text, N times") once the repeats go quiet or the line
 * leaves; a hold announces nothing, so a build-up does not chatter. The drawn stack is hidden from a screen reader so nothing is read twice.
 *
 * It lets every press through. While lines show it measures itself and sets `--kb-captions-measured` (the stack's height and the gap under it) on the
 * root, so the toasts stand above it; cleared when it holds no line. Over a dialog (`.kb-glass-overlay`, whose scrim is above the stack's layer) the whole
 * stack is raised above the scrim, and where its resting place meets the dialog's box (always, for a phone's sheet) it is lifted as one box to rest above
 * the box (`--kb-captions-lift`); where no room is left above the box it stays under the scrim, announced all the same (place-over.ts).
 * `--kb-captions-measured` is the stack's resting place either way, so the toasts do not move. A caption names its way out (captions.ts): a say ends by
 * itself, a hold at its release.
 *
 * The app shell mounts `<Captions />` once, at the page root (web/src/App.tsx's Shell), outside both worlds; a host of the engine's Frame that wants
 * captions must mount it itself, since neither the Frame nor the HUD does.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKayfaIfAny } from '../context.tsx';
import { bezier, useFeel, type ActiveFeel } from '../glass/motion.ts';
import { placeOver, type Rect } from './place-over.ts';
import { captions, type CaptionLine, type Captions as Store } from './captions.ts';
import './captions.css';

/** Watches a changing set of boxes with one ResizeObserver, where the browser has one: `watch` replaces what is watched. */
class ResizeObserverOf {
  private readonly observer: ResizeObserver | null;
  private seen = new Set<Element>();
  constructor(onResize: () => void) { this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize); }
  watch(boxes: readonly Element[]) {
    if (!this.observer) return;
    for (const b of this.seen) if (!boxes.includes(b)) this.observer.unobserve(b);
    for (const b of boxes) if (!this.seen.has(b)) this.observer.observe(b);
    this.seen = new Set(boxes);
  }
  stop() { this.observer?.disconnect(); this.seen.clear(); }
}

/**
 * A dialog's box as it is laid out, and the top of the overlay it stands in, both in the window's coordinates. A box enters with a scale and a translate,
 * which move and shrink its `getBoundingClientRect` for as long as the animation plays; its offsets in its overlay are the layout's and no transform
 * touches them, so the read is the same at the first frame as at the last, and nothing waits for the animation. Every dialog's box is the overlay's own
 * child, positioned or not: a centered one is a grid item of the fixed overlay, an anchored one or a phone's sheet is absolute in it (Overlay.tsx's
 * `place()` sets its top, left or bottom, and the offsets are what those landed on). The overlay is fixed and has no transform of its own (its dim is a fade),
 * so its rect is its layout; its own scroll is taken off.
 */
function laidOut(box: HTMLElement): { readonly box: Rect; readonly top: number } {
  const parent = box.offsetParent;
  const o = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
  const left = o.left + (parent ? parent.clientLeft - parent.scrollLeft : 0) + box.offsetLeft;
  const top = o.top + (parent ? parent.clientTop - parent.scrollTop : 0) + box.offsetTop;
  return { box: { left, top, right: left + box.offsetWidth, bottom: top + box.offsetHeight }, top: o.top };
}

/** The stack's gap above the HUD's seam (captions.css), counted in what it measures. */
const GAP = 10;

export function Captions({ store = captions }: { readonly store?: Store }) {
  const lines = useSyncExternalStore(store.subscribe, store.lines, store.lines);
  const announcements = useSyncExternalStore(store.subscribe, store.announcements, store.announcements);
  /* The Frame's own Captions sits inside the instance's context; a bare one (a test, a story of the engine alone) takes the glass's default feel. */
  const feel = useFeel(useKayfaIfAny()?.ui.glass.motion);
  const stack = useRef<HTMLDivElement>(null);
  const refresh = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const root = document.documentElement;
    /* A stack with no line (its last one is gone, or still leaving) holds no height: the toasts stand on what is there. */
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (el.childElementCount === 0 || h <= 0) root.style.removeProperty('--kb-captions-measured');
      else root.style.setProperty('--kb-captions-measured', `${h + GAP}px`);
    };

    /* Over a dialog: measured from the stack's resting place (what the lift moved it from is added back), against every open dialog's laid-out box. */
    let lift = 0;
    const boxes = () => [...document.querySelectorAll<HTMLElement>('.kb-glass-overlay .kb-glass-dialog')];
    const sees = new ResizeObserverOf(() => place());
    const place = () => {
      const open = boxes();
      const r = el.getBoundingClientRect();
      const rest = { left: r.left, right: r.right, top: r.top + lift, bottom: r.bottom + lift };
      const laid = open.map(laidOut);
      const over = el.childElementCount === 0 ? null : placeOver(rest, laid.map((l) => l.box), { top: Math.max(0, ...laid.map((l) => l.top)) });
      lift = over?.lift ?? 0;
      if (over) { el.setAttribute('data-over-scrim', 'true'); el.style.setProperty('--kb-captions-lift', `${over.lift}px`); }
      else { el.removeAttribute('data-over-scrim'); el.style.removeProperty('--kb-captions-lift'); }
      sees.watch(open);
    };
    const all = () => { measure(); place(); };
    refresh.current = all;
    all();

    /* A dialog opening or closing (a change to the body's children), or the window changing size, is read now and once more a frame on: the overlay places an anchored box after it mounts. The read needs no waiting for the open animation, for it is of the laid-out box (laidOut). */
    let after: number | null = null;
    const changed = () => {
      place();
      if (after !== null) cancelAnimationFrame(after);
      after = requestAnimationFrame(() => { after = null; place(); });
    };
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(changed);
    mutations?.observe(document.body, { childList: true });
    /* A line that has finished leaving takes its box with it, which is no change to the lines: the stack's own children say so. */
    const inside = typeof MutationObserver === 'undefined' ? null : new MutationObserver(all);
    inside?.observe(el, { childList: true });
    window.addEventListener('resize', changed);

    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(all);
    watch?.observe(el);
    return () => {
      refresh.current = () => {};
      watch?.disconnect(); mutations?.disconnect(); inside?.disconnect(); sees.stop();
      window.removeEventListener('resize', changed);
      if (after !== null) cancelAnimationFrame(after);
      root.style.removeProperty('--kb-captions-measured');
    };
  }, []);

  /* The lines changed: read the stack again before it is painted. */
  useLayoutEffect(() => { refresh.current(); }, [lines]);

  return (
    <>
      <div className="kb-visually-hidden" role="status" aria-live="polite" aria-label="Sound captions">
        {announcements.map((a) => <p key={a.seq}>{a.text}</p>)}
      </div>
      <div ref={stack} className="kb-captions" aria-hidden="true">
        <AnimatePresence initial={false}>
          {lines.map((line) => <Line key={line.id} line={line} feel={feel} />)}
        </AnimatePresence>
      </div>
    </>
  );
}

/* One line's tray. With a feel it enters and leaves as a toast does; with none it is a plain element, appearing and going where it stands. */
function Line({ line, feel }: { readonly line: CaptionLine; readonly feel: ActiveFeel }) {
  const body = (
    <span className="kb-captions-text">
      {line.ink && <span className="kb-captions-dot" style={{ background: line.ink }} />}
      {line.text}
      {line.count > 1 && <span className="kb-captions-count kb-num">{'\u00d7'}{line.count}</span>}
    </span>
  );
  const props = { className: 'kb-captions-bar', 'data-held': line.held ? 'true' : undefined } as const;
  if (!feel) return <div {...props}>{body}</div>;
  return (
    <motion.div
      {...props}
      layout="position"
      initial={{ opacity: 0, y: feel.distance }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: feel.exit / 1000, ease: bezier(feel.ease) } }}
      transition={{ duration: feel.enter / 1000, ease: bezier(feel.ease) }}
    >
      {body}
    </motion.div>
  );
}
