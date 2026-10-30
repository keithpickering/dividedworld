import type { Page } from '@playwright/test';

/**
 * What the browser paints for the focused element, asked of the browser (jsdom paints no focus).
 * An indicator counts when it can be seen: an outline with a width and a color that is neither
 * transparent nor the color behind it, or a box-shadow that the element does not show unfocused.
 * The check is itself tested on pages poisoned with `outline: none` (e2e/focus.spec.ts).
 */
export interface Focused { readonly name: string; readonly visible: boolean }

export async function focusedIndicator(page: Page): Promise<Focused | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const rgba = (c: string) => (c.match(/[\d.]+/gu) ?? []).map(Number);
    const behind = (node: HTMLElement | null): string => {
      for (let n = node; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (rgba(bg).length < 4 || rgba(bg)[3]! > 0) return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    const s = getComputedStyle(el);
    const same = (a: string, b: string) => rgba(a).slice(0, 3).join() === rgba(b).slice(0, 3).join();
    const alpha = rgba(s.outlineColor)[3] ?? 1;
    const outlined = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && alpha > 0 && !same(s.outlineColor, behind(el));
    const focusedShadow = s.boxShadow;
    /* A shadow counts only if it is not there when the element is not focused. */
    el.blur();
    const restShadow = getComputedStyle(el).boxShadow;
    el.focus({ focusVisible: true } as FocusOptions);
    const shadowed = focusedShadow !== 'none' && focusedShadow !== restShadow;
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
    const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/u).join('.')}` : ''} "${label}"`;
    return { name, visible: outlined || shadowed };
  });
}

/**
 * Tab from the top of the page until focus comes round to the first stop again (or leaves the
 * page and returns), and name every focused control without a visible indicator. It throws if the
 * page never cycles, so a trap is a failure rather than a short walk.
 */
export async function controlsWithoutFocusIndicator(page: Page, limit = 400): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const bare: string[] = [];
  let first: string | null = null;
  let stops = 0;
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const found = await focusedIndicator(page);
    if (!found) { if (first !== null) return bare; continue; }
    const id = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')];
      return all.indexOf(document.activeElement!);
    });
    if (first === null) first = String(id);
    else if (String(id) === first) return bare;
    stops += 1;
    if (!found.visible && !bare.includes(found.name)) bare.push(found.name);
  }
  throw new Error(`Tab never came round to the first stop in ${limit} presses (${stops} stops): a focus trap, or a page too long for the limit`);
}
