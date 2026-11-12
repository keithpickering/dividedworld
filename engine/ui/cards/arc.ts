/**
 * The order and the places of the hand's cards on the Main board's arc (docs/plans/2026-11-12-hand-arc-design.md,
 * section 2). This file is arithmetic only: `Hand` draws what it says and owns the buttons, the keys and the lift.
 *
 * One card stands for each kind held, however many copies. The kinds are grouped by how they are played, Moves
 * (`cast`) first, then Reversals (`set`), then Gimmicks (`use`), then everything else and any card the instance no
 * longer has, so a player finds a card by what it does; inside a group the instance's own order of faces holds. A
 * little more room between groups shows where one ends, with no label to read.
 *
 * The arc is the board's three cards (150 by 225, at -11, -1 and 10 degrees) stretched: with one, two or three kinds
 * the slots are the board's own exactly, so a small hand looks as it always did. From four on the cards stand on a
 * bowed line that ends where the board's last card stands, each one a step left of the next, and turn from
 * TURN_FROM to TURN_TO along it. A step never exceeds ARC_STEP, and shrinks so the row fits ARC_SPAN. Where a row's
 * step would fall under ARC_FLOOR (cards too thin to tell apart), the hand takes more rows, each ROW_RISE above the
 * one in front, up to MAX_ROWS; only at MAX_ROWS may the step fall under the floor, since a hand must always fit.
 */
import type { HeldCard } from '../data/api.ts';
import type { CardFace } from './faces.ts';

/** The arc's width, a card included. */
export const ARC_SPAN = 1150;
/** The widest step between two neighboring cards. */
export const ARC_STEP = 66;
/** The narrowest step a row is given while another row can be added. */
export const ARC_FLOOR = 40;
/** How far each row stands above the one in front of it. */
export const ROW_RISE = 120;
export const MAX_ROWS = 4;
/** The extra room where a row's group changes, in steps. */
export const GROUP_GAP = 0.5;
/** How high the middle of a row bows above its ends. */
export const ARC_BOW = 40;
/** How far the first and the last card of a row turn, in degrees. */
export const TURN_FROM = -14;
export const TURN_TO = 10;
/** A card's width; the arc's span includes it. */
export const CARD_WIDTH = 150;

/** The x the last card of a row stands at: the board's third slot. */
const LAST_X = 72;

export interface ArcCard {
  readonly face: CardFace;
  readonly held: number;
  /** The index of the card's group among the groups present: 0 for the first that is not empty. */
  readonly group: number;
}

export interface ArcSlot {
  readonly x: number;
  readonly y: number;
  readonly deg: number;
  readonly row: number;
}

/** The order of the groups; a face's rank is its index, and every other play and an `unknown` face share the last. */
const GROUPS: readonly string[] = ['cast', 'set', 'use'];
const rankOf = (face: CardFace): number => {
  const i = face.unknown ? -1 : GROUPS.indexOf(face.play);
  return i < 0 ? GROUPS.length : i;
};

/** The cards to draw for what is held: one for each kind with a copy in hand, grouped, in the order of `faces` within a group. */
export function handOrder(held: readonly HeldCard[], faces: readonly CardFace[]): readonly ArcCard[] {
  const kept = faces.flatMap((face) => {
    const n = held.find((h) => h.card === face.key)?.held ?? 0;
    return n > 0 ? [{ face, held: n, rank: rankOf(face) }] : [];
  });
  const ranks = [...new Set(kept.map((k) => k.rank))].sort((a, b) => a - b);
  return ranks.flatMap((rank, group) => kept.filter((k) => k.rank === rank).map(({ face, held: n }): ArcCard => ({ face, held: n, group })));
}

/** The board's three slots, which one to three kinds use. */
const BOARD: readonly ArcSlot[] = [
  { x: -60, y: -260, deg: -11, row: 0 },
  { x: 10, y: -260, deg: -1, row: 0 },
  { x: 72, y: -250, deg: 10, row: 0 },
];

/** The units a row's cards span: the steps between them, and a half step more at each change of group. */
const unitsOf = (groups: readonly number[]): number =>
  groups.length - 1 + GROUP_GAP * groups.filter((g, i) => i > 0 && g !== groups[i - 1]).length;

const stepOf = (groups: readonly number[]): number => Math.min(ARC_STEP, (ARC_SPAN - CARD_WIDTH) / unitsOf(groups));

/** Splits cards in order into `rows` rows as evenly as possible; the front row, then the next, take the extra cards. */
function split(groups: readonly number[], rows: number): readonly (readonly number[])[] {
  const base = Math.floor(groups.length / rows);
  const extra = groups.length % rows;
  let at = 0;
  return Array.from({ length: rows }, (_, r) => {
    const size = base + (r < extra ? 1 : 0);
    const row = groups.slice(at, at + size);
    at += size;
    return row;
  });
}

/** Where each card of a hand stands against the hand button, given each card's group in order. */
export function arcSlots(groups: readonly number[]): readonly ArcSlot[] {
  const n = groups.length;
  if (n === 1) return [BOARD[1]!];
  if (n === 2) return [BOARD[0]!, BOARD[2]!];
  if (n === 3) return BOARD;
  if (n === 0) return [];
  let rows = 1;
  // Every row is held to the floor, not only the front one: a back row with a card fewer can carry more group changes,
  // and so more units and a narrower step.
  while (rows < MAX_ROWS && split(groups, rows).some((row) => stepOf(row) < ARC_FLOOR)) rows += 1;
  return split(groups, rows).flatMap((cards, row) => {
    const step = stepOf(cards);
    // Distance of each card from the row's last, in steps, counting the gap where the group changes.
    const back: number[] = Array(cards.length).fill(0);
    for (let i = cards.length - 2; i >= 0; i -= 1) back[i] = back[i + 1]! + 1 + (cards[i] !== cards[i + 1] ? GROUP_GAP : 0);
    const first = LAST_X - back[0]! * step;
    return cards.map((_, i): ArcSlot => {
      const x = LAST_X - back[i]! * step;
      // A row of one card has no length to stand along; it stands at the last card's place, t = 1.
      const t = LAST_X === first ? 1 : (x - first) / (LAST_X - first);
      return {
        x,
        y: -260 + 10 * t - ARC_BOW * Math.sin(Math.PI * t) - ROW_RISE * row,
        deg: TURN_FROM + (TURN_TO - TURN_FROM) * t,
        row,
      };
    });
  });
}
