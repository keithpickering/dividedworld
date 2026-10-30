/**
 * Which board's layout the glass is drawn in at a window's width, and at what scale (the glass
 * plan, section 8, amended 2026-10-30: "Board layout, scaled").
 *
 * From 1440px up the glass is the Main board's, at its own sizes, centered. Below 1440px the Main
 * board's layout keeps its arrangement and scales with the window, so every length in it, its text
 * among them, is the window's width over 1440 of the board's. That holds until the smallest text it
 * draws would fall below the smallest size the Phone board draws; from there down it is the Phone
 * board's layout, at the phone's own sizes. So the switch is worked out from the instance's size
 * tokens: 1440 times the smallest phone size over the smallest Main board size, worked out from the
 * instance's sizes and never picked by hand.
 *
 * The player's text size folds it too: past 150% the glass is the Phone board's at any width.
 *
 * Every text size the HUD and the glass pages draw at the Main board's layout is a size token or a
 * fixed size larger than the smallest token, so the smallest token is the smallest text; the
 * glass plan's closed list of tokens (section 4) is what keeps that so.
 */
import type { GlassTheme } from '../types.ts';

/** The Main board's width: the boards are drawn at it, and below it the Main board's layout scales. */
export const MAIN_BOARD_WIDTH = 1440;

export type BoardName = 'main' | 'phone';

export interface BoardLayout {
  readonly board: BoardName;
  /** The Main board's lengths at this width over their own: 1 from 1440px up and on the Phone board's layout. */
  readonly scale: number;
}

/**
 * The width from which the glass is the Main board's layout; below it, the Phone board's. A theme
 * with no phone size or no Main board size gives nothing to work it out from, and is refused rather
 * than given a width that no size says.
 */
export function boardSwitch(glass: Pick<GlassTheme, 'sizes'>): number {
  const sizes = Object.values(glass.sizes);
  const phone = sizes.filter((s) => s.phone).map((s) => s.px);
  const main = sizes.filter((s) => !s.phone).map((s) => s.px);
  if (phone.length === 0) throw new Error('The glass names no phone size, so where the Main board\'s layout becomes the Phone board\'s cannot be worked out');
  if (main.length === 0) throw new Error('The glass names no Main board size, so where the Main board\'s layout becomes the Phone board\'s cannot be worked out');
  return (MAIN_BOARD_WIDTH * Math.min(...phone)) / Math.min(...main);
}

/**
 * Past this text size, in percent, the glass is one column at any width (the glass plan, section 8:
 * "at more than 150% text size the page is one column"), and the one column is the Phone board's
 * layout, the HUD's with it, so the two still switch together.
 */
export const FOLD_ABOVE_TEXT_SIZE = 150;

/** The board's layout and its scale at a window this wide, with the player's text size in percent. */
export function boardLayout(width: number, glass: Pick<GlassTheme, 'sizes'>, textSize = 100): BoardLayout {
  if (textSize > FOLD_ABOVE_TEXT_SIZE || width < boardSwitch(glass)) return { board: 'phone', scale: 1 };
  return { board: 'main', scale: Math.min(1, width / MAIN_BOARD_WIDTH) };
}
