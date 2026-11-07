/**
 * The posts of a group move (docs/plans/2026-11-06-member-groups-plan.md, Task 10): the conferGroup move's own post carries the glass's label naming the office that made it
 * (the Boss, or a Mod) and a plain line naming the character, the group and the board by name; the ruling on an apology is the staff member's post under an ACCEPTED or REJECTED
 * label in the move's label style. The staff member's words are its own and may bluff; the label and the plain line are the engine's and never do.
 */
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';

beforeEach(() => localStorage.clear());

const GROUPS = [
  { key: 'members', name: 'Members', color: '#7a7a7a', stripe: false, staff: false },
  { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, staff: false },
  { key: 'staff', name: 'Test Cores', color: '#d4a017', stripe: false, staff: true },
];

function world(office: 'boss' | 'mod' = 'boss') {
  const fake = buildWorld({ groups: GROUPS });
  const me = fake.seed.account('me');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const staff = fake.seed.staff('director', 'The Director', office);
  const move = fake.seed.groupMove('director', { character: pipe, group: 'trialMembers', board: 'general', body: 'Sit in the corner, Pipewrench.' });
  fake.signInAs(me);
  return { fake, me, pipe, staff, move };
}

describe('a conferGroup move\'s post', () => {
  test('says the Boss moved a member, and names the character, the group and the board', async () => {
    const w = world();
    const thread = (await w.fake.act(w.move))!.thread;
    renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, settings: { groups: GROUPS } });
    const post = (await screen.findByText('Sit in the corner, Pipewrench.')).closest('article')!;
    expect(post).toHaveAttribute('data-kb-kind', 'move');
    expect(within(post).getByText('The Boss moved a member')).toBeInTheDocument();
    expect(await within(post).findByText('The Boss put Pipewrench in Trial Members, barred from posting on General.')).toBeInTheDocument();
  });

  test('says a Mod when a Mod made it', async () => {
    const w = world('mod');
    const thread = (await w.fake.act(w.move))!.thread;
    renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, settings: { groups: GROUPS } });
    const post = (await screen.findByText('Sit in the corner, Pipewrench.')).closest('article')!;
    expect(within(post).getByText('A Mod moved a member')).toBeInTheDocument();
    expect(await within(post).findByText('A Mod put Pipewrench in Trial Members, barred from posting on General.')).toBeInTheDocument();
    expect(post).not.toHaveTextContent('Boss');
  });
});

describe('a ruling on an apology', () => {
  function ruled(verdict: 'accepted' | 'rejected') {
    const w = world();
    const apology = w.fake.seed.apology(w.pipe, w.move, verdict);
    return w.fake.act(apology).then((a) => {
      const ruling = w.fake.seed.staffPost(w.staff, a!.thread, 'Your tears are noted. And weighed.', { ruling: { verdict, apology } });
      return { ...w, thread: a!.thread, ruling };
    });
  }

  test.each([['accepted', 'Apology accepted'], ['rejected', 'Apology rejected']] as const)('%s: its label stands above the staff member\'s words, in the move\'s label style', async (verdict, label) => {
    const w = await ruled(verdict);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    const post = (await screen.findByText('Your tears are noted. And weighed.')).closest('article')!;
    const tag = within(post).getByText(label);
    expect(tag.closest('.kb-move-tag')).not.toBeNull();
    expect(tag.closest('.kb-move-tag')!.compareDocumentPosition(screen.getByText('Your tears are noted. And weighed.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(post).toHaveAttribute('data-kb-ruling', verdict);
  });

  test('a post with no ruling carries no label', async () => {
    const w = await ruled('accepted');
    const plain = w.fake.seed.staffPost(w.staff, w.thread, 'An aside, not a ruling.');
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    const post = (await screen.findByText('An aside, not a ruling.')).closest('article')!;
    expect(post).not.toHaveAttribute('data-kb-ruling');
    expect(within(post).queryByText(/^Apology /u)).toBeNull();
    expect(plain).toBeTruthy();
  });
});
