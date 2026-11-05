import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { judge, paletteOf, type CeilingsFile, type GlassColors, type SurfaceCeilings, type TextFact } from './glass-text.ts';
import { signInUnseasonedOnBoard } from './onboarding.ts';
import type * as Gatherer from './glass-text-page.ts';
import { FIXTURE_OVERLAYS, OVERLAYS, PAGES, SETTLEMENT, STORIES, open, type Screen } from './glass-screens.ts';

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
const CEILINGS_FILE = (JSON.parse(readFileSync(new URL('./glass-ceilings.json', import.meta.url), 'utf8')) as CeilingsFile)['divided-world']!;
const CEILINGS = CEILINGS_FILE.surfaces;
const TIPS = CEILINGS_FILE.overlays.tips!;

/**
 * The spotlight's panel as the judgment reads a surface: surface `tips`, whose worst pixel is the overlay's (the sheet over its base, which the
 * guard writes as `overlays.tips`), each token held at 4.5:1 as body text, large or not (a ceiling for large text is the looser, so the
 * stricter is read for every line); no calm and no panel, so a line stands where the worst is under its ceiling.
 */
const TIPS_SURFACE: SurfaceCeilings = {
  recipe: 'tips', calmAll: false, worst: TIPS.worst, calmedWorst: TIPS.worst,
  tokens: Object.fromEntries(Object.entries(TIPS.tokens).map(([token, c]) => [token, { body: c.body, large: c.body }])),
};

