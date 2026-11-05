import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OVERLAYS, OVERLAYS, STORIES, open, type E2eWindow, type Screen } from './glass-screens.ts';

/**
 * The glass dialogs' one frame (engine/ui/glass/Frame.tsx; the glass polish plan, "Modals"), read on every real dialog the layout
 * check opens (the Turn, the Reveal, both Debuts, the play form, card info, the React picker, Stick Around's view, the Lens),
 * in the browser:
 *  - the frame is the same: the chamfer's size, the border's width and color, the sheet it is drawn on, and Close's look, read from
 *    the computed style of each (a stylesheet that drew its own would show here, and in engine/ui/glass/frame.test.tsx's read of them);
 *  - the title row is sticky: a dialog made taller than the window, its body scrolled to the foot, still has its title and Close
 *    in the window and Close is what a press at its place reaches, at a phone (390×664) and a desktop (1440×900), at 100% and 200% text;
 *  - the menu bar of a glass page (the pause menu's top nav, Back and the tabs) stays at the top of the window as the page scrolls.
 */
test.use({ bypassCSP: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });

const LENS = STORIES.find((s) => s.name.startsWith('The Lens on Whoops!'))!;
const DIALOGS: readonly Screen[] = [...OVERLAYS, ...FIXTURE_OVERLAYS, LENS];
const VIEWPORTS = [['a phone, 390×664', { width: 390, height: 664 }], ['a desktop, 1440×900', { width: 1440, height: 900 }]] as const;
const TEXT_SIZES = [100, 200] as const;

async function setTextSize(page: Page, textSize: (typeof TEXT_SIZES)[number]) {
  await page.goto('/characters');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(async (t) => { await (globalThis as E2eWindow).__kbFake.setPreferences({ textSize: t }); }, textSize);
}

interface Frame {
  readonly cut: string; readonly border: string; readonly sheetInset: string; readonly color: string; readonly clip: string;
  readonly close: null | { readonly width: string; readonly height: string; readonly border: string; readonly borderColor: string; readonly background: string; readonly mark: string };
}

async function frameOf(page: Page): Promise<Frame> {
  /* Close answers a hover (shell.css): the frame is read at rest, with the pointer off whatever the last dialog's Close left it on. */
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const box = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
    const cs = getComputedStyle(box);
    const after = getComputedStyle(box, '::after');
    const close = box.querySelector<HTMLElement>('.kb-glass-dialog-close');
    const c = close && getComputedStyle(close);
    const before = close && getComputedStyle(close, '::before');
    return {
      cut: cs.getPropertyValue('--kb-cut').trim(), border: cs.getPropertyValue('--kb-border').trim(), sheetInset: after.top, color: cs.backgroundColor, clip: cs.clipPath.replace(/[\d.]+px/gu, 'N'),
      close: c && before ? { width: c.width, height: c.height, border: c.borderTopWidth, borderColor: c.borderTopColor, background: c.backgroundColor, mark: before.inset } : null,
    };
  });
}

for (const [label, viewport] of VIEWPORTS) {
  test.describe(`at ${label}`, () => {
    test.use({ viewport });

    test('every dialog wears the same frame: chamfer, 1.5px border, color and Close', async ({ page }) => {
      test.setTimeout(180_000);
      const seen: { name: string; frame: Frame }[] = [];
      for (const s of DIALOGS) {
        await setTextSize(page, 100);
        await open(page, s);
        seen.push({ name: s.name, frame: await frameOf(page) });
      }
      const [first, ...rest] = seen;
      expect(first!.frame.cut).toBe('40px');
      expect(first!.frame.border).toBe('1.5px');
      expect(first!.frame.sheetInset).toBe('1.5px');
      for (const s of rest) expect(s.frame, s.name).toEqual({ ...first!.frame, close: s.frame.close === null ? null : first!.frame.close });
      const closes = seen.filter((s) => s.frame.close !== null);
      expect(closes.length).toBeGreaterThanOrEqual(DIALOGS.length - 1);
      for (const s of closes) expect(s.frame.close, s.name).toEqual(closes[0]!.frame.close);
    });
  });
}

