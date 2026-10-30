/**
 * The board's layout on the page: which board's layout the window is wide enough for, and the scale
 * the Main board's is drawn at (board.ts says how both are worked out). A media query cannot read
 * a width the instance's tokens set, so this sets them on the root for the stylesheets to read:
 * `data-kb-board` is `main` or `phone`, and `--kb-board-scale` is the scale (1 on the Phone board's
 * layout and from 1440px up). The HUD and the glass pages each call it where they mount, so the two
 * switch together, at the one width.
 *
 * Both are read as the component first renders and set before the browser paints (a layout
 * effect), so a first paint never shows the other board's layout, and again on every change of the
 * window's width: the switch by a media query at the worked-out width, the scale by the window's
 * own resize. They are taken off the root when the shell that set them unmounts, so the one that mounts
 * next sets its own.
 */
import { useLayoutEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { boardSwitch, MAIN_BOARD_WIDTH, type BoardLayout } from './board.ts';

/* Where nothing answers a media query (a test's document), it is the Main board's, unscaled, as the stylesheets draw a root with no mark. */
function read(at: number): BoardLayout {
  if (typeof globalThis.matchMedia !== 'function') return { board: 'main', scale: 1 };
  if (!globalThis.matchMedia(`(min-width: ${at}px)`).matches) return { board: 'phone', scale: 1 };
  return { board: 'main', scale: Math.min(1, (globalThis.innerWidth || MAIN_BOARD_WIDTH) / MAIN_BOARD_WIDTH) };
}

export function useBoard(): BoardLayout {
  const { ui } = useKayfa();
  const at = boardSwitch(ui.glass);
  const [layout, setLayout] = useState(() => read(at));

  useLayoutEffect(() => {
    const on = () => setLayout((was) => {
      const now = read(at);
      return now.board === was.board && now.scale === was.scale ? was : now;
    });
    on();
    const query = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(`(min-width: ${at}px)`) : null;
    query?.addEventListener?.('change', on);
    globalThis.addEventListener?.('resize', on);
    return () => {
      query?.removeEventListener?.('change', on);
      globalThis.removeEventListener?.('resize', on);
    };
  }, [at]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-board', layout.board);
    root.style.setProperty('--kb-board-scale', String(layout.scale));
  }, [layout]);

  useLayoutEffect(() => () => {
    const root = document.documentElement;
    root.removeAttribute('data-kb-board');
    root.style.removeProperty('--kb-board-scale');
  }, []);

  return layout;
}
