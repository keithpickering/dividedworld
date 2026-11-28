/**
 * Graffiti (Pepperoni, rare): a wall on a post that any character may draw on, and the post's own character may wash. Divided World's
 * instance of the engine's surface (docs/plans/2026-11-11-graffiti-design.md, sections 2, 3, 8 and 9; docs/plans/2026-11-27-graffiti-everywhere-design.md,
 * sections 1, 2, 4, 5 and 8). The engine counts each draw's own coats against `graffiti.limit` (a whole percent of its 100 x 100 grid) and holds at
 * most `surface.mostLive` live draws; this card's part is the cans, the caps, the coat numbers, the sponge and the stencils, and the shape of a draw.
 *
 * - **A drawn stroke** is `{ can, cap, points }`: the can names its color (`CANS`) and the cap its width in ems (`CAPS_EM`, the core the engine
 *   counts: the size of the post's text, so a tag is the same width beside the words on every screen). The width is never sent: whatever is sent as
 *   one is dropped. Its points are in its group's units, from the group's center.
 * - **A draw** is `{ box: { w, h }, groups }`: `box` is the drawer's box in ems (w from 5 to 200, h from 1 to 4,000), and each group is
 *   `{ at, anchor, unit, em?, strokes }`. `at` is the group's center in shares of that box. `anchor` is what the group was drawn over (an
 *   `Attachment`, docs/plans/2026-11-27-graffiti-everywhere-design.md, section 4), checked for shape only. `unit` is `em` (text and box attachments)
 *   or `image` (image attachments: points are in image widths, and `em` says how many ems one width was, from 0.5 to 400). At most 120 strokes of
 *   at most 300 points, 3,000 points in all, and 120 groups, within 64 KiB as Postgres writes it. A stencil is `{ stencil, can, spot }`, expanded
 *   here into one box-attached group at its spot's center, 12 ems across, so the server, the chatter and the screen place it the same; it is kept
 *   with its key, its can and its spot beside its box and groups.
 * - **What the engine gets** is the strokes framed in the drawer's box: each point is `at + point * scale` (1 / box.w across and 1 / box.h down for
 *   ems; em / box.w and em / box.h for image widths), placed in the box for the count only (`placementOf`: a group larger than the box is shrunk evenly, one hanging off an edge is moved in), and each width is `CAPS_EM[cap] / box.w` times the group's shrink. The payload keeps the
 *   points as drawn.
 * - **The frame is held to the post** (issue #1259): the server refuses a box taller than its post could lay out at its width, and an image group whose `em`
 *   is wider than its box (`declaredFrame`, engine/rules/frame.ts), so a declared box can never make a tag count less than it covers. A stencil's box is the card's.
 * - **A wash** is `{ cuts: { draw, group, presses }[] }`: each cut names a live draw and one of its groups, and the presses are in that group's units,
 *   at most 3,000 in all. It is framed as a draw's points are and names the draw's radius (`SPONGE_EM / 2 / box.w`) and aspect.
 * - **A stored draw or wash of the old shape** (`{ strokes }`, `{ strokes, cells }`) is read where a payload is read (the painter, `describeDraw`) and is
 *   never accepted again. A draw of that shape is washed as one group in its own shares of its box.
 * - **A Mod Bot** names `{ stencil, can, spot }` and never freehands (The System acts inside bounded choices). Its options are a
 *   configuration `validateConfig` keeps, and `staffConfigs` are valid draws of the same shape, one for each stencil, which a Mod Bot's
 *   first draw is chosen from.
 */
import { landsOn, ok, refuse, type CardRules, type Verdict } from '../../../engine/rules/cards.ts';
import type { SurfaceStroke } from '../../../engine/rules/surface.ts';
import type { Attachment } from '../../../engine/rules/anchor.ts';
import type { DrawFrame } from '../../../engine/rules/frame.ts';
import { STENCILS, STENCIL_KEYS, type StencilKey } from './graffiti/stencils.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { capital, field, who } from './seen-words.ts';

