/**
 * Whoops!'s suds (refinements plan Task 7; design section 7): what a wash throws up, drawn on each post's own
 * canvas so it scrolls with the post. The look, rates, lives and motions are the bench's
 * (docs/research/2026-11-06-whoops-bench/01-bench.html), with the owner's 2x running drips.
 *
 * One pool and one animation loop serve the whole page. The loop is made on the first wash and stopped when the
 * pool and every wet sheen are empty, so an idle page costs nothing. The pool is capped at 900 particles and
 * the oldest lather goes first, because lather is the long-lived kind and the one a viewer will not miss. A frame
 * that throws never stops the loop: the next frame is asked for before this one runs. A host that unregisters
 * takes its particles with it and its canvas is never drawn again. Reduced motion spawns nothing; the wash itself
 * is the Effect's and is untouched.
 *
 * Coordinates: `from`, `to` and `at` are CSS px in the host's box (`box.w` by `box.h`, origin at its top left),
 * the same px the splat and the ink grid use. `density` is canvas px per CSS px. The canvas is the span of the box
 * the host's near bands cover (`register`'s `top` is where it starts), so a particle is drawn at its box position
 * less `top` and one outside the span is skipped. The module draws on the canvas it is given and never sizes it.
 */
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import { rgbOf, type Box } from './splat.ts';
import { BRUSH_PX } from './scrub.ts';

export interface Pt { readonly x: number; readonly y: number }

const MAX_PARTS = 900;
const LATHER_S = 2.2;
const DRIPS = 2;
const BUBBLES = 1;
const WET_MS = 3500;
/** The most canvas px a host's wet sheen may hold, and the most travel one wash call spawns for, CSS px. */
const WET_PX = 4_000_000;
const MAX_DIST = 400;
const TINTS = 16;
/** How far, in CSS px, a sprite reaches past its anchor: a particle this far outside the canvas's span is not drawn. */
const SPAN_PAD = 48;
const DEFAULT_INK = '#1a1a1a';

type Kind = 'bubble' | 'foam' | 'run' | 'ring' | 'spray';
interface Cell { dx: number; dy: number; r: number; die: number }
interface Part {
  kind: Kind; host: object; x: number; y: number; born: number; life: number;
  vx?: number; vy?: number; r?: number; hue?: number; pop?: boolean; ph?: number;
  y0?: number; v?: number; acc?: number; cells?: Cell[]; ink?: boolean;
}
interface Reg { canvas: HTMLCanvasElement; box: Box; density: number; top: number; ink: string; wet: HTMLCanvasElement | null; wetUntil: number; clear: boolean }
interface Tinted { foam: HTMLCanvasElement; drop: HTMLCanvasElement; rgb: [number, number, number] }

const parts: Part[] = [];
const hosts = new Map<object, Reg>();
let handle: number | null = null;
let last = 0;
let bubbleFrames: HTMLCanvasElement[] | null = null;
let plainFoam: HTMLCanvasElement | null = null;
const tinted = new Map<string, Tinted>();

/** Canvas px per CSS px for a host's sheen: the screen's density, less where that would pass `WET_PX` on a tall box. */
const wetScale = (box: Box, density: number) => Math.min(density, Math.sqrt(WET_PX / Math.max(1, box.w * box.h)));

const now = () => performance.now();
const rnd = () => Math.random();
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Dirty water: the ink a wash lifts, thinned into grey-blue. */
function dirty(ink: string, share = 0.35): [number, number, number] {
  const [r, g, b] = rgbOf(ink), w = [159, 180, 200] as const;
  const c = [r, g, b] as const;
  return [0, 1, 2].map((i) => Math.round(w[i]! * (1 - share) + c[i]! * share)) as [number, number, number];
}

