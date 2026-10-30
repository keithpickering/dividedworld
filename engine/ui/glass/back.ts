/**
 * Going back to the board (the web plan's glass amendment to Task 3): entering the glass keeps the
 * board's route and the post in view, and Back and Esc from a glass page go to both. The thread
 * already opens at the post a `#post-N` fragment names and focuses it (engine/ui/thread/Thread.tsx),
 * so Back is that route with the post as its fragment; a page with no posts gets its scroll back.
 *
 * The place is this tab's own: a module value, and a copy in sessionStorage so that a reloaded
 * glass page still knows it. It is never sent anywhere. The copy is read only when this document
 * was reached by a reload or the browser's back or forward: a glass page opened afresh by its
 * address, in a tab that once kept a place, has not come from that board, so its Back goes to the
 * index rather than to a board from before. Back forgets the place it used. A stored place that is
 * not a path on this app (another origin, a scheme), or whose post is not a post id, is ignored, so
 * a planted value cannot send Back elsewhere or carry markup into an address.
 */
import { useCallback } from 'react';
import { useNavigate } from '../router.tsx';

export interface BoardPlace {
  /** The board's route: a path and its query, without a fragment. */
  readonly href: string;
  /** The id of the post in view (`post-N`), or none on a page with no posts. */
  readonly post: string | null;
  readonly scrollY: number;
}

const KEY = 'kb-glass-back';
let kept: BoardPlace | null = null;

/** Less of a post than this at the top of the view is the post just read, not the one the reader is on. */
const SLIVER = 48;

/**
 * The first post with more than a sliver still on screen: the one the reader is on. Where the view
 * sits between two posts it is the next one down. It is none at the top of the page, where Back
 * opens the route at its top anyway, and none where the next post is still below the view (the
 * reader is on what comes before or after the posts), so Back does not jump them down to it.
 */
export function postInView(doc: Document = document): string | null {
  const win = doc.defaultView;
  if (!win || win.scrollY <= 0) return null;
  const all = [...doc.querySelectorAll<HTMLElement>('article[id^="post-"]')];
  const on = all.filter((el) => el.getBoundingClientRect().bottom > 0);
  const post = on.find((el) => el.getBoundingClientRect().bottom > SLIVER) ?? on[0];
  if (!post || post.getBoundingClientRect().top >= win.innerHeight) return null;
  return post.id;
}

/** Keeps the board's route (its fragment dropped) and the post in view, as the glass is entered. */
export function rememberBoard(href: string, doc: Document = document): void {
  const route = href.split('#')[0] ?? '';
  kept = { href: route, post: postInView(doc), scrollY: doc.defaultView?.scrollY ?? 0 };
  try { sessionStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* storage refused: the module copy still serves this load */ }
}

const isPlace = (v: unknown): v is BoardPlace => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.href === 'string' && p.href.startsWith('/') && !p.href.startsWith('//')
    && (p.post === null || (typeof p.post === 'string' && /^post-\d+$/.test(p.post)))
    && typeof p.scrollY === 'number';
};

/** Whether this document was reached by a reload or the browser's back or forward, not afresh. */
function returnedTo(): boolean {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type === 'reload' || entry?.type === 'back_forward';
  } catch {
    return false;
  }
}

/** The place kept on the way in, or none when the glass was opened by its address. */
export function boardPlace(): BoardPlace | null {
  if (kept) return kept;
  if (!returnedTo()) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isPlace(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetBoard(): void {
  kept = null;
  try { sessionStorage.removeItem(KEY); } catch { /* nothing kept to forget */ }
}

/** Where Back goes: the route with the post as its fragment, the route alone, or the index. */
export function backHref(place: BoardPlace | null): string {
  if (!place) return '/';
  return place.post ? `${place.href}#${place.post}` : place.href;
}

/** Frames a page with no posts is given to grow tall enough, and how long it may hold one height. */
const MOST_FRAMES = 600;
const SETTLED_FRAMES = 60;
const INPUTS = ['wheel', 'touchstart', 'keydown'] as const;

/**
 * Brings the scroll back to `y` on a page with no posts, once the page has drawn: its content loads
 * after the route changes, so this tries each frame until the page is tall enough. It stops there;
 * at the reader's first wheel, touch or key, which leaves the scroll theirs; when the route changes
 * under it; on a page that has held one height for a second without reaching `y`, which it leaves
 * at its bottom; and after ten seconds in any case. It lives outside any component, since the menu
 * bar that starts it unmounts as Back leaves the glass. It returns a function that calls it off.
 */
export function restoreScroll(win: Window, y: number): () => void {
  const path = win.location.pathname;
  let id = 0;
  let frames = 0;
  let height = -1;
  let held = 0;
  const stop = () => {
    win.cancelAnimationFrame(id);
    for (const input of INPUTS) win.removeEventListener(input, stop);
  };
  const step = () => {
    if (win.location.pathname !== path) { stop(); return; }
    const now = win.document.documentElement.scrollHeight;
    win.scrollTo(0, Math.min(y, Math.max(0, now - win.innerHeight)));
    held = now === height ? held + 1 : 0;
    height = now;
    if (Math.abs(win.scrollY - y) <= 1 || held >= SETTLED_FRAMES || ++frames >= MOST_FRAMES) { stop(); return; }
    id = win.requestAnimationFrame(step);
  };
  for (const input of INPUTS) win.addEventListener(input, stop, { passive: true });
  id = win.requestAnimationFrame(step);
  return stop;
}

/**
 * Back to the board: to the kept route and post, forgetting the place as it goes. On a page with
 * no posts the scroll comes back once the page has drawn (restoreScroll).
 */
export function useBackToBoard(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const place = boardPlace();
    forgetBoard();
    navigate(backHref(place));
    if (place && !place.post && place.scrollY > 0) restoreScroll(window, place.scrollY);
  }, [navigate]);
}
