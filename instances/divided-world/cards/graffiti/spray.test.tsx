/**
 * Graffiti's spray painter (plan Task 8). jsdom has no canvas, so a 2D context is faked as a small pixel buffer: it rasterizes what spray.ts
 * uses (round-capped polylines and circles under a scale-and-shift transform, drawImage of a sprite, putImageData) with source-over and
 * destination-out, so a test reads the ink's alpha at a pixel, and it logs every arc.
 * The wall's own fields (coats, takes, placement, the press that goes to the top group) are read from `Wall` (docs/plans/2026-11-27-graffiti-everywhere-plan.md, Task 7).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { takesOf, GRID } from '../../../../engine/rules/surface.ts';
import { CAPS, CAPS_EM, COATS, SPONGE, SPONGE_EM } from '../graffiti.ts';
import { Wall, hitAt, paintWall, wallDensity, type GroupSrc, type Press, type WallAct, type Walker } from './spray.ts';
import { MAX_CANVAS_PX } from '../whoops/paint.ts';
import { ROW_PX } from '../whoops/scrub.ts';

const realGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(() => { HTMLCanvasElement.prototype.getContext = realGetContext; vi.restoreAllMocks(); });

interface Arc { readonly x: number; readonly y: number; readonly r: number; readonly alpha: number }
interface Px { a: number; r: number; g: number; b: number }
const rgb = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];

const seen = new Set<HTMLCanvasElement>();
const buffers = new WeakMap<HTMLCanvasElement, () => Px[]>();
/** One pixel-buffer context per canvas; `arcs` collects every arc a fill drew, in user space and with the alpha it was filled at. */
const arcs: Arc[] = [];
const strokes: { alpha: number; width: number; op: string }[] = [];
function fakeCanvases() {
  /* Module-level, because spray.ts keeps canvases (sprites, the halo layer) between calls and their contexts log to these. */
  arcs.length = 0; strokes.length = 0; seen.clear();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const cv = this;
    seen.add(cv);
    const px = (): Px[] => {
      const n = cv.width * cv.height;
      const p = ((cv as unknown as { _px?: Px[] })._px ??= []);
      if (p.length !== n) { p.length = 0; for (let i = 0; i < n; i++) p.push({ a: 0, r: 0, g: 0, b: 0 }); }
      return p;
    };
    buffers.set(cv, px);
    const self = cv as unknown as { _ctx?: unknown };
    if (self._ctx) return self._ctx;
    let T = [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number];
    type Shape = { kind: 'line'; pts: [number, number][] } | { kind: 'circle'; x: number; y: number; r: number };
    let path: Shape[] = [];
    const put = (i: number, c: [number, number, number], sa: number, op: string) => {
      const d = px()[i]!;
      if (op === 'destination-out') { d.a *= 1 - sa; return; }
      if (op === 'destination-over') {
        const a = d.a + sa * (1 - d.a);
        if (a <= 0) return;
        d.r = (d.r * d.a + c[0] * sa * (1 - d.a)) / a; d.g = (d.g * d.a + c[1] * sa * (1 - d.a)) / a; d.b = (d.b * d.a + c[2] * sa * (1 - d.a)) / a; d.a = a;
        return;
      }
      const a = sa + d.a * (1 - sa);
      if (a <= 0) return;
      d.r = (c[0] * sa + d.r * d.a * (1 - sa)) / a; d.g = (c[1] * sa + d.g * d.a * (1 - sa)) / a; d.b = (c[2] * sa + d.b * d.a * (1 - sa)) / a; d.a = a;
    };
    const user = (i: number): [number, number] => [((i % cv.width) + 0.5 - T[4]) / T[0], (Math.floor(i / cv.width) + 0.5 - T[5]) / T[3]];
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    /** The device pixel indexes a user-space box (grown by `pad`) can touch. */
    const near = (pad: number): number[] => {
      const all = path.flatMap((sh) => (sh.kind === 'line' ? sh.pts : [[sh.x, sh.y]])) as [number, number][];
      const x0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[0] * T[0] + T[4] - pad * T[0])))), x1 = Math.min(cv.width - 1, Math.ceil(Math.max(...all.map((p) => p[0] * T[0] + T[4] + pad * T[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[1] * T[3] + T[5] - pad * T[3])))), y1 = Math.min(cv.height - 1, Math.ceil(Math.max(...all.map((p) => p[1] * T[3] + T[5] + pad * T[3]))));
      const out: number[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * cv.width + x);
      return out;
    };
    const ctx: Record<string, unknown> = {
      canvas: cv, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { T = [a, 0, 0, d, e, f]; },
      clearRect() { for (const p of px()) p.a = 0; },
      beginPath() { path = []; },
      moveTo(x: number, y: number) { path.push({ kind: 'line', pts: [[x, y]] }); },
      lineTo(x: number, y: number) { (path.at(-1) as { pts: [number, number][] }).pts.push([x, y]); },
      arc(x: number, y: number, r: number) { path.push({ kind: 'circle', x, y, r }); arcs.push({ x, y, r, alpha: ctx.globalAlpha as number }); },
      stroke() {
        const c = rgb(ctx.strokeStyle as string), half = (ctx.lineWidth as number) / 2;
        strokes.push({ alpha: ctx.globalAlpha as number, width: ctx.lineWidth as number, op: ctx.globalCompositeOperation as string });
        for (const i of near(half + 1)) {
          const u = user(i);
          for (const s of path) if (s.kind === 'line' && s.pts.some((_, k) => segDist(u, s.pts[k]!, s.pts[Math.min(k + 1, s.pts.length - 1)]!) <= half)) { put(i, c, ctx.globalAlpha as number, ctx.globalCompositeOperation as string); break; }
        }
      },
      fill() {
        const c = rgb(ctx.fillStyle as string);
        for (const i of near(Math.max(...path.map((sh) => (sh.kind === 'circle' ? sh.r : 0))) + 1)) {
          const u = user(i);
          if (path.some((s) => s.kind === 'circle' && Math.hypot(u[0] - s.x, u[1] - s.y) <= s.r)) put(i, c, ctx.globalAlpha as number, ctx.globalCompositeOperation as string);
        }
      },
      createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(img: { width: number; height: number; data: Uint8ClampedArray }) {
        const p = px();
        for (let i = 0; i < img.width * img.height; i++) Object.assign(p[i]!, { r: img.data[i * 4]!, g: img.data[i * 4 + 1]!, b: img.data[i * 4 + 2]!, a: img.data[i * 4 + 3]! / 255 });
      },
      drawImage(src: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number) {
        if (src.width === 0 || src.height === 0) throw new DOMException('the source canvas has no size', 'InvalidStateError');
        const sp = buffers.get(src)!();
        const xs = [dx * T[0] + T[4], (dx + dw) * T[0] + T[4]], ys = [dy * T[3] + T[5], (dy + dh) * T[3] + T[5]];
        const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(cv.width - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(cv.height - 1, Math.ceil(Math.max(...ys)));
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          const i = yy * cv.width + xx;
          const [ux, uy] = user(i);
          const fx = (ux - dx) / dw, fy = (uy - dy) / dh;
          if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) continue;
          const s = sp[Math.floor(fy * src.height) * src.width + Math.floor(fx * src.width)]!;
          if (s.a > 0) put(i, [s.r, s.g, s.b], s.a * (ctx.globalAlpha as number), ctx.globalCompositeOperation as string);
        }
      },
    };
    self._ctx = ctx;
    return ctx;
  } as unknown as HTMLCanvasElement['getContext'];
  return { arcs, strokes, pixels: (cv: HTMLCanvasElement) => buffers.get(cv)!() };
}

