/**
 * The in-page swap's screen body (docs/plans/2026-11-08-glass-in-page-swap-design.md). `Page` provides the context below around its
 * children: the router's resolved key for the current screen, and whether the move to it was the browser's back or forward.
 *
 * `ScreenBody` is the part of a page that swaps in place when the key changes: the old body stays over the new one while it leaves (inert,
 * out of the layout, shell.css), by the direction of the change of `at`, its place in the page's own order. A swap that is not a Back brings
 * the body's top back under the menu bar when the press left it above.
 */
import { AnimatePresence } from 'motion/react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { useKayfa } from '../context.tsx';
import { enterScreen } from './enter.ts';
import { Leaving } from './Held.tsx';
import { screen, swap, useFeel } from './motion.ts';

export interface ScreenKeyValue {
  /** The resolved router key of the current screen (the route's own key, else the path). */
  readonly key: string;
  /** True when the move to this screen was a back or forward. */
  readonly popped: boolean;
}

export const ScreenKeyContext = createContext<ScreenKeyValue>({ key: '', popped: false });

export interface ScreenBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** The body's place in the page's own order (a section's index); a larger one is after the one before it. */
  readonly at: number;
  /** 'x' when the bodies sit side by side (the page's own `screen` motion), 'y' when one above the other (`swap`). */
  readonly axis: 'x' | 'y';
}

export function ScreenBody({ at, axis, className, children, ...rest }: ScreenBodyProps) {
  const { key, popped } = useContext(ScreenKeyContext);
  const { ui } = useKayfa();
  const feel = useFeel(ui.glass.motion);
  /* As Page's: decided in the render that changes `at`, from the sign of the change; an equal place keeps the direction it had. */
  const [seen, setSeen] = useState(at);
  const [dir, setDir] = useState<1 | -1>(1);
  if (at !== seen) {
    if (at >= 0 && seen >= 0) setDir(at > seen ? 1 : -1);
    setSeen(at);
  }
  const holder = useRef<HTMLDivElement>(null);
  const prev = useRef(key);
  /*
   * A change of body (not the mount, and not Strict Mode's replay of it: the last key seen, not a first-run flag, says whether it changed): the
   * body is brought under the menu bar when the move was not a Back, measured and scrolled before its entrance starts (the entrance's initial
   * transform would skew its top), and then enters by the stagger. `popped` is read here only because it changes with `key`.
   */
  useLayoutEffect(() => {
    if (prev.current === key) return;
    prev.current = key;
    const body = Array.from(holder.current?.children ?? []).find((c) => !c.hasAttribute('data-kb-exiting')) as HTMLElement | undefined;
    if (!body) return;
    if (!popped) {
      const menu = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb-glass-menu-height')) || 0;
      const top = body.getBoundingClientRect().top;
      if (top < menu) globalThis.scrollBy?.(0, top - menu);
    }
    return enterScreen(feel, body);
    // Per body: a change of feel mid-screen does not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div ref={holder} className={className ? `kb-screen-body ${className}` : 'kb-screen-body'} data-kb-dir={dir} {...rest}>
      <AnimatePresence initial={false} custom={dir}>
        <Leaving key={key} custom={dir} {...(axis === 'x' ? screen(feel) : swap(feel))}>{children}</Leaving>
      </AnimatePresence>
    </div>
  );
}
