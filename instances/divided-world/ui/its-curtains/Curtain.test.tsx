/**
 * The curtain itself (docs/plans/2026-11-23-its-curtains-plan.md, Task 6; the owner's approved bench, 2026-11-25): its button and label, the press that opens
 * it and the presses that do not (a drag, a scroll, a selection), reduced motion, the drumroll's rules (a moved mouse, or the reader's line on a touch
 * screen), and the three sounds of an opening, in order. `useSound` is faked so a test sees what plays and what loops; jsdom has no layout, so a test that
 * needs the curtain on the line gives it a box there.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { __stopConfetti } from './confetti.ts';
import { swagArt } from './drawing.ts';
import { Curtain, __resetPointer, type CurtainProps } from './Curtain.tsx';
import { TUNING } from './tuning.ts';

const hub = vi.hoisted(() => ({
  handle: { setGain: vi.fn(), stop: vi.fn() },
  play: vi.fn(async (_key: string, _opts?: unknown) => null),
  loop: vi.fn(),
}));
vi.mock('./drawing.ts', async (original) => {
  const actual = await original<typeof import('./drawing.ts')>();
  return { ...actual, swagArt: vi.fn(actual.swagArt) };
});
vi.mock('../../../../engine/ui/audio/sound.ts', async (original) => {
  const actual = await original<typeof import('../../../../engine/ui/audio/sound.ts')>();
  return { ...actual, useSound: () => ({ play: hub.play, loop: hub.loop, caption: vi.fn() }) };
});

const label = (name = 'Open the curtain') => screen.getByRole('button', { name });
const mount = (over: Partial<CurtainProps> = {}, world: Parameters<typeof renderInWorld>[1] = {}) => {
  const onOpened = vi.fn();
  const view = renderInWorld(<Curtain fabric="red" seed="play-1" n={1} total={1} onOpened={onOpened} {...over} />, world);
  return { onOpened, ...view };
};
const reduce = () => document.documentElement.setAttribute('data-kb-motion', 'reduce');
const BOX = (top: number, bottom: number) => ({ x: 0, y: top, left: 0, top, right: 400, bottom, width: 400, height: bottom - top, toJSON: () => ({}) });
const canvases = () => document.querySelectorAll('canvas');
/** A frame queue the test flushes: `requestAnimationFrame` asks for nothing until it is. */
function frames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 0;
  const raf = vi.fn((cb: FrameRequestCallback) => { queue.set(++next, cb); return next; });
  const caf = vi.fn((id: number) => { queue.delete(id); });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  return { raf, caf, pending: () => queue.size, flush: () => { const run = [...queue.values()]; queue.clear(); for (const cb of run) cb(performance.now()); } };
}
const touchPage = () => { window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as never; };
const sizeBoxes = (w: number, h: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => w, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => h, configurable: true });
};
const scrollListeners = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => c[0] === 'scroll' || c[0] === 'resize');