const GATHERER = buildSync({
  entryPoints: [new URL('./glass-text-page.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', globalName: 'kbGlassText', target: 'es2022', write: false,
}).outputFiles[0]!.text;

type Bundled = typeof globalThis & { kbGlassText: typeof Gatherer };

/** How far the window moves between reads: less than its height by more than any line is tall. */
const OVERLAP = 240;

/** Every line of glass text on the page as it stands, read and judged; [] is clean. With `panel`, the lines of that overlay panel alone (the spotlight's), read against `overlays.tips`. */
async function measure(page: Page, panel?: string): Promise<string[]> {
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
    const lines = await page.evaluate((only) => (globalThis as Bundled).kbGlassText.gather(only), panel);
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
    if (panel || at.top >= at.max) break;
  }
  const faults = [...facts.values()].flatMap((f) => judge(f, { ceilings: f.surface === 'tips' ? TIPS_SURFACE : CEILINGS[f.surface], palette, phone, high: key === 'high' }));
  const never = [...seen].filter(([k]) => !facts.has(k)).map(([, name]) => `${name}: never lies wholly in the window, so it is cut off`);
  if (facts.size === 0) faults.push('no glass text was found on the page');
  return [...faults, ...never];
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
 * The calm is drawn outside its element (engine/ui/glass/calm.css): the element adds no padding, and
 * its backing reaches the feather past its box on every side. 32px on the main layout, the phone
 * layout's own where the theme gives one; read as the browser computes it, which an inline root
 * style must not outrank.
 */
for (const [label, viewport, phone] of [['1440 wide', { width: 1440, height: 900 }, false], ['the phone, 390 wide', { width: 390, height: 844 }, true]] as const) {
  test(`the calm adds no padding and its backing reaches the feather past the element, at ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, PAGES.find((p) => p.path === '/season?tab=rankings')!);
    /* 32px, the theme's; on the phone the smaller of it and the column's gutter, so the column's clip never cuts it. */
    const gutter = await page.locator('.kb-glass-content').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    const feather = phone ? Math.min(32, gutter) : 32;
    if (phone) expect(feather, 'the phone gutter is under the 32px feather').toBeLessThan(32);
    for (const sel of ['.kb-rankings-lead.kb-calm', '.kb-rankings-board.kb-calm']) {
      const got = await page.locator(sel).evaluate((el) => {
        const s = getComputedStyle(el);
        const b = getComputedStyle(el, '::before');
        return { padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], inset: [b.top, b.right, b.bottom, b.left] };
      });
      expect(got.padding, `${sel} padding`).toEqual(['0px', '0px', '0px', '0px']);
      expect(got.inset.map(parseFloat).map((v) => Math.round(v * 100) / 100), `${sel} backing`).toEqual(Array(4).fill(-Math.round(feather * 100) / 100));
    }
  });
}

/*
 * The HUD's geometry is main's (read at 82599ef, at 1440 and 390): no word moves, the glass keeps its
 * height and no box takes a tap from the controls beside it. A box sized by its words is measured a pixel
 * or two apart by two Chromiums' text metrics (CI's clock is 132px wide where a local one is 134), so
 * each box is held within HUD_SLACK of main's, the board comparer's size tolerance, and the height exactly.
 */
const HUD_SLACK = 4;
const nearly = (got: Record<string, number | number[]>, want: Record<string, number | number[]>) => {
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  for (const [key, w] of Object.entries(want)) {
    const g = got[key]!;
    if (typeof w === 'number') expect(g, key).toBe(w);
    else (g as number[]).forEach((v, i) => expect(Math.abs(v - w[i]!), `${key}[${i}] is ${v}, main's ${w[i]}`).toBeLessThanOrEqual(HUD_SLACK));
  }
};
test.describe('the HUD keeps its geometry', () => {
  const read = (page: Page) => page.evaluate(() => {
    const top = document.querySelector('.kb-hud')!.getBoundingClientRect().top;
    const at = (sel: string) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return [b.left, b.top - top, b.width, b.height].map(Math.round); };
    return { height: Math.round(document.querySelector('.kb-hud')!.getBoundingClientRect().height), avatar: at('.kb-hud-avatar'), select: at('.kb-hud-select'), aura: at('.kb-hud-aura-legend'), orbs: at('.kb-hud-orbs'), clock: at('.kb-hud-clock-time') };
  });
  test('at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, { name: 'HUD', path: '/b/general' });
    nearly(await read(page), { height: 212, avatar: [59, 72, 84, 84], select: [256, 129, 151, 52], aura: [500, 10, 452, 29], orbs: [500, 47, 452, 113], clock: [980, 59, 134, 34] });
  });
  test('at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { name: 'HUD', path: '/b/general' });
    const g = await read(page);
    nearly({ height: g.height, avatar: g.avatar, select: g.select, orbs: g.orbs }, { height: 124, avatar: [16, 23, 44, 44], select: [70, 32, 96, 48], orbs: [16, 88, 358, 30] });
  });
  for (const [label, viewport] of SIZES) {
    test(`no box takes the taps of the Menu control, the Hand or the picker's kinds, at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page, { name: 'HUD', path: '/b/general' });
      const tapped = (sel: string) => page.locator(sel).first().evaluate((el) => {
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return hit !== null && el.contains(hit);
      });
      expect(await tapped('.kb-hud-menu'), 'Menu').toBe(true);
      expect(await tapped('.kb-hud-hand'), 'Hand').toBe(true);
      await open(page, OVERLAYS.find((o) => o.name.startsWith('The React picker'))!);
      const kinds = await page.locator('.kb-picker-kind').evaluateAll((els) => els.map((el) => {
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return hit !== null && el.contains(hit);
      }));
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds.filter((ok) => !ok)).toEqual([]);
    });
  }
});

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
 * Text size (Settings › Accessibility): the glass's words grow with the player's choice, from 150% up
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

test('at 125% text the HUD\'s avatar grows on both sides with its plate, square', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await chooseTextSize(page, '125');
  await open(page, onTheAccount(PAGES.find((p) => p.path.includes('moment=01-main'))!));
  const box = await page.locator('.kb-hud-avatar').boundingBox();
  expect(box!.height).toBeCloseTo(105, 0);
  expect(box!.width).toBeCloseTo(box!.height, 0);
});

/*
 * The phone HUD's avatar stands beside the name, whole inside the HUD and clear of the name's and the label's boxes, on a tall window and on a short one (a
 * phone browser with its toolbar shows about 664px): it was once drawn low, under the name and past the HUD's foot, because the desk layout's offsets moved
 * it when it was made `relative`.
 */
for (const [label, viewport, size] of [['390x844', { width: 390, height: 844 }, '100'], ['390x664, a short window', { width: 390, height: 664 }, '100'], ['390x844 at 125% text', { width: 390, height: 844 }, '125']] as const) {
  test(`the phone HUD's avatar sits whole beside the name, clear of it, at ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    if (size !== '100') await chooseTextSize(page, size);
    await open(page, onTheAccount(PAGES.find((p) => p.path.includes('moment=01-main'))!));
    const boxes = await page.evaluate(() => {
      const b = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      return { hud: b('.kb-hud'), avatar: b('.kb-hud-avatar'), name: b('.kb-hud-select'), label: b('.kb-hud-swap-label') };
    });
    const { hud, avatar } = boxes;
    expect(avatar.left, 'inside the HUD, left').toBeGreaterThanOrEqual(hud.left);
    expect(avatar.top, 'inside the HUD, top').toBeGreaterThanOrEqual(hud.top);
    expect(avatar.right, 'inside the HUD, right').toBeLessThanOrEqual(hud.right);
    expect(avatar.bottom, 'inside the HUD, bottom').toBeLessThanOrEqual(hud.bottom + 0.5);
    expect(avatar.bottom, 'inside the window').toBeLessThanOrEqual(viewport.height);
    const apart = (a: typeof avatar, c: typeof avatar) => a.right <= c.left + 0.5 || c.right <= a.left + 0.5 || a.bottom <= c.top + 0.5 || c.bottom <= a.top + 0.5;
    expect(apart(avatar, boxes.name), 'clear of the name').toBe(true);
    expect(apart(avatar, boxes.label), 'clear of "Posting as"').toBe(true);
  });
}

