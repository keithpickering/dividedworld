/**
 * A screen's body swaps when the router's key changes within one screen (ScreenBody.tsx; docs/plans/2026-11-08-glass-in-page-swap-design.md, section 3).
 * The key is driven here through `ScreenKeyContext` directly. The direction is observed on the holder's `data-kb-dir`, which the body exposes for
 * exactly this: it is the `custom` the exit and the entrance are resolved by.
 */
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import * as enter from './enter.ts';
import { ScreenBody, ScreenKeyContext } from './ScreenBody.tsx';

vi.mock('./enter.ts', async (orig) => {
  const real = await orig<typeof import('./enter.ts')>();
  return { ...real, enterScreen: vi.fn(real.enterScreen) };
});

/* A body at a place in the order, under a key the buttons change. `popped` is a checkbox's worth of state. */
function Harness({ axis = 'y' }: { readonly axis?: 'x' | 'y' }) {
  const [k, setK] = useState({ key: 'a', at: 0, popped: false });
  const go = (key: string, at: number, popped = false) => () => setK({ key, at, popped });
  return (
    <>
      <button onClick={go('b', 2)}>to 2</button>
      <button onClick={go('c', 1)}>to 1</button>
      <button onClick={go('d', 1)}>to 1 again</button>
      <button onClick={go('e', 3, true)}>pop to 3</button>
      <ScreenKeyContext.Provider value={{ key: k.key, popped: k.popped }}>
        <ScreenBody at={k.at} axis={axis} className="mine" data-testid="holder"><p data-body={k.key}>body {k.key}</p></ScreenBody>
      </ScreenKeyContext.Provider>
    </>
  );
}

const holder = () => screen.getByTestId('holder');
const press = (name: string) => act(() => { screen.getByRole('button', { name }).click(); });
const setMenu = (v: string | null) => {
  if (v === null) document.documentElement.style.removeProperty('--kb-glass-menu-height');
  else document.documentElement.style.setProperty('--kb-glass-menu-height', v);
};
/* The holder's top is `top`; the arriving body sits 40px lower, as its motion's starting offset would put it, so a measure of the body is caught. */
const topOf = (top: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
  const t = this.matches('.kb-screen-body') ? top : this.matches('.kb-screen-body > :not([data-kb-exiting])') ? top + 40 : 0;
  return { top: t, bottom: t + 10, left: 0, right: 0, width: 0, height: 10, x: 0, y: t, toJSON: () => ({}) };
});
const scrollBy = vi.fn();

beforeEach(() => {
  document.documentElement.setAttribute('data-kb-motion', 'full');
  scrollBy.mockReset();
  vi.stubGlobal('scrollBy', scrollBy);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setMenu(null);
  document.documentElement.removeAttribute('data-kb-motion');
});

describe('a screen body\'s swap', () => {
  test('on a key change two bodies stand while the exit runs, the old one inert, and then only the new one', async () => {
    renderInWorld(<Harness />, { path: '/characters' });
    const first = screen.getByText('body a');
    press('to 2');
    expect(first.isConnected).toBe(true);
    expect(first.closest('[data-kb-exiting]')).toHaveAttribute('inert');
    expect(first.closest('[data-kb-exiting]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('body b').closest('[data-kb-exiting]')).toBeNull();
    expect(holder()).toHaveClass('kb-screen-body', 'mine');
    await waitFor(() => expect(first.isConnected).toBe(false), { timeout: 3000 });
  });
  test('under Off the body is replaced at once, with no entrance', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    renderInWorld(<Harness />, { path: '/characters' });
    const first = screen.getByText('body a');
    press('to 2');
    expect(first.isConnected).toBe(false);
    expect(document.querySelector('[data-kb-exiting]')).toBeNull();
    expect(screen.getByText('body b')).toBeInTheDocument();
    /* Called with a null feel, which plays nothing. */
    expect(vi.mocked(enter.enterScreen).mock.calls.at(-1)?.[0]).toBeNull();
  });
  test('the entrance runs on the body arriving only, and not on mount', () => {
    vi.mocked(enter.enterScreen).mockClear();
    renderInWorld(<Harness />, { path: '/characters' });
    expect(enter.enterScreen).not.toHaveBeenCalled();
    press('to 2');
    expect(enter.enterScreen).toHaveBeenCalledTimes(1);
    const el = vi.mocked(enter.enterScreen).mock.calls[0]![1];
    expect(el).toContainElement(screen.getByText('body b'));
    expect(el).not.toHaveAttribute('data-kb-exiting');
  });
});

describe('the direction of a swap', () => {
  test('is +1 moving to a later place, -1 to an earlier one, and an equal place keeps the last', () => {
    renderInWorld(<Harness />, { path: '/characters' });
    expect(holder()).toHaveAttribute('data-kb-dir', '1');
    press('to 2');
    expect(holder()).toHaveAttribute('data-kb-dir', '1');
    press('to 1');
    expect(holder()).toHaveAttribute('data-kb-dir', '-1');
    press('to 1 again');
    expect(holder()).toHaveAttribute('data-kb-dir', '-1');
  });
  test('works the same on the x axis', () => {
    renderInWorld(<Harness axis="x" />, { path: '/characters' });
    press('to 2');
    press('to 1');
    expect(holder()).toHaveAttribute('data-kb-dir', '-1');
  });
});

describe('focus', () => {
  test('stays on the button that was pressed', async () => {
    renderInWorld(<Harness />, { path: '/characters' });
    const b = screen.getByRole('button', { name: 'to 2' });
    await userEvent.click(b);
    expect(document.activeElement).toBe(b);
  });
});

describe('the scroll after a swap', () => {
  test('a body whose top is above the menu bar is brought to just under it', () => {
    setMenu('60px');
    topOf(-100);
    renderInWorld(<Harness />, { path: '/characters' });
    press('to 2');
    expect(scrollBy).toHaveBeenCalledWith(0, -160);
  });
  test('a body whose top is in view is not scrolled to', () => {
    setMenu('60px');
    topOf(80);
    renderInWorld(<Harness />, { path: '/characters' });
    press('to 2');
    expect(scrollBy).not.toHaveBeenCalled();
  });
  test('with no menu height the top of the window is the line', () => {
    topOf(-30);
    renderInWorld(<Harness />, { path: '/characters' });
    press('to 2');
    expect(scrollBy).toHaveBeenCalledWith(0, -30);
  });
  test('back and forward keep their own scroll', () => {
    setMenu('60px');
    topOf(-100);
    renderInWorld(<Harness />, { path: '/characters' });
    press('pop to 3');
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
