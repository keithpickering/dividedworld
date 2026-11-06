/**
 * The board match's self-test: the comparator (e2e/board-match.ts) driven red on each defect it
 * exists to catch, and on the tolerance's own edge both ways. A Vitest file, not a Playwright spec
 * (vitest.config.ts includes `e2e/**\/*.test.ts` and playwright.config.ts matches only `*.spec.ts`),
 * because it needs no browser: the snapshots are plain data. Each poison starts from a board and a
 * build that agree and breaks exactly one thing, so a comparator that has gone quiet cannot pass
 * the case that breaks it, and the first case asserts the agreeing pair is clean.
 *
 * It also holds the list function the spec uses (`boardsToRun`): a board with no manifest fails by
 * name, and a pending map that has gone stale fails, so a board cannot be left out by forgetting it.
 */
import { describe, expect, test } from 'vitest';
import { boardIds, boardsToRun, compareBoard, compareSides, phoneSizeProblems, screensWithoutBoards, type BoardManifest, type Landmark, type Shot, type Snapshot, type TypeRead } from './board-match.ts';

const BARLOW: TypeRead = { family: 'Barlow Condensed', size: 18, weight: 500, color: 'rgb(228, 222, 247)', letterSpacing: 0.4 };
const shot = (id: string, box: Shot['box'], type: TypeRead | null = BARLOW): Shot => (type ? { id, found: true, box, type } : { id, found: true, box });
const snap = (...shots: Shot[]): Snapshot => ({ shots });
const lm = (id: string, extra: Partial<Landmark> = {}): Landmark => ({ id, role: 'banner', name: id, ...extra });
const manifest = (...landmarks: Landmark[]): BoardManifest => ({ board: '01-main', size: { width: 1440, height: 1120 }, build: { moment: 'x' }, landmarks });

const BAR = { x: 0, y: 0, width: 1440, height: 84 };
const TAB: TypeRead = { ...BARLOW, size: 21, weight: 700 };
const board = snap(
  shot('menu-bar', BAR),
  shot('tab-boards', { x: 40, y: 20, width: 90, height: 44 }, TAB),
  shot('hud-menu', { x: 1300, y: 1060, width: 80, height: 40 }),
  shot('line', { x: 100, y: 200, width: 600, height: 24 }),
);
const all = manifest(lm('menu-bar'), lm('tab-boards'), lm('hud-menu'), lm('line'));
const withShot = (id: string, change: Partial<Shot>): Snapshot => snap(...board.shots.map((s) => (s.id === id ? { ...s, ...change } : s)));
const retype = (id: string, change: Partial<TypeRead>): Snapshot => snap(...board.shots.map((s) => (s.id === id ? { ...s, type: { ...s.type!, ...change } } : s)));
const moved = (id: string, by: Partial<{ x: number; y: number; width: number; height: number }>): Snapshot =>
  snap(...board.shots.map((s) => (s.id === id ? { ...s, box: { x: s.box!.x + (by.x ?? 0), y: s.box!.y + (by.y ?? 0), width: s.box!.width + (by.width ?? 0), height: s.box!.height + (by.height ?? 0) } } : s)));

describe('compareBoard: a build that matches its board', () => {
  test('is clean', () => {
    expect(compareBoard(board, board, all)).toEqual([]);
  });
});

