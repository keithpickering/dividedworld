/**
 * The camera's moves, made in the edit (docs/plans/2026-11-21-commentary-video-design.md, section 5a): a push-in, a pan and a roll are
 * a rectangle of the take's frame that changes along a cut, and a punch is a jump in that eases back. Pure: this file only does the
 * arithmetic, and writes it as the expressions ffmpeg's `perspective` filter evaluates once for every output frame. (`perspective`
 * samples at fractional positions, so a slow push does not step by whole pixels as `zoompan`'s and `crop`'s integer offsets do, and it
 * turns the view too.)
 *
 * A rectangle is `{ x, y, w, roll }`: its top-left corner (x, y) and its width `w`, each a share of the take's frame, and a roll in
 * degrees. The rectangle keeps the frame's shape, so its height share is `w` as well: `w: 1` is the whole frame and `w: 0.5` a push
 * to twice the size. A roll turns the view about the rectangle's centre and uncovers black at its corners.
 *
 * A cut carries `frames` (its length), and optionally:
 *   move:    { from: Rect, to: Rect, ease: 'linear' | 'in' | 'out' | 'inOut' }   first frame is `from`, last is `to`
 *   punch:   n                         a jump in of n percent on the cut's first frame, easing back over eight frames
 *   punches: [{ frame, percent }]      the same at any frame of the cut (a landing)
 *
 * The expressions are the same arithmetic as `cutRect`, written in a form that is also valid JavaScript but for `if`, `st` and `ld`,
 * which the tests supply and evaluate against `cutRect` frame by frame, so what ffmpeg is told is what the tests hold.
 */

export const FPS = 60;
export const PUNCH_FRAMES = 8;
export const FULL = { x: 0, y: 0, w: 1, roll: 0 };

/** The push a take allows: its pixels may be shown at up to twice their size, so a 1920 px take 2x and a 3840 px take 4x. @param {number} sourceWidth */
export const pushLimit = (sourceWidth) => (2 * sourceWidth) / 1920;

/** @param {string} name @param {number} p 0 to 1 */
export function ease(name, p) {
  const q = Math.min(1, Math.max(0, p));
  if (name === 'in') return q * q;
  if (name === 'out') return 1 - (1 - q) * (1 - q);
  if (name === 'inOut') return q * q * (3 - 2 * q);
  if (name === 'linear' || name === undefined) return q;
  throw new Error(`unknown ease ${JSON.stringify(name)}: linear, in, out or inOut`);
}

/** @typedef {{ x: number, y: number, w: number, roll: number }} Rect */
/** @typedef {{ from: Rect, to: Rect, ease?: string }} Move */

/** The rectangle of a move at frame `i` of `n`: `from` at 0, `to` at n - 1. @param {Move} move @param {number} i @param {number} n @returns {Rect} */
export function moveRect(move, i, n) {
  const e = ease(move.ease ?? 'linear', n <= 1 ? 1 : i / (n - 1));
  const a = move.from, b = move.to;
  const mix = (/** @type {number} */ u, /** @type {number} */ v) => u + (v - u) * e;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), roll: mix(a.roll ?? 0, b.roll ?? 0) };
}

/** How much a punch has the picture pushed in `f` frames after it began: 1 + n/100 at 0, back to 1 at the eighth frame. @param {number} percent @param {number} f */
export const punchScale = (percent, f) => (f < 0 || f >= PUNCH_FRAMES ? 1 : 1 + (percent / 100) * (1 - ease('inOut', f / PUNCH_FRAMES)));

/** @param {{ punch?: number, punches?: { frame: number, percent: number }[] }} cut @returns {{ frame: number, percent: number }[]} */
const punchesOf = (cut) => [...(cut.punch ? [{ frame: 0, percent: cut.punch }] : []), ...(cut.punches ?? [])];

/**
 * The rectangle shown at frame `i` of a cut: its move's rectangle (the whole frame with no move), pushed in about its centre by every
 * punch in progress, and kept inside the frame.
 * @param {{ frames: number, move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} cut
 * @param {number} i
 * @returns {Rect}
 */
export function cutRect(cut, i) {
  const base = cut.move ? moveRect(cut.move, i, cut.frames) : FULL;
  const s = punchesOf(cut).reduce((acc, p) => acc * punchScale(p.percent, i - p.frame), 1);
  const w = base.w / s;
  const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(1 - w, v));
  return { x: clamp(base.x + base.w / 2 - w / 2), y: clamp(base.y + base.w / 2 - w / 2), w, roll: base.roll };
}

/** The largest push a cut asks for, as a multiple of the whole frame. @param {Parameters<typeof cutRect>[0]} cut */
export function maxPush(cut) {
  let most = 1;
  for (let i = 0; i < cut.frames; i++) most = Math.max(most, 1 / cutRect(cut, i).w);
  return most;
}

