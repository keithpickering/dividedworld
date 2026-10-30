import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { judge, paletteOf, setAside, type Awaiting, type CeilingsFile, type GlassColors, type TextFact } from './glass-text.ts';
import type * as Gatherer from './glass-text-page.ts';

/**
 * The rendered glass measurement (the web plan's glass amendment to Task 12; the glass build's
 * Task 2.5): every glass page and overlay, at 1920×1080 and on a phone at 390×844, under reduced
 * motion so the smoke holds still, each line of its text held to the glass's rules for text
 * (e2e/glass-text.ts says them, and e2e/glass-text.test.ts drives each red on plain data). The
 * ceilings are the ones tools/check-glass-contrast.mjs writes from each surface's own recipe
 * (e2e/glass-ceilings.json), which that guard keeps current against glass.json.
 *
 * The page is read through e2e/glass-text-page.ts, bundled here for the browser: it gathers every
 * line on a surface's smoke, then the text is made transparent and the window photographed, and
 * the pixels under each line are read from the photograph. A page taller than the window is read a
 * window at a time, each line where it first lies wholly in view (an open overlay scrolls itself,
 * not the page). The poisons below plant each defect the measurement exists to catch in a real page
 * and expect it named; none ships in the page.
 *
 * It needs styles and scripts put into the page, which the site's policy would refuse
 * (e2e/csp.spec.ts holds the policy), so the policy is set aside here as the a11y spec does.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });

const glass = JSON.parse(readFileSync(new URL('../instances/divided-world/ui/glass.json', import.meta.url), 'utf8')) as GlassColors;
const CEILINGS = (JSON.parse(readFileSync(new URL('./glass-ceilings.json', import.meta.url), 'utf8')) as CeilingsFile)['divided-world']!.surfaces;

const GATHERER = buildSync({
  entryPoints: [new URL('./glass-text-page.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', globalName: 'kbGlassText', target: 'es2022', write: false,
}).outputFiles[0]!.text;

type Bundled = typeof globalThis & { kbGlassText: typeof Gatherer };

/** How far the window moves between reads: less than its height by more than any line is tall. */
const OVERLAP = 240;

/** Every line of glass text on the page as it stands, read and judged; [] is clean. */
async function measure(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: GATHERER });
  const { phone, key, height } = await page.evaluate(() => ({
    phone: document.documentElement.dataset.kbLayout === 'phone',
    key: document.documentElement.dataset.kbGlassKey ?? 'standard',
    height: innerHeight,
  }));
  const palette = paletteOf(glass, key);
  const facts = new Map<string, TextFact>();
  const seen = new Map<string, string>();
  for (let y = 0; ; y += height - OVERLAP) {
    const at = await page.evaluate((top) => {
      const scroller = document.querySelector('.kb-glass-overlay') ?? document.scrollingElement!;
      scroller.scrollTop = top;
      return new Promise<{ top: number; max: number }>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done({ top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight }))));
    }, y);
    const lines = await page.evaluate(() => (globalThis as Bundled).kbGlassText.gather());
    for (const l of lines) seen.set(l.key, l.name);
    const fresh = lines.filter((l) => l.inView && !facts.has(l.key));
    if (fresh.length) {
      await page.evaluate(() => (globalThis as Bundled).kbGlassText.hideText(true));
      const png = (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString('base64');
      await page.evaluate(() => (globalThis as Bundled).kbGlassText.hideText(false));
      const stats = await page.evaluate(([shot, boxes]) => (globalThis as Bundled).kbGlassText.pixels(shot, boxes), [png, fresh.map((l) => l.box)] as const);
      fresh.forEach((l, i) => facts.set(l.key, { ...l, ...stats[i]! }));
    }
    if (at.top >= at.max) break;
  }
  const faults = [...facts.values()].flatMap((f) => judge(f, { ceilings: CEILINGS[f.surface], palette, phone, high: key === 'high' }));
  const never = [...seen].filter(([k]) => !facts.has(k)).map(([, name]) => `${name}: never lies wholly in the window, so it is cut off`);
  if (facts.size === 0) faults.push('no glass text was found on the page');
  return [...faults, ...never];
}

/* ---- what is measured ---- */

interface Screen {
  readonly name: string;
  /** Where it opens: a route, a moment of the boards' fixture, or a board story. */
  readonly path: string;
  /** What a player does there to bring it up, once the page is ready. */
  readonly then?: (page: Page) => Promise<void>;
  /** It is read signed out, as a player reaches it. */
  readonly signedOut?: boolean;
}

/**
 * Every glass page: the routes web/src/App.tsx's GLASS map draws on the glass. Settings, sign-in,
 * register and invites still set their content on the board's own panel, which the gatherer does
 * not read (glass-text-page.ts says why); their menu bars are read now, and their content as soon
 * as Task 2.4 restyles them, with no change here. The HUD is glass on every board page: it is read
 * on the Main board's moment, where it holds the most.
 */
