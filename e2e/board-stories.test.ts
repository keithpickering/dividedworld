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
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['boards-20-below-the-fold--folded-light', 'boards-20-below-the-fold--folded-dark', 'boards-20-below-the-fold--opened-light', 'boards-20-below-the-fold--opened-dark']));
});

test('an instance with no ui folder adds none, and the real repository lists the Hold stories', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  fs.mkdirSync(path.join(repo, 'instances', 'bare'), { recursive: true });
  expect(instanceUis(repo)).toEqual([]);
  expect(boardStoryIds()).toContain('boards-08-hold--live-long-post');
});

test('the payout cards\' stories are listed, the Lens of each and the play form of each', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['skim', 'ride', 'ride-back', 'scored-as', 'skim-form', 'ride-back-form', 'scored-as-form'].map((n) => `boards-01-payout-cards--${n}`)));
});

test('the caption bar\'s stories are listed, short, long and held on the Main and the Phone board', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['short', 'long', 'held'].flatMap((n) => [`boards-captions--${n}-main`, `boards-captions--${n}-phone`])));
});

test('Laugh Track\'s stories are listed, the thread on the Main and the Phone board, before and after a cue fires', () => {
  expect(boardStoryIds()).toEqual(expect.arrayContaining(['main', 'phone', 'on-the-line-main', 'on-the-line-phone'].map((n) => `boards-21-laugh-track--${n}`)));
});