describe('compareBoard: the poisons of the glass plan, section 2.3', () => {
  test('a menu bar 72px tall where the board\'s is 84px names the landmark, the field and both values', () => {
    const r = compareBoard(board, withShot('menu-bar', { box: { ...BAR, height: 72 } }), all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'menu-bar', field: 'height', board: '84', build: '72' });
    expect(r[0]!.message).toContain('menu-bar');
    expect(r[0]!.message).toContain('height');
    expect(r[0]!.message).toContain('84');
    expect(r[0]!.message).toContain('72');
  });

  test('a menu tab at 17px where the board\'s is 21px', () => {
    const r = compareBoard(board, retype('tab-boards', { size: 17 }), all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'tab-boards', field: 'font-size', board: '21', build: '17' });
  });

  test('the HUD with no Menu button is missing from the build', () => {
    const r = compareBoard(board, snap(...board.shots.filter((s) => s.id !== 'hud-menu'), { id: 'hud-menu', found: false }), all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'hud-menu', field: 'presence' });
    expect(r[0]!.message).toContain('missing from the build');
  });

  test('a snapshot with no shot at all for a landmark is missing from the build too', () => {
    const r = compareBoard(board, snap(...board.shots.filter((s) => s.id !== 'hud-menu')), all);
    expect(r.map((m) => m.message).join('\n')).toContain('hud-menu');
    expect(r.map((m) => m.message).join('\n')).toContain('missing from the build');
  });

  test('a body line in Arial where the board\'s is Barlow Condensed', () => {
    const r = compareBoard(board, retype('line', { family: 'Arial' }), all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'line', field: 'font-family', board: 'Barlow Condensed', build: 'Arial' });
  });

  test('a body line in #d9d3f0 where the board\'s is #e4def7', () => {
    const r = compareBoard(board, retype('line', { color: 'rgb(217, 211, 240)' }), all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'line', field: 'color' });
    expect(r[0]!.message).toContain('rgb(228, 222, 247)');
    expect(r[0]!.message).toContain('rgb(217, 211, 240)');
  });

  test('a box 9px off fails and 8px off passes: the tolerance\'s own edge, both ways', () => {
    expect(compareBoard(board, moved('line', { x: 8, y: -8 }), all)).toEqual([]);
    expect(compareBoard(board, moved('line', { width: 4, height: -4 }), all)).toEqual([]);
    const x = compareBoard(board, moved('line', { x: 9 }), all);
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ landmark: 'line', field: 'x', board: '100', build: '109' });
    expect(compareBoard(board, moved('line', { y: -9 }), all).map((m) => m.field)).toEqual(['y']);
    expect(compareBoard(board, moved('line', { width: 5 }), all).map((m) => m.field)).toEqual(['width']);
    expect(compareBoard(board, moved('line', { height: -5 }), all).map((m) => m.field)).toEqual(['height']);
  });

  test('a buildName that matches nothing in the build is a mismatch, never a silent skip', () => {
    const r = compareBoard(board, snap(...board.shots.filter((s) => s.id !== 'line'), { id: 'line', found: false }), manifest(lm('line', { buildName: 'Nothing like it' })));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'line', field: 'presence' });
    expect(r[0]!.message).toContain('missing from the build');
    expect(r[0]!.message).toContain('Nothing like it');
  });
});

