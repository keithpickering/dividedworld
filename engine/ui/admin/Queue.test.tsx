import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { seedMoves } from '../board/move-world.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { QueueScreen } from './Queue.tsx';

beforeEach(() => localStorage.clear());

function open(options: { readonly as?: 'admin' | 'player'; readonly build?: (fake: ReturnType<typeof buildWorld>, w: ReturnType<typeof seedMoves>) => void } = {}) {
  const fake = buildWorld();
  const w = seedMoves(fake, testInstance, { signIn: options.as === 'player' ? 'player' : 'admin' });
  options.build?.(fake, w);
  renderIn(fake, <QueueScreen now={fake.clock.now()} />, { path: '/admin/queue' });
  return { fake, w };
}

const group = (name: RegExp | string) => screen.findByRole('region', { name });

describe('the admin queue', () => {
  test('has three groups, in plain words: waiting to land, in force, and ended (folded)', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'The System\'s moves' })).toBeInTheDocument();
    expect(await group(/^Waiting to land/u)).toHaveTextContent('1');
    expect(await group(/^In force/u)).toHaveTextContent('1');
    const ended = (await group(/^Ended/u)).querySelector('details')!;
    expect(ended.open).toBe(false);
    expect(ended.querySelector('summary')).toHaveTextContent('Ended');
    expect(ended.querySelector('summary')).toHaveTextContent('the last 30 days');
    expect(screen.getByText(/Players never see a held move\./u)).toBeInTheDocument();
  });

  test('HOLD is on a move that waits and nowhere else; REVERSE is on a move in force and nowhere else', async () => {
    open();
    await group(/^Waiting to land/u);
    expect(screen.getAllByRole('button', { name: /^Hold/u })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Reverse/u })).toHaveLength(1);
    expect(within(await group(/^Waiting to land/u)).getByRole('button', { name: /^Hold/u })).toBeInTheDocument();
    expect(within(await group(/^Waiting to land/u)).queryByRole('button', { name: /^Reverse/u })).toBeNull();
    expect(within(await group(/^In force/u)).getByRole('button', { name: /^Reverse/u })).toBeInTheDocument();
    expect(within(await group(/^In force/u)).queryByRole('button', { name: /^Hold/u })).toBeNull();
    const ended = (await group(/^Ended/u)).querySelector('details')!;
    expect(within(ended).queryByRole('button')).toBeNull();
  });

  test('a waiting move shows its countdown and time, the full proposal, the Boss\'s why quoted as its words, and no failure when there is none', async () => {
    const { w } = open();
    const waiting = await group(/^Waiting to land/u);
    expect(waiting).toHaveTextContent('IN 17 HOURS');
    expect(waiting).toHaveTextContent(`Rename ${w.secondName} to Small Soldiers Situation Room`);
    expect(waiting).toHaveTextContent('New subject: The 1998 film Small Soldiers.');
    expect(waiting).toHaveTextContent('Needs 8 different characters to post on this board.');
    expect(waiting).toHaveTextContent('Description: “Commando Elite members only. Gorgonites will be processed.”');
    expect(waiting).toHaveTextContent('Why, in The Director\'s words: “Games has gone soft. Time for discipline.”');
    expect(waiting).not.toHaveTextContent(/could not land/u);
    expect(within(waiting).getByRole('link', { name: w.secondName })).toHaveAttribute('href', `/b/${w.second}`);
  });

  test('a move the tick could not land shows the failure in the server\'s words, and stays open to a hold', async () => {
    open({ build: (fake, w) => { fake.seed.queueMove('director', { board: w.second, name: 'Stuck Hall', goLiveAt: fake.clock.now() - 60_000, failure: { at: fake.clock.now() - 30_000, text: 'the board no longer exists' } }); } });
    const waiting = await group(/^Waiting to land/u);
    expect(waiting).toHaveTextContent('It could not land');
    expect(waiting).toHaveTextContent('the board no longer exists');
    expect(within(waiting).getAllByRole('button', { name: /^Hold/u })).toHaveLength(2);
  });

  test('a move in force shows since and until, its demand in words with a progress bar', async () => {
    open();
    const live = await group(/^In force/u);
    expect(live).toHaveTextContent(/SINCE [A-Z]{3} \d{1,2}/u);
    expect(live).toHaveTextContent(/ends [A-Z][a-z]{2} \d{1,2}/u);
    expect(live).toHaveTextContent('Renamed General to Pointless Toast Palace');
    expect(live).toHaveTextContent('Needs 12 different characters to post on this board: 5 of 12 so far.');
    const bar = within(live).getByRole('progressbar', { name: /Progress toward the way out/u });
    expect(bar).toHaveAttribute('aria-valuenow', '5');
    expect(bar).toHaveAttribute('aria-valuemax', '12');
  });

  test('the ended group, opened, says how each ended in plain words: met, expired, reversed and held', async () => {
    open();
    const ended = (await group(/^Ended/u)).querySelector('details')!;
    await userEvent.click(ended.querySelector('summary')!);
    expect(ended.open).toBe(true);
    expect(ended).toHaveTextContent('Undone when its demand was met.');
    expect(ended).toHaveTextContent('Ran out on its own.');
    expect(ended).toHaveTextContent('Reversed by an admin.');
    expect(ended).toHaveTextContent('Held by an admin');
    expect(ended).toHaveTextContent('It never landed.');
  });

  test('speaks plainly and never as the Boss: the Boss\'s why is quoted and named as its words', async () => {
    open();
    const waiting = await group(/^Waiting to land/u);
    expect(waiting.querySelector('q, blockquote, .kb-queue-quote')).not.toBeNull();
    expect(waiting).toHaveTextContent('in The Director\'s words');
  });
});

