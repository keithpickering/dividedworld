import { expect, test, type Page } from '@playwright/test';

/* A long thread of the demo world: 170 Acts, twenty to a page, so post 142 is on page 8. */
async function openLongThread(page: Page): Promise<string> {
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'The long one', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The long one' })).toBeVisible();
  return new URL(page.url()).pathname;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('a phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('a permalink opens its page at the post, in view, with no horizontal scroll at 320px wide', async ({ page }) => {
    const path = await openLongThread(page);
    await page.goto(`${path}?page=8#post-142`);
    const post = page.locator('#post-142');
    await expect(post).toBeVisible();
    await expect(post).toBeInViewport();
    await expect(page.locator('#post-140')).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('a post folds to one column: the postbit above the words', async ({ page }) => {
    const path = await openLongThread(page);
    await page.goto(`${path}?page=1`);
    const post = page.locator('#post-2');
    const bit = post.locator('.kb-postbit');
    const words = post.locator('.kb-act-main');
    await expect(words).toBeVisible();
    const [a, b] = [await bit.boundingBox(), await words.boundingBox()];
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height - 1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test('a permalink without a page opens the page the post is on', async ({ page }) => {
  const path = await openLongThread(page);
  await page.goto(`${path}#post-142`);
  await expect(page.locator('#post-142')).toBeInViewport();
  await expect(page).toHaveURL(/\?page=8#post-142$/u);
});

test('"Continue to page 2" loads the next page below and updates the address, and the page stays where it was', async ({ page }) => {
  const path = await openLongThread(page);
  await page.goto(`${path}?page=1`);
  await expect(page.locator('#post-20')).toHaveCount(1);
  const link = page.getByRole('link', { name: 'Continue to page 2' }).first();
  await link.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await link.click();
  await expect(page.locator('#post-40')).toHaveCount(1);
  await expect(page).toHaveURL(/\?page=2$/u);
  await expect(page.locator('#post-1')).toHaveCount(1);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(50);
});

test.describe('a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the postbit column is narrow, and a character with no avatar gets a small square, not a tall empty box', async ({ page }) => {
    const path = await openLongThread(page);
    await page.goto(`${path}?page=1`);
    const post = page.locator('#post-2');
    const [bit, row] = [await post.locator('.kb-postbit').boundingBox(), await post.boundingBox()];
    expect(bit!.width / row!.width).toBeLessThan(0.2);
    const slot = await post.locator('.kb-postbit-avatar').boundingBox();
    expect(slot!.height).toBeLessThan(80);
  });
});

/*
 * The Phone board's moment (docs/research/2026-10-29-two-worlds/02-phone.html): #41 wears a Whoops! mark. The mark
 * stands in the post's date row, at its right and clear of its permalink, inside the post's width, with no words on it
 * (the marks-and-the-lens design, section 1).
 */
for (const [label, viewport, moment] of [['a narrow post', { width: 390, height: 844 }, '02-phone'], ['a wide post', { width: 1440, height: 1120 }, '01-main']] as const) {
  test.describe(`a card mark on ${label}`, () => {
    test.use({ viewport });

    test('stands in the date row clear of the permalink, stays inside the post\'s width, and has no words on it', async ({ page }) => {
      await page.goto(`/?fixture=boards&moment=${moment}`);
      const post = page.locator('#post-41');
      const mark = post.locator('.kb-mark[data-kb-card]').first();
      await expect(mark).toBeVisible();
      const [m, number, row, article] = await Promise.all([
        mark.boundingBox(),
        post.locator('.kb-act-number').boundingBox(),
        post.locator('header.kb-act-meta').boundingBox(),
        post.boundingBox(),
      ]);
      /* In the row, and clear of the permalink to its right. */
      expect(m!.y, 'the mark starts within the date row').toBeLessThan(row!.y + row!.height);
      expect(m!.x + m!.width, 'the mark ends before the permalink').toBeLessThanOrEqual(number!.x + 1);
      expect(m!.x).toBeGreaterThanOrEqual(article!.x - 1);
      /* No words on it: the name is for a screen reader. */
      expect(((await mark.textContent()) ?? '').replace(/\s|×\d+/gu, '')).toBe('');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

/*
 * The post's three cells (the board look, Task 6): one color across the line, the words and the actions; posts alternate the two row grays; a 4px
 * third-gray row splits them. The check reads a real page and returns its problems, [] when the page is right; the poisons plant each defect with a
 * style tag (the site's policy would block it, so these two tests bypass it) and expect it named.
 */
async function cellProblems(page: Page): Promise<string[]> {
  const read = await page.evaluate(() => {
    const css = (e: Element | null) => (e ? getComputedStyle(e) : null);
    const posts = ['#post-41', '#post-42', '#post-43'].map((id) => document.querySelector<HTMLElement>(id)!);
    const rowToken = (name: string) => { const probe = document.createElement('i'); probe.style.background = `var(${name})`; document.body.append(probe); const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c; };
    return {
      row1: rowToken('--kb-row-1'), row2: rowToken('--kb-row-2'), row3: rowToken('--kb-row-3'),
      posts: posts.map((p) => {
        const line = p.querySelector<HTMLElement>('[data-kb-cell="line"]')!;
        const words = p.querySelector<HTMLElement>('[data-kb-cell="words"]')!;
        const actions = p.querySelector<HTMLElement>('[data-kb-cell="actions"]')!;
        const [l, w, a] = [line, words, actions].map((e) => e.getBoundingClientRect()) as [DOMRect, DOMRect, DOMRect];
        return {
          line: css(line)!.backgroundColor, words: css(words)!.backgroundColor, actions: css(actions)!.backgroundColor, bit: css(p.querySelector('.kb-postbit'))!.backgroundColor,
          /* The line is a band of its own: as wide as the words, above them. */
          bandWidth: l.width - w.width, bandAbove: w.top - l.bottom, actionsBelow: a.top - w.bottom,
          spacer: css(p)!.borderBottomWidth, spacerColor: css(p)!.borderBottomColor,
        };
      }),
    };
  });
  const out: string[] = [];
  const [a, b, c] = read.posts;
  for (const [n, post, row] of [[41, a!, read.row1], [42, b!, read.row2], [43, c!, read.row1]] as const) {
    const got = [post.line, post.words, post.actions, post.bit];
    if (got.some((g) => g !== row)) out.push(`post ${n}: the cells are ${got.join(' | ')}, not all ${row}`);
    if (Math.abs(post.bandWidth) > 0.5) out.push(`post ${n}: the post line is ${post.bandWidth}px off the words' width`);
    if (post.bandAbove < 0 || post.bandAbove > 1.5) out.push(`post ${n}: the post line is ${post.bandAbove}px above the words`);
    if (post.actionsBelow > 1.5) out.push(`post ${n}: the actions are ${post.actionsBelow}px below the words`);
  }
  if (read.row1 === read.row2) out.push('the two row grays are one color');
  if (a!.spacer !== '4px') out.push(`the spacer row is ${a!.spacer}, not 4px`);
  if (a!.spacerColor !== read.row3) out.push(`the spacer row is ${a!.spacerColor}, not ${read.row3}`);
  return out;
}

async function openCells(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41')).toBeVisible();
}

test.describe('the cells', () => {
  test.use({ bypassCSP: true });

  test('a post is three cells of one color, the posts alternate, and a 4px row splits one from the next', async ({ page }) => {
    await openCells(page);
    expect(await cellProblems(page)).toEqual([]);
  });

  test('poison: an even post that keeps the odd gray, a words cell of another color and a 3px spacer are each named', async ({ page }) => {
    await openCells(page);
    await page.addStyleTag({ content: '[data-kb-cell="words"] { background: rgb(255, 0, 0) !important } #post-42 { background: var(--kb-row-1) !important } #post-41 { border-bottom-width: 3px !important }' });
    const problems = await cellProblems(page);
    expect(problems.join('\n')).toMatch(/post 41: the cells are .* not all/u);
    expect(problems.join('\n')).toMatch(/the spacer row is 3px, not 4px/u);
  });
});
