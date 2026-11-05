import { expect, test, type Page } from '@playwright/test';
import { OVERLAYS, PAGES, open } from './glass-screens.ts';

/**
 * Every control on the glass screens answers a hover: for each button, link, tab, radio card and summary a screen draws, a pointer
 * resting on it changes a computed style of it, of its parts or of its backing (color, fill, border, shadow, filter, decoration or
 * outline), so a player can see what is under the pointer. engine/ui/glass/parts.test.tsx reads the stylesheets for the glass's own
 * button variants from a list written by hand; this reads the controls as the pages draw them, so a control added later is held to it
 * without anyone adding it to a list. Judged are the glass's controls (inside the glass page, a dialog, a float, the HUD or the hand) that
 * are a box: a button, a link drawn as a button (not an inline link in a line of prose), a tab, a radio card and a summary. Not asked:
 * a disabled control, the menu's tab for the page the player is on (it is the current one, `aria-current`, and shows that instead), and one
 * a pointer cannot reach (something is drawn over its middle).
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1, viewport: { width: 1440, height: 900 } });

const CONTROLS = 'button:not(:disabled), a[href], [role="tab"]:not([aria-disabled="true"]), label:has(> input[type="radio"]:not(:disabled)), summary';



async function unhovered(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** The look of an element, its pseudo-elements and everything inside it, as one string. */
const lookOf = (el: Element) => {
  const props = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'filter', 'textDecorationLine', 'outlineStyle', 'opacity', 'transform', 'clipPath'] as const;
  const one = (e: Element, pseudo?: string) => { const cs = getComputedStyle(e, pseudo); return props.map((p) => cs[p]).join('|'); };
  return [el, ...el.querySelectorAll('*')].map((e) => `${one(e)}~${one(e, '::before')}~${one(e, '::after')}`).join('/');
};

const SCREENS = [...PAGES, ...OVERLAYS];

for (const s of SCREENS) {
  test(`${s.name}: every control answers a hover`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, s);
    /* No transition is waited for: a hover is read as it settles. */
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
    const total = await page.locator(CONTROLS).count();
    const silent: string[] = [];
    let judged = 0;
    for (let i = 0; i < total; i++) {
      const control = page.locator(CONTROLS).nth(i);
      if (!(await control.isVisible())) continue;
      const asked = await control.evaluate((el) => {
        const inGlass = el.closest('.kb-glass, .kb-glass-overlay, .kb-float, .kb-hud, .kb-hand-drawer') !== null;
        const prose = el.localName === 'a' && getComputedStyle(el).display === 'inline';
        const current = el.getAttribute('aria-current') !== null;
        return inGlass && !prose && !current;
      });
      if (!asked) continue;
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      if (!box || box.width < 2 || box.height < 2) continue;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      /* A control a pointer cannot reach (something is drawn over its middle) is not judged. */
      const reachable = await control.evaluate((el, p) => { const top = document.elementFromPoint(p.x, p.y); return top !== null && (el === top || el.contains(top)); }, point);
      if (!reachable) continue;
      await unhovered(page);
      const before = await control.evaluate(lookOf);
      await page.mouse.move(point.x, point.y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const after = await control.evaluate(lookOf);
      judged++;
      if (before === after) silent.push(await control.evaluate((el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/u).join('.')} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`));
    }
    expect(judged, 'the screen has controls to hover').toBeGreaterThan(0);
    expect(silent).toEqual([]);
  });
}
