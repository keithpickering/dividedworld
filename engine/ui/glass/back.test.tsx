/**
 * Going back to the board (the web plan's glass amendment to Task 3): entering the glass keeps the
 * board's route and the post in view, and Back and Esc go to both. The place is this tab's own
 * (sessionStorage): it is never sent anywhere, a reload of a glass page still knows it, and a glass
 * page opened afresh by its address does not go back to a board from before.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, useLocation, useNavigate, type Location } from '../router.tsx';
import { backHref, boardPlace, forgetBoard, keepBoardPlace, postInView, rememberBoard, restoreScroll, returnOf, returnState, useBackToBoard } from './back.ts';

/** Posts at these viewport rects, read down to `scrollY`. */
function posts(rects: readonly [number, number][], scrollY = 500) {
  document.body.innerHTML = rects.map((_, i) => `<article id="post-${i + 1}"></article>`).join('');
  rects.forEach(([top, bottom], i) => {
    vi.spyOn(document.getElementById(`post-${i + 1}`)!, 'getBoundingClientRect').mockReturnValue({ top, bottom, height: bottom - top } as DOMRect);
  });
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true, writable: true });
}

/** How this document was reached, as the Navigation Timing entry says. */
function arrivedBy(type: 'navigate' | 'reload' | 'back_forward') {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type } as unknown as PerformanceEntry]);
}

beforeEach(() => { sessionStorage.clear(); forgetBoard(); });
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

describe('the post in view', () => {
  it('is the first post whose bottom is still on screen', () => {
    posts([[-400, -10], [-5, 300], [310, 700]]);
    expect(postInView()).toBe('post-2');
  });
  it('passes over a sliver of the post above, the one just read, at the top of the view', () => {
    posts([[-149, 7], [7, 162], [162, 318]]);
    expect(postInView()).toBe('post-2');
  });
  it('is the next post when the view sits between two posts', () => {
    posts([[-400, -10], [60, 300]]);
    expect(postInView()).toBe('post-2');
  });
  it('is none at the top of the page: Back opens the route at its top', () => {
    posts([[120, 300], [310, 700]], 0);
    expect(postInView()).toBeNull();
  });
  it('is none when the next post is below the view (the reader is on what comes after the posts)', () => {
    posts([[-400, -10], [window.innerHeight + 20, window.innerHeight + 300]]);
    expect(postInView()).toBeNull();
  });
  it('is none on a page with no posts', () => {
    document.body.innerHTML = '<p>The index.</p>';
    expect(postInView()).toBeNull();
  });
});

describe('the board place', () => {
  it('keeps the route without its fragment, and the post in view', () => {
    posts([[-400, -10], [-5, 300]]);
    rememberBoard('/t/abc?page=2#post-1');
    expect(boardPlace()).toMatchObject({ href: '/t/abc?page=2', post: 'post-2' });
  });
  it('is kept in this tab, so a reloaded glass page still knows it', () => {
    posts([[0, 300]]);
    rememberBoard('/t/abc');
    expect(JSON.parse(sessionStorage.getItem('kb-glass-back')!)).toMatchObject({ href: '/t/abc', post: 'post-1' });
  });
  it('is read back from the tab after a reload, or a back or forward into the glass', () => {
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-3', scrollY: 900 }));
    arrivedBy('reload');
    expect(boardPlace()).toMatchObject({ href: '/t/abc', post: 'post-3' });
    arrivedBy('back_forward');
    expect(boardPlace()).toMatchObject({ href: '/t/abc', post: 'post-3' });
  });
  it('is none when the glass page was opened afresh by its address, even with a place left in the tab', () => {
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-3', scrollY: 900 }));
    arrivedBy('navigate');
    expect(boardPlace()).toBeNull();
  });
  it('is none when nothing was kept', () => {
    expect(boardPlace()).toBeNull();
  });
  it('ignores a stored place that is not this app\'s', () => {
    arrivedBy('reload');
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: 'https://elsewhere.example/', post: null, scrollY: 0 }));
    expect(boardPlace()).toBeNull();
  });
  it('ignores a stored place whose post is not a post id, so Back never carries it into an address', () => {
    arrivedBy('reload');
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-1"><img src=x>', scrollY: 0 }));
    expect(boardPlace()).toBeNull();
    expect(backHref(boardPlace())).toBe('/');
  });
  it('is forgotten once Back has used it', () => {
    posts([[0, 300]]);
    rememberBoard('/t/abc');
    forgetBoard();
    expect(boardPlace()).toBeNull();
    expect(sessionStorage.getItem('kb-glass-back')).toBeNull();
  });
});