function bubbleSprites(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [], Z = 64;
  for (let k = 0; k < 12; k++) {
    const c = make(Z, Z), g = c.getContext('2d')!, m = Z / 2, R = Z / 2 - 2;
    const body = g.createRadialGradient(m - R * 0.25, m - R * 0.25, R * 0.1, m, m, R);
    body.addColorStop(0, 'rgba(255,255,255,0.03)'); body.addColorStop(0.72, 'rgba(220,236,255,0.10)'); body.addColorStop(1, 'rgba(255,255,255,0.42)');
    g.fillStyle = body; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
    let rim: string | CanvasGradient = 'rgba(190,215,255,0.55)';
    if (g.createConicGradient) {
      const cg = g.createConicGradient((k / 12) * Math.PI * 2, m, m);
      const hs = [300, 195, 55, 330, 165, 40, 300];
      hs.forEach((hh, i) => cg.addColorStop(i / (hs.length - 1), `hsla(${hh},95%,60%,0.6)`));
      rim = cg;
    }
    g.strokeStyle = rim; g.lineWidth = Z * 0.075; g.beginPath(); g.arc(m, m, R - Z * 0.04, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(40,60,95,0.42)'; g.lineWidth = 1.3; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(m - R * 0.38, m - R * 0.4, R * 0.27, R * 0.13, -Math.PI / 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(m + R * 0.42, m + R * 0.38, R * 0.08, 0, Math.PI * 2); g.fill();
    out.push(c);
  }
  return out;
}

function foamSprite(tint: string | null): HTMLCanvasElement {
  const Z = 32, c = make(Z, Z), g = c.getContext('2d')!, m = Z / 2, R = Z / 2 - 1.5;
  const grd = g.createRadialGradient(Z * 0.38, Z * 0.35, 0, m, m, R);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.6, '#f4f7fb'); grd.addColorStop(1, '#c9d3e0');
  g.fillStyle = grd; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
  if (tint) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.18; g.fillStyle = tint; g.fillRect(0, 0, Z, Z); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  g.strokeStyle = 'rgba(55,70,95,0.4)'; g.lineWidth = 1.2; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.arc(Z * 0.36, Z * 0.33, Z * 0.12, 0, Math.PI * 2); g.fill();
  return c;
}

function dropSprite(rgb: readonly number[], alpha: number): HTMLCanvasElement {
  const c = make(24, 36), g = c.getContext('2d')!;
  g.beginPath();
  g.moveTo(12, 2); g.bezierCurveTo(14, 10, 21, 16, 21, 24); g.arc(12, 24, 9, 0, Math.PI); g.bezierCurveTo(3, 16, 10, 10, 12, 2); g.closePath();
  const grd = g.createLinearGradient(4, 8, 20, 34);
  grd.addColorStop(0, `rgba(${rgb.join(',')},${alpha * 0.55})`); grd.addColorStop(1, `rgba(${rgb.map((v) => Math.round(v * 0.75)).join(',')},${alpha})`);
  g.fillStyle = grd; g.fill();
  g.strokeStyle = 'rgba(30,55,85,0.5)'; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(8.6, 21, 2.2, 3.4, -0.4, 0, Math.PI * 2); g.fill();
  return c;
}

/** The sprites are made once: the bubble frames and plain foam on first use, the tinted foam and drop once per ink. */
function sprites(ink: string): { bubbles: HTMLCanvasElement[]; foam: HTMLCanvasElement; tint: Tinted } {
  bubbleFrames ??= bubbleSprites();
  plainFoam ??= foamSprite(null);
  /* Keyed by the color, not its spelling, and held to `TINTS`: the oldest goes first. */
  const key = rgbOf(ink).join(',');
  let tint = tinted.get(key);
  if (!tint) {
    const rgb = dirty(ink);
    tint = { foam: foamSprite(`rgb(${key})`), drop: dropSprite(rgb, 0.75), rgb };
    tinted.set(key, tint);
    if (tinted.size > TINTS) tinted.delete(tinted.keys().next().value!);
  }
  return { bubbles: bubbleFrames, foam: plainFoam, tint };
}

function add(p: Part): void {
  if (parts.length >= MAX_PARTS) {
    const i = parts.findIndex((q) => q.kind === 'foam');
    parts.splice(i >= 0 ? i : 0, 1);
  }
  parts.push(p);
}

/**
 * Registers (or re-registers) a host's suds canvas. `density` is canvas px per CSS px; `ink` tints the lather and the dirty water.
 * The canvas holds the span of the box from `top` CSS px down for `canvas.height / density` px (the whole box when `top` is 0 and the
 * canvas is the box's size): a particle is drawn at its box position less `top`, and one outside the span is not drawn. A re-register,
 * for a new box, span or ink, keeps the particles in the air.
 */
export function register(host: object, canvas: HTMLCanvasElement, box: Box, density: number, ink: string = DEFAULT_INK, top = 0): void {
  let tone = ink;
  try { rgbOf(ink); } catch { tone = DEFAULT_INK; }
  const old = hosts.get(host);
  /* A sheen drawn for another box or density would be clipped or stretched on this one. */
  const same = old !== undefined && old.box.w === box.w && old.box.h === box.h && old.density === density;
  hosts.set(host, { canvas, box, density, top, ink: tone, wet: same ? old.wet : null, wetUntil: old?.wetUntil ?? 0, clear: old ? old.clear && old.canvas === canvas : false });
}

/** Drops the host's particles and never draws its canvas again. */
export function unregister(host: object): void {
  hosts.delete(host);
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i]!.host === host) parts.splice(i, 1);
}

