/**
 * The glass tooltip (Tooltip.tsx): shown with its text and named by the anchor's `aria-describedby`; closed by itself after
 * TOOLTIP_MS, on the anchor's blur and on a page Esc (not one typed in a field); restarted by a changed `restart`; kept
 * inside the window's 16px gutters; spoken once into a polite status; focusable by nothing.
 */
import { act, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { testGlass } from '../test-world.tsx';
import { Tooltip, TOOLTIP_MS } from './Tooltip.tsx';

const kayfa = { api: {}, instance: {}, ui: { glass: testGlass }, settings: {} } as unknown as Kayfa;
const rect = (r: { top: number; left: number; right: number; bottom: number }) => () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;

let closed: Mock<() => void>;
function Harness({ restart, rectOf }: { restart?: number; rectOf?: { top: number; left: number; right: number; bottom: number } }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <KayfaProvider value={kayfa}>
      <button ref={(el) => { ref.current = el; if (el && rectOf) el.getBoundingClientRect = rect(rectOf); }} type="button" aria-describedby="prior">Anchor</button>
      <input aria-label="Field" />
      <Tooltip anchor={ref} open={open} restart={restart} onClose={() => { closed(); setOpen(false); }}>Reactions can&apos;t be taken back.</Tooltip>
      <button type="button" onClick={() => setOpen(true)}>Again</button>
    </KayfaProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  closed = vi.fn<() => void>();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-kb-motion');
  vi.restoreAllMocks();
  delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
});

describe('the tooltip', () => {
  test('open shows its text and names itself on the anchor, keeping the anchor\'s earlier description', () => {
    render(<Harness />);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Reactions can\'t be taken back.');
    const described = screen.getByRole('button', { name: 'Anchor' }).getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toContain(tip.id);
    expect(described.split(' ')).toContain('prior');
  });

  test('its text is also said once in a polite status, and the ⓘ is hidden from readers', () => {
    render(<Harness />);
    act(() => { vi.advanceTimersByTime(60); });
    expect(screen.getByRole('status').textContent).toBe('Reactions can\'t be taken back.');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('tooltip').querySelector('[aria-hidden="true"]')?.textContent).toBe('ⓘ');
  });

  test('a restart empties the status and fills it again, so a second press is heard', () => {
    const { rerender } = render(<Harness restart={0} />);
    act(() => { vi.advanceTimersByTime(60); });
    const status = screen.getByRole('status');
    expect(status.textContent).not.toBe('');
    rerender(<Harness restart={1} />);
    expect(status.textContent).toBe('');
    act(() => { vi.advanceTimersByTime(60); });
    expect(status.textContent).toBe('Reactions can\'t be taken back.');
  });

  test('an anchor with no prior description has none again after it closes', () => {
    function Bare() {
      const ref = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return <KayfaProvider value={kayfa}><button ref={ref} type="button">Bare</button><Tooltip anchor={ref} open={open} onClose={() => setOpen(false)}>Hi</Tooltip></KayfaProvider>;
    }
    render(<Bare />);
    expect(screen.getByRole('button', { name: 'Bare' }).getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    act(() => { vi.advanceTimersByTime(TOOLTIP_MS); });
    expect(screen.getByRole('button', { name: 'Bare' }).hasAttribute('aria-describedby')).toBe(false);
  });

  test('the width cap is on before the box is measured, and a scroll places it again', async () => {
    let capWhenMeasured = '';
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { if (this.getAttribute('role') === 'tooltip') capWhenMeasured = this.style.maxWidth; return 200; });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0) as unknown as number);
    let top = 300;
    render(<Harness rectOf={{ top, left: 400, right: 430, bottom: top + 30 }} />);
    expect(capWhenMeasured).toBe(`${window.innerWidth - 32}px`);
    const tip = screen.getByRole('tooltip');
    const before = tip.style.top;
    const anchor = screen.getByRole('button', { name: 'Anchor' });
    top = 500;
    anchor.getBoundingClientRect = rect({ top, left: 400, right: 430, bottom: top + 30 });
    act(() => { window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(5); });
    expect(tip.style.top).not.toBe(before);
    vi.unstubAllGlobals();
  });

  test('with no anchor element it shows and says nothing', () => {
    function None() {
      const ref = useRef<HTMLButtonElement>(null);
      return <KayfaProvider value={kayfa}><Tooltip anchor={ref} open onClose={() => {}}>Hi</Tooltip></KayfaProvider>;
    }
    render(<None />);
    act(() => { vi.advanceTimersByTime(60); });
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('tooltip', { hidden: true }).hasAttribute('data-kb-place')).toBe(false);
  });

  test('it takes no focus and holds nothing pressable', () => {
    render(<Harness />);
    const tip = screen.getByRole('tooltip');
    expect(tip.querySelector('button, a, input, [tabindex]')).toBeNull();
  });

  test('it is gone after 3000ms, and the anchor\'s own description comes back', () => {
    render(<Harness />);
    act(() => { vi.advanceTimersByTime(TOOLTIP_MS - 1); });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Anchor' }).getAttribute('aria-describedby')).toBe('prior');
  });

  test('blur on the anchor closes it', () => {
    render(<Harness />);
    act(() => { screen.getByRole('button', { name: 'Anchor' }).dispatchEvent(new FocusEvent('blur')); });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('Esc closes it, but Esc typed in a field stays the field\'s', () => {
    render(<Harness />);
    act(() => { screen.getByRole('textbox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(closed).not.toHaveBeenCalled();
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test('a changed `restart` starts the 3 seconds again', () => {
    const { rerender } = render(<Harness restart={0} />);
    act(() => { vi.advanceTimersByTime(2500); });
    rerender(<Harness restart={1} />);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(closed).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test('opened again after it closed, it runs its 3 seconds anew', () => {
    render(<Harness />);
    act(() => { vi.advanceTimersByTime(TOOLTIP_MS); });
    act(() => { screen.getByRole('button', { name: 'Again' }).click(); });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(TOOLTIP_MS); });
    expect(closed).toHaveBeenCalledTimes(2);
  });

  test('it stays inside a 360px window, 16px from each edge, whatever the anchor', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 360 });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(220);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    const { unmount } = render(<Harness rectOf={{ top: 300, left: 320, right: 350, bottom: 330 }} />);
    const tip = screen.getByRole('tooltip');
    const left = parseFloat(tip.style.left);
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + 220).toBeLessThanOrEqual(360 - 16);
    /* Above its anchor where there is room. */
    expect(parseFloat(tip.style.top) + 40).toBeLessThanOrEqual(300);
    unmount();
    render(<Harness rectOf={{ top: 300, left: 0, right: 30, bottom: 330 }} />);
    expect(parseFloat(screen.getByRole('tooltip').style.left)).toBeGreaterThanOrEqual(16);
  });

  test('where above would leave the window it goes below', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    render(<Harness rectOf={{ top: 20, left: 400, right: 430, bottom: 50 }} />);
    expect(parseFloat(screen.getByRole('tooltip').style.top)).toBeGreaterThanOrEqual(50);
  });
});
