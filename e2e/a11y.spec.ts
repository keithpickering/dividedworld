import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

/**
 * axe-core in the real browser, over the built demo world, with the color-contrast rule jsdom
 * cannot run (engine/ui/a11y.ts says why), in the device's light and dark and at desktop and phone
 * widths. The token pairs are held separately in engine/ui/contrast.test.tsx.
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

const PAGES: readonly [string, string][] = [
  ['index', '/'], ['board', '/b/general'], ['characters', '/characters'], ['standings', '/standings'], ['settings', '/settings'], ['invites', '/invites'],
];

for (const scheme of ['light', 'dark'] as const) {
  for (const [name, width] of [['desktop', 1000], ['phone', 360]] as const) {
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
        /* The docked HUD has a fixed height, the Phone board's 124px; what it holds must fit in it, or its last row is cut at the window's foot. */
        if (!GLASS.has(path)) test(`${label}'s Game HUD holds all it shows inside its glass and the window`, async ({ page }) => {
          await page.goto(path);
          await expect(ready(page, path)).toBeVisible();
          await expect(page.locator('.kb-hud-orbs .kb-orb').first()).toBeVisible();
          /* Measured once the orbs have come and the faces have loaded: the fallback's metrics are not what a player sees. */
          const cut = await page.evaluate(async () => {
            await document.fonts.ready;
            const hud = document.querySelector('[aria-label="Game HUD"]')!;
            const glass = hud.querySelector('.kb-hud-glass') ?? hud;
            const floor = Math.min(glass.getBoundingClientRect().bottom, window.innerHeight);
            return [...hud.querySelectorAll('*')]
              .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
              .map((el) => [el.className.toString() || el.tagName, Math.round(el.getBoundingClientRect().bottom - floor)] as const)
              .filter(([, over]) => over > 0);
          });
          expect(cut).toEqual([]);
        });
      }

      test('a thread, a picker and a spin form have none', async ({ page }) => {
        await page.goto('/b/general');
        await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.locator('#post-1').getByRole('button', { name: 'Spin thread' }).click();
        await page.locator('#post-3').getByRole('button', { name: 'React' }).click();
        await expect(page.getByRole('dialog', { name: /^React as / })).toBeVisible();
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

test('the check sees low-contrast text in the browser', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'body, main, .kb-box, .kb-table { background: #fff !important; } h1, h2, td, th, a, p { color: #ccc !important; }' });
  const found = await pageViolations(page);
  expect(found.some((f) => f.startsWith('color-contrast'))).toBe(true);
});