const BOX = { w: 600, h: 400 };
const EM = 15;
const layout = (over: Partial<Parameters<typeof Wall.of>[1]> = {}) => ({ box: BOX, emPx: EM, ...over });
type G = { at: [number, number]; anchor: unknown; unit: 'em' | 'image'; em?: number; strokes: { can: string; cap: string; points: [number, number][] }[] };
/** A group of one stroke, in the group's units (ems), around its origin; at the middle of the box, a box attachment, unless told. */
const group = (points: [number, number][], over: Partial<G> = {}, cap = 'stock', can = 'red'): G => ({ at: [0.5, 0.5], anchor: { kind: 'box' }, unit: 'em', strokes: [{ can, cap, points }], ...over });
const draw = (id: string, ...groups: G[]): WallAct => ({ kind: 'draw', id, payload: { box: { w: 40, h: 26.7 }, groups } });
const legacy = (id: string, ...strokes: { can: string; cap: keyof typeof CAPS; aspect: number; points: [number, number][] }[]): WallAct => ({ kind: 'draw', id, payload: { strokes } });
const SPAN: [number, number][] = [[-10, 0], [10, 0]];
const wallOf = (acts: readonly WallAct[], over = {}) => Wall.of(acts, layout(over));
const canvasOf = (box = BOX) => { const c = document.createElement('canvas'); c.width = box.w; c.height = box.h; return c; };
/** One straight pass of the sponge along a row, as a drag does: a point every 5 px. Returns the presses it made. */
function pass(wall: Wall, y: number, x0 = 130, x1 = 470, walker: Walker = { last: null, left: 0 }): Press[] {
  const out: Press[] = [];
  for (let x = x0; x <= x1; x += 5) out.push(...wall.walk(walker, [x, y]));
  return out;
}
/** The wall painted on a fresh canvas at density 1: its pixels. */
function paintOn(wall: Wall | readonly WallAct[], box = BOX, draft?: WallAct | null) {
  const f = fakeCanvases();
  const c = canvasOf(box);
  paintWall(c.getContext('2d') as CanvasRenderingContext2D, box, 1, wall, draft);
  const p = f.pixels(c);
  return { alpha: (x: number, y: number) => p[y * box.w + x]!.a, px: p, arcs: [...f.arcs], at: (x: number, y: number) => p[y * box.w + x]! };
}
const coats = (wall: Wall, k: number, x: number, y: number) => wall.groups[k]!.coatsAt(x, y);

