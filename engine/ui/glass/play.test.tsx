/**
 * The hand drawer's plays (play.ts): each returns a stop; a stopped run neither clears the element nor calls `end` when its animation settles,
 * so a reopen during the exit keeps the entrance's values. `animate` is stubbed (jsdom has no WAAPI).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

interface Fake { settle: () => void; stop: ReturnType<typeof vi.fn> }
const fakes: Fake[] = [];
vi.mock('motion/react', () => ({
  animate: () => {
    let done: () => void = () => {};
    const p = new Promise<void>((r) => { done = r; });
    const fake = { settle: done, stop: vi.fn() };
    fakes.push(fake);
    return Object.assign(p, { stop: fake.stop });
  },
}));
const { playIn, playOut } = await import('./play.ts');

const el = document.createElement('div');
afterEach(() => { fakes.length = 0; el.removeAttribute('style'); });
/* A settled entrance clears on the next animation frame. */
const flush = () => new Promise((r) => setTimeout(r, 50));

describe('the drawer plays', () => {
  test('a reopen during the exit: the exit\'s completion does not clear the entrance or end the close', async () => {
    const end = vi.fn();
    const stopOut = playOut(el, { exit: { opacity: 0, transition: { duration: 1 } } } as never, end);
    stopOut();
    el.style.opacity = '0.5';
    playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 1 } } } as never);
    fakes[0]!.settle();
    await flush();
    expect(el.style.opacity).toBe('0.5');
    expect(end).not.toHaveBeenCalled();
  });
  test('a stop stops the running animation', () => {
    const stop = playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1 } } as never);
    stop();
    expect(fakes[0]!.stop).toHaveBeenCalledTimes(1);
  });
  test('an entrance calls its end when it lands, after clearing, and not when it was stopped', async () => {
    const end = vi.fn();
    el.style.opacity = '0.2';
    playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1 } } as never, end);
    expect(end).not.toHaveBeenCalled();
    fakes[0]!.settle();
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
    expect(el.style.opacity).toBe('');
    const again = vi.fn();
    const stop = playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1 } } as never, again);
    stop();
    fakes[1]!.settle();
    await flush();
    expect(again).not.toHaveBeenCalled();
  });
  test('an entrance that turns (rotate) leaves no inline transform behind, so the stylesheet\'s pose and its lift apply', async () => {
    el.setAttribute('style', 'transform: rotate(-11deg)');
    playIn(el, { initial: { rotate: 0 }, animate: { rotate: -11 } } as never);
    fakes[0]!.settle();
    await flush();
    expect(el.style.transform).toBe('');
  });
  test('an exit that runs to its end clears and ends', async () => {
    const end = vi.fn();
    el.style.opacity = '0.2';
    playOut(el, { exit: { opacity: 0 } } as never, end);
    fakes[0]!.settle();
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
    expect(el.style.opacity).toBe('');
  });
});
