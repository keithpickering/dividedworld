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
