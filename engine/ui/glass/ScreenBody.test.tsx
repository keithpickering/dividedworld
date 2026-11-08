/**
 * The screen body: the part of a glass page that swaps in place (docs/plans/2026-11-08-glass-in-page-swap-design.md). The old body stays
 * over the new one while it leaves, inert; a move reads its direction from the change of `at`; a move that is not a Back brings the body's
 * top under the menu bar.
 */
import { act, screen } from '@testing-library/react';
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
const mount = () => renderInWorld(
  <>
    <Page surface="settings" menu={false}><Body /></Page>
    <Routes routes={routes} />
    <Link to="/settings?at=2">to two</Link><Link to="/settings?at=1">to one</Link><Link to="/settings?at=1&x=1">to one again</Link>
  </>,
  { path: '/settings', seed: signedIn },
);
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

  test('under Off there is one body at once', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    await screen.findByRole('button', { name: 'press 2' });
    expect(bodies()).toHaveLength(1);
  });

  test('focus stays on the button that was pressed', async () => {
    const view = renderInWorld(
      <>
        <Page surface="settings" menu={false}><Body /></Page>
        <Routes routes={routes} />
        <Link to="/settings?at=2">to two</Link>
      </>,
      { path: '/settings', seed: signedIn },
    );
    void view;
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
});

describe('the scroll to the body', () => {
  beforeEach(() => {
    document.documentElement.style.setProperty('--kb-glass-menu-height', '40px');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: -50, bottom: 300, left: 0, right: 100, width: 100, height: 350, x: 0, y: -50, toJSON: () => ({}) });
  });

  test('a body whose top is above the menu bar is brought under it by the difference', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    expect(scrollBy).toHaveBeenCalledWith(0, -90);
  });

  test('a Back does not scroll', async () => {
    mount();
    await screen.findByRole('button', { name: 'press 0' });
    await userEvent.click(screen.getByRole('link', { name: 'to two' }));
    scrollBy.mockClear();
    act(() => { window.history.pushState(null, '', '/settings?at=0'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByRole('button', { name: 'press 0' });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