describe('the painter lays coats', () => {
  test('a stroke lays COATS.line tenths once on its core, and at most COATS.most where strokes of a drawing cross', () => {
    const one = wallOf([draw('a', group(SPAN))]);
    expect(coats(one, 0, 300, 200)).toBe(COATS.line);
    expect(coats(one, 0, 300, 200 + 8 + 4)).toBe(0);
    /* Two strokes in one group that cross: four coats' worth is 40 tenths, and a third crossing is held there. */
    const g = group(SPAN);
    g.strokes.push({ can: 'red', cap: 'stock', points: [[-10, 0], [10, 0]] }, { can: 'red', cap: 'stock', points: [[0, -5], [0, 5]] }, { can: 'red', cap: 'stock', points: [[-10, 0], [10, 0]] });
    const many = wallOf([draw('a', g)]);
    expect(coats(many, 0, 300, 200)).toBe(COATS.most);
    expect(coats(many, 0, 200, 200)).toBe(COATS.most);
    expect(coats(many, 0, 300, 200 - 40)).toBe(COATS.line);
  });

  test('a stroke is its cap in ems wide, on this screen\'s text size', () => {
    const r = (CAPS_EM.stock * EM) / 2;
    const w = wallOf([draw('a', group(SPAN))]);
    expect(w.hitAt(300, 200 + r - 2.5)).toBe(true);
    expect(w.hitAt(300, 200 + r + 2.5)).toBe(false);
    const big = wallOf([draw('a', group(SPAN))], { emPx: 30 });
    expect(big.hitAt(300, 200 + r * 2 - 2.5)).toBe(true);
  });

  test('only a stroke\'s own bounds are computed: a group\'s field is the size of its paint, not of the box', () => {
    const w = wallOf([draw('a', group(SPAN))], { box: { w: 6000, h: 8000 } });
    const f = w.groups[0]!;
    expect(f.cells).toBeLessThan(20_000);
  });
});

