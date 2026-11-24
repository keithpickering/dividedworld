import { expect, test, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';
import { pageViolations } from './axe.ts';

/**
 * A thread spun from a Mod's answer, as a browser draws it (docs/plans/2026-11-23-spin-mod-answers-plan.md, Task 7). On the demo world: the player's mask reports
 * a post, the fake judges it dismissed (its default, Fake.seed.judging), and the report form offers "Spin thread from <Mod>'s verdict". The new thread's ORIGIN box shows
 * the exchange: both bylines, the Mod's words and the plain line. Then, from the Mod's profile, the moderation log's row for an appeal's ruling spins a thread from that
 * ruling, whose box says what the ruling did and nothing of Aura or of why a visit did not open. The backend is in memory and per page load, so nothing is left for another spec.
 */
test.use({ bypassCSP: true, viewport: { width: 1280, height: 1000 } });

type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo };

const MOD = 'Kassie';
const origin = (page: Page) => page.getByRole('group', { name: 'Origin', exact: true });

/** A Mod on the demo world, and the wallet to pay a report with. */
async function seedMod(page: Page): Promise<void> {
  await page.goto('/b/general');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate((name) => {
    const w = globalThis as E2eWindow;
    w.__kbFake.seed.wallet(w.__kbDemo.me, 600);
    w.__kbFake.seed.staff('e2e-mod', name, 'mod');
  }, MOD);
}

test('a dismissed report spun from the form shows both bylines, the Mod\'s words and the plain line, and axe finds nothing', async ({ page }) => {
  await seedMod(page);
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('#post-3').getByRole('button', { name: 'Report' }).click();
  const report = page.getByRole('form', { name: 'Report post #3' });
  await report.getByLabel('Why (shown with your report)').fill('This post is not in the spirit of the game.');
  await report.getByRole('button', { name: /^Report/u }).click();
  await expect(report.getByRole('status')).toContainText('heard and dismissed');
  await report.getByRole('button', { name: /^Spin thread from / }).click();
  const form = page.getByRole('form', { name: /^Spin a thread/u });
  await form.getByRole('textbox', { name: 'Thread title' }).fill('A dismissal');
  await form.getByRole('button', { name: 'Spin thread' }).click();
  const box = origin(page);
  await expect(box).toBeVisible();
  await expect(box.locator('.kb-exchange')).toHaveAttribute('data-kb-exchange', 'read');
  /* Both bylines: the asker's, then the Mod's. */
  const bylines = box.locator('.kb-exchange-by');
  await expect(bylines).toHaveCount(2);
  await expect(bylines.first()).toContainText('Mrs. Hooligan');
  await expect(bylines.last()).toContainText(MOD);
  await expect(box).toContainText('This post is not in the spirit of the game.');
  await expect(box).toContainText(`${MOD} dismissed it. No visit opened.`);
  expect(await pageViolations(page)).toEqual([]);
});

test('an appeal\'s ruling spun from the Mod\'s moderation log shows the ruling\'s plain line', async ({ page }) => {
  await seedMod(page);
  const ruler = await page.evaluate((name) => {
    const w = globalThis as E2eWindow;
    const f = w.__kbFake;
    const { pipewrench } = w.__kbDemo.characters;
    const mod = f.seed.staff('e2e-ruler', `${name} Two`, 'mod');
    const post = f.seed.thread('general', pipewrench, 'Appealed words', 'A post that was visited.').act;
    const ask = f.seed.appeal(pipewrench, f.seed.infraction(f.seed.visit(mod, post, {})), 'I was only joking.');
    f.seed.ruling(ask, mod, 'upheld', { line: 'It stays.' });
    return mod;
  }, MOD);
  /* A reload would start the demo world over, so the profile is reached by the router's own history. */
  await page.evaluate((id) => { history.pushState(null, '', `/c/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, ruler);
  const row = page.getByRole('row').filter({ hasText: 'Heard an appeal' });
  await row.getByRole('button', { name: /^Spin thread from / }).click();
  const form = page.getByRole('form', { name: /^Spin a thread/u });
  await form.getByRole('textbox', { name: 'Thread title' }).fill('A ruling');
  await form.getByRole('button', { name: 'Spin thread' }).click();
  const box = origin(page);
  await expect(box.locator('.kb-exchange')).toHaveAttribute('data-kb-exchange', 'read');
  await expect(box).toContainText('It stays.');
  await expect(box).toContainText(`${MOD} Two upheld it. Nothing changed.`);
  await expect(box).not.toContainText(/Aura/u);
  expect(await pageViolations(page)).toEqual([]);
});
