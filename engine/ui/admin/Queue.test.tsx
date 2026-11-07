import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
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

  test('leads with the queue (To do, Waiting to land, In force, Ended), and How players reach you stands last, as its own section', async () => {
    open();
    await group(/^Ended/u);
    await screen.findByRole('form', { name: 'How players reach you' });
    const order = [...document.querySelectorAll('[data-kb-group], .kb-admin-contact')].map((el) => el.getAttribute('data-kb-group') ?? 'contact');
    expect(order).toEqual(['todo', 'waiting', 'in-force', 'staff-cards', 'ended', 'boards', 'contact']);
    const contact = document.querySelector('.kb-admin-contact')!;
    expect(contact.tagName).toBe('SECTION');
    expect(contact.querySelector('h2')).toHaveTextContent('How players reach you');
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

  test('a move in force says when its count was made, and one the tick has not counted says so, with no number', async () => {
    open({ build: (fake, w) => { fake.seed.move('director', { board: w.second, name: 'Fresh Hall', uncounted: true, demand: { kind: 'postsOnBoard', params: { board: w.second, count: 3 } } }); } });
    const live = await group(/^In force/u);
    expect(live).toHaveTextContent(/5 of 12, counted [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M/u);
    const fresh = within(live).getAllByRole('article').find((a) => a.textContent?.includes('Fresh Hall'))!;
    expect(fresh).toHaveTextContent('Not counted yet.');
    expect(fresh).not.toHaveTextContent(/\d+ of \d+/u);
    expect(within(fresh).queryByRole('progressbar')).toBeNull();
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

  test('a rule refused when it came to land is not waiting: it is with the ended, saying why and that it will not land', async () => {
    open({ build: (fake, w) => { fake.seed.queueMove('director', { board: w.second, name: 'Clashing Hall', goLiveAt: fake.clock.now() - 60_000, refusal: { at: fake.clock.now() - 30_000, text: 'Rule 1 bans the word "toast", which this rule would require' } }); } });
    const waiting = await group(/^Waiting to land/u);
    expect(waiting).not.toHaveTextContent('Clashing Hall');
    expect(waiting).not.toHaveTextContent(/tried again/u);
    const ended = (await group(/^Ended/u)).querySelector('details')!;
    await userEvent.click(ended.querySelector('summary')!);
    expect(ended).toHaveTextContent('Refused when it came to land: Rule 1 bans the word "toast", which this rule would require. It will not land.');
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

  test('a player\'s page never calls adminQueue, and shows no error, only the message for admins', async () => {
    const fake = buildWorld();
    seedMoves(fake, testInstance, { signIn: 'player' });
    const asked = vi.spyOn(fake, 'adminQueue');
    renderIn(fake, <QueueScreen now={fake.clock.now()} />, { path: '/admin/queue' });
    expect(await screen.findByText('The admin queue is for admins.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a nomination of a successor', () => {
  const nominate = (fake: ReturnType<typeof buildWorld>) => {
    fake.seed.staff('the-clerk', 'The Clerk', 'boss', { title: 'Keeper of Forms' });
    fake.seed.staff('hype-man', 'Hype Man', 'boss', { title: 'Hype' });
    return fake.seed.queueSuccessor('director', 'the-clerk', { goLiveAt: fake.clock.now() + 20 * 3_600_000, why: 'It has the stamina.' });
  };

  test('waits like any structural move: the Boss named, the way it ends in plain words, the Boss\'s why quoted, and HOLD', async () => {
    open({ build: (fake) => { nominate(fake); } });
    const waiting = await group(/^Waiting to land/u);
    expect(waiting).toHaveTextContent('Name The Clerk as the next Boss');
    expect(waiting).toHaveTextContent('It asks nothing: it ends at the handover, or when an admin reverses it.');
    expect(waiting).toHaveTextContent('the Boss it names takes the seat when the season rolls over');
    expect(waiting).toHaveTextContent('Why, in The Director\'s words: “It has the stamina.”');
    expect(within(waiting).getAllByRole('button', { name: /^Hold/u })).toHaveLength(2);
    expect(within(waiting).getByRole('button', { name: 'Hold: the naming of a successor' })).toBeInTheDocument();
  });

  test('offers REPLACE with the roster\'s other personas (a Mod Bot too, since the Boss may come from any office), never the Boss that wrote it nor the one it names; replacing changes the nomination and reads the queue again', async () => {
    const { fake } = open({ build: (f) => { nominate(f); } });
    const waiting = await group(/^Waiting to land/u);
    const choice = within(waiting).getByRole('combobox', { name: 'Put another Boss in its place' });
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a Boss', 'Hall Monitor', 'Hype Man']);
    const replace = within(waiting).getByRole('button', { name: 'Replace the nominated Boss, The Clerk' });
    expect(replace).toBeDisabled();
    await userEvent.selectOptions(choice, 'Hype Man');
    expect(replace).toBeEnabled();
    await userEvent.click(replace);
    await waitFor(() => expect(waiting).toHaveTextContent('Name Hype Man as the next Boss'));
    expect((await fake.adminQueue()).waiting.map((q) => q.params['boss'])).toContain('hype-man');
    expect(within(waiting).queryByRole('combobox', { name: 'Put another Boss in its place' })).not.toBeNull();
    /* What was chosen is done: the pick is empty and the button waits, and the line in plain words names who will follow. */
    expect(within(waiting).getByRole('combobox', { name: 'Put another Boss in its place' })).toHaveValue('');
    expect(within(waiting).getByRole('button', { name: 'Replace the nominated Boss, Hype Man' })).toBeDisabled();
    expect(within(waiting).getAllByRole('status').map((n) => n.textContent)).toContain('Replaced. Hype Man will follow.');
    expect(waiting).toHaveTextContent('An admin put this Boss in the nomination\'s place on');
  });

  test('offers no persona that is retired or benched, though their names still read in a sentence; a waiting one that has not debuted is offered, as the roster lists it', async () => {
    const { fake } = open({ build: (f) => {
      const id = nominate(f);
      f.seed.retire(f.seed.staff('old-timer', 'Old Timer', 'boss'));
      f.seed.staff('newcomer', 'Newcomer', 'boss', { debuted: false });
      f.seed.staff('shelved', 'Shelved', 'benched');
      void id;
    } });
    const waiting = await group(/^Waiting to land/u);
    const choice = within(waiting).getByRole('combobox', { name: 'Put another Boss in its place' });
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a Boss', 'Hall Monitor', 'Hype Man', 'Newcomer']);
    expect((await fake.adminQueue()).roster.map((b) => b.staff)).not.toContain('old-timer');
  });

  test('a held nomination no longer waits, so it has no REPLACE', async () => {
    open({ build: (fake) => { const id = nominate(fake); fake.seed.holdQueued(id); } });
    const waiting = await group(/^Waiting to land/u);
    expect(within(waiting).queryByRole('combobox', { name: 'Put another Boss in its place' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Replace the nominated Boss/u })).toBeNull();
  });

  test('the ended group says how a nomination and an inherited move ended: used up at the handover, set aside by the new Boss, or never reviewed', async () => {
    open({
      build: (fake, w) => {
        fake.seed.staff('the-clerk', 'The Clerk', 'boss');
        const spent = fake.seed.move('director', { board: w.general, name: 'Nominee Row', at: fake.clock.now() - 3 * 86_400_000 });
        fake.seed.endMove(spent, { why: 'spent', at: fake.clock.now() - 86_400_000 });
        const aside = fake.seed.move('director', { board: w.general, name: 'Set Aside Alley', at: fake.clock.now() - 3 * 86_400_000 });
        fake.seed.endMove(aside, { why: 'superseded', by: 'boss', at: fake.clock.now() - 80_000_000 });
        const forgotten = fake.seed.move('director', { board: w.general, name: 'Forgotten Fen Place', at: fake.clock.now() - 3 * 86_400_000 });
        fake.seed.endMove(forgotten, { why: 'superseded', by: 'inheritance', at: fake.clock.now() - 70_000_000 });
      },
    });
    const ended = (await group(/^Ended/u)).querySelector('details')!;
    await userEvent.click(ended.querySelector('summary')!);
    expect(ended).toHaveTextContent('Used up at the handover.');
    expect(ended).toHaveTextContent('Ended by the new Boss at the handover.');
    expect(ended).toHaveTextContent('Ended at the handover: the new Boss did not review it in time.');
  });

  describe('the to-do group (the staff roster design, section 11)', () => {
    const handover = (fake: ReturnType<typeof buildWorld>, at = fake.clock.now() - 3_600_000) => {
      fake.seed.staff('old-boss', 'Old Boss', 'boss');
      fake.seed.staff('comptroller', 'Comptroller', 'mod');
      fake.seed.handover({ outgoing: 'old-boss', boss: 'comptroller', at, how: 'rotation', bossWas: 'mod', outgoingOffice: 'member' });
    };

    test('a change of Boss is a row above Waiting, with the plain facts, a link to the form for that season, and a Dismiss', async () => {
      open({ build: (fake) => handover(fake) });
      const todo = await group(/^To do/u);
      expect(todo).toHaveTextContent('Season 2 opens with Comptroller.');
      expect(todo).toHaveTextContent('Season 2\'s Boss: Comptroller (was a Moderator).');
      expect(todo).toHaveTextContent('Old Boss is now a member.');
      expect(within(todo).getByRole('link', { name: 'Write the announcement for season 2' })).toHaveAttribute('href', '/updates?write=handover&season=2');
      expect(within(todo).getByRole('button', { name: 'Dismiss the season 2 to-do' })).toBeInTheDocument();
      const waiting = await group(/^Waiting to land/u);
      expect(todo.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('each row\'s Write the announcement link names its season, so two rows are told apart', async () => {
      open({ build: (fake) => { handover(fake, fake.clock.now() - 7_200_000); fake.seed.staff('third', 'Third', 'mod'); fake.seed.handover({ outgoing: 'comptroller', boss: 'third', at: fake.clock.now() - 3_600_000, how: 'rotation', bossWas: 'mod', outgoingOffice: 'member' }); } });
      const todo = await group(/^To do/u);
      const names = within(todo).getAllByRole('link', { name: /^Write the announcement/u }).map((a) => a.getAttribute('aria-label') ?? a.textContent);
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
      expect(within(todo).getByRole('link', { name: 'Write the announcement for season 2' })).toBeInTheDocument();
    });

    test('no change of Boss, no row: the group says there is nothing to do', async () => {
      open();
      expect(await group(/^To do/u)).toHaveTextContent('Nothing to do.');
      expect(screen.queryByRole('link', { name: 'Write the announcement for season 2' })).toBeNull();
    });

    test('a handover that kept its Boss is no to-do', async () => {
      open({ build: (fake) => { fake.seed.staff('same-boss', 'Same Boss', 'boss'); fake.seed.handover({ outgoing: 'same-boss', boss: 'same-boss' }); } });
      expect(await group(/^To do/u)).toHaveTextContent('Nothing to do.');
    });

    test('Dismiss puts the row away and keeps it away on a fresh read', async () => {
      const { fake } = open({ build: (f) => handover(f) });
      const todo = await group(/^To do/u);
      await userEvent.click(within(todo).getByRole('button', { name: 'Dismiss the season 2 to-do' }));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Write the announcement for season 2' })).toBeNull());
      expect((await fake.adminQueue()).todos).toEqual([]);
      expect(await group(/^To do/u)).toHaveTextContent('Nothing to do.');
    });

    test('an update posted after the handover takes the row away; one posted before it does not (the poison)', async () => {
      const before = open({ build: (fake) => { handover(fake); fake.seed.update({ title: 'Older news', body: 'Before.', at: fake.clock.now() - 2 * 3_600_000 }); } });
      expect((await before.fake.adminQueue()).todos.map((t) => t.season)).toEqual([2]);
      expect(await group(/^To do/u)).toHaveTextContent('Season 2 opens with Comptroller.');
    });

    test('an update after the handover clears it', async () => {
      open({ build: (fake) => { handover(fake); fake.seed.update({ title: 'Season 2', body: 'After.', at: fake.clock.now() - 60_000 }); } });
      expect(await group(/^To do/u)).toHaveTextContent('Nothing to do.');
    });
  });
});

describe('How players reach you, on the admin screen', () => {
  const form = () => screen.findByRole('form', { name: 'How players reach you' });
  const row = (n: number) => screen.getByRole('group', { name: `Link ${n}` });
  const fill = async (n: number, label: string, href: string) => {
    await userEvent.type(within(row(n)).getByLabelText(`Link ${n} label`), label);
    await userEvent.type(within(row(n)).getByLabelText(`Link ${n} address`), href);
  };

  test('is for an admin, and a player who opens the screen sees none of it', async () => {
    open({ as: 'player' });
    await screen.findByText('The admin queue is for admins.');
    expect(screen.queryByRole('form', { name: 'How players reach you' })).toBeNull();
    cleanup();
    open();
    expect(await form()).toBeInTheDocument();
  });

  test('each row labels its two fields in view (Label, Address), and shows Remove while the button is still named for its link', async () => {
    const { fake } = open({ build: (f) => { f.seed.contact([{ label: 'Discord', href: 'https://discord.example/u/me' }, { label: 'Email', href: 'mailto:a@example.test' }]); } });
    await form();
    for (const n of [1, 2]) {
      const line = await screen.findByRole('group', { name: `Link ${n}` });
      expect(within(line).getByText('Label').tagName).toBe('LABEL');
      expect(within(line).getByText('Address').tagName).toBe('LABEL');
      expect(within(line).getByLabelText(`Link ${n} label`)).toHaveAttribute('id', within(line).getByText('Label').getAttribute('for'));
      const remove = within(line).getByRole('button', { name: `Remove link ${n}` });
      expect(within(remove).getByText('Remove', { exact: true })).toBeVisible();
      expect(remove.querySelector('.kb-visually-hidden')).toHaveTextContent(`link ${n}`);
    }
    expect(fake).toBeDefined();
  });

  test('says players have no way to reach you while the contact is empty, and stops saying so once it is saved', async () => {
    const { fake } = open();
    const f = await form();
    expect(within(f).getByText(/Players have no way to reach you/u)).toBeInTheDocument();
    await fill(1, 'Discord', 'https://discord.example/u/me');
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    await waitFor(() => expect(within(f).queryByText(/Players have no way to reach you/u)).toBeNull());
    expect(await fake.adminContact()).toEqual([{ label: 'Discord', href: 'https://discord.example/u/me' }]);
    expect(within(f).getByRole('status')).toHaveTextContent('Saved.');
  });

  test('shows what is stored, and what the server repaired is what the rows show after: a bare email is made mailto:, an empty row is dropped', async () => {
    const { fake } = open();
    const f = await form();
    await fill(1, '  Mail  ', ' admin@example.test ');
    await userEvent.click(within(f).getByRole('button', { name: 'Add a link' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    await waitFor(async () => expect(await fake.adminContact()).toEqual([{ label: 'Mail', href: 'mailto:admin@example.test' }]));
    expect((within(row(1)).getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('Mail');
    expect((within(row(1)).getByLabelText('Link 1 address') as HTMLInputElement).value).toBe('mailto:admin@example.test');
    expect(screen.queryByRole('group', { name: 'Link 3' })).toBeNull();
  });

  test('starts from the contact already set', async () => {
    open({ build: (fake) => fake.seed.contact([{ label: 'Chat', href: 'https://chat.example/a' }, { label: 'Mail', href: 'mailto:a@example.test' }]) });
    const f = await form();
    await waitFor(() => expect((within(row(1)).getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('Chat'));
    expect((within(row(2)).getByLabelText('Link 2 address') as HTMLInputElement).value).toBe('mailto:a@example.test');
    expect(within(f).queryByText(/Players have no way to reach you/u)).toBeNull();
  });

  test('a refusal is shown in the server\'s words beside the row it names, and keeps what was typed', async () => {
    const { fake } = open();
    const f = await form();
    await fill(1, 'Chat', 'https://chat.example/a');
    await userEvent.click(within(f).getByRole('button', { name: 'Add a link' }));
    await fill(2, 'Script', 'javascript:alert(1)');
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    const alert = await within(row(2)).findByRole('alert');
    expect(alert).toHaveTextContent('row 2 has an address that is https: or mailto:');
    expect(within(row(1)).queryByRole('alert')).toBeNull();
    expect(within(row(2)).getByLabelText('Link 2 address')).toHaveAttribute('aria-invalid', 'true');
    expect((within(row(2)).getByLabelText('Link 2 address') as HTMLInputElement).value).toBe('javascript:alert(1)');
    expect(await fake.adminContact()).toEqual([]);
    expect(within(f).getByText(/Players have no way to reach you/u)).toBeInTheDocument();
  });

  test('an address that looks like an email but carries a scheme is refused, naming its row, and so is a row with an address and no label', async () => {
    open();
    const f = await form();
    await fill(1, 'Sneaky', 'javascript:a@b.example');
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    expect(await within(row(1)).findByRole('alert')).toHaveTextContent('row 1');
    await userEvent.clear(within(row(1)).getByLabelText('Link 1 label'));
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    expect(await within(row(1)).findByRole('alert')).toHaveTextContent('row 1 has an address and no label');
  });

  test('holds at five rows, and a row can be removed', async () => {
    open();
    const f = await form();
    const add = within(f).getByRole('button', { name: 'Add a link' });
    for (let i = 0; i < 6; i += 1) if (!(add as HTMLButtonElement).disabled) await userEvent.click(add);
    expect(within(f).getAllByRole('group', { name: /^Link \d$/u })).toHaveLength(5);
    expect(add).toBeDisabled();
    await userEvent.click(within(f).getByRole('button', { name: 'Remove link 5' }));
    expect(within(f).getAllByRole('group', { name: /^Link \d$/u })).toHaveLength(4);
  });

  test('says in its own words when no answer came back, and that it may have gone through', async () => {
    const { fake } = open();
    const f = await form();
    vi.spyOn(fake, 'setAdminContact').mockRejectedValue(new Error('lost'));
    await fill(1, 'Chat', 'https://chat.example/a');
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    expect(await within(f).findByRole('alert')).toHaveTextContent('No answer came back');
  });

  test('after a save, focus stays on the input it was on, and that input is the same one (not drawn again)', async () => {
    open();
    const f = await form();
    await fill(1, 'Chat', 'https://chat.example/a');
    await userEvent.click(within(f).getByRole('button', { name: 'Add a link' }));
    await fill(2, 'Mail', 'admin@example.test');
    const input = within(row(2)).getByLabelText('Link 2 address');
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(within(f).getByRole('status')).toHaveTextContent('Saved.'));
    expect(within(row(2)).getByLabelText('Link 2 address')).toBe(input);
    expect(input).toHaveFocus();
    expect((input as HTMLInputElement).value).toBe('mailto:admin@example.test');
  });

  test('after a save that dropped an empty row, focus follows to the label it was on', async () => {
    open();
    const f = await form();
    await fill(1, 'Chat', 'https://chat.example/a');
    await userEvent.click(within(f).getByRole('button', { name: 'Add a link' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Add a link' }));
    await fill(3, 'Mail', 'admin@example.test');
    await userEvent.click(within(row(3)).getByLabelText('Link 3 label'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Link 3' })).toBeNull());
    expect(within(row(2)).getByLabelText('Link 2 label')).toHaveFocus();
  });

  test('removing a row moves focus to the next row\'s label, else the previous row\'s, else the cleared row\'s', async () => {
    open();
    const f = await form();
    for (let i = 0; i < 2; i += 1) await userEvent.click(within(f).getByRole('button', { name: 'Add a link' }));
    for (const n of [1, 2, 3]) await userEvent.type(within(row(n)).getByLabelText(`Link ${n} label`), `L${n}`);
    await userEvent.click(within(f).getByRole('button', { name: 'Remove link 2' }));
    expect(within(row(2)).getByLabelText('Link 2 label')).toHaveFocus();
    expect((within(row(2)).getByLabelText('Link 2 label') as HTMLInputElement).value).toBe('L3');
    await userEvent.click(within(f).getByRole('button', { name: 'Remove link 2' }));
    expect(within(row(1)).getByLabelText('Link 1 label')).toHaveFocus();
    expect((within(row(1)).getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('L1');
    await userEvent.click(within(f).getByRole('button', { name: 'Remove link 1' }));
    expect(within(row(1)).getByLabelText('Link 1 label')).toHaveFocus();
    expect((within(row(1)).getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('');
  });

  test('while a save is out, the status says Saving\u2026, and the button is held', async () => {
    const { fake } = open();
    const f = await form();
    let release!: () => void;
    const real = fake.setAdminContact.bind(fake);
    vi.spyOn(fake, 'setAdminContact').mockImplementation((links) => new Promise((resolve) => { release = () => resolve(real(links)); }));
    await fill(1, 'Chat', 'https://chat.example/a');
    await userEvent.click(within(f).getByRole('button', { name: 'Save how players reach you' }));
    expect(within(f).getByRole('status')).toHaveTextContent('Saving\u2026');
    expect(within(f).getByRole('button', { name: 'Save how players reach you' })).toBeDisabled();
    release();
    await waitFor(() => expect(within(f).getByRole('status')).toHaveTextContent('Saved.'));
  });

  describe("the Mod Bots' cards", () => {
    const withBotCard = (fake: ReturnType<typeof buildWorld>, w: ReturnType<typeof seedMoves>) => {
      const { act } = fake.seed.thread(w.general, w.pipewrench, 'Cards thread', 'A post for a card.');
      fake.seed.card(w.bot, act, 'whoops', { layer: 1 });
      // A player's card is not one of the bots'.
      fake.seed.card(w.pipewrench, act, 'whoops', { layer: 2 });
      return act;
    };

    test('is a group after In force, listing the card, its persona and whom it was played on, with END on each row', async () => {
      open({ build: withBotCard });
      const g = await group(/^Mod Bots' cards/u);
      expect(g).toHaveTextContent('1');
      expect(g).toHaveTextContent('Whoops! by Hall Monitor');
      expect(g).toHaveTextContent('Played on Pipewrench in Cards thread.');
      expect(within(g).getAllByRole('button', { name: /^End:/u })).toHaveLength(1);
      expect(screen.getAllByRole('region').map((r) => r.getAttribute('data-kb-group')).filter((g) => g !== null).slice(-4)).toEqual(['in-force', 'staff-cards', 'ended', 'boards']);
    });

    test('END asks first, in plain words; ending calls reverseCard, the card leaves the group and enters Ended', async () => {
      const { fake } = open({ build: withBotCard });
      const spy = vi.spyOn(fake, 'reverseCard');
      const g = await group(/^Mod Bots' cards/u);
      await userEvent.click(within(g).getByRole('button', { name: /^End:/u }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('End this Whoops! by Hall Monitor? Its layer comes off for everyone, and nothing is refunded.');
      expect(spy).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole('button', { name: 'End it' }));
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(within(screen.getByRole('region', { name: /^Mod Bots' cards/u })).queryByRole('button', { name: /^End:/u })).toBeNull());
      const ended = screen.getByRole('region', { name: /^Ended/u });
      expect(within(ended).getByText('Whoops! by Hall Monitor')).toBeInTheDocument();
      expect(ended).toHaveTextContent('Ended by an admin on');
    });

    test('a refusal shows in the dialog in the server\'s words, and the dialog stays open', async () => {
      const { fake } = open({ build: withBotCard });
      vi.spyOn(fake, 'reverseCard').mockResolvedValue({ ok: false, error: 'that card has already worn off' });
      const g = await group(/^Mod Bots' cards/u);
      await userEvent.click(within(g).getByRole('button', { name: /^End:/u }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'End it' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('that card has already worn off');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});

describe('replacing a description', () => {
  test('a waiting rename takes an admin\'s words, shows them beside the Boss\'s, and a second save replaces the first', async () => {
    const { fake } = open();
    const waiting = await group(/^Waiting to land/u);
    /* Shut at first, beside HOLD, so the row is the board's; one press opens it. */
    expect(within(waiting).queryByRole('textbox', { name: /^Replace description/u })).toBeNull();
    await userEvent.click(within(waiting).getByRole('button', { name: /^Replace the description of/u }));
    const field = within(waiting).getByRole('textbox', { name: /^Replace description/u });
    const save = within(waiting).getByRole('button', { name: /^Save the description of/u });
    expect(save).toBeDisabled();
    await userEvent.type(field, 'Order restored.');
    await userEvent.click(save);
    await waitFor(() => expect(waiting).toHaveTextContent('“Order restored.”'));
    expect(waiting).toHaveTextContent('Description: “Commando Elite members only. Gorgonites will be processed.”');
    expect(within(waiting).getByRole('status')).toHaveTextContent('Saved. It lands with the rename.');
    expect(waiting).not.toHaveTextContent('This is the description now');
    expect((await fake.adminQueue()).waiting[0]!.adminDescription).toBe('Order restored.');
    await userEvent.type(within(waiting).getByRole('textbox', { name: /^Replace description/u }), 'Order, again.');
    await userEvent.click(within(waiting).getByRole('button', { name: /^Save the description of/u }));
    await waitFor(() => expect(waiting).toHaveTextContent('“Order, again.”'));
    expect(waiting).not.toHaveTextContent('Order restored.');
  });

  test('a nomination has no description to replace', async () => {
    open({ build: (fake) => { fake.seed.staff('the-clerk', 'The Clerk', 'boss', { title: 'Keeper of Forms' }); fake.seed.queueSuccessor('director', 'the-clerk', { goLiveAt: fake.clock.now() + 3_600_000 }); } });
    const waiting = await group(/^Waiting to land/u);
    expect(within(waiting).getAllByRole('button', { name: /^Replace the description of/u })).toHaveLength(1);
  });

  test('the Boards group lists each board with its description now, and a board\'s description is replaced at once', async () => {
    const { fake } = open();
    const boards = await group(/^Boards/u);
    const first = (await fake.boards())[0]!;
    const card = within(boards).getByRole('article', { name: first.name });
    expect(card).toHaveTextContent(`Description: “${first.description}”`);
    await userEvent.click(within(card).getByRole('button', { name: /^Replace the description of/u }));
    await userEvent.type(within(card).getByRole('textbox', { name: /^Replace description/u }), 'Words from an admin.');
    await userEvent.click(within(card).getByRole('button', { name: `Save the description of ${first.name}` }));
    await waitFor(() => expect(card).toHaveTextContent('Description: “Words from an admin.”'));
    expect(within(card).getByRole('status')).toHaveTextContent('Saved. This is the description now.');
    expect(within(card).getByRole('alert')).toBeEmptyDOMElement();
    expect((await fake.boards())[0]!.description).toBe('Words from an admin.');
  });

  test('a refusal is shown in the server\'s words', async () => {
    const { fake } = open();
    const boards = await group(/^Boards/u);
    const first = (await fake.boards())[0]!;
    const card = within(boards).getByRole('article', { name: first.name });
    await userEvent.click(within(card).getByRole('button', { name: /^Replace the description of/u }));
    await userEvent.type(within(card).getByRole('textbox', { name: /^Replace description/u }), '   x');
    vi.spyOn(fake, 'describeBoard').mockResolvedValueOnce({ ok: false, error: 'there is no such board' });
    await userEvent.click(within(card).getByRole('button', { name: `Save the description of ${first.name}` }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('there is no such board');
  });
});
