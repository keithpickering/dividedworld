import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';
import { settled } from './settled.ts';

/**
 * The veil cards in a browser (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 12), on the stories of engine/ui/thread/Veils.board.stories.tsx and the instance's
 * Whodunnit story (`Boards/22 Whodunnit`): a veiled post shows the stand-in's name and none of its author's, to a third reader and to the author's own player; a blind
 * post's row is a third reader's, the author's and the caster's own (each told in words who sees what); the new reaction chip is in the picker under its quadrant; the
 * line a worn-off Whodunnit? leaves is drawn after its end; and axe finds nothing on any of them, on the Main board's window and the Phone board's.
 * The authors and casters are the boards fixture's (the player owns Spritey and Mrs. Hooligan; the rival, Gloomba, reads them as a third reader); no card is named here
 * but by the words it draws.
 */
test.use({ bypassCSP: true });

const STORY = (id: string) => `/?fixture=boards&story=${id}`;
const VEILS = (name: string) => STORY(`boards-01-veiled-and-blind-posts--${name}`);
const BOARDS = [['Main board', { width: 1440, height: 1120 }], ['Phone board', { width: 390, height: 844 }]] as const;

/** Opens a story and waits for the thread to have drawn the post the scene looks at. */
async function open(page: Page, url: string, post: number) {
  await page.goto(url);
  await expect(page.locator(`#post-${post}`)).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await settled(page, { loops: true });
}

/** The row under a post: the chips, and the one line the blind card leaves. */
const row = (page: Page, post: number) => page.locator(`#post-${post} .kb-reactions`);
const line = (page: Page, post: number) => row(page, post).locator('p, .kb-reactions-line').filter({ hasText: /until/u });

test('a third reader sees the stand-in in the veiled post and not its author, in the postbit and anywhere on the page', async ({ page }) => {
  await open(page, VEILS('reader'), 41);
  /* The post's own article is named for its author as the page shows it: the stand-in. */
  await expect(page.getByRole('article', { name: 'Post 41 by Anonymous' })).toBeVisible();
  await expect(page.locator('#post-41').getByRole('link', { name: 'Anonymous' })).toBeVisible();
  /* Its author's name is not on the page at all: the post's thread page holds #41 and #42 alone at this moment, and #42 is by another of the same player's characters. */
  await expect(page.locator('#post-41')).not.toContainText('Spritey');
  await expect(page.getByText('Spritey')).toHaveCount(0);
  /* The card's own Lens says only that the author is hidden, to everyone. */
  await page.locator('#post-41 .kb-mark[data-kb-card="whodunnit"]').click();
  const lens = page.locator('.kb-lens').first();
  await expect(lens.getByText('Author hidden from everyone')).toBeVisible();
  await expect(lens).not.toContainText('This is your post');
});

test('the author\'s own player sees the same stand-in, and the Lens tells her the post is hers', async ({ page }) => {
  await open(page, VEILS('veiled-and-blind'), 41);
  await expect(page.getByRole('article', { name: 'Post 41 by Anonymous' })).toBeVisible();
  await expect(page.locator('#post-41')).not.toContainText('Spritey');
  await page.locator('#post-41 .kb-mark[data-kb-card="whodunnit"]').click();
  const lens = page.locator('.kb-lens').first();
  await expect(lens.getByText('Author hidden from everyone')).toBeVisible();
  await expect(lens.getByText('This is your post. Everyone else sees the stand-in in your place, and so does this page.')).toBeVisible();
});

test('a blind post\'s row, for a third reader, shows no count and none of the kinds she did not give, and says why', async ({ page }) => {
  await open(page, VEILS('reader'), 42);
  /* Her own Folded hands is the one chip, without its count; the 💀 a card added and every other kind are not drawn. */
  const chips = row(page, 42).getByRole('button');
  await expect(row(page, 42).locator('[data-kb-stop]').filter({ hasText: /\d/u })).toHaveCount(0);
  await expect(row(page, 42)).not.toContainText('💀');
  await expect(chips.filter({ hasText: '🙏' })).toHaveCount(1);
  await expect(page.locator('#post-42')).toContainText(/^[\s\S]*Reaction totals are hidden on this post until \w+ \d+, \d+:\d\d\s[AP]M\.[\s\S]*$/u);
  await expect(page.locator('#post-42')).not.toContainText('Only you and');
});