export const CANS = { black: '#111111', white: '#fafafa', red: '#e8202a', orange: '#ff7a1a', yellow: '#ffd200',
  lime: '#7ed321', green: '#16a34a', teal: '#14b8a6', cyan: '#22c7f0', blue: '#2457e6', purple: '#7c3aed',
  pink: '#ff3d9a', brown: '#8b5a2b', silver: '#b8bcc4' } as const;
/** The caps' widths in ems: today's desktop sizes at the board's 15px. */
export const CAPS_EM = { skinny: 0.4, stock: 1.07, fat: 2.67 } as const;
/** The old caps, as a share of the box's width: kept for reading stored draws. */
export const CAPS = { skinny: 0.006, stock: 0.016, fat: 0.04 } as const;
export type Can = keyof typeof CANS;
export type Cap = keyof typeof CAPS_EM;
/** The sponge's width in ems: today's 60px at 15px. */
export const SPONGE_EM = 4;
/** The old sponge's width, as a share of the box's width: kept for reading stored washes. */
export const SPONGE = 0.06;
/** How wide a stencil is drawn, in ems. */
export const STENCIL_EM = 12;
/** The paint's depth in tenths of a coat: what one stroke lays, and the most a cell holds. */
export const COATS = { line: 20, most: 40 } as const;
export const BOUNDS = { strokes: 120, points: 300, totalPoints: 3000, groups: 120, presses: 3000, mostLive: 48 } as const;
/** The box a stencil is counted in, since a Mod Bot has no screen: 988 by 700 px at 15px. */
const STENCIL_BOX = { w: 65.9, h: 46.7 } as const;
const BOX = { w: [5, 200], h: [1, 4000] } as const;
const EM_UNIT = { least: 0.5, most: 400 } as const;
/** How far a point may lie from its group's center: in ems, and in image widths. */
export const REACH = { em: 200, image: 10 } as const;
/** A payload's most, as Postgres writes it. */
const PAYLOAD_BYTES = 65_536;

