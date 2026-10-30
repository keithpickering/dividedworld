import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { boardsToRun, compareBoard, type BoardManifest, type Mismatch, type Snapshot } from './board-match.ts';
import { pressControls, routeBoardFonts, settledSnapshot, snapshotPage, standInFaces } from './board-snapshot.ts';

/**
 * The board match, end to end: each board the two-worlds session drew (docs/research/2026-10-29-two-worlds/)
 * opened beside the app at the same size, and the manifest's landmarks compared (e2e/board-match.ts).
 * The list of boards is the folder's, so a board with no manifest fails by name unless PENDING says
 * which part of the glass build builds it; a board in PENDING that has a manifest fails too, so the
 * map cannot go stale. The part that builds a board takes it out of PENDING in the same change that
 * writes its manifest (e2e/boards/<NN>-<name>.ts, a default-exported BoardManifest).
 *
 * The board's Google Fonts requests are routed to the instance's own files (the build serves the
 * same files itself), the system faces both name first are set in one stand-in where the machine
 * lacks them, and both pages are opened at device scale 1, reduced motion and in UTC: the boards
 * draw their times in UTC and the build shows the reader's own, so the browser's zone is pinned
 * rather than left to the machine's. The stand-in and the
 * report's outlines are styles put into the page, which the site's policy would refuse, so it is
 * set aside here (e2e/csp.spec.ts holds the policy). The build is
 * pressed where the manifest says the board draws a state reached by a press, and read once it has
 * rendered (e2e/board-snapshot.ts). A report goes to e2e/report/boards/<board>/ on a
 * pass as well as a failure: both screenshots with the manifest's boxes outlined, side by side in an
 * index.html with the mismatches listed, which CI uploads.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const BOARDS = path.join(here, '..', 'docs', 'research', '2026-10-29-two-worlds');
const MANIFESTS = path.join(here, 'boards');
const REPORT = path.join(here, 'report', 'boards');

/** The boards not built yet, each with the part of docs/plans/2026-10-30-glass-build-plan.md that builds it. */
const PENDING: Readonly<Record<string, string>> = {
  '09-settlement': 'Part 4',
  '12-log': 'Part 4',
};

const folder = fs.readdirSync(BOARDS);
const manifestIds = fs.existsSync(MANIFESTS) ? fs.readdirSync(MANIFESTS).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)) : [];
const { run, problems } = boardsToRun(folder, manifestIds, PENDING);

test('every board has a manifest or is pending, and the pending map is not stale', () => {
  expect(problems).toEqual([]);
});

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Draw each found landmark's box on the page, labeled, so the screenshot shows what was compared. */
async function outline(page: Page, boxes: readonly { id: string; box: { x: number; y: number; width: number; height: number } }[]) {
  await page.evaluate((list) => {
    for (const { id, box } of list) {
      const frame = document.createElement('div');
      frame.style.cssText = `position:absolute;left:${box.x + scrollX}px;top:${box.y + scrollY}px;width:${box.width}px;height:${box.height}px;outline:2px solid #ff2d95;pointer-events:none;z-index:2147483647;box-sizing:border-box`;
      const label = document.createElement('span');
      label.textContent = id;
      label.style.cssText = 'position:absolute;left:0;top:0;font:10px monospace;background:#ff2d95;color:#fff;padding:0 2px;line-height:12px';
      frame.append(label);
      document.body.append(frame);
    }
  }, boxes);
}

function reportPage(board: string, mismatches: readonly Mismatch[], error?: string): string {
  const rows = (error === undefined ? '' : `<li><code>${escapeHtml(`the run failed before it could compare: ${error}`)}</code></li>`) + mismatches.map((m) => `<li><code>${escapeHtml(m.message)}</code></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(board)}: board and build</title>
<style>body{font:14px system-ui;margin:16px}.pair{display:flex;gap:16px;align-items:flex-start;overflow:auto}figure{margin:0}img{border:1px solid #888;display:block;max-width:none}figcaption{font-weight:700;margin-bottom:4px}</style>
<h1>${escapeHtml(board)}</h1>
<h2>${error !== undefined ? 'The run failed' : mismatches.length ? `${mismatches.length} mismatch(es)` : 'No mismatch'}</h2><ul>${rows}</ul>
<div class="pair"><figure><figcaption>Board</figcaption><img src="board.png" alt="The board"></figure><figure><figcaption>Build</figcaption><img src="build.png" alt="The build"></figure></div>`;
}

for (const id of run) {
  test(`${id} matches its board`, async ({ browser }, testInfo) => {
    const manifest = (await import(pathToFileURL(path.join(MANIFESTS, `${id}.ts`)).href) as { default: BoardManifest }).default;
    expect(manifest.board).toBe(id);
    const baseURL = testInfo.project.use.baseURL;
    const context = await browser.newContext({ baseURL, viewport: manifest.size, deviceScaleFactor: 1, reducedMotion: 'reduce', timezoneId: 'UTC', bypassCSP: true });
    try {
      await standInFaces(context);
      const boardPage = await context.newPage();
      const buildPage = await context.newPage();
      let mismatches: Mismatch[] = [];
      const shots = { board: { shots: [] } as Snapshot, build: { shots: [] } as Snapshot };
      const dir = path.join(REPORT, id);
      /* The report is written whether the pages loaded or not, with the error in it. */
      let failure: unknown;
      try {
        await routeBoardFonts(boardPage);
        await boardPage.goto(pathToFileURL(path.join(BOARDS, `${id}.html`)).href);
        const query = 'moment' in manifest.build ? `moment=${encodeURIComponent(manifest.build.moment)}` : `story=${encodeURIComponent(manifest.build.story)}`;
        await buildPage.goto(`/?fixture=boards&${query}`);
        await pressControls(buildPage, manifest.press);
        for (const page of [boardPage, buildPage]) await page.evaluate(() => document.fonts.ready);
        shots.board = await snapshotPage(boardPage, manifest, 'board');
        shots.build = await settledSnapshot(buildPage, manifest, 'build');
        mismatches = compareBoard(shots.board, shots.build, manifest);
      } catch (error) {
        failure = error;
      } finally {
        fs.mkdirSync(dir, { recursive: true });
        for (const [page, snap, file] of [[boardPage, shots.board, 'board.png'], [buildPage, shots.build, 'build.png']] as const) {
          try {
            await outline(page, snap.shots.flatMap((s) => (s.found && s.box ? [{ id: s.id, box: s.box }] : [])));
            await page.screenshot({ path: path.join(dir, file), fullPage: true });
          } catch { /* a page that never loaded has no screenshot; the error below says why */ }
        }
        fs.writeFileSync(path.join(dir, 'index.html'), reportPage(id, mismatches, failure === undefined ? undefined : String(failure instanceof Error ? failure.message : failure)));
      }
      if (failure !== undefined) throw failure;

      expect(mismatches.map((m) => m.message), `${id} differs from its board; see e2e/report/boards/${id}/index.html`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