const PAGES: readonly Screen[] = [
  { name: 'My characters', path: '/characters' },
  { name: 'New character', path: '/characters/new' },
  { name: 'Edit profile', path: '/characters/edit' },
  { name: 'Rankings', path: '/rankings' },
  { name: 'Settings', path: '/settings' },
  { name: 'Invites', path: '/invites' },
  { name: 'Sign in', path: '/sign-in', signedOut: true },
  { name: 'Register', path: '/register?invite=ab12cd34', signedOut: true },
  { name: 'The HUD, on the Main board\'s moment', path: '/?fixture=boards&moment=01-main' },
];

/** A new character waits to debut; its two debut dialogs open from its panel. */
const debut = (button: string, dialog: string) => async (page: Page) => {
  await page.getByLabel(/name/iu).first().fill('Waiting Wanda');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Make the character' }).click();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
};

/** Every glass overlay (engine/ui/glass/Overlay.tsx), opened from where a player opens it. */
const OVERLAYS: readonly Screen[] = [
  {
    name: 'The React picker, from a post',
    path: '/b/general',
    then: async (page) => {
      await page.getByRole('link', { name: 'Who keeps reacting with tea?', exact: true }).click();
      await page.locator('#post-3').getByRole('button', { name: 'React' }).click();
      await expect(page.getByRole('dialog', { name: /^React to / })).toBeVisible();
    },
  },
  {
    name: 'The Turn modal, from My characters',
    path: '/characters',
    then: async (page) => {
      await page.getByRole('list', { name: /^Roster, /u }).getByRole('button', { name: /^Pipewrench/u }).click();
      await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
      await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
    },
  },
  { name: 'The Debut dialog, dropping now', path: '/characters/new', then: debut('Drop Waiting Wanda now', 'Drop Waiting Wanda now') },
  { name: 'The Debut dialog, choosing how', path: '/characters/new', then: debut('Change how Waiting Wanda debuts', 'How Waiting Wanda debuts') },
];

/**
 * The settlement's surface, which no screen draws until the glass build's Part 4: a stand-in story
 * draws it (engine/ui/glass/Surfaces.board.stories.tsx), so its `calmAll` recipe is held now. The
 * other board stories are the boards' drawings for the board match (the Orbs board's anatomy, the
 * React and Rankings boards' screens), whose screens are read above as the app draws them.
 */
const STORIES: readonly Screen[] = [{ name: 'The settlement\'s surface, in its stand-in story', path: '/?fixture=boards&story=boards-glass-surfaces--settlement' }];

/**
 * What waits on the owner. The Turn board (06) draws its words on the turn recipe's smoke with no
 * calm, as the recipe is dim enough for its body tokens (its full worst, 0.116, is under the body
 * ceilings of --kb-glass-text, -text-2, -pale and -neon-text); the web plan's rule puts every line
 * that is not large in a calm or on an opaque panel. Asked of the owner as a rule that fights the
 * product (CLAUDE.md); until the answer, that one rule waits on the Turn modal and on the dialog
 * bar it shares with the Debut dialog (Overlay.tsx's kicker), and every other check runs there.
 */
const TURN_SMOKE = 'does body text on the turn recipe\'s smoke, which the Turn board draws with no calm, need one?';
const DIALOG_KICKER = /^"My characters › Debut" in div\.kb-glass-dialog-titles > p\.kb-glass-dialog-kicker \(surface turn\): stands in no calm/u;
const AWAITING: Readonly<Record<string, readonly Awaiting[]>> = {
  'The Turn modal, from My characters': [{ fault: /\(surface turn\): stands in no calm and on no panel as solid as the calm/u, question: TURN_SMOKE }],
  'The Debut dialog, dropping now': [{ fault: DIALOG_KICKER, question: TURN_SMOKE }],
  'The Debut dialog, choosing how': [{ fault: DIALOG_KICKER, question: TURN_SMOKE }],
};

/** The demo world starts signed in, and starts over on a load: sign out in the app. */
async function signOut(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
}

