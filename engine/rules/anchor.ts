/**
 * Where a mark belongs on a post, and how that survives an edit (docs/plans/2026-11-27-graffiti-everywhere-design.md, sections 1,
 * 2, 3 and 6). Pure rules: no DOM, no vendor client, and nothing here knows which instance runs it.
 *
 * Attachment (section 1). A mark records what it was drawn over, because the box is the one thing screens do not share. A text
 * attachment is a run of the post's visible text (`visibleWalk`'s string, the one the renderer's layers and the card matchers
 * already agree on) and an offset from it in ems; an image attachment is a point in an image's own shares, which scale evenly and so
 * are exact on every screen; a box attachment is a spot as a share of the box, the last resort and the fallback. A wash belongs to
 * the ink it washes, so it needs none of this.
 *
 * Figures and groups (section 2). A figure is the strokes of one drawing whose paint touches (a letter, a ring, a "?"); it is always
 * rigid. A group is the figures that lie close: a gap between two figures' bounding boxes smaller than the taller one's height joins
 * them, followed through (a chain of close figures is one group). HELLO is one group; a ring with its arrow is one group; a ring and
 * a "??" across the post are two. The rule is a guess about what belongs together, so it is pinned by the tests against drawings that
 * must group and drawings that must not. The drawer's screen does the grouping when the drawing is tagged; the server checks only
 * bounds, so a client that sends odd groups only rearranges its own drawing.
 *
 * Empty space (section 3) is the drawer's screen's business too: a group with no word or image under its center is attached to the
 * nearest content with its offset kept. This file only stores and maps what was chosen.
 *
 * Edits (section 6). A post with a wall may be edited. A group whose run, and the MARGIN characters each side of it, lie in one
 * unchanged stretch of a character diff keeps its attachment, moved by the text added or taken before it. The comparison is by
 * position in the visible text, never by searching for the words: a word that turns up somewhere else after a rewrite means nothing.
 * Any other group falls back to its spot in the box (`null` here), and so does every text group when the diff is too large to be
 * worth computing (CAP). An image attachment holds while the same address is still there at the same place among its copies. An
 * edit never washes and never frees paint.
 *
 * The diff is Myers' O((N+M)D), run on what the two texts do not share at either end, so a typo in a long post costs the typo.
 * Time is O((N+M)D); memory is O(D^2), because each round keeps only the slice of the furthest-reaching row it can reach (2d+3
 * numbers), and D is at most CAP. Nothing here recurses: the tree walk uses an explicit stack and the diff's walk back is a loop.
 *
 * Callers pass `contentOf` the same `forged` verdict set the post is drawn with (the renderer's `BbCode` `forged` prop, as a Set), so
 * the text and the image numbering here are the ones the screen draws and its layers' offsets refer to.
 */
import { parse, type BbNode } from '../bbcode/parse.ts';
import { visibleWalk } from '../bbcode/visible.ts';

/** An image of a post: its address, and which copy of that address it is (0 for the first). */
export type Img = { src: string; nth: number };

export type Attachment =
  | { kind: 'text'; version: string; at: number; len: number; dx: number; dy: number }
  | { kind: 'image'; version: string; n: number; src: string; nth: number; x: number; y: number }
  | { kind: 'box' };

/** One stroke as grouping sees it: its points and its brush radius, in px of one frame. */
export type StrokeShape = { points: [number, number][]; r: number };

/** The most edits the diff will count before every text group falls back. */
export const CAP = 2000;
/** How many characters each side of a run must also be unchanged. */
export const MARGIN = 8;

/** The renderer's test for an image it draws as a link and not a picture (engine/ui/bbcode/render.tsx, case 'img'). Keep the two alike. */
const HTTP_IMAGE = /^http:/i;

/**
 * The post's visible text and its images in tree order (quotes included, as the renderer draws them), each with which copy of its
 * address it is. Code, a cut and anything the parser did not read as an image have none, and neither has an `http:` image: the
 * renderer draws that as a link (engine/ui/bbcode/render.tsx, case 'img', `/^http:/i`), so it is no image on the screen and is not
 * counted; `nth` counts among the drawn copies of an address. `forged` is the Acts whose real quotes read as counterfeits, passed to
 * `parse` exactly as the renderer does, so the text matches the one the screen's offsets refer to.
 */