const round = (digits: number) => (n: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const tenThousandth = round(4);
const isCan = (v: unknown): v is Can => typeof v === 'string' && Object.hasOwn(CANS, v);
const isCap = (v: unknown): v is Cap => typeof v === 'string' && Object.hasOwn(CAPS_EM, v);
const isStencil = (v: unknown): v is StencilKey => typeof v === 'string' && Object.hasOwn(STENCILS, v);
const isSpot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, least: number, most: number): v is number => finite(v) && v >= least && v <= most;
const whole = (v: unknown, most: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= most;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** What a stencil is, to sit in a sentence (graffiti/words.ts says the same to a player; it imports this file, so the staff's words are kept here). */
const STENCIL_NOUNS: Record<StencilKey, string> = { mustache: 'a mustache', horns: 'a pair of horns', crown: 'a crown', kilroy: 'Kilroy was here', x: 'a big X', smiley: 'a smiley face' };
const CAN_WORDS = `the cans are ${Object.keys(CANS).join(', ')}`;

type Points = [number, number][];
type Unit = 'em' | 'image';
type Stroke = { can: Can; cap: Cap; points: Points };
type Group = { at: [number, number]; anchor: Attachment; unit: Unit; em?: number; strokes: Stroke[] };
type Box = { w: number; h: number };
type Drawing = { box: Box; groups: Group[] };

/** Across and down, in shares of the drawer's box, of one unit of a group. */
const scaleOf = (box: Box, g: { unit: Unit; em?: number }): [number, number] => {
  const em = g.unit === 'image' ? g.em ?? 1 : 1;
  return [em / box.w, em / box.h];
};
/** Where a group lands in its drawer's box: scaled evenly about its `at` by `k`, then moved by `dx` and `dy`, all in shares of the box. */
export type Placement = { readonly k: number; readonly dx: number; readonly dy: number };
type Placed = { readonly at: readonly [number, number]; readonly unit: Unit; readonly em?: number; readonly strokes: readonly { readonly cap?: unknown; readonly points?: unknown }[] };
const CAPS_WIDEST = (g: Placed) => g.strokes.reduce((m, s) => Math.max(m, typeof s.cap === 'string' && Object.hasOwn(CAPS_EM, s.cap) ? CAPS_EM[s.cap as Cap] : 0), 0);
/**
 * The one transform a group is framed by, for the count and for a wash's takes, so takes line up with coats: the screen's placement steps 3 and 4
 * (docs/plans/2026-11-27-graffiti-everywhere-design.md, section 4) in the drawer's frame. The group's extent is its points' bounds plus half the
 * widest cap; where that is wider or taller than the box, the whole group (its stroke widths too) is shrunk evenly about its `at` (the point
 * `at + point * scale` is fixed when the point is the group's origin), and then it is moved to lie inside 0 to 1. The payload keeps the points as drawn.
 *
 * It also shrinks a group taller than the box, which a screen's placement (shrink only when wider) never meets: the count is in the drawer's own
 * frame, where a drawn group always fits, so only a sent group larger than the drawer's own box is shrunk, and the count cannot be dodged by sending
 * one. An honest drawer never sends such a group, so the screens' placement and this one agree on every group they both see. Screens replay a
 * wash's presses in the group's own units, not through this transform.
 */
export function placementOf(box: Box, g: Placed): Placement {
  const [sx, sy] = scaleOf(box, g);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of g.strokes) if (Array.isArray(s.points)) for (const p of s.points as unknown[]) {
    if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) continue;
    x0 = Math.min(x0, p[0] * sx); x1 = Math.max(x1, p[0] * sx); y0 = Math.min(y0, p[1] * sy); y1 = Math.max(y1, p[1] * sy);
  }
  if (x0 === Infinity) return { k: 1, dx: 0, dy: 0 };
  const hx = CAPS_WIDEST(g) / 2 / box.w, hy = CAPS_WIDEST(g) / 2 / box.h;
  const [lx, hix, ly, hiy] = [x0 - hx, x1 + hx, y0 - hy, y1 + hy];
  const k = Math.min(1, 1 / (hix - lx), 1 / (hiy - ly));
  const pull = (at: number, lo: number, hi: number) => {
    const [a, b] = [at + lo * k, at + hi * k];
    return a < 0 ? -a : b > 1 ? 1 - b : 0;
  };
  return { k, dx: pull(g.at[0], lx, hix), dy: pull(g.at[1], ly, hiy) };
}
/** A group's points in shares of the drawer's box, placed by `placementOf`: for the engine's count and a wash's takes, never the payload. */
export const framed = (box: Box, g: { at: readonly [number, number]; unit: Unit; em?: number }, t: Placement, points: readonly (readonly [number, number])[]): [number, number][] => {
  const [sx, sy] = scaleOf(box, g);
  return points.map(([x, y]) => [g.at[0] + x * sx * t.k + t.dx, g.at[1] + y * sy * t.k + t.dy]);
};
const engine = (d: Drawing): SurfaceStroke[] =>
  d.groups.flatMap((g) => {
    const t = placementOf(d.box, g);
    return g.strokes.map((s) => ({ width: (CAPS_EM[s.cap] / d.box.w) * t.k, aspect: d.box.w / d.box.h, points: framed(d.box, g, t, s.points) }));
  });

