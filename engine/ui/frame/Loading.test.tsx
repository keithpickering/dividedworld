import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ratio, tokensOf } from '../contrast.ts';
import type { Location, Navigation } from '../router.tsx';
import { Loading, shortenPath } from './Loading.tsx';

/* The router's two signals the meter reads, held here so a test moves them. */
const nav: { value: Navigation } = { value: { pending: null, tracking: 0, outcome: null, track: (p) => p } };
const place: { value: Location } = { value: { path: '/', query: new URLSearchParams(), hash: '', popped: false, state: null } };
vi.mock('../router.tsx', async (orig) => ({
  ...(await orig<typeof import('../router.tsx')>()),
  useNavigation: () => nav.value,
  useLocation: () => place.value,
}));

const THREAD = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const pending = (to: string): Navigation => ({ pending: { to, startedAt: 0 }, tracking: 0, outcome: null, track: (p) => p });
const ended = (kind: 'landed' | 'cancelled' | 'failed', seq = 1): Navigation => ({ pending: null, tracking: 0, outcome: { seq, kind }, track: (p) => p });
const idle: Navigation = ended('landed');
const where = (path: string): Location => ({ path, query: new URLSearchParams(), hash: '', popped: false, state: null });

const bar = () => screen.getByRole('progressbar', { name: 'Loading the page' });
const now = () => Number(bar().getAttribute('aria-valuenow'));
const view = () => render(<Loading host="dw.gripe" />);
const move = (r: ReturnType<typeof view>, navigation: Navigation, path = place.value.path) => {
  nav.value = navigation;
  place.value = where(path);
  r.rerender(<Loading host="dw.gripe" />);
};
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); nav.value = idle; place.value = where('/'); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the meter', () => {
  test('at rest it shows the host, an empty bar, and says nothing', () => {
    view();
    expect(screen.getByText('dw.gripe')).toBeTruthy();
    expect(now()).toBe(0);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  test('pending shows Opening with the host and the path, a UUID cut to eight characters', () => {
    const r = view();
    move(r, pending(`/t/${THREAD}?page=2#p5`));
    expect(screen.getByText('Opening dw.gripe/t/3f2a9c1e…')).toBeTruthy();
  });

  test('shortenPath cuts only UUID segments and drops the query and the fragment', () => {
    expect(shortenPath(`/t/${THREAD}?x=1#y`)).toBe('/t/3f2a9c1e…');
    expect(shortenPath('/b/general')).toBe('/b/general');
    expect(shortenPath('/')).toBe('/');
  });

  test('the value rises toward 90 and never past it while pending', () => {
    const r = view();
    move(r, pending('/b/general'));
    const seen: number[] = [now()];
    for (let i = 0; i < 200; i++) { tick(120); seen.push(now()); }
    expect(seen[1]).toBeGreaterThan(0);
    expect(seen[1]).toBeCloseTo(15, -1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(Math.max(...seen)).toBeLessThanOrEqual(90);
    expect(seen.at(-1)).toBeGreaterThan(85);
  });

  test('landing sets 100, then 0 after 250 ms, and the status says Page loaded', () => {
    const r = view();
    move(r, pending('/b/general'));
    tick(600);
    move(r, idle, '/b/general');
    expect(now()).toBe(100);
    expect(screen.getByRole('status').textContent).toBe('Page loaded');
    tick(249);
    expect(now()).toBe(100);
    tick(1);
    expect(now()).toBe(0);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByText('dw.gripe')).toBeTruthy();
  });

  test('a swap answered at once flashes full and never shows a value between 1 and 99', () => {
    const r = view();
    const values: number[] = [now()];
    move(r, idle, '/b/general');
    values.push(now());
    for (let i = 0; i < 10; i++) { tick(50); values.push(now()); }
    expect(values).toContain(100);
    expect(values.filter((v) => v > 0 && v < 100)).toEqual([]);
    expect(values.at(-1)).toBe(0);
    expect(screen.queryByText(/Opening/)).toBeNull();
  });

  test('a load stopped by Escape leaves 0 and says nothing', () => {
    const r = view();
    move(r, pending('/b/general'));
    tick(600);
    expect(now()).toBeGreaterThan(0);
    move(r, ended('cancelled'));
    expect(now()).toBe(0);
    expect(screen.getByRole('status').textContent).toBe('');
    tick(300);
    expect(now()).toBe(0);
  });

  test('a tracked read that rejects does not say Page loaded', () => {
    const r = view();
    move(r, { pending: null, tracking: 1, outcome: null, track: (p) => p });
    tick(300);
    move(r, ended('failed'));
    expect(now()).toBe(0);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  test('a page that lands as the cannot-be-displayed page does not say Page loaded', () => {
    const r = view();
    move(r, pending('/b/general'));
    tick(300);
    move(r, ended('failed'), '/b/general');
    expect(now()).toBe(0);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  test('a landing says Page loaded once, not twice', () => {
    const r = view();
    move(r, pending('/b/general'));
    tick(300);
    move(r, ended('landed', 2), '/b/general');
    tick(200);
    expect(now()).toBe(100);
    tick(50);
    expect(now()).toBe(0);
  });

  test('a tracked read runs the meter without the Opening text', () => {
    const r = view();
    move(r, { pending: null, tracking: 1, outcome: null, track: (p) => p });
    tick(240);
    expect(now()).toBeGreaterThan(0);
    expect(screen.queryByText(/Opening/)).toBeNull();
    move(r, idle);
    expect(now()).toBe(100);
  });

  test('the fill has no transition when motion is reduced', () => {
    const css = readFileSync(join(process.cwd(), 'engine/ui/frame/frame.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.kb-meter-fill[\s\S]*?transition: none/);
    expect(css).toMatch(/data-kb-motion="reduce"[^{]*\.kb-meter-fill[^{]*\{[^}]*transition: none/);
  });
});

describe('the meter\'s colors', () => {
  const sheet = readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8');
  test.each(Object.entries(tokensOf(sheet)))('%s: the fill reads against the face, and the well against the board', (_mode, t) => {
    expect(ratio(t['--kb-meter-fill']!, t['--kb-meter-face']!)).toBeGreaterThanOrEqual(3);
    expect(ratio(t['--kb-meter-lo']!, t['--kb-bg']!)).toBeGreaterThanOrEqual(3);
  });
});
