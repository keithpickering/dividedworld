import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

/**
 * Settings > Sound in the browser (the Laugh Track plan, Task 7): each row saves its choice to the account and keeps it across a reload, the volume
 * shows only while its sound is on, and axe finds nothing on the section or on the welcome page, which carries the same rows.
 */
test.use({ bypassCSP: true });

/* axe in the page, as e2e/a11y.spec.ts runs it (its own helper is not imported: importing a spec would run all of its tests here too), with the smoke layers hidden for the reason it gives. */
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
interface Found { readonly id: string; readonly nodes: readonly { readonly target: unknown; readonly html: string }[] }
async function pageViolations(page: Page): Promise<string[]> {
  await page.addStyleTag({ content: '.kb-smoke-layers { display: none !important; }' });
  await page.addScriptTag({ path: axePath });
  const found = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: Found[] }> } }).axe;
    return (await axe.run(document, { runOnly: { type: 'tag', values: tags } })).violations;
  }, TAGS);
  /* The body's own scroll is the viewport's (a11y.spec.ts lets it go for the same reason). */
  return found.map((v) => v.id === 'scrollable-region-focusable'
    ? { ...v, nodes: v.nodes.filter((n) => !(Array.isArray(n.target) && n.target.length === 1 && (n.target[0] === 'body' || n.target[0] === 'html'))) }
    : v).filter((v) => v.nodes.length > 0).map((v) => `${v.id}: ${v.nodes.slice(0, 8).map((n) => `${JSON.stringify(n.target)} ${n.html.slice(0, 100)}`).join(' | ')}`);
}

const ROWS = [
  { legend: 'Game sounds', volume: 'Game volume' },
  { legend: 'Interface sounds', volume: 'Interface volume' },
] as const;

const group = (page: Page, name: string) => page.getByRole('radiogroup', { name });

for (const row of ROWS) {
  test(`${row.legend} saves and reloads its choice, and ${row.volume} shows only while on`, async ({ page }) => {
    await page.goto('/settings?section=sound');
    const radios = group(page, row.legend);
    await expect(radios).toBeVisible();
    await expect(radios.getByRole('radio', { name: 'Off' })).toBeChecked();
    await expect(page.getByLabel(row.volume)).toHaveCount(0);
    await radios.getByRole('radio', { name: 'On' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('Saved to your account.')).toBeVisible();
    await expect(page.getByLabel(row.volume)).toBeVisible();
    await page.reload();
    await expect(group(page, row.legend).getByRole('radio', { name: 'On' })).toBeChecked();
    await expect(page.getByLabel(row.volume)).toBeVisible();
    await group(page, row.legend).getByRole('radio', { name: 'Off' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByLabel(row.volume)).toHaveCount(0);
    await page.reload();
    await expect(group(page, row.legend).getByRole('radio', { name: 'Off' })).toBeChecked();
  });
}

test('a volume is saved and is still there after a reload', async ({ page }) => {
  await page.goto('/settings?section=sound');
  await group(page, 'Game sounds').getByRole('radio', { name: 'On' }).focus();
  await page.keyboard.press('Space');
  const range = page.getByLabel('Game volume');
  await range.focus();
  const before = Number(await range.inputValue());
  await page.keyboard.press(before > 50 ? 'ArrowLeft' : 'ArrowRight');
  const after = Number(await range.inputValue());
  expect(after).not.toBe(before);
  /* A release is saved once the range is left (or after a short quiet); leaving it is the sure way, and the account's save follows. */
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  await page.reload();
  expect(Number(await page.getByLabel('Game volume').inputValue())).toBe(after);
});

test('axe finds nothing on Settings > Sound, off and on', async ({ page }) => {
  await page.goto('/settings?section=sound');
  await expect(page.getByRole('heading', { level: 2, name: 'Sound' })).toBeVisible();
  expect(await pageViolations(page)).toEqual([]);
  await group(page, 'Game sounds').getByRole('radio', { name: 'On' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Game volume')).toBeVisible();
  expect(await pageViolations(page)).toEqual([]);
});

test('axe finds nothing on the welcome page, which carries the sound rows', async ({ page }) => {
  await page.goto('/welcome');
  await expect(group(page, 'Game sounds')).toBeVisible();
  await expect(group(page, 'Interface sounds')).toBeVisible();
  expect(await pageViolations(page)).toEqual([]);
});
