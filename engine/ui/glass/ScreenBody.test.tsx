/**
 * The screen body: the part of a glass page that swaps in place (docs/plans/2026-11-08-glass-in-page-swap-design.md). The old body stays
 * over the new one while it leaves, inert; a move reads its direction from the change of `at`; a move that is not a Back brings the body's
 * top under the menu bar.
 */
import { act, configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { renderInWorld } from '../test-world.tsx';
import { Link, useLocation } from '../router.tsx';
import { Routes, type Route } from '../routes.tsx';
import * as enter from './enter.ts';
import { Page } from './Page.tsx';
import { ScreenBody } from './ScreenBody.tsx';

vi.mock('./enter.ts', async (orig) => {
  const real = await orig<typeof import('./enter.ts')>();
  return { ...real, enterScreen: vi.fn(real.enterScreen) };
});

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

/* The body's place comes from the address (`?at=2`); its key is the same text, so a change of it is a change of screen body. */
const routes: Route[] = [{ path: '/settings', load: async () => 'doc', key: (_p, q) => `${q.get('at') ?? '0'}${q.get('x') ?? ''}`, render: () => null }];
function Body() {
  const at = Number(useLocation().query.get('at') ?? 0);
  return <ScreenBody at={at} axis="y" className="mine"><button>press {at}</button></ScreenBody>;
}
function Axis() {
  const at = Number(useLocation().query.get('at') ?? 0);
  return <ScreenBody at={at} axis="x"><button>across {at}</button></ScreenBody>;
}
const links = (
  <>
    <Link to="/settings?at=2">to two</Link><Link to="/settings?at=1">to one</Link><Link to="/settings?at=1&x=1">to one again</Link><Link to="/settings?at=-1">to minus</Link>
  </>
);
const mount = (body = <Body />) => {
  const tree = (
    <>
      <Page surface="settings" menu={false}>{body}</Page>
      <Routes routes={routes} />
      {links}
    </>
  );
  return renderInWorld(tree, { path: '/settings', seed: signedIn });
};
const holder = () => document.querySelector<HTMLElement>('.kb-screen-body')!;
const bodies = () => Array.from(holder().children) as HTMLElement[];

const scrollBy = vi.fn();
beforeEach(() => {
  document.documentElement.setAttribute('data-kb-motion', 'full');
  scrollBy.mockReset();
  vi.stubGlobal('scrollBy', scrollBy);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(enter.enterScreen).mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.style.removeProperty('--kb-glass-menu-height');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a change of screen body', () => {
  test('two bodies are drawn while the exit runs, the old one inert, and the new one enters', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    expect(bodies()).toHaveLength(1);
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(bodies()).toHaveLength(2);
    const old = bodies().find((b) => b.hasAttribute('data-kb-exiting'))!;
    expect(old).toHaveAttribute('inert');
    expect(old).toHaveAttribute('aria-hidden', 'true');
    expect(old.textContent).toContain('press 0');
    const fresh = bodies().find((b) => !b.hasAttribute('data-kb-exiting'))!;
    expect(fresh.textContent).toContain('press 2');
    expect(vi.mocked(enter.enterScreen).mock.calls.some(([, el]) => el === fresh)).toBe(true);
    expect(vi.mocked(enter.enterScreen).mock.calls.some(([, el]) => el === old)).toBe(false);
  });

  test('the first draw plays no entrance of its own', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    expect(vi.mocked(enter.enterScreen).mock.calls.some(([, el]) => (el as HTMLElement).closest('.kb-screen-body'))).toBe(false);
  });

  test('the first landing, the path settling to the route\'s key, swaps no body', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await waitFor(() => expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy'));
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]!.hasAttribute('data-kb-exiting')).toBe(false);
    expect(vi.mocked(enter.enterScreen).mock.calls.some(([, el]) => (el as HTMLElement).closest('.kb-screen-body'))).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test('a mount under Strict Mode, which replays its effects, plays no entrance and no scroll', async () => {
    document.documentElement.style.setProperty('--kb-glass-menu-height', '40px');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: -50, bottom: 300, left: 0, right: 100, width: 100, height: 350, x: 0, y: -50, toJSON: () => ({}) });
    /* The strict root wraps the providers (a StrictMode inside them is not replayed, as they mount their children after a render of their own). */
    configure({ reactStrictMode: true });
    try {
      mount();
      await screen.findByRole('button', { name: 'press 0' });
      await waitFor(() => expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy'));
    } finally { configure({ reactStrictMode: false }); }
    expect(vi.mocked(enter.enterScreen).mock.calls.some(([, el]) => (el as HTMLElement).closest('.kb-screen-body'))).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test('the entrance\'s stop runs when the body changes again, and on unmount', async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(enter.enterScreen).mockImplementation(() => { const stop = vi.fn(); stops.push(stop); return stop; });
    const view = mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    const bodyCalls = () => vi.mocked(enter.enterScreen).mock.calls.filter(([, el]) => (el as HTMLElement).closest('.kb-screen-body'));
    expect(bodyCalls()).toHaveLength(1);
    const first = stops[stops.length - 1]!;
    expect(first).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: 'to one' }));
    expect(first).toHaveBeenCalledTimes(1);
    const second = stops[stops.length - 1]!;
    expect(second).not.toHaveBeenCalled();
    view.unmount();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('axis x renders and swaps in place', async () => {
    mount(<Axis />);
    await screen.findByRole('button', { name: 'across 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(bodies().some((b) => b.textContent?.includes('across 2') && !b.hasAttribute('data-kb-exiting'))).toBe(true);
    expect(bodies().find((b) => b.hasAttribute('data-kb-exiting'))?.textContent).toContain('across 0');
  });

  test('under Off there is one body at once', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    await screen.findByRole('button', { name: 'press 2' });
    expect(bodies()).toHaveLength(1);
  });

  test('focus stays on the link that was pressed', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    const link = screen.getByRole('link', { name: 'to two' });
    await userEvent.click(link);
    expect(link).toHaveFocus();
  });
});

