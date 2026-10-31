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

test('Stick Around\'s view: the post\'s scroller, the checkbox and the button each show a focus indicator', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=08-hold');
  await expect(page.getByRole('dialog', { name: 'Stick Around' })).toBeVisible({ timeout: 10_000 });
  expect(await controlsWithoutFocusIndicator(page)).toEqual([]);
});

test('the reaction picker: every kind the arrows reach shows a focus indicator', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  /* Opened by keyboard, as the picker's own focus is only drawn for a keyboard user. */
  await page.locator('#post-3').getByRole('button', { name: 'React' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^React to / })).toBeVisible();
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

test('a link out of the glass forgets the thread, and Back lands on the one the glass was last entered from', async ({ page }) => {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Who keeps reacting with tea?' })).toBeVisible();
  await page.getByRole('region', { name: 'Game HUD' }).getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
  /*
   * Out of the glass by a link that is not Back: a character's name on Rankings, which opens its
   * profile on the board. (My characters' crumb, then the Rankings tab while it stood in on the
   * board's standings, were this link until the glass build's Tasks 2.2 and 2.3.)
   */
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Rankings' }).click();
  await page.getByRole('main').getByRole('table').getByRole('link').first().click();
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu' })).toHaveCount(0);
  /*
   * The crumb forgot the thread, which entering again would overwrite anyway; a glass page opened and
   * then reloaded, with no move into the glass, reads what the tab kept, and shows it was forgotten.
   */
  await page.goto('/settings');
  await page.reload();
  const back = page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Back to the board' });
  await expect(back).toHaveAttribute('href', '/');
  await back.click();
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

/*
 * The HUD clips what it draws to the glass's own shape (frame.css), so a calm's feather never
 * darkens the board beside it. A clip cuts whatever is drawn past it, focus outlines included, so
 * each control Tab reaches in the HUD is held to this: its whole outline (its box grown by the
 * outline's offset and width) lies inside every clip above it, read from each ancestor's computed
 * clip-path (a polygon or an inset) and overflow.
 */
async function hudOutlinesCut(page: Page): Promise<string[]> {
  const cut: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const el = document.activeElement;
      const hud = document.querySelector('section[aria-label="Game HUD"]');
      if (!el || !hud || !hud.contains(el)) return null;
      const s = getComputedStyle(el);
      const grow = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
      const r = el.getBoundingClientRect();
      const box = { l: r.left - grow, t: r.top - grow, r: r.right + grow, b: r.bottom + grow };
      const mx = (box.l + box.r) / 2;
      const my = (box.t + box.b) / 2;
      const points = [[box.l, box.t], [box.r, box.t], [box.r, box.b], [box.l, box.b], [mx, box.t], [mx, box.b], [box.l, my], [box.r, my]] as const;
      /* A length in a clip: px, %, or calc(% ± px), against the clipping box's side. */
      const len = (v: string, side: number): number => {
        const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/.exec(v.trim());
        if (calc) return (+calc[1]! / 100) * side + (calc[2] === '+' ? 1 : -1) * +calc[3]!;
        return v.trim().endsWith('%') ? (parseFloat(v) / 100) * side : parseFloat(v);
      };
      const parts = (v: string) => v.split(/\s+(?![^(]*\))/).filter(Boolean);
      const inside = (x: number, y: number, a: Element): boolean => {
        const z = (a as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
        const ar = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        const lx = (x - ar.left) / z;
        const ly = (y - ar.top) / z;
        const w = ar.width / z;
        const h = ar.height / z;
        if ((cs.overflowX === 'clip' || cs.overflowX === 'hidden') && (lx < -0.5 || lx > w + 0.5)) return false;
        if ((cs.overflowY === 'clip' || cs.overflowY === 'hidden') && (ly < -0.5 || ly > h + 0.5)) return false;
        const poly = /^polygon\((.*)\)$/.exec(cs.clipPath);
        if (poly) {
          const pts = poly[1]!.split(/,(?![^(]*\))/).map((p) => { const [px, py] = parts(p); return [len(px!, w), len(py!, h)] as const; });
          let inPoly = false;
          for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) {
            const [xi, yi] = pts[k]!;
            const [xj, yj] = pts[j]!;
            if ((yi > ly) !== (yj > ly) && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inPoly = !inPoly;
          }
          if (!inPoly) return false;
        }
        const ins = /^inset\((.*)\)$/.exec(cs.clipPath);
        if (ins) {
          const [t, r2 = t, b = t, l = r2] = parts(ins[1]!);
          if (ly < len(t!, h) - 0.5 || lx > w - len(r2!, w) + 0.5 || ly > h - len(b!, h) + 0.5 || lx < len(l!, w) - 0.5) return false;
        }
        return true;
      };
      const name = el.getAttribute('aria-label') ?? (el.textContent?.trim() || el.tagName.toLowerCase());
      const out: string[] = [];
      for (let a: Element | null = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const host = a;
        if (points.some(([x, y]) => !inside(x, y, host))) out.push(`${name}: its focus outline is cut by .${[...host.classList].join('.') || host.tagName.toLowerCase()}`);
      }
      return { key: el.outerHTML.slice(0, 120), out };
    });
    if (!found) { if (seen.size > 0) break; continue; }
    if (seen.has(found.key)) break;
    seen.add(found.key);
    cut.push(...found.out);
  }
  if (seen.size === 0) cut.push('Tab reached no control in the Game HUD');
  return cut;
}

