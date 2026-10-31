import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { judge, paletteOf, type CeilingsFile, type GlassColors, type TextFact } from './glass-text.ts';
import type * as Gatherer from './glass-text-page.ts';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';

type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo };

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
      const shoot = async (smoke: boolean) => {
        await page.evaluate((s) => (globalThis as Bundled).kbGlassText.hideText(true, s), smoke);
        return (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString('base64');
      };
      const png = await shoot(true);
      /* Under high contrast, the same window with the smoke taken away: solid ground is ground the smoke changes nothing on. */
      const bare = key === 'high' ? await shoot(false) : undefined;
      await page.evaluate(() => (globalThis as Bundled).kbGlassText.hideText(false));
      const stats = await page.evaluate(([shot, boxes, without]) => (globalThis as Bundled).kbGlassText.pixels(shot, boxes, without), [png, fresh.map((l) => l.box), bare] as const);
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
 * Every glass page: the routes web/src/App.tsx's GLASS map draws on the glass, each read in full
 * (Invites is Settings › Account, where /invites now opens). The HUD is glass on every board page:
 * it is read on the Main board's moment, where it holds the most, signed out, and with a wallet
 * past its cap, the longest its figures get.
 */
const PAGES: readonly Screen[] = [
  { name: 'My characters', path: '/characters' },
  { name: 'New character', path: '/characters/new' },
  { name: 'Edit profile', path: '/characters/edit' },
  { name: 'Rankings', path: '/rankings' },
  { name: 'My log, before anything has settled', path: '/log' },
  { name: 'The Vending Machine', path: '/vending' },
  { name: 'The hand, open', path: '/b/general', then: async (page) => { await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click(); } },
  /* The armed card, with its floating tag where the layout keeps the hand open to show it. */
  {
    name: 'The hand, with a card armed',
    path: '/b/general',
    then: async (page) => {
      await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click();
      await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
    },
  },
  { name: 'Settings', path: '/settings' },
  { name: 'Settings › Account, with the invites', path: '/settings?section=account' },
  { name: 'Sign in', path: '/sign-in', signedOut: true },
  { name: 'Register', path: '/register?invite=ab12cd34', signedOut: true },
  { name: 'The HUD, on the Main board\'s moment', path: '/?fixture=boards&moment=01-main' },
  { name: 'The HUD, signed out', path: '/b/general', signedOut: true },
  {
    name: 'The HUD, with a wallet past its cap',
    path: '/b/general',
    then: async (page) => {
      /* A full wallet puts the demo's estimate wholly past the cap; the HUD reads the wallet when the account changes, out and back in. */
      await page.waitForFunction(() => '__kbFake' in globalThis);
      await page.evaluate(() => {
        const w = globalThis as E2eWindow;
        w.__kbFake.seed.wallet(w.__kbDemo.me, 600);
        w.__kbFake.signInAs(null);
      });
      await expect(page.locator('.kb-hud-orbs')).toHaveCount(0);
      await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.signInAs(w.__kbDemo.me); });
      await expect(page.locator('.kb-hud-orbs .kb-orbs-over')).toHaveText(/^\+\d\.\d\d past the cap$/u);
    },
  },
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
  {
    name: 'The Vending Machine\'s card info, from a slot',
    path: '/vending',
    then: async (page) => {
      await page.getByRole('button', { name: 'About Whoops!' }).click();
      await expect(page.getByRole('dialog', { name: 'Whoops!' })).toBeVisible();
    },
  },
  { name: 'The Debut dialog, dropping now', path: '/characters/new', then: debut('Drop Waiting Wanda now', 'Drop Waiting Wanda now') },
  { name: 'The Debut dialog, choosing how', path: '/characters/new', then: debut('Change how Waiting Wanda debuts', 'How Waiting Wanda debuts') },
];

/**
 * An overlay that opens on its own on the boards' fixture, whose account is the fixture's and not the demo world's: read in
 * the first run only, as the stories are (the runs below sign in as the demo's player, which this fixture has no use for).
 */
