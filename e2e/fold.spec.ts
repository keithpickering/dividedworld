import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { settled } from './settled.ts';

/**
 * Below the Fold as a browser draws it (docs/plans/2026-11-11-below-the-fold-plan.md, Task 4): the folded post is the bar and none of
 * its words, a press shows them, Tab reaches the bar and Enter opens it, axe finds nothing on the folded and the open post on either
 * board, and at a phone's width the bar is at least 44px tall. The post is the Below the Fold board's (post #41 of the boards fixture,
 * instances/divided-world/ui/below-the-fold/Fold.board.stories.tsx); the story route renders no play function, so each test presses the
 * bar itself.
 */
test.use({ bypassCSP: true });

const STORY = (name: string) => `/?fixture=boards&story=boards-20-below-the-fold--${name}`;
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const bar = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) post$/u }).first();
const body = (page: Page) => page.locator('.dw-fold-body').first();

/** Opens a story and waits for its first fold. */
async function open(page: Page, name: string) {
  await page.goto(STORY(name));
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page, { loops: true });
}

/** A run of the post's own words, which the folded post must not show. */
const words = async (page: Page): Promise<string> => ((await body(page).evaluate((el) => el.textContent ?? '')).trim().slice(0, 24));

/** axe's violations over the whole page, contrast included; none when the page is right. */
async function violations(page: Page): Promise<string[]> {
  await page.addStyleTag({ content: '.kb-smoke-layers { display: none !important; }' });
  await page.evaluate(axeSource);
  const found = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[] }> } }).axe;
    return (await axe.run(document, { runOnly: { type: 'tag', values: tags } })).violations;
  }, TAGS);
  /* The page's own scroll is the viewport's, as e2e/a11y.spec.ts lets go. */
  return found
    .map((v) => ({ ...v, nodes: v.id === 'scrollable-region-focusable' ? v.nodes.filter((n) => !(Array.isArray(n.target) && n.target.length === 1 && (n.target[0] === 'body' || n.target[0] === 'html'))) : v.nodes }))
    .filter((v) => v.nodes.length > 0)
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 8).map((n) => JSON.stringify(n.target)).join(' | ')}`);
}

test('a folded post shows the bar and none of its words, and a press shows them', async ({ page }) => {
  await open(page, 'folded-light');
  await expect(bar(page)).toHaveText(/Show post/u);
  await expect(bar(page)).toHaveAttribute('aria-expanded', 'false');
  const said = await words(page);
  expect(said.length).toBeGreaterThan(5);
  await expect(body(page)).toBeHidden();
  await expect(page.getByText(said).first()).toBeHidden();
  await bar(page).click();
  await expect(bar(page)).toHaveText(/Hide post/u);
  await expect(bar(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(said).first()).toBeVisible();
  await bar(page).click();
  await expect(body(page)).toBeHidden();
});

test('Tab reaches the bar and Enter opens it', async ({ page }) => {
  await open(page, 'folded-light');
  await page.keyboard.press('Tab');
  for (let i = 0; i < 80; i++) {
    if (await bar(page).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(bar(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(body(page)).toBeVisible();
});

for (const mode of ['light', 'dark'] as const) {
  test(`axe finds nothing on the folded post or the open one, on the ${mode} board`, async ({ page }) => {
    await open(page, `folded-${mode}`);
    expect(await violations(page)).toEqual([]);
    await bar(page).click();
    await expect(body(page)).toBeVisible();
    await settled(page, { loops: true });
    expect(await violations(page)).toEqual([]);
  });
}

test.describe('at a phone\'s width', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  test('the bar is at least 44px tall', async ({ page }) => {
    await open(page, 'folded-light');
    const box = await bar(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
