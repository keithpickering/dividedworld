import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * An instance that sets none of the period skin's tokens draws the board as before (board-look plan, Tasks 1 and 3). The engine's own
 * stylesheets alone (tokens.css, base.css: no theme) are loaded in a real browser, in each mode, and a `.kb-table` is read: its edge
 * and its grid are the board's rule, every cell is the page's own background with the page's own ink, no cell has a border of its
 * own, and no band, shadow or radius is added. A guard that has been red: the poison gives the table a head band and the same read
 * names it.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'ui');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const sheet = `${read('tokens.css')}\n${read('base.css').replace(/@import[^;]*;/u, '')}`;
const MARKUP = '<table class="kb-table"><thead><tr><th>Board</th><th>Threads</th></tr></thead><tbody><tr><td>General</td><td class="kb-num">3</td></tr><tr><td>The System</td><td class="kb-num">0</td></tr></tbody></table><i id="rule" style="color:var(--kb-rule)"></i><i id="bg" style="color:var(--kb-bg)"></i><i id="fg" style="color:var(--kb-fg)"></i><i id="muted" style="color:var(--kb-muted)"></i>';

async function faults(page: import('@playwright/test').Page, extra = ''): Promise<string[]> {
  await page.setContent(`<!doctype html><style>${sheet}${extra}</style><body>${MARKUP}</body>`);
  return page.evaluate(() => {
    const color = (id: string) => getComputedStyle(document.getElementById(id)!).color;
    const [rule, bg, fg, muted] = [color('rule'), color('bg'), color('fg'), color('muted')];
    const out: string[] = [];
    const is = (what: string, got: string, want: string) => { if (got !== want) out.push(`${what} is ${got}, not ${want}`); };
    const table = getComputedStyle(document.querySelector('.kb-table')!);
    is('the table\'s ground (the grid)', table.backgroundColor, rule);
    is('the table\'s edge (the frame)', table.borderTopColor, rule);
    is('the gap between cells', table.borderSpacing, '1px');
    /* The page's scrollbar is the board's own pair (muted thumb on the page's ground), not the browser's `auto`. */
    is('the scrollbar', getComputedStyle(document.body).scrollbarColor, `${muted} ${bg}`);
    for (const cell of document.querySelectorAll('th, td')) {
      const c = getComputedStyle(cell);
      const name = `a ${cell.tagName.toLowerCase()}'s`;
      is(`${name} ground`, c.backgroundColor, bg);
      is(`${name} ink`, c.color, fg);
      is(`${name} border`, c.borderTopWidth, '0px');
      is(`${name} shadow`, c.textShadow, 'none');
    }
    return out;
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('a table under the engine\'s tokens alone is the black-and-white board', async ({ page }) => {
      expect(await faults(page)).toEqual([]);
    });
    test('poison: a head band added to the table is named', async ({ page }) => {
      const found = await faults(page, ':root{--kb-head-bg:#123456}.kb-table th{background:var(--kb-head-bg)}');
      expect(found.some((f) => f.includes('ground'))).toBe(true);
    });
  });
}

/**
 * The Chrome button under the engine's tokens alone (board-look plan, Task 4) is today's bordered box: the board's rule for an edge,
 * the page's own ground and ink, no shadow, the body's weight and spacing, no radius; a primary button is bold with its one
 * inside pixel. The decoration (shadow, bold, tracking) is the theme's, set in tokens.
 */
const BUTTONS = '<button class="kb-button" id="plain">Reply</button><button class="kb-button" data-kb-size="small" id="small">Quote</button><button class="kb-button" data-kb-primary id="primary">Send</button>';
async function buttonFaults(page: import('@playwright/test').Page, extra = ''): Promise<string[]> {
  await page.setContent(`<!doctype html><style>${sheet}${extra}</style><body>${BUTTONS}</body>`);
  return page.evaluate(() => {
    const out: string[] = [];
    const is = (what: string, got: string, want: string) => { if (got !== want) out.push(`${what} is ${got}, not ${want}`); };
    for (const id of ['plain', 'small']) {
      const c = getComputedStyle(document.getElementById(id)!);
      is(`a ${id} button's shadow`, c.boxShadow, 'none');
      is(`a ${id} button's weight`, c.fontWeight, '400');
      is(`a ${id} button's tracking`, c.letterSpacing, 'normal');
      is(`a ${id} button's radius`, c.borderTopLeftRadius, '0px');
      is(`a ${id} button's label shadow`, c.textShadow, 'none');
      is(`a ${id} button's case`, c.textTransform, 'none');
    }
    const p = getComputedStyle(document.getElementById('primary')!);
    is('a primary button\'s weight', p.fontWeight, '700');
    is('a primary button\'s label shadow', p.textShadow, 'none');
    if (!/0px 0px 0px 1px inset/u.test(p.boxShadow)) out.push(`a primary button's shadow is ${p.boxShadow}, not its one inside pixel`);
    return out;
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`button, ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test('a button under the engine\'s tokens alone is today\'s bordered box', async ({ page }) => {
      expect(await buttonFaults(page)).toEqual([]);
    });
    test('poison: a drop shadow and bold added to the button are named', async ({ page }) => {
      const found = await buttonFaults(page, '.kb-button{box-shadow:1px 2px 3px #000;font-weight:700}');
      expect(found.some((f) => f.includes('shadow'))).toBe(true);
      expect(found.some((f) => f.includes('weight'))).toBe(true);
    });
  });
}