const FIXTURE_OVERLAYS: readonly Screen[] = [
  {
    name: 'Stick Around\'s view, taking the reader over on the Hold board\'s moment',
    path: '/?fixture=boards&moment=08-hold',
    then: async (page) => { await expect(page.getByRole('dialog', { name: 'Stick Around' })).toBeVisible({ timeout: 10_000 }); },
  },
  {
    /* The Cards board's moment: the hand, the card armed, then the post's own button, which opens the form on the post. */
    name: 'The play form, on the Cards board\'s moment',
    path: '/?fixture=boards&moment=05-cards',
    then: async (page) => {
      await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click();
      await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
      await page.getByRole('button', { name: 'Play Whoops! here' }).last().click();
      await expect(page.getByRole('dialog', { name: 'Whoops!' })).toBeVisible();
    },
  },
];

/**
 * The log and the settlement's summary, at the Log and Settlement boards' moments, where they hold lines (the demo world's
 * log has none), and the log's breakdown open, which no board draws (its story, "12 Log, open"). The summary is the
 * `calmAll` surface: every line on it, large text too, stands in a calm. Read in the first runs only, as the overlays above
 * are. The other board stories are the boards' drawings for the board match, whose screens are read above as the app draws them.
 */
const SETTLEMENT: Screen = { name: 'The settlement\'s summary, on the Settlement board\'s moment', path: '/?fixture=boards&moment=09-settlement' };
const STORIES: readonly Screen[] = [
  { name: 'My log, on the Log board\'s moment', path: '/?fixture=boards&moment=12-log' },
  SETTLEMENT,
  { name: 'My log with a settlement\'s posts open, in its story', path: '/?fixture=boards&story=boards-12-log--open' },
];

