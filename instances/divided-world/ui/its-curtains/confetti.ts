/**
 * The confetti a curtain throws as it opens (docs/plans/2026-11-23-its-curtains-plan.md, Task 6; the owner's approved bench, 2026-11-25).
 *
 * The pieces are a pure function of a seed (the play's id), the box they are thrown in and the colors, so a test can pin them: small rectangles in the
 * fabric's light shade, gold and white, thrown up from the box's bottom edge at different speeds, each peaking against at most `boxMaxPx` of the box's height
 * and falling for `fallSeconds`. They may cross the box's top border on the way up: that is the joke of a burst.
 *
 * They are drawn on ONE canvas for the page, fixed over the window with `pointer-events: none`, and one particle list: a second curtain opened while the first's
 * confetti still falls adds to the list and does not wipe it. The canvas is the window's size, not a post's (tools/check-effect-canvas.mjs), and is removed
 * when the last piece lands. A piece is placed against its box's top-left corner as the box stands each frame, so the confetti keeps the post's place while the
 * page scrolls; a box that has left the page (the last curtain's cover, taken off the row the moment it is open) is where it last was.
 */
import { TUNING } from './tuning.ts';

export interface Piece {
  /** Where it starts, in the box's own pixels: along the bottom edge. */
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly vr: number;
  readonly color: string;
  readonly phase: number;
  /** Each piece is thrown a moment after the first, up to 120 ms. */
  readonly delayMs: number;
  /** How long it falls for, in seconds, the speed it falls no faster than, and its gravity. */
  readonly fall: number;
  readonly terminal: number;
  readonly gravity: number;
}

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from a play's id (FNV-1a), the same each time. */
export function seedOf(id: string): number {
  let h = 0x811C9DC5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The pieces one throw makes, for a box `w` by `h` px. A pure function of its arguments. */
export function confettiPieces(seed: number, box: { readonly w: number; readonly h: number }, colors: readonly string[]): Piece[] {
  const C = TUNING.confetti;
  const R = rng(Math.imul(seed, 7919) | 0);
  const W = box.w, H = box.h;
  const Hc = Math.min(H, C.boxMaxPx);
  const T = C.fallSeconds, terminal = (Hc * 1.1) / (0.6 * T), gravity = (Hc * 2.0) / (0.3 * T) ** 2 / 2;
  const out: Piece[] = [];
  for (let i = 0; i < C.count; i++) {
    const peak = Math.min(Hc + C.bleedPx * 0.9, Hc * (0.55 + R() * 0.75)) * C.power;
    const vy0 = -Math.sqrt(2 * gravity * peak);
    out.push({
      x: W * (0.5 + (R() - 0.5) * 0.8 * C.spread), y: H, vx: (R() - 0.5) * W * 0.55 * C.spread, vy: vy0 * (0.9 + R() * 0.2),
      w: 5 + R() * 5, h: 8 + R() * 6, r: R() * 6.28, vr: (R() - 0.5) * 14, color: colors[Math.floor(R() * colors.length)]!, phase: R() * 6.28, delayMs: R() * 120,
      fall: T, terminal, gravity,
    });
  }
  return out;
}

/** The colors a fabric's confetti is: its light shade, gold and white. */
export const confettiColors = (light: string): string[] => [light, TUNING.confetti.gold, TUNING.confetti.white];

/* ---------- the page's one canvas and one list ---------- */

interface Live {
  x: number; y: number; vx: number; vy: number; r: number;
  readonly piece: Piece;
  /** When it is born, on the frames' clock, and the line under which it has landed. */
  readonly born: number;
  readonly floor: number;
  readonly anchor: Anchor;
}
/** A throw's box: its corner against the window as it last stood, and the scroll then. */
interface Anchor { readonly el: Element | null; left: number; top: number; sx: number; sy: number }

let canvas: HTMLCanvasElement | null = null;
let g: CanvasRenderingContext2D | null = null;
let list: Live[] = [];
let frame = 0;
let last = 0;

function stop(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  list = [];
  canvas?.remove();
  canvas = null; g = null;
}

function fit(): void {
  if (!canvas || !g) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick(now: number): void {
  frame = 0;
  if (!g || !canvas) return;
  fit();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  g.clearRect(0, 0, window.innerWidth, window.innerHeight);
  list = list.filter((p) => {
    const el = (now - p.born) / 1000;
    if (el < 0) return true;
    const a = p.anchor;
    if (a.el?.isConnected) { const rect = a.el.getBoundingClientRect(); a.left = rect.left; a.top = rect.top; a.sx = window.scrollX; a.sy = window.scrollY; }
    const { piece } = p;
    p.vy = Math.min(piece.terminal, p.vy + piece.gravity * dt);
    if (p.vy > 0) p.vx *= 1 - 1.6 * dt;
    p.x += (p.vx + Math.sin(el * 5 + piece.phase) * 14) * dt;
    p.y += p.vy * dt;
    p.r += piece.vr * dt;
    if (p.y > p.floor + 14 || el > piece.fall + 0.9) return false;
    g!.save();
    g!.translate(a.left - (window.scrollX - a.sx) + p.x, a.top - (window.scrollY - a.sy) + p.y);
    g!.rotate(p.r);
    g!.scale(1, Math.cos(el * 9 + piece.phase));
    g!.fillStyle = piece.color;
    g!.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
    g!.restore();
    return true;
  });
  if (list.length > 0) frame = requestAnimationFrame(tick);
  else stop();
}

/** Throws `pieces` from the bottom edge of `box`: added to the page's list, and drawn until the last lands. A page that cannot draw (no 2d canvas) throws nothing. */
export function throwConfetti(box: Element | null, pieces: readonly Piece[]): void {
  if (pieces.length === 0 || typeof document === 'undefined') return;
  if (!canvas) {
    const made = document.createElement('canvas');
    made.className = 'dw-confetti';
    made.setAttribute('aria-hidden', 'true');
    const ctx = made.getContext('2d');
    if (!ctx) return;
    document.body.appendChild(made);
    canvas = made; g = ctx;
  }
  const rect = box?.getBoundingClientRect();
  const anchor: Anchor = { el: box, left: rect?.left ?? 0, top: rect?.top ?? 0, sx: window.scrollX, sy: window.scrollY };
  const now = performance.now();
  for (const piece of pieces) list.push({ x: piece.x, y: piece.y, vx: piece.vx, vy: piece.vy, r: piece.r, piece, born: now + piece.delayMs, floor: piece.y, anchor });
  if (!frame) { last = now; frame = requestAnimationFrame(tick); }
}

/** For tests: lets everything go and removes the canvas. */
export const __stopConfetti = stop;
