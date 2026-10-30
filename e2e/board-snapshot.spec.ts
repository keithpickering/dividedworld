import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { BoardManifest, Landmark } from './board-match.ts';
import { pressControls, routeBoardFonts, settledSnapshot, snapshotPage, standInFaces } from './board-snapshot.ts';

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

test('the build side picks buildNth among its matches where it is given, nth otherwise', async ({ page }) => {
  await page.setContent(`<article aria-label="One">1</article><article aria-label="Two">2</article>`);
  const m = manifest(lm('two', { role: 'article', name: '', nth: 1, buildName: 'Two', buildNth: 0 }));
  expect((await snapshotPage(page, m, 'build')).shots[0]!.found).toBe(true);
});

test('the build is pressed in order before it is read, and a control that is not there fails by name', async ({ page }) => {
  await page.setContent(`<button onclick="document.querySelector('#b').hidden=false">Open</button>
    <button id="b" hidden onclick="this.textContent='Shut'">Close</button>`);
  await pressControls(page, [{ role: 'button', name: 'Open' }, { role: 'button', name: 'Close' }]);
  expect(await page.locator('#b').textContent()).toBe('Shut');
  await expect(pressControls(page, [{ role: 'button', name: 'Nowhere' }], 300)).rejects.toThrow(/button named "Nowhere"/);
});

test('a page that renders after it loads is read once every landmark is found and still', async ({ page }) => {
  await page.setContent(`<div id="r"></div><script>
    setTimeout(() => { document.querySelector('#r').innerHTML = '<button style="margin-top:0">Late</button>'; }, 150);
    setTimeout(() => { document.querySelector('#r button').style.marginTop = '90px'; }, 180);
  </script>`);
  const m = manifest(lm('late', { name: 'Late' }));
  const { shots } = await settledSnapshot(page, m, 'build', 3000);
  expect(shots[0]!.found).toBe(true);
  expect(shots[0]!.box!.y).toBeGreaterThan(80);
});

test('a page whose face is still loading is read once the face has loaded, not in the fallback', async ({ page }) => {
  const anton = fs.readFileSync(path.join(here, '..', 'instances', 'divided-world', 'ui', 'fonts', 'Anton-Regular.woff2'));
  await page.route('http://slow-font.test/**', async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: anton });
  });
  /* The face starts loading once the page has loaded, and lands well after two reads a frame apart could agree. */
  await page.setContent(`<button style="font: 40px 'Slow', monospace">Wide words here</button><script>
    setTimeout(() => { const face = new FontFace('Slow', 'url(http://slow-font.test/a.woff2)'); document.fonts.add(face); face.load(); }, 0);
  </script>`);
  const { shots } = await settledSnapshot(page, manifest(lm('w', { name: 'Wide words here' })), 'build', 3000);
  await page.evaluate(() => document.fonts.ready);
  const loaded = (await snapshotPage(page, manifest(lm('w', { name: 'Wide words here' })), 'build')).shots[0]!;
  expect(shots[0]!.box!.width).toBe(loaded.box!.width);
});

test('a page whose landmark never comes is read when the wait runs out, with the landmark not found', async ({ page }) => {
  await page.setContent(`<button>Here</button>`);
  const started = Date.now();
  const { shots } = await settledSnapshot(page, manifest(lm('gone'), lm('Here')), 'build', 400);
  expect(shots[0]!.found).toBe(false);
  expect(shots[1]!.found).toBe(true);
  expect(Date.now() - started).toBeLessThan(3000);
});

test('a text landmark is found by its own words, whole, without case and across the markup\'s line breaks, where a board drew a part with no role', async ({ page }) => {
  await page.setContent(`<style>.c{font-size:20px;color:rgb(7,8,9)}</style>
    <section aria-label="HUD"><div class="c">NEXT SETTLEMENT</div><div>07:42:10</div><div>Next settlement soon</div>
      <span>
        <svg aria-hidden="true" width="9" height="9"></svg>
        Only you
        see this
      </span><span aria-hidden="true" class="c">+0.30 est.</span></section>
    <div>Next settlement</div>`);
  const m = manifest(
    lm('hud', { role: 'region', name: 'HUD' }),
    lm('clock', { role: 'text', name: 'Next settlement', within: 'hud' }),
    lm('outside', { role: 'text', name: 'Next settlement', nth: 1, within: 'hud' }),
    lm('part', { role: 'text', name: 'Next' }),
    lm('padded', { role: 'text', name: 'Only you see this', within: 'hud' }),
    /* A figure hidden from the screen reader, because a name already says it, is still the text on screen. */
    lm('figure', { role: 'text', name: '+0.30 est.', within: 'hud' }),
  );
  const { shots } = await snapshotPage(page, m, 'board');
  expect(shots[1]!.found).toBe(true);
  expect(shots[1]!.type).toMatchObject({ size: 20, color: 'rgb(7, 8, 9)' });
  expect(shots[1]!.box!.y).toBeLessThan(shots[0]!.box!.y + 30);
  expect(shots[2]!.found).toBe(false);
  expect(shots[3]!.found).toBe(false);
  expect(shots[4]!.found).toBe(true);
  expect(shots[5]!.type).toMatchObject({ size: 20, color: 'rgb(7, 8, 9)' });
});

