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
import { boardLayout, boardSwitch, FOLD_ABOVE_TEXT_SIZE, MAIN_BOARD_WIDTH } from './board.ts';

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
  test('above 150% text it is the Phone board\'s at any width, and at 150% or less the width decides', () => {
    expect(FOLD_ABOVE_TEXT_SIZE).toBe(150);
    expect(boardLayout(1920, glass, 200)).toEqual({ board: 'phone', scale: 1 });
    expect(boardLayout(1280, glass, 200)).toEqual({ board: 'phone', scale: 1 });
    expect(boardLayout(1920, glass, 150)).toEqual({ board: 'main', scale: 1 });
    expect(boardLayout(1300, glass, 125)).toEqual({ board: 'main', scale: 1300 / 1440 });
    expect(boardLayout(390, glass, 100)).toEqual({ board: 'phone', scale: 1 });
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
 * written as a number of px, in `font-size` or in the `font` shorthand. It skips a rule every
 * selector of which is the Phone board's (the `:where(:root[data-kb-layout='phone'])` prefix), which
 * is drawn unscaled at the phone's own sizes.
 * A rule inside an at-rule (a media query, a @supports) is read like any other.
 *
 * A size in rem is read as its px at the root's 16px, the size it draws at 100% text.
 *
 * What it does not see: a size given through a variable (`var(--kb-glass-size-label)`, which is a
 * token, or anything else) or a calc(), a size in any unit but px and rem, and a size set from
 * script or inline. Those are kept honest by the glass plan's closed list of tokens (section 4), not
 * here.
 *
 * The same sheets are read for a second claim, the text size's (the web plan's glass amendment to
 * Task 11): the player's text size is the root's font size, so a size follows it only when it is in
 * rem or a glass size token (rem, apply.ts). No sheet the glass is drawn from writes a font size in
 * px, the phone's rules included, or that size would stay put at 200% while the rest grew.
 *
 * The floor is the smallest Main board size of the test world's glass (engine/ui/test-world.tsx:
 * its `label`, 20px), which is also the smallest of Divided World's.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(here, '..');

/*
 * The folders under engine/ui/ whose stylesheets draw the glass (the glass itself, the frame's HUD
 * and hand, the orbs, and each glass page and overlay), and the folders that draw the 2003 board.
 * Every sheet in a glass folder is read, so a sheet added there is read without being listed; and
 * every folder that holds a sheet is one or the other, so a new folder is a failure until it is
 * named here.
 */
const GLASS_FOLDERS = ['glass', 'frame', 'orbs', 'account', 'characters', 'profile-edit', 'rankings', 'log', 'reactions', 'cards', 'vending'];
const BOARD_FOLDERS = ['bbcode', 'board', 'composer', 'index', 'postbit', 'profile', 'reveal', 'spin', 'standings', 'thread'];
const sheetsIn = (folder: string) => fs.readdirSync(path.join(UI, folder)).filter((f) => f.endsWith('.css')).map((f) => path.join(UI, folder, f));
const SHEETS = GLASS_FOLDERS.flatMap(sheetsIn);
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

/** The font sizes a rule's declarations write as numbers, in px or rem, each with its unit. */
function writtenSizes(body: string): { n: number; unit: 'px' | 'rem' }[] {
  const sizes: { n: number; unit: 'px' | 'rem' }[] = [];
  for (const m of body.matchAll(/(?:^|;)\s*font-size\s*:\s*([\d.]+)(px|rem)\b/g)) sizes.push({ n: Number(m[1]), unit: m[2] as 'px' | 'rem' });
  for (const m of body.matchAll(/(?:^|;)\s*font\s*:\s*([^;]*)/g)) {
    const size = /([\d.]+)(px|rem)\b/.exec(m[1]!.split('/')[0]!);
    if (size) sizes.push({ n: Number(size[1]), unit: size[2] as 'px' | 'rem' });
  }
  return sizes;
}

/** The font sizes a rule writes as numbers, in px at 100% text (a rem at the root's 16px). */
function pxSizes(body: string): number[] {
  return writtenSizes(body).map((s) => (s.unit === 'rem' ? s.n * 16 : s.n));
}

