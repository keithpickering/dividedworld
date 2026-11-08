/**
 * The page shell every glass page sits in: the menu bar, the smoke of its surface, and the content
 * column, which is the page's `main`. A move between glass pages reads as one, as the frame's does.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { renderInWorld } from '../test-world.tsx';
import { Link } from '../router.tsx';
import { Routes, type Route } from '../routes.tsx';
import * as enter from './enter.ts';
import { GlassLink } from './Link.tsx';
import { Page } from './Page.tsx';

vi.mock('./enter.ts', async (orig) => {
  const real = await orig<typeof import('./enter.ts')>();
  return { ...real, enterScreen: vi.fn(real.enterScreen) };
});

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

/* jsdom has no scrolling: the page's move to its top is watched instead. */
const scrolled = vi.fn();
beforeEach(() => { scrolled.mockReset(); vi.stubGlobal('scrollTo', scrolled); });
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('the glass page', () => {
  test('holds the menu bar, the smoke of its surface behind, and the content in main', async () => {
    const { container } = renderInWorld(<Page surface="settings"><h1>Settings</h1></Page>, { path: '/settings', seed: signedIn });
    expect(await screen.findByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    const smoke = container.querySelector('.kb-smoke');
    expect(smoke).toHaveAttribute('data-kb-surface', 'settings');
    expect(smoke).toHaveAttribute('aria-hidden', 'true');
    /* The board's banner and HUD are not on a glass page. */
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Game HUD' })).toBeNull();
  });
  test('moving to another glass page puts focus at the top of the new page', async () => {
    renderInWorld(<Page surface="characters"><p>page</p></Page>, { path: '/characters', seed: signedIn });
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(scrolled).toHaveBeenCalledWith(0, 0);
  });
});

describe('from the Task 1.4 reviews', () => {
  test('as the frame does, an address with a fragment, or the browser\'s back and forward, keeps its own scroll', async () => {
    renderInWorld(<Page surface="characters"><p>page</p></Page>, { path: '/characters', seed: signedIn });
    await screen.findByRole('link', { name: 'Settings' });
    act(() => { window.history.pushState(null, '', '/settings#invites'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(scrolled).not.toHaveBeenCalled();
    act(() => { window.history.pushState(null, '', '/characters/new'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(scrolled).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('the content, once Part 2 restyled every glass page', () => {
  test('is drawn on the glass itself, in main at the column\'s scale, with no board panel', async () => {
    const { container } = renderInWorld(<Page surface="settings"><p>words</p></Page>, { path: '/settings', seed: signedIn });
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(container.querySelector('.kb-glass-content-panel')).toBeNull();
    /* The content is the keyed screen's (the screen change's), whose first child is the words themselves. */
    const shown = screen.getByRole('main').firstElementChild!;
    expect(shown).toHaveClass('kb-glass-screen');
    expect(shown.firstElementChild).toHaveTextContent('words');
    expect(shown.firstElementChild?.tagName).toBe('P');
  });
});

/* A change between screens (motion.ts `screen`): the old content leaves toward the old tab's side, the new enters from the new tab's. */
describe('a change between glass screens', () => {
  beforeEach(() => document.documentElement.setAttribute('data-kb-motion', 'full'));
  afterEach(() => document.documentElement.removeAttribute('data-kb-motion'));
  const x = (el: Element) => /translateX\((-?[\d.]+)px\)/u.exec((el as HTMLElement).style.transform)?.[1];
  const screens = () => ({
    entering: document.querySelector<HTMLElement>('.kb-glass-screen:not([data-kb-exiting])')!,
    leaving: document.querySelector<HTMLElement>('.kb-glass-screen[data-kb-exiting]')!,
  });

  test('to a later tab, the old leaves toward the left and the new enters from the right', async () => {
    renderInWorld(<Page surface="settings"><p>words</p></Page>, { path: '/alerts', seed: signedIn });
    await userEvent.click(await within(await screen.findByRole('navigation', { name: 'Menu' })).findByRole('link', { name: 'Settings' }));
    const { entering, leaving } = screens();
    expect(leaving).toHaveAttribute('inert');
    expect(Number(x(entering))).toBeGreaterThan(0);
    await waitFor(() => expect(Number(x(leaving))).toBeLessThan(0));
  });

  test('to an earlier tab, the old leaves toward the right and the new enters from the left', async () => {
    renderInWorld(<Page surface="settings"><p>words</p></Page>, { path: '/settings', seed: signedIn });
    await userEvent.click(await within(await screen.findByRole('navigation', { name: 'Menu' })).findByRole('link', { name: 'Alerts' }));
    const { entering, leaving } = screens();
    expect(Number(x(entering))).toBeLessThan(0);
    await waitFor(() => expect(Number(x(leaving))).toBeGreaterThan(0));
  });
});

/* The screen is keyed by the router's key, and the page shows the wait. */
describe('a page and the router\'s key', () => {
  const entered = () => vi.mocked(enter.enterScreen);
  beforeEach(() => entered().mockClear());

  test('a change of key within one path swaps the screen and plays the entrance again', async () => {
    const routes: Route[] = [{ path: '/log', load: async () => 'doc', key: (_p, q) => q.get('p') ?? '1', render: () => <p>log</p> }];
    renderInWorld(<><Page surface="log"><p>page</p></Page><Routes routes={routes} /><Link to="/log?p=2">next</Link></>, { path: '/log', seed: signedIn });
    await screen.findByText('log');
    const before = entered().mock.calls.length;
    await userEvent.click(screen.getByRole('link', { name: 'next' }));
    expect(entered().mock.calls.length).toBe(before + 1);
    expect(scrolled).toHaveBeenCalledWith(0, 0);
    expect(screen.getByRole('main')).toHaveFocus();
  });

  test('two paths that share a key are one screen: no new entrance, no scroll, and no second screen', async () => {
    const routes: Route[] = [
      { path: '/characters', load: async () => 'doc', key: () => 'mine', render: () => <p>list</p> },
      { path: '/characters/edit', load: async () => 'doc', key: () => 'mine', render: () => <p>edit</p> },
    ];
    renderInWorld(<><Page surface="characters"><p>page</p></Page><Routes routes={routes} /><Link to="/characters/edit">edit</Link></>, { path: '/characters', seed: signedIn });
    await screen.findByText('list');
    const before = entered().mock.calls.length;
    await userEvent.click(screen.getByRole('link', { name: 'edit' }));
    expect(entered().mock.calls.length).toBe(before);
    expect(document.querySelectorAll('.kb-glass-screen')).toHaveLength(1);
  });
});

describe('the page while a load is out', () => {
  function mount() {
    const resolves: Array<(d: unknown) => void> = [];
    const routes: Route[] = [
      { path: '/alerts', render: () => <p>alerts</p> },
      { path: '/season', load: () => new Promise<unknown>((r) => { resolves.push(r); }), render: () => <p>arrived</p> },
    ];
    const view = renderInWorld(<><Page surface="log"><GlassLink to="/season">Open season</GlassLink><Link to="/season">plain</Link></Page><Routes routes={routes} /></>, { path: '/alerts', seed: signedIn });
    return { ...view, land: async () => { await act(async () => { resolves.splice(0).forEach((r) => r('doc')); }); } };
  }

  test('main is aria-busy and the page takes the progress cursor while pending, and neither after', async () => {
    const { container, land } = mount();
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy', 'true');
    await userEvent.click(screen.getByRole('link', { name: 'Open season' }));
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.kb-glass-page')).toHaveAttribute('data-kb-pending');
    await land();
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.kb-glass-page')).not.toHaveAttribute('data-kb-pending');
  });

  test('a visually hidden status says Screen loaded when a load lands, and nothing at rest', async () => {
    const { land } = mount();
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('status')).toHaveClass('kb-visually-hidden');
    await userEvent.click(screen.getByRole('link', { name: 'Open season' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await land();
    expect(screen.getByRole('status')).toHaveTextContent('Screen loaded');
  });

  test('the status empties a few seconds after it lands, so it is said once', async () => {
    const { land } = mount();
    await screen.findByRole('navigation', { name: 'Menu' });
    await userEvent.click(screen.getByRole('link', { name: 'Open season' }));
    vi.useFakeTimers();
    try {
      await land();
      expect(screen.getByRole('status')).toHaveTextContent('Screen loaded');
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    } finally { vi.useRealTimers(); }
  });

  test('a link on the page that is pending is a claimed source: the menu bar\'s corner shows no spinner beside it', async () => {
    const { container } = mount();
    await screen.findByRole('navigation', { name: 'Menu' });
    await userEvent.click(screen.getByRole('link', { name: 'Open season' }));
    expect(screen.getByRole('link', { name: 'Open season' }).querySelector('.kb-spinner')).not.toBeNull();
    expect(container.querySelector('.kb-glass-menu-corner .kb-spinner')).toBeNull();
  });

  test('a plain Link on the page claims nothing, so the menu bar\'s corner shows the wait', async () => {
    const { container } = mount();
    await screen.findByRole('navigation', { name: 'Menu' });
    await userEvent.click(screen.getByRole('link', { name: 'plain' }));
    expect(container.querySelector('.kb-glass-menu-corner .kb-spinner')).not.toBeNull();
  });
});
