import { expect, test } from '@playwright/test';
import type { BoardManifest } from './board-match.ts';
import { snapshotPage } from './board-snapshot.ts';

/**
 * The end-to-end build's story route (web/src/data/fixtures/stories.tsx), in the browser: a board's
 * story opened at `?fixture=boards&story=<id>` is the story alone, with no app around it, and the
 * board match finds its landmarks by role and name there as it does in the app; an id the build
 * does not have is the start error's plain words, naming it and the ones there are. The glass's
 * fonts are installed by a style the site's policy refuses (the boards spec opens its pages the
 * same way), so the policy is set aside here as there.
 */
test.use({ bypassCSP: true });

const manifest: BoardManifest = {
  board: 'x',
  size: { width: 1440, height: 900 },
  build: { story: 'boards-04-orbs--board' },
  landmarks: [
    { id: 'title', role: 'heading', name: 'Aura' },
    { id: 'orbs', role: 'img', name: 'x', buildName: 'Wallet 4.62 of 6 orbs, 0.30 pending until the next settlement (estimate)' },
    { id: 'step', role: 'text', name: '2 · Flash' },
  ],
};

test('a board story is opened alone, and the board match finds its landmarks by name', async ({ page }) => {
  await page.setViewportSize(manifest.size);
  await page.goto('/?fixture=boards&story=boards-04-orbs--board');
  await expect(page.getByRole('heading', { name: 'Aura' })).toBeVisible();
  const { shots } = await snapshotPage(page, manifest, 'build');
  expect(shots.map((s) => [s.id, s.found])).toEqual([['title', true], ['orbs', true], ['step', true]]);
  /* The story alone: no Game HUD, no board navigation. */
  await expect(page.getByRole('region', { name: 'Game HUD' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('an id the build does not have says so, naming the ones it has', async ({ page }) => {
  await page.goto('/?fixture=boards&story=boards-99-nope--board');
  await expect(page.getByRole('heading', { name: 'This site could not start' })).toBeVisible();
  await expect(page.getByText(/boards-99-nope--board/)).toContainText('boards-04-orbs--board');
});
