/**
 * The menu bar on every glass page (the web plan's glass amendment to Task 3, and the glass plan's
 * section 8): Back to the board with its Esc key, then the pages, the current one marked; signed
 * out, Back alone. Rankings and My log stand in for the standings until Parts 2 and 4 build them.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { renderInWorld } from '../test-world.tsx';
import { boardPlace, forgetBoard, rememberBoard } from './back.ts';
import { MenuBar } from './MenuBar.tsx';

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

const bar = () => screen.getByRole('navigation', { name: 'Menu' });
const tabs = () => within(bar()).getAllByRole('link').map((a) => a.textContent?.trim());

beforeEach(() => { sessionStorage.clear(); forgetBoard(); });
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

describe('the menu bar', () => {
  test('Back to the board comes first, with Esc as its key, then the pages in the boards\' order', async () => {
    renderInWorld(<MenuBar />, { path: '/characters', seed: signedIn });
    const back = await within(bar()).findByRole('link', { name: 'Back to the board' });
    expect(back).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(tabs()).toEqual(['Back to the board', 'My characters', 'Rankings', 'My log', 'Settings']);
  });
  test('the current page carries aria-current, the character pages under My characters and invites under Settings', async () => {
    const { unmount } = renderInWorld(<MenuBar />, { path: '/characters/new', seed: signedIn });
    expect(await within(bar()).findByRole('link', { name: 'My characters' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar()).getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
    unmount();
    renderInWorld(<MenuBar />, { path: '/invites', seed: signedIn });
    expect(await within(bar()).findByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar()).getByRole('link', { name: 'My characters' })).not.toHaveAttribute('aria-current');
  });
  test('Rankings and My log stand in for the standings until their pages are built', async () => {
    renderInWorld(<MenuBar />, { path: '/settings', seed: signedIn });
    expect(await within(bar()).findByRole('link', { name: 'Rankings' })).toHaveAttribute('href', '/standings');
    expect(within(bar()).getByRole('link', { name: 'My log' })).toHaveAttribute('href', '/standings');
  });
  test('signed out, the bar holds Back to the board alone: its pages need an account', async () => {
    renderInWorld(<MenuBar />, { path: '/sign-in' });
    await act(async () => {});
    expect(tabs()).toEqual(['Back to the board']);
  });
});

describe('going back', () => {
  function onPost() {
    document.body.insertAdjacentHTML('beforeend', '<article id="post-4"></article>');
    vi.spyOn(document.getElementById('post-4')!, 'getBoundingClientRect').mockReturnValue({ top: 20, bottom: 400, height: 380 } as DOMRect);
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true, writable: true });
    rememberBoard('/t/abc?page=2');
    document.getElementById('post-4')!.remove();
  }
  test('Back goes to the board\'s route and the post that was in view', async () => {
    onPost();
    renderInWorld(<MenuBar />, { path: '/characters', seed: signedIn });
    await userEvent.click(await within(bar()).findByRole('link', { name: 'Back to the board' }));
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/t/abc?page=2#post-4');
  });
  test('Esc does the same from anywhere on the page', async () => {
    onPost();
    renderInWorld(<MenuBar />, { path: '/settings', seed: signedIn });
    await within(bar()).findByRole('link', { name: 'Settings' });
    await userEvent.keyboard('{Escape}');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/t/abc?page=2#post-4');
  });
  test('with nothing kept, Back goes to the index', async () => {
    renderInWorld(<MenuBar />, { path: '/characters', seed: signedIn });
    expect(await within(bar()).findByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/');
  });
  test('an Esc another control has handled, or one typed in a text field, stays on the page', async () => {
    renderInWorld(<><MenuBar /><input aria-label="Address" /></>, { path: '/settings', seed: signedIn });
    await within(bar()).findByRole('link', { name: 'Settings' });
    const handled = (e: KeyboardEvent) => { if (e.key === 'Escape') e.preventDefault(); };
    document.addEventListener('keydown', handled, true);
    await userEvent.keyboard('{Escape}');
    document.removeEventListener('keydown', handled, true);
    expect(window.location.pathname).toBe('/settings');
    await userEvent.click(screen.getByRole('textbox', { name: 'Address' }));
    await userEvent.keyboard('{Escape}');
    expect(window.location.pathname).toBe('/settings');
  });
});

describe('from the Task 1.4 reviews', () => {
  const here = () => window.location.pathname + window.location.search + window.location.hash;
  function kept() {
    document.body.insertAdjacentHTML('beforeend', '<article id="post-4"></article>');
    vi.spyOn(document.getElementById('post-4')!, 'getBoundingClientRect').mockReturnValue({ top: 20, bottom: 400, height: 380 } as DOMRect);
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true, writable: true });
    rememberBoard('/t/abc?page=2');
    document.getElementById('post-4')!.remove();
  }
  test('a held Esc (its repeats) and an Esc that ends an IME composition do not go back', async () => {
    kept();
    renderInWorld(<MenuBar />, { path: '/settings', seed: signedIn });
    await within(bar()).findByRole('link', { name: 'Settings' });
    fireEvent.keyDown(document.body, { key: 'Escape', repeat: true });
    expect(here()).toBe('/settings');
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
    expect(here()).toBe('/settings');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(here()).toBe('/t/abc?page=2#post-4');
  });
  test('Back forgets the place it used, so a later glass page opened by address does not go back to it', async () => {
    kept();
    renderInWorld(<MenuBar />, { path: '/characters', seed: signedIn });
    await userEvent.click(await within(bar()).findByRole('link', { name: 'Back to the board' }));
    expect(boardPlace()).toBeNull();
  });
  test('a modified click on Back opens as the browser would, and keeps the place', async () => {
    kept();
    renderInWorld(<MenuBar />, { path: '/characters', seed: signedIn });
    const back = await within(bar()).findByRole('link', { name: 'Back to the board' });
    expect(back).toHaveAttribute('href', '/t/abc?page=2#post-4');
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(back, mod);
      expect(here()).toBe('/characters');
    }
    expect(boardPlace()).not.toBeNull();
  });
  test('a stored place with a post that is not a post id goes nowhere but the index', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry]);
    sessionStorage.setItem('kb-glass-back', JSON.stringify({ href: '/t/abc', post: 'post-1"><img src=x>', scrollY: 0 }));
    renderInWorld(<MenuBar />, { path: '/characters', seed: signedIn });
    expect(await within(bar()).findByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/');
  });
  test('the current tab is scrolled into view in the bar (the phone\'s strip scrolls on its own), smoothly unless motion is reduced', async () => {
    const seen: { readonly el: Element; readonly opts: unknown }[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element, opts?: unknown) { seen.push({ el: this, opts }); };
    const { unmount } = renderInWorld(<MenuBar />, { path: '/settings', seed: signedIn });
    const settings = await within(bar()).findByRole('link', { name: 'Settings' });
    expect(seen.at(-1)).toEqual({ el: settings, opts: { inline: 'nearest', block: 'nearest', behavior: 'smooth' } });
    unmount();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    renderInWorld(<MenuBar />, { path: '/characters/new', seed: signedIn });
    const mine = await within(bar()).findByRole('link', { name: 'My characters' });
    expect(seen.at(-1)).toEqual({ el: mine, opts: { inline: 'nearest', block: 'nearest', behavior: 'auto' } });
  });
});