/** The demo world starts signed in, and starts over on a load: sign out in the app. */
async function signOut(page: Page) {
  await page.goto('/settings?section=account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
}

/** Moves the app to `path` as a link does, without a load, so the signed-out session stays. */
async function goInApp(page: Page, path: string) {
  await page.evaluate((to) => { history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

/** Opens a screen ready to read: a glass page when its menu bar shows, a board page when its HUD does, a story once rendered. */
async function open(page: Page, s: Screen) {
  if (s.signedOut) await signOut(page);
  if (s.signedOut) await goInApp(page, s.path);
  else await page.goto(s.path);
  const ready = s.path.includes('story=')
    ? page.locator('#root > *').first()
    /* The settlement's summary has no menu bar: its heading says it is drawn. */
    : page.getByRole('navigation', { name: 'Menu' }).or(page.getByRole('region', { name: 'Game HUD' })).or(page.getByRole('heading', { level: 1, name: 'While you were away' })).first();
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
    for (const s of [...PAGES, ...OVERLAYS, ...FIXTURE_OVERLAYS, ...STORIES]) {
      test(`${s.name}: every line of glass text is legible on its smoke`, async ({ page }) => {
        await open(page, s);
        expect(await measure(page)).toEqual([]);
      });
    }
  });
}

/*
 * High contrast (Settings › Accessibility; the design's section 4.5): every line of glass text
 * stands on solid ground (engine/ui/glass/contrast.css), with the high key on the root, so each
 * line is also held to the high key's colors. It is chosen as a player chooses it, by keyboard
 * (the radios are hidden inputs, as e2e/glass-preferences.spec.ts chooses them), and it is the
 * account's, so it holds across the load that opens each screen. Sign-in and register are left
 * out: signed out, no account's contrast applies (e2e/glass-preferences.spec.ts reads them under
 * the mark alone).
 */
async function chooseHighContrast(page: Page) {
  await page.goto('/settings');
  await page.getByRole('radiogroup', { name: 'Contrast' }).getByRole('radio', { name: 'High' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-kb-contrast', 'high');
  await expect(page.locator('html')).toHaveAttribute('data-kb-glass-key', 'high');
}

/* The boards' fixture signs in its own account, which has no preference; the HUD is read on the demo world's board, as the player who chose it. */
const onTheAccount = (s: Screen): Screen => (s.path.includes('fixture=boards') ? { name: 'The HUD, on a board page', path: '/b/general' } : s);

/*
 * Text size (Settings › Accessibility): the glass's words grow with the player's choice, past 150%
 * on the Phone board's layout, and every line is held to the same rules at every size, its calm
 * growing with it. Chosen as a player chooses it, by keyboard, and kept by the account across the
 * load that opens each screen; signed-out screens are left out, as no account's size applies there.
 * 200% is read at both widths, 125% and 150% at 1920 and at 1280, where the Main board's layout is
 * drawn scaled (the phone at 390 is on the Phone board's layout at every size, and is read at 200%).
 */
async function chooseTextSize(page: Page, size: string) {
  await page.goto('/settings');
  await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: `${size}%` }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-kb-text-size', size);
}

/* The Main board's layout drawn at the window's scale: 1280 is 1280/1440 of it, between the switch and the board's width. */
const SCALED = ['1280×1080, the Main board\'s layout scaled', { width: 1280, height: 1080 }] as const;

const TEXT_SIZES: readonly (readonly [string, readonly (readonly [string, { readonly width: number; readonly height: number }])[]])[] = [
  ['125', [SIZES[0], SCALED]],
  ['150', [SIZES[0], SCALED]],
  ['200', SIZES],
];

test('at 150% text the HUD\'s avatar grows on both sides with its plate, square', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await chooseTextSize(page, '150');
  await open(page, onTheAccount(PAGES.find((p) => p.path.includes('moment=01-main'))!));
  const box = await page.locator('.kb-hud-avatar').boundingBox();
  expect(box!.height).toBeCloseTo(126, 0);
  expect(box!.width).toBeCloseTo(box!.height, 0);
});

for (const [size, widths] of TEXT_SIZES) {
  test.describe(`at ${size}% text`, () => {
    for (const [label, viewport] of widths) {
      test.describe(`at ${label}`, () => {
        test.use({ viewport });
        for (const s of [...PAGES, ...OVERLAYS].filter((x) => !x.signedOut).map(onTheAccount)) {
          test(`${s.name}: every line of glass text is legible on its smoke`, async ({ page }) => {
            await chooseTextSize(page, size);
            await open(page, s);
            await expect(page.locator('html')).toHaveAttribute('data-kb-text-size', size);
            expect(await measure(page)).toEqual([]);
          });
        }
      });
    }
  });
}

test.describe('under high contrast', () => {
  for (const [label, viewport] of SIZES) {
    test.describe(`at ${label}`, () => {
      test.use({ viewport });
      for (const s of [...PAGES, ...OVERLAYS].filter((x) => !x.signedOut).map(onTheAccount)) {
        test(`${s.name}: every line of glass text stands on solid ground`, async ({ page }) => {
          await chooseHighContrast(page);
          await open(page, s);
          await expect(page.locator('html')).toHaveAttribute('data-kb-glass-key', 'high');
          expect(await measure(page)).toEqual([]);
        });
      }
    });
  }

  test('the poison: a line in a color the high key does not name is named', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await chooseHighContrast(page);
    await open(page, PAGES.find((p) => p.path === '/rankings')!);
    /* The standard key's --kb-glass-text-2, which the high key lifts to #f1ecff. */
    await plant(page, '.kb-rankings-lead { color: #e4def7 !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): its color rgb\(228, 222, 247\) is not one of the glass's text colors in the high key$/u));
  });

  test('the poison: a line on solid ground too bright for its color at 7:1 is named', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await chooseHighContrast(page);
    await open(page, PAGES.find((p) => p.path === '/rankings')!);
    /* The lead's calm is the solid ground under high contrast; drawn white, it is still solid, and far too bright for the high key's white text. */
    await plant(page, '.kb-rankings-lead.kb-calm::before { background: #ffffff !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): under high contrast its brightest pixel, luminance 1\.0000, is not under the 7:1 ceiling 0\.1 for its color, rgb\(255, 255, 255\)$/u));
  });

  test('the poison: one line left on the smoke is named', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await chooseHighContrast(page);
    await open(page, PAGES.find((p) => p.path === '/rankings')!);
    /* One line of the page's own, left on its smoke below the column, with no ground under it. */
    await page.locator('.kb-glass-page').evaluate((glassPage) => {
      const p = document.createElement('p');
      p.className = 'kb-rankings-lead kb-planted';
      p.style.cssText = 'position: absolute; z-index: 1; left: 0; right: 0; top: 700px; margin: 0; text-align: center';
      p.textContent = 'A line the high contrast ground was not laid under, across the smoke from one edge of the window to the other.';
      glassPage.append(p);
    });
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead\.kb-planted \(surface rankings\): under high contrast the smoke shows through under it \(it changes a channel by \d+ levels\), not solid ground$/u));
  });
});

