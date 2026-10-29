import type { Page } from '@playwright/test';

/**
 * Tab through the page and name every focused control that shows no focus indicator: an outline
 * that is not `none` with a width, or a box-shadow. jsdom paints no focus, so this is the browser's
 * word. The check is itself tested on a page poisoned with `outline: none` (e2e/focus.spec.ts).
 */
export async function controlsWithoutFocusIndicator(page: Page, steps = 60): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const bare: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const outlined = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadowed = s.boxShadow !== 'none';
      const path = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/u).join('.')}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
      return { path, visible: outlined || shadowed };
    });
    if (!found) continue;
    if (!found.visible && !bare.includes(found.path)) bare.push(found.path);
  }
  return bare;
}