/** The bytes a payload takes as Postgres writes it (jsonb text: ', ' between elements and ': ' after keys, and nowhere inside a string). */
const jsonb = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(jsonb).join(', ')}]`;
  if (typeof v === 'object' && v !== null) return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${jsonb(x)}`).join(', ')}}`;
  return JSON.stringify(v);
};
/* UTF-8 bytes through TextEncoder, not Node's `Buffer`: this runs in the browser, which has no `Buffer`. */
const utf8 = new TextEncoder();
export const bytesOf = (payload: unknown) => utf8.encode(jsonb(payload)).length;
const plain = (s: string) => !/[\u0000-\u001f\u007f]/.test(s) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

/** An attachment's shape (the screens find it; the server checks only this), kept with its known keys. */
function attachmentOf(a: unknown, unit: Unit): Verdict<Attachment> {
  if (!record(a)) return refuse('the anchor is an attachment: a text, an image or a box');
  if (a.kind === 'box') return unit === 'em' ? ok({ kind: 'box' }) : refuse("a text or box attachment needs unit 'em'");
  if (a.kind === 'text') {
    if (unit !== 'em') return refuse("a text or box attachment needs unit 'em'");
    if (typeof a.version !== 'string' || a.version.length < 1 || a.version.length > 64 || !plain(a.version)) return refuse('a text attachment names its version, a string of 1 to 64 characters, with no control characters');
    if (!whole(a.at, 1_000_000) || !whole(a.len, 1_000_000)) return refuse('a text attachment has at and len, whole numbers of characters');
    if (!within(a.dx, -5000, 5000) || !within(a.dy, -5000, 5000)) return refuse('a text attachment has dx and dy, in ems, from -5000 to 5000');
    return ok({ kind: 'text', version: a.version, at: a.at, len: a.len, dx: round(2)(a.dx), dy: round(2)(a.dy) });
  }
  if (a.kind === 'image') {
    if (unit !== 'image') return refuse("an image attachment needs unit 'image'");
    if (typeof a.version !== 'string' || a.version.length < 1 || a.version.length > 64 || !plain(a.version)) return refuse('an image attachment names its version, a string of 1 to 64 characters, with no control characters');
    if (!whole(a.n, 10_000) || !whole(a.nth, 10_000)) return refuse('an image attachment has n and nth, whole numbers');
    if (typeof a.src !== 'string' || a.src.length < 1 || a.src.length > 2048 || !plain(a.src)) return refuse('an image attachment names its src, a string of 1 to 2048 characters, with no control characters');
    if (!within(a.x, -100, 100) || !within(a.y, -100, 100)) return refuse('an image attachment has x and y, in image shares, from -100 to 100');
    return ok({ kind: 'image', version: a.version, n: a.n, src: a.src, nth: a.nth, x: tenThousandth(a.x), y: tenThousandth(a.y) });
  }
  return refuse('the anchor is an attachment: a text, an image or a box');
}

/** Points in a group's units, checked and kept: ems to a hundredth, image widths to a ten-thousandth. */
function pointsOf(at: string, list: unknown, unit: Unit, noun = 'point'): Verdict<Points> {
  const most = REACH[unit];
  const keep = unit === 'em' ? round(2) : tenThousandth;
  const out: Points = [];
  for (const [j, p] of (list as unknown[]).entries()) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(finite)) return refuse(`${at}, ${noun} ${j + 1}: a ${noun} is two numbers, across then down`);
    if (!(within(p[0], -most, most) && within(p[1], -most, most))) return refuse(`${at}, ${noun} ${j + 1}: a ${noun} is across and down from -${most} to ${most}, in ${unit === 'em' ? 'ems' : 'image widths'} from the group's center`);
    out.push([keep(p[0] as number), keep(p[1] as number)]);
  }
  return ok(out);
}