test('the author\'s player and the caster each see the totals, and the line says who else does', async ({ page }) => {
  await open(page, VEILS('veiled-and-blind'), 42);
  await expect(page.locator('#post-42')).toContainText(/Only you and the caster can see these until \w+ \d+, \d+:\d\d\s[AP]M\./u);
  await expect(row(page, 42)).toContainText('💀');
  await open(page, VEILS('caster'), 42);
  await expect(page.locator('#post-42')).toContainText(/Only you and the author can see these until \w+ \d+, \d+:\d\d\s[AP]M\./u);
  await expect(row(page, 42)).toContainText('💀');
});

test('the picker on a post offers the kind a card added, under the quadrant it scores in', async ({ page }) => {
  await open(page, VEILS('reader'), 42);
  await page.locator('#post-42').getByRole('button', { name: 'React', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /^React to / });
  await expect(picker).toBeVisible();
  const hype = picker.getByRole('group', { name: 'Hype' });
  await expect(hype.getByRole('button', { name: '💀, Hype, added by a card' })).toBeVisible();
  for (const other of ['Heat', 'Groan', 'Calm']) await expect(picker.getByRole('group', { name: other }).getByRole('button', { name: /added by a card/u })).toHaveCount(0);
  /* Reached by the keyboard as every other kind is: the arrows move through the grid, and Down from Fire (the Hype row above it) lands on it. */
  await hype.getByRole('button', { name: 'Fire, Hype' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(hype.getByRole('button', { name: '💀, Hype, added by a card' })).toBeFocused();
});

for (const mode of ['light', 'dark'] as const) {
  test(`once Whodunnit? has worn off, the post is under its author's name with the one line, on the ${mode} board`, async ({ page }) => {
    await open(page, STORY(`boards-22-whodunnit--wore-off-${mode}`), 43);
    await expect(page.getByRole('article', { name: 'Post 43 by Pipewrench' })).toBeVisible();
    const wore = page.locator('#post-43 .dw-whodunnit-wore');
    await expect(wore).toHaveText(/^Whodunnit\? wore off on \w+ \d+, \d+:\d\d\s[AP]M\. This post was Pipewrench's all along\.$/u);
    await expect(page.locator('#post-43')).not.toContainText('Anonymous');
  });
}

test('the stand-in\'s profile has a name and a tagline, and no one behind it', async ({ page }) => {
  await page.goto(VEILS('stand-in-profile'));
  await expect(page.getByRole('heading', { level: 1, name: 'Anonymous' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Could be anyone.')).toBeVisible();
  for (const owner of ['Pipewrench', 'Mrs. Hooligan', 'Spritey', 'Story Caster']) await expect(page.getByRole('main').getByText(owner)).toHaveCount(0);
});

for (const [board, size] of BOARDS) {
  test.describe(`axe, on the ${board}`, () => {
    test.use({ viewport: size });

    for (const [what, name, post] of [
      ['a veiled post and a blind one, for their author', 'veiled-and-blind', 41],
      ['a veiled post and a blind one, for a third reader', 'reader', 41],
      ['a blind post, for its caster', 'caster', 42],
    ] as const) {
      test(`${what}: none`, async ({ page }) => {
        await open(page, VEILS(name), post);
        expect(await pageViolations(page)).toEqual([]);
      });
    }

    test('the Lens of a veil, and the picker with the kind a card added: none', async ({ page }) => {
      await open(page, VEILS('reader'), 41);
      await page.locator('#post-41 .kb-mark[data-kb-card="whodunnit"]').click();
      await expect(page.locator('.kb-lens').first()).toBeVisible();
      await settled(page, { loops: true });
      expect(await pageViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await open(page, VEILS('reader'), 42);
      await page.locator('#post-42').getByRole('button', { name: 'React', exact: true }).click();
      await expect(page.getByRole('dialog', { name: /^React to / })).toBeVisible();
      await settled(page, { loops: true });
      expect(await pageViolations(page)).toEqual([]);
    });

    test('the stand-in\'s profile: none', async ({ page }) => {
      await page.goto(VEILS('stand-in-profile'));
      await expect(page.getByRole('heading', { level: 1, name: 'Anonymous' })).toBeVisible({ timeout: 15_000 });
      await settled(page, { loops: true });
      expect(await pageViolations(page)).toEqual([]);
    });

    for (const mode of ['light', 'dark'] as const) {
      test(`the worn-off line, on the ${mode} board: none`, async ({ page }) => {
        await open(page, STORY(`boards-22-whodunnit--wore-off-${mode}`), 43);
        await expect(page.locator('#post-43 .dw-whodunnit-wore')).toBeVisible();
        expect(await pageViolations(page)).toEqual([]);
      });
    }
  });
}