describe('compareBoard: the rest of the rules', () => {
  test('a landmark missing on the board is a mismatch: the manifest is wrong', () => {
    const r = compareBoard(snap(...board.shots.filter((s) => s.id !== 'line'), { id: 'line', found: false }), board, all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'line', field: 'presence' });
    expect(r[0]!.message).toContain('missing on the board');
  });

  test('across compares x and width only, so a box moved down or made taller by a decision still holds its place and width across the page', () => {
    const across = manifest(lm('line', { box: 'across' }));
    expect(compareBoard(board, moved('line', { y: 80, height: 90 }), across)).toEqual([]);
    expect(compareBoard(board, moved('line', { x: 20 }), across).map((m) => m.field)).toEqual(['x']);
    expect(compareBoard(board, moved('line', { width: 30 }), across).map((m) => m.field)).toEqual(['width']);
  });

  test('position compares x and y only; height compares y and height only; none compares no box', () => {
    const wide = moved('line', { width: 200, height: 50 });
    expect(compareBoard(board, wide, manifest(lm('line', { box: 'position' })))).toEqual([]);
    expect(compareBoard(board, moved('line', { x: 20 }), manifest(lm('line', { box: 'position' }))).map((m) => m.field)).toEqual(['x']);
    expect(compareBoard(board, moved('line', { x: 50, width: 90, height: 5 }), manifest(lm('line', { box: 'height' }))).map((m) => m.field)).toEqual(['height']);
    expect(compareBoard(board, moved('line', { y: 30 }), manifest(lm('line', { box: 'height' }))).map((m) => m.field)).toEqual(['y']);
    expect(compareBoard(board, moved('line', { x: 500, y: 500, width: 500, height: 500 }), manifest(lm('line', { box: 'none' })))).toEqual([]);
  });

  test('type: false skips type and still compares the box', () => {
    const r = compareBoard(board, retype('line', { family: 'Arial', size: 3, color: 'rgb(0, 0, 0)' }), manifest(lm('line', { type: false })));
    expect(r).toEqual([]);
    expect(compareBoard(board, moved('line', { y: 20 }), manifest(lm('line', { type: false }))).map((m) => m.field)).toEqual(['y']);
  });

  test('weight must be equal, and the family is the first one named, compared without case', () => {
    expect(compareBoard(board, retype('line', { weight: 700 }), manifest(lm('line'))).map((m) => m.field)).toEqual(['font-weight']);
    expect(compareBoard(board, retype('line', { family: 'barlow condensed' }), manifest(lm('line')))).toEqual([]);
  });

  test('letter-spacing is within half a pixel', () => {
    expect(compareBoard(board, retype('line', { letterSpacing: 0.9 }), manifest(lm('line')))).toEqual([]);
    expect(compareBoard(board, retype('line', { letterSpacing: 0.91 }), manifest(lm('line'))).map((m) => m.field)).toEqual(['letter-spacing']);
  });

  test('a color is compared as an opaque value: rgba(...,1) and rgb(...) are one color, and a translucent one is a mismatch', () => {
    expect(compareBoard(board, retype('line', { color: 'rgba(228, 222, 247, 1)' }), manifest(lm('line')))).toEqual([]);
    const r = compareBoard(board, retype('line', { color: 'rgba(228, 222, 247, 0.8)' }), manifest(lm('line')));
    expect(r.map((m) => m.field)).toEqual(['color']);
    expect(r[0]!.message).toContain('translucent');
  });

  test('a landmark whose type should be compared but has no text in the build is a mismatch', () => {
    const r = compareBoard(board, snap(...board.shots.filter((s) => s.id !== 'line'), shot('line', { x: 100, y: 200, width: 600, height: 24 }, null)), manifest(lm('line')));
    expect(r.map((m) => m.field)).toEqual(['font']);
  });

  test('every mismatch of a landmark is reported, in manifest order', () => {
    const build = snap(...retype('menu-bar', { size: 1, weight: 100 }).shots.map((s) => (s.id === 'line' ? { ...s, box: { ...s.box!, x: 500 } } : s)));
    expect(compareBoard(board, build, manifest(lm('menu-bar'), lm('line'))).map((m) => `${m.landmark}:${m.field}`)).toEqual(['menu-bar:font-size', 'menu-bar:font-weight', 'line:x']);
  });
});

/*
 * A popover opens by the part of the page it belongs to, and a story's page under it is the build's
 * own (the React board's post is drawn, the build's is the thread's): the popover's parts are held to
 * its own corner (`origin`), and the popover to its size (`size`).
 */