test('the system faces the boards name are set in one stand-in on both sides, whatever each side names after them', async ({ browser }) => {
  /*
   * A board and the build both name Verdana and Courier New first; where the machine has neither,
   * each falls back by its own list (the board's to sans-serif, the theme's to DejaVu Sans), and
   * the same words set at different widths. Both sides set in the same stand-in measure the same.
   */
  const context = await browser.newContext();
  await standInFaces(context);
  const page = await context.newPage();
  /* A navigation, as the boards' and the build's pages are, so the context's init script runs. */
  await page.goto(`data:text/html,${encodeURIComponent(`<span id="a" style="font:12px Verdana, Geneva, sans-serif">Index General</span><br>
<span id="b" style="font:12px Verdana, Geneva, 'DejaVu Sans', sans-serif">Index General</span><br>
<span id="c" style="font:bold 12px 'Courier New', monospace">DIVIDED WORLD</span><br>
<span id="d" style="font:bold 12px 'Courier New', 'Liberation Mono', monospace">DIVIDED WORLD</span>`)}`);
  await page.evaluate(() => document.fonts.ready);
  const width = (id: string) => page.locator(`#${id}`).evaluate((e) => e.getBoundingClientRect().width);
  expect(await width('a')).toBe(await width('b'));
  expect(await width('c')).toBe(await width('d'));
  await context.close();
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

test('the first text skips a visually hidden heading, which a screen reader hears and no eye sees', async ({ page }) => {
  await page.setContent(`<style>.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;font-size:30px} .n{font-size:12px;color:rgb(4,5,6)}</style>
    <article aria-label="Post 1"><h2 class="sr">Post 1 by Spritey</h2><a class="n" href="#">Spritey</a></article>`);
  const { shots } = await snapshotPage(page, manifest(lm('p', { role: 'article', name: 'Post 1' })), 'board');
  expect(shots[0]!.type).toMatchObject({ size: 12, color: 'rgb(4, 5, 6)' });
});

test('a landmark with no text has no type, and type:false skips reading it', async ({ page }) => {
  await page.setContent(`<button aria-label="Icon"><span aria-hidden="true">x</span></button>`);
  const { shots } = await snapshotPage(page, manifest(lm('i', { name: 'Icon' }), lm('j', { name: 'Icon', type: false })), 'board');
  expect(shots[0]!.found).toBe(true);
  expect(shots[0]!.type).toBeUndefined();
  expect(shots[1]!.type).toBeUndefined();
});

test('the fonts route answers the stylesheet and the files, by their own types, and refuses the rest', async ({ page }) => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-fonts-'));
  const root = path.join(outer, 'ui');
  fs.mkdirSync(root);
  /* Files that exist outside root: one above it, one in a sibling whose name starts with root's. */
  fs.writeFileSync(path.join(outer, 'outside.woff2'), 'outside');
  fs.mkdirSync(path.join(outer, 'ui-evil'));
  fs.writeFileSync(path.join(outer, 'ui-evil', 'sibling.woff2'), 'sibling');
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
        escape: await head('http://glass-fonts.test/..%2Foutside.woff2'),
        sibling: await head('http://glass-fonts.test/..%2Fui-evil%2Fsibling.woff2'),
        loaded: document.fonts.check('italic 700 16px "Test One"'),
      };
    });
    expect(result.css).toContain("format('woff2')");
    expect(result.css).toContain("format('opentype')");
    expect(result.one).toEqual({ status: 200, type: 'font/woff2' });
    expect(result.two).toEqual({ status: 200, type: 'font/otf' });
    expect(result.missing.status).toBe(404);
    expect(result.escape.status).toBe(404);
    expect(result.sibling.status).toBe(404);
    expect(result.loaded).toBe(true);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});