/** What a wash throws up where the brush moved from `from` to `to`, in CSS px of the host's box. */
export function wash(host: object, from: Pt, to: Pt, overInk: boolean): void {
  const reg = hosts.get(host);
  if (!reg || motionReduced()) return;
  /* Spawning follows the travel, but one call's is capped: a 20,000px jump is no more lather than a 400px one. */
  const t = now(), dist = Math.min(MAX_DIST, Math.hypot(to.x - from.x, to.y - from.y) || 4), r = BRUSH_PX / 2;
  const nb = Math.floor((BUBBLES * dist) / 16 + rnd());
  for (let i = 0; i < nb; i++) {
    const br = 2 + rnd() ** 2 * 9;
    add({ kind: 'bubble', host, x: to.x + (rnd() - 0.5) * r * 1.4, y: to.y + (rnd() - 0.5) * r * 1.2, vx: (rnd() - 0.5) * 50, vy: -(14 + rnd() * 46), r: br, born: t, life: 0.9 + rnd() * 1.8, hue: (rnd() * 12) | 0, pop: rnd() < 0.65, ph: rnd() * 6 });
  }
  const nf = Math.floor(dist / 8 + rnd());
  for (let i = 0; i < nf; i++) {
    const f = rnd(), x = from.x + (to.x - from.x) * f + (rnd() - 0.5) * r * 1.2, y = from.y + (to.y - from.y) * f + (rnd() - 0.5) * r * 1.1;
    const cells: Cell[] = [], n = 3 + ((rnd() * 5) | 0);
    for (let k = 0; k < n; k++) cells.push({ dx: (rnd() - 0.5) * 9, dy: (rnd() - 0.5) * 7, r: 1.4 + rnd() * 3.4, die: 0.35 + rnd() * 0.65 });
    add({ kind: 'foam', host, x, y, born: t, life: LATHER_S * (0.55 + rnd() * 0.9), cells, ink: overInk });
  }
  if (rnd() < ((DRIPS * dist) / 140) * (overInk ? 1 : 0.35)) {
    add({ kind: 'run', host, x: to.x + (rnd() - 0.5) * r * 0.9, y: 0, y0: to.y + r * 0.35, v: 8 + rnd() * 18, acc: 10 + rnd() * 30, r: 1.7 + rnd() * 1.8, born: t, life: 1.3 + rnd() * 1.8 });
  }
  /* The wet sheen: the path just washed holds a film of dirty water that dries. */
  const [dr, dg, db] = sprites(reg.ink).tint.rgb;
  const sc = wetScale(reg.box, reg.density);
  reg.wet ??= make(Math.max(1, Math.floor(reg.box.w * sc)), Math.max(1, Math.floor(reg.box.h * sc)));
  const w = reg.wet.getContext('2d')!;
  w.setTransform(sc, 0, 0, sc, 0, 0);
  w.strokeStyle = `rgb(${dr},${dg},${db})`; w.lineCap = 'round'; w.lineWidth = BRUSH_PX * 0.92;
  w.beginPath(); w.moveTo(from.x, from.y); w.lineTo(to.x + 0.01, to.y); w.stroke();
  reg.wetUntil = t + WET_MS;
  start();
}

/** A small puff of suds at `at`, where ink is grabbed. */
export function puff(host: object, at: Pt): void {
  wash(host, { x: at.x - 6, y: at.y }, { x: at.x + 6, y: at.y }, true);
}

function popAt(host: object, x: number, y: number, r: number, t: number): void {
  add({ kind: 'ring', host, x, y, r, born: t, life: 0.16 });
  const n = 4 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, sp = 50 + rnd() * 90;
    add({ kind: 'spray', host, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: t, life: 0.22 + rnd() * 0.12 });
  }
}

