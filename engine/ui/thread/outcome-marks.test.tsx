import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';

/*
 * A Mod's outcome post carries the visit's mark beside the visited post's (the outcome-posts design, section 4): the visit is on the page when its
 * outcome post is, though the visited post is on another page, and the mark opens the same Lens tab.
 */
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  fake.seed.post(thread, spritey, 'post 3');
  const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns: PRONOUN_PRESETS.they });
  const visit = fake.seed.visit(clerk, second, { at: Date.now(), endsInMs: 60_000 });
  fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed under D.' });
  fake.signInAs(me);
  return { fake, thread, visit, second };
}
/** A talked-down visit to post 2 (page 1 at two a page), answered by the Mod's own post 4 on page 2: the Lens says whom nothing landed on. */
function talkedDown() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  fake.seed.post(thread, spritey, 'post 3');
  const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns: PRONOUN_PRESETS.they });
  const visit = fake.seed.visit(clerk, second, { at: Date.now(), endsInMs: 60_000 });
  fake.seed.visitEnd(visit, { outcome: 'intercepted', line: 'Talked down.', unposted: true });
  fake.seed.outcomePost(visit, fake.seed.staffPost(clerk, thread, 'Talked down.'));
  fake.signInAs(me);
  return { fake, thread, visit, second };
}
const marksOf = (post: HTMLElement) => within(post).queryAllByRole('button', { name: /Opens the visit\.$/u });

describe('the mark on an outcome post', () => {
  test('the outcome post on page 2 carries the mark of a visit on page 1, named for the post it answers, and no violation notice', async () => {
    const w = world();
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}?page=2`, settings: { postsPerPage: 2 } });
    const answer = await screen.findByRole('article', { name: /^Post 4 /u });
    const mark = await within(answer).findByRole('button', { name: /Opens the visit\.$/u });
    expect(mark).toHaveAccessibleName('The Clerk filed their visit to the post this answers. Opens the visit.');
    expect(mark).toHaveAttribute('aria-haspopup', 'dialog');
    expect(answer.querySelector('.kb-violation')).toBeNull();
    /* The visited post is on page 1, so page 2 has no second mark. */
    expect(screen.queryByRole('article', { name: /^Post 2 /u })).toBeNull();
    expect(marksOf(answer)).toHaveLength(1);
  });

  test('pressing it, by keyboard as by pointer, opens the visit\'s tab in the Lens, and pressing it again closes the Lens', async () => {
    const w = world();
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}?page=2`, settings: { postsPerPage: 2 } });
    const mark = await within(await screen.findByRole('article', { name: /^Post 4 /u })).findByRole('button', { name: /Opens the visit\.$/u });
    mark.focus();
    await userEvent.keyboard('{Enter}');
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    const lens = await screen.findByRole('dialog', { name: /^Visit/u });
    expect(within(lens).getByRole('tab', { name: 'Filed' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(lens.querySelector('.kb-visit')).not.toHaveAttribute('aria-busy'));
    await userEvent.click(mark);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('on one page, the visited post\'s mark comes first in the page and the outcome post\'s after it, each named for its post, and only the visited post has the notice', async () => {
    const w = world();
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    await screen.findByRole('article', { name: /^Post 4 /u });
    const all = screen.getAllByRole('button', { name: /Opens the visit\.$/u });
    expect(all.map((m) => m.getAttribute('aria-label'))).toEqual([
      'The Clerk filed their visit to this post. Opens the visit.',
      'The Clerk filed their visit to the post this answers. Opens the visit.',
    ]);
    expect(all[0]!.compareDocumentPosition(all[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the visited post is on another page: the answer mark\'s Lens names the visited post\'s author, from one read for the page', async () => {
    const w = talkedDown();
    const byId = vi.spyOn(w.fake, 'actsById');
    const single = vi.spyOn(w.fake, 'act');
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}?page=2`, settings: { postsPerPage: 2 } });
    const answer = await screen.findByRole('article', { name: /^Post 4 /u });
    await userEvent.click(await within(answer).findByRole('button', { name: /Opens the visit\.$/u }));
    const lens = await screen.findByRole('dialog', { name: /^Visit/u });
    await waitFor(() => expect(lens).toHaveTextContent(/Nothing landed on Spritey\./u));
    expect(byId.mock.calls.filter(([ids]) => ids.includes(w.second))).toHaveLength(1);
    expect(single).not.toHaveBeenCalledWith(w.second);
  });

  test('the answer mark and the visited post\'s mark open the same visit', async () => {
    const w = world();
    const story = vi.spyOn(w.fake, 'visitStory');
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    await screen.findByRole('article', { name: /^Post 4 /u });
    for (const mark of screen.getAllByRole('button', { name: /Opens the visit\.$/u })) {
      await userEvent.click(mark);
      await screen.findByRole('dialog', { name: /^Visit/u });
      await userEvent.click(mark);
    }
    const seen = new Set(story.mock.calls.map((c) => c[1]));
    expect([...seen]).toEqual([w.visit]);
  });

  test('a page read that adds an answer to a visit whose end is unchanged shows the new answer\'s mark in the same frame', async () => {
    const w = talkedDown();
    const aide = w.fake.seed.staff('aide', 'The Aide', 'mod');
    w.fake.seed.outcomePost(w.visit, w.fake.seed.staffPost(aide, w.thread, 'Late word.'), 'intercepted', w.visit);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}?page=2`, settings: { postsPerPage: 2 } });
    await within(await screen.findByRole('article', { name: /^Post 4 /u })).findByRole('button', { name: /Opens the visit\.$/u });
    await userEvent.click(screen.getAllByRole('link', { name: 'Page 3' })[0]!);
    const late = await screen.findByRole('article', { name: /^Post 5 /u });
    /* No waiting: the mark is on the post the frame it is drawn. */
    expect(marksOf(late)).toHaveLength(1);
  });
});
