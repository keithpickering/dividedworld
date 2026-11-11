import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { settled } from './settled.ts';

/**
 * The payout cards in a browser (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 10), on the stories of engine/ui/cards/Payouts.board.stories.tsx: the
 * Lens of each play card shows its status and its end, and each play form is reached and operated by the keyboard alone, and axe finds nothing on either.
 * The cards are found by the stories by their rules, so this names no card and no instance: what is read is the Lens and the form.
 */
test.use({ bypassCSP: true });

const STORY = (name: string) => `/?fixture=boards&story=cards-payout-cards--${name}`;
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** axe's violations over the whole page, contrast included; none when the page is right. */
async function violations(page: Page): Promise<string[]> {
  await page.addStyleTag({ content: '.kb-smoke-layers { display: none !important; }' });
  await page.evaluate(axeSource);
  const found = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[] }> } }).axe;
    return (await axe.run(document, { runOnly: { type: 'tag', values: tags } })).violations;
  }, TAGS);
  return found
    .map((v) => ({ ...v, nodes: v.id === 'scrollable-region-focusable' ? v.nodes.filter((n) => !(Array.isArray(n.target) && n.target.length === 1 && (n.target[0] === 'body' || n.target[0] === 'html'))) : v.nodes }))
    .filter((v) => v.nodes.length > 0)
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 8).map((n) => JSON.stringify(n.target)).join(' | ')}`);
}

const lens = (page: Page) => page.locator('.kb-lens').first();
const form = (page: Page) => page.locator('form.kb-play').first();

/** Opens a story, whose own player presses the card's mark (a Lens) or the ghost on the post (a play form), and waits for the screen. */
async function open(page: Page, name: string, screen: 'lens' | 'form') {
  await page.goto(STORY(name));
  await expect(screen === 'lens' ? lens(page) : form(page)).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await settled(page, { loops: true });
}

/** Each story's words: the card's status (a skim names its quadrant's label, a ride Gimmick says whom it pays, a card back says only that it is face down, a scored-as names its class) and its end. */
const ENDS = /^Ends \w+ \d+, \d+:\d\d\s[AP]M$/u;
for (const [name, what, status, end] of [
  ['skim', 'a skim play', /^Mooching Hype off this post$/u, ENDS],
  ['ride', 'a ride Gimmick play', /^Pays its author for votes here$/u, ENDS],
  ['ride-back', 'a ride Reversal face down', /^Face down on this post$/u, /^Ends \w+ \d+, \d+:\d\d\s[AP]M, unless it springs first\.$/u],
  ['scored-as', 'a scored-as play', /^Scores as a Heel next window$/u, ENDS],
] as const) {
  test(`the Lens of ${what} shows its status and its end, and axe finds nothing`, async ({ page }) => {
    await open(page, name, 'lens');
    const body = lens(page).getByRole('tabpanel');
    await expect(body).toBeVisible();
    /* The status: the card's words for where the play stands, in the line under the tab; and the end: the time it ends by itself, in the view's way out. */
    await expect(body.locator('.kb-lens-state .kb-lens-line').first()).toHaveText(status);
    await expect(body.locator('.kb-lens-ends')).toHaveText(end);
    expect(await violations(page)).toEqual([]);
  });
}

for (const [name, what] of [['skim-form', 'the skim card'], ['ride-back-form', 'the ride Reversal'], ['scored-as-form', 'the scored-as card']] as const) {
  test(`the play form of ${what} is reached and operated by the keyboard alone, and axe finds nothing`, async ({ page }) => {
    await open(page, name, 'form');
    const f = form(page);
    /* The card's own choices (a quadrant, a class, the Move waited for) are groups of radios under a legend, one after the other; Tab reaches each from the top
       of the page with no pointer, and an arrow key chooses one. */
    const picks = f.locator('fieldset.kb-choice-pick, fieldset.kb-trap-pick');
    const groups = await picks.count();
    expect(groups).toBeGreaterThan(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let g = 0; g < groups; g++) {
      const pick = picks.nth(g);
      await expect(pick.getByRole('radio', { checked: true })).toHaveCount(0);
      let reachedPick = false;
      for (let i = 0; i < 60 && !reachedPick; i++) {
        await page.keyboard.press('Tab');
        reachedPick = await pick.evaluate((el) => el.contains(document.activeElement));
      }
      expect(reachedPick, `Tab reaches choice ${g + 1}`).toBe(true);
      await page.keyboard.press('ArrowDown');
      await expect(pick.getByRole('radio', { checked: true })).toHaveCount(1);
    }
    /* Then on to the button that plays it, by Tab alone. */
    const submit = f.locator('button[type="submit"]');
    let reachedSubmit = false;
    for (let i = 0; i < 40 && !reachedSubmit; i++) {
      await page.keyboard.press('Tab');
      reachedSubmit = await submit.evaluate((el) => el === document.activeElement);
    }
    expect(reachedSubmit, 'Tab reaches the button that plays or sets the card').toBe(true);
    expect(await violations(page)).toEqual([]);
  });
}