function drawHost(host: object, reg: Reg, mine: Part[], t: number, dt: number): void {
  const { canvas } = reg, g = canvas.getContext('2d')!;
  /* A dried sheen is let go: the canvas is not held, and the decay's 8-bit residue goes with it. */
  if (reg.wet && reg.wetUntil <= t) reg.wet = null;
  const wet = reg.wetUntil > t && reg.wet !== null;
  if (!mine.length && !wet) {
    if (!reg.clear) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); reg.clear = true; }
    return;
  }
  reg.clear = false;
  const s = sprites(reg.ink);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(reg.density, 0, 0, reg.density, 0, -reg.top * reg.density);
  /* The span in box px, and a margin for what a sprite reaches past its anchor. */
  const lo = reg.top - SPAN_PAD, hi = reg.top + canvas.height / reg.density + SPAN_PAD;
  if (wet) {
    const w = reg.wet!.getContext('2d')!;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'destination-out';
    w.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / 0.6)})`;
    w.fillRect(0, 0, reg.wet!.width, reg.wet!.height);
    w.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.3; g.drawImage(reg.wet!, 0, 0, reg.box.w, reg.box.h); g.globalAlpha = 1;
  }
  const [dr, dg, db] = s.tint.rgb;
  for (const p of mine) {
    if (p.kind !== 'run' && (p.y < lo || p.y > hi)) continue;
    const age = Math.max(0, (t - p.born) / 1000), k = age / p.life;
    if (p.kind === 'foam') {
      const spr = p.ink ? s.tint.foam : s.foam, sag = age * 3;
      for (const c of p.cells!) {
        const sc = 1 - Math.min(1, Math.max(0, (k - (c.die - 0.18)) / 0.18));
        const rr = c.r * sc * Math.min(1, age * 8);
        if (rr <= 0.05) continue;
        g.drawImage(spr, p.x + c.dx - rr, p.y + c.dy + sag - rr, rr * 2, rr * 2);
      }
    } else if (p.kind === 'run') {
      const y = p.y0! + p.v! * age + 0.5 * p.acc! * age * age, fade = 1 - Math.max(0, (k - 0.7) / 0.3);
      /* A drip runs from its start down to `y`: it is drawn when any of that is in the span. */
      if (y < lo || p.y0! > hi) continue;
      if (y - p.y0! > 0.5) {
        const grd = g.createLinearGradient(0, p.y0!, 0, y);
        grd.addColorStop(0, `rgba(${dr},${dg},${db},0)`); grd.addColorStop(1, `rgba(${dr},${dg},${db},${0.35 * fade})`);
        g.strokeStyle = grd; g.lineWidth = p.r! * 1.1; g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x, p.y0!); g.lineTo(p.x, y); g.stroke();
      }
      g.globalAlpha = fade;
      g.drawImage(s.tint.drop, p.x - p.r!, y - p.r! * 2, p.r! * 2, p.r! * 3);
      g.globalAlpha = 1;
    } else if (p.kind === 'bubble') {
      const a = Math.min(1, age * 10) * (p.pop ? 1 : 1 - Math.max(0, (k - 0.75) / 0.25));
      const spr = s.bubbles[(p.hue! + Math.floor(age * 7)) % 12]!;
      const rr = p.r! * (1 + 0.05 * Math.sin(age * 11 + p.ph!));
      g.globalAlpha = a;
      g.drawImage(spr, p.x - rr, p.y - rr * (1 - 0.04 * Math.sin(age * 9)), rr * 2, rr * 2);
      g.globalAlpha = 1;
    } else if (p.kind === 'ring') {
      const rr = p.r! * (1 + Math.min(1, k) * 0.7);
      g.strokeStyle = `rgba(40,60,95,${0.45 * (1 - Math.min(1, k))})`; g.lineWidth = 1;
      g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.stroke();
    } else {
      g.fillStyle = `rgba(110,145,185,${0.75 * (1 - Math.min(1, k))})`;
      g.beginPath(); g.arc(p.x, p.y, 0.9, 0, Math.PI * 2); g.fill();
    }
  }
}

function step(t: number): void {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
  last = t;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!, age = (t - p.born) / 1000;
    if (age >= p.life) {
      parts.splice(i, 1);
      if (p.kind === 'bubble' && p.pop) popAt(p.host, p.x, p.y, p.r!, t);
      continue;
    }
    if (p.kind === 'bubble') {
      p.vy! -= 9 * dt; p.vx! *= Math.exp(-dt * 1.5);
      p.x += (p.vx! + Math.sin(age * 5 + p.ph!) * 8) * dt; p.y += p.vy! * dt;
    } else if (p.kind === 'spray') {
      p.vy! += 260 * dt; p.x += p.vx! * dt; p.y += p.vy! * dt;
    }
  }
  const by = new Map<object, Part[]>();
  for (const p of parts) { const l = by.get(p.host); if (l) l.push(p); else by.set(p.host, [p]); }
  /* One post's canvas that throws costs only that post its frame. */
  for (const [host, reg] of hosts) {
    try { drawHost(host, reg, by.get(host) ?? [], t, dt); } catch (err) { console.error(err); }
  }
}

const busy = (t: number) => parts.length > 0 || [...hosts.values()].some((r) => r.wetUntil > t);

/** A frame that throws never stops the loop: the next one is asked for first. The loop stops itself when nothing is left to draw. */
function frame(t: number): void {
  handle = requestAnimationFrame(frame);
  try { step(t); } catch (err) { console.error(err); }
  if (!busy(t)) { cancelAnimationFrame(handle); handle = null; }
}

function start(): void {
  if (handle !== null) return;
  last = now();
  handle = requestAnimationFrame(frame);
}

/** For tests only: what the pool holds and whether the loop runs, and a way back to a fresh page. */
export const probe = {
  size: () => parts.length,
  count: (kind: Kind) => parts.filter((p) => p.kind === kind).length,
  running: () => handle !== null,
  /** How many hosts hold a sheen canvas, and how many tinted sprite sets are cached. */
  sheens: () => [...hosts.values()].filter((r) => r.wet !== null).length,
  tints: () => tinted.size,
  reset(): void {
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null; parts.length = 0; hosts.clear(); tinted.clear();
  },
};
