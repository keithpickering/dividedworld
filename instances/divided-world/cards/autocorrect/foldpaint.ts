/**
 * Paints the corner fold on its canvas (docs/plans/2026-11-20-autocorrect-feel-design.md section 5), ported from the feel bench's
 * `drawPicked` (docs/research/2026-11-20-autocorrect-feel-bench/01-bench.html). The geometry is fold.ts's; this is the canvas work.
 *
 * The canvas covers its piece with PAD around it. It shows: the tape still down (the paper and the marker's words, clipped to the
 * far side of the crease and to what is still stuck), then the fold laid over it with its shadow, then a thin lit line along the
 * crease. The fold is the tape's own outline, ragged end included, turned about the crease; it shows the sticky side. The corner's
 * own region is left open so the post's words show through it, as they do under a peek.
 *
 * The two faces (the paper with its words, and the sticky side) are made once for a pick and kept, so a frame of the pick costs two
 * image draws and not a redrawn paper. Everything is seeded: the faces are the strip's own, drawn the same on every screen.
 */
import { creaseAt, edgesAt, foldEnd, foldMatrix } from './fold.ts';
import { drawPaper, drawUnderside, endJags, PAPER, tapePath, type Jag, type PaperContext } from './paper.ts';

/** The canvas's margin around the piece, CSS px, so the fold and its shadow are not cut off where they leave the piece. */
export const FOLD_PAD = 10;

export interface FoldFaces {
  readonly key: string;
  readonly spec: FaceSpec;
  readonly top: HTMLCanvasElement;
  /** The sticky side, drawn with the picked end's own outline (fold.ts `foldEnd`): made on the first paint and again when the picked end changes. */
  under: HTMLCanvasElement | null;
  underKey: string;
  readonly ends: { left: Jag; right: Jag };
}

export interface FaceSpec { readonly w: number; readonly h: number; readonly seed: string; readonly words: string; readonly fontPx: number; readonly pad: number; readonly dpr: number }

export const facesKey = (s: FaceSpec) => `${s.w}x${s.h}|${s.seed}|${s.words}|${s.fontPx}|${s.pad}|${s.dpr}`;

/** A face on its own canvas, `w` by `h` with PAD around it, or null where there is no 2D context. */
function faceCanvas(s: FaceSpec, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((s.w + 2 * FOLD_PAD) * s.dpr);
  cv.height = Math.ceil((s.h + 2 * FOLD_PAD) * s.dpr);
  const c = cv.getContext('2d');
  if (!c) return null;
  c.scale(s.dpr, s.dpr);
  c.translate(FOLD_PAD, FOLD_PAD);
  draw(c);
  return cv;
}

/** The paper with the marker's words on it for one piece (the sticky side is drawn by `paintFold`, for the end picked). Null where a canvas cannot be had. */
export function makeFaces(s: FaceSpec): FoldFaces | null {
  const top = faceCanvas(s, (c) => {
    drawPaper(c as unknown as PaperContext, s.w, s.h, s.seed);
    if (!s.words) return;
    c.save();
    tapePath(c as unknown as PaperContext, endJags(s.seed, s.w, s.h));
    c.clip();
    c.fillStyle = PAPER.ink;
    c.font = `${s.fontPx}px "Gochi Hand", cursive`;
    c.textBaseline = 'middle';
    c.shadowColor = 'rgb(23 21 15 / .45)';
    c.shadowBlur = 0.6;
    /* The body's ink: its box is one line high, centered on the middle less 2% of its height, starting at the padding. */
    c.fillText(s.words, s.pad, s.h / 2 - 0.02 * s.fontPx);
    c.restore();
  });
  return top ? { key: facesKey(s), spec: s, top, under: null, underKey: '', ends: endJags(s.seed, s.w, s.h) } : null;
}

export interface FoldPaint {
  readonly w: number;
  readonly h: number;
  readonly side: 'a' | 'b';
  /** The stuck stretch's edge being picked, in the piece's pixels. */
  readonly at: number;
  /** The pick, 0..1. */
  readonly t: number;
  /** The piece's stuck stretches in its pixels: the tape down is only painted over these. */
  readonly stuck: ReadonlyArray<readonly number[]>;
  readonly dpr: number;
}

