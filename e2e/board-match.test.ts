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
import { boardsToRun, compareBoard, type BoardManifest, type Landmark, type Shot, type Snapshot, type TypeRead } from './board-match.ts';

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
