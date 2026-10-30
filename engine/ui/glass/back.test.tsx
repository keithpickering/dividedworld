/**
 * Going back to the board (the web plan's glass amendment to Task 3): entering the glass keeps the
 * board's route and the post in view, and Back and Esc go to both. The place is this tab's own
 * (sessionStorage): it is never sent anywhere, and a reload of a glass page still knows it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backHref, boardPlace, forgetBoard, postInView, rememberBoard } from './back.ts';

/** Three posts, the first scrolled past the top, the second straddling it, the third below. */
function posts(rects: readonly [number, number][]) {
  document.body.innerHTML = rects.map((_, i) => `<article id="post-${i + 1}"></article>`).join('');
  rects.forEach(([top, bottom], i) => {
    vi.spyOn(document.getElementById(`post-${i + 1}`)!, 'getBoundingClientRect').mockReturnValue({ top, bottom, height: bottom - top } as DOMRect);
  });
}

beforeEach(() => { sessionStorage.clear(); forgetBoard(); });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('the post in view', () => {
  it('is the first post whose bottom is still on screen', () => {
    posts([[-400, -10], [-5, 300], [310, 700]]);
    expect(postInView()).toBe('post-2');
  });
  it('passes over a sliver of the post above, the one just read, at the top of the view', () => {
    posts([[-149, 7], [7, 162], [162, 318]]);
    expect(postInView()).toBe('post-2');
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
  it('is kept in this tab, so a glass page loaded afresh still knows it', () => {
    posts([[0, 300]]);
    rememberBoard('/t/abc');
    expect(JSON.parse(sessionStorage.getItem('kb-glass-back')!)).toMatchObject({ href: '/t/abc', post: 'post-1' });
  });
  it('is none when the glass was opened by its address', () => {
    expect(boardPlace()).toBeNull();
  });
  it('ignores a stored place that is not this app\'s', () => {
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: 'https://elsewhere.example/', post: null, scrollY: 0 }));
    expect(boardPlace()).toBeNull();
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
