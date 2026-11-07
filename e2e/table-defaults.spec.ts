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
