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

/* The formula before `near` existed, written out by hand: a host that is not near must get exactly this. */
function formerLight(input: LightInput, rect: { readonly top: number; readonly height: number; readonly left?: number; readonly width?: number }, vh: number, t: number, phase: number) {
  let x = REST.x * 0.4 + input.px * 0.9;
  let y = REST.y * 0.4 + input.py * 0.55;
  const s = vh > 0 ? (rect.top + rect.height / 2) / vh - 0.5 : 0;
  y += s * 2.8;
  x += s * 0.9;
  if (input.tilt) { x += input.tx * 1.1; y += input.ty * 1.1; }
  x += Math.sin(t / 1700 + phase) * 0.1 + Math.sin(t / 640 + phase * 0.3) * 0.025;
  y += Math.cos(t / 2100) * 0.08 + Math.cos(t / 530 + phase) * 0.02;
  return { x: Math.max(-1.5, Math.min(1.5, x)), y: Math.max(-1.5, Math.min(1.5, y)) };
}

describe('lightAt for a near host', () => {
  beforeEach(() => document.documentElement.setAttribute('data-kb-motion', 'full'));
  afterEach(() => document.documentElement.removeAttribute('data-kb-motion'));
  const W = 1000;
  /* A pack 200 by 300 centered at (500, 500) in a 1000 by 1000 window. */
  const pack = { top: 350, height: 300, left: 400, width: 200 };
  const vp = { height: VH, width: W };
  /* A pointer at client (cx, cy) as the store holds it. */
  const at = (cx: number, cy: number): LightInput => ({ ...base, px: (cx / W - 0.5) * 2, py: (cy / VH - 0.5) * 2, cx, cy, pointed: true });

  it('a host that is not near gets exactly the former light, for several inputs', () => {
    const inputs: LightInput[] = [base, { ...base, px: 0.5, py: -1, pointed: true }, { px: -0.3, py: 0.8, tx: 0.4, ty: -0.2, tilt: true, pointed: true }, { px: 5, py: -5, tx: 0, ty: 0, tilt: false }];
    for (const input of inputs) for (const [rect, t, phase] of [[pack, 0, 0], [{ ...pack, top: 20 }, 1234, 7], [{ ...pack, top: 900 }, 99999, 2.4]] as const) {
      const former = formerLight(input, rect, VH, t, phase);
      for (const got of [lightAt(input, rect, vp, t, phase), lightAt(input, rect, vp, t, phase, false)]) {
        near(got.x, former.x);
        near(got.y, former.y);
      }
    }
  });
  /* The relief puts a light of (nx / 1.3, ny / 1.3) at the pointer's place on the box; the idle drift (t, phase) is all that is added to it. */
  const SCALE = 1 / 1.3;
  const DRIFT_X = 0.125;
  const DRIFT_Y = 0.1;
  const withinDrift = (l: { x: number; y: number }, want: { x: number; y: number }) => {
    expect(Math.abs(l.x - want.x)).toBeLessThanOrEqual(DRIFT_X + 1e-9);
    expect(Math.abs(l.y - want.y)).toBeLessThanOrEqual(DRIFT_Y + 1e-9);
  };
  /* A pointer at (nx, ny) half-extents from the center of `rect`, as the store holds it. */
  const onBox = (rect: { top: number; height: number; left: number; width: number }, nx: number, ny: number): LightInput =>
    at(rect.left + rect.width / 2 + nx * rect.width / 2, rect.top + rect.height / 2 + ny * rect.height / 2);

  it('a pointer at the box center puts the light at (0, 0), within the drift', () => {
    for (const [t, phase] of [[0, 0], [1234, 7], [99999, 2.4], [1700 * Math.PI / 2, 0]] as const) withinDrift(lightAt(onBox(pack, 0, 0), pack, vp, t, phase, true), { x: 0, y: 0 });
    const l = lightAt(onBox(pack, 0, 0), pack, vp, 0, 0, true);
    near(l.x, 0);
    near(l.y, 0.1);
  });
  it('a pointer on the box puts the light at (nx / 1.3, ny / 1.3) within the drift, wherever the box is in the window', () => {
    const boxes = [pack, { top: 0, height: 300, left: 0, width: 200 }, { top: 700, height: 300, left: 800, width: 200 }, { top: 700, height: 300, left: 0, width: 200 }];
    for (const rect of boxes) for (const [nx, ny] of [[0.5, -0.5], [-0.8, 0.3], [1, 1], [-1, -1]] as const) for (const [t, phase] of [[0, 0], [1234, 7], [99999, 2.4]] as const) {
      withinDrift(lightAt(onBox(rect, nx, ny), rect, vp, t, phase, true), { x: nx * SCALE, y: ny * SCALE });
    }
  });
  it('with the pointer at d >= 2.5 half-extents the light is exactly the page\'s', () => {
    for (const [nx, ny] of [[2.5, 0], [0, -2.5], [-3, 1], [4, 4], [2.5, 2.5]] as const) {
      const input = onBox(pack, nx, ny);
      for (const [t, phase] of [[0, 0], [1234, 7]] as const) {
        const got = lightAt(input, pack, vp, t, phase, true);
        const page = lightAt(input, pack, vp, t, phase, false);
        near(got.x, page.x);
        near(got.y, page.y);
      }
    }
  });
  it('the light is continuous in the pointer, across d = 1 and d = 2.5 and everywhere between', () => {
    const EPS = 1e-4;
    /* Each step of the pointer is EPS of a half-extent; the light may move by a few EPS and no more (no jump). */
    for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) for (const [ax, ay] of [[1, 0], [0, 1], [-1, 0], [0.6, -0.8]] as const) {
      const a = lightAt(onBox(pack, ax * d, ay * d), pack, vp, 500, 1, true);
      const b = lightAt(onBox(pack, ax * (d + EPS), ay * (d + EPS)), pack, vp, 500, 1, true);
      expect(Math.abs(a.x - b.x), `x at d=${d} along (${ax}, ${ay})`).toBeLessThan(EPS * 5);
      expect(Math.abs(a.y - b.y), `y at d=${d} along (${ax}, ${ay})`).toBeLessThan(EPS * 5);
    }
  });
  it('between d = 1 and d = 2.5 the light walks from the pointed light to the page\'s', () => {
    const input = onBox(pack, 1.75, 0);
    const got = lightAt(input, pack, vp, 0, 0, true);
    const page = lightAt(input, pack, vp, 0, 0, false);
    const pointed = { x: SCALE + 0, y: 0 + 0.1 };
    near(got.x, (page.x + pointed.x) / 2);
    near(got.y, (page.y + pointed.y) / 2);
  });
  it('clamps the pointed offset to -1..1, so a pointer just off the box holds the light at the box edge', () => {
    /* The pointer is 1% off the box, so the blend is 0.9999 pointed: the page's light is felt by about 1e-4 of its distance. */
    const l = lightAt(onBox(pack, 1.01, -1.01), pack, vp, 0, 0, true);
    expect(Math.abs(l.x - SCALE)).toBeLessThan(1e-3);
    expect(Math.abs(l.y - (-SCALE + 0.1))).toBeLessThan(1e-3);
  });
  it('still clamps the result to +-1.5', () => {
    expect(lightAt({ ...at(1000, 1000), px: 1, py: 1 }, { top: 5000, height: 10, left: 0, width: 10 }, vp, 0, 0, true)).toEqual({ x: 1.5, y: 1.5 });
  });
  it('with no fine pointer (the store never moved) a near host gets no near term, not one measured from the window middle', () => {
    const off = lightAt(base, { top: 350, height: 300, left: 0, width: 200 }, vp, 0, 0, true);
    const former = formerLight(base, { top: 350, height: 300 }, VH, 0, 0);
    near(off.x, former.x);
    near(off.y, former.y);
  });
  it('returns REST under reduced motion', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    expect(lightAt(at(600, 650), pack, vp, 0, 0, true)).toEqual(REST);
  });
  it('a host with no width or height, or a window with no width, gets no near term and stays finite', () => {
    for (const [rect, v] of [[{ top: 0, height: 0, left: 0, width: 0 }, vp], [pack, { height: VH, width: 0 }], [{ top: 350, height: 300 }, vp]] as const) {
      const l = lightAt(at(600, 650), rect, v, 0, 0, true);
      const former = formerLight(at(600, 650), rect, v.height, 0, 0);
      near(l.x, former.x);
      near(l.y, former.y);
    }
  });
  it('the store marks the pointer as placed only after a mouse or pen move on a fine pointer', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('hover: hover'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    light.reset();
    const host = {};
    light.attach(host);
    expect(light.input().pointed).toBe(false);
    const ev = (type: string) => { const e = new Event('pointermove'); Object.assign(e, { pointerType: type, clientX: 10, clientY: 10 }); window.dispatchEvent(e); };
    ev('touch');
    expect(light.input().pointed).toBe(false);
    ev('mouse');
    expect(light.input().pointed).toBe(true);
    light.reset();
    expect(light.input().pointed).toBe(false);
  });
  it('after a pointer move and then a window resize, the near light still stands at the pointer\'s place on the box', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('hover: hover'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    light.reset();
    light.attach({});
    const e = new Event('pointermove');
    Object.assign(e, { pointerType: 'mouse', clientX: 450, clientY: 600 });
    window.dispatchEvent(e);
    /* The window is resized with no pointer move: the pointer has not moved, so it is still at client (450, 600), a quarter of the box's half-width left of its center. */
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
    const l = lightAt(light.input(), pack, { height: window.innerHeight, width: window.innerWidth }, 0, 0, true);
    near(l.x, -0.5 * SCALE);
    near(l.y, (100 / 150) * SCALE + 0.1);
    light.reset();
  });
  it('a device with no fine pointer never places the pointer', () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    light.reset();
    light.attach({});
    const e = new Event('pointermove');
    Object.assign(e, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    window.dispatchEvent(e);
    expect(light.input().pointed).toBe(false);
    light.reset();
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
  it('a window of zero width or height leaves that axis of the pointer at 0, never NaN', () => {
    light.attach({});
    move('mouse', 750, 200);
    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true });
    move('mouse', 10, 10);
    expect([light.px, light.py]).toEqual([0, 0]);
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
