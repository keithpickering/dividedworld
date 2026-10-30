import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';
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

/*
 * Every way into the glass keeps the board's place, not only the HUD's Menu (keepBoardPlace,
 * engine/ui/glass/back.ts): the reply box's "Make a character", for an account with none, is a
 * plain link, and Back from where it leads still lands at the post that was in view. And the
 * place is the board the glass was last entered from: a crumb out of the glass forgets the one
 * before, so a link in from another thread never lands back on the first.
 */
type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo };

/** Signs in a new account with no characters, so the reply box offers "Make a character". */
async function signInWithNoCharacters(page: Page): Promise<void> {
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(() => {
    const w = globalThis as E2eWindow;
    w.__kbFake.signInAs(w.__kbFake.seed.account('e2e-no-characters'));
  });
}

/** Reads down to a post: it is the one at the top of the view. */
async function readTo(page: Page, seq: number) {
  const post = page.locator(`#post-${seq}`);
  await post.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect.poll(() => post.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(40);
  return post;
}

const inView = (post: Locator) => post.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });

/**
 * Follows the reply box's "Make a character" as a reader does, with it in view (the page scrolls to
 * it), and says which posts were in view as it was followed: Back should land at one of them.
 */
async function makeACharacter(page: Page): Promise<string[]> {
  const link = page.getByRole('main').getByRole('link', { name: 'Make a character' });
  await link.scrollIntoViewIfNeeded();
  const seen = await page.evaluate(() => [...document.querySelectorAll('article[id^="post-"]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })
    .map((el) => el.id));
  expect(seen.length).toBeGreaterThan(0);
  await link.click();
  return seen;
}

/** Back lands at a post that was in view when the reader left, with focus on it and it in view. */
async function backAtOneOf(page: Page, seen: readonly string[]): Promise<void> {
  await expect(page.locator('article:focus')).toHaveCount(1);
  const focused = await page.evaluate(() => document.activeElement?.id ?? '');
  expect(seen).toContain(focused);
  await expect.poll(() => inView(page.locator(`#${focused}`))).toBe(true);
}

test('Back from "Make a character" in the reply box returns to the same post in the thread', async ({ page }) => {
  await page.goto('/b/general');
  await signInWithNoCharacters(page);
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  const thread = new URL(page.url()).pathname;
  const seen = await makeACharacter(page);
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/characters/new');
  await page.getByRole('link', { name: 'Back to the board' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(thread);
  await backAtOneOf(page, seen);
});

test('Back lands on the thread the glass was last entered from, not one left by a crumb before', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Who keeps reacting with tea?' })).toBeVisible();
  await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
  /* Out of the glass by the page's own crumb, not by Back. */
  await page.locator('.kb-crumb').getByRole('link', { name: 'Index', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name: 'General', exact: true }).click();
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  const thread = new URL(page.url()).pathname;
  await signInWithNoCharacters(page);
  const seen = await makeACharacter(page);
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the board' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(thread);
  await backAtOneOf(page, seen);
});

/*
 * A thread that grew while the reader was in the glass: Back reopens it at the post the reader was
 * at, the post that came waits behind the thread's "new posts" bar, and a post edited meanwhile
 * shows as it is now. The other player's post and the edit are made on the fake while the reader
 * is in the glass, as another player and another tab would.
 */
test('Back to a thread that grew while the reader was in the glass holds the new post behind the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Pages, top' }).getByRole('link', { name: 'Page 9' }).click();
  await expect(page.locator('#post-170')).toBeAttached();
  const post = await readTo(page, 162);
  await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
  await page.evaluate(async () => {
    const { __kbFake: fake, __kbDemo: demo } = globalThis as E2eWindow;
    fake.seed.post(demo.longThread, demo.characters.spritey, 'Post 171, written while you were away.');
    /* Post 164 is Pipewrench's, the reader's own: edited from another tab. */
    const [own] = await fake.acts(demo.longThread, 164, 164);
    const edited = await fake.edit(own!.id, demo.characters.pipewrench, 'Post 164, edited while you were away.');
    if (!edited.ok) throw new Error(edited.error);
  });
  await page.getByRole('link', { name: 'Back to the board' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  await expect(post).toBeFocused();
  await expect.poll(() => inView(post)).toBe(true);
  await expect(page.locator('#post-164')).toContainText('Post 164, edited while you were away.');
  await expect(page.locator('#post-171')).toHaveCount(0);
  const bar = page.getByRole('button', { name: '1 new post', exact: true });
  await expect(bar).toBeVisible();
  await bar.click();
  await expect(page.locator('#post-171')).toContainText('Post 171, written while you were away.');
});
