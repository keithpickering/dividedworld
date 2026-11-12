import { expect, test, type Page } from '@playwright/test';

/**
 * A post's layers, as a browser stacks them (engine/ui/thread/thread.css): two designs give a post's cells layers, and this holds them
 * together where jsdom cannot, since it has no stacking.
 *
 *  1. Gear that reaches past the portrait sits behind the post's other cells: the line above, the words, the actions and the panels
 *     always paint over it (the cosmetics design, section 2: "the z-index of surrounding text always wins"), whether or not glitter has
 *     landed on any cell, the postbit's own included.
 *  2. Glitter that has landed on a cell lies over that cell's ground and under its content (docs/plans/2026-11-11-shake-design.md,
 *     section 4), on every cell, the postbit's too.
 *  3. The marks strip and its first-time callout, which hang from the line above over the words, paint above the words, with glitter
 *     landed on the cells and without.
 *
 * What a point shows is `elementFromPoint`, which follows the paint order. Gear and landed tiles take no pointer, so the checks give them
 * one through the CSSOM (the page's CSP takes no injected style sheet) only to ask where they lie; nothing else on the page changes.
 */
const GEAR = '/?fixture=boards&story=boards-01-postbit-gear--gear-and-trophies';
const GLITTER = '/?fixture=boards&story=boards-09-glitter-bomb--light';

/** Marks every cell of every post as landed, as landing.ts does for a cell glitter has landed on. */
const landAll = (page: Page) => page.evaluate(() => {
  for (const a of Array.from(document.querySelectorAll('article.kb-act'))) {
    for (const c of Array.from(a.children)) if (!c.classList.contains('kb-visually-hidden')) c.setAttribute('data-kb-landed', '');
  }
});

/** Opens the gear story with every worn piece of the first post blown up over the whole post, its clip lifted and its pointer given back. */
async function gearOverPost(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(GEAR);
  await expect(page.locator('article.kb-act .kb-outfit img').first()).toBeVisible();
  await page.evaluate(() => {
    const post = document.querySelector('article.kb-act')!;
    const p = post.getBoundingClientRect();
    const outfit = post.querySelector<HTMLElement>('.kb-outfit')!;
    const o = outfit.getBoundingClientRect();
    outfit.style.clipPath = 'none';
    outfit.style.pointerEvents = 'auto';
    for (const img of Array.from(outfit.querySelectorAll<HTMLElement>('img'))) {
      Object.assign(img.style, { pointerEvents: 'auto', transform: 'none', left: `${p.left - o.left}px`, top: `${p.top - o.top}px`, width: `${p.width}px`, height: `${p.height}px` });
    }
  });
}

/** Points on the first post's words: the date, the first line of the words, the first action, the postbit's name. */
const probes = (page: Page) => page.evaluate(() => {
  const post = document.querySelector('article.kb-act')!;
  const mid = (r: DOMRect) => ({ x: r.left + Math.min(r.width / 2, 6), y: r.top + r.height / 2 });
  const text = (root: Element) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const node = walk.nextNode()!;
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, 1);
    return mid(range.getBoundingClientRect());
  };
  return {
    meta: text(post.querySelector('.kb-act-meta time')!),
    words: text(post.querySelector('.kb-act-main')!),
    foot: mid(post.querySelector('.kb-act-foot button')!.getBoundingClientRect()),
    name: text(post.querySelector('.kb-postbit-name')!),
  };
});

/** What the page shows at a point: whether it is gear, a landed tile, or else the cell it lies in and whether it is the cell itself. */
const at = (page: Page, q: { x: number; y: number }) => page.evaluate(({ x, y }) => {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return 'nothing';
  if (hit.closest('.kb-outfit')) return 'gear';
  if (hit.matches('canvas[data-kb-landing]')) return 'tile';
  const cell = hit.closest('article.kb-act > *');
  return cell === hit ? `the ground of ${cell.className}` : `content of ${cell?.className ?? hit.tagName}`;
}, q);

for (const landed of [false, true]) {
  test(`gear blown up over a post paints under the line, the words and the actions${landed ? ', with glitter landed on every cell' : ''}`, async ({ page }) => {
    await gearOverPost(page);
    if (landed) await landAll(page);
    const p = await probes(page);
    /* The probe itself sees gear where nothing covers it: the portrait, under nothing but its own layer. */
    const slot = await page.locator('article.kb-act .kb-postbit-avatar').first().boundingBox();
    expect(await at(page, { x: slot!.x + slot!.width / 2, y: slot!.y + slot!.height / 2 }), 'the gear over its own portrait').toBe('gear');
    for (const cell of ['meta', 'words', 'foot'] as const) expect(await at(page, p[cell]), cell).toMatch(/^content of /u);
  });
}