for (const [size, widths] of TEXT_SIZES) {
  test.describe(`at ${size}% text`, () => {
    for (const [label, viewport] of widths) {
      test.describe(`at ${label}`, () => {
        test.use({ viewport });
        for (const s of [...PAGES, ...OVERLAYS].filter((x) => !x.signedOut).map(onTheAccount)) {
          test(`${s.name}: every line of glass text is legible on its smoke`, async ({ page }) => {
            /* Every line's pixels are read, against its smoke and under each preference: the Strategy Guide at 200% takes about 20s
               alone, and with tests spread fully parallel (playwright.config.ts) several of these share a machine. 90s still ends a hang. */
            test.setTimeout(90_000);
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
    await open(page, PAGES.find((p) => p.path === '/season?tab=rankings')!);
    /* The standard key's --kb-glass-text-2, which the high key lifts to #f1ecff. */
    await plant(page, '.kb-rankings-lead { color: #e4def7 !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): its color rgb\(228, 222, 247\) is not one of the glass's text colors in the high key$/u));
  });

  test('the poison: a line on solid ground too bright for its color at 7:1 is named', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await chooseHighContrast(page);
    await open(page, PAGES.find((p) => p.path === '/season?tab=rankings')!);
    /* The lead's calm is the solid ground under high contrast; drawn white, it is still solid, and far too bright for the high key's white text. */
    await plant(page, '.kb-rankings-lead.kb-calm::before { background: #ffffff !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): under high contrast its brightest pixel, luminance 1\.0000, is not under the 7:1 ceiling 0\.1 for its color, rgb\(255, 255, 255\)$/u));
  });

  test('the poison: one line left on the smoke is named', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await chooseHighContrast(page);
    await open(page, PAGES.find((p) => p.path === '/season?tab=rankings')!);
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
    const plantLine = (art: boolean) => page.locator('.kb-vending-panel').evaluate((list, marked) => {
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
      /* In the element's own px: a slot's card is drawn at the machine's `zoom` (vending.css), which scales its 3px ring with it (the browser snaps the scaled width, so whole px). */
      const zoom = (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
      return { style: ring.borderTopStyle, width: `${Math.round(parseFloat(ring.borderTopWidth) / zoom)}px`, highlight: ring.borderTopColor === highlight };
    });
    expect(await ring('button.kb-vending-slot[aria-pressed="true"]')).toEqual({ style: 'solid', width: '3px', highlight: true });
    expect((await ring('button.kb-vending-slot[aria-pressed="false"]')).style).not.toBe('solid');
    await page.locator('button.kb-vending-slot > .kb-postcard').first().evaluate((card) => card.setAttribute('data-armed', ''));
    expect(await ring('.kb-postcard[data-armed]')).toEqual({ style: 'solid', width: '3px', highlight: true });
  });
});

/*
 * The spotlight's panel (engine/ui/tips/Spotlight.tsx), the HUD tour's first step as a new account sees it (e2e/onboarding.ts). It stands on
 * `--kb-glass-sheet` over a scrim over the board, not on smoke, so tools/check-glass-contrast.mjs reads it as an overlay sheet and writes
 * its worst pixel and each token's ceiling (`overlays.tips`); the lines of the panel are read here against those. One scene is the panel
 * beside its target over a light board page at 1920×1080, the other the phone's sheet at 390×844 over the board on the phone layout.
 */
test.describe('the spotlight\'s first step', () => {
  const PANEL = '.kb-tips .kb-tips-panel';
  const open = async (page: Page) => {
    await signInUnseasonedOnBoard(page);
    await expect(page.locator(PANEL)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  };

  test.describe('beside its target over a light board page at 1920×1080', () => {
    test.use({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' });

    test('every line of the panel is legible on the sheet', async ({ page }) => {
      await open(page);
      expect(await page.evaluate(() => document.documentElement.dataset.kbLayout)).not.toBe('phone');
      /* The worst case behind the scrim is white: the body's channels are all high. */
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toMatch(/^rgb\((2[0-5]\d), (2[0-5]\d), (2[0-5]\d)\)$/u);
      expect(await measure(page, PANEL)).toEqual([]);
    });

    test('the poison: a sheet drawn at 0.3 is named', async ({ page }) => {
      await open(page);
      await plant(page, '.kb-tips { --kb-glass-sheet: rgba(9, 5, 18, 0.3) !important; }');
      expect(await measure(page, PANEL)).toContainEqual(expect.stringMatching(/\(surface tips\): its brightest pixel, luminance 0\.\d+, is not under the ceiling 0\.\d+ for --kb-glass-[\w-]+ as body text on surface tips \(recipe tips\)$/u));
    });
  });

  test.describe('as the phone\'s sheet at 390×844 over the dark board', () => {
    /* The device's dark: an account with no choice of its own follows the device (e2e/a11y.spec.ts reads both schemes the same way). */
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });

    test('every line of the panel is legible on the sheet', async ({ page }) => {
      await open(page);
      expect(await page.evaluate(() => document.documentElement.dataset.kbLayout)).toBe('phone');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toMatch(/^rgb\((\d|[1-5]\d), /u);
      expect(await measure(page, PANEL)).toEqual([]);
    });
  });
});

test.describe('the poisons, planted in a real page', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  const rankings = PAGES.find((p) => p.path === '/season?tab=rankings')!;

  test('a calm moved off its text', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead.kb-calm::before { transform: translateX(900px); }');
    /* The page recipe's full worst, 0.231, is over the lead's ceiling, so the calm is still what it needs. */
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior .* by 900px, and its recipe's full worst, 0\.231, is not under the ceiling 0\.152/u));
  });

  test('an uncalmed line on a recipe too bright for its color', async ({ page }) => {
    /* The owner's answer on #53 lets a line stand bare on a recipe dim enough (the Turn modal's); the characters recipe's full worst, 0.196, is over every body ceiling. */
    await open(page, PAGES.find((p) => p.path === '/characters')!);
    await page.locator('.kb-page-head-lead').evaluate((el) => el.classList.remove('kb-calm'));
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-page-head-lead \(surface characters\): stands in no calm and on no panel as solid as the calm \(0\.85\), and its recipe's full worst, 0\.196, is not under the ceiling 0\.1288 for --kb-glass-text-2 as body text on surface characters \(recipe characters\)/u));
  });

  test('a feather that reaches into the text', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead.kb-calm::before { inset: -4px; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior \(its backing inset by its 32px feather\)/u));
  });

  test('a joined calm whose outer edge still feathers into the text', async ({ page }) => {
    /* The phone's HUD door and actions join, with no feather where they face (frame.css); the door's title stands in the door's own calm, whose top edge still ramps, so a backing pulled in on it is named. */
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { name: 'The HUD, signed out', path: '/b/general', signedOut: true });
    await plant(page, '.kb-hud-door.kb-calm::before { top: 0; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ h2\.kb-hud-door-title\.kb-glass-display \(surface hud\): lies outside its calm's interior \(its backing inset by its 32px feather\)/u));
  });

  test('a 19px label', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-glass-menu-tab { font-size: 19px !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Season" in .*\(surface rankings\): inks 17\.\dpx at 19px of Barlow Condensed, under the floor of 18px of ink$/u));
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
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Season" in .*\(surface rankings\): inks 17\.\dpx at 18\.9px of Barlow Condensed, under the floor of 18px of ink$/u));
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
    expect(await measure(page)).toContainEqual(expect.stringMatching(/^"Season" in .*\(surface rankings\): is 15px of [^,]+, under the phone's floor of 16px$/u));
  });

  test('a translucent text color', async ({ page }) => {
    await open(page, rankings);
    await plant(page, '.kb-rankings-lead { color: rgba(228, 222, 247, 0.8) !important; }');
    expect(await measure(page)).toContainEqual(expect.stringMatching(/ p\.kb-rankings-lead \(surface rankings\): its color rgba\(228, 222, 247, 0\.8\) is translucent; glass type is opaque$/u));
  });

  test('the settlement\'s title stands on the bare smoke, and is legible there', async ({ page }) => {
    await open(page, SETTLEMENT);
    expect(await page.locator('.kb-page-head-title').evaluate((el) => el.classList.contains('kb-calm'))).toBe(false);
    expect(await measure(page)).toEqual([]);
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
