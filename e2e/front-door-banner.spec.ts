import { expect, test, type Page } from '@playwright/test';

/**
 * The front door's banner (engine/ui/front-door/front-door.css; the owner's word of 2026-11-14): the visitor's one way in is the glass's Sign in,
 * so the banner above the sample thread draws the name and the address and leaves out the loading meter, the Boards control and the boards bar.
 * The real forum's banner, seen signed in, keeps every one of them. On a phone the name is larger than the forum's 25px and nothing is beside or
 * under it.
 *
 * The poison plants the defect the check exists to catch, the door's rules gone (a banner as the forum draws it), and expects it named.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

const DOOR = '/?fixture=boards&story=boards-00-front-door--front-door';
const DOOR_PHONE = '/?fixture=boards&story=boards-00-front-door--front-door-phone';
const FORUM = '/?fixture=boards&moment=01-main';

/** What the banner shows: each piece's computed display, and the name's size and width against the banner's. */
async function banner(page: Page) {
  return page.evaluate(() => {
    const shown = (sel: string) => { const el = document.querySelector(sel); return el !== null && getComputedStyle(el).display !== 'none'; };
    const logo = document.querySelector('.kb-logo')!;
    const box = document.querySelector('.kb-banner')!.getBoundingClientRect();
    const name = logo.getBoundingClientRect();
    return {
      meter: shown('.kb-meter'), menu: shown('.kb-menu-button'), nav: shown('.kb-nav'), side: shown('.kb-banner-side'),
      logoPx: parseFloat(getComputedStyle(logo).fontSize), logoOneLine: name.height < parseFloat(getComputedStyle(logo).fontSize) * 2,
      logoInside: name.left >= box.left && name.right <= box.right,
    };
  });
}

test.describe('on the front door', () => {
  test('desktop: the meter, the Boards control and the boards bar are not drawn; the name and the address are', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(DOOR);
    await expect(page.locator('.kb-front-door')).toBeVisible();
    const b = await banner(page);
    expect([b.meter, b.menu, b.nav]).toEqual([false, false, false]);
    expect(b.side).toBe(true);
    expect(b.logoInside).toBe(true);
  });

  test('phone: the name stands alone, larger than the forum\'s, on one line inside the banner', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DOOR_PHONE);
    await expect(page.locator('.kb-front-door')).toBeVisible();
    const b = await banner(page);
    expect([b.meter, b.menu, b.nav, b.side]).toEqual([false, false, false, false]);
    expect(b.logoPx).toBeGreaterThan(28);
    expect(b.logoOneLine).toBe(true);
    expect(b.logoInside).toBe(true);
  });

  test('phone at 320: the larger name still fits its banner', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(DOOR_PHONE);
    await expect(page.locator('.kb-front-door')).toBeVisible();
    const b = await banner(page);
    expect(b.logoOneLine).toBe(true);
    expect(b.logoInside).toBe(true);
  });

  test('poison: with the door\'s banner rules gone the check names what the forum still draws', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DOOR_PHONE);
    await expect(page.locator('.kb-front-door')).toBeVisible();
    await page.evaluate(() => {
      for (const sheet of [...document.styleSheets]) {
        try {
          for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
            if (sheet.cssRules[i]!.cssText.includes('.kb-front-door) .kb-')) sheet.deleteRule(i);
          }
        } catch { /* a cross-origin sheet has no rules to read */ }
      }
    });
    const b = await banner(page);
    expect(b.menu).toBe(true);
    expect(b.side).toBe(true);
  });
});

test.describe('in the real forum', () => {
  test('desktop: the banner keeps its meter and its boards bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(FORUM);
    await expect(page.locator('.kb-banner')).toBeVisible();
    const b = await banner(page);
    expect([b.meter, b.nav, b.side]).toEqual([true, true, true]);
  });

  test('phone: the banner keeps its Boards control, and the name is not enlarged', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(FORUM);
    await expect(page.locator('.kb-banner')).toBeVisible();
    const b = await banner(page);
    expect([b.menu, b.side]).toEqual([true, true]);
    expect(b.logoPx).toBeLessThanOrEqual(28);
  });
});