describe('compareBoard: a landmark measured from another one, and one compared by its size', () => {
  const POP = { x: 236, y: 214, width: 540, height: 452 };
  const HEAD = { x: 257, y: 229, width: 104, height: 30 };
  const popBoard = snap(shot('pop', POP), shot('head', HEAD));
  const pop = manifest(lm('pop', { box: 'size' }), lm('head', { origin: 'pop' }));
  const shift = (by: { x: number; y: number }, s: Snapshot = popBoard) => snap(...s.shots.map((x) => ({ ...x, box: { ...x.box!, x: x.box!.x + by.x, y: x.box!.y + by.y } })));

  test('the whole popover moved, its parts with it, is clean', () => {
    expect(compareBoard(popBoard, shift({ x: -102, y: -36 }), pop)).toEqual([]);
  });

  test('a part 9px off within the popover fails, measured from the popover\'s corner, and 8px passes', () => {
    const moved9 = snap(shot('pop', { ...POP, x: POP.x - 102 }), shot('head', { ...HEAD, x: HEAD.x - 102 + 9 }));
    const r = compareBoard(popBoard, moved9, pop);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ landmark: 'head', field: 'x', board: '21', build: '30' });
    expect(r[0]!.message).toContain('from pop');
    const moved8 = snap(shot('pop', { ...POP, x: POP.x - 102 }), shot('head', { ...HEAD, x: HEAD.x - 102 + 8 }));
    expect(compareBoard(popBoard, moved8, pop)).toEqual([]);
  });

  test('a part\'s width and height are still compared in full', () => {
    const r = compareBoard(popBoard, snap(shot('pop', POP), shot('head', { ...HEAD, height: 40 })), pop);
    expect(r).toMatchObject([{ landmark: 'head', field: 'height', board: '30', build: '40' }]);
  });

  test('size compares the width and the height, and never the place', () => {
    expect(compareBoard(popBoard, snap(shot('pop', { ...POP, x: 0, y: 0 }), shot('head', { ...HEAD, x: HEAD.x - 236, y: HEAD.y - 214 })), pop)).toEqual([]);
    const r = compareBoard(popBoard, snap(shot('pop', { ...POP, height: 470 }), shot('head', HEAD)), pop);
    expect(r).toMatchObject([{ landmark: 'pop', field: 'height', board: '452', build: '470' }]);
  });

  test('an origin that is missing on either side is a mismatch, never a silent pass', () => {
    const r = compareBoard(popBoard, snap({ id: 'pop', found: false }, shot('head', HEAD)), pop);
    expect(r.map((m) => m.landmark)).toEqual(['pop', 'head']);
    expect(r[1]!.message).toContain('pop');
    const unknown = compareBoard(popBoard, popBoard, manifest(lm('pop', { box: 'size' }), lm('head', { origin: 'nowhere' })));
    expect(unknown).toMatchObject([{ landmark: 'head', field: 'origin' }]);
  });
});

/*
 * A part that flows under a block of words stands wherever those words end, and a browser's own text metrics can wrap them a
 * line shorter or longer (the Settlement's ways out under its Turn card: one line apart between CI's Chromium and a local one).
 * Measured from the bottom of the block (`originEdge: 'bottom'`), its place is the gap under the block, whatever the block's height.
 */
describe('compareBoard: a landmark measured from the bottom of another one', () => {
  const CARD = { x: 700, y: 600, width: 600, height: 180 };
  const WAY = { x: 1100, y: 812, width: 260, height: 60 };
  const drawn = snap(shot('card', CARD), shot('way', WAY));
  const under = manifest(lm('card', { box: 'none' }), lm('way', { origin: 'card', originEdge: 'bottom', box: 'height' }));

  test('a card a line taller, its way out with it, is clean', () => {
    expect(compareBoard(drawn, snap(shot('card', { ...CARD, height: 208 }), shot('way', { ...WAY, y: 840 })), under)).toEqual([]);
  });

  test('a card a line taller and its way out left where it was fails, and says it is measured from the card', () => {
    const r = compareBoard(drawn, snap(shot('card', { ...CARD, height: 208 }), shot('way', WAY)), under);
    expect(r).toMatchObject([{ landmark: 'way', field: 'y', board: '32', build: '4' }]);
    expect(r[0]!.message).toContain('from the bottom of card');
  });

  test('measured from the top, the same taller card fails where measured from the bottom it passes', () => {
    const top = manifest(lm('card', { box: 'none' }), lm('way', { origin: 'card', box: 'height' }));
    expect(compareBoard(drawn, snap(shot('card', { ...CARD, height: 208 }), shot('way', { ...WAY, y: 840 })), top)).toMatchObject([{ landmark: 'way', field: 'y' }]);
  });

  test('the gap is held to 8px: 9px further under the card fails, 8px passes, and a declared shift moves it', () => {
    expect(compareBoard(drawn, snap(shot('card', CARD), shot('way', { ...WAY, y: 821 })), under)).toMatchObject([{ landmark: 'way', field: 'y' }]);
    expect(compareBoard(drawn, snap(shot('card', CARD), shot('way', { ...WAY, y: 820 })), under)).toEqual([]);
    const shifted = manifest(lm('card', { box: 'none' }), lm('way', { origin: 'card', originEdge: 'bottom', box: 'height', buildShift: { y: -20 } }));
    expect(compareBoard(drawn, snap(shot('card', CARD), shot('way', { ...WAY, y: 792 })), shifted)).toEqual([]);
    expect(compareBoard(drawn, snap(shot('card', CARD), shot('way', WAY)), shifted)).toMatchObject([{ landmark: 'way', field: 'y' }]);
  });

  test('an edge with no origin is a mismatch in the manifest, never a silent pass', () => {
    const r = compareBoard(drawn, drawn, manifest(lm('card', { box: 'none' }), lm('way', { originEdge: 'bottom', box: 'height' })));
    expect(r).toMatchObject([{ landmark: 'way', field: 'origin' }]);
  });
});

