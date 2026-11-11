/**
 * What a glass screen's changing part needs to know about the screen it sits in. A screen is a path
 * (Page.tsx): a change of the router's key within one path leaves the screen mounted, and the part
 * that changed is the screen's body, which swaps on its own. The body is keyed by the router's key
 * and moves by whether the player went back or forward, so Page, which resolves both, publishes
 * them here instead of each screen asking the router again and possibly disagreeing about which
 * key is the current one.
 *
 * `ScreenBody` (docs/plans/2026-11-08-glass-in-page-swap-design.md, section 3) is the part of a screen that swaps in place: it holds the
 * body under an `AnimatePresence`, keyed by the screen's key (`useScreenKey`), so a change of key within one path leaves the screen's frame
 * (its head, its tabs, its menu bar) where it is and only the body leaves and arrives. `at` is the body's place in the order the player moves
 * through (a tab's index, a page's number), and the direction is decided in the render that changes it, from the sign of the change, as
 * Page's and the roster's are; an equal `at` keeps the last direction. `axis` picks the motion: `x` is the screen's crossing (`screen`),
 * `y` the roster panel's swap (`swap`). The body leaving is laid over the one arriving (shell.css), inert, so focus stays on the control that
 * was pressed and nothing is read twice. The entrance plays on the body arriving only, not on mount (the screen's own did that), and unless
 * the move was back or forward (which keep their scroll) a body whose top is above the menu bar is brought to just under it, never to the
 * top of the window and never when it is already in view. Under Off the presets are empty, so the swap is at once with no stagger.
 * The direction is exposed as `data-kb-dir` on the holder.
 */
import { AnimatePresence } from 'motion/react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { useKayfa } from '../context.tsx';
import { enterScreen } from './enter.ts';
import { Leaving } from './Held.tsx';
import { screen, swap, useFeel } from './motion.ts';

export interface ScreenKey {
  /** The router's resolved key for the current screen: the key a body is keyed by. */
  readonly key: string;
  /** True when the move to this key was the browser's back or forward, which keep their own scroll. */
  readonly popped: boolean;
}

export const ScreenKeyContext = createContext<ScreenKey>({ key: '', popped: false });

/** The current screen's key and whether it was reached by back or forward. */
export function useScreenKey(): ScreenKey {
  return useContext(ScreenKeyContext);
}

/** The menu bar's height as the document root publishes it (MenuBar.tsx), 0 where there is none. */
function menuHeight(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb-glass-menu-height'));
  return Number.isFinite(v) ? v : 0;
}

export function ScreenBody({ at, axis, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { readonly at: number; readonly axis: 'x' | 'y' }) {
  const { key, popped } = useScreenKey();
  const { ui } = useKayfa();
  const feel = useFeel(ui.glass.motion);
  const [seen, setSeen] = useState(at);
  const [dir, setDir] = useState<1 | -1>(1);
  if (at !== seen) {
    if (at > seen) setDir(1);
    else setDir(-1);
    setSeen(at);
  }
  const holder = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const body = holder.current?.querySelector<HTMLElement>(':scope > :not([data-kb-exiting])');
    if (!body) return;
    const stop = enterScreen(feel, body);
    if (!popped) {
      /* The holder's top, not the body's: the arriving body may start offset by its motion, the holder never moves. */
      const over = (holder.current?.getBoundingClientRect().top ?? 0) - menuHeight();
      if (over < 0) globalThis.scrollBy?.(0, over);
    }
    return stop;
    // Per body: a change of feel mid-swap does not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div ref={holder} className={className ? `kb-screen-body ${className}` : 'kb-screen-body'} data-kb-dir={dir} {...rest}>
      <AnimatePresence initial={false} custom={dir}>
        <Leaving key={key} custom={dir} {...(axis === 'x' ? screen(feel) : swap(feel))}>
          {children}
        </Leaving>
      </AnimatePresence>
    </div>
  );
}
