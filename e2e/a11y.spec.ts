import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import { boardSwitch, MAIN_BOARD_WIDTH } from '../engine/ui/glass/board.ts';
import type { Demo } from '../web/src/demo.ts';

/**
 * axe-core in the real browser, over the built demo world, with the color-contrast rule jsdom
 * cannot run (engine/ui/a11y.ts says why), in the device's light and dark, on the Phone board's
 * layout wide and narrow and on the Main board's just above the switch. The token pairs are held
 * separately in engine/ui/contrast.test.tsx.
 */
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Found { readonly id: string; readonly impact: string | null; readonly nodes: readonly { readonly target: unknown; readonly html: string }[] }

export async function pageViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  const found = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: Found[] }> } }).axe;
    return (await axe.run(document, { runOnly: { type: 'tag', values: tags } })).violations;
  }, TAGS);
  return found.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 12).map((n) => `${JSON.stringify(n.target)} ${n.html.slice(0, 100)}`).join(' | ')}`);
}

/* These specs inject axe and poison styles into the page; the site's policy (e2e/csp.spec.ts holds it) would block them. */
test.use({ bypassCSP: true });

/* A glass page is ready when its menu bar is; a board page when its Game HUD is. */
const GLASS = new Set(['/characters', '/characters/new', '/characters/edit', '/settings', '/invites', '/sign-in', '/register']);
const ready = (page: import('@playwright/test').Page, path: string) => (GLASS.has(path)
  ? page.getByRole('navigation', { name: 'Menu' })
  : page.getByRole('region', { name: 'Game HUD' }));

type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo };

/**
 * What the Game HUD shows that runs past its glass or the window, by class, side and pixels over:
 * what it holds must fit, or its last row is cut at the window's foot or a figure at its edge. Each
 * box is held below by the glass's foot or the window's, whichever is higher, and each side by the
 * glass's edge or the window's, whichever is nearer. Measured once the faces have loaded, since the
 * fallback's metrics are not what a player sees. The smoke is drawn wider than the glass on purpose
 * and clipped to it (engine/ui/glass/Smoke.tsx), and the seam runs on past the window's edge (its
 * points end at x = 10000, engine/ui/frame/Hud.tsx), so neither is read.
 */
async function hudCut(page: Page): Promise<(readonly [string, string, number])[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const hud = document.querySelector('[aria-label="Game HUD"]')!;
    const glass = (hud.querySelector('.kb-hud-glass') ?? hud).getBoundingClientRect();
    const floor = Math.min(glass.bottom, window.innerHeight);
    const right = Math.min(glass.right, window.innerWidth);
    const left = Math.max(glass.left, 0);
    return [...hud.querySelectorAll('*')]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.kb-smoke, .kb-hud-seam'))
      .flatMap((el) => {
        const box = el.getBoundingClientRect();
        const name = el.getAttribute('class') ?? el.tagName;
        return ([['bottom', box.bottom - floor], ['right', box.right - right], ['left', left - box.left]] as const)
          .map(([side, over]) => [name, side, Math.round(over)] as const);
      })
      .filter(([, , over]) => over > 0);
  });
}

/*
 * Where the Main board's layout becomes the Phone board's, worked out from Divided World's size
 * tokens (engine/ui/glass/board.ts), and a window just either side of it.
 */
const SWITCH = boardSwitch(JSON.parse(readFileSync(new URL('../instances/divided-world/ui/glass.json', import.meta.url), 'utf8')));
const ABOVE_SWITCH = SWITCH + 8;
const BELOW_SWITCH = SWITCH - 8;

const PAGES: readonly [string, string][] = [
  ['index', '/'], ['board', '/b/general'], ['characters', '/characters'], ['standings', '/standings'], ['settings', '/settings'], ['invites', '/invites'],
];

for (const scheme of ['light', 'dark'] as const) {
  for (const [name, width] of [['phone layout, wide', 1000], ['Main board layout, just above the switch', ABOVE_SWITCH], ['phone layout, narrow', 360]] as const) {
    test.describe(`${scheme}, ${name}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      for (const [label, path] of PAGES) {
        test(`${label} has no axe violation, color contrast included`, async ({ page }) => {
          await page.goto(path);
          await expect(ready(page, path)).toBeVisible();
          expect(await pageViolations(page)).toEqual([]);
        });
        test(`${label} does not scroll sideways`, async ({ page }) => {
          await page.goto(path);
          await expect(ready(page, path)).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        });
        if (!GLASS.has(path)) test(`${label}'s Game HUD holds all it shows inside its glass and the window`, async ({ page }) => {
          await page.goto(path);
          await expect(ready(page, path)).toBeVisible();
          await expect(page.locator('.kb-hud-orbs .kb-orb').first()).toBeVisible();
          expect(await hudCut(page)).toEqual([]);
        });
      }

      /* The longest the HUD's wallet gets: a full wallet with an estimate on top, and the part past the cap, which the Phone board does not draw. */
      test('the Game HUD holds a wallet past its cap inside its glass and the window', async ({ page }) => {
        await page.goto('/b/general');
        await expect(ready(page, '/b/general')).toBeVisible();
        await page.waitForFunction(() => '__kbFake' in globalThis);
        await page.evaluate(() => {
          const w = globalThis as E2eWindow;
          /* A full wallet: the demo's estimate then lies wholly past the cap. */
          w.__kbFake.seed.wallet(w.__kbDemo.me, 600);
          /* The HUD reads the wallet when the account changes: out, and once the HUD has seen that, back in. */
          w.__kbFake.signInAs(null);
        });
        await expect(page.locator('.kb-hud-orbs')).toHaveCount(0);
        await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.signInAs(w.__kbDemo.me); });
        await expect(page.locator('.kb-hud-orbs .kb-orbs-over')).toHaveText(/^\+\d\.\d\d past the cap$/);
        expect(await hudCut(page)).toEqual([]);
        expect(await pageViolations(page)).toEqual([]);
      });

      test('a thread, a picker and a spin form have none', async ({ page }) => {
        await page.goto('/b/general');
        await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.locator('#post-1').getByRole('button', { name: 'Spin thread' }).click();
        await page.locator('#post-3').getByRole('button', { name: 'React' }).click();
        await expect(page.getByRole('dialog', { name: /^React to / })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
      });

      test('a profile and its record have none, reached through a character link', async ({ page }) => {
        await page.goto('/standings');
        await page.getByRole('link', { name: 'Pipewrench' }).click();
        await expect(page.getByRole('region', { name: 'About Pipewrench' })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
        await page.getByRole('link', { name: 'See the full record' }).click();
        await expect(page.getByRole('table')).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
      });

      test('the new-character page has none', async ({ page }) => {
        await page.goto('/characters/new');
        await expect(page.getByRole('heading', { level: 1, name: 'New character' })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
      });

      test('the Turn, Reveal and Debut dialogs have none', async ({ page }) => {
        await page.goto('/characters');
        await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
        await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: "Reveal Pipewrench's class" }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
        await page.keyboard.press('Escape');
        /* A new character waits to debut: its two debut dialogs. */
        await page.goto('/characters/new');
        await page.getByLabel(/name/iu).first().fill('Waiting Wanda');
        await page.getByRole('radio').first().check();
        await page.getByRole('button', { name: 'Make the character' }).click();
        await page.getByRole('button', { name: 'Drop Waiting Wanda now' }).click();
        await expect(page.getByRole('dialog', { name: 'Drop Waiting Wanda now' })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Change how Waiting Wanda debuts' }).click();
        await expect(page.getByRole('dialog', { name: 'How Waiting Wanda debuts' })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
      });

      test('signed out: sign-in and register have none', async ({ page }) => {
        /* The demo world starts signed in and starts over on a load, so sign out in the app and go on from there. */
        await page.goto('/settings');
        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
        await page.getByRole('link', { name: 'Sign in' }).first().click();
        await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
        await page.evaluate(() => { history.pushState(null, '', '/register?invite=ab12cd34'); window.dispatchEvent(new PopStateEvent('popstate')); });
        await expect(page.getByRole('heading', { level: 1, name: /register|create|join/iu })).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
      });
    });
  }
}

