/**
 * inView.ts's lifecycle (docs/plans/2026-11-02-onboarding-design.md, section 6): one observer for every watched post, made with the
 * first and dropped with the last; a post that unmounts is unobserved; where there is no IntersectionObserver a post counts as in view.
 */
import { StrictMode, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useInView, watchInView } from './inView.ts';

type Fake = { cb: IntersectionObserverCallback; seen: Set<Element>; disconnected: boolean };
let made: Fake[] = [];
class FakeObserver {
  readonly entry: Fake = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>(), disconnected: false };
  constructor(cb: IntersectionObserverCallback) { this.entry.cb = cb; made.push(this.entry); }
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
});
