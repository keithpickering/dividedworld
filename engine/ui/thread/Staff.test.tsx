import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { seedMoves } from '../board/move-world.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from './Thread.tsx';
import { LoadedThread } from '../loaded.tsx';

beforeEach(() => localStorage.clear());

/** The Director's announcements thread: a post, then a move in force, a move that was reversed (with its end), as the tick and an admin leave them. */
function announcements() {
  const fake = buildWorld();
  const w = seedMoves(fake, testInstance);
  const thread = fake.seed.thread('the-system', null, 'Announcements', 'The Director has the floor.').thread;
  const say = fake.seed.staffPost(w.director, thread, 'Good morning, everyone. Toast is non-negotiable.', { at: fake.clock.now() - 5000 });
  fake.signInAs(w.me);
  return { fake, w, thread, say };
}

describe('the Boss on The System\'s board', () => {
  test('its post is a post by a character with the ADMINISTRATOR badge and its title', async () => {
    const { fake, thread } = announcements();
    renderIn(fake, <LoadedThread thread={thread} />, { path: `/t/${thread}` });
    const post = (await screen.findByText('Good morning, everyone. Toast is non-negotiable.')).closest('article')!;
    const bit = await within(post).findByRole('group', { name: 'About The Director' });
    expect(within(bit).getByText('ADMINISTRATOR')).toBeInTheDocument();
    expect(bit).toHaveTextContent('Head of Board Operations (Toast Division)');
    expect(within(post).getByRole('link', { name: 'The Director' })).toHaveAttribute('href', expect.stringMatching(/^\/c\//u));
  });

  test('its move Act is a post that carries the same glass label as the board\'s notice, in the engine\'s words, and its stock line as its own', async () => {
    const { fake, w } = announcements();
    const moveThread = (await fake.act(w.inForce))!.thread;
    renderIn(fake, <LoadedThread thread={moveThread} />, { path: `/t/${moveThread}` });
    const post = (await screen.findByText(/This board has been IMPROVED/u)).closest('article')!;
    expect(post).toHaveAttribute('data-kb-kind', 'move');
    expect(within(post).getByText('THE SYSTEM RENAMED THIS BOARD')).toBeInTheDocument();
    expect(await within(post).findByRole('group', { name: 'About The Director' })).toHaveTextContent('ADMINISTRATOR');
    /* Reactions are the Act's own, like any post's. */
    expect(await within(post).findByRole('button', { name: /^Fire, 9\./u })).toBeInTheDocument();
  });

  test('a move\'s end is a plain line in the thread, never in the Boss\'s voice', async () => {
    const { fake, w } = announcements();
    const moveThread = (await fake.act(w.reversed))!.thread;
    renderIn(fake, <LoadedThread thread={moveThread} />, { path: `/t/${moveThread}` });
    await waitFor(() => expect(screen.getAllByText('A move has ended: an admin reversed it.').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('A move has ended: its demand was met.').length).toBeGreaterThan(0));
  });

  test('a handover\'s ends and keeps are plain lines too: set aside at the handover, used up, and a Boss keeping a move', async () => {
    const { fake, w } = announcements();
    fake.seed.staff('the-clerk', 'The Clerk', 'boss');
    const set = fake.seed.move('director', { board: w.general, name: 'Set Aside Alley' });
    fake.seed.endMove(set, { why: 'superseded', by: 'boss' });
    const used = fake.seed.move('director', { board: w.general, name: 'Used Up Ave' });
    fake.seed.endMove(used, { why: 'spent', by: 'handover' });
    const kept = fake.seed.move('director', { board: w.general, name: 'Kept Kiosk Court' });
    fake.seed.keepMove(kept, 'the-clerk');
    const moveThread = (await fake.act(kept))!.thread;
    renderIn(fake, <LoadedThread thread={moveThread} />, { path: `/t/${moveThread}` });
    await waitFor(() => expect(screen.getAllByText('A move has ended: it ended at the handover.').length).toBeGreaterThan(0));
    expect(screen.getAllByText('A move has ended: it was used up at the handover.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The Clerk kept a move of an earlier Boss. It is now its own.').length).toBeGreaterThan(0);
  });
});
