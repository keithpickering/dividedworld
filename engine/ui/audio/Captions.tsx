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
 * A caption names its way out (captions.ts): a say ends by itself, a hold at its release.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motionReduced } from '../appearance.ts';
import { captions, type Caption, type Captions as Store } from './captions.ts';
import './captions.css';

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
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    watch?.observe(el);
    return () => { watch?.disconnect(); root.style.removeProperty('--kb-captions-measured'); };
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
