/**
 * Gear, trophies and Random Events as instance content, and the pure rules over them (the cosmetics design,
 * docs/plans/2026-11-04-cosmetics-design.md). The engine names no instance's gear: an instance hands these in.
 */
import type { Rarity } from './cards.ts';
import type { CosmeticsSettings } from './types.ts';

export type { CosmeticsSettings };

/** A piece of gear an instance offers. Its art is the instance's UI (`InstanceUi.gear`). */
export interface GearRules { readonly key: string; readonly name: string; readonly line: string; readonly rarity: Rarity }

/** A trophy kind the instance's code defines. Admin-made kinds live in the database only. */
export interface TrophyRules { readonly key: string; readonly name: string; readonly line?: string; readonly belt?: true }

export interface TrophyCatalog {
  readonly kinds: readonly TrophyRules[];
  /** The trophy for first, second and third place at a season's end, by key. */
  readonly seasonPlaces: readonly [string, string, string];
  /** The kinds the Boss may give with AWARD_TROPHY (belts included). */
  readonly boss: readonly string[];
  /** The kind every counted character gets when a move's demand is met. */
  readonly demandMet: string;
}

/** A line a Random Event can say. `{item}` is replaced by the found item's name. */
export interface EventLine { readonly key: string; readonly outcome: 'line' | 'gear' | 'card'; readonly text: string }

/** The views an item may ship, in the dress-up page's Facing row order. */
export const GEAR_VIEWS = ['side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right'] as const;
export type GearView = (typeof GEAR_VIEWS)[number];

/**
 * A piece as worn: fractions of the portrait. `x` and `y` place the item's pivot (x of the portrait's width, y of its height), `w` is
 * the width of the item's default view (of the portrait's width), `turn` rotates about the pivot, and `view` is one of the item's views
 * (null is its default).
 */
export interface Piece { readonly gear: string; readonly x: number; readonly y: number; readonly w: number; readonly turn: number; readonly layer: number; readonly view: GearView | null }

/** One view's picture, in its own pixels, and where the pivot lands in it. */
export interface GearViewShape { readonly width: number; readonly height: number; readonly pivot: { readonly x: number; readonly y: number } }
/** What an item's art says about its geometry: its default view and the views it ships. */
export interface GearShape { readonly default: GearView; readonly views: Readonly<Partial<Record<GearView, GearViewShape>>> }

/** The view drawn: `view` when the item ships it, else the item's default. */
export function shownView(item: GearShape, view: GearView | null): GearView {
  return view !== null && item.views[view] !== undefined ? view : item.default;
}

/**
 * A piece's shape in the view shown: `w` its width as a fraction of the portrait's (the item's one scale, so a view is drawn at its own
 * width in proportion to the default's), `aspect` its height over its width, `px` and `py` the pivot as fractions of the picture.
 */
export function pieceShape(piece: Piece, item: GearShape): { w: number; aspect: number; px: number; py: number } {
  const shown = item.views[shownView(item, piece.view)] ?? item.views[item.default];
  const base = item.views[item.default];
  /* The throw marks a broken art catalog: an item must ship the view its own default names, so this is a defect to fix there, not a case to render around. */
  if (shown === undefined || base === undefined) throw new Error(`gear has no ${item.default} view`);
  return { w: (piece.w * shown.width) / base.width, aspect: shown.height / shown.width, px: shown.pivot.x / shown.width, py: shown.pivot.y / shown.height };
}

type Shape = ReturnType<typeof pieceShape>;

/** The unturned picture's edges relative to the pivot, in units of the box's width: left, right, top and bottom offsets. */
function offsets(shape: Shape): { l: number; r: number; t: number; b: number } {
  return { l: -shape.px * shape.w, r: (1 - shape.px) * shape.w, t: -shape.py * shape.w * shape.aspect, b: (1 - shape.py) * shape.w * shape.aspect };
}

/** The picture's four corners relative to the pivot, in units of the box's width, before any turn. */
function corners(shape: Shape): [number, number][] {
  const { l, r, t, b } = offsets(shape);
  return [[l, t], [r, t], [r, b], [l, b]];
}

/**
 * The turned picture's bounds in units of the box's width, where the box is 1 wide and `height` tall (the portrait's tallness, or 1 for
 * the square) and the pivot sits at `(piece.x, piece.y * height)`. The four corners turn by `piece.turn` about the pivot (clockwise,
 * y down, as CSS rotates).
 */
