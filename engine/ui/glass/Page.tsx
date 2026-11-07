/**
 * The page shell every glass page sits in (the web plan's glass amendment to Task 3): the smoke of
 * its surface behind, the menu bar, and the content column, which is the page's `main`. The
 * board's banner and HUD are not on it; Back to the board and Esc leave it (MenuBar.tsx).
 *
 * A move between glass pages reads as one, as the frame's does: the page starts at its top and
 * focus is on its main, so a keyboard and a screen reader begin there. The content is drawn on
 * the glass itself, in the glass's type, at the column's scale.
 *
 * Its menu bar and column are the Main board's layout from the width useBoard works out and the
 * Phone board's below it, the switch the HUD makes at the same width; between that width and
 * 1440px the Main board's is drawn at the window's scale (shell.css).
 */
import { AnimatePresence } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import { useLocation } from '../router.tsx';
import type { GlassSurface } from '../types.ts';
import { enterScreen } from './enter.ts';
import { Leaving } from './Held.tsx';
import { MenuBar, tabIndex } from './MenuBar.tsx';
import { screen, useFeel } from './motion.ts';
import { Smoke, useSurfaceStyle } from './Smoke.tsx';
import { useBoard } from './useBoard.ts';
import './shell.css';

export interface PageProps {
  readonly surface: GlassSurface;
  /**
   * False for a page that is a screen of results with no menu bar (the settlement's summary, the glass plan's section 9, choice 8),
   * whose own ways out are on it and which answers Esc itself.
   */
  readonly menu?: boolean;
  readonly children: ReactNode;
}

export function Page({ surface, menu = true, children }: PageProps) {
  const { path, hash, popped } = useLocation();
  const main = useRef<HTMLElement>(null);
  const calm = useSurfaceStyle(surface);
  /* The page's layout is the board's the window is wide enough for, as the HUD's is: the two switch at one width. */
  useBoard();
  /*
   * A change between screens: the old content leaves toward the side of the tab being left, the new enters from the side of the tab chosen
   * (motion.ts `screen`), by the tabs' order in the menu bar. A page with no tab (the settlement's summary) or a move within one tab keeps the
   * direction it had. The direction is decided in the render that changes the path, from the two paths alone.
   */
  const { ui } = useKayfa();
  const feel = useFeel(ui.glass.motion);
  const at = tabIndex(path);
  const [seen, setSeen] = useState(at);
  const [dir, setDir] = useState<1 | -1>(1);
  if (at !== seen) {
    if (at >= 0 && seen >= 0) setDir(at > seen ? 1 : -1);
    setSeen(at);
  }
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    /* As the frame's: a fragment is the page's to scroll to, and back or forward keeps the browser's scroll. */
    if (!hash && !popped) globalThis.scrollTo?.(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  /* The screen's head, panels and rows enter by the feel's stagger (enter.ts), once the screen has mounted, before it paints. */
  useLayoutEffect(() => {
    const screenEl = main.current?.querySelector<HTMLElement>('.kb-glass-screen:not([data-kb-exiting])');
    return screenEl ? enterScreen(feel, screenEl) : undefined;
    // Per screen: a change of feel mid-screen does not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return (
    <div className="kb-glass kb-glass-page" data-kb-surface={surface} style={calm}>
      <Smoke surface={surface}>
        {menu && <MenuBar />}
        <main ref={main} className="kb-glass-content" tabIndex={-1}>
          <AnimatePresence initial={false} custom={dir}>
            <Leaving key={path} custom={dir} className="kb-glass-screen" {...screen(feel)}>{children}</Leaving>
          </AnimatePresence>
        </main>
      </Smoke>
    </div>
  );
}
