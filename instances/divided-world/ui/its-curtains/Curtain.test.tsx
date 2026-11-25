/**
 * The curtain itself (docs/plans/2026-11-23-its-curtains-plan.md, Task 6; the owner's approved bench, 2026-11-25): its button and label, the press that opens
 * it and the presses that do not (a drag, a scroll, a selection), reduced motion, the drumroll's rules (a moved mouse, or the reader's line on a touch
 * screen), and the three sounds of an opening, in order. `useSound` is faked so a test sees what plays and what loops; jsdom has no layout, so a test that
 * needs the curtain on the line gives it a box there.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { __stopConfetti } from './confetti.ts';
import { Curtain, __resetPointer, type CurtainProps } from './Curtain.tsx';
import { TUNING } from './tuning.ts';

const hub = vi.hoisted(() => ({
  handle: { setGain: vi.fn(), stop: vi.fn() },
  play: vi.fn(async (_key: string, _opts?: unknown) => null),
  loop: vi.fn(),
}));
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

beforeEach(() => {
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
  document.documentElement.removeAttribute('data-kb-motion');
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  delete (window as { matchMedia?: unknown }).matchMedia;
});

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
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);
    fireEvent.click(label(), { detail: 1 });
    expect(onOpened).not.toHaveBeenCalled();
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
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    let rect = BOX(100, 500);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect);
    mount();
    /* the line is half way down the 800 px window, 400 px, and the curtain is across it */
    expect(hub.loop).toHaveBeenCalledTimes(1);
    expect(hub.handle.setGain).toHaveBeenCalledWith(1);
    rect = BOX(450, 900);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(hub.handle.stop).toHaveBeenCalledWith(TUNING.drumFadeMs);
    rect = BOX(100, 500);
    act(() => { window.dispatchEvent(new Event('scroll')); });
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
