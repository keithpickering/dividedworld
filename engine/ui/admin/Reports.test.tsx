import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { LoadedReports } from '../loaded.tsx';

beforeEach(() => localStorage.clear());

/** An admin, a player with a post that was reported, and a staff character's post that was too, in a world with the test instance's code of conduct. */
function open(options: { readonly as?: 'admin' | 'player'; readonly build?: (fake: ReturnType<typeof buildWorld>, w: World) => void } = {}) {
  const fake = buildWorld();
  const cls = testInstance.classes[0]!.key;
  const board = testInstance.boards.find((b) => !b.system)!.slug;
  const admin = fake.seed.account('reports-admin', { admin: true });
  const author = fake.seed.account('reports-author');
  const player = fake.seed.account('reports-player');
  const ada = fake.seed.character(author, 'Ada', cls);
  fake.seed.character(admin, 'Admin Alex', cls);
  const t = fake.seed.thread(board, ada, 'A thread', 'Opening words.');
  const post = fake.seed.post(t.thread, ada, 'Words that were reported.');
  const w = { admin, author, player, post, thread: t.thread };
  options.build?.(fake, w);
  fake.signInAs(options.as === 'player' ? player : admin);
  renderIn(fake, <LoadedReports />, { path: '/admin/reports' });
  return { fake, w };
}
type World = { readonly admin: string; readonly author: string; readonly player: string; readonly post: string; readonly thread: string };

const region = (name: RegExp | string) => screen.findByRole('region', { name });