/**
 * Refuses a push past what the take's pixels give, naming the cut.
 * @param {string} name the cut, as the refusal names it
 * @param {Parameters<typeof cutRect>[0]} cut
 * @param {number} sourceWidth the take's width in pixels
 */
export function refusePush(name, cut, sourceWidth) {
  const push = maxPush(cut), limit = pushLimit(sourceWidth);
  if (push > limit + 1e-9) throw new Error(`${name}: a push to ${push.toFixed(2)}x of a ${sourceWidth} px take; its pixels give ${limit.toFixed(2)}x at most`);
}

/* ---- the expressions ---- */

const n6 = (/** @type {number} */ v) => String(Number(v.toPrecision(12)));
const easeExpr = (/** @type {string} */ name, /** @type {string} */ p) => {
  if (name === 'in') return `((${p})*(${p}))`;
  if (name === 'out') return `(1-(1-(${p}))*(1-(${p})))`;
  if (name === 'inOut') return `((${p})*(${p})*(3-2*(${p})))`;
  return `(${p})`;
};
const mixExpr = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ e) => `(${n6(a)}+(${n6(b - a)})*${e})`;

/**
 * ffmpeg expressions for a cut, each evaluated per output frame (variable `on`): `w`, the rectangle's width as a share of the frame;
 * `cx` and `cy`, its centre as shares of the frame, kept inside it; and `roll` in radians. Each is the arithmetic of `cutRect`.
 * @param {Parameters<typeof cutRect>[0]} cut
 */
export function expressions(cut) {
  const last = Math.max(1, cut.frames - 1);
  const m = cut.move;
  const e = m ? easeExpr(m.ease ?? 'linear', `min(1,on/${last})`) : '0';
  const wB = m ? mixExpr(m.from.w, m.to.w, e) : '1';
  const cxB = m ? mixExpr(m.from.x + m.from.w / 2, m.to.x + m.to.w / 2, e) : '0.5';
  const cyB = m ? mixExpr(m.from.y + m.from.w / 2, m.to.y + m.to.w / 2, e) : '0.5';
  const terms = punchesOf(cut).map((q) => `if(gte(on,${q.frame})*lt(on,${q.frame + PUNCH_FRAMES}),1+${n6(q.percent / 100)}*(1-${easeExpr('inOut', `min(1,(on-${q.frame})/${PUNCH_FRAMES})`)}),1)`);
  const w = `(${wB}/(${terms.length ? terms.join('*') : '1'}))`;
  const centre = (/** @type {string} */ c) => `max(${w}/2,min(1-${w}/2,${c}))`;
  return { w, cx: centre(cxB), cy: centre(cyB), roll: m ? `${mixExpr(m.from.roll ?? 0, m.to.roll ?? 0, e)}*PI/180` : '0' };
}

/**
 * The eight expressions for ffmpeg's `perspective` filter (`eval=frame`): where in the source, for the frame being made, its output's
 * four corners are taken from. The rectangle's corners are turned by the roll about its centre, in the source pixels of a `width` by
 * `height` picture, so every frame is sampled at a fractional position. The working is kept in `st`/`ld` registers: 0 the width, 1 and
 * 2 the centre, 3 and 4 the roll's cosine and sine.
 * @param {Parameters<typeof cutRect>[0]} cut
 * @param {number} width
 * @param {number} height
 */
export function corners(cut, width, height) {
  const e = expressions(cut);
  const set = `st(0,${e.w});st(1,${e.cx});st(2,${e.cy});st(3,cos(${e.roll}));st(4,sin(${e.roll}))`;
  const hw = `ld(0)*${width}/2`, hh = `ld(0)*${height}/2`;
  /** @param {number} sx @param {number} sy the corner's side of the centre: -1 or 1 */
  const corner = (sx, sy) => ({
    x: `${set};ld(1)*${width}+(${sx})*${hw}*ld(3)-(${sy})*${hh}*ld(4)`,
    y: `${set};ld(2)*${height}+(${sx})*${hw}*ld(4)+(${sy})*${hh}*ld(3)`,
  });
  const tl = corner(-1, -1), tr = corner(1, -1), bl = corner(-1, 1), br = corner(1, 1);
  return { x0: tl.x, y0: tl.y, x1: tr.x, y1: tr.y, x2: bl.x, y2: bl.y, x3: br.x, y3: br.y };
}

/** True when the cut turns the view at all. @param {{ move?: Move }} cut */
export const rolls = (cut) => Boolean(cut.move && ((cut.move.from.roll ?? 0) !== 0 || (cut.move.to.roll ?? 0) !== 0));
