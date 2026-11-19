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
 *
 * The phone's row is the same order (`handOrder`) on one row that the player swipes sideways, with the card nearest its
 * middle read in the sheet's line. `swipePose` gives each card its lift, turn and size from its distance from that
 * middle, and `swipeMiddle` finds the card there (docs/plans/2026-11-13-phone-hand-design.md, section 3).
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

/** The group a sealed pack stands in: before every card's, so a change of group gives the first card its gap, and the packs stand first. */
export const PACK_GROUP = -1;

/** The groups of a hand's places in order: one place for each sealed pack, first, then one for each card's kind; `arcSlots` stands them all. */
export const placesOf = (sealed: number, cardGroups: readonly number[]): readonly number[] => [...Array<number>(sealed).fill(PACK_GROUP), ...cardGroups];

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
  if (n === 0) return [];
  if (n === 1) return [BOARD[1]!];
  if (n === 2) return [BOARD[0]!, BOARD[2]!];
  if (n === 3) return BOARD;
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
      const t = cards.length === 1 ? 1 : (x - first) / (LAST_X - first);
      return {
        x,
        y: -260 + 10 * t - ARC_BOW * Math.sin(Math.PI * t) - ROW_RISE * row,
        deg: TURN_FROM + (TURN_TO - TURN_FROM) * t,
        row,
      };
    });
  });
}

/** The swipe step: the distance between two neighbors in the phone's row, and so the unit of a card's place in it. */
export const SWIPE_STEP = 66;
/** Degrees a card turns for each step it stands from the middle, up to SWIPE_TURN_MAX. */
export const SWIPE_TURN = 6;
export const SWIPE_TURN_MAX = 18;
/** Pixels a card drops for each step squared, up to SWIPE_DROP_MAX. */
export const SWIPE_DROP = 5;
export const SWIPE_DROP_MAX = 40;
/** How far the middle card lifts, in pixels, and how much bigger it stands. */
export const SWIPE_LIFT = 14;
export const SWIPE_SCALE = 0.18;
/**
 * How far, in pixels, every other card stands pushed out from the middle card, and how many steps out the push is whole. The
 * middle card stands above the rest, so as the middle passes from one card to its neighbor the two change which is above: pushed
 * out, the two stand apart for a stretch around that moment (a fifth of a step either side), and the change shows nothing,
 * where at 66px apart they would overlap by half a card and the new middle would pop over the old one. At rest the middle card
 * still covers each neighbor's edge, so the row reads as a hand.
 */
export const SWIPE_SPREAD = 40;
export const SWIPE_SPREAD_REACH = 0.7;
/** How many steps out the pose stops changing: the turn and the drop reach their caps, the lift is gone and the push is whole. */
export const SWIPE_REACH = Math.max(SWIPE_TURN_MAX / SWIPE_TURN, Math.sqrt(SWIPE_DROP_MAX / SWIPE_DROP), 1, SWIPE_SPREAD_REACH);

/**
 * The pose of one card in the phone's swiped row, from its signed distance `d` from the row's middle, in steps: the
 * card's center's x less the middle's x, over SWIPE_STEP. The card in the middle stands up by SWIPE_LIFT and grows by
 * SWIPE_SCALE; each step away it turns and drops further, up to the caps, and at a distance of a whole step or more it
 * stands at its own size. Every card but the middle one is pushed out from it by up to SWIPE_SPREAD (`x`), easing in over
 * SWIPE_SPREAD_REACH steps so a card passing through the middle moves without a jolt.
 */
export function swipePose(d: number): { readonly x: number; readonly y: number; readonly deg: number; readonly scale: number } {
  const w = Math.max(0, 1 - Math.abs(d));
  const deg = Math.min(Math.max(SWIPE_TURN * d, -SWIPE_TURN_MAX), SWIPE_TURN_MAX);
  const y = Math.min(SWIPE_DROP * d * d, SWIPE_DROP_MAX) * (1 - w) - SWIPE_LIFT * w;
  const scale = 1 + SWIPE_SCALE * w;
  const x = SWIPE_SPREAD * Math.sin((Math.PI / 2) * Math.min(Math.max(d / SWIPE_SPREAD_REACH, -1), 1));
  return { x, y, deg, scale };
}

/** The keyframes' stops per step: enough that the drop's curve, drawn as straight pieces between them, is off by under half a pixel. */
const STOPS_PER_STEP = 10;

/**
 * The swipe pose as keyframes over a card's passage through the row's middle, for a view timeline on the row (Hand.tsx): offset 0 is
 * the card SWIPE_REACH steps right of the middle, offset 1 the same distance left, as the row scrolls it across, and each stop is
 * `swipePose` at its distance. Beyond them the pose holds (the animation fills both ways), as `swipePose` does. A stop stands at
 * each whole step, where the lift and the turn have their corners.
 */
export function swipeKeyframes(): { readonly offset: number; readonly translate: string; readonly rotate: string; readonly scale: string }[] {
  const n = 2 * SWIPE_REACH * STOPS_PER_STEP;
  return Array.from({ length: n + 1 }, (_, k) => {
    const offset = k / n;
    const { x, y, deg, scale } = swipePose(SWIPE_REACH - 2 * SWIPE_REACH * offset);
    return { offset, translate: `${x}px ${y}px`, rotate: `${deg}deg`, scale: String(scale) };
  });
}

/** The index of the center nearest `middle`, the lower index on a tie; -1 when there are no centers. */
export function swipeMiddle(centers: readonly number[], middle: number): number {
  let best = -1;
  let bestDistance = Infinity;
  centers.forEach((center, i) => {
    const distance = Math.abs(center - middle);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