describe('a thread\'s place', () => {
  it('keeps what the thread showed and knew of, so a return can hold what came while the reader was away', () => {
    document.body.innerHTML = '<div data-kb-thread="abc" data-kb-known="14"><article id="post-11" data-kb-seq="11"></article><article id="post-12" data-kb-seq="12"></article></div>';
    rememberBoard('/t/abc?page=1');
    expect(boardPlace()).toMatchObject({ href: '/t/abc?page=1', thread: { shown: 12, known: 14 } });
  });
  it('is none on a page that is not a thread', () => {
    document.body.innerHTML = '<article id="post-1" data-kb-seq="1"></article>';
    rememberBoard('/c/abc');
    expect(boardPlace()).toMatchObject({ thread: null });
  });
  it('is read back from the tab, and a stored one that is not two seqs is no thread', () => {
    arrivedBy('reload');
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-3', scrollY: 900, thread: { shown: 12, known: 14 } }));
    expect(boardPlace()).toMatchObject({ thread: { shown: 12, known: 14 } });
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-3', scrollY: 900, thread: { shown: '12', known: 14 } }));
    expect(boardPlace()).toBeNull();
    /* A place kept before threads kept theirs is a place with no thread. */
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-3', scrollY: 900 }));
    expect(boardPlace()).toMatchObject({ href: '/t/abc', thread: null });
  });
  it('travels in the history entry Back makes, and only a well-formed one is read from it', () => {
    expect(returnOf(returnState({ shown: 12, known: 14 }))).toEqual({ shown: 12, known: 14 });
    expect(returnOf(null)).toBeNull();
    expect(returnOf({ kbThreadReturn: { shown: -1, known: 14 } })).toBeNull();
    expect(returnOf({ kbThreadReturn: { shown: 12 } })).toBeNull();
  });
});