describe('a pass of the sponge', () => {
  test('one pass over a fresh 2-coat stroke leaves it inked at its center and see-through; a second leaves it clean', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    const fresh = paintOn(wall).alpha(300, 200);
    expect(fresh).toBeGreaterThan(0.9);
    const first = pass(wall, 200);
    expect(first.length).toBeGreaterThan(20);
    expect(wall.hitAt(300, 200)).toBe(true);
    expect(coats(wall, 0, 300, 200)).toBeGreaterThan(8);
    expect(coats(wall, 0, 300, 200)).toBeLessThan(12);
    const thin = paintOn(wall).alpha(300, 200);
    expect(thin).toBeGreaterThan(0.3);
    expect(thin).toBeLessThan(0.9);
    pass(wall, 200);
    expect(wall.hitAt(300, 200)).toBe(false);
    expect(paintOn(wall).alpha(300, 200)).toBe(0);
  });

  test('presses go every third of the sponge\'s radius, which is SPONGE_EM / 2 ems of this screen', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    expect(wall.spongePx).toBe((SPONGE_EM / 2) * EM);
    const presses = pass(wall, 200, 150, 450);
    const step = wall.spongePx / 3;
    expect(presses.length).toBe(Math.floor(300 / step) + 1);
    const wide = wallOf([draw('a', group(SPAN))], { emPx: 30 });
    expect(wide.spongePx).toBe(60);
  });

  test('a press where the wall has no paint is no press', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    expect(wall.press(300, 60)).toBeNull();
    expect(coats(wall, 0, 300, 200)).toBe(COATS.line);
  });

  test('presses over two groups where one lies on the other thin only the top one, the later draw', () => {
    const wall = wallOf([draw('under', group(SPAN)), draw('over', group(SPAN))]);
    const made = pass(wall, 200);
    expect(new Set(made.map((p) => `${p.draw}/${p.group}`))).toEqual(new Set(['over/0']));
    expect(coats(wall, 0, 300, 200)).toBe(COATS.line);
    expect(coats(wall, 1, 300, 200)).toBeLessThan(12);
    pass(wall, 200);
    expect(coats(wall, 1, 300, 200)).toBe(0);
    expect(coats(wall, 0, 300, 200)).toBe(COATS.line);
    const third = pass(wall, 200);
    /* The ends of the top group may still hold a scrap, which the pass takes first; the group beneath is reached under its clean middle. */
    expect(third.some((p) => p.draw === 'under')).toBe(true);
    expect(third.filter((p) => p.draw === 'over').every((p) => Math.abs(p.u) > 8)).toBe(true);
    expect(coats(wall, 0, 300, 200)).toBeLessThan(12);
  });

  test('a press keeps its group\'s units: a group scaled to half sends presses at twice the px distance', () => {
    /* 80 ems wide at 15 px is 1,200 px in a 600 px box: shrunk to a little under half. */
    const wall = wallOf([draw('a', group([[-40, 0], [40, 0]]))]);
    const f = wall.groups[0]!;
    expect(f.sx).toBeLessThan(EM * 0.5);
    expect(f.sx).toBeGreaterThan(EM * 0.4);
    const made = pass(wall, 200, 100, 400);
    const xs = made.map((p) => p.u);
    const spacing = xs[1]! - xs[0]!;
    expect(spacing * f.sx).toBeCloseTo(wall.spongePx / 3, 0);
    expect(spacing).toBeGreaterThan((wall.spongePx / 3 / EM) * 1.9);
    expect(made[0]!.v).toBeCloseTo(0, 1);
  });

  test('a press is a take at the group\'s own scale and replays the same from the saved cuts', () => {
    const acts = [draw('a', group(SPAN))];
    const live = wallOf(acts);
    const made = pass(live, 200);
    const cut: WallAct = { kind: 'wash', id: 'w', payload: { cuts: [{ draw: 'a', group: 0, presses: made.map((p) => [p.u, p.v]) }] } };
    const replayed = wallOf([...acts, cut]);
    for (const x of [200, 300, 400]) expect(coats(replayed, 0, x, 200)).toBeCloseTo(coats(live, 0, x, 200), 0);
    expect(coats(replayed, 0, 300, 200)).toBeLessThan(12);
    /* This visit's own presses are replayed after the saved ones. */
    const chunk = { draw: 'a', group: 0, presses: made.map((p): [number, number] => [p.u, p.v]) };
    const twice = Wall.of([...acts, cut], layout(), [chunk]);
    expect(coats(twice, 0, 300, 200)).toBe(0);
  });

  test('a wash of a draw that is not live, or of a group it has not, takes nothing', () => {
    const acts = [draw('a', group(SPAN))];
    const cut: WallAct = { kind: 'wash', id: 'w', payload: { cuts: [{ draw: 'gone', group: 0, presses: [[0, 0]] }, { draw: 'a', group: 7, presses: [[0, 0]] }] } };
    expect(coats(wallOf([...acts, cut]), 0, 300, 200)).toBe(COATS.line);
  });
});

