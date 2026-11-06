/* A .test.tsx because the light store listens on window and needs jsdom; `test:engine` runs .test.ts under plain node. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REST, ease, light, lightAt, setTiltGate, type LightInput } from './light.ts';

const base: LightInput = { px: 0, py: 0, tx: 0, ty: 0, tilt: false };
const VH = 1000;
/* Centered rect: scroll share s = 0, so only rest + pointer/tilt remain (idle is checked at t where its terms are known). */
const mid = { top: 450, height: 100 };
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

/* The bench's lightFor, written out by hand for each row. t = 0 and phase = 0: sin(0)=0, cos(0)=1, so idle adds y 0.08 + 0.02. */
const IDLE0 = { x: 0, y: 0.1 };

describe('lightAt', () => {
  beforeEach(() => document.documentElement.setAttribute('data-kb-motion', 'full'));
  afterEach(() => document.documentElement.removeAttribute('data-kb-motion'));

  it('rest weight 0.4, plus idle at t=0', () => {
    const l = lightAt(base, mid, { height: VH }, 0, 0);
    near(l.x, -0.35 * 0.4 + IDLE0.x);
    near(l.y, -0.45 * 0.4 + IDLE0.y);
  });
  it('pointer adds px*0.9 and py*0.55', () => {
    const l = lightAt({ ...base, px: 0.5, py: -1 }, mid, { height: VH }, 0, 0);
    near(l.x, -0.14 + 0.45);
    near(l.y, -0.18 + 0.1 - 0.55);
  });
  it('scroll adds s*0.9 to x and s*2.8 to y, s being the rect center share minus 0.5', () => {
    const l = lightAt(base, { top: 100, height: 100 }, { height: VH }, 0, 0); // center 150 => s = -0.35
    near(l.x, -0.14 - 0.315);
    near(l.y, -0.18 + 0.1 - 0.98);
  });
  it('tilt counts only when on', () => {
    const off = lightAt({ ...base, tx: 1, ty: -1 }, mid, { height: VH }, 0, 0);
    near(off.x, -0.14);
    near(off.y, -0.18 + 0.1);
    const on = lightAt({ ...base, tx: 0.5, ty: -0.5, tilt: true }, mid, { height: VH }, 0, 0);
    near(on.x, -0.14 + 0.55);
    near(on.y, -0.18 + 0.1 - 0.55);
  });
  it('idle follows the sines and cosines, offset by the phase', () => {
    const t = 1700 * Math.PI / 2; // sin(t/1700) = 1
    const phase = 0;
    const l = lightAt(base, mid, { height: VH }, t, phase);
    near(l.x, -0.14 + Math.sin(t / 1700) * 0.1 + Math.sin(t / 640) * 0.025);
    near(l.y, -0.18 + Math.cos(t / 2100) * 0.08 + Math.cos(t / 530) * 0.02);
    const p = lightAt(base, mid, { height: VH }, 1234, 7);
    near(p.x, -0.14 + Math.sin(1234 / 1700 + 7) * 0.1 + Math.sin(1234 / 640 + 2.1) * 0.025);
    near(p.y, -0.18 + Math.cos(1234 / 2100) * 0.08 + Math.cos(1234 / 530 + 7) * 0.02);
  });
  it('clamps to +-1.5', () => {
    const hi = lightAt({ ...base, px: 5, py: 5 }, { top: 5000, height: 10 }, { height: VH }, 0, 0);
    expect(hi).toEqual({ x: 1.5, y: 1.5 });
    const lo = lightAt({ ...base, px: -5, py: -5 }, { top: -5000, height: 10 }, { height: VH }, 0, 0);
    expect(lo).toEqual({ x: -1.5, y: -1.5 });
  });
  it('a viewport of height 0 still gives a finite light (the scroll term is 0)', () => {
    const l = lightAt(base, { top: 0, height: 0 }, { height: 0 }, 0, 0);
    expect(Number.isFinite(l.x) && Number.isFinite(l.y)).toBe(true);
    near(l.x, -0.14);
    near(l.y, -0.18 + 0.1);
  });
  it('returns REST under reduced motion, whatever the input', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    expect(lightAt({ px: 1, py: 1, tx: 1, ty: 1, tilt: true }, { top: 900, height: 50 }, { height: VH }, 777, 3)).toEqual(REST);
    expect(REST).toEqual({ x: -0.35, y: -0.45 });
  });
});

describe('ease', () => {
  it('has a 110ms time constant', () => {
    near(ease(0, 1, 0.11), 1 - Math.exp(-1));
    near(ease(2, 2, 0.05), 2);
    near(ease(0, 1, 0), 0);
  });
  it('a negative dt does not move away from the target', () => {
    expect(ease(0, 1, -5)).toBeGreaterThanOrEqual(0);
    expect(ease(0, 1, -5)).toBeLessThanOrEqual(1);
    near(ease(0.3, 1, -5), 0.3);
  });
  it('a huge dt lands on the target', () => {
    near(ease(-3, 1, 1e9), 1);
  });
});

