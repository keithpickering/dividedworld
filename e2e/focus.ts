import { expect, type Page } from '@playwright/test';

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

/**
 * Arms the card whose button's name matches `name`, in the hand's dialog, which is already open, the way a player does on either layout
 * (docs/plans/2026-11-13-phone-hand-design.md, section 3). On the Main board a click arms it. On the phone a pointer click on a card that is
 * not the middle one only brings it to the middle, so the card is tapped, its row item is waited on for `data-kb-middle`, and it is tapped
 * once more: a click on the middle card arms it and closes the hand.
 */
export async function armCard(page: Page, name: RegExp): Promise<void> {
  const hand = page.getByRole('dialog', { name: 'Your hand' });
  /* The deal is over before a card is pressed: a card pressed while it eases is judged by where the row stood when the press began. */
  await expect(hand).not.toHaveAttribute('data-kb-dealing', '', { timeout: 10_000 });
  const card = hand.getByRole('button', { name }).first();
  const item = card.locator('xpath=ancestor::li[1]');
  if (await page.locator('html').getAttribute('data-kb-layout') === 'phone' && (await item.getAttribute('data-kb-middle')) === null) {
    await card.click();
    await expect(item).toHaveAttribute('data-kb-middle', '');
  }
  await card.click();
}
