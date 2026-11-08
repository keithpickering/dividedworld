/**
 * inView.ts's lifecycle (docs/plans/2026-11-02-onboarding-design.md, section 6): one observer for every watched post, made with the
 * first and dropped with the last; a post that unmounts is unobserved; where there is no IntersectionObserver a post counts as in view.
 */
import { StrictMode, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useInView, watchInView } from './inView.ts';

type Fake = { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; seen: Set<Element>; disconnected: boolean };
let made: Fake[] = [];
class FakeObserver {
  readonly entry: Fake = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>(), disconnected: false };
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.entry.cb = cb; this.entry.opts = opts; made.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); this.entry.disconnected = true; }
  takeRecords() { return []; }
}
const live = () => made.filter((o) => !o.disconnected);

function Probe({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  return <div ref={ref} data-testid={id} data-in-view={String(inView)} />;
}

beforeEach(() => { made = []; vi.stubGlobal('IntersectionObserver', FakeObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('inView', () => {
  test('the observer is disconnected and dropped when the last watched element unmounts, and a new one is made afterwards', () => {
    const a = render(<Probe id="a" />);
    const b = render(<Probe id="b" />);
    expect(made).toHaveLength(1);
    a.unmount();
    expect(live()).toHaveLength(1);
    b.unmount();
    expect(made[0]!.disconnected).toBe(true);
    expect(live()).toHaveLength(0);
    render(<Probe id="c" />);
    expect(made).toHaveLength(2);
    expect(live()).toHaveLength(1);
  });

  test('a StrictMode double mount leaves exactly one live observer, watching the one element', () => {
    render(<StrictMode><Probe id="a" /></StrictMode>);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.seen.size).toBe(1);
  });

  test('an element unmounted mid-flight is unobserved, and a late report for it is ignored', () => {
    const a = render(<Probe id="a" />);
    render(<Probe id="b" />);
    const el = a.getByTestId('a');
    const seen = made[0]!;
    a.unmount();
    expect(seen.seen.has(el)).toBe(false);
    expect(() => act(() => { seen.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); })).not.toThrow();
    expect(live()).toHaveLength(1);
  });

  test('without IntersectionObserver an element reports in view, and nothing is made', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const calls: boolean[] = [];
    const stop = watchInView(document.createElement('div'), (v) => calls.push(v));
    expect(calls).toEqual([true]);
    stop();
    const r = render(<Probe id="a" />);
    expect(r.getByTestId('a')).toHaveAttribute('data-in-view', 'true');
    expect(made).toHaveLength(0);
  });

  test('a server render, with no IntersectionObserver, is the still state, and the client then becomes in view', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(renderToString(<Probe id="a" />)).toContain('data-in-view="false"');
    const r = render(<Probe id="a" />);
    expect(r.getByTestId('a')).toHaveAttribute('data-in-view', 'true');
  });

  test('a margin has its own observer, handed the margin, shared by the elements that watch with it; any overlap of the shrunk view counts', () => {
    const a = document.createElement('div'), b = document.createElement('div');
    const mid: boolean[] = [];
    const stopPlain = watchInView(a, () => {});
    const stopMid = watchInView(a, (v) => mid.push(v), { rootMargin: '-20% 0px' });
    const stopMid2 = watchInView(b, () => {}, { rootMargin: '-20% 0px' });
    expect(made).toHaveLength(2);
    expect(made[1]!.opts).toEqual({ rootMargin: '-20% 0px' });
    expect(made[1]!.seen).toEqual(new Set([a, b]));
    act(() => { made[1]!.cb([{ target: a, isIntersecting: true, intersectionRatio: 0.01 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(mid).toEqual([true]);
    stopMid(); stopMid2();
    expect(made[1]!.disconnected).toBe(true);
    stopPlain();
  });

  test('a threshold has its own observer, shared by the elements that watch at it, and counts the share showing', () => {
    const a = document.createElement('div'), b = document.createElement('div');
    const plain: boolean[] = [], deep: boolean[] = [];
    const stopPlain = watchInView(a, (v) => plain.push(v));
    const stopDeep = watchInView(a, (v) => deep.push(v), { threshold: 0.4 });
    const stopDeep2 = watchInView(b, () => {}, { threshold: 0.4 });
    expect(made).toHaveLength(2);
    expect(made[1]!.opts?.threshold).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    const report = (o: Fake, ratio: number) => act(() => { o.cb([{ target: a, isIntersecting: ratio > 0, intersectionRatio: ratio } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    report(made[1]!, 0.1);
    report(made[1]!, 0.5);
    report(made[1]!, 0.2);
    expect(deep).toEqual([false, true, false]);
    report(made[0]!, 0.1);
    expect(plain).toEqual([true]);
    stopDeep(); stopDeep2();
    expect(made[1]!.disconnected).toBe(true);
    expect(made[0]!.disconnected).toBe(false);
    stopPlain();
    expect(made[0]!.disconnected).toBe(true);
  });

  test('a tall element counts as showing when its visible height fills the threshold share of the viewport, though its own ratio stays below', () => {
    const a = document.createElement('div');
    const deep: boolean[] = [];
    const stop = watchInView(a, (v) => deep.push(v), { threshold: 0.4 });
    const entry = (ratio: number, visible: number, root: number) => ({
      target: a, isIntersecting: ratio > 0, intersectionRatio: ratio, intersectionRect: { height: visible }, rootBounds: { height: root },
    }) as unknown as IntersectionObserverEntry;
    const report = (e: IntersectionObserverEntry) => act(() => { made[0]!.cb([e], {} as IntersectionObserver); });
    report(entry(0.1, 200, 800));
    report(entry(0.3, 400, 800));
    report(entry(0.3, 200, 800));
    expect(deep).toEqual([false, true, false]);
    stop();
  });

  test('without rootBounds the viewport is innerHeight', () => {
    vi.stubGlobal('innerHeight', 1000);
    const a = document.createElement('div');
    const deep: boolean[] = [];
    const stop = watchInView(a, (v) => deep.push(v), { threshold: 0.4 });
    act(() => { made[0]!.cb([{ target: a, isIntersecting: true, intersectionRatio: 0.2, intersectionRect: { height: 500 }, rootBounds: null } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(deep).toEqual([true]);
    stop();
  });
});