export function contentOf(body: string, forged?: ReadonlySet<string>): { text: string; images: Img[] } {
  const nodes = parse(body, undefined, forged);
  const images: Img[] = [];
  const seen = new Map<string, number>();
  const stack: BbNode[] = [];
  const pushAll = (list: readonly BbNode[]) => { for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]!); };
  pushAll(nodes);
  while (stack.length) {
    const n = stack.pop()!;
    switch (n.type) {
      case 'img': {
        if (HTTP_IMAGE.test(n.src)) break; // drawn as a link, not a picture
        const nth = seen.get(n.src) ?? 0;
        seen.set(n.src, nth + 1);
        images.push({ src: n.src, nth });
        break;
      }
      case 'bold': case 'italic': case 'underline': case 'strike': case 'color': case 'size': case 'counterfeit': case 'spoiler': case 'ispoiler':
      case 'align': case 'sub': case 'sup': case 'font': case 'marquee': case 'glow': case 'shadow': case 'rainbow': case 'highlight':
      case 'url': case 'quote':
        pushAll(n.children);
        break;
      case 'list': {
        const flat: BbNode[] = [];
        for (const item of n.items) for (const node of item) flat.push(node);
        pushAll(flat);
        break;
      }
      default:
        break;
    }
  }
  return { text: visibleWalk(nodes).text, images };
}

/** The least distance between segment A-B and segment C-D (a point is a segment of no length). */
function segDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const pointSeg = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
    const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / l2));
    return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
  };
  // Crossing segments are at distance 0; otherwise the least is at an end of one of them.
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy), o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(pointSeg(ax, ay, cx, cy, dx, dy), pointSeg(bx, by, cx, cy, dx, dy), pointSeg(cx, cy, ax, ay, bx, by), pointSeg(dx, dy, ax, ay, bx, by));
}

const segsOf = (pts: readonly (readonly [number, number])[]): [number, number, number, number][] => {
  if (pts.length === 1) return [[pts[0]![0], pts[0]![1], pts[0]![0], pts[0]![1]]];
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]]);
  return out;
};

function finder(n: number): { find: (i: number) => number; join: (a: number, b: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const join = (a: number, b: number): void => { const x = find(a), y = find(b); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); };
  return { find, join };
}

const usable = (st: StrokeShape): boolean => st.points.length > 0 && Number.isFinite(st.r) && st.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

/**
 * Indices of strokes per group. A stroke with no points, or a point or radius that is not a finite number, has no place to group by:
 * it is filtered out of the figures and joins none, and comes back as a group of its own, so every index is in exactly one group.
 * Figures first: two strokes whose cores come within the sum of their radii (capsule to capsule,
 * segment to segment) are one figure. Then groups: two figures join when the gap between their bounding boxes (paint included) is
 * less than the taller one's height, followed through. Groups are ordered by their first stroke, and list their strokes in order.
 */
export function groupsOf(strokes: readonly StrokeShape[]): number[][] {
  const n = strokes.length;
  const ok = strokes.map(usable);
  const box = strokes.map((st) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of st.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0: x0 - st.r, y0: y0 - st.r, x1: x1 + st.r, y1: y1 + st.r };
  });
  const segs = strokes.map((st, i) => (ok[i] ? segsOf(st.points) : []));
  const fig = finder(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!ok[i] || !ok[j] || fig.find(i) === fig.find(j)) continue;
      const a = box[i]!, b = box[j]!;
      if (a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1) continue; // paint boxes apart: cores cannot touch
      const reach = strokes[i]!.r + strokes[j]!.r;
      let touch = false;
      for (const p of segs[i]!) {
        for (const q of segs[j]!) { if (segDist(p[0], p[1], p[2], p[3], q[0], q[1], q[2], q[3]) <= reach) { touch = true; break; } }
        if (touch) break;
      }
      if (touch) fig.join(i, j);
    }
  }
  const roots = [...new Set(Array.from({ length: n }, (_, i) => fig.find(i)).filter((r) => ok[r]))];
  const fb = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const r = fig.find(i), b = box[i]!, f = fb.get(r);
    fb.set(r, f ? { x0: Math.min(f.x0, b.x0), y0: Math.min(f.y0, b.y0), x1: Math.max(f.x1, b.x1), y1: Math.max(f.y1, b.y1) } : { ...b });
  }
  const grp = finder(n);
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      const a = fb.get(roots[i]!)!, b = fb.get(roots[j]!)!;
      const gap = Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
      if (gap < Math.max(a.y1 - a.y0, b.y1 - b.y0)) grp.join(roots[i]!, roots[j]!);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = grp.find(fig.find(i));
    const list = byRoot.get(r);
    if (list) list.push(i); else byRoot.set(r, [i]);
  }
  return [...byRoot.values()].sort((a, b) => a[0]! - b[0]!);
}