describe('compareBoard: a place a decision moved off the board', () => {
  /* The shared dialog frame's bar holds Close, so the React picker's parts under it stand lower than the board's, which holds Close at the foot. */
  const LINE = { x: 100, y: 200, width: 600, height: 24 };
  const drawn = snap(shot('line', LINE));
  const lowered = (by: number) => snap(shot('line', { ...LINE, y: LINE.y + by }));

  test('a build 30px lower than the board fails without the shift, and passes with it declared', () => {
    expect(compareBoard(drawn, lowered(30), manifest(lm('line')))).toMatchObject([{ landmark: 'line', field: 'y' }]);
    expect(compareBoard(drawn, lowered(30), manifest(lm('line', { buildShift: { y: 30 } })))).toEqual([]);
  });

  test('the shift is held: a build 45px lower than a 30px shift fails, and the size is still compared', () => {
    expect(compareBoard(drawn, lowered(45), manifest(lm('line', { buildShift: { y: 30 } })))).toMatchObject([{ landmark: 'line', field: 'y' }]);
    expect(compareBoard(drawn, snap(shot('line', { ...LINE, y: 230, height: 40 })), manifest(lm('line', { buildShift: { y: 30 } })))).toMatchObject([{ landmark: 'line', field: 'height' }]);
  });

  test('a height the shift made taller is held the same way', () => {
    const tall = snap(shot('line', { ...LINE, height: 40 }));
    expect(compareBoard(drawn, tall, manifest(lm('line')))).toMatchObject([{ landmark: 'line', field: 'height' }]);
    expect(compareBoard(drawn, tall, manifest(lm('line', { buildShift: { height: 16 } })))).toEqual([]);
    expect(compareBoard(drawn, tall, manifest(lm('line', { buildShift: { height: 8 } })))).toMatchObject([{ landmark: 'line', field: 'height' }]);
  });

  test('a width the shift made wider is held the same way', () => {
    /* The type scale (the glass polish, design section 7) sets every board size token at 1.25 times, so a text's box is 1.25 times as wide as the board draws it. */
    const wide = snap(shot('line', { ...LINE, width: LINE.width + 30 }));
    expect(compareBoard(drawn, wide, manifest(lm('line')))).toMatchObject([{ landmark: 'line', field: 'width' }]);
    expect(compareBoard(drawn, wide, manifest(lm('line', { buildShift: { width: 30 } })))).toEqual([]);
    expect(compareBoard(drawn, wide, manifest(lm('line', { buildShift: { width: 20 } })))).toMatchObject([{ landmark: 'line', field: 'width' }]);
    expect(compareBoard(drawn, drawn, manifest(lm('line', { buildShift: { width: 30 } })))).toMatchObject([{ landmark: 'line', field: 'width' }]);
  });

  test('a height the shift made shorter is held the same way, with a negative height', () => {
    /* The Log's tab row is shorter in the build than on the board (e2e/boards/12-log.ts: height -6); 8px here, past the 4px tolerance. */
    const short = snap(shot('line', { ...LINE, height: 16 }));
    expect(compareBoard(drawn, short, manifest(lm('line')))).toMatchObject([{ landmark: 'line', field: 'height' }]);
    expect(compareBoard(drawn, short, manifest(lm('line', { buildShift: { height: -8 } })))).toEqual([]);
    expect(compareBoard(drawn, short, manifest(lm('line', { buildShift: { height: -2 } })))).toMatchObject([{ landmark: 'line', field: 'height' }]);
    expect(compareBoard(drawn, short, manifest(lm('line', { buildShift: { height: 8 } })))).toMatchObject([{ landmark: 'line', field: 'height' }]);
  });

  test('the shift applies to a part measured from an origin, on the build side only', () => {
    const pop = { x: 10, y: 10, width: 500, height: 400 };
    const b = snap(shot('pop', pop), shot('line', { ...LINE, x: 30, y: 40 }));
    const u = snap(shot('pop', pop), shot('line', { ...LINE, x: 30, y: 70 }));
    expect(compareBoard(b, u, manifest(lm('pop', { box: 'size' }), lm('line', { origin: 'pop', buildShift: { y: 30 } })))).toEqual([]);
    expect(compareBoard(b, u, manifest(lm('pop', { box: 'size' }), lm('line', { origin: 'pop' })))).toMatchObject([{ landmark: 'line', field: 'y' }]);
  });
});