/*
 * The poisons: each defect the measurement exists to catch, planted in a real page, and named by
 * it. The web plan's five (the fifth, under high contrast, is above) and the glass plan's section
 * 6 two. Each plant lives only in its own test's page.
 */
test.describe('the instance\'s drawn art', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the poison: a line in a color no token names is named, and the same line marked as the machine\'s art is left alone', async ({ page }) => {
    await open(page, PAGES.find((p) => p.path === '/vending')!);
    const plantLine = (art: boolean) => page.locator('.kb-vending-sealed').evaluate((list, marked) => {
      document.querySelector('.kb-planted')?.remove();
      const p = document.createElement('p');
      p.className = 'kb-planted kb-calm';
      p.style.cssText = 'color: #2ef0a0; font-size: 21px; margin: 0';
      if (marked) p.setAttribute('data-kb-art', '');
      p.textContent = 'A line printed on the machine in a color no token names.';
      list.append(p);
    }, art);
    await plantLine(false);
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-planted \(surface vending\): its color rgb\(46, 240, 160\) is not one of the glass's text colors in the standard key$/u));
    await plantLine(true);
    expect((await measure(page)).filter((m) => m.includes('kb-planted'))).toEqual([]);
  });
});

/*
 * The picked slot and the armed card are marked by a glow (box-shadow), which forced colors
 * (Windows High Contrast) drop: each is also marked by a border in the system's Highlight there.
 */
test.describe('the picked slot and the armed card in forced colors', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('are ringed in Highlight, and a slot that is not picked is not', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, PAGES.find((p) => p.path === '/vending')!);
    const slots = page.locator('button.kb-vending-slot');
    await slots.first().click();
    const ring = (selector: string) => page.locator(selector).first().evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.cssText = 'forced-color-adjust: none; color: Highlight';
      document.body.append(probe);
      const highlight = getComputedStyle(probe).color;
      probe.remove();
      const ring = getComputedStyle(el, '::after');
      return { style: ring.borderTopStyle, width: ring.borderTopWidth, highlight: ring.borderTopColor === highlight };
    });
    expect(await ring('button.kb-vending-slot[aria-pressed="true"]')).toEqual({ style: 'solid', width: '3px', highlight: true });
    expect((await ring('button.kb-vending-slot[aria-pressed="false"]')).style).not.toBe('solid');
    await page.locator('button.kb-vending-slot > .kb-postcard').first().evaluate((card) => card.setAttribute('data-armed', ''));
    expect(await ring('.kb-postcard[data-armed]')).toEqual({ style: 'solid', width: '3px', highlight: true });
  });
});

