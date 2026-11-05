import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

/**
 * The board on a device that has none of the families its body stack names (Verdana, Geneva, DejaVu
 * Sans), as an Android phone has none: the board is set in the DejaVu Sans the instance serves
 * (instances/divided-world/ui/index.ts, engine/ui/fonts.ts), in its regular and its bold, and not in
 * the device's own sans-serif, which on Android is Roboto.
 *
 * The device is a Chromium whose fontconfig holds one font of its own, Liberation Sans, standing for
 * the phone's sans-serif (Chromium's renderer will not start with none; Playwright's Linux
 * dependencies install it), so a DejaVu Sans the page shows is one the page served. What the text was drawn in is read from the
 * browser itself (the DevTools protocol's platform fonts for a node), not from the computed
 * font-family, which names the stack whatever the device draws.
 */
const DEVICE_SANS = ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'];

async function drawnIn(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts.map((f) => ({ family: f.familyName, served: f.isCustomFont }));
}

test('a device with no Verdana and no DejaVu installed draws the board in the DejaVu Sans the instance serves', async ({ baseURL }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-no-fonts-'));
  fs.mkdirSync(path.join(dir, 'fonts'));
  const own = DEVICE_SANS.find((f) => fs.existsSync(f));
  if (!own) throw new Error(`no stand-in sans-serif for the device: none of ${DEVICE_SANS.join(', ')} is installed`);
  fs.copyFileSync(own, path.join(dir, 'fonts', path.basename(own)));
  fs.writeFileSync(path.join(dir, 'fonts.conf'), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>${path.join(dir, 'fonts')}</dir><cachedir>${path.join(dir, 'cache')}</cachedir></fontconfig>
`);
  const browser = await chromium.launch({ env: { ...process.env, FONTCONFIG_FILE: path.join(dir, 'fonts.conf') } });
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto('/b/general');
    const title = page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true });
    await expect(title).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    /* A bold and a regular run of the board's Verdana, each marked to be found by the protocol. */
    await page.evaluate(() => {
      /* A drawn element whose one child is its text: the protocol reports the faces of a node's own text, and none for one not drawn. */
      const verdana = (min: number, max: number) => [...document.querySelectorAll<HTMLElement>('main *')].find((el) => {
        const s = getComputedStyle(el);
        const w = Number(s.fontWeight);
        return s.fontFamily.startsWith('Verdana') && w >= min && w <= max && el.getClientRects().length > 0 && s.visibility === 'visible' && el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE && /[a-z]{3}/iu.test(el.textContent!);
      });
      const bold = verdana(700, 900);
      const regular = verdana(1, 699);
      bold?.setAttribute('data-probe', 'bold');
      regular?.setAttribute('data-probe', 'regular');
    });
    await expect(page.locator('[data-probe="bold"]')).toHaveCount(1);
    await expect(page.locator('[data-probe="regular"]')).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    expect(await drawnIn(page, '[data-probe="regular"]')).toEqual([{ family: 'DejaVu Sans', served: true }]);
    expect(await drawnIn(page, '[data-probe="bold"]')).toEqual([{ family: 'DejaVu Sans', served: true }]);
    /* The protocol names a served face by its family alone, so the bold is read from the font set: its 700 face was fetched, not slanted and thickened from the regular. */
    const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/gu, '') === 'DejaVu Sans').map((f) => `${f.weight} ${f.status}`));
    expect(faces).toEqual(['400 loaded', '700 loaded']);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