test('glitter landed on each cell lies over the cell\'s ground and under its words', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(GEAR);
  await expect(page.locator('article.kb-act .kb-act-meta time').first()).toBeVisible();
  const p = await probes(page);
  /* A ground point of each cell: a corner inside its padding, where the cell shows only itself. */
  const grounds = await page.evaluate(() => {
    const post = document.querySelector('article.kb-act')!;
    return Object.fromEntries(['.kb-postbit', '.kb-act-meta', '.kb-act-main', '.kb-act-foot'].map((sel) => {
      const r = post.querySelector(sel)!.getBoundingClientRect();
      return [sel, { x: r.right - 3, y: r.bottom - 3 }];
    }));
  });
  for (const [sel, q] of Object.entries(grounds)) expect(await at(page, q), `${sel} before glitter`).toBe(`the ground of ${sel.slice(1)}`);
  /* A tile over the whole of each cell, as landing.ts places one (absolute, in the cell's px), taking the pointer only to be asked. */
  await page.evaluate(() => {
    const post = document.querySelector('article.kb-act')!;
    for (const sel of ['.kb-postbit', '.kb-act-meta', '.kb-act-main', '.kb-act-foot']) {
      const cell = post.querySelector<HTMLElement>(sel)!;
      cell.setAttribute('data-kb-landed', '');
      const tile = document.createElement('canvas');
      tile.dataset.kbLanding = 'cell';
      Object.assign(tile.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'auto' });
      cell.append(tile);
    }
  });
  for (const [sel, q] of Object.entries(grounds)) expect(await at(page, q), `${sel}'s ground`).toBe('tile');
  for (const cell of ['meta', 'words', 'foot', 'name'] as const) expect(await at(page, p[cell]), cell).toMatch(/^content of /u);
});

/** Whether the element is what the page shows at points across its box (the box cut to the view), not something under another. */
const onTop = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const x0 = Math.max(0, r.left), x1 = Math.min(innerWidth, r.right), y0 = Math.max(0, r.top), y1 = Math.min(innerHeight, r.bottom);
  if (x1 - x0 < 2 || y1 - y0 < 2) return ['is not in view'];
  const bad: string[] = [];
  for (const [fx, fy] of [[0.15, 0.15], [0.85, 0.15], [0.5, 0.5], [0.15, 0.85], [0.85, 0.85]] as const) {
    const x = x0 + (x1 - x0) * fx, y = y0 + (y1 - y0) * fy;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (!el.contains(hit) && !hit.contains(el))) bad.push(`at ${Math.round(x)},${Math.round(y)} the page shows ${hit?.tagName}.${hit?.className}`);
  }
  return bad;
});

for (const landed of [false, true]) {
  test(`the marks strip and its callout paint above the words${landed ? ', with glitter landed on every cell' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1120 });
    await page.goto(GLITTER);
    const post = page.locator('article.kb-act:has([data-kb-glitter])').first();
    await expect(post.locator('.kb-act-meta .kb-callout').first()).toBeVisible();
    if (landed) await landAll(page);
    await post.scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.scrollBy(0, -200); });
    expect(await onTop(page, 'article.kb-act:has([data-kb-glitter]) .kb-act-meta .kb-marks'), 'the marks strip').toEqual([]);
    /* Where each mark hangs over the words (the strip's foot, below the words' top edge), the mark is what shows: the check is asked
       where the two overlap, and there must be such a place for it to mean anything. */
    const hung = await post.evaluate((a) => {
      const top = a.querySelector('.kb-act-main')!.getBoundingClientRect().top;
      return Array.from(a.querySelectorAll('.kb-act-meta .kb-mark')).flatMap((m) => {
        const r = m.getBoundingClientRect();
        if (r.bottom - top < 2) return [];
        const hit = document.elementFromPoint(r.left + r.width / 2, (top + r.bottom) / 2);
        return [hit && m.contains(hit) ? 'the mark' : `${hit?.tagName}.${hit?.className}`];
      });
    });
    expect(hung.length, 'marks that hang over the words').toBeGreaterThan(0);
    expect(hung.filter((h) => h !== 'the mark'), 'what shows where a mark hangs over the words').toEqual([]);
    expect(await onTop(page, 'article.kb-act:has([data-kb-glitter]) .kb-act-meta .kb-callout'), 'the callout').toEqual([]);
    /* The character's strip over its postbit's top corner (marks.css), out of the postbit's flow and over its words, which are lifted over the gear. */
    expect(await post.locator('.kb-postbit-marks').evaluate((s) => getComputedStyle(s).position), 'the postbit\'s strip is out of the flow').toBe('absolute');
    expect(await onTop(page, 'article.kb-act:has([data-kb-glitter]) .kb-postbit .kb-marks'), 'the postbit\'s marks strip').toEqual([]);
  });
}
