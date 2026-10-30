/**
 * The page shell every glass page sits in (the web plan's glass amendment to Task 3): the smoke of
 * its surface behind, the menu bar, and the content column, which is the page's `main`. The
 * board's banner and HUD are not on it; Back to the board and Esc leave it (MenuBar.tsx).
 *
 * A move between glass pages reads as one, as the frame's does: the page starts at its top and
 * focus is on its main, so a keyboard and a screen reader begin there. Until the glass build's
 * Part 2 restyles each page, its content keeps the board's own look on a panel in the board's
 * colors, so every screen reads as it did.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from '../router.tsx';
import type { GlassSurface } from '../types.ts';
import { MenuBar } from './MenuBar.tsx';
import { Smoke } from './Smoke.tsx';
import './shell.css';

export function Page({ surface, children }: { readonly surface: GlassSurface; readonly children: ReactNode }) {
  const { path } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    globalThis.scrollTo?.(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  return (
    <div className="kb-glass kb-glass-page" data-kb-surface={surface}>
      <Smoke surface={surface} />
      <MenuBar />
      <main ref={main} className="kb-glass-content" tabIndex={-1}>
        <div className="kb-glass-content-panel kb-glass-cut-panel">{children}</div>
      </main>
    </div>
  );
}