beforeEach(() => {
  vi.mocked(swagArt).mockClear();
  hub.loop.mockReset().mockImplementation(() => hub.handle);
  hub.play.mockClear();
  hub.handle.setGain.mockClear();
  hub.handle.stop.mockClear();
  __resetPointer();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillRect() {}, fillStyle: '' })) as never;
});
afterEach(() => {
  cleanup();
  __stopConfetti();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  window.getSelection()?.removeAllRanges();
  document.getElementById('elsewhere')?.remove();
  document.documentElement.removeAttribute('data-kb-motion');
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const selectElsewhere = (): void => {
  const p = document.getElementById('elsewhere') ?? document.body.appendChild(Object.assign(document.createElement('p'), { id: 'elsewhere', textContent: 'Words the reader marked' }));
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.selectAllChildren(p);
};

describe('the button', () => {
  test('is one button labeled "Open the curtain", with the engine\'s over-ink mark', () => {
    mount();
    expect(label()).toHaveAttribute('data-kb-over-ink');
  });

  test('says which of a stack it is, counting from the outermost', () => {
    mount({ n: 2, total: 3 });
    expect(label('Open the curtain, 2 of 3')).toBeInTheDocument();
  });

  test('draws the curtain under it, in its fabric, when there is one', () => {
    const { container } = mount({ fabric: 'red', under: 'royal-blue' });
    expect(container.querySelector('[data-dw-under][data-dw-fabric="royal-blue"]')).not.toBeNull();
    expect(container.querySelector('button[data-dw-fabric="red"]')).not.toBeNull();
  });
});

describe('opening', () => {
  test('a click opens it after the halves are out, never before', () => {
    vi.useFakeTimers();
    const { onOpened } = mount();
    fireEvent.click(label(), { detail: 1 });
    act(() => { vi.advanceTimersByTime(TUNING.openMs - 1); });
    expect(onOpened).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(TUNING.settleMs + 1); });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('a second press while it opens opens nothing more', () => {
    vi.useFakeTimers();
    const { onOpened } = mount();
    fireEvent.click(label(), { detail: 1 });
    fireEvent.click(label(), { detail: 1 });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('Enter opens it', async () => {
    reduce();
    const user = userEvent.setup();
    const { onOpened } = mount();
    await user.tab();
    expect(label()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('Space opens it', async () => {
    reduce();
    const user = userEvent.setup();
    const { onOpened } = mount();
    await user.tab();
    await user.keyboard(' ');
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('a click that ends a 12 px drag opens nothing, and one that moved 3 px does', () => {
    reduce();
    const { onOpened } = mount();
    fireEvent.pointerDown(label(), { clientX: 0, clientY: 0, pointerType: 'mouse' });
    fireEvent.click(label(), { clientX: 12, clientY: 0, detail: 1 });
    expect(onOpened).not.toHaveBeenCalled();
    fireEvent.pointerDown(label(), { clientX: 0, clientY: 0, pointerType: 'mouse' });
    fireEvent.click(label(), { clientX: 3, clientY: 0, detail: 1 });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('a click after the page scrolled since the press went down opens nothing (a tap that only stopped a fling)', () => {
    reduce();
    const { onOpened } = mount();
    fireEvent.pointerDown(label(), { clientX: 0, clientY: 0, pointerType: 'touch' });
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true });
    fireEvent.click(label(), { clientX: 0, clientY: 0, detail: 1 });
    expect(onOpened).not.toHaveBeenCalled();
  });

  test('a click that ends a text selection opens nothing', () => {
    reduce();
    const { onOpened } = mount();
    fireEvent.pointerDown(label(), { clientX: 0, clientY: 0, pointerType: 'mouse' });
    selectElsewhere();
    fireEvent.click(label(), { detail: 1 });
    expect(onOpened).not.toHaveBeenCalled();
  });

  test('a selection the reader already had elsewhere on the page does not swallow the press', () => {
    reduce();
    const { onOpened } = mount();
    selectElsewhere();
    fireEvent.pointerDown(label(), { clientX: 0, clientY: 0, pointerType: 'mouse' });
    fireEvent.click(label(), { detail: 1 });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('a keyboard press opens it though the page has a selection', () => {
    reduce();
    const { onOpened } = mount();
    selectElsewhere();
    fireEvent.click(label(), { detail: 0 });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  test('under reduced motion it opens at once, with no confetti canvas, and still plays all three sounds in order', () => {
    reduce();
    const { onOpened } = mount();
    fireEvent.click(label(), { detail: 1 });
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(canvases()).toHaveLength(0);
    expect(hub.play.mock.calls.map((c) => c[0])).toEqual(['its-curtains.crash', 'its-curtains.whoosh', 'its-curtains.tada']);
  });
});

describe('the sounds', () => {
  const GROUP = { group: 'its-curtains', voices: 3 };

  test('crash at once, whoosh as the halves start, tada before they are fully out, and the confetti thrown at 40% of the open', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.click(label(), { detail: 1 });
    expect(hub.play.mock.calls).toEqual([['its-curtains.crash', GROUP]]);
    act(() => { vi.advanceTimersByTime(TUNING.whooshAfterMs); });
    expect(hub.play.mock.calls.map((c) => c[0])).toEqual(['its-curtains.crash', 'its-curtains.whoosh']);
    expect(canvases()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(Math.round((TUNING.openMs * TUNING.confetti.startPercent) / 100)); });
    expect(canvases()).toHaveLength(1);
    expect(hub.play).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(TUNING.openMs - TUNING.tadaBeforeEndMs - Math.round((TUNING.openMs * TUNING.confetti.startPercent) / 100)); });
    expect(hub.play.mock.calls).toEqual([['its-curtains.crash', GROUP], ['its-curtains.whoosh', GROUP], ['its-curtains.tada', GROUP]]);
  });

  test('the drumroll stops when it opens', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.pointerEnter(label(), { clientX: 5, clientY: 5, pointerType: 'mouse' });
    fireEvent.pointerMove(label(), { clientX: 6, clientY: 6, pointerType: 'mouse' });
    expect(hub.loop).toHaveBeenCalledTimes(1);
    fireEvent.click(label(), { detail: 1 });
    expect(hub.handle.stop).toHaveBeenCalledWith(TUNING.drumFadeOnOpenMs);
  });
});

describe('the drumroll', () => {
  test('with a mouse it starts on a moved pointer, not on an enter at the last-known position, and fades out on leave', () => {
    mount({ seed: 'play-9' });
    fireEvent.pointerEnter(label(), { clientX: 5, clientY: 5, pointerType: 'mouse' });
    expect(hub.loop).not.toHaveBeenCalled();
    fireEvent.pointerMove(label(), { clientX: 5, clientY: 5, pointerType: 'mouse' });
    expect(hub.loop).not.toHaveBeenCalled();
    fireEvent.pointerMove(label(), { clientX: 8, clientY: 5, pointerType: 'mouse' });
    expect(hub.loop).toHaveBeenCalledTimes(1);
    expect(hub.loop).toHaveBeenCalledWith('its-curtains.drumroll', { group: 'its-curtains', id: 'play-9' });
    expect(hub.handle.setGain).toHaveBeenCalledWith(1);
    fireEvent.pointerLeave(label(), { pointerType: 'mouse' });
    expect(hub.handle.stop).toHaveBeenCalledWith(TUNING.drumFadeMs);
  });

  test('a finger moving over it is no mouse, and starts nothing', () => {
    mount();
    fireEvent.pointerEnter(label(), { clientX: 5, clientY: 5, pointerType: 'touch' });
    fireEvent.pointerMove(label(), { clientX: 8, clientY: 5, pointerType: 'touch' });
    expect(hub.loop).not.toHaveBeenCalled();
  });

  test('on a touch-only page it plays while the curtain crosses the reader\'s line, and stops when it leaves', () => {
    touchPage();
    const f = frames();
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    let rect = BOX(100, 500);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect);
    mount();
    /* the line is half way down the 800 px window, 400 px, and the curtain is across it */
    expect(hub.loop).toHaveBeenCalledTimes(1);
    expect(hub.handle.setGain).toHaveBeenCalledWith(1);
    rect = BOX(450, 900);
    act(() => { window.dispatchEvent(new Event('scroll')); f.flush(); });
    expect(hub.handle.stop).toHaveBeenCalledWith(TUNING.drumFadeMs);
    rect = BOX(100, 500);
    act(() => { window.dispatchEvent(new Event('scroll')); f.flush(); });
    expect(hub.loop).toHaveBeenCalledTimes(2);
  });

  test('the line is the instance\'s Laugh Track line where it sets one', () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => BOX(100, 300) as DOMRect);
    mount({}, { settings: { cardSettings: { 'laughTrack.line': 30 } } });
    /* 30% of 800 is 240: inside 100 to 300 */
    expect(hub.loop).toHaveBeenCalledTimes(1);
  });

  test('a mouse page does not read the line: a desktop curtain across the line plays nothing until the mouse moves', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => BOX(100, 500) as DOMRect);
    mount();
    expect(hub.loop).not.toHaveBeenCalled();
  });

  test('it stops when the curtain goes', () => {
    const { unmount } = mount();
    fireEvent.pointerMove(label(), { clientX: 1, clientY: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(label(), { clientX: 2, clientY: 1, pointerType: 'mouse' });
    expect(hub.loop).toHaveBeenCalledTimes(1);
    unmount();
    expect(hub.handle.stop).toHaveBeenCalled();
  });
});

describe('forced colors and the focus ring', () => {
  test('the button is the drawn panel, with the label in it for a reader the pictures do not reach', () => {
    mount({ n: 1, total: 2 });
    expect(label('Open the curtain, 1 of 2').querySelector('.dw-curtain-label')).toHaveTextContent('Open the curtain, 1 of 2');
  });
});

describe('the page\'s one scroll listener', () => {
  test('a mouse page adds none, however many curtains', () => {
    const add = vi.spyOn(window, 'addEventListener');
    for (let i = 0; i < 4; i++) mount();
    expect(scrollListeners(add)).toEqual([]);
  });

  test('a touch page has one scroll and one resize listener for all its curtains, coalesced to one frame, and none once they are gone', () => {
    touchPage();
    const f = frames();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const all = Array.from({ length: 6 }, () => mount({ seed: 'p' }));
    expect(scrollListeners(add).map((c) => c[0])).toEqual(['scroll', 'resize']);
    expect(scrollListeners(add).every((c) => (c[2] as AddEventListenerOptions).passive === true)).toBe(true);
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    act(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('scroll')); });
    expect(f.pending()).toBe(1);
    rects.mockClear();
    act(() => { f.flush(); });
    expect(rects).toHaveBeenCalledTimes(6);
    for (const m of all) m.unmount();
    expect(scrollListeners(remove).map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
  });

  test('a mouse that has moved ends a touch curtain\'s claim on it', () => {
    touchPage();
    const f = frames();
    const remove = vi.spyOn(window, 'removeEventListener');
    mount();
    act(() => { document.dispatchEvent(new PointerEvent('pointermove', { clientX: 4, clientY: 4, pointerType: 'mouse' } as PointerEventInit)); });
    expect(scrollListeners(remove)).toEqual([]);
    act(() => { window.dispatchEvent(new Event('scroll')); f.flush(); });
    expect(scrollListeners(remove).map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
  });
});

describe('a cover taller than the window', () => {
  let observed: { cb: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[];
  const spotMove = () => document.querySelector<HTMLElement>('.dw-curtain-spot')!.style.transform;
  beforeEach(() => {
    observed = [];
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn();
      constructor(public cb: IntersectionObserverCallback) { observed.push(this); }
      observe() {}
      unobserve() {}
    });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });
  const see = (i: boolean) => act(() => { observed.at(-1)!.cb([{ isIntersecting: i } as IntersectionObserverEntry], {} as IntersectionObserver); });

  test('keeps its resting spotlights on the visible part as the page scrolls, only while it is in view', () => {
    const f = frames();
    sizeBoxes(400, 3000);
    let rect = BOX(0, 3000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect);
    const add = vi.spyOn(window, 'addEventListener');
    mount();
    expect(scrollListeners(add)).toEqual([]);
    see(true);
    expect(scrollListeners(add).map((c) => c[0])).toEqual(['scroll', 'resize']);
    const first = spotMove();
    rect = BOX(-2000, 1000);
    act(() => { window.dispatchEvent(new Event('scroll')); f.flush(); });
    const second = spotMove();
    expect(second).not.toBe(first);
    see(false);
    rect = BOX(-500, 2500);
    act(() => { window.dispatchEvent(new Event('scroll')); f.flush(); });
    expect(spotMove()).toBe(second);
  });

  test('draws once as it comes into view, and a short cover is not watched at all', () => {
    sizeBoxes(400, 3000);
    let rect = BOX(0, 3000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect);
    mount();
    const before = spotMove();
    rect = BOX(-2000, 1000);
    see(true);
    expect(spotMove()).not.toBe(before);
    cleanup();
    observed.length = 0;
    sizeBoxes(400, 300);
    mount();
    expect(observed).toHaveLength(0);
  });
});

describe('reduced motion', () => {
  test('runs no spotlight frame loop: the spots are drawn once on a hot change', () => {
    reduce();
    const f = frames();
    mount();
    const spot = document.querySelector<HTMLElement>('.dw-curtain-spot')!;
    const dim = spot.style.getPropertyValue('--dw-spot-a');
    fireEvent.pointerMove(label(), { clientX: 1, clientY: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(label(), { clientX: 9, clientY: 1, pointerType: 'mouse' });
    expect(hub.loop).toHaveBeenCalledTimes(1);
    expect(f.raf).not.toHaveBeenCalled();
    expect(spot.style.getPropertyValue('--dw-spot-a')).not.toBe(dim);
    fireEvent.pointerLeave(label(), { pointerType: 'mouse' });
    expect(spot.style.getPropertyValue('--dw-spot-a')).toBe(dim);
  });
});

describe('the swags', () => {
  test('are worked out once per curtain, though the one under it is drawn too', () => {
    sizeBoxes(400, 300);
    mount({ under: 'gold' });
    expect(swagArt).toHaveBeenCalledTimes(1);
  });
});

describe('a cover that unmounts mid-open', () => {
  test('calls nothing back, throws no confetti, plays no sound, and leaves no frame or drumroll running', () => {
    vi.useFakeTimers();
    const f = frames();
    const { onOpened, unmount } = mount();
    fireEvent.pointerMove(label(), { clientX: 1, clientY: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(label(), { clientX: 9, clientY: 1, pointerType: 'mouse' });
    fireEvent.click(label(), { detail: 1 });
    act(() => { vi.advanceTimersByTime(TUNING.whooshAfterMs + 1); });
    const played = hub.play.mock.calls.length;
    unmount();
    expect(hub.handle.stop).toHaveBeenCalled();
    expect(f.caf).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(TUNING.openMs + TUNING.settleMs + 5000); f.flush(); });
    expect(onOpened).not.toHaveBeenCalled();
    expect(canvases()).toHaveLength(0);
    expect(hub.play).toHaveBeenCalledTimes(played);
    expect(f.pending()).toBe(0);
  });
});

describe('a stack', () => {
  function Stack() {
    const [i, setI] = useState(1);
    return <Curtain key={i} fabric="red" seed={`p${i}`} n={i} total={3} onOpened={() => setI((x) => x + 1)} />;
  }

  test('hands the keyboard\'s focus on to the next curtain when one opens', async () => {
    reduce();
    const user = userEvent.setup();
    renderInWorld(<Stack />);
    await user.tab();
    await user.keyboard('{Enter}');
    const next = label('Open the curtain, 2 of 3');
    expect(next).toHaveFocus();
  });

  test('hands nothing on when the focus was somewhere else', () => {
    reduce();
    renderInWorld(<Stack />);
    fireEvent.click(label('Open the curtain, 1 of 3'), { detail: 1 });
    expect(label('Open the curtain, 2 of 3')).not.toHaveFocus();
  });
});
