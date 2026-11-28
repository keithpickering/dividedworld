/**
 * The front door's marks, as the cards write them: the page describes a few hand-drawn marks (an arrow, a ring, a pair of question marks,
 * a heart, a scribble, a wash across a band) and this file turns each into the stroke formats Graffiti and Whoops! already keep, so the
 * page draws them with the cards' own surfaces and nothing is a picture. Every shape wobbles by a fixed seed, so the same call gives the
 * same hand-drawn line for every visitor, and never a different one on a reload.
 *
 * - **A shape** returns strokes, each a list of `[across, down]` points in its group's own units, from the group's center (docs/plans/2026-11-27-graffiti-everywhere-design.md,
 *   section 2): ems for a mark on words, image widths for a mark on an image, one unit across and down, so no shape needs an aspect. Its sizes are
 *   in those units too, and its wobble is a share of its own size. Every shape takes an optional last `seed` (default 1); two calls with the same
 *   arguments and seed return the same points, to a ten-thousandth.
 * - **`onImage`** and **`onWords`** make one mark: the shapes' strokes in one can and cap, over image `n` of the post (at a point in the image's shares,
 *   `em` ems to an image width) or over a run of its visible text (`at`, `len`, and a `[dx, dy]` offset in ems). The post's own facts (its version, its body, where the
 *   image sits in the box) are given once, to **`drawOver`**, which makes the groups and the draw `{ box, groups }` Graffiti keeps: the image's `src` and
 *   `nth` are read from the body and never typed, and a mark on an image or words the post does not have throws.
 * - **`washPasses`** makes the saved state of a Whoops! layer: wash strokes, each a back-and-forth pass across a band of the box, packed as
 *   the card packs them.
 */
import type { Attachment } from '../../../../engine/rules/anchor.ts';
import { contentOf } from '../../../../engine/rules/anchor.ts';
import { absolutePictures, CHECK_ORIGIN, writtenSrc } from '../../../../engine/ui/front-door/pictures.ts';
import type { Can, Cap } from '../../cards/graffiti.ts';
import { BOUNDS } from '../../cards/graffiti.ts';
import type { SavedStroke } from '../../cards/whoops.ts';
import { STROKES } from '../../cards/whoops.ts';
import { packStroke } from '../../cards/whoops/points.ts';
import { mulberry32 } from '../../cards/whoops/splat.ts';

export type Pt = [number, number];
export type Shape = Pt[][];
export type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/** A point kept to a ten-thousandth, as the card keeps image widths. */
const pt = (x: number, y: number): Pt => [Math.round(x * 10_000) / 10_000, Math.round(y * 10_000) / 10_000];
/** A seeded jitter in [-amount, amount]. */
const jitter = (r: () => number, amount: number) => (r() - 0.5) * 2 * amount;

/** A line from one point to another, as `steps` + 1 points with a small wobble across it. */
function line(r: () => number, [ax, ay]: Pt, [bx, by]: Pt, steps: number, wobble: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, edge = i === 0 || i === steps ? 0.4 : 1;
    out.push(pt(ax + (bx - ax) * t + jitter(r, wobble) * edge, ay + (by - ay) * t + jitter(r, wobble) * edge));
  }
  return out;
}

/** An arrow from one point to another: the shaft, then two barbs at the head, three strokes. The barbs are a fifth of the shaft's length. */
export function arrow(from: Pt, to: Pt, seed = 1): Shape {
  const r = mulberry32(seed);
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(dx, dy) || 1, back = Math.atan2(dy, dx) + Math.PI, barb = len * 0.2;
  const wing = (turn: number): Pt[] => {
    const a = back + turn + jitter(r, 0.12);
    return line(r, to, [to[0] + Math.cos(a) * barb, to[1] + Math.sin(a) * barb], 4, len * 0.004);
  };
  return [line(r, from, to, 14, len * 0.012), wing(0.5), wing(-0.5)];
}

/** One loop around a center, drawn the way a hand does it: it starts, goes all the way around, overshoots its start, and drifts a little off true. */
export function ring(center: Pt, rx: number, ry: number, seed = 1): Shape {
  const r = mulberry32(seed);
  const start = r() * Math.PI * 2, drift = 0.08 + r() * 0.06, sweep = Math.PI * 2 + 0.55, steps = 48;
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = start + sweep * t, k = 1 + drift * t - 0.03 + jitter(r, 0.015);
    points.push(pt(center[0] + Math.cos(a) * rx * k, center[1] + Math.sin(a) * ry * k));
  }
  return [points];
}