/** Paints one frame of the pick on `cv`, which is sized (w + 2 PAD) by (h + 2 PAD) times dpr. */
export function paintFold(cv: HTMLCanvasElement, faces: FoldFaces, o: FoldPaint): boolean {
  const c = cv.getContext('2d');
  const f = document.createElement('canvas');
  f.width = cv.width;
  f.height = cv.height;
  const fc = f.getContext('2d');
  if (!c || !fc) return false;
  const { w, h, dpr, side } = o;
  const P = FOLD_PAD;
  /* The piece's own pixels. */
  const piece = (ctx: CanvasRenderingContext2D) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(P, P); };
  /* The end being picked is the frame's left end: at `at`, the right end's frame runs the other way, so one drawing serves both. */
  const frame = (ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(P + o.at, P);
    if (side === 'b') ctx.scale(-1, 1);
  };
  const blit = (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement) => ctx.drawImage(src, -P, -P, src.width / dpr, src.height / dpr);
  /* The fold is the picked end's own outline: the strip's end (this side's jag), a tear's ragged cut or a peel line's straight one. */
  const end = foldEnd(side, o.at, edgesAt(o.stuck, side, o.at), w, h, faces.spec.seed);
  const underKey = `${side}:${o.at.toFixed(1)}:${end.map(([u]) => u.toFixed(2)).join(',')}`;
  if (faces.underKey !== underKey || !faces.under) {
    faces.under = faceCanvas(faces.spec, (ctx) => drawUnderside(ctx as unknown as PaperContext, w, h, faces.spec.seed, { left: end, right: faces.ends.right }));
    faces.underKey = underKey;
  }
  if (!faces.under) return false;
  const crease = creaseAt(o.t, w, h, end[0]?.[0] ?? 0);
  const { n, A } = crease;
  /** A large polygon of the crease's one side (the corner's, or the far one), in the frame's pixels. */
  const half = (ctx: CanvasRenderingContext2D, corner: boolean) => {
    const L = w + h + 4 * P, tx = -n[1], ty = n[0], s = corner ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(A[0] + tx * L, A[1] + ty * L);
    ctx.lineTo(A[0] - tx * L, A[1] - ty * L);
    ctx.lineTo(A[0] - tx * L + s * n[0] * L, A[1] - ty * L + s * n[1] * L);
    ctx.lineTo(A[0] + tx * L + s * n[0] * L, A[1] + ty * L + s * n[1] * L);
    ctx.closePath();
  };
  /** What is still stuck, as a clip in the piece's pixels. */
  const stuck = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    for (const [lo = 0, hi = 0] of o.stuck) ctx.rect(lo, -P, hi - lo, h + 2 * P);
    ctx.clip();
  };
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  /* The tape still down: the far side of the crease, over what is stuck. The path is laid in the frame and clipped in the piece's. */
  c.save();
  frame(c);
  half(c, false);
  piece(c);
  c.clip();
  stuck(c);
  blit(c, faces.top);
  c.restore();
  /* The fold, on its own canvas so its shadow is not clipped: p' = p - q n (n.p - n.A). */
  frame(fc);
  fc.transform(...foldMatrix(crease));
  fc.save();
  half(fc, true);
  fc.clip();
  blit(fc, faces.under);
  fc.restore();
  /* It darkens toward the crease, where it turns from the light. */
  fc.globalCompositeOperation = 'source-atop';
  frame(fc);
  const g = fc.createLinearGradient(A[0] + n[0] * h * 0.9, A[1] + n[1] * h * 0.9, A[0], A[1]);
  g.addColorStop(0, 'rgb(255 255 255 / .1)');
  g.addColorStop(0.75, 'rgb(80 60 25 / .04)');
  g.addColorStop(1, 'rgb(80 60 25 / .2)');
  fc.fillStyle = g;
  fc.fillRect(-2 * P, -2 * P, w + 4 * P, h + 4 * P);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.save();
  c.shadowColor = 'rgb(0 0 0 / .38)';
  c.shadowBlur = (1.5 + 3 * o.t) * dpr;
  c.shadowOffsetX = (0.6 + 1.2 * o.t) * dpr * (side === 'b' ? -1 : 1);
  c.shadowOffsetY = (1 + 2 * o.t) * dpr;
  c.drawImage(f, 0, 0);
  c.restore();
  /* A thin lit line along the crease, on the tape. */
  c.save();
  piece(c);
  tapePath(c as unknown as PaperContext, faces.ends);
  c.clip();
  stuck(c);
  frame(c);
  c.strokeStyle = 'rgb(255 250 235 / .7)';
  c.lineWidth = 0.6;
  c.beginPath();
  c.moveTo(A[0] + n[1] * (h + P), A[1] - n[0] * (h + P));
  c.lineTo(A[0] - n[1] * (h + P), A[1] + n[0] * (h + P));
  c.stroke();
  c.restore();
  return true;
}
