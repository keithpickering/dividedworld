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

/** A piece as worn: fractions of the portrait (center x of its width, center y of its height, width of its width). */
export interface Piece { readonly gear: string; readonly x: number; readonly y: number; readonly w: number; readonly turn: number; readonly layer: number }

/** A frame as fractions of the picture it is cut from; the shape of `engine/ui/profile-edit/frames.ts`'s, restated so the rules import no screen. */
export interface SquareFrame { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** A standing or reversed award of a belt: who got it, when (ISO text), and whether a reversal has undone it. */
export interface BeltAward { readonly character: string; readonly at: string; readonly reversed?: boolean }

/** The pieces a character may wear: the widest a piece may be, as a fraction of the portrait's width. */
export const PIECE_WIDTH = { least: 0.05, most: 1.5 } as const;
/** A piece's turn, in degrees either way. */
export const PIECE_TURN_MOST = 180;

/** The name of the first predicate a piece fails (`x`, `y`, `w`, `turn` or `layer`), or null when it is whole. */
export function pieceProblem(piece: Piece, settings: CosmeticsSettings): string | null {
  const within = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (!within(piece.x, 0, 1)) return 'x';
  if (!within(piece.y, 0, 1)) return 'y';
  if (!within(piece.w, PIECE_WIDTH.least, PIECE_WIDTH.most)) return 'w';
  if (!within(piece.turn, -PIECE_TURN_MOST, PIECE_TURN_MOST)) return 'turn';
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
