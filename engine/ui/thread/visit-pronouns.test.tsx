import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS, type PronounSet } from '../../rules/pronouns.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';

/*
 * A visit's Mod is a character the thread's page hands with its profile; the mark and the Lens tab carry that character's set
 * through Thread (`pronounsOf`) and Post to the strip (`modPronouns`), so a copy line about the Mod reads the office's holder as the thread knows it.
 */
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

function visited(pronouns: PronounSet) {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns });
  const visit = fake.seed.visit(clerk, second, { at: Date.now(), endsInMs: 60_000 });
  fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
  fake.signInAs(me);
  return { fake, thread };
}

describe.each([
  ['she/her', PRONOUN_PRESETS.she, 'her'],
  ['they/them', PRONOUN_PRESETS.they, 'their'],
] as const)('a filed visit by a %s Mod', (_label, pronouns, their) => {
  test('the mark and the tab heading read the Mod\'s set', async () => {
    const w = visited(pronouns);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    const post = await screen.findByRole('article', { name: /^Post 2 /u });
    const mark = await within(post).findByRole('button', { name: /Opens the visit\.$/u });
    expect(mark).toHaveAccessibleName(`The Clerk filed ${their} visit to this post. Opens the visit.`);
    await userEvent.click(mark);
    const lens = await screen.findByRole('dialog');
    expect(await within(lens).findByRole('heading', { name: `The Clerk filed ${their} report` })).toBeInTheDocument();
  });
});
