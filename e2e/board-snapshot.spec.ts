import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { BoardManifest, Landmark } from './board-match.ts';
import { routeBoardFonts, snapshotPage } from './board-snapshot.ts';

/**
 * The board snapshot's self-test: e2e/board-snapshot.ts read over pages built in place with
 * `setContent`, so it needs the browser but none of the boards and none of the app (the config
 * starts the web server for every spec, which these ignore). Each case plants the defect the
 * reader exists to catch: a name matched with the wrong case or past a decorative glyph, a name
 * holding regex specials, a landmark searched outside its `within` or at the wrong `nth`, a first
 * text taken from a subtree no one sees, a landmark that is not there, a font route that serves
 * the wrong type.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = (...landmarks: Landmark[]): BoardManifest => ({ board: 'x', size: { width: 800, height: 600 }, build: { moment: 'x' }, landmarks });
const lm = (id: string, extra: Partial<Landmark> = {}): Landmark => ({ id, role: 'button', name: id, ...extra });

test('a name is matched whole and without case, and an aria-hidden glyph is not part of it', async ({ page }) => {
  await page.setContent(`<button><span aria-hidden="true">+</span> New Thread</button><button>New Thread Extra</button>`);
  const { shots } = await snapshotPage(page, manifest(lm('a', { name: 'new thread' }), lm('b', { name: 'New' })), 'board');
  expect(shots[0]!.found).toBe(true);
  expect(shots[1]!.found).toBe(false);
});

test('a name with regex specials is matched as text', async ({ page }) => {
  await page.setContent(`<button>Whoops! (1)</button><button>Whoops!  1</button>`);
  const { shots } = await snapshotPage(page, manifest(lm('w', { name: 'Whoops! (1)' })), 'board');
  expect(shots[0]!.found).toBe(true);
  expect(shots[0]!.box!.width).toBeGreaterThan(0);
});

test('the build side searches buildName, the board side name', async ({ page }) => {
  await page.setContent(`<button>Alpha</button>`);
  const m = manifest(lm('a', { name: 'Beta', buildName: 'Alpha' }));
  expect((await snapshotPage(page, m, 'board')).shots[0]!.found).toBe(false);
  expect((await snapshotPage(page, m, 'build')).shots[0]!.found).toBe(true);
});

test('within scopes the search to the found landmark, and nth picks among matches', async ({ page }) => {
  await page.setContent(`<button>Go</button><nav aria-label="Side"><button>Go</button><button>Go</button></nav>`);
  const m = manifest(
    lm('side', { role: 'navigation', name: 'Side' }),
    lm('inside', { name: 'Go', within: 'side', nth: 1 }),
    lm('first', { name: 'Go' }),
    lm('lost', { name: 'Go', within: 'nowhere' }),
  );
  const { shots } = await snapshotPage(page, m, 'board');
  const side = shots[0]!.box!;
  expect(shots[1]!.found).toBe(true);
  expect(shots[1]!.box!.y).toBeGreaterThanOrEqual(side.y);
  expect(shots[1]!.box!.y + shots[1]!.box!.height).toBeLessThanOrEqual(side.y + side.height + 0.5);
  expect(shots[2]!.box!.y).toBeLessThan(side.y);
  expect(shots[3]!.found).toBe(false);
});

test('a missing landmark is reported as not found, with no box', async ({ page }) => {
  await page.setContent(`<button>Here</button>`);
  const { shots } = await snapshotPage(page, manifest(lm('gone')), 'board');
  expect(shots).toEqual([{ id: 'gone', found: false }]);
});

test('the first text skips an aria-hidden subtree and hidden spans ahead of the visible label', async ({ page }) => {
  await page.setContent(`<style>.a{font-size:30px;color:rgb(1,2,3)} .l{font-size:18px;color:rgb(4,5,6)}</style>
    <button><span aria-hidden="true"><b class="a">glyph</b></span><span class="a" style="display:none">none</span><span class="a" style="visibility:hidden">hidden</span><span class="l">Label</span></button>
    <button><span aria-hidden="true" class="a">only a glyph</span></button>`);
  const { shots } = await snapshotPage(page, manifest(lm('a', { name: 'Label' }), lm('b', { name: '' })), 'board');
  expect(shots[0]!.type).toMatchObject({ size: 18, color: 'rgb(4, 5, 6)' });
  expect(shots[1]!.found).toBe(true);
  expect(shots[1]!.type).toBeUndefined();
});

test('a landmark with no text has no type, and type:false skips reading it', async ({ page }) => {
  await page.setContent(`<button aria-label="Icon"><span aria-hidden="true">x</span></button>`);
  const { shots } = await snapshotPage(page, manifest(lm('i', { name: 'Icon' }), lm('j', { name: 'Icon', type: false })), 'board');
  expect(shots[0]!.found).toBe(true);
  expect(shots[0]!.type).toBeUndefined();
  expect(shots[1]!.type).toBeUndefined();
});

test('the fonts route answers the stylesheet and the files, by their own types, and refuses the rest', async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-ui-'));
  try {
    const woff2 = path.join(here, '..', 'node_modules', 'storybook', 'assets', 'browser', 'nunito-sans-bold-italic.woff2');
    fs.copyFileSync(woff2, path.join(root, 'Face One.woff2'));
    fs.writeFileSync(path.join(root, 'Face2.otf'), 'not a real font');
    fs.writeFileSync(path.join(root, 'glass.json'), JSON.stringify({ fonts: [
      { family: 'Test One', file: 'Face One.woff2', weight: 700, style: 'italic' },
      { family: 'Test Two', file: 'Face2.otf', weight: 400, style: 'normal' },
    ] }));
    await routeBoardFonts(page, root);
    await page.setContent('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Test"><p style="font-family:\'Test One\'">hello</p>');
    const result = await page.evaluate(async () => {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Test')).text();
      const head = async (u: string) => { const r = await fetch(u); return { status: r.status, type: r.headers.get('content-type') }; };
      await document.fonts.load('italic 700 16px "Test One"');
      return {
        css,
        one: await head('http://glass-fonts.test/Face%20One.woff2'),
        two: await head('http://glass-fonts.test/Face2.otf'),
        missing: await head('http://glass-fonts.test/nope.woff2'),
        escape: await head('http://glass-fonts.test/..%2Fglass.json'),
        loaded: document.fonts.check('italic 700 16px "Test One"'),
      };
    });
    expect(result.css).toContain("format('woff2')");
    expect(result.css).toContain("format('opentype')");
    expect(result.one).toEqual({ status: 200, type: 'font/woff2' });
    expect(result.two).toEqual({ status: 200, type: 'font/otf' });
    expect(result.missing.status).toBe(404);
    expect(result.escape.status).toBe(404);
    expect(result.loaded).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