describe('holding and reversing', () => {
  test('HOLD asks first, naming the move and what a hold does; Cancel changes nothing', async () => {
    const { fake } = open();
    await userEvent.click(await screen.findByRole('button', { name: /^Hold/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Hold this move?' });
    expect(dialog).toHaveTextContent('Rename Off Topic to Small Soldiers Situation Room');
    expect(dialog).toHaveTextContent('It will never land, and no player will see it. A hold cannot be taken back.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await fake.adminQueue()).waiting).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Hold/u })).toHaveLength(1);
  });

  test('confirming a hold holds the move, refreshes the queue (it is held, not waiting), and puts focus on the group\'s heading', async () => {
    const { fake } = open();
    await userEvent.click(await screen.findByRole('button', { name: /^Hold/u }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Hold this move?' })).getByRole('button', { name: 'Hold it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Hold/u })).toBeNull());
    expect((await fake.adminQueue()).waiting).toHaveLength(0);
    expect((await fake.adminQueue()).ended.filter((e) => e.how === 'held')).toHaveLength(2);
    expect(await group(/^Waiting to land/u)).toHaveTextContent('Nothing is waiting.');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /^Waiting to land/u })).toHaveFocus());
  });

  test('REVERSE asks first; confirming ends the move as reversed by an admin and the old name returns at once', async () => {
    const { fake, w } = open();
    await userEvent.click(await screen.findByRole('button', { name: /^Reverse/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Reverse this move?' });
    expect(dialog).toHaveTextContent('Renamed General to Pointless Toast Palace');
    expect(dialog).toHaveTextContent('It ends now, as reversed by an admin, and the old name returns at once.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Reverse/u })).toBeNull());
    expect((await fake.board(w.general))?.name).toBe('General');
    expect(await group(/^In force/u)).toHaveTextContent('Nothing is in force.');
    expect((await fake.adminQueue()).ended.filter((e) => e.how === 'reversed')).toHaveLength(2);
  });

  test('a refusal is shown in the server\'s words in the dialog, and the queue behind it is read again', async () => {
    const { fake } = open();
    await userEvent.click(await screen.findByRole('button', { name: /^Hold/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Hold this move?' });
    /* Another admin held it first. */
    fake.seed.holdQueued(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hold it' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('that move is already held');
    await waitFor(() => expect(screen.queryByText('Nothing is waiting.')).not.toBeNull());
  });
});

describe('who may see it', () => {
  test('a player is told plainly that it is for admins, and the queue is not asked for', async () => {
    open({ as: 'player' });
    expect(await screen.findByText('The admin queue is for admins.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Waiting to land/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Hold/u })).toBeNull();
  });
});