test.describe('between the boards\' widths', () => {
  test(`the switch is worked out from the size tokens: 1440 × 16 / 20 = ${SWITCH}px`, () => {
    expect(SWITCH).toBe(1152);
  });

  for (const width of [MAIN_BOARD_WIDTH, ABOVE_SWITCH]) {
    const scale = width / MAIN_BOARD_WIDTH;
    test(`at ${width}px the HUD is the Main board's, its three groups drawn at ${width}/1440 of their size`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/b/general');
      await expect(ready(page, '/b/general')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Swap mask' })).toBeVisible();
      const got = await page.evaluate(async () => {
        await document.fonts.ready;
        const width = (selector: string) => {
          const el = document.querySelector<HTMLElement>(selector)!;
          /* The plate is skewed; its width is the panel's own, upright. */
          const was = el.style.transform;
          el.style.transform = 'none';
          const w = el.getBoundingClientRect().width;
          el.style.transform = was;
          return w;
        };
        return { board: document.documentElement.dataset.kbLayout, plate: width('.kb-hud-plate'), aura: width('.kb-hud-aura'), side: width('.kb-hud-side') };
      });
      expect(got.board).toBe('main');
      expect(got.plate).toBeCloseTo(420 * scale, 0);
      expect(got.aura).toBeCloseTo(452 * scale, 0);
      expect(got.side).toBeCloseTo(426 * scale, 0);
      expect(await hudCut(page)).toEqual([]);
    });
  }

  test(`at ${BELOW_SWITCH}px the HUD is the Phone board's, at the phone's sizes`, async ({ page }) => {
    await page.setViewportSize({ width: BELOW_SWITCH, height: 900 });
    await page.goto('/b/general');
    await expect(ready(page, '/b/general')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Posting as' })).toBeVisible();
    await expect(page.locator('.kb-hud-key')).toBeHidden();
    const got = await page.evaluate(() => ({
      board: document.documentElement.dataset.kbLayout,
      scale: document.documentElement.style.getPropertyValue('--kb-board-scale'),
      glass: document.querySelector('.kb-hud-glass')!.getBoundingClientRect().height,
      label: getComputedStyle(document.querySelector('.kb-hud-swap')!).fontSize,
    }));
    expect(got).toEqual({ board: 'phone', scale: '1', glass: expect.any(Number), label: '16px' });
    expect(got.glass).toBeGreaterThanOrEqual(124);
  });

  for (const [width, board] of [[ABOVE_SWITCH, 'main'], [BELOW_SWITCH, 'phone']] as const) {
    test(`at ${width}px a glass page's menu bar is the ${board === 'main' ? 'Main board\'s, scaled' : 'Phone board\'s'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings');
      await expect(ready(page, '/settings')).toBeVisible();
      const got = await page.evaluate(async () => {
        await document.fonts.ready;
        const back = document.querySelector('.kb-glass-menu-back')!.getBoundingClientRect();
        const tabs = document.querySelector('.kb-glass-menu-list')!.getBoundingClientRect();
        const key = document.querySelector('.kb-glass-menu-key')!.getClientRects().length > 0;
        return { board: document.documentElement.dataset.kbLayout, tabsUnderBack: tabs.top >= back.bottom, key, backHeight: back.height };
      });
      if (board === 'main') {
        expect(got).toMatchObject({ board, tabsUnderBack: false, key: true });
        expect(got.backHeight).toBeCloseTo(48 * (width / MAIN_BOARD_WIDTH), 0);
      } else {
        expect(got).toMatchObject({ board, tabsUnderBack: true, key: false, backHeight: 48 });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  /*
   * The menu bar and the content column are drawn at the board's scale; the board's own content
   * panel, until Part 2, keeps the board's sizes and undoes the column's zoom (shell.css), so its
   * effective zoom is 1 while the menu bar's is the scale.
   */
  test(`at ${ABOVE_SWITCH}px a glass page's content panel undoes the column's zoom, and the menu bar keeps it`, async ({ page }) => {
    await page.setViewportSize({ width: ABOVE_SWITCH, height: 900 });
    await page.goto('/settings');
    await expect(ready(page, '/settings')).toBeVisible();
    const got = await page.evaluate(() => ({
      layout: document.documentElement.dataset.kbLayout,
      menu: document.querySelector('.kb-glass-menu')!.currentCSSZoom,
      column: document.querySelector('.kb-glass-content')!.currentCSSZoom,
      panel: document.querySelector('.kb-glass-content-panel')!.currentCSSZoom,
    }));
    expect(got.layout).toBe('main');
    expect(got.menu).toBeCloseTo(ABOVE_SWITCH / MAIN_BOARD_WIDTH, 3);
    expect(got.column).toBeCloseTo(ABOVE_SWITCH / MAIN_BOARD_WIDTH, 3);
    expect(got.panel).toBeCloseTo(1, 3);
  });
});

test('the check sees low-contrast text in the browser', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'body, main, .kb-box, .kb-table { background: #fff !important; } h1, h2, td, th, a, p { color: #ccc !important; }' });
  const found = await pageViolations(page);
  expect(found.some((f) => f.startsWith('color-contrast'))).toBe(true);
});