/** A draw's box and groups, checked and kept. The bounds hold across all the groups. */
function drawingOf(input: Record<string, unknown>): Verdict<Drawing> {
  const b = input.box;
  if (!record(b)) return refuse('send the box, { w, h }, the drawer\'s box in ems');
  if (!within(b.w, BOX.w[0], BOX.w[1])) return refuse(`the box's w is from ${BOX.w[0]} to ${BOX.w[1]} ems`);
  if (!within(b.h, BOX.h[0], BOX.h[1])) return refuse(`the box's h is from ${BOX.h[0]} to ${BOX.h[1]} ems`);
  const list = input.groups;
  if (!Array.isArray(list) || list.length < 1) return refuse('send the groups, a list of at least one');
  if (list.length > BOUNDS.groups) return refuse(`at most ${BOUNDS.groups} groups`);
  const groups: Group[] = [];
  let strokes = 0, total = 0;
  for (const [g, one] of list.entries()) {
    const gat = `group ${g + 1}`;
    if (!record(one)) return refuse(`${gat}: a group is an object with at, anchor, unit and strokes`);
    const { at, unit, em } = one;
    if (!Array.isArray(at) || at.length !== 2 || !within(at[0], 0, 1) || !within(at[1], 0, 1)) return refuse(`${gat}: at is the group's center, across and down from 0 to 1, in shares of the box`);
    if (unit !== 'em' && unit !== 'image') return refuse(`${gat}: the unit is em or image`);
    const anchor = attachmentOf(one.anchor, unit);
    if (!anchor.ok) return refuse(`${gat}: ${anchor.why}`);
    if (unit === 'image' && !within(em, EM_UNIT.least, EM_UNIT.most)) return refuse(`${gat}: em is how many ems one image width was, from ${EM_UNIT.least} to ${EM_UNIT.most}`);
    const list2 = one.strokes;
    if (!Array.isArray(list2) || list2.length < 1) return refuse(`${gat}: send the strokes, a list of at least one`);
    strokes += list2.length;
    if (strokes > BOUNDS.strokes) return refuse(`at most ${BOUNDS.strokes} strokes`);
    const kept: Stroke[] = [];
    for (const [i, s] of list2.entries()) {
      const sat = `${gat}, stroke ${i + 1}`;
      if (!record(s)) return refuse(`${sat}: a stroke is an object with a can, a cap and points`);
      if (!isCan(s.can)) return refuse(`${sat}: the can is one of the cans: ${CAN_WORDS}`);
      if (!isCap(s.cap)) return refuse(`${sat}: the cap is ${Object.keys(CAPS_EM).join(', ')}`);
      if (!Array.isArray(s.points) || s.points.length < 1 || s.points.length > BOUNDS.points) return refuse(`${sat}: a stroke has 1 to ${BOUNDS.points} points`);
      total += s.points.length;
      if (total > BOUNDS.totalPoints) return refuse(`${sat}: at most ${BOUNDS.totalPoints} points in all`);
      const points = pointsOf(sat, s.points, unit);
      if (!points.ok) return points;
      kept.push({ can: s.can, cap: s.cap, points: points.value });
    }
    groups.push({ at: [tenThousandth(at[0] as number), tenThousandth(at[1] as number)], anchor: anchor.value, unit, ...(unit === 'image' ? { em: round(2)(em as number) } : {}), strokes: kept });
  }
  return ok({ box: { w: round(2)(b.w as number), h: round(2)(b.h as number) }, groups });
}

/** A stencil as one group: a box attachment at the center of its spot's cell, the stencil `STENCIL_EM` across. */
function place(key: StencilKey, can: Can, spot: number): Drawing {
  const [col, row] = [spot % 3, Math.floor(spot / 3)];
  const em = round(2);
  return {
    box: { ...STENCIL_BOX },
    groups: [{
      at: [tenThousandth((col + 0.5) / 3), tenThousandth((row + 0.5) / 3)], anchor: { kind: 'box' }, unit: 'em',
      strokes: STENCILS[key].strokes.map((s) => ({ can, cap: s.cap, points: s.points.map(([x, y]): [number, number] => [em((x - 0.5) * STENCIL_EM), em((y - 0.5) * STENCIL_EM)]) })),
    }],
  };
}

/** A stencil's named parts, checked: its key, its can and its spot. */
function named(input: unknown): Verdict<{ stencil: StencilKey; can: Can; spot: number }> {
  const { stencil, can, spot } = (typeof input === 'object' && input !== null ? input : {}) as { stencil?: unknown; can?: unknown; spot?: unknown };
  if (!isStencil(stencil)) return refuse(`choose a stencil: ${STENCIL_KEYS.join(', ')}`);
  if (!isCan(can)) return refuse(`choose a can: ${CAN_WORDS}`);
  if (!isSpot(spot)) return refuse('choose a spot, 0 to 8: the nine cells of a 3 by 3 grid over the post, left to right, top to bottom');
  return ok({ stencil, can, spot });
}

function validateDraw(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }> {
  const body = record(input) ? input : {};
  if (body.stencil !== undefined) {
    if (body.groups !== undefined || body.box !== undefined || body.strokes !== undefined) return refuse('a draw is groups or a stencil, not both');
    const n = named(input);
    if (!n.ok) return n;
    const drawing = place(n.value.stencil, n.value.can, n.value.spot);
    return ok({ strokes: engine(drawing), payload: { stencil: n.value.stencil, can: n.value.can, spot: n.value.spot, ...drawing } });
  }
  if (body.strokes !== undefined || body.groups === undefined) return refuse('send the box and the groups: a draw of strokes alone is the old shape, which is no longer drawn');
  const drawing = drawingOf(body);
  if (!drawing.ok) return drawing;
  const payload = { ...drawing.value };
  if (bytesOf(payload) > PAYLOAD_BYTES) return refuse('a draw is at most 64 KiB as it is stored');
  return ok({ strokes: engine(drawing.value), payload });
}

