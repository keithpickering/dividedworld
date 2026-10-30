import { expect, test, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Preferences } from '../engine/ui/data/api.ts';

/**
 * The glass's three preferences in the real browser (the web plan's glass amendment to Task 11):
 * each persists across a fresh load, smoke off draws no smoke element, high contrast puts every
 * line of glass text on solid ground with the `high` key on the root, and 200% text at 1280px wide
 * is one column with no sideways scroll and nothing cut off, on the glass and on the board.
 *
 * The demo world starts over on each load and keeps the account's preferences for the tab
 * (web/src/demo.ts), so a reload is a fresh load that keeps them, as the account would.
 *
 * "On solid ground" is read from the page's own structure: a line stands on it when some element
 * between its text and its surface (the glass page, the HUD's glass, the hand, an overlay's dialog)
 * paints an opaque background, so the surface's smoke, drawn behind its content, is under that
 * background; or when the surface itself is opaque and draws no smoke. The pixels are
 * e2e/glass-text.spec.ts's (the glass build's Task 2.5). The check is driven red first by a line
 * planted on a glass page's smoke.
 */
type E2eWindow = typeof globalThis & { readonly __kbFake: Fake };

async function prefer(page: Page, path: string, prefs: Partial<Preferences>) {
  await page.goto(path);
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(async (p) => { await (globalThis as E2eWindow).__kbFake.setPreferences(p); }, prefs);
  await page.reload();
}

const ready = (page: Page, glass: boolean) => (glass ? page.getByRole('navigation', { name: 'Menu' }) : page.getByRole('region', { name: 'Game HUD' }));

/** Every visible line of text on the page's glass surfaces that stands on no solid ground, by its words. */
async function linesOffGround(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const SURFACES = '.kb-glass-page, .kb-hud-glass, .kb-hand-drawer, .kb-glass-dialog';
    const opaque = (el: Element) => {
      const c = getComputedStyle(el).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return false;
      const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return (parts[3] ?? 1) === 1;
    };
    const smokeDrawn = (surface: Element) => [...surface.querySelectorAll(':scope > .kb-smoke .kb-smoke-layers, :scope > * > .kb-smoke .kb-smoke-layers')]
      .some((l) => getComputedStyle(l).display !== 'none' && l.getClientRects().length > 0);
    const off: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('[aria-hidden="true"], .kb-smoke, .kb-visually-hidden, script, style')) continue;
      const surface = el.closest(SURFACES);
      if (!surface || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      let ground = false;
      for (let a: Element | null = el; a && a !== surface; a = a.parentElement) if (opaque(a)) { ground = true; break; }
      /* With its smoke not drawn, a surface's own ground shows: its background, or its smoke's opaque ground layer. */
      if (!ground && !smokeDrawn(surface) && (opaque(surface) || [...surface.querySelectorAll('.kb-smoke-ground')].some(opaque))) ground = true;
      if (!ground) off.push(text.slice(0, 60));
    }
    return off;
  });
}

/** Every line of text cut off: past the window's sides, or past an ancestor that clips it. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const width = document.documentElement.clientWidth;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('[aria-hidden="true"], .kb-visually-hidden, script, style, option, [hidden]')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        if (r.left < -0.5 || r.right > width + 0.5) { out.push(`${text.slice(0, 40)}: past the window (${Math.round(r.left)} to ${Math.round(r.right)})`); break; }
        let cut = false;
        for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
          const s = getComputedStyle(a);
          const b = a.getBoundingClientRect();
          /* Each axis that clips, alone; a box that scrolls on its own (the phone's menu strip) shows the rest by scrolling, which is not cut. */
          const clips = (o: string) => o === 'hidden' || o === 'clip';
          const margin = 0.5 + (s.overflowClipMargin ? parseFloat(s.overflowClipMargin) || 0 : 0);
          if (clips(s.overflowX) && (r.left < b.left - margin || r.right > b.right + margin)) { cut = true; break; }
          if (clips(s.overflowY) && (r.top < b.top - margin || r.bottom > b.bottom + margin)) { cut = true; break; }
        }
        if (cut) { out.push(`${text.slice(0, 40)}: cut by a box that clips it`); break; }
      }
    }
    return out;
  });
}

test.describe('each preference persists across a fresh load', () => {
  test('smoke, contrast and text size, chosen in Settings, are still chosen and applied after a reload', async ({ page }) => {
    await page.goto('/settings');
    /* By keyboard, as e2e/account.spec.ts chooses: the scaled column's zoom leaves a pointer's hit test to Chromium's zoom handling. */
    for (const [group, name] of [['Smoke', 'Low'], ['Contrast', 'High'], ['Text size', '125%']] as const) {
      await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name }).focus();
      await page.keyboard.press('Space');
    }
    await expect(page.getByText('Saved to your account.')).toBeVisible();
    await page.reload();
    for (const [group, name] of [['Smoke', 'Low'], ['Contrast', 'High'], ['Text size', '125%']] as const) {
      await expect(page.getByRole('radiogroup', { name: group }).getByRole('radio', { name })).toBeChecked();
    }
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-kb-smoke-level', 'low');
    await expect(root).toHaveAttribute('data-kb-glass-key', 'high');
    await expect(root).toHaveAttribute('data-kb-text-size', '125');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
  });
});