describe('where a group lands', () => {
  const text = (dx: number, dy: number) => ({ kind: 'text', version: 'v', at: 4, len: 3, dx, dy });
  test('a text group lands at its mark plus its offset, and is drawn there', () => {
    const acts = [draw('a', group([[0, 0], [4, 0]], { anchor: text(2, 1) }))];
    const at = (x: number, y: number) => wallOf(acts, { measured: () => ({ kind: 'point' as const, x, y }) });
    const w = at(100, 60);
    expect([w.groups[0]!.ox, w.groups[0]!.oy]).toEqual([100 + 2 * EM, 60 + EM]);
    expect(w.hitAt(100 + 2 * EM + 20, 60 + EM)).toBe(true);
    expect(w.hitAt(300, 200)).toBe(false);
    /* The same Acts on another screen put it at that screen's mark. */
    const moved = at(40, 160);
    expect([moved.groups[0]!.ox, moved.groups[0]!.oy]).toEqual([40 + 2 * EM, 160 + EM]);
    expect(moved.hitAt(40 + 2 * EM + 20, 160 + EM)).toBe(true);
    expect(moved.hitAt(100 + 2 * EM + 20, 60 + EM)).toBe(false);
  });

  test('a group whose mark is missing lands at its spot in the box', () => {
    const w = wallOf([draw('a', group([[0, 0], [4, 0]], { at: [0.25, 0.75], anchor: text(2, 1) }))], { measured: () => null });
    expect([w.groups[0]!.ox, w.groups[0]!.oy]).toEqual([0.25 * BOX.w, 0.75 * BOX.h]);
  });

  test('an Act\'s places say where a group is attached in the post as it is now: a null place is its box spot', () => {
    const seen: unknown[] = [];
    const act = { ...draw('a', group([[0, 0], [4, 0]], { at: [0.25, 0.75], anchor: text(2, 1) })), places: [{ grp: 0, place: null }] };
    const w = wallOf([act], { measured: (g: GroupSrc) => { seen.push(g.anchor); return { kind: 'point' as const, x: 9, y: 9 }; } });
    expect([w.groups[0]!.ox, w.groups[0]!.oy]).toEqual([0.25 * BOX.w, 0.75 * BOX.h]);
    expect(seen.every((a) => (a as { kind: string }).kind === 'box')).toBe(true);
  });

  test('an image group is at its point in the image and a unit as wide as the image', () => {
    const image = { kind: 'image', version: 'v', n: 0, src: 'x.png', nth: 0, x: 0.5, y: 0.5 };
    const g = group([[-0.25, 0], [0.25, 0]], { anchor: image, unit: 'image', em: 13.33 });
    const w = wallOf([draw('a', g)], { measured: () => ({ kind: 'rect' as const, x: 50, y: 50, w: 200, h: 100 }) });
    expect([w.groups[0]!.ox, w.groups[0]!.oy, w.groups[0]!.sx]).toEqual([150, 100, 200]);
    expect(w.hitAt(150, 100)).toBe(true);
    expect(w.hitAt(150 + 50, 100)).toBe(true);
    /* Narrower on a screen where the image is narrower: the mark scales with it. */
    const narrow = wallOf([draw('a', g)], { measured: () => ({ kind: 'rect' as const, x: 50, y: 50, w: 100, h: 50 }) });
    expect(narrow.hitAt(100 + 40, 75)).toBe(false);
    expect(narrow.hitAt(100 + 20, 75)).toBe(true);
  });

  test('a group 900 px wide in a 360 px box is shrunk to fit and is inside it', () => {
    const w = wallOf([draw('a', group([[-30, 0], [30, 0]]))], { box: { w: 360, h: 400 } });
    const f = w.groups[0]!;
    expect(f.scale).toBeLessThan(0.45);
    expect(w.hitAt(5, 200)).toBe(true);
    expect(w.hitAt(355, 200)).toBe(true);
  });
});

describe('the look', () => {
  const acts = [draw('a', group([[-8, -3], [0, 2], [8, -3]], {}, 'fat'))];
  test('the overspray is at most 0.35 and lies outside the core, and is the same on every paint', () => {
    const a = paintOn(wallOf(acts)), b = paintOn(wallOf(acts));
    expect(b.px.map((p) => p.a)).toEqual(a.px.map((p) => p.a));
    const rim = (CAPS_EM.fat * EM) / 2;
    expect(rim).toBeGreaterThan(0);
    expect(a.px.some((p) => p.a > 0 && p.a < 0.4)).toBe(true);
    expect(a.alpha(300, 200 - 3 * EM)).toBeLessThanOrEqual(0.92 + 1e-6);
    expect(a.px.map((p) => p.a).filter((v) => v < 0.9).reduce((m, v) => Math.max(m, v), 0)).toBeLessThanOrEqual(1 - (1 - 0.35) * (1 - 0.5) + 0.01);
  });

  test('thinned paint takes the halo with it: a pass leaves less overspray, two leave none', () => {
    const wall = wallOf([draw('a', group(SPAN, {}, 'fat'))]);
    const sum = () => paintOn(wall).px.reduce((n, p) => n + p.a, 0);
    const before = sum();
    pass(wall, 200); const mid = sum();
    pass(wall, 200); pass(wall, 200); const after = sum();
    expect(mid).toBeLessThan(before);
    expect(after).toBeLessThan(mid);
  });

  test('a draft is painted after the wall and is no ink of its own', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    const draft = draw('', group([[-10, 0], [10, 0]], { at: [0.5, 0.8] }));
    const p = paintOn(wall, BOX, draft);
    expect(p.alpha(300, 0.8 * BOX.h)).toBeGreaterThan(0.9);
    expect(wall.hitAt(300, 0.8 * BOX.h)).toBe(false);
  });
});

