import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';

/**
 * A reply cut in under its post (docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 10) as a browser lays it out: the nested reply is an
 * article of its own right after its parent's in the document, indented under it, with its line; Tab reaches its controls after the parent's;
 * axe reads both boards; and on a phone it stays inside the page. The story (engine/ui/thread/Under.board.stories.tsx) plays the reply as the
 * game does, so the page is the thread screen itself.
 */
test.use({ bypassCSP: true });

const STORY = (mode: 'light' | 'dark') => `/?fixture=boards&story=boards-22-reply-cut-in--under-${mode}`;
const NESTED = 'article[data-kb-under]';

async function open(page: Page, mode: 'light' | 'dark', width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(STORY(mode));
  await expect(page.locator(NESTED)).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const mode of ['light', 'dark'] as const) {
  test.describe(`on the ${mode} board`, () => {
    test('the nested reply sits right after its parent, indented, with its line and its heading', async ({ page }) => {
      await open(page, mode);
      const nested = page.locator(NESTED);
      const info = await nested.evaluate((el) => {
        const prev = el.previousElementSibling as HTMLElement | null;
        const a = el.getBoundingClientRect(), p = prev?.getBoundingClientRect();
        return { prevId: prev?.id ?? null, prevTag: prev?.tagName ?? null, id: el.id, left: a.left, parentLeft: p?.left ?? null, top: a.top, parentBottom: p?.bottom ?? null, text: (el as HTMLElement).innerText };
      });
      expect(info.prevTag).toBe('ARTICLE');
      expect(info.prevId).toBe('post-2');
      expect(info.id).toMatch(/^post-\d+$/);
      expect(info.left).toBeGreaterThan(info.parentLeft! + 8);
      expect(info.top).toBeGreaterThanOrEqual(info.parentBottom! - 1);
      await expect(nested.getByText('Cut in line under post 2')).toBeVisible();
      await expect(nested.getByRole('heading', { name: /^Post \d+ by .+, cut in under post 2$/ })).toBeAttached();
    });

    test('Tab reaches the nested reply\'s controls after the parent\'s and before the next post\'s', async ({ page }) => {
      await open(page, mode);
      const order = await page.evaluate(() => {
        const nested = document.querySelector('article[data-kb-under]')!;
        const parent = nested.previousElementSibling!;
        const next = nested.nextElementSibling;
        const rank = (el: Element) => Array.from(document.querySelectorAll('*')).indexOf(el);
        const ctrl = (root: Element | null) => (root ? Array.from(root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')).filter((e) => e.tabIndex >= 0 && !e.closest('[hidden], [inert]')) : []);
        return { parent: ctrl(parent).length, nested: ctrl(nested).length, next: ctrl(next).length, parentLast: ctrl(parent).map(rank).at(-1) ?? -1, nestedFirst: ctrl(nested).map(rank)[0] ?? -1, nestedLast: ctrl(nested).map(rank).at(-1) ?? -1, nextFirst: ctrl(next).map(rank)[0] ?? Infinity };
      });
      expect(order.nested, 'the nested reply has controls to reach').toBeGreaterThan(0);
      expect(order.parentLast).toBeLessThan(order.nestedFirst);
      expect(order.nestedLast).toBeLessThan(order.nextFirst);
      /* And the keyboard really walks it: Tab from the parent's last control lands inside the nested article, then leaves it forward. */
      const last = await page.evaluate(() => {
        const parent = document.querySelector('article[data-kb-under]')!.previousElementSibling!;
        const all = Array.from(parent.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')).filter((e) => e.tabIndex >= 0);
        const el = all.at(-1)!; el.focus(); return el === document.activeElement;
      });
      expect(last).toBe(true);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('article[data-kb-under]'))).toBe(true);
      for (let i = 0; i < order.nested + 1 && await page.evaluate(() => !!document.activeElement?.closest('article[data-kb-under]')); i += 1) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('article[data-kb-under]'))).toBe(false);
    });

    test('axe finds nothing, color contrast included', async ({ page }) => {
      await open(page, mode);
      expect(await pageViolations(page)).toEqual([]);
    });

    test('at a phone\'s width the nested reply stays inside the page', async ({ page }) => {
      await open(page, mode, 360);
      /* The page's own sideways scroll is held for every screen by e2e/a11y.spec.ts; here it is the reply's own: the article and everything in it. */
      const m = await page.evaluate(() => {
        const nested = document.querySelector('article[data-kb-under]')!;
        const r = nested.getBoundingClientRect(), W = document.documentElement.clientWidth;
        const past = Array.from(nested.querySelectorAll('*')).filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > W + 0.5 || b.left < -0.5); }).map((e) => `${e.tagName}.${e.className}`);
        return { left: r.left, right: r.right, width: W, past };
      });
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.right).toBeLessThanOrEqual(m.width);
      expect(m.past).toEqual([]);
    });
  });
}