describe('compareBoard: a size a decision moved off the board', () => {
  /* The React picker's quadrant labels are 24px where the board draws 22px, by the owner's answer on #54. */
  const at = (size: number) => snap(...board.shots.map((x) => (x.id === 'line' ? { ...x, type: { ...BARLOW, size } } : x)));
  const decided = manifest(lm('menu-bar'), lm('tab-boards'), lm('hud-menu'), lm('line', { buildSize: 24 }));

  test('the build at the decided size matches; the board keeps its own', () => {
    expect(compareBoard(at(22), at(24), decided)).toEqual([]);
  });

  test('a build still at the board\'s size no longer matches, so the decision is held', () => {
    expect(compareBoard(at(22), at(22), decided).map((m) => m.message)).toEqual(['line: font-size is 22 in the build, 24 by decision']);
  });
});

describe('boardsToRun: the folder\'s boards against the manifests and the pending map', () => {
  const folder = ['01-main.html', '02-phone.html', '03-react.html', 'README.md'];

  test('a board with a manifest runs, a pending board is listed, and a complete map has no problem', () => {
    expect(boardsToRun(folder, ['01-main', '02-phone'], { '03-react': 'Part 2' })).toEqual({ run: ['01-main', '02-phone'], pending: ['03-react'], problems: [] });
  });

  test('a board with no manifest that is not pending is a problem naming it', () => {
    const r = boardsToRun(folder, ['01-main'], { '03-react': 'Part 2' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('02-phone');
    expect(r.run).toEqual(['01-main']);
  });

  test('a pending board that has a manifest is a problem: the map went stale', () => {
    const r = boardsToRun(folder, ['01-main', '02-phone', '03-react'], { '03-react': 'Part 2' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('03-react');
    expect(r.problems[0]).toContain('Part 2');
  });

  test('a pending entry that names no board file is a problem', () => {
    const r = boardsToRun(folder, ['01-main', '02-phone'], { '03-react': 'Part 2', '99-ghost': 'Part 9' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('99-ghost');
  });

  test('a manifest that names no board file is a problem', () => {
    const r = boardsToRun(folder, ['01-main', '02-phone', '77-stray'], { '03-react': 'Part 2' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('77-stray');
  });

  test('only .html files are boards', () => {
    expect(boardsToRun(['01-main.html', 'README.md', 'notes.txt'], ['01-main'], {}).problems).toEqual([]);
  });
});

describe('boardIds: a board\'s id from its folder', () => {
  test('a .src.html beside its board is a generator source and gives one id', () => {
    const r = boardIds([{ name: 'a', files: ['01-x.html', '01-x.src.html', '01-x.png'] }], 1);
    expect(r.shared).toEqual([]);
    expect(r.boards).toEqual([{ id: '01-x', folder: 'a', file: '01-x.html' }]);
  });

  test('later folders each holding 05-admin.html give two ids, named by folder', () => {
    const r = boardIds([{ name: 'first', files: ['01-main.html'] }, { name: 'p', files: ['05-admin.html'] }, { name: 'c', files: ['05-admin.html'] }], 1);
    expect(r.shared).toEqual([]);
    expect(r.boards.map((b) => b.id)).toEqual(['01-main', 'p/05-admin', 'c/05-admin']);
  });

  test('a bare-id folder keeps the bare id, and two of them sharing a name is reported', () => {
    const r = boardIds([{ name: 'a', files: ['01-main.html'] }, { name: 'b', files: ['01-main.html'] }], 2);
    expect(r.boards.map((b) => b.id)).toEqual(['01-main']);
    expect(r.shared).toEqual(['01-main is drawn in two board folders']);
  });

  test('a later folder\'s board with neither a manifest nor a PENDING entry is a problem named by its id', () => {
    const ids = boardIds([{ name: 'a', files: ['01-main.html'] }, { name: 'later', files: ['14-sign-in.html', '15-register.html'] }], 1).boards.map((b) => `${b.id}.html`);
    const r = boardsToRun(ids, ['01-main'], { 'later/15-register': 'Task 6' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('later/14-sign-in');
    expect(r.pending).toEqual(['later/15-register']);
  });

  test('a PENDING entry with a manifest under a later folder is a problem', () => {
    const r = boardsToRun(['later/14-sign-in.html'], ['later/14-sign-in'], { 'later/14-sign-in': 'Task 6' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('later/14-sign-in');
  });

  test('a .src.html in the file list is not a board', () => {
    expect(boardsToRun(['01-main.html', '01-main.src.html'], ['01-main'], {}).problems).toEqual([]);
  });
});

describe('compareBoard: the color syntaxes a browser or a board may hand back', () => {
  const colored = (color: string): Snapshot => retype('line', { color });
  const colorOf = (a: string, b: string) => compareBoard(retype('line', { color: a }), retype('line', { color: b }), manifest(lm('line'))).map((m) => m.message);
  test('hex, short and long, equals the same rgb()', () => {
    expect(colorOf('#e4def7', 'rgb(228, 222, 247)')).toEqual([]);
    expect(colorOf('#fff', 'rgb(255, 255, 255)')).toEqual([]);
    expect(colorOf('#fff', 'rgb(255, 255, 254)')).toHaveLength(1);
  });
  test('the space syntax with a slash alpha is read, and an alpha below 1 is not an opaque match', () => {
    expect(colorOf('rgb(228 222 247)', 'rgb(228, 222, 247)')).toEqual([]);
    expect(colorOf('rgb(228 222 247 / 0.5)', 'rgb(228 222 247 / 0.5)')[0]).toMatch(/translucent/);
    expect(colorOf('rgb(228 222 247 / 100%)', 'rgb(228, 222, 247)')).toEqual([]);
  });
  test('percent channels scale to 255', () => {
    expect(colorOf('rgb(100%, 0%, 0%)', 'rgb(255, 0, 0)')).toEqual([]);
    expect(colorOf('rgb(100% 50% 0%)', 'rgb(255, 128, 0)')).toEqual([]);
    expect(colorOf('rgb(100%, 0%, 0%)', 'rgb(1, 0, 0)')).toHaveLength(1);
  });
  test('transparent is a translucent color, not an unreadable one', () => {
    expect(colorOf('transparent', 'transparent')[0]).toMatch(/translucent/);
    expect(colored('transparent').shots).toHaveLength(4);
  });
});

/*
 * A board that draws two screens at once (the Cards board's hand sheet and its play form) has a
 * further build side in `also`, compared on its own. The side loop is `compareSides`: each side is
 * read with its own landmarks and report folder, and a side's finding is led by the side's name.
 */
describe('compareSides: the further build sides of a board', () => {
  const sided: BoardManifest = {
    ...manifest(lm('sheet')),
    board: '05-cards',
    also: [{ name: 'play form', build: { moment: '05-cards' }, landmarks: [lm('dialog')] }],
  };
  /* A fake reader: the sheet agrees with its board, the play form's dialog does not. */
  const read = async (side: BoardManifest, folder: string, label: string | null) => {
    const seen = side.landmarks.map((l) => l.id).join(',');
    return seen === 'dialog' ? [`dialog: height is 40 in the build, 30 on the board (${folder}, ${label})`] : [];
  };

  test('a mismatch in a further side fails and is named with its side', async () => {
    const r = await compareSides(sided, read);
    expect(r).toEqual(['play form: dialog: height is 40 in the build, 30 on the board (05-cards-play form, play form)']);
  });

  test('every side is read, the board\'s own first with no label, each with its own landmarks', async () => {
    const calls: string[] = [];
    await compareSides(sided, async (side, folder, label) => { calls.push(`${folder}|${label}|${side.landmarks[0]!.id}|${side.also === undefined}`); return []; });
    expect(calls).toEqual(['05-cards|null|sheet|false', '05-cards-play form|play form|dialog|true']);
  });

  test('a board with no further side is read once', async () => {
    expect(await compareSides(manifest(lm('sheet')), async () => [])).toEqual([]);
  });
});

describe('screensWithoutBoards: every glass screen names a board or says why it has none', () => {
  const ids = ['01-main', 'later/14-sign-in'];
  const pending = { 'later/15-register': 'Task 6' };
  const screen = (name: string, board?: unknown) => (board === undefined ? { name } : { name, board }) as { name: string; board: string | { none: string } };

  test('screens naming boards, pending boards and honest reasons are clean', () => {
    expect(screensWithoutBoards([screen('A', '01-main'), screen('B', 'later/14-sign-in'), screen('C', 'later/15-register'), screen('D', { none: 'the board world waits for a pass of its own' })], ids, pending)).toEqual([]);
  });

  test('a screen with neither a board nor a reason is one problem naming it', () => {
    const r = screensWithoutBoards([screen('Lonely')], ids, pending);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('Lonely');
  });

  test('a board that is no board\'s id is one problem naming the screen and the id', () => {
    const r = screensWithoutBoards([screen('Typo', '14-sign-in')], ids, pending);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('Typo');
    expect(r[0]).toContain('14-sign-in');
  });

  test('a reason that is empty or only whitespace is one problem each', () => {
    const r = screensWithoutBoards([screen('Empty', { none: '' }), screen('Blank', { none: '  \n ' })], ids, pending);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain('Empty');
    expect(r[1]).toContain('Blank');
  });
});

describe('boardsToRun: a phone board whose manifest is another file\'s `phone` export', () => {
  const files = ['later/18-door-phone.html', 'later/17-front-door.html'];
  test('counts as having a manifest, and is not run on its own: its parent runs it', () => {
    const r = boardsToRun(files, ['later/17-front-door'], {}, ['later/18-door-phone']);
    expect(r).toEqual({ run: ['later/17-front-door'], pending: [], problems: [] });
  });

  test('without the phone export it still needs a manifest or PENDING', () => {
    const r = boardsToRun(files, ['later/17-front-door'], {});
    expect(r.problems).toEqual([expect.stringContaining('later/18-door-phone')]);
  });

  test('a phone board still in PENDING is a stale map, like any board with a manifest', () => {
    const r = boardsToRun(files, ['later/17-front-door'], { 'later/18-door-phone': 'Task 6' }, ['later/18-door-phone']);
    expect(r.problems).toEqual([expect.stringContaining('later/18-door-phone has a manifest and is still in PENDING')]);
  });

  test('a phone export naming no board file is a problem, and a board with both its own manifest and a phone export is one', () => {
    expect(boardsToRun(files, ['later/17-front-door'], {}, ['later/18-door-phone', 'later/99-ghost']).problems).toEqual([expect.stringContaining('later/99-ghost')]);
    expect(boardsToRun(files, ['later/17-front-door', 'later/18-door-phone'], {}, ['later/18-door-phone']).problems).toEqual([expect.stringContaining('later/18-door-phone')]);
  });
});

describe('phone boards: one export per board, at the phone size', () => {
  const files = ['later/17-front-door.html', 'later/18-door-phone.html', 'later/19-welcome.html'];
  test('two manifests whose phone export names the same board are a problem naming it', () => {
    const r = boardsToRun(files, ['later/17-front-door', 'later/19-welcome'], {}, ['later/18-door-phone', 'later/18-door-phone']);
    expect(r.problems).toEqual([expect.stringContaining('later/18-door-phone is the phone board of more than one manifest')]);
  });

  test('a phone export at 390 by 844 is clean; at 391 by 844 or 390 by 800 it is one problem each, naming its parent', () => {
    expect(phoneSizeProblems([{ parent: 'a', size: { width: 390, height: 844 } }])).toEqual([]);
    const r = phoneSizeProblems([{ parent: 'a', size: { width: 391, height: 844 } }, { parent: 'b', size: { width: 390, height: 800 } }]);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain('a');
    expect(r[1]).toContain('b');
  });
});
