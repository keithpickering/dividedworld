/**
 * Going back to the board (the web plan's glass amendment to Task 3): entering the glass keeps the
 * board's route and the post in view, and Back and Esc from a glass page go to both. The thread
 * already opens at the post a `#post-N` fragment names and focuses it (engine/ui/thread/Thread.tsx),
 * so Back is that route with the post as its fragment; a page with no posts gets its scroll back.
 *
 * The place is this tab's own: a module value, and a copy in sessionStorage so that a glass page
 * loaded afresh still knows it. It is never sent anywhere. A stored place that is not a path on
 * this app (another origin, a scheme) is ignored, so a planted value cannot send Back elsewhere.
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

/** The first post with more than a sliver still on screen: the one the reader is on. */
export function postInView(doc: Document = document): string | null {
  const all = [...doc.querySelectorAll<HTMLElement>('article[id^="post-"]')];
  const on = all.filter((el) => el.getBoundingClientRect().bottom > 0);
  return (on.find((el) => el.getBoundingClientRect().bottom > SLIVER) ?? on[0])?.id ?? null;
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

/** The place kept on the way in, or none when the glass was opened by its address. */
export function boardPlace(): BoardPlace | null {
  if (kept) return kept;
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

/**
 * Back to the board: to the kept route and post. On a page with no posts the scroll comes back
 * once the page has drawn (a few frames, since its content loads after the route changes).
 */
export function useBackToBoard(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const place = boardPlace();
    navigate(backHref(place));
    if (place && !place.post && place.scrollY > 0) {
      let tries = 20;
      const restore = () => {
        window.scrollTo(0, place.scrollY);
        if (Math.abs(window.scrollY - place.scrollY) > 1 && --tries > 0) requestAnimationFrame(restore);
      };
      requestAnimationFrame(restore);
    }
  }, [navigate]);
}
