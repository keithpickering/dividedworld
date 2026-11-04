import { buildSync } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OVERLAYS, OVERLAYS, PAGES, STORIES, open, type E2eWindow, type Screen } from './glass-screens.ts';
import { judgeLayout, type LayoutFacts } from './glass-layout.ts';
import type * as Gatherer from './glass-layout-page.ts';

/**
 * The layout check (docs/plans/2026-11-04-glass-polish-design.md, section 3): every glass screen
 * and dialog (e2e/glass-screens.ts), at a phone (390×844), a tablet (834×1112) and a desktop
 * (1440×900), at each text size the preference offers (100, 125, 150, 200%), laid out as the browser
 * lays it out, and judged by e2e/glass-layout.ts, which says the six things it refuses and
 * e2e/glass-layout.test.ts drives each red on plain data. The facts are gathered in the page by
 * e2e/glass-layout-page.ts, bundled here for the browser.
 *
 * The text size is set through the preference, as e2e/glass-preferences.spec.ts sets it, and kept
 * for the tab across the load that opens the screen. Motion is reduced so nothing is read mid-slide.
 * The page's policy refuses a script put into it, so it is set aside as the contrast spec does.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });

const GATHERER = buildSync({
  entryPoints: [new URL('./glass-layout-page.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', globalName: 'kbGlassLayout', target: 'es2022', write: false,
}).outputFiles[0]!.text;

type Bundled = typeof globalThis & { kbGlassLayout: typeof Gatherer };

const VIEWPORTS = [['a phone, 390×844', { width: 390, height: 844 }], ['a tablet, 834×1112', { width: 834, height: 1112 }], ['a desktop, 1440×900', { width: 1440, height: 900 }]] as const;
const TEXT_SIZES = [100, 125, 150, 200] as const;

/** Every screen and dialog. */
const SCREENS: readonly Screen[] = [...PAGES, ...OVERLAYS, ...FIXTURE_OVERLAYS, ...STORIES];

/** The preference, kept for the tab across the load `open` makes next. */
async function setTextSize(page: Page, textSize: (typeof TEXT_SIZES)[number]) {
  await page.goto('/characters');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(async (t) => { await (globalThis as E2eWindow).__kbFake.setPreferences({ textSize: t }); }, textSize);
}

async function judgeScreen(page: Page, name: string): Promise<string[]> {
  await page.addScriptTag({ content: GATHERER });
  const gathered = await page.evaluate(() => (globalThis as Bundled).kbGlassLayout.gather());
  const facts: LayoutFacts = { screen: name, ...gathered };
  return judgeLayout(facts);
}

for (const [label, viewport] of VIEWPORTS) {
  for (const size of TEXT_SIZES) {
    test.describe(`at ${label}, text ${size}%`, () => {
      test.use({ viewport });
      for (const s of SCREENS) {
        test(`${s.name}: the layout holds`, async ({ page }) => {
          await setTextSize(page, size);
          await open(page, s);
          expect(await judgeScreen(page, `${s.name} (${viewport.width}px, text ${size}%)`)).toEqual([]);
        });
      }
    });
  }
}
