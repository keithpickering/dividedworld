import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { boardIds, boardsToRun, compareBoard, compareSides, phoneSizeProblems, screensWithoutBoards, type BoardManifest, type Mismatch, type Snapshot } from './board-match.ts';
import { FIXTURE_OVERLAYS, OVERLAYS, PAGES, STORIES } from './glass-screens.ts';
import { loadFaces } from './fonts.ts';
import { pressControls, routeBoardFonts, settledSnapshot, snapshotPage, standInFaces } from './board-snapshot.ts';

/**
 * The board match, end to end: each board the two-worlds session drew (docs/research/2026-10-29-two-worlds/), the
 * alerts session (docs/research/2026-11-02-alerts/) and the later sessions (docs/research/2026-11-04-booster-packs/,
 * 2026-11-04-cosmetics/, 2026-11-05-card-template/, 2026-11-05-backfill/ and 2026-11-06-board-look/) opened beside the app at the same size, and the manifest's landmarks compared (e2e/board-match.ts).
 * The list of boards is the folder's, so a board with no manifest fails by name unless PENDING says
 * which plan, and which task of it, builds it; a board in PENDING that has a manifest fails too, so the
 * map cannot go stale; COLORS_ONLY lists the boards that never have one, and one that gains a manifest fails. The task that builds a board takes it out of PENDING in the same change that
 * writes its manifest (e2e/boards/<NN>-<name>.ts, a default-exported BoardManifest; for a board in a folder after the
 * first two, e2e/boards/<folder>/<NN>-<name>.ts, and its id is <folder>/<NN>-<name>). A manifest may also export `phone`, a
 * BoardManifest for the same board's phone drawing, compared at 390 by 844 (PHONE_SIZE); that phone board has no manifest file of
 * its own, one parent names it, and its report goes under the phone board's own id. Every glass screen (e2e/glass-screens.ts) names
 * the board it is held to or says why it has none, which the second test checks.
 *
 * The board's Google Fonts requests are routed to the instance's own files (the build serves the
 * same files itself), the system faces both name first are set in one stand-in where the machine
 * lacks them, and both pages are opened at device scale 1, reduced motion and in UTC: the boards
 * draw their times in UTC and the build shows the reader's own, so the browser's zone is pinned
 * rather than left to the machine's. The stand-in and the
 * report's outlines are styles put into the page, which the site's policy would refuse, so it is
 * set aside here (e2e/csp.spec.ts holds the policy). The build is
 * pressed where the manifest says the board draws a state reached by a press, and read once it has
 * rendered (e2e/board-snapshot.ts). A report goes to e2e/report/boards/<board id>/ on a
 * pass as well as a failure: both screenshots with the manifest's boxes outlined, side by side in an
 * index.html with the mismatches listed, which CI uploads.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
/*
 * The boards' folders, in the order the sessions drew them. The two-worlds boards are a record and are not edited; the alerts
 * design's (docs/plans/2026-11-02-alerts-design.md) are drawn over them and revise some of what they show, which the old boards'
 * manifests say where they compare it. The folders after them are the booster packs, cosmetics and card template designs (built later,
 * so every board of theirs is pending), the backfill's and the board look's (each of whose boards is pending until the task that builds it writes its manifest; a dark board has none, since it is compared on colors only by web/contrast.test.tsx). A board in the first BARE_FOLDERS folders has its file name as its id, so no
 * two of them may hold the same one (checked below); a board in a later folder is <folder>/<file name>, since two of them draw a
 * 05-admin.html. A `.src.html` is a generator's source, not a board.
 */
const BOARD_FOLDERS = [
  path.join(here, '..', 'docs', 'research', '2026-10-29-two-worlds'),
  path.join(here, '..', 'docs', 'research', '2026-11-02-alerts'),
  path.join(here, '..', 'docs', 'research', '2026-11-04-booster-packs'),
  path.join(here, '..', 'docs', 'research', '2026-11-04-cosmetics'),
  path.join(here, '..', 'docs', 'research', '2026-11-05-card-template'),
  path.join(here, '..', 'docs', 'research', '2026-11-05-backfill'),
  path.join(here, '..', 'docs', 'research', '2026-11-06-board-look'),
];
const BARE_FOLDERS = 2;
const MANIFESTS = path.join(here, 'boards');
const REPORT = path.join(here, 'report', 'boards');

/**
 * The boards not built yet, each with the plan, and its task, that builds it (a design not planned task by task yet names its
 * plan alone). A board of a later folder is <folder>/<name>, and its manifest's `board` is that whole id.
 */
