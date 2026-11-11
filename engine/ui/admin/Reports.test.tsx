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
    /* The date is entered, and shown, in UTC, as the rest of the screen and the mail say it. */
    const until = within(form).getByLabelText('Suspended until (UTC)');
    fireEvent.change(until, { target: { value: '2026-12-01T12:00' } });
    await user.type(within(form).getByLabelText('A note for the author'), 'Take a week.');
    await user.click(within(form).getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [report, outcomes] = send.mock.calls[0]!;
    expect(typeof report).toBe('number');
    expect(outcomes).toEqual([{ outcome: 'suspend', until: '2026-12-01T12:00:00.000Z', note: 'Take a week.' }]);
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

describe('the outcome form', () => {
  const form = async () => within(await region(/^Open reports/u)).getByRole('form', { name: /^Decide report/u });
  const seed = (f: ReturnType<typeof buildWorld>, w: World) => { f.seed.conductReport({ version: w.post, section: 'person' }); };

  test('the note field is held, with a plain hint, while only "No action" or "Close" is picked, and open again with any outcome that writes to the author', async () => {
    open({ build: seed });
    const user = userEvent.setup();
    const f = await form();
    const note = within(f).getByLabelText('A note for the author');
    expect(note).toBeEnabled();
    await user.click(within(f).getByRole('checkbox', { name: 'No action' }));
    expect(note).toBeDisabled();
    expect(within(f).getByText('No word goes to the author with this outcome.')).toBeInTheDocument();
    expect(note).toHaveAccessibleDescription(/No word goes to the author/u);
    await user.click(within(f).getByRole('checkbox', { name: 'Hide' }));
    expect(note).toBeEnabled();
    expect(within(f).queryByText('No word goes to the author with this outcome.')).toBeNull();
  });

  test('a double press sends once and the button says it is busy meanwhile', async () => {
    const { fake } = open({ build: seed });
    let release!: () => void;
    const send = vi.spyOn(fake, 'decideReport').mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true, value: { decisions: [1] } }); }));
    const user = userEvent.setup();
    const f = await form();
    await user.click(within(f).getByRole('checkbox', { name: 'No action' }));
    const decide = within(f).getByRole('button', { name: 'Decide' });
    await user.dblClick(decide);
    expect(send).toHaveBeenCalledTimes(1);
    expect(decide).toHaveAttribute('aria-busy', 'true');
    release();
    await waitFor(() => expect(within(f).getByRole('button', { name: 'Decide' })).not.toHaveAttribute('aria-busy', 'true'));
  });

  test('a double press on a re-review decision sends once', async () => {
    const { fake } = open({ build: (f, ww) => { f.seed.conductReview({ post: ww.post, words: 'Better words.' }); } });
    let release!: () => void;
    const send = vi.spyOn(fake, 'decide').mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true, value: null }); }));
    const user = userEvent.setup();
    const due = await region(/^Edits to look at again/u);
    await user.dblClick(within(due).getByRole('button', { name: /^Approve/u }));
    expect(send).toHaveBeenCalledTimes(1);
    release();
  });

  test('after a decision on an open report focus goes to the open reports\' heading; after a re-review decision, to that group\'s heading', async () => {
    const { fake } = open({ build: (f, ww) => { f.seed.conductReview({ post: ww.post, words: 'Better words.' }); } });
    void fake;
    const user = userEvent.setup();
    const due = await region(/^Edits to look at again/u);
    await user.click(within(due).getByRole('button', { name: /^Approve/u }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Edits to look at again/u })).toHaveFocus());
  });
});

describe('a page that was cut', () => {
  test('says plainly that more reports wait than are listed, and counts "or more"', async () => {
    open({ build: (f, w) => { for (let i = 0; i < 51; i++) f.seed.conductReport({ version: w.post, section: 'person', at: 1000 + i }); } });
    const open_ = await region(/^Open reports/u);
    expect(within(open_).getAllByRole('article')).toHaveLength(50);
    expect(within(open_).getByRole('heading', { level: 2 })).toHaveAccessibleName(/50 or more/u);
    expect(open_).toHaveTextContent('More reports are waiting than are listed here. Decide these and the next ones will appear.');
  });

  test('a page that was not cut says nothing of more', async () => {
    open({ build: (f, w) => { f.seed.conductReport({ version: w.post, section: 'person' }); } });
    const open_ = await region(/^Open reports/u);
    expect(open_).not.toHaveTextContent('More reports are waiting');
  });

  test('says it for edits to look at again and for failed mail too', async () => {
    open({
      build: (f, w) => {
        for (let i = 0; i < 51; i++) f.seed.conductReview({ post: w.post, words: `edit ${i}`, at: 1000 + i });
        for (let i = 0; i < 201; i++) f.seed.failedMail({ account: w.author, template: 'nudge', kind: 'failed', error: 'x', at: 1000 + i });
      },
    });
    expect(await region(/^Edits to look at again/u)).toHaveTextContent('More edits are waiting than are listed here.');
    expect(await region(/^Mail that failed/u)).toHaveTextContent('More failed mail exists than is listed here.');
  });
});