describe('a draw and a wash from before groups', () => {
  const B = { w: 400, h: 200 };
  const old = legacy('old', { can: 'red', cap: 'fat', aspect: 2, points: [[0.25, 0.5], [0.75, 0.5]] });
  const oldWash = (points: [number, number][]): WallAct => ({ kind: 'wash', payload: { strokes: [{ aspect: 2, points }] } });
  const wallB = (acts: readonly WallAct[]) => Wall.of(acts, { box: B, emPx: EM });

  test('is one group at its shares, its strokes at their old widths, laid as a 2-coat group', () => {
    const w = wallB([old]);
    expect(w.groups).toHaveLength(1);
    expect(coats(w, 0, 200, 100)).toBe(COATS.line);
    const r = (CAPS.fat * B.w) / 2;
    expect(w.hitAt(200, 100 + r - 1)).toBe(true);
    expect(w.hitAt(200, 100 + r + 1.5)).toBe(false);
    expect(w.hitAt(0.25 * B.w - r + 1, 100)).toBe(true);
    const p = paintOn(w, B);
    expect(p.alpha(200, 100)).toBeGreaterThan(0.9);
    expect(p.alpha(200, 100 + r + 3)).toBeGreaterThan(0);
    expect(p.alpha(200, 100 + r + 3)).toBeLessThan(0.5);
  });

  test('a legacy wash is an instant cut of the draws before it, as stored, and not of one after it', () => {
    const cut = oldWash([[0.5, 0.4], [0.5, 0.6]]);
    expect(wallB([old, cut]).hitAt(200, 100)).toBe(false);
    expect(wallB([old, cut]).hitAt(120, 100)).toBe(true);
    expect(wallB([old, cut, legacy('later', { can: 'red', cap: 'fat', aspect: 2, points: [[0.45, 0.5], [0.55, 0.5]] })]).hitAt(200, 100)).toBe(true);
    expect(paintOn(wallB([old, cut]), B).alpha(200, 100 + 12)).toBe(0);
  });

  test('a press on a legacy group is a share of its box, 0 to 1', () => {
    const w = wallB([old]);
    const made = w.press(200, 100)!;
    expect(made).toMatchObject({ draw: 'old', group: 0, u: 0.5, v: 0.5 });
  });

  test.each([{ w: 340, h: 200 }, { w: 1000, h: 560 }])('a pass over a legacy draw on a $w px box takes what the server takes: its disc is SPONGE / 2 of the box wide', (B2) => {
    const aspect = B2.w / B2.h;
    const draw1 = legacy('old', { can: 'red', cap: 'fat', aspect, points: [[0.2, 0.5], [0.8, 0.5]] });
    const w = Wall.of([draw1], { box: B2, emPx: EM });
    const walker: Walker = { last: null, left: 0 };
    const presses: [number, number][] = [];
    for (const x of [0.3, 0.55]) for (const p of w.walk(walker, [x * B2.w, 0.5 * B2.h])) presses.push([p.u, p.v]);
    expect(presses.length).toBeGreaterThan(3);
    /* The step is a third of the disc's radius, as the server counts it. */
    expect(Math.abs(presses[1]![0] - presses[0]![0]) * B2.w).toBeCloseTo((SPONGE / 2 * B2.w) / 3, 0);
    const server = takesOf(presses, SPONGE / 2, aspect);
    const f = w.groups[0]!;
    let compared = 0, taken = 0;
    for (const gx of [30, 35, 40, 45, 50, 55]) for (const gy of [49, 50]) {
      const x = ((gx + 0.5) / GRID) * B2.w, y = ((gy + 0.5) / GRID) * B2.h;
      const left = f.coatsAt(x, y);
      const expected = Math.max(0, COATS.line - server[gy * GRID + gx]!);
      expect(Math.abs(left - expected), `cell ${gx},${gy}: ${left} against ${expected}`).toBeLessThanOrEqual(1);
      compared++; if (server[gy * GRID + gx]! > 0) taken++;
    }
    expect(compared).toBe(12);
    expect(taken).toBeGreaterThan(6);
  });
});

describe('the wall\'s bands', () => {
  test('spanOf says where a band still has paint, across the box, and none once it is clean', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    const span = wall.spanOf(190, 210)!;
    expect(span[0]).toBeCloseTo(300 - 150 - 8, -1);
    expect(span[1]).toBeCloseTo(300 + 150 + 8, -1);
    expect(wall.spanOf(0, 20)).toBeNull();
    pass(wall, 200); pass(wall, 200); pass(wall, 200);
    expect(wall.spanOf(190, 210)).toBeNull();
    expect(wall.anyPaint()).toBe(false);
  });
});

