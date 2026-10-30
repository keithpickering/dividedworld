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

test('an instance with no ui folder adds none, and the real repository lists the Hold stories', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-stories-'));
  made.push(repo);
  fs.mkdirSync(path.join(repo, 'instances', 'bare'), { recursive: true });
  expect(instanceUis(repo)).toEqual([]);
  expect(boardStoryIds()).toContain('boards-08-hold--live-long-post');
});