/** An unchanged stretch: `len` characters at `from` in the old text and at `to` in the new. */
type Same = { from: number; to: number; len: number };

/** The unchanged stretches of `a` against `b`, in order, or null when more than `CAP` edits separate them. */
function diff(a: string, b: string): Same[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)) suf++;
  const out: Same[] = [];
  if (pre > 0) out.push({ from: 0, to: 0, len: pre });
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const middle = A.length === 0 || B.length === 0 ? [] : myers(A, B);
  if (middle === null) return null;
  for (const m of middle) out.push({ from: m.from + pre, to: m.to + pre, len: m.len });
  if (suf > 0) out.push({ from: a.length - suf, to: b.length - suf, len: suf });
  // Stretches that touch in both texts are one stretch.
  const merged: Same[] = [];
  for (const s of out) {
    const last = merged.at(-1);
    if (last && last.from + last.len === s.from && last.to + last.len === s.to) last.len += s.len; else merged.push({ ...s });
  }
  return merged;
}

/**
 * Myers' greedy diff, forward, keeping what each round needs to walk back through: round d reads rows k-1 and k+1 for k in -d..d, so
 * it keeps only the slice for k in -d-1..d+1 (2d+3 numbers), O(D^2) in all. Null past `CAP`.
 */
function myers(a: string, b: string): Same[] | null {
  const N = a.length, M = b.length, max = Math.min(CAP, N + M);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2)); // k = -d-1..d+1, so row k is at k + d + 1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < N && y < M && a.charCodeAt(x) === b.charCodeAt(y)) { x++; y++; }
      v[offset + k] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
  }
  if (found < 0) return null;
  // Walk back: each round's `trace` entry is the rows before it, sliced as above.
  const same: Same[] = [];
  let x = N, y = M;
  for (let d = found; d > 0; d--) {
    const pv = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && pv[k + d]! < pv[k + d + 2]!) ? k + 1 : k - 1;
    const prevX = pv[prevK + d + 1]!, prevY = prevX - prevK;
    const midX = prevK === k + 1 ? prevX : prevX + 1; // after the one insert or delete
    if (x > midX) same.push({ from: midX, to: midX - k, len: x - midX });
    x = prevX; y = prevY;
  }
  if (x > 0) same.push({ from: 0, to: 0, len: x });
  return same.reverse();
}

/**
 * Where each attachment is on the post as it now stands, or null where it is nowhere to be found (it falls back to its box spot).
 * Text keeps its place when its run and `MARGIN` characters each side (held to the text) lie in one unchanged stretch; the
 * attachment moves with that stretch, and a run that is not wholly inside the old text is nowhere. Images keep theirs while the
 * same address is there at the same place among its copies. The two texts are compared once for all of them, and not at all when
 * none is text.
 */
export function mapPlaces(from: { text: string; images: Img[] }, to: { text: string; images: Img[] }, atts: readonly Attachment[]): (Attachment | null)[] {
  let same: Same[] | null | undefined;
  return atts.map((a) => {
    if (a.kind === 'box') return a;
    if (a.kind === 'image') {
      const n = to.images.findIndex((im) => im.src === a.src && im.nth === a.nth);
      return n < 0 ? null : { ...a, n };
    }
    if (a.at < 0 || a.len <= 0 || a.at + a.len > from.text.length) return null;
    const lo = Math.max(0, a.at - MARGIN), hi = Math.min(from.text.length, a.at + a.len + MARGIN);
    if (same === undefined) same = diff(from.text, to.text);
    if (!same) return null;
    const s = same.find((m) => m.from <= lo && hi <= m.from + m.len);
    return s ? { ...a, at: a.at + (s.to - s.from) } : null;
  });
}

/** One attachment's place (see `mapPlaces`). */
export function mapPlace(from: { text: string; images: Img[] }, to: { text: string; images: Img[] }, a: Attachment): Attachment | null {
  return mapPlaces(from, to, [a])[0]!;
}
