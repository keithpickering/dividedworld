/**
 * Where the boards' layouts meet (the glass plan, section 8, amended 2026-10-30): the Main board's
 * layout scales with the window below 1440px until its smallest text would fall below the Phone
 * board's smallest size, and there it becomes the Phone board's. The width is worked out from an
 * instance's size tokens, never picked by hand; Divided World's own is held in its ui test.
 */
import { describe, expect, test } from 'vitest';
import type { GlassTheme } from '../types.ts';
import { boardLayout, boardSwitch, MAIN_BOARD_WIDTH } from './board.ts';

const sized = (sizes: Record<string, { px: number; phone?: boolean }>) =>
  ({ sizes: Object.fromEntries(Object.entries(sizes).map(([k, s]) => [k, { family: 'F', weight: 400, ...s }])) }) as unknown as GlassTheme;

const glass = sized({ small: { px: 14 }, body: { px: 18 }, display: { px: 40 }, 'phone-small': { px: 12, phone: true }, 'phone-body': { px: 15, phone: true } });

describe('boardSwitch', () => {
  test('is the Main board\'s width times the smallest phone size over the smallest Main board size', () => {
    expect(MAIN_BOARD_WIDTH).toBe(1440);
    expect(boardSwitch(glass)).toBeCloseTo((1440 * 12) / 14, 9);
  });
  test('reads the smallest of each kind, in whatever order the theme lists them', () => {
    expect(boardSwitch(sized({ big: { px: 30 }, 'p-big': { px: 24, phone: true }, small: { px: 20 }, 'p-small': { px: 16, phone: true } }))).toBe(1152);
  });
  test('refuses a theme that has no phone size or no Main board size, which it cannot be worked out from', () => {
    expect(() => boardSwitch(sized({ body: { px: 20 } }))).toThrow(/phone/);
    expect(() => boardSwitch(sized({ 'phone-body': { px: 16, phone: true } }))).toThrow(/Main board/);
  });
});

describe('boardLayout', () => {
  const at = boardSwitch(glass);
  test('past 1440px it is the Main board\'s, unscaled', () => {
    expect(boardLayout(1920, glass)).toEqual({ board: 'main', scale: 1 });
    expect(boardLayout(1440, glass)).toEqual({ board: 'main', scale: 1 });
  });
  test('between the switch and 1440px it is the Main board\'s, scaled with the window', () => {
    expect(boardLayout(1300, glass)).toEqual({ board: 'main', scale: 1300 / 1440 });
    expect(boardLayout(at, glass)).toEqual({ board: 'main', scale: at / 1440 });
  });
  test('below the switch it is the Phone board\'s, at its own sizes', () => {
    expect(boardLayout(at - 0.5, glass)).toEqual({ board: 'phone', scale: 1 });
    expect(boardLayout(390, glass)).toEqual({ board: 'phone', scale: 1 });
  });
  test('at the switch the smallest scaled text is the smallest phone size', () => {
    expect(14 * boardLayout(at, glass).scale).toBeCloseTo(12, 9);
  });
});
