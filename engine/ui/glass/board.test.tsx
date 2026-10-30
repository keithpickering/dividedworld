/**
 * Where the boards' layouts meet (the glass plan, section 8, amended 2026-10-30): the Main board's
 * layout scales with the window below 1440px until its smallest text would fall below the Phone
 * board's smallest size, and there it becomes the Phone board's. The width is worked out from an
 * instance's size tokens, never picked by hand; each instance's own is held in its ui test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { GlassTheme } from '../types.ts';
import { testGlass } from '../test-world.tsx';
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

/*
 * board.ts works the switch out from the size tokens on the claim that no text the scaled layout
 * draws is smaller than the smallest Main board token, so the smallest token is the smallest text
 * and reaches the smallest phone size exactly at the switch. A fixed size under that token would
 * fall below the phone's first, and the switch would be wrong. This reads the stylesheets the
 * scaled layout is drawn from (the HUD's, the glass's and the orbs') and finds every font size
 * written as a number of px, in `font-size` or in the `font` shorthand. It skips:
 *   - a rule every selector of which is the Phone board's (the `:where(:root[data-kb-layout='phone'])`
 *     prefix), which is drawn unscaled at the phone's own sizes;
 *   - a rule every selector of which is in the board's own content panel
 *     (`.kb-glass-content-panel`), which keeps the board's sizes and undoes the scale (shell.css).
 * A rule inside an at-rule (a media query, a @supports) is read like any other.
 *
 * What it does not see: a size given through a variable (`var(--kb-glass-size-label)`, which is a
 * token, or anything else) or a calc(), a size in any unit but px, and a size set from script or
 * inline. Those are kept honest by the glass plan's closed list of tokens (section 4), not here.
 *
 * The floor is the smallest Main board size of the test world's glass (engine/ui/test-world.tsx:
 * its `label`, 20px), which is also the smallest of Divided World's.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHEETS = [
  path.join(here, '../frame/frame.css'),
  ...fs.readdirSync(here).filter((f) => f.endsWith('.css')).map((f) => path.join(here, f)),
  ...fs.readdirSync(path.join(here, '../orbs')).filter((f) => f.endsWith('.css')).map((f) => path.join(here, '../orbs', f)),
  path.join(here, '../rankings/rankings.css'),
  path.join(here, '../characters/characters.css'),
  path.join(here, '../profile-edit/profile-edit.css'),
];
const PHONE = ":where(:root[data-kb-layout='phone'])";

/** Each style rule in a stylesheet, its selectors and its declarations, with the at-rules around it opened. */
function styleRules(css: string): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).replace(/^[\s;]*(@[^;{]*;[\s]*)*/, '').trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const inner = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) out.push(...styleRules(inner));
    else out.push({ selectors: prelude.split(',').map((s) => s.replace(/\s+/g, ' ').trim()), body: inner });
    i = j;
  }
  return out;
}

/** The font sizes in px a rule's declarations write as numbers. */
function pxSizes(body: string): number[] {
  const sizes: number[] = [];
  for (const m of body.matchAll(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px\b/g)) sizes.push(Number(m[1]));
  for (const m of body.matchAll(/(?:^|;)\s*font\s*:\s*([^;]*)/g)) {
    const size = /([\d.]+)px\b/.exec(m[1]!.split('/')[0]!);
    if (size) sizes.push(Number(size[1]));
  }
  return sizes;
}

function smallFixedSizes(floor: number): string[] {
  const found: string[] = [];
  for (const sheet of SHEETS) {
    const css = fs.readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const { selectors, body } of styleRules(css)) {
      if (selectors.every((s) => s.startsWith(PHONE))) continue;
      if (selectors.every((s) => s.includes('.kb-glass-content-panel'))) continue;
      for (const px of pxSizes(body)) if (px < floor) found.push(`${path.basename(sheet)}: ${selectors.join(', ')} { font-size: ${px}px }`);
    }
  }
  return found;
}

describe('the smallest text on the scaled layout', () => {
  const floor = Math.min(...Object.values(testGlass.sizes).filter((s) => !s.phone).map((s) => s.px));
  test('the floor is the test world\'s smallest Main board size, and the sheets it reads are there', () => {
    expect(floor).toBe(20);
    expect(SHEETS.map((s) => path.basename(s))).toEqual(expect.arrayContaining(['frame.css', 'shell.css', 'base.css', 'orbs.css', 'orbs-board.css', 'rankings.css', 'characters.css', 'profile-edit.css']));
  });
  test('reads a phone rule\'s fixed size and passes it, and reads a Main rule\'s', () => {
    const rules = styleRules(`${PHONE} .a, ${PHONE} .b { font-size: 18px; } .c { color: red; font: bold 14px / 1.2 F; } @media (x) { .d { font-size: 12px } }`);
    expect(rules.map((r) => r.selectors.every((s) => s.startsWith(PHONE)))).toEqual([true, false, false]);
    expect(rules.map((r) => pxSizes(r.body))).toEqual([[18], [14], [12]]);
  });
  test('no fixed font size in px on the Main board\'s layout is below the smallest Main board token', () => {
    expect(smallFixedSizes(floor)).toEqual([]);
  });
});