const PENDING: Readonly<Record<string, string>> = {
  '2026-11-04-booster-packs/01-machine': 'docs/plans/2026-11-04-booster-packs-plan.md',
  '2026-11-04-booster-packs/02-reveal': 'docs/plans/2026-11-04-booster-packs-plan.md',
  '2026-11-04-booster-packs/03-hit': 'docs/plans/2026-11-04-booster-packs-plan.md',
  '2026-11-04-booster-packs/04-phone': 'docs/plans/2026-11-04-booster-packs-plan.md',
  '2026-11-04-booster-packs/05-admin': 'docs/plans/2026-11-04-booster-packs-plan.md',
  '2026-11-04-cosmetics/01-postbit': 'docs/plans/2026-11-04-cosmetics-plan.md',
  '2026-11-04-cosmetics/02-dressup': 'docs/plans/2026-11-04-cosmetics-plan.md',
  '2026-11-04-cosmetics/03-trophy-case': 'docs/plans/2026-11-04-cosmetics-plan.md',
  '2026-11-04-cosmetics/04-event': 'docs/plans/2026-11-04-cosmetics-plan.md',
  '2026-11-04-cosmetics/05-admin': 'docs/plans/2026-11-04-cosmetics-plan.md',
  '2026-11-05-card-template/01-layouts': 'docs/plans/2026-11-05-card-template-plan.md',
  '2026-11-05-backfill/34-vending-info': 'docs/plans/2026-11-05-card-template-plan.md (the card info, backfill Task 11)',
  '2026-11-06-board-look/02-board': 'docs/plans/2026-11-06-board-look-plan.md (Task 5)',
  '2026-11-06-board-look/03-phone': 'docs/plans/2026-11-06-board-look-plan.md (Task 8)',
  '2026-11-06-board-look/04-thread': 'docs/plans/2026-11-06-board-look-plan.md (Task 6)',
  '2026-11-06-board-look/05-reply': 'docs/plans/2026-11-06-board-look-plan.md (Task 6)',
  '2026-11-06-board-look/06-new-thread': 'docs/plans/2026-11-06-board-look-plan.md (Task 7)',
  '2026-11-06-board-look/07-phone': 'docs/plans/2026-11-06-board-look-plan.md (Task 8)',
  '2026-11-06-board-look/08-profile': 'docs/plans/2026-11-06-board-look-plan.md (Task 9)',
  '2026-11-06-board-look/09-record': 'docs/plans/2026-11-06-board-look-plan.md (Task 9)',
  '2026-11-06-board-look/10-phone': 'docs/plans/2026-11-06-board-look-plan.md (Task 8)',
  '2026-11-06-board-look/11-move-notice': 'docs/plans/2026-11-06-board-look-plan.md (Task 10)',
  '2026-11-06-board-look/14-staff': 'docs/plans/2026-11-06-board-look-plan.md (Task 10)',
  '2026-11-06-board-look/15-phone': 'docs/plans/2026-11-06-board-look-plan.md (Task 10)',
  '2026-11-06-board-look/16-not-found': 'docs/plans/2026-11-06-board-look-plan.md (Task 13)',
  '2026-11-06-board-look/17-cannot-display': 'docs/plans/2026-11-06-board-look-plan.md (Task 13)',
  '2026-11-06-board-look/18-phone': 'docs/plans/2026-11-06-board-look-plan.md (Task 13)',
  '2026-11-06-board-look/19-theme-picker': 'docs/plans/2026-11-06-board-look-plan.md (Task 16)',
  '2026-11-06-board-look/20-theme-picker-one-mode': 'docs/plans/2026-11-06-board-look-plan.md (Task 16)',
  '2026-11-06-board-look/21-theme-picker-phone': 'docs/plans/2026-11-06-board-look-plan.md (Task 16)',
};

/**
 * The boards that never have a manifest, each with why: a dark twin is held to its colors by web/contrast.test.tsx, and a reference
 * drawing is looked at. Kept apart from PENDING so a never-board cannot sit unnoticed among the ones a task will build; one that gains a
 * manifest fails, and so does one that is also pending.
 */
const COLORS_ONLY: Readonly<Record<string, string>> = {
  '2026-11-06-board-look/00-look': 'the tribute looks reference (Task 17 switches one board to each look), never a manifest',
  '2026-11-06-board-look/01-index-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/02-board-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/04-thread-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/05-reply-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/06-new-thread-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/08-profile-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/09-record-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/11-move-notice-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/14-staff-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/16-not-found-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
  '2026-11-06-board-look/17-cannot-display-dark': 'the dark twin of the board before it, held to its colors by web/contrast.test.tsx, never a manifest',
};