export function pieceExtent(piece: Piece, shape: Shape, height: number): { left: number; right: number; top: number; bottom: number } {
  const rad = (piece.turn * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = piece.x, cy = piece.y * height;
  const xs: number[] = [], ys: number[] = [];
  for (const [dx, dy] of corners(shape)) { xs.push(cx + dx * cos - dy * sin); ys.push(cy + dx * sin + dy * cos); }
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Whether the point (`qx`, `qy`, in `pieceExtent`'s units) lies in the turned picture: turned back about the pivot, it falls in the unturned rectangle. */
export function pieceHolds(piece: Piece, shape: Shape, height: number, qx: number, qy: number): boolean {
  const rad = (-piece.turn * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = qx - piece.x, dy = qy - piece.y * height;
  const ux = dx * cos - dy * sin, uy = dx * sin + dy * cos;
  const { l, r, t, b } = offsets(shape);
  return ux >= l && ux <= r && uy >= t && uy <= b;
}

/** A frame as fractions of the picture it is cut from; the shape of `engine/ui/profile-edit/frames.ts`'s, restated so the rules import no screen. */
export interface SquareFrame { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** A standing or reversed award of a belt: who got it, when (ISO text), and whether a reversal has undone it. */
export interface BeltAward { readonly character: string; readonly at: string; readonly reversed?: boolean }

/** The pieces a character may wear: the widest a piece may be, as a fraction of the portrait's width. */
export const PIECE_WIDTH = { least: 0.05, most: 1.5 } as const;
/** A piece's turn, in degrees either way. */
export const PIECE_TURN_MOST = 180;

/** The name of the first predicate a piece fails (`x`, `y`, `w`, `turn`, `view` or `layer`), or null when it is whole. */
export function pieceProblem(piece: Piece, settings: CosmeticsSettings): string | null {
  const within = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (!within(piece.x, 0, 1)) return 'x';
  if (!within(piece.y, 0, 1)) return 'y';
  if (!within(piece.w, PIECE_WIDTH.least, PIECE_WIDTH.most)) return 'w';
  if (!within(piece.turn, -PIECE_TURN_MOST, PIECE_TURN_MOST)) return 'turn';
  if (piece.view !== null && !(GEAR_VIEWS as readonly unknown[]).includes(piece.view)) return 'view';
  if (!Number.isInteger(piece.layer) || !within(piece.layer, 0, settings.gear.wornMost - 1)) return 'layer';
  return null;
}

/**
 * What is wrong with an outfit, each problem naming its gear where it has one. `held` is the copies of each gear the account
 * holds and `wornElsewhere` the copies worn on its other characters; a gear is worn here at most as many times as that leaves free.
 */
export function outfitProblems(
  pieces: readonly Piece[],
  held: Readonly<Record<string, number>>,
  wornElsewhere: Readonly<Record<string, number>>,
  settings: CosmeticsSettings,
): string[] {
  const out: string[] = [];
  const most = settings.gear.wornMost;
  if (pieces.length > most) out.push(`${pieces.length} pieces are worn; at most ${most}`);
  const layers = new Map<number, string>();
  for (const p of pieces) {
    const first = layers.get(p.layer);
    if (first !== undefined) out.push(`"${p.gear}" shares layer ${p.layer} with "${first}"`);
    else layers.set(p.layer, p.gear);
  }
  const here = new Map<string, number>();
  for (const p of pieces) here.set(p.gear, (here.get(p.gear) ?? 0) + 1);
  for (const [gear, n] of here) {
    const free = Math.max(0, (held[gear] ?? 0) - (wornElsewhere[gear] ?? 0));
    if (n > free) out.push(`"${gear}" is worn ${n} time${n === 1 ? '' : 's'} here, and ${free} ${free === 1 ? 'copy is' : 'copies are'} free`);
  }
  return out;
}

/** The piece's place in the square's own coordinates, where the square is cut from the portrait at `square` (fractions of the portrait); the rest of the piece is kept. */
export function inSquare(piece: Piece, square: SquareFrame): Piece {
  return { ...piece, x: (piece.x - square.x) / square.w, y: (piece.y - square.y) / square.h, w: piece.w / square.w };
}

/**
 * How far above the top of a tall slot its highest piece's turned box stands, in units of the slot's width, never below 0. The slot is 1
 * wide and `tallness ?? 2` tall (the portrait's own shape, null where unknown); a piece's pivot sits at `(x, y * height)` and its picture
 * is turned about the pivot (`pieceExtent`), so the overhang is `max(0, -top)` over the pieces. A piece whose art `shapeOf` does not know
 * is skipped, as `Outfit` skips it. The result is capped at `reach` (`settings.cosmetics.gear.reach`), where the layer's own clip cuts a
 * piece, so nothing stands higher than that.
 */
export function outfitOverhang(
  pieces: readonly Piece[],
  shapeOf: (piece: Piece) => ReturnType<typeof pieceShape> | undefined,
  tallness: number | null,
  reach: number,
): number {
  const height = tallness ?? 2;
  let over = 0;
  for (const p of pieces) {
    const shape = shapeOf(p);
    if (shape === undefined) continue;
    over = Math.max(over, -pieceExtent(p, shape, height).top);
  }
  return Math.min(over, reach);
}

/**
 * The character who holds a belt now: the award with the latest instant not reversed, or null when none stands. Instants are compared as
 * instants (`Date.parse`), never as strings, since `Z`, `+00:00` and fractional seconds spell one moment several ways; an award whose
 * `at` does not parse is skipped. An exact tie goes to the larger `character` id, since the order awards arrive in (from SQL) is not
 * fixed and the holder must not depend on it.
 */
export function beltHolder(awards: readonly BeltAward[]): string | null {
  let best: { character: string; t: number } | null = null;
  for (const a of awards) {
    if (a.reversed) continue;
    const t = Date.parse(a.at);
    if (Number.isNaN(t)) continue;
    if (best === null || t > best.t || (t === best.t && a.character > best.character)) best = { character: a.character, t };
  }
  return best?.character ?? null;
}