describe('the direction', () => {
  const dir = () => holder().getAttribute('data-kb-dir');
  test('0 to 2 is +1, 2 to 1 is -1, and an equal place keeps the last direction', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(dir()).toBe('1');
    await userEvent.click(screen.getByRole('link', { name: 'to one' }));
    expect(dir()).toBe('-1');
    await userEvent.click(screen.getByRole('link', { name: 'to one again' }));
    expect(dir()).toBe('-1');
  });
  test('a move to or from a negative place (a page with no tab) keeps the direction it had', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(dir()).toBe('1');
    await userEvent.click(screen.getByRole('link', { name: 'to minus' }));
    expect(dir()).toBe('1');
    await userEvent.click(screen.getByRole('link', { name: 'to one' }));
    expect(dir()).toBe('1');
    await userEvent.click(screen.getByRole('link', { name: 'to minus' }));
    expect(dir()).toBe('1');
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(dir()).toBe('1');
    await userEvent.click(screen.getByRole('link', { name: 'to one' }));
    expect(dir()).toBe('-1');
    await userEvent.click(screen.getByRole('link', { name: 'to minus' }));
    expect(dir()).toBe('-1');
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(dir()).toBe('-1');
  });
});

describe('the scroll to the body', () => {
  const rectAt = (top: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 350, left: 0, right: 100, width: 100, height: 350, x: 0, y: top, toJSON: () => ({}) });
  beforeEach(() => { document.documentElement.style.setProperty('--kb-glass-menu-height', '40px'); });

  test('a body whose top is above the menu bar is brought under it by the difference', async () => {
    rectAt(-50);
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(scrollBy).toHaveBeenCalledWith(0, -90);
  });

  test('a top exactly at the menu bar, or below it, does not scroll', async () => {
    const spy = rectAt(40);
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(scrollBy).not.toHaveBeenCalled();
    spy.mockReturnValue({ ...spy.getMockImplementation?.()?.call(document.body) ?? {}, top: 41 } as DOMRect);
    await userEvent.click(screen.getByRole('link', { name: 'to one' }));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test('with no menu height set, a top above zero scrolls by it and a top at or below zero does not', async () => {
    document.documentElement.style.removeProperty('--kb-glass-menu-height');
    const spy = rectAt(-30);
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(scrollBy).toHaveBeenCalledWith(0, -30);
    scrollBy.mockClear();
    spy.mockReturnValue({ top: 0 } as DOMRect);
    await userEvent.click(screen.getByRole('link', { name: 'to one' }));
    expect(scrollBy).not.toHaveBeenCalled();
    spy.mockReturnValue({ top: 20 } as DOMRect);
    await userEvent.click(screen.getByRole('link', { name: 'to minus' }));
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test('the body is measured and scrolled before its entrance starts', async () => {
    rectAt(-50);
    const order: string[] = [];
    scrollBy.mockImplementation(() => { order.push('scroll'); });
    vi.mocked(enter.enterScreen).mockImplementation(() => { order.push('enter'); return () => {}; });
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    const spy = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    spy.mockClear();
    order.length = 0;
    spy.mockImplementation(function () { order.push('measure'); return { top: -50 } as DOMRect; });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(order.slice(0, 3)).toEqual(['measure', 'scroll', 'enter']);
  });

  test('a Back does not scroll', async () => {
    rectAt(-50);
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    scrollBy.mockClear();
    act(() => { window.history.pushState(null, '', '/settings?at=0'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByRole('button', { name: 'press 0' });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
