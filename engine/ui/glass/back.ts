/**
 * Going back to the board (the web plan's glass amendment to Task 3): entering the glass keeps the
 * board's route and the post in view, and Back and Esc from a glass page go to both. The thread
 * already opens at the post a `#post-N` fragment names and focuses it (engine/ui/thread/Thread.tsx),
 * so Back is that route with the post as its fragment; a page with no posts gets its scroll back.
 *
 * The rule is held in one place, the router's moves, not by each link into the glass: every move
 * from a board route to a glass route keeps the board's place, measured while the board is still
 * drawn, and every move from the glass to a board forgets it, whether by Back, a crumb, a menu tab
 * that leads to a board or the browser's back (keepBoardPlace). So no way in can forget to keep
 * the place, and no way out can leave a stale one behind for a later Back. Which routes are glass
 * pages is the app's to say: the engine is given the predicate, never an instance's list.
 *
 * On a thread the place also keeps the last seq the thread showed and the last it knew of, and
 * Back carries both in the history entry it makes (returnState): a thread that grew while the
 * reader was in the glass holds what came behind its "new posts" bar, as it holds a live post,
 * rather than moving the reader (the feed's return, engine/ui/thread/feed.ts).
 *
 * The place is this tab's own: a module value, and a copy in sessionStorage so that a reloaded
 * glass page still knows it. It is never sent anywhere. The copy is read only when this document
 * was reached by a reload or the browser's back or forward: a glass page opened afresh by its
 * address, in a tab that once kept a place, has not come from that board, so its Back goes to the
 * index rather than to a board from before, and a document opened on a board forgets it. Back
 * forgets the place it used. A stored place that is not a path on this app (another origin, a
 * scheme), whose post is not a post id, or whose thread is not two seqs, is ignored, so a planted
 * value cannot send Back elsewhere or carry markup into an address.
 */
import { useCallback } from 'react';
import { addressOf, useNavigate, type Location } from '../router.tsx';

/** What a thread showed and knew of when the reader left it: the last seq on screen, and the last the thread had heard of. */
export interface ThreadReturn {
  readonly shown: number;
  readonly known: number;
}

export interface BoardPlace {
  /** The board's route: a path and its query, without a fragment. */
  readonly href: string;
  /** The id of the post in view (`post-N`), or none on a page with no posts. */
  readonly post: string | null;
  readonly scrollY: number;
  /** On a thread, what it showed and knew of; none on any other page. */
  readonly thread: ThreadReturn | null;
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

const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isReturn = (v: unknown): v is ThreadReturn => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return isSeq(r.shown) && isSeq(r.known);
};

/**
 * What the thread on the page showed and knew of: the highest seq among its posts on screen, and
 * the last seq it has heard of (`data-kb-known`, which counts the posts held behind its bar). None
 * on a page that is not a thread, or a thread with no post drawn.
 */
export function threadInView(doc: Document = document): ThreadReturn | null {
  const thread = doc.querySelector<HTMLElement>('[data-kb-thread]');
  if (!thread) return null;
  const seqs = [...thread.querySelectorAll<HTMLElement>('article[data-kb-seq]')].map((el) => Number(el.dataset.kbSeq)).filter(isSeq);
  const known = Number(thread.dataset.kbKnown);
  if (seqs.length === 0 || !isSeq(known)) return null;
  const shown = Math.max(...seqs);
  return { shown, known: Math.max(known, shown) };
}

/** Keeps the board's route (its fragment dropped), the post in view and a thread's seqs, as the glass is entered. */
export function rememberBoard(href: string, doc: Document = document): void {
  const route = href.split('#')[0] ?? '';
  kept = { href: route, post: postInView(doc), scrollY: doc.defaultView?.scrollY ?? 0, thread: threadInView(doc) };
  try { sessionStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* storage refused: the module copy still serves this load */ }
}

/** A stored place, or none when it is not one; a place kept before threads kept theirs has no thread. */
function placeOf(v: unknown): BoardPlace | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  const thread = p.thread ?? null;
  const ok = typeof p.href === 'string' && p.href.startsWith('/') && !p.href.startsWith('//')
    && (p.post === null || (typeof p.post === 'string' && /^post-\d+$/.test(p.post)))
    && typeof p.scrollY === 'number'
    && (thread === null || isReturn(thread));
  if (!ok) return null;
  return { href: p.href as string, post: p.post as string | null, scrollY: p.scrollY as number, thread: isReturn(thread) ? { shown: thread.shown, known: thread.known } : null };
}

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
    return placeOf(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}

export function forgetBoard(): void {
  kept = null;
  try { sessionStorage.removeItem(KEY); } catch { /* nothing kept to forget */ }
}

/** Where Back goes: the route with the post as its fragment, the route alone, or the index. */
export function backHref(place: Pick<BoardPlace, 'href' | 'post'> | null): string {
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

/** The history state Back gives a thread: what it showed and knew of when the reader left. */
export function returnState(r: ThreadReturn): unknown {
  return { kbThreadReturn: { shown: r.shown, known: r.known } };
}

/** What a history entry's state says the thread showed and knew of, or none when it says nothing well-formed. */
export function returnOf(state: unknown): ThreadReturn | null {
  if (typeof state !== 'object' || state === null) return null;
  const r = (state as Record<string, unknown>).kbThreadReturn;
  return isReturn(r) ? { shown: r.shown, known: r.known } : null;
}

/**
 * The rule, for the router's moves (RouterProvider's `onMove`): a move from a board route into the
 * glass keeps the board's place, measured from the page being left, which is still drawn when the
 * router calls this; a move from the glass to a board forgets it; a move within either leaves it.
 * A document opened on a board route forgets a place left in the tab, and one opened on a glass
 * page leaves it to boardPlace, which reads it only after a reload or a back or forward.
 */
export function keepBoardPlace(isGlass: (path: string) => boolean, doc: Document = document): (from: Location | null, to: Location) => void {
  return (from, to) => {
    const into = isGlass(to.path);
    if (from === null) { if (!into) forgetBoard(); return; }
    const out = isGlass(from.path);
    if (!out && into) rememberBoard(addressOf(from), doc);
    else if (out && !into) forgetBoard();
  };
}

/**
 * Back to the board: to the kept route and post, forgetting the place as it goes (the router's
 * move out of the glass forgets it too). A thread is given what it showed and knew of, so it holds
 * what came meanwhile behind its bar. On a page with no posts the scroll comes back once the page
 * has drawn (restoreScroll).
 */
export function useBackToBoard(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const place = boardPlace();
    forgetBoard();
    navigate(backHref(place), place?.thread ? { state: returnState(place.thread) } : undefined);
    if (place && !place.post && place.scrollY > 0) restoreScroll(window, place.scrollY);
  }, [navigate]);
}