describe('the painter keeps a bitmap for each field', () => {
  test('a scrub that presses one group of several rasterizes only that group, and the look is the same as a fresh paint', () => {
    const acts = [draw('a', ...[0.15, 0.35, 0.55, 0.75].map((y) => group(SPAN, { at: [0.5, y] })))];
    const wall = wallOf(acts);
    paintOn(wall);
    expect(wall.groups.every((f) => f.rasters > 0), 'the first paint rasterizes every field').toBe(true);
    const base = wall.groups.map((f) => f.rasters);
    /* A frame with nothing pressed rasterizes nothing: it composites from the caches. */
    paintOn(wall);
    expect(wall.groups.map((f) => f.rasters), 'a repaint with no press').toEqual(base);
    const target = wall.groups[2]!;
    wall.walk({ last: null, left: 0 }, [target.ox + 20, target.oy]);
    wall.walk({ last: null, left: 0 }, [target.ox + 40, target.oy]);
    const after = paintOn(wall);
    const grew = wall.groups.map((f, i) => f.rasters - base[i]!);
    expect(grew[0], 'the group above').toBe(0);
    expect(grew[1]).toBe(0);
    expect(grew[3], 'the group below').toBe(0);
    expect(grew[2], 'the pressed group').toBeGreaterThan(0);
    const fresh = wallOf(acts);
    fresh.walk({ last: null, left: 0 }, [target.ox + 20, target.oy]);
    fresh.walk({ last: null, left: 0 }, [target.ox + 40, target.oy]);
    const same = paintOn(fresh);
    expect(after.px.map((p) => [p.a, p.r, p.g, p.b])).toEqual(same.px.map((p) => [p.a, p.r, p.g, p.b]));
  });

  test('a press that finds no paint rasterizes nothing', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    paintOn(wall);
    const was = wall.groups[0]!.rasters;
    expect(wall.press(10, 10)).toBeNull();
    paintOn(wall);
    expect(wall.groups[0]!.rasters).toBe(was);
  });
});

describe('a wall built over the one before it', () => {
  test('reuses a field whose inputs and washes are the same, and builds the one whose washes changed', () => {
    const acts = [draw('a', group(SPAN, { at: [0.5, 0.2] }), group(SPAN, { at: [0.5, 0.7] }))];
    const before = Wall.of(acts, layout());
    const same = Wall.of(acts, layout(), [], before);
    expect(same.groups[0]).toBe(before.groups[0]);
    expect(same.groups[1]).toBe(before.groups[1]);
    const washed = Wall.of(acts, layout(), [{ draw: 'a', group: 1, presses: [[0, 0]] }], before);
    expect(washed.groups[0], 'a group no wash touched').toBe(before.groups[0]);
    expect(washed.groups[1], 'a group a wash touched').not.toBe(before.groups[1]);
    expect(washed.groups[1]!.coatsAt(washed.groups[1]!.ox, washed.groups[1]!.oy)).toBeLessThan(COATS.line);
  });

  test('builds a group whose spot, or whose text size, changed', () => {
    const acts = [draw('a', group(SPAN, { at: [0.5, 0.2] }), group(SPAN, { at: [0.5, 0.7] }))];
    const before = Wall.of(acts, layout());
    const moved = Wall.of(acts, layout({ measured: (g) => (g.index === 1 ? { kind: 'point', x: 50, y: 300 } : null) }), [], before);
    expect(moved.groups[0]).toBe(before.groups[0]);
    const bigger = Wall.of(acts, layout({ emPx: 20 }), [], before);
    expect(bigger.groups[0]).not.toBe(before.groups[0]);
  });
});

/** Every canvas made from now on, in order, until the mocks are restored. */
function watchCanvases(): HTMLCanvasElement[] {
  const made: HTMLCanvasElement[] = [];
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: ElementCreationOptions) => {
    const el = real(tag, o);
    if (tag === 'canvas') made.push(el as HTMLCanvasElement);
    return el;
  }) as typeof document.createElement);
  return made;
}