describe('the input store', () => {
  let fine = true;
  let queries = 0;
  const changeListeners = new Set<(e: { matches: boolean }) => void>();
  const setFine = (v: boolean) => { fine = v; for (const l of [...changeListeners]) l({ matches: v }); };
  beforeEach(() => {
    fine = true;
    queries = 0;
    changeListeners.clear();
    window.matchMedia = ((q: string) => {
      queries++;
      return {
        matches: q.includes('hover: hover') ? fine : false,
        media: q,
        addEventListener: (_: string, l: (e: { matches: boolean }) => void) => { changeListeners.add(l); },
        removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => { changeListeners.delete(l); },
      };
    }) as unknown as typeof window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    light.reset();
    setTiltGate(() => false);
  });
  afterEach(() => { light.reset(); vi.restoreAllMocks(); });

  const move = (pointerType: string, clientX: number, clientY: number) => {
    const e = new Event('pointermove') as Event & { pointerType: string; clientX: number; clientY: number };
    Object.assign(e, { pointerType, clientX, clientY });
    window.dispatchEvent(e);
  };
  const tiltEvent = (gamma: number, beta: number) => {
    const e = new Event('deviceorientation');
    Object.assign(e, { gamma, beta });
    window.dispatchEvent(e);
  };

  it('a mouse or pen moves the light, normalized to the window', () => {
    light.attach({});
    move('mouse', 750, 200);
    near(light.px, 0.5);
    near(light.py, -0.5);
    move('pen', 0, 800);
    near(light.px, -1);
    near(light.py, 1);
  });
  it('a touch pointermove does not move the light', () => {
    light.attach({});
    move('touch', 900, 100);
    expect([light.px, light.py]).toEqual([0, 0]);
  });
  it('ignores the pointer without (hover: hover) and (pointer: fine)', () => {
    fine = false;
    light.attach({});
    move('mouse', 900, 100);
    expect([light.px, light.py]).toEqual([0, 0]);
  });
  it('asks matchMedia once however many pointermoves; a change to coarse stops them counting', () => {
    light.attach({});
    for (let i = 0; i < 20; i++) move('mouse', 100 + i, 100);
    expect(queries).toBe(1);
    near(light.px, (119 / 1000 - 0.5) * 2);
    setFine(false);
    move('mouse', 900, 700);
    near(light.px, (119 / 1000 - 0.5) * 2);
    setFine(true);
    move('mouse', 900, 700);
    near(light.px, 0.8);
    expect(queries).toBe(1);
  });
  it('removes the change listener with the last host', () => {
    const a = {}, b = {};
    light.attach(a); light.attach(b);
    expect(changeListeners.size).toBe(1);
    light.detach(a);
    expect(changeListeners.size).toBe(1);
    light.detach(b);
    expect(changeListeners.size).toBe(0);
  });
  it('a non-finite or missing gamma or beta gives a tilt of 0 on that axis', () => {
    light.attach({});
    setTiltGate(() => true);
    const raw = (gamma: unknown, beta: unknown) => {
      const e = new Event('deviceorientation');
      Object.assign(e, { gamma, beta });
      window.dispatchEvent(e);
    };
    for (const [g, b] of [[null, null], [NaN, NaN], [Infinity, -Infinity], [undefined, undefined]] as const) {
      raw(15, 15);
      raw(g, b);
      expect([light.tx, light.ty]).toEqual([0, 0]);
    }
    raw(15, null);
    near(light.tx, 0.5);
    expect(light.ty).toBe(0);
  });
  it('ignores deviceorientation while the tilt gate is off, uses it when on', () => {
    light.attach({});
    tiltEvent(30, 30);
    expect([light.tx, light.ty]).toEqual([0, 0]);
    setTiltGate(() => true);
    tiltEvent(15, -60);
    near(light.tx, 0.5);
    near(light.ty, -1);
    expect(light.input().tilt).toBe(true);
    setTiltGate(() => false);
    expect(light.input().tilt).toBe(false);
  });
  it('adds listeners once for three hosts, passive, and removes them with the last', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const rem = vi.spyOn(window, 'removeEventListener');
    const [a, b, c] = [{}, {}, {}];
    light.attach(a); light.attach(b); light.attach(c); light.attach(c);
    const added = add.mock.calls.filter(([n]) => n === 'pointermove' || n === 'deviceorientation');
    expect(added.map(([n]) => n).sort()).toEqual(['deviceorientation', 'pointermove']);
    for (const call of added) expect(call[2]).toMatchObject({ passive: true });
    light.detach(a); light.detach(b);
    expect(rem.mock.calls.filter(([n]) => n === 'pointermove')).toHaveLength(0);
    light.detach(c);
    const removed = rem.mock.calls.filter(([n]) => n === 'pointermove' || n === 'deviceorientation');
    expect(removed.map(([n]) => n).sort()).toEqual(['deviceorientation', 'pointermove']);
    move('mouse', 900, 100);
    expect(light.px).toBe(0);
  });
});
