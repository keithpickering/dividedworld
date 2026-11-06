import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Browser } from '@playwright/test';
import { compareBoard, compareSides, type BoardManifest, type Snapshot } from './board-match.ts';
import { pressControls, routeBoardFonts, settledSnapshot, snapshotPage, standInFaces } from './board-snapshot.ts';

/**
 * The board match does not hang on where a browser breaks a line. A paragraph whose words come within a few percent of its column's width wraps
 * into a line more on one machine than on another (the same face, set a little narrower by another Chromium or another rasterizer), and everything
 * under it in the flow then stands a line higher or lower. CI's shard 2 failed boards 14 (phone) and 25 that way, while the local runs, which
 * wrapped one line more, passed: no race, since the build was read settled both times (e2e/board-snapshot.ts, `settledSnapshot`).
 *
 * This spec sets the build's words 2% narrower than the machine does (the direction CI's differed in) and then 2% wider (a `word-spacing` on the page, which no board's type check
 * reads), so each wrap that stands at the edge flips here, on any machine, and every manifest of the later folders must still hold its parts'
 * places. A manifest that holds a part's y from the dialog's or the menu's corner where a paragraph above it can change its line count fails here,
 * and says so by name; the fix is to measure that part from the paragraph's bottom edge (`origin` and `originEdge: 'bottom'`).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FOLDER = '2026-11-05-backfill';
const manifests = fs.readdirSync(path.join(here, 'boards', FOLDER)).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3));

/** How much narrower or wider the build's words are set than the machine sets them, in px per word space: about 2% of a word and its space. */
const NUDGES = { narrower: -1.3, wider: 1.3 } as const;

/** Only a part's y and height move with a wrap; its x and width follow the nudge itself (a shrink-wrapped box is as wide as its words), and a type is not what this spec holds. */
const isPlace = (message: string) => /: (y|height) is |presence|missing|found/.test(message);

async function compareNudged(browser: Browser, baseURL: string | undefined, id: string, manifest: BoardManifest, nudge: number): Promise<string[]> {
  const context = await browser.newContext({ baseURL, viewport: manifest.size, deviceScaleFactor: 1, reducedMotion: 'reduce', timezoneId: 'UTC', bypassCSP: true });
  try {
    await standInFaces(context);
    const boardPage = await context.newPage();
    const buildPage = await context.newPage();
    await routeBoardFonts(boardPage);
    await boardPage.goto(pathToFileURL(path.join(here, '..', 'docs', 'research', path.dirname(id), `${path.basename(id)}.html`)).href);
    const query = 'moment' in manifest.build ? `moment=${encodeURIComponent(manifest.build.moment)}` : `story=${encodeURIComponent(manifest.build.story)}`;
    await buildPage.goto(`/?fixture=boards&${query}`);
    await pressControls(buildPage, manifest.press);
    await buildPage.addStyleTag({ content: `html{word-spacing:${nudge}px !important}` });
    for (const page of [boardPage, buildPage]) await page.evaluate(() => document.fonts.ready);
    const board: Snapshot = await snapshotPage(boardPage, manifest, 'board');
    const build: Snapshot = await settledSnapshot(buildPage, manifest, 'build');
    return compareBoard(board, build, manifest).map((m) => m.message).filter(isPlace);
  } finally {
    await context.close();
  }
}

for (const name of manifests) {
  for (const [way, nudge] of Object.entries(NUDGES)) {
    test(`${FOLDER}/${name} keeps its places with its words set ${way}`, async ({ browser }, testInfo) => {
      const loaded = (await import(pathToFileURL(path.join(here, 'boards', FOLDER, `${name}.ts`)).href)) as { default: BoardManifest; phone?: BoardManifest };
      const baseURL = testInfo.project.use.baseURL;
      const problems = await compareSides(loaded.default, (side) => compareNudged(browser, baseURL, loaded.default.board, side, nudge));
      const phone = loaded.phone;
      if (phone) problems.push(...(await compareSides(phone, (side) => compareNudged(browser, baseURL, phone.board, side, nudge))).map((m) => `phone: ${m}`));
      expect(problems, `${name}: a part's place follows how a paragraph above it wraps`).toEqual([]);
    });
  }
}
