/**
 * The hand drawer's plays (play.ts): each returns a stop; a stopped run neither clears the element nor calls `end` when its animation settles,
 * so a reopen during the exit keeps the entrance's values. `animate` is stubbed (jsdom has no WAAPI).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

interface Fake { settle: () => void; stop: ReturnType<typeof vi.fn> }
const fakes: Fake[] = [];
/* Motion's frame loop: what is scheduled after its render runs when the test says the frame has rendered. */
const afterRender: (() => void)[] = [];
const render = () => { for (const f of afterRender.splice(0)) f(); };
vi.mock('motion/react', () => ({
  frame: { postRender: (f: () => void) => { afterRender.push(f); return f; } },
  animate: () => {
    let done: () => void = () => {};
    const p = new Promise<void>((r) => { done = r; });
    const fake = { settle: done, stop: vi.fn() };
    fakes.push(fake);
    return Object.assign(p, { stop: fake.stop });
  },
}));
const { playIn, playOut } = await import('./play.ts');
const { DEFAULT_FEELS, FEELS, overlay } = await import('./motion.ts');

const el = document.createElement('div');
afterEach(() => { fakes.length = 0; afterRender.length = 0; el.removeAttribute('style'); });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the drawer plays', () => {
  test('a reopen during the exit: the exit\'s completion does not clear the entrance or end the close', async () => {
    const end = vi.fn();
    const stopOut = playOut(el, { exit: { opacity: 0, transition: { duration: 1 } } } as never, end);
    stopOut();
    el.style.opacity = '0.5';
    playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 1 } } } as never);
    fakes[0]!.settle();
    await flush();
    render();
    expect(el.style.opacity).toBe('0.5');
    expect(end).not.toHaveBeenCalled();
  });
  test('a stop stops the running animation', () => {
    const stop = playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1 } } as never);
    stop();
    expect(fakes[0]!.stop).toHaveBeenCalledTimes(1);
  });
  test('an exit that runs to its end clears and ends', async () => {
    const end = vi.fn();
    el.style.opacity = '0.2';
    playOut(el, { exit: { opacity: 0 } } as never, end);
    fakes[0]!.settle();
    await flush();
    render();
    expect(end).toHaveBeenCalledTimes(1);
    expect(el.style.opacity).toBe('');
  });
  /*
   * The drawer's fan stands far past the drawer's own box, so a mask left on it after the entrance cuts the cards off at the box's top
   * (Snappy's wipe rests at 101%, which still clips everything outside the box). Every property the hand's entrance writes, under every feel,
   * is gone when it lands, by its css name: a camelCase key handed to removeProperty removes nothing.
   */
  for (const name of FEELS) {
    test(`under ${name}, the hand's entrance leaves nothing it animated on the drawer`, async () => {
      const p = overlay({ ...DEFAULT_FEELS[name], name }, { x: 10, y: 10 });
      const keys = Object.keys(p.animate as Record<string, unknown>).filter((k) => k !== 'transition' && k !== 'transitionEnd');
      playIn(el, p);
      /* What the real animation leaves inline as it lands (the fake writes nothing), each property by its css name, written by hand here. */
      const css: Record<string, string> = { y: 'transform', scale: 'transform', opacity: 'opacity', filter: 'filter', transformOrigin: 'transform-origin', maskImage: 'mask-image', WebkitMaskImage: '-webkit-mask-image' };
      const rest: Record<string, string> = { transform: 'none', opacity: '1', filter: 'none', 'transform-origin': '10px 10px', 'mask-image': 'linear-gradient(#000, #000)', '-webkit-mask-image': 'linear-gradient(#000, #000)' };
      for (const k of keys) { expect(css[k], `the test knows ${k}'s css name`).toBeDefined(); el.style.setProperty(css[k]!, rest[css[k]!]!); }
      expect(el.getAttribute('style')).not.toBe('');
      fakes[0]!.settle();
      await flush();
      render();
      expect(el.getAttribute('style') ?? '').toBe('');
    });
  }
  /*
   * Motion writes an animation's final values inline on the frame after its promise settles (its render step), so a clear made when the
   * promise settles is undone: Smooth's entrance left `filter: blur(0px)` on the drawer, the containing block the header warns of. The
   * clear waits for that render.
   */
  test('the entrance clears after Motion renders its final values, not before', async () => {
    playIn(el, { initial: { opacity: 0, filter: 'blur(6px)' }, animate: { opacity: 1, filter: 'blur(0px)' } } as never);
    fakes[0]!.settle();
    await flush();
    el.style.opacity = '1';
    el.style.filter = 'blur(0px)';
    render();
    expect(el.getAttribute('style') ?? '').toBe('');
  });
  test('the exit clears after Motion renders its final values, and only then ends', async () => {
    const end = vi.fn();
    playOut(el, { exit: { opacity: 0, filter: 'blur(6px)' } } as never, end);
    fakes[0]!.settle();
    await flush();
    el.style.opacity = '0';
    el.style.filter = 'blur(6px)';
    expect(end).not.toHaveBeenCalled();
    render();
    expect(el.getAttribute('style') ?? '').toBe('');
    expect(end).toHaveBeenCalledTimes(1);
  });
  test('a run stopped between its landing and the render clears nothing', async () => {
    const stop = playIn(el, { initial: { opacity: 0 }, animate: { opacity: 1 } } as never);
    fakes[0]!.settle();
    await flush();
    el.style.opacity = '0.5';
    stop();
    render();
    expect(el.style.opacity).toBe('0.5');
  });
});