for (const [label, viewport] of VIEWPORTS) {
  for (const size of TEXT_SIZES) {
    test.describe(`sticky title row at ${label}, text ${size}%`, () => {
      test.use({ viewport });
      for (const s of DIALOGS.filter((d) => !d.name.startsWith('Stick Around'))) {
        test(`${s.name}: the title and Close stay in view and clickable`, async ({ page }) => {
          await setTextSize(page, size);
          await open(page, s);
          const out = await page.evaluate(async () => {
            const box = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
            const filler = document.createElement('div');
            filler.style.cssText = 'height:3000px;position:relative;z-index:1';
            filler.textContent = 'Filler';
            box.lastElementChild!.append(filler);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            /* Whatever scrolls (the box itself, the overlay it stands in, the window) is scrolled to its foot. */
            /* What scrolls is the box where it has its own room (a popover, a float, a sheet), else the overlay it stands in. */
            const toFoot = () => {
              const own = box.scrollHeight > box.clientHeight + 1;
              (own ? box : box.parentElement!).scrollTop = 1e6;
            };
            /* A float places itself again when its content changes size: scrolled twice, with the browser's few frames to say "stuck" after each. */
            toFoot();
            await new Promise((r) => setTimeout(r, 300));
            toFoot();
            await new Promise((r) => setTimeout(r, 300));
            const bar = box.querySelector<HTMLElement>('.kb-glass-dialog-bar')!;
            const close = box.querySelector<HTMLElement>('.kb-glass-dialog-close')!;
            const title = bar.querySelector<HTMLElement>('h2, [role="tablist"]')!;
            const inWindow = (r: DOMRect) => r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
            const at = close.getBoundingClientRect();
            const hit = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
            const t = title.getBoundingClientRect();
            /* Under the body scrolling the bar has its ground (its own, or the backing it lays once it is stuck), so the body does not show through it. */
            const bs = getComputedStyle(bar);
            const grounded = bs.backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(bar, '::before').opacity === '1';
            const scrolled = [box, box.parentElement!].some((e) => e.scrollTop > 100);
            return { grounded, scrolled, closeInWindow: inWindow(at), titleInWindow: t.top >= -0.5 && t.top < window.innerHeight, hitsClose: hit !== null && close.contains(hit), barTop: Math.round(bar.getBoundingClientRect().top) };
          });
          expect(out.scrolled, 'the dialog was made to scroll').toBe(true);
          expect(out.grounded, 'the bar has its ground while the body scrolls under it').toBe(true);
          expect(out.closeInWindow, 'Close is in the window').toBe(true);
          expect(out.titleInWindow, 'the title is in the window').toBe(true);
          expect(out.hitsClose, 'a press at Close reaches Close').toBe(true);
          await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
        });
      }
    });
  }
}

/*
 * WCAG 2.4.11 (Focus Not Obscured): the sticky title row sits over a scrolling dialog, so a control reached with Tab or Shift+Tab must
 * be scrolled clear of it. The browser scrolls a focused control to the scrollport's edge unless the container's `scroll-padding-top`
 * says the bar is there; Shift+Tab, going up, is the way that puts a control just under the bar. Read in a dialog made taller than
 * the window, at a phone and at 200% text, through every control of it forward and back.
 */
