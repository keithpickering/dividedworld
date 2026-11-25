// @vitest-environment node
/**
 * The board stories' list (e2e/board-stories.ts) driven red on the defect it exists to catch: an instance's stories left
 * out because the glob over `instances/*\/ui` was dropped or narrowed. The a11y spec compares this list with the story
 * route's own, so a story missing from both would go unread; this holds that the list reads an instance's folder at all.
 * A Vitest file, not a Playwright spec, because it needs no browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { boardStoryIds, instanceUis } from './board-stories.ts';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

test('a story planted under an instance\'s ui folder is listed', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  const ui = path.join(repo, 'instances', 'planted', 'ui', 'deeper');
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, 'Planted.board.stories.tsx'), "const meta = { title: 'Boards/99 Planted' };\nexport const Seen = {};\n");
  const roots = instanceUis(repo);
  expect(roots).toEqual([path.join(repo, 'instances', 'planted', 'ui')]);
  expect(boardStoryIds(roots)).toEqual(['boards-99-planted--seen']);
});

test('a title in double quotes, as one with an apostrophe must be, is read, and the real repository lists Feelin\' Fab', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  const ui = path.join(repo, 'instances', 'planted', 'ui');
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, 'Quoted.board.stories.tsx'), 'const meta = { title: "Boards/98 Feelin\' Quoted" };\nexport const Seen = {};\n');
  expect(boardStoryIds(instanceUis(repo))).toEqual(['boards-98-feelin-quoted--seen']);
  expect(boardStoryIds()).toContain('boards-10-feelin-fab--twenty-light');
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['boards-20-below-the-fold--folded-light', 'boards-20-below-the-fold--folded-dark', 'boards-20-below-the-fold--opened-light', 'boards-20-below-the-fold--opened-dark', 'boards-20-below-the-fold--reduced']));
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['fresh-light', 'fresh-dark', 'thinning', 'long-post', 'reduced', 'parted', 'fold-under-smoke', 'degraded'].map((n) => `boards-24-hot-box--${n}`)));
});

test('an instance with no ui folder adds none, and the real repository lists the Hold stories', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  fs.mkdirSync(path.join(repo, 'instances', 'bare'), { recursive: true });
  expect(instanceUis(repo)).toEqual([]);
  expect(boardStoryIds()).toContain('boards-08-hold--live-long-post');
});

test('Graffiti\'s wall stories are listed, at the Main board\'s width and the Phone board\'s, over a splat and not', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['drawing', 'drawing-phone', 'under-a-splat', 'under-a-splat-phone'].map((n) => `boards-01-graffiti-wall--${n}`)));
});

test('the payout cards\' stories are listed, the Lens of each and the play form of each', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['skim', 'ride', 'ride-back', 'scored-as', 'skim-form', 'ride-back-form', 'scored-as-form'].map((n) => `boards-01-payout-cards--${n}`)));
});

test('the discipline cards\' stories are listed, a heart, a fall waiting, a fall taken and a character told on', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['a-heart', 'a-fall-waiting', 'a-fall-taken', 'told-on'].map((n) => `boards-01-lens-discipline-cards--${n}`)));
});

test('the caption bar\'s stories are listed, short, long and held on the Main and the Phone board', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['short', 'long', 'held'].flatMap((n) => [`boards-captions--${n}-main`, `boards-captions--${n}-phone`])));
});

test('Laugh Track\'s stories are listed, the thread on the Main and the Phone board, near a cue and after one is heard', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['main', 'phone', 'near-main', 'near-phone', 'heard-main', 'heard-phone'].map((n) => `boards-21-laugh-track--${n}`)));
});

test('Steel Chair\'s stories are listed, one chair on the light board and the dark, three, a short post and reduced motion', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['one-light', 'one-dark', 'three', 'short-post', 'short-three', 'reduced'].map((n) => `boards-25-steel-chair--${n}`)));
});

test('It\'s Curtains\' stories are listed: one curtain shut and opened, three stacked, with Below the Fold, over Steel Chair, reduced motion, forced colors, in the ORIGIN box, and the drumroll looped', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['one-shut', 'one-shut-dark', 'opened', 'three', 'with-below-the-fold', 'over-steel-chair', 'reduced', 'forced-colors', 'in-the-origin-box', 'drumroll-loop'].map((n) => `boards-28-it-s-curtains--${n}`)));
});

test('THIS\'s stories are listed, each on the Main board and the Phone one', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['two-notes', 'bare', 'receipt', 'taped', 'inked', 'fab'].flatMap((n) => [`boards-23-this--${n}-main`, `boards-23-this--${n}-phone`])));
});

test('the reply cut in under its post and Feelin\' Glam\'s stories are listed, each on the light board and the dark', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining([
    'boards-22-reply-cut-in--under-light', 'boards-22-reply-cut-in--under-dark',
    'boards-10-feelin-fab--glam-live-light', 'boards-10-feelin-fab--glam-live-dark', 'boards-10-feelin-fab--glam-over-light', 'boards-10-feelin-fab--glam-over-dark',
  ]));
});

test('the veil cards\' stories are listed: the posts for their author, a third reader and the caster, the stand-in\'s profile, Overreaction\'s play form and the worn-off line', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining([
    ...['veiled-and-blind', 'veiled-and-blind-phone', 'reader', 'caster', 'stand-in-profile'].map((n) => `boards-01-veiled-and-blind-posts--${n}`),
    'boards-01-reaction-card-form--form', 'boards-01-reaction-card-form--form-phone',
    'boards-22-whodunnit--wore-off-light', 'boards-22-whodunnit--wore-off-dark',
  ]));
});

test("the ORIGIN box's effect stories are listed: Whoops! live, landed and on a phone, Feelin' Fab plain and bright, Glitter Bomb as it was spun, Hot Box, Steel Chair long and short, and the box under its opening post's effects and under a glittered opening post", () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['whoops', 'whoops-landed', 'fab', 'fab-bright', 'glitter-spun', 'glitter-over', 'hot-box', 'chair', 'chair-short', 'under', 'whoops-phone', 'chair-over-whoops', 'chair-over-whoops-phone', 'hot-box-landed', 'hot-box-landed-phone', 'glitter-over-whoops', 'glitter-over-whoops-phone'].map((n) => `boards-26-origin-effects--${n}`)));
});

test('the effect budget stories are listed, a story for each effect on the tile layer and the two poisons, and the BUDGET map the file exports is not one', () => {
  const ids = boardStoryIds();
  expect(ids).toEqual(expect.arrayContaining(['hot-box', 'poison-slow', 'poison-whole'].map((n) => `boards-25-effect-budget--${n}`)));
  expect(ids).not.toContain('boards-25-effect-budget--budget');
});

test('an export a meta excludes is data and not a story', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  const ui = path.join(repo, 'instances', 'planted', 'ui');
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, 'Data.board.stories.tsx'), "export const DATA = {};\nconst meta = { title: 'Boards/97 Data', excludeStories: ['DATA', 'OTHER'] };\nexport const Seen = {};\n");
  expect(boardStoryIds(instanceUis(repo))).toEqual(['boards-97-data--seen']);
});

test('an excludeStories that is not an array of quoted names cannot be worked out, so it throws and does not list data as stories', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  const ui = path.join(repo, 'instances', 'planted', 'ui');
  fs.mkdirSync(ui, { recursive: true });
  for (const form of ['/^DATA/', '[...NAMES]', "['DATA', ...NAMES]"]) {
    fs.writeFileSync(path.join(ui, 'Data.board.stories.tsx'), `export const DATA = {};\nconst meta = { title: 'Boards/96 Data', excludeStories: ${form} };\nexport const Seen = {};\n`);
    expect(() => boardStoryIds(instanceUis(repo)), form).toThrow(/cannot work out the excluded exports/);
  }
});

test('an excludeStories array of quoted names, in either quote and over lines, is still honored', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  const ui = path.join(repo, 'instances', 'planted', 'ui');
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, 'Data.board.stories.tsx'), "export const DATA = {};\nexport const MORE = {};\nconst meta = {\n  title: 'Boards/95 Data',\n  excludeStories: [\n    'DATA',\n    \"MORE\",\n  ],\n};\nexport const Seen = {};\n");
  expect(boardStoryIds(instanceUis(repo))).toEqual(['boards-95-data--seen']);
});
