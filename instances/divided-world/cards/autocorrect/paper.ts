/**
 * The masking tape's paper, drawn on a canvas (docs/plans/2026-11-11-autocorrect-tape-design.md section 3). It ports the
 * approved bench's `drawPaper` (docs/research/2026-11-11-autocorrect-tape-bench/01-bench.html) with its constants: a
 * beige-cream with slow variation along its length, crepe ridges across the width, faint fiber flecks, factory-straight
 * long edges with a lit lip, hand-torn ends darkened where the paper is crushed, and loose fibers standing out of them.
 *
 * Seeded only: every number comes from the card's `seeded` generator, keyed by the strip, so every screen draws the same
 * tape and `Math.random` is never read. The residue (residue.ts) shares `endJags` and `crepeLines`, so its outline and its
 * ridges are the tape's own.
 *
 * Units: it draws in CSS pixels, w by h. The caller sizes the canvas to `ceil(w * dpr)` and calls `scale(dpr, dpr)` first
 * (the bench's `dpr` is `min(3, devicePixelRatio)`); nothing here reads the device.
 */
import { seeded } from '../../ui/seeded.ts';

/**
 * The paper's mean color, for the stylesheet's plain fill while a piece's canvas is not drawn yet (the words under it are
 * never visible), and the marker's ink on it, which holds 7:1.
 */
export const PAPER = Object.freeze({ base: '#e1d3b2', ink: '#17150f' });

/** One end's ragged outline, as [x, y] points from the top to the bottom. */
export type Jag = ReadonlyArray<readonly [number, number]>;

/** The tape's two torn ends, in CSS pixels. */
export function endJags(seed: string, w: number, h: number): { left: Jag; right: Jag } {
  const r = seeded(`${seed}:ends`);
  const side = (x0: number, dir: 1 | -1): Jag => {
    const pts: [number, number][] = [];
    const steps = Math.max(4, Math.round(h / 3));
    for (let i = 0; i <= steps; i++) pts.push([x0 + dir * (r() * 3.2 + (i % 2) * 0.8), (h * i) / steps]);
    return pts;
  };
  return { left: side(0, 1), right: side(w, -1) };
}

/** The crepe ridges across the width: each is [x, a, b], with a and b in [0, 1) saying how it leans and how strong it is. */
export function crepeLines(seed: string, w: number): [number, number, number][] {
  const r = seeded(`${seed}:crepe`);
  const xs: [number, number, number][] = [];
  for (let x = 0; x < w; x += 1.1 + r() * 1.7) xs.push([x, r(), r()]);
  return xs;
}

/**
 * The part of a canvas 2D context the paper draws with, so a test can hand in a recording context. Written out rather than
 * picked from `CanvasRenderingContext2D`, because the node type-check has no DOM library; a real context fits it.
 */
export interface PaperContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  clip(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
}

/** The tape's outline, as the bench's `tapePath`: down the left end, back up the right. */
function tapePath(c: PaperContext, ends: { left: Jag; right: Jag }): void {
  c.beginPath();
  ends.left.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  [...ends.right].reverse().forEach(([x, y]) => c.lineTo(x, y));
  c.closePath();
}

/** Draws one piece of tape, `w` by `h` CSS pixels, from the strip's seed. */
export function drawPaper(c: PaperContext, w: number, h: number, seed: string): void {
  const r = seeded(`${seed}:paper`);
  const ends = endJags(seed, w, h);
  c.save();
  tapePath(c, ends);
  c.clip();
  /* The paper: a beige-cream with slow variation along its length. */
  const g = c.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) {
    const l = 79 + (r() - 0.5) * 4;
    g.addColorStop(i / 6, `hsl(${42 + (r() - 0.5) * 3} ${44 + (r() - 0.5) * 6}% ${l}%)`);
  }
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  /* Crepe: fine ridges across the width, each a little crooked, darker and lighter by turns. */
  for (const [x, a, b] of crepeLines(seed, w)) {
    c.strokeStyle = a > 0.62 ? `rgb(255 251 236 / ${0.1 + b * 0.12})` : `rgb(118 92 38 / ${0.05 + b * 0.08})`;
    c.lineWidth = 0.5 + b * 0.6;
    c.beginPath();
    c.moveTo(x + (b - 0.5) * 0.8, 0);
    c.quadraticCurveTo(x + (a - 0.5) * 1.2, h / 2, x - (b - 0.5) * 0.8, h);
    c.stroke();
  }
  /* Fiber: short faint flecks in the paper. */
  for (let i = 0; i < w * h * 0.035; i++) {
    c.fillStyle = r() > 0.5 ? 'rgb(255 250 232 / .16)' : 'rgb(110 86 34 / .09)';
    c.fillRect(r() * w, r() * h, 0.6 + r() * 1.6, 0.4);
  }
  /* The factory edges, slightly darker, with a lit lip just inside the top one. */
  c.fillStyle = 'rgb(140 110 52 / .28)';
  c.fillRect(0, 0, w, 0.7);
  c.fillRect(0, h - 0.8, w, 0.8);
  c.fillStyle = 'rgb(255 255 255 / .25)';
  c.fillRect(0, 1, w, 0.6);
  /* The torn ends darken a touch where the paper is crushed. */
  const eg = c.createLinearGradient(0, 0, w, 0);
  const e = Math.min(0.5, 6 / w);
  eg.addColorStop(0, 'rgb(90 70 30 / .14)');
  eg.addColorStop(e, 'rgb(90 70 30 / 0)');
  eg.addColorStop(1 - e, 'rgb(90 70 30 / 0)');
  eg.addColorStop(1, 'rgb(90 70 30 / .14)');
  c.fillStyle = eg;
  c.fillRect(0, 0, w, h);
  c.restore();
  /* Loose fibers standing out of the torn ends. */
  c.strokeStyle = 'rgb(236 226 196 / .9)';
  c.lineWidth = 0.45;
  for (const [side, dir] of [[ends.left, -1], [ends.right, 1]] as const) {
    for (const [x, y] of side) {
      if (r() > 0.55) {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + dir * (0.8 + r() * 1.8), y + (r() - 0.5) * 1.6);
        c.stroke();
      }
    }
  }
}