for (const s of DIALOGS.filter((d) => !d.name.startsWith('Stick Around'))) {
  test(`${s.name}: Tab and Shift+Tab never leave a focused control under the stuck title row (phone, 200% text)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 664 });
    await setTextSize(page, 200);
    await open(page, s);
    const tabbables = await page.evaluate(async () => {
      const box = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
      const filler = document.createElement('div');
      filler.style.cssText = 'position:relative;z-index:1;display:grid;gap:40px;padding:40px 0';
      for (let i = 1; i <= 14; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `Filler control ${i}`;
        filler.append(b);
      }
      box.lastElementChild!.append(filler);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return box.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length;
    });
    const obscured = async () => page.evaluate(() => {
      const box = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
      const bar = box.querySelector<HTMLElement>('.kb-glass-dialog-bar')!;
      const f = document.activeElement as HTMLElement | null;
      if (!f || !box.contains(f) || bar.contains(f)) return null;
      const a = f.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return overlap > 0.5 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 ? `${f.textContent?.trim().slice(0, 30) || f.tagName}: control ${Math.round(a.top)}-${Math.round(a.bottom)}, bar ${Math.round(b.top)}-${Math.round(b.bottom)}` : null;
    });
    expect(tabbables, 'the dialog has controls to walk').toBeGreaterThan(14);
    const found: string[] = [];
    for (const key of ['Tab', 'Shift+Tab'] as const) {
      for (let i = 0; i < tabbables + 2; i++) {
        await page.keyboard.press(key);
        const o = await obscured();
        if (o) found.push(`${key}: ${o}`);
      }
    }
    expect(found).toEqual([]);
  });
}

for (const [label, viewport] of VIEWPORTS) {
  for (const size of TEXT_SIZES) {
    test.describe(`sticky menu bar at ${label}, text ${size}%`, () => {
      test.use({ viewport });
      for (const path of ['/guide', '/settings', '/characters']) {
        test(`${path}: the menu stays at the top of the window, Back and the tabs clickable`, async ({ page }) => {
          await setTextSize(page, size);
          await page.goto(path);
          const menu = page.getByRole('navigation', { name: 'Menu' });
          await expect(menu).toBeVisible();
          const out = await page.evaluate(async () => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const nav = document.querySelector<HTMLElement>('nav[aria-label="Menu"]')!;
            const back = nav.querySelector<HTMLElement>('.kb-glass-menu-back')!;
            /* A tab in the window's width: the strip scrolls sideways at large text, and the tabs past its edge are for a swipe. */
            const tab = [...nav.querySelectorAll<HTMLElement>('.kb-glass-menu-tab')].find((t) => { const r = t.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
            const hit = (el: HTMLElement) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h !== null && el.contains(h); };
            return { scrolled: window.scrollY, top: nav.getBoundingClientRect().top, backHit: hit(back), tabHit: tab === undefined || hit(tab) };
          });
          expect(out.scrolled, 'the page scrolled').toBeGreaterThan(50);
          expect(Math.round(out.top)).toBe(0);
          expect(out.backHit, 'Back is what a press at it reaches').toBe(true);
          expect(out.tabHit, 'a tab is what a press at it reaches').toBe(true);
        });
      }
    });
  }
}

/** The color of one pixel of a screenshot, read through a canvas in the page (the repository carries no PNG decoder). */
async function pixelAt(page: Page, shot: Buffer, x: number, y: number): Promise<readonly [number, number, number]> {
  return page.evaluate(async ([b64, px, py]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(px as number, py as number, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as const;
  }, [shot.toString('base64'), x, y] as const);
}

/*
 * The sticky menu bar is opaque while a dialog dims it: the page scrolls under it, and what scrolls there must never read through.
 * A white sheet is laid under the bar (below its layer), the page scrolled so that it lies there, and a pixel of the bar that carries
 * no letter is read: it is the bar's own ground, black, not the sheet through a 60% bar.
 */
for (const [label, viewport] of VIEWPORTS) {
  test.describe(`the dimmed menu bar at ${label}`, () => {
    test.use({ viewport });
    test('what scrolls under it never reads through', async ({ page }) => {
      test.setTimeout(60_000);
      const reveal = OVERLAYS.find((s) => s.name === 'The Reveal modal, from My characters')!;
      await setTextSize(page, 100);
      await open(page, reveal);
      const menu = page.getByRole('navigation', { name: 'Menu' });
      await expect(menu).toHaveAttribute('data-kb-dimmed', '');
      await page.evaluate(async () => {
        const sheet = document.createElement('div');
        sheet.setAttribute('data-probe', '');
        sheet.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:4000px;background:#fff;z-index:1;pointer-events:none';
        /* A sibling of the bar's, so the two stack against each other as the page's own content and the bar do. */
        document.querySelector('nav[aria-label="Menu"]')!.parentElement!.prepend(sheet);
        window.scrollTo(0, 300);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const bar = (await menu.boundingBox())!;
      expect(Math.round(bar.y), 'the bar is stuck at the top').toBe(0);
      const shot = await page.screenshot();
      /* The bar's far right edge carries no tab or letter. */
      const [r, g, b] = await pixelAt(page, shot, viewport.width - 3, Math.floor(bar.height / 2));
      expect(Math.max(r, g, b), `the bar's ground is black, not the sheet under it (rgb ${r} ${g} ${b})`).toBeLessThan(40);
    });
  });
}