/**
 * Marks written out: each `?` is a hook and a dot, about `size` tall, `at` the top left of the first. Other characters are spaces. Each `?` is drawn as a hand
 * draws it, not stamped: its own height, lean and curl, sitting a little off the line.
 */
export function glyphs(text: string, at: Pt, size: number, seed = 1): Shape {
  const r = mulberry32(seed);
  const out: Shape = [];
  let left = at[0];
  [...text].forEach((ch) => {
    const s = size * (0.85 + r() * 0.3), lean = (r() - 0.5) * 0.35, curl = 1.5 + r() * 0.15, drop = (r() - 0.5) * size * 0.12;
    const w = s * 0.55;
    if (ch === '?') {
      const [x, y] = [left, at[1] + drop];
      /* A point given as (across, down) from the glyph's top left, leaned about its middle. */
      const at2 = (u: number, v: number): Pt => pt(x + u + (v - s / 2) * lean, y + v);
      const hook: Pt[] = [];
      for (let k = 0; k <= 14; k++) {
        const a = Math.PI * (1.05 - curl * (k / 14));
        hook.push(at2(w / 2 + Math.cos(a) * w * 0.48 + jitter(r, s * 0.015), w * 0.5 - Math.sin(a) * w * 0.5 + jitter(r, s * 0.015)));
      }
      hook.push(at2(w / 2 + jitter(r, s * 0.03), s * 0.66));
      const dx = w / 2 + jitter(r, s * 0.04);
      out.push(hook, [at2(dx, s * 0.9), at2(dx + s * 0.02 + jitter(r, s * 0.01), s * 0.92)]);
    }
    left += s * 0.8;
  });
  return out;
}

/** A heart, `size` tall about, as one stroke from its cleft around and back. */
export function heart(center: Pt, size: number, seed = 1): Shape {
  const r = mulberry32(seed);
  const points: Pt[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push(pt(center[0] + (x / 29) * size + jitter(r, size * 0.01), center[1] - (y / 29) * size + jitter(r, size * 0.01)));
  }
  return [points];
}

/** A tight zigzag filling a box, as one stroke, back and forth down it. */
export function scribble(box: Box, seed = 1): Shape {
  const r = mulberry32(seed);
  const [w, h] = [box.x1 - box.x0, box.y1 - box.y0];
  const rows = Math.max(3, Math.round(h / (w * 0.03))), pitch = h / rows, points: Pt[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = box.y0 + pitch * i, left = i % 2 === 0;
    points.push(pt((left ? box.x0 : box.x1) + jitter(r, w * 0.013), y + jitter(r, pitch * 0.15)));
    points.push(pt((left ? box.x1 : box.x0) + jitter(r, w * 0.013), y + pitch * 0.4 + jitter(r, pitch * 0.15)));
  }
  return [points];
}

/** One mark: shapes in one can and cap, over image `n` at a point in its shares (`em` ems to an image width), or over a run of the post's visible text. */
export type Mark =
  | { readonly kind: 'image'; readonly n: number; readonly spot: Pt; readonly em: number; readonly can: Can; readonly cap: Cap; readonly shapes: readonly Shape[] }
  | { readonly kind: 'words'; readonly at: number; readonly len: number; readonly d: Pt; readonly can: Can; readonly cap: Cap; readonly shapes: readonly Shape[] };

/** A mark over image `n` of its post, its center at `[x, y]` in the image's shares across and down; the shapes' points are in image widths from that center. */
export const onImage = (n: number, [x, y]: Pt, em: number, can: Can, cap: Cap, ...shapes: Shape[]): Mark => ({ kind: 'image', n, spot: [x, y], em, can, cap, shapes });

/** A mark over the post's visible text from `at` for `len` characters, its center `[dx, dy]` ems from the run's left and line top; the shapes' points are in ems from that center. */
export const onWords = (at: number, len: number, [dx, dy]: Pt, can: Can, cap: Cap, ...shapes: Shape[]): Mark => ({ kind: 'words', at, len, d: [dx, dy], can, cap, shapes });

/**
 * What a post gives its marks: its `version` (the staged id of the post, the Act the marks are drawn on), its `body`, the drawer's `box` in ems, and where each
 * of its images sits in that box in ems (`images`, in the body's order) and where a run of its text starts in it (`words`, for the char index `at`). Those two
 * are the groups' fallback spots only (a screen that finds the image or the words places the mark by them instead).
 */
export type Facts = {
  readonly version: string;
  readonly body: string;
  readonly box: { readonly w: number; readonly h: number };
  readonly images: readonly { readonly left: number; readonly top: number; readonly w: number; readonly h: number }[];
  readonly words: (at: number) => Pt;
};

