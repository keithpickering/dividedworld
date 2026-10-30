/**
 * Going back to the board (the web plan's glass amendment to Task 3): entering the glass keeps the
 * board's route and the post in view, and Back and Esc go to both. The place is this tab's own
 * (sessionStorage): it is never sent anywhere, a reload of a glass page still knows it, and a glass
 * page opened afresh by its address does not go back to a board from before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backHref, boardPlace, forgetBoard, postInView, rememberBoard, restoreScroll } from './back.ts';

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

describe('the address Back goes to', () => {
  it('is the route with the post as its fragment, so the thread opens at that post', () => {
    expect(backHref({ href: '/t/abc?page=2', post: 'post-7', scrollY: 900 })).toBe('/t/abc?page=2#post-7');
  });
  it('is the route alone on a page with no posts', () => {
    expect(backHref({ href: '/b/general', post: null, scrollY: 120 })).toBe('/b/general');
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
