/**
 * Divided World's themes: the house theme and the four tributes (docs/plans/2026-11-06-board-look-plan.md, Task 17). The picker
 * lists one tile for each, a one-mode theme's modes are the keys of the preview its own file gives, and each tribute sets its
 * tokens so the board stays in its mode (on :root and in both dark blocks alike for a dark-only theme).
 */
import { readFileSync } from 'node:fs';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { KayfaProvider, useKayfa } from '../../../engine/ui/context.tsx';
import { SettingsScreen } from '../../../engine/ui/account/Settings.tsx';
import { buildWorld, renderIn } from '../../../engine/ui/test-world.tsx';
import { instanceUiProblems } from '../../../engine/ui/tips/problems.ts';
import { instance } from '../index.ts';
import { instanceUi } from './index.ts';

afterEach(cleanup);

/** The screen under Divided World's own theme list, as the app hands it: the test world's other words stay. */
function UnderRealThemes({ children }: { readonly children: ReactNode }) {
  const kayfa = useKayfa();
  return <KayfaProvider value={{ ...kayfa, ui: { ...kayfa.ui, themes: instanceUi.themes } }}>{children}</KayfaProvider>;
}

describe('Divided World\'s themes', () => {
  test('are the house theme and the four tributes, each holding the modes its file holds', () => {
    expect(instanceUi.themes.map((t) => [t.key, t.name, t.modes])).toEqual([
      ['house', 'House', 'both'],
      ['blue-steel', 'Blue Steel', 'light'],
      ['midnight', 'Midnight', 'dark'],
      ['hot-rod', 'Hot Debate', 'dark'],
      ['fan-site', 'Fan Site', 'dark'],
    ]);
    expect(new Set(instanceUi.themes.map((t) => t.href)).size, 'each theme loads its own stylesheet').toBe(5);
    expect(instanceUiProblems(instanceUi, instance).filter((p) => /theme/iu.test(p))).toEqual([]);
  });

  test('the picker lists five tiles, with their modes in words', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <UnderRealThemes><SettingsScreen /></UnderRealThemes>, { path: '/settings?section=board' });
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      'HouseLight and dark', 'Blue SteelLight only', 'MidnightDark only', 'Hot DebateDark only', 'Fan SiteDark only',
    ]);
  });

  test('Hot Debate\'s banner fire is credited as CREDITS.md, beside the files, credits it, and only Hot Debate has art', () => {
    const art = instanceUi.themes.filter((t) => t.banner).map((t) => [t.key, t.banner!.credit]);
    expect(art.map(([k]) => k)).toEqual(['hot-rod']);
    const credit = instanceUi.themes.find((t) => t.key === 'hot-rod')!.banner!.credit;
    const notice = readFileSync('instances/divided-world/ui/themes/hot-debate/CREDITS.md', 'utf8');
    for (const file of ['fire.gif', 'fire-still.png']) {
      const row = notice.split('\n').find((l) => l.startsWith(`| \`${file}\``));
      expect(row, file).toBeDefined();
      expect(row).toContain(credit.author);
      expect(row).toContain(credit.source);
      expect(row).toContain(`[${credit.license}](${credit.licenseUrl})`);
    }
    expect(notice).toContain(`"${credit.work}"`);
  });
});