test.describe('the poisons, planted in a real page', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  const rankings = PAGES.find((p) => p.path === '/rankings')!;

  test('a calm moved off its text', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead.kb-calm::before { transform: translateX(900px); }');
    /* The page recipe's full worst, 0.231, is over the lead's ceiling, so the calm is still what it needs. */
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior .* by 900px, and its recipe's full worst, 0\.231, is not under the ceiling 0\.152/u));
  });

  test('an uncalmed line on a recipe too bright for its color', async ({ page }) => {
    /* The owner's answer on #53 lets a line stand bare on a recipe dim enough (the Turn modal's); the characters recipe's full worst, 0.196, is over every body ceiling. */
    await open(page, PAGES.find((p) => p.path === '/characters')!);
    await page.locator('.kb-characters-lead').evaluate((el) => el.classList.remove('kb-calm'));
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-characters-lead \(surface characters\): stands in no calm and on no panel as solid as the calm \(0\.85\), and its recipe's full worst, 0\.196, is not under the ceiling 0\.1288 for --kb-glass-text-2 as body text on surface characters \(recipe characters\)/u));
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

  test('with no overlay open, text a page marks inert is still read', async ({ page }) => {
    /* Only an open overlay's page is passed over (the gatherer reads the overlay alone); a page's own inert text is the player's to read, and is held like the rest. */
    await open(page, rankings);
    await page.locator('.kb-rankings-lead').evaluate((el) => el.setAttribute('inert', ''));
    await plant(page, '.kb-rankings-lead { color: rgba(228, 222, 247, 0.8) !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): its color rgba\(228, 222, 247, 0\.8\) is translucent/u));
  });

  test('a class\'s large color under WCAG\'s large size, bare on the react smoke (#54)', async ({ page }) => {
    /* The picker's quadrant labels back at the board's 22px: Heel's #ff959f is then body text, and the react recipe's worst is over its 4.5:1 ceiling. */
    await open(page, OVERLAYS.find((o) => o.name.startsWith('The React picker'))!);
    await plant(page, '.kb-picker-label { font-size: 22px !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Heat" in .*div\.kb-picker-label[^(]* \(surface react\): stands in no calm and on no panel as solid as the calm \(0\.85\), and its recipe's full worst, 0\.0875, is not under the ceiling 0\.0617 for class heel's large color as body text .* \(this is 22px at weight 400\)/u));
  });

  test('a calm shrunk by a transform, which leaves its text outside', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead.kb-calm::before { transform: scale(0.5); }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior \(its backing inset by its 16px feather\)/u));
  });

  test('a label shrunk by a transform above it is measured at the size it is drawn', async ({ page }) => {
    await open(page, rankings);
    /* 21px drawn at 0.9 is 18.9px, 17.4px of ink. */
    await plant(page, '.kb-glass-menu-list { transform: scale(0.9); transform-origin: left center; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Rankings" in .*\(surface rankings\): inks 17\.\dpx at 18\.9px of Barlow Condensed, under the floor of 18px of ink$/u));
  });

  test('a line in a face the page has not loaded fails loudly, not in the fallback', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead { font-family: "Barlow Condensed Missing", sans-serif !important; }');
    await expect(measure(page)).rejects.toThrow(/The face Barlow Condensed Missing 600 is not loaded \(no such face in the document\), so "The season's standings[^"]*" in div\.kb-rankings > p\.kb-rankings-lead would be measured in a fallback/u);
  });

  test('a line that never lies wholly in the window is named as cut off', async ({ page }) => {
    await open(page, rankings);
    await page.locator('.kb-glass-page').evaluate((glassPage) => {
      const p = document.createElement('p');
      p.className = 'kb-calm kb-planted';
      p.style.cssText = 'position: fixed; left: 40px; bottom: -12px; margin: 0';
      p.textContent = 'A line the window always cuts';
      glassPage.append(p);
    });
    expect(await measure(page)).toContainEqual('"A line the window always cuts" in div.kb-glass > p.kb-planted: never lies wholly in the window, so it is cut off');
  });

  /** The fixed HUD the boards dock at the window's foot, drawn bright so a line read under it is read over the wrong pixels. */
  const dockHud = (page: Page) => page.locator('.kb-glass-page').evaluate((glassPage) => {
    const hud = document.createElement('div');
    hud.setAttribute('role', 'region');
    hud.setAttribute('aria-label', 'Game HUD');
    hud.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; height: 120px; z-index: 50; background: #ffffff';
    glassPage.append(hud);
  });

  test('a line always behind the fixed HUD is named as cut off, not read over the HUD', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, rankings);
    await dockHud(page);
    await page.locator('.kb-glass-page').evaluate((glassPage) => {
      const p = document.createElement('p');
      p.className = 'kb-calm kb-planted';
      p.style.cssText = 'position: fixed; left: 40px; bottom: 30px; margin: 0; z-index: 1';
      p.textContent = 'A line the HUD always covers';
      glassPage.append(p);
    });
    expect(await measure(page)).toContainEqual('"A line the HUD always covers" in div.kb-glass > p.kb-planted: never lies wholly in the window, so it is cut off');
  });

  test('a line behind the fixed HUD at one scroll position is read at another, where it is clear', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, rankings);
    await dockHud(page);
    await page.locator('main').evaluate((main) => {
      /* In the first window the line lies under the HUD; a window down it stands clear on the smoke. */
      const spacer = document.createElement('div');
      const p = document.createElement('p');
      p.className = 'kb-calm kb-planted';
      p.textContent = 'A line the HUD covers at first';
      const tail = document.createElement('div');
      tail.style.height = '1800px';
      main.append(spacer, p, tail);
      spacer.style.height = `${Math.max(0, innerHeight - 70 - p.getBoundingClientRect().top)}px`;
    });
    const found = await measure(page);
    /* Read in the clear it is a legible line on the smoke; read under the HUD it would be judged over the HUD's white. */
    expect(found.filter((f) => f.includes('A line the HUD covers at first'))).toEqual([]);
  });

  test('a line of an open overlay standing where the fixed HUD is docked is read where it stands, the overlay being above the HUD', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, OVERLAYS.find((o) => o.name.startsWith('The Turn modal'))!);
    await dockHud(page);
    await page.locator('.kb-glass-dialog-body').evaluate((body) => {
      const p = document.createElement('p');
      p.className = 'kb-planted';
      p.style.cssText = 'position: fixed; left: 40px; bottom: 30px; margin: 0; color: rgba(241, 236, 255, 0.8)';
      p.textContent = 'A line over the HUD';
      body.append(p);
    });
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"A line over the HUD" in .*p\.kb-planted \(surface turn\): its color rgba\(241, 236, 255, 0\.8\) is translucent/u));
  });

  test('a line on a page longer than the window is found by reading it a window at a time', async ({ page }) => {
    await open(page, rankings);
    await page.locator('main').evaluate((main) => {
      const spacer = document.createElement('div');
      spacer.style.height = '3600px';
      const p = document.createElement('p');
      p.className = 'kb-calm kb-planted';
      p.style.color = 'rgba(241, 236, 255, 0.8)';
      p.textContent = 'A line three windows down';
      main.append(spacer, p);
    });
    expect(await page.evaluate(() => document.documentElement.scrollHeight > 3 * innerHeight)).toBe(true);
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"A line three windows down" in .*p\.kb-planted \(surface rankings\): its color rgba\(241, 236, 255, 0\.8\) is translucent/u));
  });

  test('a line at the foot of an overlay that scrolls itself is found by scrolling the overlay', async ({ page }) => {
    await open(page, OVERLAYS.find((o) => o.name.startsWith('The Turn modal'))!);
    await page.locator('.kb-glass-dialog-body').evaluate((body) => {
      const spacer = document.createElement('div');
      spacer.style.height = '2400px';
      const p = document.createElement('p');
      p.className = 'kb-planted';
      p.style.color = 'rgba(241, 236, 255, 0.8)';
      p.textContent = 'A line at the dialog foot';
      body.append(spacer, p);
    });
    expect(await page.evaluate(() => { const o = document.querySelector('.kb-glass-overlay')!; return o.scrollHeight > 2 * o.clientHeight; })).toBe(true);
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"A line at the dialog foot" in .*p\.kb-planted \(surface turn\): its color rgba\(241, 236, 255, 0\.8\) is translucent/u));
  });

  test('on the phone, a 15px label is under the phone\'s floor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, rankings);
    await plant(page, '.kb-glass-menu-tab, .kb-glass-menu-tab * { font-size: 15px !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Rankings" in .*\(surface rankings\): is 15px of [^,]+, under the phone's floor of 16px$/u));
  });

  test('a translucent text color', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead { color: rgba(228, 222, 247, 0.8) !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): its color rgba\(228, 222, 247, 0\.8\) is translucent; glass type is opaque$/u));
  });

  test('on a calmAll surface, the settlement\'s heading moved out of its calm', async ({ page }) => {
    await open(page, SETTLEMENT);
    expect(await measure(page)).toEqual([]);
    await page.locator('.kb-settled-title').evaluate((el) => el.classList.remove('kb-calm'));
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"While you were away" in .*h1\.kb-settled-title[^(]* \(surface settlement\): stands in no calm and on no panel as solid as the calm \(0\.85\); surface settlement \(recipe settlement\) is calmAll/u));
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
