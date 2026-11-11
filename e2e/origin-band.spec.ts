import { expect, test, type Page } from '@playwright/test';

/**
 * The ORIGIN box's band in a real browser (the origin-band plan, Task 2): the head is the column head's strip, runs edge to edge in
 * the box's 1px frame, the body sits on the second row's ground, the link keeps the band's ink and ring, and under forced colors
 * the band is still a head. The backend is in memory and per page load, so a spun thread leaves nothing for a re-run or another spec.
 */
async function spunThread(page: Page): Promise<void> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('#post-1').getByRole('button', { name: 'Spin thread' }).click();
  await page.getByRole('textbox', { name: 'Thread title' }).fill('Band check');
  await page.getByRole('textbox', { name: 'Your opening post (optional)' }).fill('Carrying on over here.');
  await page.getByRole('form', { name: /^Spin a thread/ }).locator('button[data-kb-primary]').click();
  await expect(page.getByRole('group', { name: 'Origin', exact: true })).toBeVisible();
}

test.describe('the band', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('is the column head\'s strip: its gradient and its ink', async ({ page }) => {
    await spunThread(page);
    const style = (sel: string, prop: 'backgroundImage' | 'color') => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e)[p as 'color'], prop);
    const strip = await style('.kb-acts-head > span', 'backgroundImage');
    expect(strip).toMatch(/linear-gradient/u);
    expect(await style('.kb-origin-head', 'backgroundImage'), 'the head\'s background-image').toBe(strip);
    expect(await style('.kb-origin-head', 'color'), 'the head\'s color').toBe(await style('.kb-acts-head > span', 'color'));
  });

  test('runs edge to edge inside the box\'s 1px frame', async ({ page }) => {
    await spunThread(page);
    const box = page.getByRole('group', { name: 'Origin', exact: true });
    const frame = await box.evaluate((e) => { const c = getComputedStyle(e); return `${c.borderTopStyle} ${c.borderTopWidth}`; });
    expect(frame, 'the box\'s border').toBe('solid 1px');
    const b = (await box.boundingBox())!;
    const h = (await page.locator('.kb-origin-head').boundingBox())!;
    expect(Math.abs(h.x - (b.x + 1)), 'head left').toBeLessThanOrEqual(0.5);
    expect(Math.abs(h.x + h.width - (b.x + b.width - 1)), 'head right').toBeLessThanOrEqual(0.5);
  });

  test('the body is on the second row\'s ground, the post on the first\'s', async ({ page }) => {
    await spunThread(page);
    const probe = (v: string) => page.evaluate((name) => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue(name); document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }, v);
    const bg = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
    const post = await bg('.kb-act-main');
    const box = await bg('.kb-origin');
    expect(box, 'the box vs the opening post').not.toBe(post);
    expect(box, 'the box is on --kb-row-2').toBe(await probe('--kb-row-2'));
  });

  test('the link keeps the band\'s ink, on hover too, and underlines thicker on hover', async ({ page }) => {
    await spunThread(page);
    const link = page.locator('.kb-origin-head a').first();
    const look = () => link.evaluate((e) => ({ color: getComputedStyle(e).color, thick: parseFloat(getComputedStyle(e).textDecorationThickness) || 0 }));
    const head = await page.locator('.kb-origin-head').evaluate((e) => getComputedStyle(e).color);
    const rest = await look();
    expect(rest.color, 'the link at rest').toBe(head);
    await link.hover();
    const over = await look();
    expect(over.color, 'the link on hover').toBe(head);
    expect(over.thick, 'underline thickness on hover').toBeGreaterThan(rest.thick);
  });

  test('the link\'s focus ring is the column head\'s, not the page\'s', async ({ page }) => {
    await spunThread(page);
    const probe = (v: string) => page.evaluate((name) => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue(name); document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }, v);
    const pageRing = await probe('--kb-focus');
    const headRing = await probe('--kb-head-focus');
    expect(headRing, 'the house theme\'s two rings differ (else the case proves nothing)').not.toBe(pageRing);
    const link = page.locator('.kb-origin-head a').first();
    /* The box takes focus when the thread is spun (Origin.tsx); the next Tab reaches the link. */
    await expect(page.getByRole('group', { name: 'Origin', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    const ring = await link.evaluate((e) => getComputedStyle(e).outlineColor);
    expect(ring, 'the link\'s ring is not the page\'s').not.toBe(pageRing);
    expect(ring, 'the link\'s ring is the column head\'s').toBe(headRing);
  });
});

test.describe('forced colors', () => {
  test.use({ viewport: { width: 1280, height: 900 }, forcedColors: 'active' });

  test('the band is still a head: a 1px line under it, in the box\'s 1px frame', async ({ page }) => {
    await spunThread(page);
    const edge = (sel: string, side: 'Bottom' | 'Top') => page.locator(sel).first().evaluate((e, s) => { const c = getComputedStyle(e); return `${c[`border${s}Style` as 'borderTopStyle']} ${c[`border${s}Width` as 'borderTopWidth']}`; }, side);
    expect(await edge('.kb-origin-head', 'Bottom'), 'the head\'s border-bottom').toBe('solid 1px');
    expect(await edge('.kb-origin', 'Top'), 'the box\'s border-top').toBe('solid 1px');
  });
});