/*
 * The stuck title row's top right corner: the body scrolling under the row must not show through it. The row is cut at that corner at
 * its place at the frame's top, and the page may stick it elsewhere (a dialog taller than the window scrolls in its overlay, the frame's own
 * corner far above), where a cut would be a notch showing the body behind it. A red sheet runs the body's whole width, the dialog is scrolled
 * to its foot, and the pixels of the row's top right 48px square that lie inside the frame's own cut (and off Close) are read: none is the sheet.
 */
for (const [label, viewport] of VIEWPORTS) {
  test.describe(`the stuck title row's corner at ${label}`, () => {
    test.use({ viewport });
    for (const s of DIALOGS.filter((d) => !d.name.startsWith('Stick Around'))) {
      test(`${s.name}: no body shows through the corner`, async ({ page }) => {
        test.setTimeout(60_000);
        await setTextSize(page, 100);
        await open(page, s);
        const at = await page.evaluate(async () => {
          const box = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
          const sheet = document.createElement('div');
          sheet.style.cssText = 'height:3000px;position:relative;z-index:1;background:#f00;margin:0 -200px';
          box.lastElementChild!.append(sheet);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const toFoot = () => { ((box.scrollHeight > box.clientHeight + 1) ? box : box.parentElement!).scrollTop = 1e6; };
          toFoot();
          await new Promise((r) => setTimeout(r, 300));
          toFoot();
          await new Promise((r) => setTimeout(r, 300));
          const r = box.getBoundingClientRect();
          const bar = box.querySelector<HTMLElement>('.kb-glass-dialog-bar')!.getBoundingClientRect();
          const close = box.querySelector<HTMLElement>('.kb-glass-dialog-close')!.getBoundingClientRect();
          const cs = getComputedStyle(box);
          return { box: { right: r.right, top: r.top }, bar: { right: bar.right, top: bar.top, bottom: bar.bottom }, close: { left: close.left, right: close.right, top: close.top, bottom: close.bottom }, cut: parseFloat(cs.getPropertyValue('--kb-cut')), border: parseFloat(cs.getPropertyValue('--kb-border')) };
        });
        const shot = await page.screenshot();
        const bad: string[] = [];
        for (let dx = 3; dx <= 48; dx += 5) {
          for (let dy = 3; dy <= 48; dy += 5) {
            const x = at.bar.right - dx;
            const y = Math.max(at.bar.top, 0) + dy;
            if (y > at.bar.bottom - 2) continue;
            /* Inside the frame's own cut (its diagonal moved in by the border, and a margin), not on Close. */
            if ((at.box.right - x) + (y - at.box.top) < at.cut + at.border * 1.5 + 4 || y < at.box.top) continue;
            if (x > at.close.left - 3 && x < at.close.right + 3 && y > at.close.top - 3 && y < at.close.bottom + 3) continue;
            const [r, g, b] = await pixelAt(page, shot, Math.round(x), Math.round(y));
            if (r > 120 && g < 70 && b < 70) bad.push(`(${Math.round(x)}, ${Math.round(y)}) is rgb ${r} ${g} ${b}`);
          }
        }
        expect(bad, 'pixels of the title row where the sheet under it shows').toEqual([]);
      });
    }
  });
}

/* The pause menu's current tab is in the window as the page opens, at every text size: the strip scrolls it into view (MenuBar.tsx). */
for (const [label, viewport] of VIEWPORTS) {
  for (const size of TEXT_SIZES) {
    test.describe(`the menu's current tab at ${label}, text ${size}%`, () => {
      test.use({ viewport });
      for (const path of ['/settings', '/guide', '/season']) {
        test(`${path}: the current tab is in the window`, async ({ page }) => {
          await setTextSize(page, size);
          await page.goto(path);
          const tab = page.getByRole('navigation', { name: 'Menu' }).locator('[aria-current="page"]');
          await expect(tab).toBeVisible();
          await expect.poll(async () => {
            const r = (await tab.boundingBox())!;
            return r.x >= -0.5 && r.x + r.width <= viewport.width + 0.5;
          }, { message: 'the current tab lies inside the window' }).toBe(true);
        });
      }
    });
  }
}