/** Where each board's file is, by its id; a bare id two of the first folders share is a problem the first test reports. */
const { boards, shared } = boardIds(BOARD_FOLDERS.map((dir) => ({ name: path.basename(dir), files: fs.readdirSync(dir) })), BARE_FOLDERS);
const boardFile = new Map(boards.map((b) => [b.id, path.join(BOARD_FOLDERS.find((d) => path.basename(d) === b.folder)!, b.file)]));
const folder = boards.map((b) => `${b.id}.html`);
/** A manifest is e2e/boards/<name>.ts, or e2e/boards/<folder>/<name>.ts for a board of a later folder (one level down). */
const manifestIds: string[] = [];
if (fs.existsSync(MANIFESTS)) {
  for (const entry of fs.readdirSync(MANIFESTS, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const f of fs.readdirSync(path.join(MANIFESTS, entry.name))) if (f.endsWith('.ts')) manifestIds.push(`${entry.name}/${f.slice(0, -3)}`);
    } else if (entry.name.endsWith('.ts')) manifestIds.push(entry.name.slice(0, -3));
  }
}

/**
 * A manifest module may also export `phone`, the same board's phone drawing, compared at 390 by 844 (the board's id is that manifest's
 * `board`). That board has no file of its own in e2e/boards/, so the modules are read here for the ids their `phone` exports name.
 */
const loadManifest = async (id: string) => (await import(pathToFileURL(path.join(MANIFESTS, `${id}.ts`)).href)) as { default: BoardManifest; phone?: BoardManifest };
const phoneOf = new Map<string, BoardManifest>();
for (const id of manifestIds) {
  const phone = (await loadManifest(id)).phone;
  if (phone) phoneOf.set(id, phone);
}
const phoneIds = [...phoneOf.values()].map((p) => p.board);
const { run, problems } = boardsToRun(folder, manifestIds, PENDING, phoneIds, COLORS_ONLY);
problems.push(...phoneSizeProblems([...phoneOf].map(([parent, phone]) => ({ parent, size: phone.size }))));

test('every board has a manifest or is pending, and the pending map is not stale, and a colors-only board has none', () => {
  expect([...shared, ...problems]).toEqual([]);
});

test('every glass screen names the board it is held to, or says why it has none', () => {
  const screens = [...PAGES, ...OVERLAYS, ...FIXTURE_OVERLAYS, ...STORIES];
  expect(screensWithoutBoards(screens, boards.map((b) => b.id), PENDING, COLORS_ONLY)).toEqual([]);
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

/**
 * One build side of a board compared with the board page: both pages opened at the board's size, the
 * build pressed to its state, both read, and the report written. Returns the mismatches' words;
 * `compareSides` (e2e/board-match.ts) leads a further side's with its name (`BoardManifest.also`).
 */
async function compareSide(browser: Browser, baseURL: string | undefined, id: string, manifest: BoardManifest, folder: string): Promise<string[]> {
  const context = await browser.newContext({ baseURL, viewport: manifest.size, deviceScaleFactor: 1, reducedMotion: 'reduce', timezoneId: 'UTC', bypassCSP: true });
  try {
    await standInFaces(context);
    const boardPage = await context.newPage();
    const buildPage = await context.newPage();
    let mismatches: Mismatch[] = [];
    const shots = { board: { shots: [] } as Snapshot, build: { shots: [] } as Snapshot };
    const dir = path.join(REPORT, folder);
    /* The report is written whether the pages loaded or not, with the error in it. */
    let failure: unknown;
    try {
      await routeBoardFonts(boardPage);
      await boardPage.goto(pathToFileURL(boardFile.get(id)!).href);
      const query = 'moment' in manifest.build ? `moment=${encodeURIComponent(manifest.build.moment)}` : `story=${encodeURIComponent(manifest.build.story)}`;
      await buildPage.goto(`/?fixture=boards&${query}`);
      await pressControls(buildPage, manifest.press);
      for (const page of [boardPage, buildPage]) await loadFaces(page);
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
      fs.writeFileSync(path.join(dir, 'index.html'), reportPage(folder, mismatches, failure === undefined ? undefined : String(failure instanceof Error ? failure.message : failure)));
    }
    if (failure !== undefined) throw failure;
    return mismatches.map((m) => m.message);
  } finally {
    await context.close();
  }
}

for (const id of run) {
  test(`${id} matches its board`, async ({ browser }, testInfo) => {
    const { default: manifest, phone } = await loadManifest(id);
    expect(manifest.board).toBe(id);
    const baseURL = testInfo.project.use.baseURL;
    /* The board's own build side, then each further one (the Cards board's play form is the app, its hand sheet a story). */
    const mismatches = await compareSides(manifest, (side, folder) => compareSide(browser, baseURL, id, side, folder));
    /* The same board's phone drawing, at 390 by 844, against the phone board its manifest names. */
    if (phone) mismatches.push(...(await compareSides(phone, (side, folder) => compareSide(browser, baseURL, phone.board, side, folder))).map((m) => `phone: ${m}`));
    const reports = phone ? `e2e/report/boards/${id}/index.html, and for a phone: line, e2e/report/boards/${phone.board}/index.html` : `e2e/report/boards/${id}/index.html`;
    expect(mismatches, `${id} differs from its board; see ${reports}`).toEqual([]);
  });
}