const GLASS = new Set(['/characters', '/characters/new', '/settings']);
const isGlass = (p: string) => GLASS.has(p);
const at = (href: string): Location => {
  const u = new URL(href, 'http://localhost');
  return { path: u.pathname, query: u.searchParams, hash: u.hash.replace(/^#/, ''), popped: false, state: null };
};

describe('the place, kept by every move into the glass and forgotten by every move out', () => {
  const move = keepBoardPlace(isGlass);
  it('a move from a board into the glass keeps the board\'s route and the post in view, measured while the board is drawn', () => {
    posts([[-400, -10], [-5, 300]]);
    move(at('/t/abc?page=2#post-1'), at('/characters/new'));
    expect(boardPlace()).toMatchObject({ href: '/t/abc?page=2', post: 'post-2' });
  });
  it('a move from the glass to a board forgets it, however it was made', () => {
    posts([[0, 300]]);
    move(at('/t/abc'), at('/characters'));
    move(at('/characters'), at('/'));
    expect(boardPlace()).toBeNull();
    expect(sessionStorage.getItem('kb-glass-back')).toBeNull();
  });
  it('a move within the glass, or within the board, leaves it as it is', () => {
    posts([[0, 300]]);
    move(at('/t/abc'), at('/characters'));
    move(at('/characters'), at('/settings'));
    expect(boardPlace()).toMatchObject({ href: '/t/abc' });
    forgetBoard();
    rememberBoard('/t/abc');
    move(at('/t/abc'), at('/b/general'));
    expect(boardPlace()).toMatchObject({ href: '/t/abc' });
  });
  it('a document opened on a board forgets a place left in the tab; one opened on a glass page leaves it to boardPlace', () => {
    arrivedBy('reload');
    const stored = JSON.stringify({ href: '/t/abc', post: 'post-3', scrollY: 900, thread: null });
    sessionStorage.setItem('kb-glass-back', stored);
    move(null, at('/settings'));
    expect(sessionStorage.getItem('kb-glass-back')).toBe(stored);
    move(null, at('/b/general'));
    expect(sessionStorage.getItem('kb-glass-back')).toBeNull();
  });
});

describe('Back, with the rule in the router', () => {
  let go: ReturnType<typeof useNavigate>;
  let back: () => void;
  function Screen() {
    const { path } = useLocation();
    go = useNavigate();
    back = useBackToBoard();
    /* A thread draws its posts; scrolled down, its second post is the one in view. */
    return path.startsWith('/t/') ? <div data-kb-thread={path} data-kb-known="2"><article id="post-1" data-kb-seq="1" /><article id="post-2" data-kb-seq="2" /></div> : <p>{path}</p>;
  }
  const mount = (path: string) => {
    window.history.replaceState(null, '', path);
    render(<RouterProvider onMove={keepBoardPlace(isGlass)}><Screen /></RouterProvider>);
  };
  const scrolled = () => {
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true, writable: true });
    vi.spyOn(document.getElementById('post-1')!, 'getBoundingClientRect').mockReturnValue({ top: -400, bottom: -10 } as DOMRect);
    vi.spyOn(document.getElementById('post-2')!, 'getBoundingClientRect').mockReturnValue({ top: -5, bottom: 300 } as DOMRect);
  };

  it('lands on the board the glass was last entered from, after a crumb out and a link in that keeps nothing itself', () => {
    mount('/t/A');
    act(() => go('/characters'));
    act(() => go('/'));
    act(() => go('/t/B'));
    scrolled();
    act(() => go('/characters/new'));
    act(() => back());
    expect(window.location.pathname + window.location.hash).toBe('/t/B#post-2');
  });
  it('the browser\'s back and forward move out of and into the glass as a link does', () => {
    mount('/t/A');
    act(() => go('/characters'));
    act(() => {
      window.history.replaceState(null, '', '/b/general');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => {
      window.history.replaceState(null, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(boardPlace()).toMatchObject({ href: '/b/general' });
  });
  it('carries what a thread showed and knew of into the history entry it makes', () => {
    mount('/t/B');
    scrolled();
    act(() => go('/characters'));
    act(() => back());
    expect(returnOf(window.history.state)).toEqual({ shown: 2, known: 2 });
  });
});

describe('the address Back goes to', () => {
  it('is the route with the post as its fragment, so the thread opens at that post', () => {
    expect(backHref({ href: '/t/abc?page=2', post: 'post-7' })).toBe('/t/abc?page=2#post-7');
  });
  it('is the route alone on a page with no posts', () => {
    expect(backHref({ href: '/b/general', post: null })).toBe('/b/general');
  });
  it('is the index when nothing was kept', () => {
    expect(backHref(null)).toBe('/');
  });
});

describe('the scroll coming back on a page with no posts', () => {
  /** A window whose page grows as frames pass, and whose frames run when `frame()` is called. */
  function fakeWindow({ grows = [2000], viewport = 800, path = '/b/general' } = {}) {
    const frames: FrameRequestCallback[] = [];
    const listeners = new Map<string, EventListener>();
    let height = grows[0]!;
    let drawn = 0;
    const win = {
      scrollY: 0,
      innerHeight: viewport,
      location: { pathname: path },
      document: { documentElement: { get scrollHeight() { return height; } } },
      scrollTo: vi.fn((_x: number, y: number) => { win.scrollY = Math.max(0, Math.min(y, height - viewport)); }),
      requestAnimationFrame: (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; },
      cancelAnimationFrame: () => { frames.length = 0; },
      addEventListener: (type: string, fn: EventListener) => { listeners.set(type, fn); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    };
    const frame = (n = 1) => {
      for (let i = 0; i < n; i++) {
        drawn += 1;
        height = grows[Math.min(drawn, grows.length - 1)]!;
        const run = frames.splice(0);
        run.forEach((cb) => cb(drawn * 16));
      }
    };
    return { win: win as unknown as Window, frame, listeners, pending: () => frames.length };
  }

  it('scrolls to the kept height once the page is tall enough, then stops', () => {
    const w = fakeWindow({ grows: [600, 600, 3000] });
    restoreScroll(w.win, 1200);
    w.frame(3);
    expect(w.win.scrollY).toBe(1200);
    w.frame(1);
    expect(w.pending()).toBe(0);
    expect(w.listeners.size).toBe(0);
  });
  it('on a page too short ever to reach it, settles at the bottom and stops', () => {
    const w = fakeWindow({ grows: [1000] });
    restoreScroll(w.win, 5000);
    w.frame(200);
    expect(w.win.scrollY).toBe(200);
    expect(w.pending()).toBe(0);
  });
  it('stops at the reader\'s first wheel, touch or key, leaving the scroll theirs', () => {
    for (const input of ['wheel', 'touchstart', 'keydown']) {
      const w = fakeWindow({ grows: [600] });
      restoreScroll(w.win, 1200);
      w.frame(1);
      w.listeners.get(input)!(new Event(input));
      expect(w.pending()).toBe(0);
      expect(w.listeners.size).toBe(0);
    }
  });
  it('stops when the route has changed under it', () => {
    const w = fakeWindow({ grows: [600] });
    restoreScroll(w.win, 1200);
    (w.win.location as { pathname: string }).pathname = '/t/other';
    w.frame(1);
    expect(w.win.scrollTo).not.toHaveBeenCalled();
    expect(w.pending()).toBe(0);
  });
  it('can be called off', () => {
    const w = fakeWindow({ grows: [600] });
    const stop = restoreScroll(w.win, 1200);
    stop();
    expect(w.pending()).toBe(0);
    expect(w.listeners.size).toBe(0);
  });
});
