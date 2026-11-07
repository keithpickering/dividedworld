/**
 * The board's pixel icons (the board-look plan, Task 5; drawn in docs/research/2026-11-06-board-look/gen.mjs's `ICONS`): the thread
 * list's folders (24 by 20), the boards' bar's icons (16 by 14) and Start a thread's (14 by 14). Each is an inline SVG drawn at its
 * viewBox's own whole-pixel size, with every stroke on a half pixel, and is never scaled: its width and height are its viewBox's, and no
 * stylesheet resizes it (icons.css sets only the tones), so a line lands on the screen's pixels as a 2003 icon GIF's did. Its tones are
 * the `--kb-icon-*` tokens, so a theme paints them. An icon is decoration: it is `aria-hidden`, and the state a folder shows is said
 * by visually hidden text beside it (`FolderState`).
 */
import type { ReactNode } from 'react';
import './icons.css';

const FLAME = (
  <>
    <path className="hot" d="M19.5,0.5 C21,2.5 23.5,4 22.8,7 C22.3,9 20,9.5 18.8,8.6 C17.5,7.6 17.8,5.8 19,4.8 C17.4,5 16.5,6.5 16.8,8.2 C15,6.5 16.5,2.5 19.5,0.5 Z" />
    <path className="hi" d="M20,4.6 C21,5.6 21.6,6.6 21,7.6 C20.5,8.1 19.7,7.8 19.7,7 Z" />
  </>
);
const SHEET = (
  <>
    <path className="paper" d="M5.5,2.5 H17.5 V11.5 H5.5 Z" />
    <path className="line" d="M7.5,5.5 H15.5 M7.5,7.5 H15.5 M7.5,9.5 H12.5" />
  </>
);
const folder = (isNew: boolean, hot: boolean): readonly [number, number, ReactNode] => [24, 20, (
  <>
    <path className="back" d="M2.5,3.5 H9.5 L11.5,5.5 H21.5 V17.5 H2.5 Z" />
    {isNew && SHEET}
    <path className={isNew ? 'front-new' : 'front'} d="M2.5,17.5 L4.5,9.5 H23.5 L21.5,17.5 Z" />
    <path className="shine" d="M5.4,10.5 H22.3" />
    {hot && FLAME}
  </>
)];

/** [width, height, the drawing]; the classes are icons.css's tones. */
const ICONS = {
  old: folder(false, false),
  new: folder(true, false),
  hot: folder(false, true),
  'new-hot': folder(true, true),
  who: [24, 20, (
    <>
      <circle className="back" cx="15.5" cy="6" r="3.5" />
      <path className="back" d="M9.5,17.5 C9.5,11.5 21.5,11.5 21.5,17.5 Z" />
      <circle className="front" cx="9" cy="8.5" r="3.8" />
      <path className="front" d="M2.5,19.5 C2.5,13 15.5,13 15.5,19.5 Z" />
    </>
  )],
  home: [16, 14, <path className="s" d="M1.5,7.5 L8,1.5 L14.5,7.5 M3.5,6.5 V12.5 H12.5 V6.5 M7,12.5 V9.5 H9 V12.5" />],
  board: [16, 14, <path className="s" d="M1.5,2.5 H14.5 V12.5 H1.5 Z M4,5.5 H12 M4,7.5 H12 M4,9.5 H9" />],
  search: [16, 14, <path className="s" d="M6.5,1.5 H8.5 L10.5,3.5 V5.5 L8.5,7.5 H6.5 L4.5,5.5 V3.5 Z M9.5,7.5 L13.5,11.5" />],
  start: [14, 14, <path className="s" d="M2.5,1.5 H9.5 L11.5,3.5 V12.5 H2.5 Z M5,7.5 H9 M7,5.5 V9.5" />],
} as const satisfies Record<string, readonly [number, number, ReactNode]>;

export type IconName = keyof typeof ICONS;

/** A pixel icon at its own size. */
export function Icon({ name }: { readonly name: IconName }) {
  const [w, h, body] = ICONS[name];
  return <svg className="kb-icon" aria-hidden="true" focusable="false" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{body}</svg>;
}

/** A folder's state, in words, for a reader who cannot see it. */
export const folderState = (isNew: boolean, isHot: boolean) => (isNew ? (isHot ? 'New, hot' : 'New') : isHot ? 'Hot' : 'No new posts');
export const folderIcon = (isNew: boolean, isHot: boolean): IconName => (isNew ? (isHot ? 'new-hot' : 'new') : isHot ? 'hot' : 'old');
