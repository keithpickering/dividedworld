import { expect, test } from '@playwright/test';
import { controlsWithoutFocusIndicator, focusedIndicator } from './focus.ts';

/* These specs inject axe and poison styles into the page; the site's policy (e2e/csp.spec.ts holds it) would block them. */
test.use({ bypassCSP: true });

const PAGES = ['/', '/b/general', '/characters', '/standings', '/settings'];
/* A glass page is ready when its menu bar is; a board page when its Game HUD is. */
const GLASS = new Set(['/characters', '/settings']);

for (const path of PAGES) {
  test(`${path}: every control Tab reaches shows a focus indicator`, async ({ page }) => {
    await page.goto(path);
    await expect(GLASS.has(path) ? page.getByRole('navigation', { name: 'Menu' }) : page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
    expect(await controlsWithoutFocusIndicator(page)).toEqual([]);
  });
}

test('a thread with its reply box: every stop shows a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeVisible();
  expect(await controlsWithoutFocusIndicator(page)).toEqual([]);
});

test('the reaction picker: every kind the arrows reach shows a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  /* Opened by keyboard, as the picker's own focus is only drawn for a keyboard user. */
  await page.locator('#post-3').getByRole('button', { name: 'React' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^React as / })).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    const f = await focusedIndicator(page);
    expect(f?.visible, f?.name).toBe(true);
    seen.add(f!.name);
    await page.keyboard.press(i % 4 === 3 ? 'ArrowDown' : 'ArrowRight');
  }
  expect(seen.size).toBeGreaterThan(3);
});

test('the spin form: its fields show a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await page.locator('#post-1').getByRole('button', { name: 'Spin thread' }).click();
  await expect(page.getByLabel('Thread title')).toBeFocused();
  expect((await focusedIndicator(page))?.visible).toBe(true);
});

/* The poisons: the same check, on pages where a control's outline is taken away, finds that control and no other. */
test('the check finds a link with outline: none, and only that link', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a[href="/b/the-system"] { outline: none !important; box-shadow: none !important; }' });
  const bare = await controlsWithoutFocusIndicator(page);
  expect(bare).toHaveLength(1);
  expect(bare[0]).toContain('The System');
});

test('the check finds an outline that is transparent or the color of the page', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a[href="/b/the-system"] { outline-color: transparent !important; } .kb-nav a[href="/"] { outline-color: rgb(255, 255, 255) !important; }' });
  const bare = await controlsWithoutFocusIndicator(page);
  expect(bare.some((b) => b.includes('The System'))).toBe(true);
  expect(bare.some((b) => b.includes('Index'))).toBe(true);
});

test('the check does not count a box-shadow the control always has', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await page.addStyleTag({ content: 'a[href="/b/the-system"] { outline: none !important; box-shadow: 0 0 0 2px red !important; }' });
  const bare = await controlsWithoutFocusIndicator(page);
  expect(bare.some((b) => b.includes('The System'))).toBe(true);
});

test('Tab cycles back to the start on a page, and the check throws when it cannot', async ({ page }) => {
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await expect(controlsWithoutFocusIndicator(page, 3)).rejects.toThrow(/never came round/u);
});

/* Going back from the glass (the web plan's glass amendment to Task 3): the board's route and the post that was in view. */
for (const how of ['Back', 'Esc'] as const) {
  test(`${how} from a glass page returns to the same post in the thread`, async ({ page }) => {
    await page.goto('/b/general');
    await page.getByRole('link', { name: 'The long one', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
    const thread = new URL(page.url()).pathname;
    /* Read down to a post past the first screen: it is the one at the top of the view. */
    const post = page.locator('#post-6');
    await post.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect.poll(() => post.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(40);
    await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/characters');
    if (how === 'Back') await page.getByRole('link', { name: 'Back to the board' }).click();
    else await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(thread);
    await expect(post).toBeFocused();
    await expect.poll(() => post.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })).toBe(true);
  });
}
