/**
 * The caption bar (the Laugh Track plan, Task 3; look A of docs/research/2026-11-11-laugh-track-bench/01-bench.html): the words of what the page
 * plays, for a reader with the sound off and for one with it on. One bar for the page, a fixed slim chamfered glass tray above the HUD's seam, holding
 * the words in white monospace capitals on black, led by a dot in the caption's ink where it has one. A held caption (a loop's build-up) is italic.
 *
 * It is always in the page with a polite live region, visually hidden, as the toasts' announcer is: a `say` is announced (and leaves the region after
 * a couple of seconds so it does not grow), a hold is not, so a build-up does not chatter. The drawn bar is hidden from a screen reader so nothing is
 * read twice. The stored words stay sentence case; the capitals are CSS.
 *
 * It fades over 150ms and, under reduced motion, appears and goes with no motion. It lets every press through. While a caption shows it measures
 * itself and sets `--kb-captions-measured` (its height and the gap under it) on the root, so the toasts stand above it; cleared otherwise.
 * Over a dialog (`.kb-glass-overlay`, whose scrim is above the bar's layer) the bar is raised above the scrim, and where its resting place meets the
 * dialog's box (always, for a phone's sheet) it is lifted to rest above the box (`--kb-captions-lift`); where no room is left above the box it stays
 * under the scrim, announced all the same (place-over.ts). `--kb-captions-measured` is the bar's resting place either way, so the toasts do not move.
 * A caption names its way out (captions.ts): a say ends by itself, a hold at its release.
 *
 * The app shell mounts `<Captions />` once, at the page root (web/src/App.tsx's Shell), outside both worlds; a host of the engine's Frame that wants
 * captions must mount it itself, since neither the Frame nor the HUD does.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motionReduced } from '../appearance.ts';
import { placeOver, type Rect } from './place-over.ts';
import { captions, type Caption, type Captions as Store } from './captions.ts';
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

/** The fade, and how long an announcement stays in the live region. */
export const FADE_MS = 150;
export const SAID_MS = 2500;
/** The bar's gap above the HUD's seam (captions.css), counted in what it measures. */
const GAP = 10;

export function Captions({ store = captions }: { readonly store?: Store }) {
  const now = useSyncExternalStore(store.subscribe, store.current, store.current);
  /* What is drawn: the caption, kept through its fade-out. */
  const [shown, setShown] = useState<Caption | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [said, setSaid] = useState<{ readonly seq: number; readonly text: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (now) { setShown(now); setLeaving(false); return; }
    if (!shown) return;
    if (motionReduced()) { setShown(null); setLeaving(false); return; }
    setLeaving(true);
    const t = setTimeout(() => { setShown(null); setLeaving(false); }, FADE_MS);
    return () => clearTimeout(t);
    // `shown` is what is being left; only the store's caption starts or ends a fade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  /* The clear timers live outside the effect, so a say that ends sooner than SAID_MS does not cancel its own clearing; they stop at unmount. */
  const clears = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!now || now.held) return;
    const seq = now.seq;
    setSaid({ seq, text: now.text });
    const timer = setTimeout(() => {
      clears.current.delete(timer);
      setSaid((s) => (s?.seq === seq ? null : s));
    }, SAID_MS);
    clears.current.add(timer);
  }, [now]);
  useEffect(() => () => { for (const t of clears.current) clearTimeout(t); }, []);

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--kb-captions-measured', `${Math.ceil(el.getBoundingClientRect().height) + GAP}px`);
    measure();

    /* Over a dialog: measured from the bar's resting place (what the lift moved it from is added back), against every open dialog's laid-out box. */
    let lift = 0;
    const boxes = () => [...document.querySelectorAll<HTMLElement>('.kb-glass-overlay .kb-glass-dialog')];
    const sees = new ResizeObserverOf(() => place());
    const place = () => {
      const open = boxes();
      const r = el.getBoundingClientRect();
      const rest = { left: r.left, right: r.right, top: r.top + lift, bottom: r.bottom + lift };
      const laid = open.map(laidOut);
      const over = placeOver(rest, laid.map((l) => l.box), { top: Math.max(0, ...laid.map((l) => l.top)) });
      lift = over?.lift ?? 0;
      if (over) { el.setAttribute('data-over-scrim', 'true'); el.style.setProperty('--kb-captions-lift', `${over.lift}px`); }
      else { el.removeAttribute('data-over-scrim'); el.style.removeProperty('--kb-captions-lift'); }
      sees.watch(open);
    };
    /* A dialog opening or closing (a change to the body's children), or the window changing size, is read now and once more a frame on: the overlay places an anchored box after it mounts. The read needs no waiting for the open animation, for it is of the laid-out box (laidOut). */
    let after: number | null = null;
    const changed = () => {
      place();
      if (after !== null) cancelAnimationFrame(after);
      after = requestAnimationFrame(() => { after = null; place(); });
    };
    changed();
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(changed);
    mutations?.observe(document.body, { childList: true });
    window.addEventListener('resize', changed);

    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { measure(); place(); });
    watch?.observe(el);
    return () => {
      watch?.disconnect(); mutations?.disconnect(); sees.stop();
      window.removeEventListener('resize', changed);
      if (after !== null) cancelAnimationFrame(after);
      root.style.removeProperty('--kb-captions-measured');
    };
  }, [shown !== null]);

  return (
    <>
      <div className="kb-visually-hidden" role="status" aria-live="polite" aria-label="Sound captions">
        {said && <p key={said.seq}>{said.text}</p>}
      </div>
      {shown && (
        <div
          ref={bar}
          className="kb-captions-bar"
          aria-hidden="true"
          data-held={shown.held ? 'true' : undefined}
          data-leaving={leaving ? 'true' : undefined}
        >
          <span className="kb-captions-text">
            {shown.ink && <span className="kb-captions-dot" style={{ background: shown.ink }} />}
            {shown.text}
          </span>
        </div>
      )}
    </>
  );
}