/**
 * The frame a kept draw declared (issue #1259): its box and each image group's `em`, which the server holds to the post (engine/rules/frame.ts). A stencil's
 * box is the card's own (`STENCIL_BOX`), never its drawer's, so a stencil has none to hold.
 */
function declaredFrame(payload: Record<string, unknown>): DrawFrame | null {
  if (payload.stencil !== undefined || !record(payload.box) || !Array.isArray(payload.groups)) return null;
  const { w, h } = payload.box;
  return {
    box: { w: Number(w), h: Number(h) },
    imageEms: (payload.groups as unknown[]).flatMap((g) => (record(g) && g.unit === 'image' ? [Number(g.em)] : [])),
  };
}

/** What a live draw gives a wash to cut: its box and its groups' frames, in the draw's own payload, whatever its shape. */
type Frame = { readonly at: readonly [number, number]; readonly unit: Unit; readonly em?: number; readonly place: Placement };
function frameOf(draw: unknown): { box: Box; radius: number; aspect: number; groups: readonly Frame[]; old: boolean } | null {
  if (!record(draw)) return null;
  if (Array.isArray(draw.groups) && record(draw.box) && finite(draw.box.w) && finite(draw.box.h) && draw.box.w > 0 && draw.box.h > 0) {
    const box = { w: draw.box.w, h: draw.box.h };
    const groups = (draw.groups as unknown[]).map((g): Frame => {
      const r = record(g) ? g : {};
      const at = Array.isArray(r.at) ? r.at : [0.5, 0.5];
      const frame = { at: [Number(at[0]), Number(at[1])] as [number, number], unit: (r.unit === 'image' ? 'image' : 'em') as Unit, ...(finite(r.em) ? { em: r.em } : {}) };
      return { ...frame, place: placementOf(box, { ...frame, strokes: Array.isArray(r.strokes) ? r.strokes.filter(record) : [] }) };
    });
    return { box, radius: SPONGE_EM / 2 / box.w, aspect: box.w / box.h, groups, old: false };
  }
  // A draw of the old shape is one group, in its own shares of its box.
  if (Array.isArray(draw.strokes)) {
    const first = record(draw.strokes[0]) ? draw.strokes[0].aspect : undefined;
    const aspect = finite(first) && first > 0 ? first : 1;
    return { box: { w: 1, h: 1 }, radius: SPONGE / 2, aspect, groups: [{ at: [0, 0], unit: 'em', place: { k: 1, dx: 0, dy: 0 } }], old: true };
  }
  return null;
}

function validateWash(input: unknown, draws: ReadonlyMap<string, unknown>): Verdict<{ readonly cuts: readonly { readonly draw: string; readonly presses: readonly (readonly [number, number])[]; readonly radius: number; readonly aspect: number }[]; readonly payload: Record<string, unknown> }> {
  const list = record(input) ? input.cuts : undefined;
  if (!Array.isArray(list) || list.length < 1) return refuse('send the cuts, a list of at least one');
  const cuts: { draw: string; presses: [number, number][]; radius: number; aspect: number }[] = [];
  const kept: { draw: string; group: number; presses: Points }[] = [];
  let total = 0;
  for (const [i, c] of list.entries()) {
    const at = `cut ${i + 1}`;
    if (!record(c) || typeof c.draw !== 'string') return refuse(`${at}: a cut is an object with a draw, a group and presses`);
    const frame = draws.has(c.draw) ? frameOf(draws.get(c.draw)) : null;
    if (frame === null) return refuse(`${at}: draw ${c.draw} is not one of the draws given`);
    if (!whole(c.group, frame.groups.length - 1) || frame.groups[c.group as number] === undefined) return refuse(`${at}: draw ${c.draw} has no group ${String(c.group)}`);
    const group = c.group as number, g = frame.groups[group]!;
    if (!Array.isArray(c.presses) || c.presses.length < 1) return refuse(`${at}: a cut has at least one press`);
    total += c.presses.length;
    if (total > BOUNDS.presses) return refuse(`${at}: at most ${BOUNDS.presses} presses in all`);
    // A draw of the old shape is cut in its own shares, 0 to 1.
    const presses = frame.old ? shares(at, c.presses) : pointsOf(at, c.presses, g.unit, 'press');
    if (!presses.ok) return presses;
    kept.push({ draw: c.draw, group, presses: presses.value });
    cuts.push({ draw: c.draw, presses: framed(frame.box, g, g.place, presses.value), radius: frame.radius, aspect: frame.aspect });
  }
  return ok({ cuts, payload: { cuts: kept } });
}

