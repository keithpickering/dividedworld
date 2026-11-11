/**
 * Every place that draws a move of the three kinds that build the board names what it moved, by current names (the fangame split, Task 3): the admin queue (waiting and in force),
 * a Boss's moderation log, and the overlay on a move's notice. A merge names the board that closes and the board that takes its threads, each as itself; a thread move names the
 * thread, the board it left and the board it went to; a sentence never names the wrong board.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { LoadedProfile, LoadedQueue } from '../loaded.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { MoveNotice } from './MoveNotice.tsx';
import { seedMoves, type MoveWorld } from './move-world.ts';

beforeEach(() => localStorage.clear());

/** The first board is called "Pointless Toast Palace" now (its rename is in force), the second "Off Topic"; a third board, "Minus World", and a thread on the first, "Best bread, ranked". */
function world(options: { readonly signIn?: 'player' | 'admin' } = {}) {
  const fake = buildWorld();
  const w = seedMoves(fake, testInstance, { signIn: options.signIn ?? 'admin' });
  fake.seed.board('minus-world', 'Minus World');
  const thread = fake.seed.thread(w.general, w.spritey, 'Best bread, ranked', 'Discuss.').thread;
  return { fake, w, thread };
}
const landed = (fake: Fake, w: MoveWorld, thread: string) => {
  /* A thread moved from the first board to Minus World, and the second board merged into the first: both in force, both the Director's. */
  fake.seed.moveThread(thread, 'minus-world');
  const move = fake.seed.move('director', { board: '', name: '', lasting: { kind: 'moveThread', params: { thread, board: 'minus-world' } } });
  const merge = fake.seed.move('director', { board: '', name: '', lasting: { kind: 'mergeBoard', params: { board: w.second, into: w.general } } });
  return { move, merge };
};
const sentence = (h: HTMLElement) => h.textContent?.replace(/\s+/gu, ' ').trim();

describe('the admin queue', () => {
  test('a waiting thread move names the thread, the board it leaves and the board it goes to; a waiting merge names the board that closes and the one that takes its threads', async () => {
    const { fake, w, thread } = world();
    fake.seed.queueMove('director', { board: '', name: '', goLiveAt: fake.clock.now() + 3_600_000, lasting: { kind: 'moveThread', params: { thread, board: 'minus-world' } } });
    fake.seed.queueMove('director', { board: '', name: '', goLiveAt: fake.clock.now() + 7_200_000, lasting: { kind: 'mergeBoard', params: { board: w.second, into: w.general } } });
    renderIn(fake, <LoadedQueue now={fake.clock.now()} />, { path: '/admin/queue' });
    const waiting = await screen.findByRole('region', { name: /^Waiting to land/u });
    const heads = within(waiting).getAllByRole('heading', { level: 3 });
    expect(await within(waiting).findByText(/^Move Best bread, ranked from$/u)).toBeInTheDocument();
    expect(heads.map(sentence)).toContain('Move Best bread, ranked from Pointless Toast Palace to Minus World');
    expect(heads.map(sentence)).toContain('Merge Off Topic into Pointless Toast Palace');
  });

  test('a move in force names them the same way', async () => {
    const { fake, w, thread } = world();
    landed(fake, w, thread);
    renderIn(fake, <LoadedQueue now={fake.clock.now()} />, { path: '/admin/queue' });
    const inForce = await screen.findByRole('region', { name: /^In force/u });
    await within(inForce).findByText(/^Moved Best bread, ranked from$/u);
    const heads = within(inForce).getAllByRole('heading', { level: 3 }).map(sentence);
    expect(heads).toContain('Moved Best bread, ranked from Pointless Toast Palace to Minus World');
    expect(heads).toContain('Merged Off Topic into Pointless Toast Palace');
  });
});

describe('a Boss\'s moderation log', () => {
  test('names the thread and both boards of a thread move, and both boards of a merge', async () => {
    const { fake, w, thread } = world();
    landed(fake, w, thread);
    renderIn(fake, <LoadedProfile id={w.director} />, { path: `/c/${w.director}` });
    const log = await screen.findByRole('table', { name: 'Moderation log' });
    await within(log).findByText(/^Moved Best bread, ranked from$/u);
    const cells = within(log).getAllByRole('cell').map(sentence);
    expect(cells).toContain('Moved Best bread, ranked from Pointless Toast Palace to Minus World');
    expect(cells).toContain('Merged Off Topic into Pointless Toast Palace');
  });
});

describe('the overlay on a move\'s notice', () => {
  test('a merge says which board closed and which took its threads, never the one twice', async () => {
    const { fake, w, thread } = world();
    const { merge } = landed(fake, w, thread);
    renderIn(fake, <MoveNotice act={merge} />, { path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: /^WAY OUT:/u }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The Boss merged Off Topic into Pointless Toast Palace.');
  });

  test('a thread move names the thread and the boards', async () => {
    const { fake, w, thread } = world();
    const { move } = landed(fake, w, thread);
    renderIn(fake, <MoveNotice act={move} />, { path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: /^WAY OUT:/u }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('The Boss moved Best bread, ranked from Pointless Toast Palace to Minus World.'));
  });
});
