import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { dropFrames, dropMs, dropRoll } from './drop.ts';

describe('the drop: keyframes', () => {
  test('one seed gives the same frames every time, and two seeds give different ones', () => {
    expect(dropFrames('k1:0', 400)).toEqual(dropFrames('k1:0', 400));
    expect(dropFrames('k1:0', 400)).not.toEqual(dropFrames('k2:9', 400));
  });

  test('three keyframes: rest, a small curl and drift up at 0.1, then the fall at 1', () => {
    const frames = dropFrames('k1:0', 400);
    expect(frames).toHaveLength(3);
    expect(frames.map((f) => f.offset)).toEqual([0, 0.1, 1]);
    expect(frames[0]!.transform).toBe('translate(0, 0) rotate(0deg)');
    expect(String(frames[1]!.transform)).toMatch(/^translate\(-?[\d.]+px, -5px\) rotate\(-?[\d.]+deg\)$/);
    expect(String(frames[2]!.transform)).toMatch(/^translate\(-?[\d.]+px, 400px\) rotate\(-?[\d.]+deg\)$/);
  });

  test('the spin is at least 200 degrees either way, and the curl is 0.06 of it', () => {
    const [, curl, end] = dropFrames('k1:0', 400).map((f) => String(f.transform));
    const spin = Number(/rotate\((-?[\d.]+)deg\)/.exec(end!)![1]);
    const early = Number(/rotate\((-?[\d.]+)deg\)/.exec(curl!)![1]);
    expect(Math.abs(spin)).toBeGreaterThanOrEqual(200);
    expect(Math.abs(spin)).toBeLessThanOrEqual(460);
    expect(early).toBeCloseTo(spin * 0.06, 1);
  });
});

describe('the drop: timing', () => {
  test('a fall of 400 pixels takes 520 milliseconds, and the time grows with the square root of the fall', () => {
    expect(dropMs(400)).toBe(520);
    expect(dropMs(0)).toBe(260);
    expect(dropMs(1600)).toBe(780);
  });
});

describe('the drop: the falling copy', () => {
  type Anim = { finished: Promise<Animation>; onfinish: (() => void) | null };
  const proto = Element.prototype as unknown as { animate?: unknown };
  let was: unknown;
  let runs: { keyframes: Keyframe[]; opts: KeyframeAnimationOptions; el: Element; anim: Anim; resolve: () => void }[];

  beforeEach(() => {
    was = proto.animate;
    runs = [];
    proto.animate = function (this: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions) {
      let resolve!: () => void;
      const anim: Anim = { finished: new Promise<Animation>((r) => { resolve = () => r(anim as unknown as Animation); }), onfinish: null };
      runs.push({ keyframes, opts, el: this, anim, resolve });
      return anim as unknown as Animation;
    };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    proto.animate = was;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function roll(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'roll';
    el.textContent = 'tape';
    document.body.append(el);
    Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ left: 20, top: 100, width: 300, height: 40, right: 320, bottom: 140, x: 20, y: 100, toJSON: () => ({}) }) });
    return el;
  }

  test('under reduced motion nothing is added to the document', () => {
    const el = roll();
    const before = document.body.innerHTML;
    dropRoll(el, { reduced: true, seed: 'k1:0' });
    expect(document.body.innerHTML).toBe(before);
    expect(runs).toHaveLength(0);
  });

  test('with no Web Animations nothing is added to the document', () => {
    const el = roll();
    proto.animate = undefined;
    const before = document.body.innerHTML;
    dropRoll(el, { reduced: false, seed: 'k1:0' });
    expect(document.body.innerHTML).toBe(before);
  });

  test('the copy is a hidden, pointer-free, fixed copy of the roll, falling for dropMs of its fall', () => {
    const el = roll();
    dropRoll(el, { reduced: false, seed: 'k1:0' });
    expect(runs).toHaveLength(1);
    const { el: copy, opts, keyframes } = runs[0]!;
    expect(copy).not.toBe(el);
    expect(copy.parentElement).toBe(document.body);
    expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect((copy as HTMLElement).style.position).toBe('fixed');
    expect((copy as HTMLElement).style.pointerEvents).toBe('none');
    expect((copy as HTMLElement).style.left).toBe('20px');
    expect((copy as HTMLElement).style.top).toBe('100px');
    const fall = Math.max(80, window.innerHeight - 100 + 40);
    expect(String(keyframes.at(-1)!.transform)).toContain(`${fall}px`);
    expect(opts.duration).toBe(dropMs(fall));
    expect(opts.easing).toBe('cubic-bezier(.55,0,.9,.55)');
  });

  test('the copy is removed when its animation finishes', async () => {
    const el = roll();
    dropRoll(el, { reduced: false, seed: 'k1:0' });
    const { el: copy, anim } = runs[0]!;
    expect(copy.isConnected).toBe(true);
    anim.onfinish?.();
    expect(copy.isConnected).toBe(false);
  });

  test('the copy is also removed when the finished promise settles', async () => {
    const el = roll();
    dropRoll(el, { reduced: false, seed: 'k1:0' });
    const { el: copy, resolve, anim } = runs[0]!;
    resolve();
    await anim.finished;
    await Promise.resolve();
    expect(copy.isConnected).toBe(false);
  });
});