/** Presses on a draw of the old shape: shares of its box, 0 to 1, to a ten-thousandth. */
function shares(at: string, list: unknown[]): Verdict<Points> {
  const out: Points = [];
  for (const [j, p] of list.entries()) {
    if (!Array.isArray(p) || p.length !== 2 || !within(p[0], 0, 1) || !within(p[1], 0, 1)) return refuse(`${at}, press ${j + 1}: a press on a draw of the old shape is across and down from 0 to 1, in shares of the box`);
    out.push([tenThousandth(p[0] as number), tenThousandth(p[1] as number)]);
  }
  return ok(out);
}

/** What a Mod Bot names: a stencil, a can and a spot. */
export type GraffitiConfig = { readonly stencil?: never } | { readonly stencil: StencilKey; readonly can: Can; readonly spot: number };

export const graffiti: CardRules<GraffitiConfig> = {
  key: 'graffiti',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Graffiti',
  alignment: 'pepperoni',
  rarity: 'rare',
  stack: 1,
  screenReads: [{ key: 'graffiti.limit', whole: true, min: 1, max: 100 }],
  surface: { limitKey: 'graffiti.limit', mostLive: BOUNDS.mostLive, coats: COATS, validateDraw, frameOf: declaredFrame, validateWash },
  seen: (p) => {
    const stencil = field(p.config, 'stencil'), can = field(p.config, 'can');
    const mark = typeof stencil === 'string' && typeof can === 'string' ? `${STENCIL_NOUNS[stencil as StencilKey] ?? 'a drawing'} in ${can} spray paint` : null;
    const first = mark === null ? `${who(p)} turned this post into a wall, ${p.ago}: any character can spray it, and its own character can scrub it.` : `${who(p)} sprayed ${mark} across this post, ${p.ago}; any character can add to the wall, and its own character can scrub it.`;
    const covered = p.covered;
    // The wall's cover is the surface's own (a count of the 100 x 100 cells it holds), which the reader gives where it has it.
    const share = typeof covered === 'number' && Number.isFinite(covered) ? Math.min(1, Math.max(0, covered)) : null;
    return share === null || p.amountWords(share) === 'none' ? first : `${first} ${capital(p.amountWords(share))} of the wall is covered in paint.`;
  },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(graffiti, target, effects, now),
  // A player's play names nothing (the draw is the first draw); a Mod Bot's names a stencil, a can and a spot, all or none.
  validateConfig: (config): Verdict<GraffitiConfig> => {
    if (typeof config !== 'object' || config === null || !('stencil' in config || 'can' in config || 'spot' in config)) return ok({});
    return named(config);
  },
  /** One for each stencil, each a valid draw as well as a configuration. */
  staffConfigs: STENCIL_KEYS.map((stencil, i): GraffitiConfig => ({ stencil, can: (['red', 'teal', 'orange', 'purple', 'lime', 'pink'] as const)[i % 6]!, spot: [4, 1, 0, 7, 4, 2][i % 6]! })),
  staffOptions: {
    prompt: `Choose a stencil to spray on the post: ${STENCIL_KEYS.join(', ')}. Choose a can for it: ${Object.keys(CANS).join(', ')}. Choose a spot, 0 to 8: the nine cells of a 3 by 3 grid over the post, left to right and top to bottom, so 4 is the middle.`,
    schema: {
      type: 'object',
      properties: { stencil: { enum: [...STENCIL_KEYS] }, can: { enum: Object.keys(CANS) }, spot: { enum: [0, 1, 2, 3, 4, 5, 6, 7, 8] } },
      required: ['stencil', 'can', 'spot'],
      additionalProperties: false,
    },
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