export type DrawnGroup = { at: Pt; anchor: Attachment; unit: 'em' | 'image'; em?: number; strokes: { can: Can; cap: Cap; points: Pt[] }[] };
export type Drawn = { box: { w: number; h: number }; groups: DrawnGroup[] };

const share = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;

/** A front-door post's visible text and images as the page draws them (a bundled picture's root-relative address made absolute): what a mark's `at` and `n` count in. */
export const postContent = (body: string) => contentOf(absolutePictures(body, CHECK_ORIGIN));

/** The draw of marks over a post, in Graffiti's shape. Held to Graffiti's bounds: a draw over them throws, and so does a mark over an image or words the post lacks. */
export function drawOver(post: Facts, ...marks: Mark[]): Drawn {
  /* The body is read as the page draws it (a bundled picture's root-relative address made absolute), and a mark names the address as the instance wrote it. */
  const { text, images } = postContent(post.body);
  const { w, h } = post.box;
  const groups = marks.map((m): DrawnGroup => {
    const strokes = m.shapes.flat().map((points) => ({ can: m.can, cap: m.cap, points }));
    if (m.kind === 'image') {
      const img = images[m.n], spot = post.images[m.n];
      if (img === undefined || spot === undefined) throw new Error(`the post has no image ${m.n}`);
      const anchor: Attachment = { kind: 'image', version: post.version, n: m.n, src: writtenSrc(img.src), nth: img.nth, x: m.spot[0], y: m.spot[1] };
      return { at: [share((spot.left + m.spot[0] * spot.w) / w), share((spot.top + m.spot[1] * spot.h) / h)], anchor, unit: 'image', em: m.em, strokes };
    }
    if (m.at < 0 || m.len < 1 || m.at + m.len > text.length) throw new Error(`the words ${m.at} to ${m.at + m.len} run past the post's ${text.length} characters of visible text`);
    const [x, y] = post.words(m.at);
    const anchor: Attachment = { kind: 'text', version: post.version, at: m.at, len: m.len, dx: m.d[0], dy: m.d[1] };
    return { at: [share((x + m.d[0]) / w), share((y + m.d[1]) / h)], anchor, unit: 'em', strokes };
  });
  const flat = groups.flatMap((g) => g.strokes);
  const total = flat.reduce((n, s) => n + s.points.length, 0);
  if (groups.length > BOUNDS.groups || flat.length > BOUNDS.strokes || total > BOUNDS.totalPoints || flat.some((s) => s.points.length > BOUNDS.points)) throw new Error('a drawing is held to Graffiti\'s bounds');
  return { box: { w, h }, groups };
}

/** A point of a wash, held to the box (0 to 1) and to a ten-thousandth. */
const held = (x: number, y: number): Pt => pt(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));

/** A band to wash: from `top` to `bottom` (shares of the box's height), across `left` to `right` (shares of its width, the whole
 * width when not given), sinking by `slant` (a share of the height) from its left end to its right, so a pass can be a messy
 * streak rather than a tidy scrub. */
export type Band = { readonly top: number; readonly bottom: number; readonly left?: number; readonly right?: number; readonly slant?: number };

/** A Whoops! layer's saved state of washing: for each band, one wash stroke that goes back and forth across the band (the whole width unless it says otherwise) and down it, at the brush's `width` (a share of the box's width). */
export function washPasses(bands: readonly Band[], o: { aspect: number; width: number; seed?: number }): { strokes: SavedStroke[] } {
  const r = mulberry32(o.seed ?? 1);
  const row = Math.max(0.01, o.width * o.aspect * 0.7);
  const strokes = bands.map((band): SavedStroke => {
    const { top, bottom } = band;
    const points: Pt[] = [];
    const rows = Math.max(1, Math.ceil((bottom - top) / row));
    for (let i = 0; i <= rows; i++) {
      const y = top + ((bottom - top) * i) / rows;
      const l = band.left ?? 0.02, rt = band.right ?? 0.98, slant = band.slant ?? 0;
      const [a, b] = i % 2 === 0 ? [l, rt] : [rt, l];
      const sink = (x: number) => slant * (x - l) / Math.max(rt - l, 0.01);
      points.push(held(a + jitter(r, 0.01), y + sink(a) + jitter(r, row * 0.15)), held(b + jitter(r, 0.01), y + sink(b) + jitter(r, row * 0.15)));
    }
    if (points.length > STROKES.points) throw new Error('a pass is held to Whoops!\'s points in a stroke');
    return packStroke({ tool: 'wash', width: o.width, aspect: o.aspect, points });
  });
  return { strokes };
}