for (const [label, viewport] of [['the Main board\'s layout, 1440 wide', { width: 1440, height: 900 }], ['a phone, 390 wide', { width: 390, height: 844 }]] as const) {
  test(`on ${label}, every HUD control Tab reaches has its whole focus outline inside the HUD's clip`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/b/general');
    await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await hudOutlinesCut(page)).toEqual([]);
  });
}

test('the check sees a focus outline the HUD\'s clip cuts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/b/general');
  await expect(page.getByRole('region', { name: 'Game HUD' })).toBeVisible();
  /* The bar's clip drawn 14px short of its foot: Menu's and the hand's outlines reach 6px past their foot, 194px down. */
  await page.addStyleTag({ content: '.kb-hud-bar { clip-path: inset(0 0 14px 0) !important; }' });
  expect(await hudOutlinesCut(page)).toEqual(expect.arrayContaining([expect.stringMatching(/Menu: its focus outline is cut by \.kb-hud-bar$/u)]));
});

/*
 * A ring the computed style says is there can still be cut away: an outline is drawn outside the border box, and a control
 * cut by clip-path (the glass's chamfered buttons) clips everything outside its polygon. So these read the pixels: the
 * control focused by the keyboard must look different from the same control unfocused (impeccable's audit of the cards, P1-1).
 */
async function ringShows(page: Page, control: Locator): Promise<boolean> {
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 };
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await page.screenshot({ clip, animations: 'disabled' });
  await control.focus();
  await page.keyboard.press('Shift');
  const after = await page.screenshot({ clip, animations: 'disabled' });
  return !before.equals(after);
}

test('the Vending Machine\'s Buy, a chamfered button, shows its focus ring inside its cut', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?fixture=boards&moment=07-vending');
  /* The board's state: Whoops! picked by its slot, then the machine's own Buy, the chamfered one. */
  await page.getByRole('button', { name: 'Buy Whoops!, 1.00 orb' }).click({ timeout: 10_000 });
  const buy = page.locator('.kb-vending-buy');
  await expect(buy).toBeEnabled();
  expect(await ringShows(page, buy)).toBe(true);
});

test('Stick Around\'s Break free, a chamfered button, shows its focus ring inside its cut', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?fixture=boards&moment=08-hold');
  await expect(page.getByRole('dialog', { name: 'Stick Around' })).toBeVisible({ timeout: 10_000 });
  expect(await ringShows(page, page.getByRole('button', { name: /^Break free/u }))).toBe(true);
});

/* The hand on a phone holds every card in reach at the narrowest width the brief names (320), with four faces in it. */
for (const width of [320, 390]) {
  test(`the hand on a phone ${width} wide keeps every card in reach, four faces included`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/?fixture=boards&moment=02-phone');
    const hand = page.getByRole('region', { name: 'Your hand' });
    if (!(await hand.isVisible())) await page.getByRole('button', { name: /^Hand, \d+ postcards?$/u }).click();
    await expect(hand).toBeVisible();
    /* A fourth face, as a hand of two kinds, two of each, draws. */
    await page.locator('.kb-hand-cards > li').first().evaluate((li) => li.parentElement!.append(li.cloneNode(true)));
    const cut = await page.locator('.kb-hand-cards > li').evaluateAll((items) => items.map((li) => {
      const r = li.getBoundingClientRect();
      return r.left < 0 || r.right > window.innerWidth ? `${r.left.toFixed(0)}..${r.right.toFixed(0)}` : null;
    }).filter(Boolean));
    expect(cut, 'cards cut off at the screen\'s edge').toEqual([]);
  });
}
