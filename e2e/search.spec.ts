import { expect, test } from '@playwright/test';

/*
 * Search on the demo (docs/plans/2026-11-07-search-plan.md, Task 8): the banner's box suggests as it is typed and Enter on a suggested thread
 * lands on it; the results page finds posts by a phrase, narrows them to one author, pages forward and back, and shows the same hits as
 * threads; and the Reveal overlay's Thread field finds a thread by its title and reveals the class there. Every step is the keyboard's.
 */

test('the banner suggests as it is typed, and Enter on a suggested thread lands on it', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Search the boards' });
  await box.fill('thumbs');
  const thread = page.getByRole('option', { name: /Who keeps reacting with a thumbs up\?/u });
  await expect(thread).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', /.+/u);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/t\//u);
  await expect(page.getByRole('heading', { level: 1, name: 'Who keeps reacting with a thumbs up?' })).toBeVisible();
});

test('Enter on the typed words searches posts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search the boards' }).fill('still going');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=still\+going|\/search\?q=still%20going/u);
  await expect(page.getByTestId('search-count')).toContainText('posts');
});

test('a phrase finds posts, an author narrows them, and the pages go forward and back', async ({ page }) => {
  await page.goto('/search');
  const form = page.getByRole('search', { name: 'Search the boards' });
  await form.getByRole('combobox', { name: 'Keywords' }).fill('"still going"');
  await form.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=/u);
  const all = page.getByTestId('search-count');
  await expect(all).toContainText('posts');
  const everyone = Number((await all.innerText()).match(/([\d,]+) posts/u)![1]!.replace(/,/gu, ''));
  expect(everyone).toBeGreaterThan(20);
  await expect(page.locator('.kb-search-hit').first()).toBeVisible();

  /* Filter by author: the Posted by box suggests characters, and choosing one narrows the count. */
  await page.getByRole('combobox', { name: 'Posted by' }).fill('Pipe');
  await expect(page.getByRole('listbox').getByRole('option', { name: /Pipewrench/u })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Posted by' })).toHaveValue('Pipewrench');
  await page.getByRole('search', { name: 'Search the boards' }).getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/author=/u);
  const mine = Number((await page.getByTestId('search-count').innerText()).match(/([\d,]+) posts/u)![1]!.replace(/,/gu, ''));
  expect(mine).toBeGreaterThan(0);
  expect(mine).toBeLessThan(everyone);
  for (const who of await page.locator('.kb-search-results tbody tr .kb-search-who').allInnerTexts()) expect(who).toContain('Pipewrench');

  /* Page forward and back: five to a page, so there are pages; the address carries the cursor, and Back returns to the first. */
  await page.goto(page.url() + '&per=5');
  const first = await page.locator('.kb-search-results tbody tr .kb-search-title').first().innerText();
  const top = page.getByRole('navigation', { name: 'Pages of results', exact: true });
  await expect(top).toContainText('Page 1 of');
  await top.getByRole('link', { name: /Next/u }).click();
  await expect(page.getByRole('navigation', { name: 'Pages of results', exact: true })).toContainText('Page 2 of');
  const second = await page.locator('.kb-search-results tbody tr').first().innerText();
  await page.getByRole('navigation', { name: 'Pages of results', exact: true }).getByRole('link', { name: /Previous/u }).click();
  await expect(page.getByRole('navigation', { name: 'Pages of results', exact: true })).toContainText('Page 1 of');
  expect(await page.locator('.kb-search-results tbody tr .kb-search-title').first().innerText()).toBe(first);
  expect(second.length).toBeGreaterThan(0);
});

test('the same search shows its hits as threads', async ({ page }) => {
  await page.goto('/search');
  const form = page.getByRole('search', { name: 'Search the boards' });
  await form.getByRole('combobox', { name: 'Keywords' }).fill('still going');
  /* Escape once the list has answered: a reply that lands after Escape opens the list again (reported by this story, not worked around). */
  await expect(page.getByRole('option', { name: /^Search posts for/u })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await form.getByRole('radio', { name: 'threads' }).check();
  await form.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/as=threads/u);
  await expect(page.getByTestId('search-count')).toContainText('thread');
  const row = page.locator('.kb-search-results tbody tr').first();
  await expect(row).toContainText('The long one');
  await expect(row).toContainText('matching posts');
});

test('the Reveal overlay finds a thread by its title and reveals the class there', async ({ page }) => {
  await page.goto('/characters');
  await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
  await page.getByRole('button', { name: "Reveal Pipewrench's class" }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Thread' }).fill('thumbs');
  /* The list first holds the newest threads; wait for the answer to "thumbs", the one thread. */
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option', { name: /Who keeps reacting/u })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('combobox', { name: 'Thread' })).toHaveValue('Who keeps reacting with a thumbs up?');
  await dialog.getByRole('button', { name: /^Reveal Pipewrench as a/u }).click();
  await expect(dialog).toHaveCount(0);
});