/** Every font size the sheets write in px, which the player's text size would not move; `read` gives each sheet's text. */
function sizesInPx(read: (sheet: string) => string = (sheet) => fs.readFileSync(sheet, 'utf8')): string[] {
  const found: string[] = [];
  for (const sheet of SHEETS) {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const { selectors, body } of styleRules(css)) {
      for (const w of writtenSizes(body)) if (w.unit === 'px') found.push(`${path.basename(sheet)}: ${selectors.join(', ')} { font-size: ${w.n}px }`);
    }
  }
  return found;
}

function smallFixedSizes(floor: number): string[] {
  const found: string[] = [];
  for (const sheet of SHEETS) {
    const css = fs.readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const { selectors, body } of styleRules(css)) {
      if (selectors.every((s) => s.startsWith(PHONE))) continue;
      for (const px of pxSizes(body)) if (px < floor) found.push(`${path.basename(sheet)}: ${selectors.join(', ')} { font-size: ${px}px }`);
    }
  }
  return found;
}

describe('the smallest text on the scaled layout', () => {
  const floor = Math.min(...Object.values(testGlass.sizes).filter((s) => !s.phone).map((s) => s.px));
  test('the floor is the test world\'s smallest Main board size, and the sheets it reads are there', () => {
    expect(floor).toBe(20);
    expect(SHEETS.map((s) => path.basename(s))).toEqual(expect.arrayContaining(['frame.css', 'shell.css', 'base.css', 'calm.css', 'contrast.css', 'orbs.css', 'orbs-board.css', 'rankings.css', 'log.css', 'settlement.css', 'characters.css', 'profile-edit.css', 'reactions.css', 'reactions-board.css', 'account.css', 'cards.css']));
  });
  test('every folder under engine/ui/ that holds a stylesheet is named as the glass\'s or the board\'s', () => {
    const folders = fs.readdirSync(UI, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      .filter((d) => fs.readdirSync(path.join(UI, d)).some((f) => f.endsWith('.css')));
    expect(folders.filter((d) => !GLASS_FOLDERS.includes(d) && !BOARD_FOLDERS.includes(d))).toEqual([]);
    expect(GLASS_FOLDERS.filter((d) => BOARD_FOLDERS.includes(d))).toEqual([]);
  });
  test('reads a phone rule\'s fixed size and passes it, and reads a Main rule\'s, in px or rem', () => {
    const rules = styleRules(`${PHONE} .a, ${PHONE} .b { font-size: 18px; } .c { color: red; font: bold 14px / 1.2 F; } @media (x) { .d { font-size: 0.75rem } }`);
    expect(rules.map((r) => r.selectors.every((s) => s.startsWith(PHONE)))).toEqual([true, false, false]);
    expect(rules.map((r) => pxSizes(r.body))).toEqual([[18], [14], [12]]);
    expect(rules.map((r) => writtenSizes(r.body).map((w) => w.unit))).toEqual([['px'], ['px'], ['rem']]);
  });
  test('no fixed font size in px on the Main board\'s layout is below the smallest Main board token', () => {
    expect(smallFixedSizes(floor)).toEqual([]);
  });
});

describe('the text size', () => {
  test('no font size in the glass\'s sheets is written in px, so every one follows the player\'s text size', () => {
    expect(sizesInPx()).toEqual([]);
  });
  test('finds a px font size planted in a real glass sheet, in the Main board\'s rules and the phone\'s alike', () => {
    const sheet = path.join(UI, 'account', 'account.css');
    const planted = (css: string) => css
      .replace('.kb-acct-title {\n', '.kb-acct-title {\n  font-size: 112px;\n')
      .replace(":where(:root[data-kb-layout='phone']) .kb-acct-value {\n", ":where(:root[data-kb-layout='phone']) .kb-acct-value {\n  font: 700 20px/1.1 sans-serif;\n");
    const found = sizesInPx((s) => (s === sheet ? planted(fs.readFileSync(s, 'utf8')) : fs.readFileSync(s, 'utf8')));
    expect(found).toEqual([
      'account.css: .kb-acct-title { font-size: 112px }',
      "account.css: :where(:root[data-kb-layout='phone']) .kb-acct-value { font-size: 20px }",
    ]);
  });
});
