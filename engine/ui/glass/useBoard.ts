/**
 * The board's layout on the page: which board's layout the window is wide enough for, and the scale
 * the Main board's is drawn at (board.ts says how both are worked out). A media query cannot read
 * a width the instance's tokens set, so this sets them on the root for the stylesheets to read:
 * `data-kb-layout` is `main` or `phone`, and `--kb-board-scale` is the scale (1 on the Phone board's
 * layout and from 1440px up). The HUD and the glass pages each call it where they mount, so the two
 * switch together, at the one width.
 *
 * Both are read as the component first renders and set before the browser paints (a layout
 * effect), so a first paint never shows the other board's layout, and again on every change of the
 * window's width: the switch by a media query at the worked-out width, the scale by the window's
 * own resize, worked out at most once a frame however many resizes the frame brings.
 *
 * The scale is the room the page has (the root's clientWidth, without a classic scrollbar) over
 * 1440, so the scaled layout fits the room and never runs under the scrollbar. The media query
 * reads the window's whole width, scrollbar included, so where a classic scrollbar takes the room
 * just under the switch while the window is past it, the two disagree; there it is the Phone
 * board's layout, since the Main board's at that room would draw its smallest text below the
 * phone's. A scrollbar that comes or goes without the window resizing is read at the next resize.
 *
 * The player's text size past 150% (`data-kb-text-size` on the root, engine/ui/appearance.ts) makes
 * it the Phone board's at any width, the glass's one column, and it follows the text size as it
 * changes (board.ts, FOLD_ABOVE_TEXT_SIZE).
 *
 * Every caller sets the same two values, so they are shared: a count of the callers mounted keeps
 * them on the root until the last one unmounts, and only then are they taken off, so the shell
 * that mounts next sets its own.
 */
import { useLayoutEffect, useState } from 'react';
import { useTextSize } from '../appearance.ts';
import { useKayfa } from '../context.tsx';
import { boardSwitch, FOLD_ABOVE_TEXT_SIZE, MAIN_BOARD_WIDTH, type BoardLayout } from './board.ts';

/** How many callers are mounted; the root's mark and scale are theirs until it is 0. */
let mounted = 0;

/* The room the page has, without a classic scrollbar; where the document reports none (a test's), the window's width. */
function room(): number {
  return document.documentElement.clientWidth || globalThis.innerWidth || MAIN_BOARD_WIDTH;
}

/* Where nothing answers a media query (a test's document), it is the Main board's, unscaled, as the stylesheets draw a root with no mark. */
function read(at: number, size: number): BoardLayout {
  if (size > FOLD_ABOVE_TEXT_SIZE) return { board: 'phone', scale: 1 };
  if (typeof globalThis.matchMedia !== 'function') return { board: 'main', scale: 1 };
  const width = room();
  if (!globalThis.matchMedia(`(min-width: ${at}px)`).matches || width < at) return { board: 'phone', scale: 1 };
  return { board: 'main', scale: Math.min(1, width / MAIN_BOARD_WIDTH) };
}

export function useBoard(): BoardLayout {
  const { ui } = useKayfa();
  const at = boardSwitch(ui.glass);
  /* The player's text size, as the root is marked (appearance.ts): past 150% the page is one column. */
  const size = useTextSize();
  const [layout, setLayout] = useState(() => read(at, size));

  useLayoutEffect(() => {
    const on = () => setLayout((was) => {
      const now = read(at, size);
      return now.board === was.board && now.scale === was.scale ? was : now;
    });
    let frame: number | null = null;
    const onResize = () => {
      if (frame !== null) return;
      frame = globalThis.requestAnimationFrame(() => { frame = null; on(); });
    };
    on();
    const query = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(`(min-width: ${at}px)`) : null;
    query?.addEventListener?.('change', on);
    globalThis.addEventListener?.('resize', onResize);
    return () => {
      query?.removeEventListener?.('change', on);
      globalThis.removeEventListener?.('resize', onResize);
      if (frame !== null) globalThis.cancelAnimationFrame(frame);
    };
  }, [at, size]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-layout', layout.board);
    root.style.setProperty('--kb-board-scale', String(layout.scale));
  }, [layout]);

  useLayoutEffect(() => {
    mounted += 1;
    return () => {
      mounted -= 1;
      if (mounted > 0) return;
      const root = document.documentElement;
      root.removeAttribute('data-kb-layout');
      root.style.removeProperty('--kb-board-scale');
    };
  }, []);

  return layout;
}