/** Moves the app to `path` as a link does, without a load, so what the player chose stays chosen. */
async function goInApp(page: Page, path: string) {
  await page.evaluate((to) => { history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

/** Opens a screen ready to read: a glass page when its menu bar shows, a board page when its HUD does, a story once rendered. */
async function open(page: Page, s: Screen, how: 'load' | 'in app' = 'load') {
  if (s.signedOut) await signOut(page);
  if (s.signedOut || how === 'in app') await goInApp(page, s.path);
  else await page.goto(s.path);
  const ready = s.path.includes('story=')
    ? page.locator('#root > *').first()
    : page.getByRole('navigation', { name: 'Menu' }).or(page.getByRole('region', { name: 'Game HUD' })).first();
  await expect(ready).toBeVisible();
  await s.then?.(page);
  await page.evaluate(() => document.fonts.ready);
}

/** Puts a style into the page: a poison's plant. */
const plant = (page: Page, css: string) => page.addStyleTag({ content: css });

const SIZES = [['1920×1080', { width: 1920, height: 1080 }], ['a phone, 390×844', { width: 390, height: 844 }]] as const;

for (const [label, viewport] of SIZES) {
  test.describe(`at ${label}`, () => {
    test.use({ viewport });
    for (const s of [...PAGES, ...OVERLAYS, ...STORIES]) {
      test(`${s.name}: every line of glass text is legible on its smoke`, async ({ page }) => {
        await open(page, s);
        const { left, stale } = setAside(await measure(page), AWAITING[s.name] ?? []);
        expect([...left, ...stale]).toEqual([]);
      });
    }
  });
}

/*
 * High contrast (Settings; the design's section 4.5): every line of glass text stands on solid
 * ground. Task 2.4 wires the preference and the high key's ground; until it merges there is no
 * high contrast to choose, so these wait on it. Each screen is reached in the app after the choice,
 * since a load starts the demo world over; sign-in and register are left out, as signed out the
 * device's contrast holds, not the account's.
 */
async function chooseHighContrast(page: Page) {
  await page.goto('/settings');
  await page.getByRole('radiogroup', { name: /contrast/iu }).getByRole('radio', { name: /high/iu }).check();
  await expect(page.locator(':root[data-kb-glass-key="high"]')).toHaveCount(1);
}

test.describe('under high contrast', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  for (const s of [...PAGES, ...OVERLAYS].filter((x) => !x.signedOut)) {
    test.fixme(`${s.name}: every line of glass text stands on solid ground (Task 2.4 wires high contrast)`, async ({ page }) => {
      await chooseHighContrast(page);
      await open(page, s, 'in app');
      expect(await measure(page)).toEqual([]);
    });
  }

  test.fixme('the poison: one line left on the smoke is named (Task 2.4 wires high contrast)', async ({ page }) => {
    await chooseHighContrast(page);
    await open(page, PAGES.find((p) => p.path === '/rankings')!, 'in app');
    /* The lead's ground taken away: whatever puts it on solid ground under high contrast, gone. */
    await plant(page, '.kb-rankings-lead, .kb-rankings-lead::before { background: transparent !important; content: none !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/p\.kb-rankings-lead \(surface rankings\): under high contrast it stands on the smoke/u));
  });
});

/*
 * The poisons: each defect the measurement exists to catch, planted in a real page, and named by
 * it. The web plan's five (the fifth, under high contrast, is above) and the glass plan's section
 * 6 two. Each plant lives only in its own test's page.
 */
test.describe('the poisons, planted in a real page', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  const rankings = PAGES.find((p) => p.path === '/rankings')!;

  test('a calm moved off its text', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead.kb-calm::before { transform: translateX(900px); }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior/u));
  });

  test('a feather that reaches into the text', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead.kb-calm::before { inset: -4px; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior \(its backing inset by its 32px feather\)/u));
  });

  test('a 19px label', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-glass-menu-tab { font-size: 19px !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Rankings" in .*\(surface rankings\): inks 17\.\dpx at 19px of Barlow Condensed, under the floor of 18px of ink$/u));
  });

  test('a translucent text color', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead { color: rgba(228, 222, 247, 0.8) !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): its color rgba\(228, 222, 247, 0\.8\) is translucent; glass type is opaque$/u));
  });

  test('on a calmAll surface, the settlement\'s heading moved out of its calm', async ({ page }) => {
    await open(page, STORIES[0]!);
    expect(await measure(page)).toEqual([]);
    await page.locator('.kb-surfaces-story-head').evaluate((el) => el.classList.remove('kb-calm'));
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Settled" in .*h1\.kb-surfaces-story-head[^(]* \(surface settlement\): stands in no calm and on no panel as solid as the calm \(0\.85\); surface settlement \(recipe settlement\) is calmAll/u));
  });

  test('a class\'s large text on a surface the engine\'s list says does not draw it', async ({ page }) => {
    await open(page, PAGES.find((p) => p.path === '/characters')!);
    await page.locator('main').evaluate((main) => {
      const p = document.createElement('p');
      p.className = 'kb-calm kb-planted';
      p.style.cssText = 'margin: 48px 0; font: 400 40px/1 var(--kb-glass-font-display); color: var(--kb-glass-class-face-large)';
      p.textContent = 'Face';
      main.prepend(p);
    });
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Face" in .*p\.kb-planted \(surface characters\): is class face's large text, and surface characters draws no class's large text \(classLargeText says none\), so it has no ceiling there$/u));
  });
});