describe('the painter gives its bitmaps back', () => {
  test('a field dropped on rebuild releases its bitmaps, and the one kept keeps them', () => {
    fakeCanvases();
    const target = canvasOf();
    const two = [draw('a', group(SPAN, { at: [0.5, 0.2] }), group(SPAN, { at: [0.5, 0.7] }))];
    const before = Wall.of(two, layout());
    const made = watchCanvases();
    paintWall(target.getContext('2d') as CanvasRenderingContext2D, BOX, 1, before);
    expect(made).toHaveLength(4);
    expect(made.every((c) => c.width > 0 && c.height > 0)).toBe(true);
    /* Halos of both fields, then their cores: the second field's are the 2nd and the 4th. */
    Wall.of([draw('a', group(SPAN, { at: [0.5, 0.2] }))], layout(), [], before);
    expect([made[1]!.width, made[1]!.height, made[3]!.width, made[3]!.height], 'the dropped field').toEqual([0, 0, 0, 0]);
    expect(made[0]!.width, 'the kept field').toBeGreaterThan(0);
    expect(made[2]!.width, 'the kept field').toBeGreaterThan(0);
  });

  test('a draft\'s fields release their bitmaps when another draft replaces them and when there is none', () => {
    fakeCanvases();
    const target = canvasOf();
    const ctx = target.getContext('2d') as CanvasRenderingContext2D;
    const wall = wallOf([draw('a', group(SPAN))]);
    paintWall(ctx, BOX, 1, wall);
    const made = watchCanvases();
    const one = draw('d1', group(SPAN, { at: [0.5, 0.8] })), two = draw('d2', group(SPAN, { at: [0.5, 0.1] }));
    paintWall(ctx, BOX, 1, wall, one);
    const first = [...made];
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((c) => c.width > 0)).toBe(true);
    paintWall(ctx, BOX, 1, wall, two);
    expect(first.every((c) => c.width === 0 && c.height === 0), 'the replaced draft').toBe(true);
    const second = made.slice(first.length);
    expect(second.every((c) => c.width > 0)).toBe(true);
    paintWall(ctx, BOX, 1, wall, null);
    expect(second.every((c) => c.width === 0 && c.height === 0), 'no draft').toBe(true);
  });

  test('a pass with no paint in it allocates no canvas (the overspray left beside the wash still has one)', () => {
    fakeCanvases();
    const target = canvasOf();
    const wall = wallOf([draw('a', group(SPAN))]);
    pass(wall, 200); pass(wall, 200); pass(wall, 200);
    expect(wall.anyPaint()).toBe(false);
    const made = watchCanvases();
    paintWall(target.getContext('2d') as CanvasRenderingContext2D, BOX, 1, wall);
    expect(made, 'the halo pass only; the clean cores have none').toHaveLength(1);
  });
});

describe('the sweep\'s bands tile the box', () => {
  /** Every y of the box lies within some band's reach (`half` either side of a band's center). */
  const gaps = (centers: readonly number[], half: number, h: number): number[] => {
    const bad: number[] = [];
    for (let y = 0; y <= h; y += 0.25) if (!centers.some((c) => Math.abs(y - c * h) <= half + 1e-9)) bad.push(y);
    return bad;
  };

  test('where a press reaches less than a row, the bands are shallower and still leave no gap', () => {
    const wall = wallOf([draw('a', group(SPAN))], { emPx: 2 });
    expect(wall.bandHalf()).toBeLessThan(ROW_PX / 2);
    expect(gaps(wall.bands(BOX.h), wall.bandHalf(), BOX.h), 'y with no band').toEqual([]);
  });

  test('at the board\'s text size they tile the box, down to its last pixel', () => {
    const wall = wallOf([draw('a', group(SPAN))]);
    expect(gaps(wall.bands(BOX.h), wall.bandHalf(), BOX.h), 'y with no band').toEqual([]);
  });
});

describe('a wall built over the one before: unit', () => {
  test('a group that differs only in its unit is laid again, not reused', () => {
    const em = [draw('a', group(SPAN))], image = [draw('a', group(SPAN, { unit: 'image' }))];
    const before = Wall.of(em, layout());
    const after = Wall.of(image, layout(), [], before);
    expect(after.groups[0]).not.toBe(before.groups[0]);
  });
});

describe('wallDensity', () => {
  test('is the density up to MAX_DPR, lowered so the canvas stays within MAX_CANVAS_PX', () => {
    expect(wallDensity({ w: 400, h: 200 }, 1.5)).toBe(1.5);
    expect(wallDensity({ w: 400, h: 200 }, 5)).toBe(2);
    const big = { w: 3000, h: 3000 };
    const q = wallDensity(big, 2);
    expect(Math.ceil(big.w * q) * Math.ceil(big.h * q)).toBeLessThanOrEqual(MAX_CANVAS_PX);
  });
});

describe('hitAt', () => {
  test('is the wall\'s own test, and takes acts too, for a caller with no wall of its own', () => {
    const acts = [draw('a', group(SPAN))];
    const wall = wallOf(acts);
    expect(hitAt(wall, BOX, 300, 200)).toBe(true);
    expect(hitAt(wall, BOX, 300, 100)).toBe(false);
    expect(hitAt(acts, BOX, 300, 200)).toBe(true);
    expect(hitAt([], BOX, 300, 200)).toBe(false);
  });
});