test.describe('smoke off', () => {
  for (const [path, glass] of [['/settings', true], ['/b/general', false]] as const) {
    test(`${path} draws no smoke element, and keeps its ground`, async ({ page }) => {
      await prefer(page, path, { smoke: 'off' });
      await expect(ready(page, glass)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-kb-smoke-level', 'off');
      await expect(page.locator('[data-kb-smoke]')).toHaveCount(0);
      expect(await page.locator('[data-kb-ground]').count()).toBeGreaterThan(0);
    });
  }
});

test.describe('high contrast', () => {
  const GLASS_PAGES = ['/settings', '/settings?section=account', '/characters', '/characters/new'];

  for (const path of GLASS_PAGES) {
    test(`${path}: every line of glass text stands on solid ground, and the high key is on the root`, async ({ page }) => {
      await prefer(page, path, { contrast: 'high' });
      await expect(ready(page, true)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-kb-glass-key', 'high');
      const high = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb-glass-text').trim());
      expect(high).toBe('#ffffff');
      /* The page's own smoke stays, in the gutters. */
      expect(await page.locator('.kb-glass-page > .kb-smoke .kb-smoke-layers').evaluate((l) => getComputedStyle(l).display)).toBe('block');
      expect(await linesOffGround(page)).toEqual([]);
    });
  }

  /*
   * Signed out no account's preference applies; the screens are read under high contrast's mark as
   * Settings would set it, so a player who signs out and back in meets the same ground.
   */
  for (const path of ['/sign-in', '/register']) {
    test(`${path}, signed out: every line of glass text stands on solid ground under high contrast`, async ({ page }) => {
      await page.goto('/');
      await page.waitForFunction(() => '__kbFake' in globalThis);
      await page.evaluate(() => (globalThis as E2eWindow).__kbFake.signInAs(null));
      await page.evaluate((p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.documentElement.setAttribute('data-kb-contrast', 'high'));
      expect(await linesOffGround(page)).toEqual([]);
    });
  }

  test('a board page\'s Game HUD: every line stands on solid ground', async ({ page }) => {
    await prefer(page, '/b/general', { contrast: 'high' });
    await expect(ready(page, false)).toBeVisible();
    await expect(page.locator('.kb-hud-orbs .kb-orb').first()).toBeVisible();
    expect(await linesOffGround(page)).toEqual([]);
  });

  test('the check finds a line left on the smoke (its poison)', async ({ page }) => {
    await prefer(page, '/settings', { contrast: 'high' });
    await expect(page.getByRole('radiogroup', { name: 'Contrast' })).toBeVisible();
    await page.evaluate(() => {
      const stray = document.createElement('p');
      stray.textContent = 'A line left on the smoke';
      stray.style.cssText = 'position:absolute;left:4px;top:400px;margin:0';
      document.querySelector('.kb-glass-page')!.append(stray);
    });
    expect(await linesOffGround(page)).toEqual(['A line left on the smoke']);
  });
});

test.describe('200% text at 1280px wide', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const [path, glass] of [['/settings', true], ['/settings?section=account', true], ['/characters', true], ['/', false], ['/b/general', false]] as const) {
    test(`${path} is one column with no sideways scroll and no text cut off`, async ({ page }) => {
      await prefer(page, path, { textSize: 200 });
      await expect(ready(page, glass)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-kb-text-size', '200');
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      /* Past 150% the glass is the Phone board's one column, however wide the window. */
      await expect(page.locator('html')).toHaveAttribute('data-kb-layout', 'phone');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(await clipped(page)).toEqual([]);
    });
  }

  for (const path of ['/sign-in', '/register']) {
    test(`${path}, signed out, read at 200%: one column, no sideways scroll, no text cut off`, async ({ page }) => {
      await page.goto('/');
      await page.waitForFunction(() => '__kbFake' in globalThis);
      await page.evaluate(() => (globalThis as E2eWindow).__kbFake.signInAs(null));
      await page.evaluate((p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      /* Signed out no account's text size applies; it is set on the root as Settings sets it. */
      await page.evaluate(() => document.documentElement.setAttribute('data-kb-text-size', '200'));
      await expect(page.locator('html')).toHaveAttribute('data-kb-layout', 'phone');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(await clipped(page)).toEqual([]);
    });
  }
});
