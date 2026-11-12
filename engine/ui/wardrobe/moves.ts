/**
 * The moves the dress-up page makes on a piece, pure, in the portrait's own fractions (the cosmetics design, section 2): the keys and buttons
 * (a nudge, a size, a turn), the pointer's drags (a move, a corner's size, the round handle's turn), a piece's layer, and which piece is under
 * a point. Each result is held to what `pieceProblem` allows and rounded to ten-thousandths, so a hundred presses of a key leave no float noise
 * in what is saved.
 */
import { PIECE_TURN_MOST, PIECE_WIDTH, type Piece } from '../../rules/cosmetics.ts';

/** How far each key and button moves a piece: a fraction of the portrait, a fraction of its width, degrees. */
export const STEP = { move: 0.01, moveBig: 0.05, size: 0.05, turn: 5 } as const;

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The piece held to the bounds `pieceProblem` names, its numbers rounded. */
export function fit(p: Piece): Piece {
  return {
    ...p,
    x: round(clamp(p.x, 0, 1)), y: round(clamp(p.y, 0, 1)),
    w: round(clamp(p.w, PIECE_WIDTH.least, PIECE_WIDTH.most)),
    turn: round(clamp(p.turn, -PIECE_TURN_MOST, PIECE_TURN_MOST)),
  };
}

export const nudge = (p: Piece, dx: number, dy: number): Piece => fit({ ...p, x: p.x + dx, y: p.y + dy });
export const resized = (p: Piece, by: number): Piece => fit({ ...p, w: p.w + by });
export const turned = (p: Piece, by: number): Piece => fit({ ...p, turn: p.turn + by });

/** A drag of the piece by `dx` and `dy` pixels on a stage `width` by `height` pixels. */
export const dragged = (start: Piece, dx: number, dy: number, width: number, height: number): Piece => fit({ ...start, x: start.x + dx / width, y: start.y + dy / height });

/** A corner's drag: the piece's width scales by the pointer's distance from the piece's center now (`d`) over its distance when the drag began (`d0`). */
export const dragSized = (start: Piece, d0: number, d: number): Piece => (d0 > 0 ? fit({ ...start, w: start.w * (d / d0) }) : start);

/** The round handle's drag: the piece turns by the angle the pointer swept (degrees, `a0` to `a`), wrapped into half a turn either way. */
export function dragTurned(start: Piece, a0: number, a: number): Piece {
  const t = start.turn + (a - a0);
  return fit({ ...start, turn: ((((t + 180) % 360) + 360) % 360) - 180 });
}

/** The pieces on layers 0, 1, 2 ... in the order they stand in. */
export const renumber = (pieces: readonly Piece[]): Piece[] => pieces.map((p, layer) => ({ ...p, layer }));

/** The piece at `index` moved `by` places toward the front (1) or the back (-1): the pieces and where it is now, or null at an end. */
export function layered(pieces: readonly Piece[], index: number, by: 1 | -1): { readonly pieces: Piece[]; readonly index: number } | null {
  const to = index + by;
  if (index < 0 || index >= pieces.length || to < 0 || to >= pieces.length) return null;
  const next = [...pieces];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return { pieces: renumber(next), index: to };
}

/**
 * The topmost piece whose turned box holds the point (`px`, `py`) on a stage `width` by `height` pixels, or null. `aspectOf` is the art's height
 * over its width. The pieces are in layer order, so the search runs from the last.
 */
export function hit(pieces: readonly Piece[], aspectOf: (gear: string) => number, px: number, py: number, width: number, height: number): number | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!;
    const rad = (-p.turn * Math.PI) / 180;
    const dx = px - p.x * width;
    const dy = py - p.y * height;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const halfW = (p.w * width) / 2;
    const halfH = (p.w * width * aspectOf(p.gear)) / 2;
    if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) return i;
  }
  return null;
}
