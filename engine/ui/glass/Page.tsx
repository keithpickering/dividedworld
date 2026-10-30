/**
 * The page shell every glass page sits in (the web plan's glass amendment to Task 3): the smoke of
 * its surface behind, the menu bar, and the content column, which is the page's `main`. The
 * board's banner and HUD are not on it; Back to the board and Esc leave it (MenuBar.tsx).
 *
 * A move between glass pages reads as one, as the frame's does: the page starts at its top and
 * focus is on its main, so a keyboard and a screen reader begin there. A page the glass build's
 * Part 2 has not yet restyled keeps the board's own look on a panel in the board's colors, so it
 * reads as it did; a `restyled` page draws its content on the glass itself, at the column's scale.
 * Once every glass page is restyled the panel and the flag go.
 *
 * Its menu bar and column are the Main board's layout from the width useBoard works out and the
 * Phone board's below it, the switch the HUD makes at the same width; between that width and
 * 1440px the Main board's is drawn at the window's scale (shell.css).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from '../router.tsx';
import type { GlassSurface } from '../types.ts';
import { MenuBar } from './MenuBar.tsx';
import { Smoke, useSurfaceStyle } from './Smoke.tsx';
import { useBoard } from './useBoard.ts';
import './shell.css';

export interface PageProps {
  readonly surface: GlassSurface;
  readonly children: ReactNode;
  /** The content is drawn in the glass's own type and colors, so it takes the column's scale and no board panel. */
  readonly restyled?: boolean;
}

export function Page({ surface, children, restyled = false }: PageProps) {
  const { path, hash, popped } = useLocation();
  const main = useRef<HTMLElement>(null);
  const calm = useSurfaceStyle(surface);
  /* The page's layout is the board's the window is wide enough for, as the HUD's is: the two switch at one width. */
  useBoard();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    /* As the frame's: a fragment is the page's to scroll to, and back or forward keeps the browser's scroll. */
    if (!hash && !popped) globalThis.scrollTo?.(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  return (
    <div className="kb-glass kb-glass-page" data-kb-surface={surface} style={calm}>
      <Smoke surface={surface} />
      <MenuBar />
      <main ref={main} className="kb-glass-content" tabIndex={-1}>
        {restyled ? children : <div className="kb-glass-content-panel kb-glass-cut-panel">{children}</div>}
      </main>
    </div>
  );
}