describe('the reports screen', () => {
  test('lists an open report with the version\'s words, the section\'s title, the note, the author\'s account and its past decisions', async () => {
    open({
      build: (fake, w) => {
        fake.seed.conductReport({ version: w.post, section: 'hate', note: 'This was cruel.' });
        fake.seed.conductDecision({ account: w.author, outcome: 'nudge', note: 'Easy now.' });
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports to admins' })).toBeInTheDocument();
    const open_ = await region(/^Open reports/u);
    expect(within(open_).getByText('Words that were reported.')).toBeInTheDocument();
    expect(open_).toHaveTextContent('No hate.');
    expect(open_).toHaveTextContent('This was cruel.');
    expect(open_).toHaveTextContent('Author\'s account');
    const past = within(open_).getByRole('list', { name: 'Past decisions' });
    expect(past).toHaveTextContent('nudge');
    expect(past).toHaveTextContent('Easy now.');
  });

  test('a report on a staff post says there is no account behind it', async () => {
    open({
      build: (fake, w) => {
        const boss = fake.seed.staff('boss-one', 'Boss One', 'boss');
        const staffPost = fake.seed.staffPost(boss, w.thread, 'The Boss speaks.');
        fake.seed.conductReport({ version: staffPost, section: 'hate' });
      },
    });
    const open_ = await region(/^Open reports/u);
    expect(open_).toHaveTextContent('The Boss speaks.');
    expect(open_).toHaveTextContent('A staff character, with no account');
  });

  test('deciding a suspension sends decide_report with the end date and the note, and the report leaves the list', async () => {
    const { fake } = open({ build: (f, w) => { f.seed.conductReport({ version: w.post, section: 'person' }); } });
    const send = vi.spyOn(fake, 'decideReport');
    const user = userEvent.setup();
    const open_ = await region(/^Open reports/u);
    const form = within(open_).getByRole('form', { name: /^Decide report/u });
    await user.click(within(form).getByRole('checkbox', { name: 'Suspend' }));
    const until = within(form).getByLabelText('Suspended until');
    fireEvent.change(until, { target: { value: '2026-12-01T12:00' } });
    await user.type(within(form).getByLabelText('A note for the author'), 'Take a week.');
    await user.click(within(form).getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [report, outcomes] = send.mock.calls[0]!;
    expect(typeof report).toBe('number');
    expect(outcomes).toEqual([{ outcome: 'suspend', until: new Date('2026-12-01T12:00').toISOString(), note: 'Take a week.' }]);
    expect(await screen.findByText('No open reports.')).toBeInTheDocument();
  });

  test('a suspension with no end date is held back on the screen, and nothing is sent', async () => {
    const { fake } = open({ build: (f, w) => { f.seed.conductReport({ version: w.post, section: 'person' }); } });
    const send = vi.spyOn(fake, 'decideReport');
    const user = userEvent.setup();
    const form = within(await region(/^Open reports/u)).getByRole('form', { name: /^Decide report/u });
    await user.click(within(form).getByRole('checkbox', { name: 'Suspend' }));
    await user.click(within(form).getByRole('button', { name: 'Decide' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('A suspension needs an end date.');
    expect(send).not.toHaveBeenCalled();
  });

  test('a decision with no outcome picked says so, and a refusal from the server comes back in its words', async () => {
    const { fake } = open({ build: (f, w) => { f.seed.conductReport({ version: w.post, section: 'person' }); } });
    const user = userEvent.setup();
    const form = within(await region(/^Open reports/u)).getByRole('form', { name: /^Decide report/u });
    await user.click(within(form).getByRole('button', { name: 'Decide' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Pick at least one outcome.');
    vi.spyOn(fake, 'decideReport').mockResolvedValue({ ok: false, error: 'that report is already decided; use decide to act further' });
    await user.click(within(form).getByRole('checkbox', { name: 'Close with no word to the author' }));
    await user.click(within(form).getByRole('button', { name: 'Decide' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('that report is already decided');
  });

  test('re-review lists the edit, and approve sends decide with the version', async () => {
    const { fake, w } = open({ build: (f, ww) => { f.seed.conductReview({ post: ww.post, words: 'Better words.' }); } });
    const send = vi.spyOn(fake, 'decide');
    const user = userEvent.setup();
    const due = await region(/^Edits to look at again/u);
    expect(due).toHaveTextContent('Better words.');
    await user.click(within(due).getByRole('button', { name: /^Approve/u }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ version: w.post }, 'approve', undefined, undefined);
    expect(await screen.findByText('Nothing waits for a second look.')).toBeInTheDocument();
  });

  test('re-review hide again sends hideUntilEdited with the note', async () => {
    const { fake, w } = open({ build: (f, ww) => { f.seed.conductReview({ post: ww.post, words: 'Still not right.' }); } });
    const send = vi.spyOn(fake, 'decide');
    const user = userEvent.setup();
    const due = await region(/^Edits to look at again/u);
    await user.type(within(due).getByLabelText(/^A note for the author/u), 'Try again.');
    await user.click(within(due).getByRole('button', { name: /^Hide again/u }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ version: w.post }, 'hideUntilEdited', undefined, 'Try again.'));
  });

  test('mail that failed shows its template, its error and whether it will be tried again', async () => {
    open({
      build: (fake, w) => {
        fake.seed.failedMail({ account: w.author, template: 'suspended', kind: 'failed', error: 'the provider timed out' });
        fake.seed.failedMail({ account: w.author, template: 'nudge', kind: 'refused', error: 'no such mailbox' });
      },
    });
    const failed = await region(/^Mail that failed/u);
    expect(failed).toHaveTextContent('suspended');
    expect(failed).toHaveTextContent('the provider timed out');
    expect(failed).toHaveTextContent('will be tried again');
    expect(failed).toHaveTextContent('no such mailbox');
    expect(failed).toHaveTextContent('will not be tried again');
  });

  test('with no failed mail it says so, and with an address set it says nothing is waiting', async () => {
    open();
    const failed = await region(/^Mail that failed/u);
    expect(failed).toHaveTextContent('No mail has failed.');
    expect(screen.queryByText(/Mail is waiting/u)).toBeNull();
  });

  test('says plainly that mail is waiting when no admin reply-to address is set, and names the setting that is its way out', async () => {
    open({ build: (fake) => { fake.seed.mailWaiting(3); } });
    const notice = await screen.findByRole('status', { name: 'Mail waiting' });
    expect(notice).toHaveTextContent('Mail is waiting: no admin reply-to address is set (Settings.conduct.adminAddress).');
    expect(notice).toHaveTextContent('3');
  });

  test('a player is sent away: the screen is for admins, and shows nothing of any report', async () => {
    open({ as: 'player', build: (f, w) => { f.seed.conductReport({ version: w.post, section: 'person' }); } });
    expect(await screen.findByText('The reports screen is for admins.')).toBeInTheDocument();
    expect(screen.queryByText('Words that were reported.')).toBeNull();
    cleanup();
  });

  test('carries the admin pages\' strip, with Reports as the current page', async () => {
    open();
    const strip = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(within(strip).getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    expect(within(strip).getByRole('link', { name: 'Moves' })).toHaveAttribute('href', '/admin/queue');
  });
});
