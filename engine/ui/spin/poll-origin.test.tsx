/**
 * A thread spun from a poll or from a public ballot (docs/plans/2026-11-20-polls-plan.md, Task 7): the head's words and link, the ORIGIN box drawing the poll
 * (open: it can be voted in; closed: final), a ballot's line above the table, the poll's events heard on the origin thread's channel, and the Spin form from the poll and from a ballot of its record.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { threadWorld } from '../composer/support.tsx';
import type { Act, Id, PageOrigin, Poll, ThreadListener } from '../data/api.ts';
import { createPlays } from '../cards/plays.ts';
import { createTallies } from '../thread/tallies.ts';
import { createPolls, type Polls } from '../polls/store.ts';
import { takeInOrigin } from './Origin.tsx';
import { LoadedThread } from '../loaded.tsx';
import { renderIn } from '../test-world.tsx';

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

/** Spritey's first post has a poll; Wario voted for Pipe Frame. The HUD's character is Pipewrench. */
function world(secret = false) {
  const w = threadWorld(2);
  const third = w.fake.seed.account('third');
  const wario = w.fake.seed.character(third, 'Wario', 'heel');
  const poll = w.fake.seed.poll(w.ids[0]!, { question: 'Best kart in the series?', options: ['Pipe Frame', 'Badwagon', 'Mr. Scooty'], pick: 1, secret, lasts: { unit: 'day', count: 2 } });
  const ballot = w.fake.seed.ballot(wario, poll, [0]);
  return { ...w, wario, poll, ballot };
}
type World = ReturnType<typeof world>;
async function spinFrom(w: World, origin: Id) {
  const made = await w.fake.spin(origin, w.zed, 'About the poll', 'Taking this elsewhere.');
  if (!made.ok) throw new Error(made.error);
  return made.value.thread.id;
}
const open = (w: World, thread: Id) => renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}` });
const box = () => screen.findByRole('group', { name: 'Origin' });
const question = (b: HTMLElement) => within(b).findByRole('group', { name: /^Best kart in the series\?/u });
const row = (poll: HTMLElement, option: string) => within(poll).getByText(option).closest('tr')!;

describe('a thread spun from a poll', () => {
  test('its head says the poll and the post it is on, as one link to that post', async () => {
    const w = world();
    open(w, await spinFrom(w, w.poll));
    const b = await box();
    const head = b.querySelector('.kb-origin-head-text') as HTMLElement;
    expect(head).toHaveTextContent(/^ORIGIN · Spun from the poll “Best kart in the series\?” on #1 in A short thread$/u);
    expect(within(head).getAllByRole('link')).toHaveLength(1);
    expect(within(head).getByRole('link')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
  });

  test('the box draws the poll in its content area, with its counts and who chose each option', async () => {
    const w = world();
    open(w, await spinFrom(w, w.poll));
    const b = await box();
    const poll = await question(b);
    expect(b.querySelector('.kb-origin-area')).toContainElement(poll);
    expect(row(poll, 'Pipe Frame')).toHaveTextContent('1 · 100%');
    expect(row(poll, 'Pipe Frame')).toHaveTextContent('Wario');
    expect(within(poll).getByText('1 character voted')).toBeInTheDocument();
  });

  test('an open poll can be voted in from the box, and the vote counts there', async () => {
    const w = world();
    const cast = vi.spyOn(w.fake, 'castBallot');
    open(w, await spinFrom(w, w.poll));
    const poll = await question(await box());
    await userEvent.click(within(poll).getByRole('radio', { name: 'Badwagon' }));
    await userEvent.click(within(poll).getByRole('button', { name: 'Vote as Pipewrench' }));
    await waitFor(() => expect(cast).toHaveBeenCalledWith(w.poll, w.pipe, [1]));
    await waitFor(() => expect(row(poll, 'Badwagon')).toHaveTextContent('1 · 50%'));
    expect(within(poll).getByText('2 characters voted')).toBeInTheDocument();
  });

  test('a closed poll is final in the box: no form, and the words say it has closed', async () => {
    const w = world();
    const thread = await spinFrom(w, w.poll);
    w.fake.clock.advance(3 * 86_400_000);
    open(w, thread);
    const poll = await question(await box());
    expect(within(poll).queryByRole('radio')).toBeNull();
    expect(within(poll).queryByRole('button', { name: /^Vote/u })).toBeNull();
    expect(poll).toHaveTextContent('This poll has closed, so no more ballots can be cast.');
    expect(row(poll, 'Pipe Frame')).toHaveTextContent('1 · 100%');
  });

  test('a `poll` event and a ballot heard on the origin thread\'s channel change the box', async () => {
    const w = world();
    const heard = new Map<Id, ThreadListener>();
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { heard.set(t, l); return real(t, l); };
    open(w, await spinFrom(w, w.poll));
    const poll = await question(await box());
    const tap = () => heard.get(w.thread)!;
    await waitFor(() => expect(heard.has(w.thread)).toBe(true));
    const at = (ms: number) => new Date(w.fake.clock.now() + ms).toISOString();
    act(() => tap().onPoll?.({ poll: w.poll, counts: [1, 5, 0], voters: 6, endsAt: at(86_400_000), closed: false, at: at(2_000) }));
    await waitFor(() => expect(row(poll, 'Badwagon')).toHaveTextContent('5 · 83%'));
    expect(within(poll).getByText('6 characters voted')).toBeInTheDocument();
  });

  test('the Spin in the poll\'s foot spins from the poll', async () => {
    const w = world();
    const spin = vi.spyOn(w.fake, 'spin');
    open(w, await spinFrom(w, w.poll));
    spin.mockClear();
    const poll = await question(await box());
    await userEvent.click(within(poll).getByRole('button', { name: 'Spin' }));
    const form = await screen.findByRole('form', { name: 'Spin a thread from this poll' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Again');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spin).toHaveBeenCalledWith(w.poll, w.pipe, 'Again', ''));
  });
});

describe('a poll replaced on the origin post', () => {
  test('is never drawn under the origin poll\'s head: the box says the poll was replaced', async () => {
    const w = world();
    const heard = new Map<Id, ThreadListener>();
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { heard.set(t, l); return real(t, l); };
    open(w, await spinFrom(w, w.poll));
    const b = await box();
    await question(b);
    await waitFor(() => expect(heard.has(w.thread)).toBe(true));
    const options = ['X', 'Y'];
    act(() => heard.get(w.thread)!.onAct?.({ id: 'new-poll', character: w.spritey, kind: 'poll', thread: w.thread, targetActId: w.ids[0]!, seq: null, createdAt: new Date(w.fake.clock.now() + 5_000).toISOString(), payload: { question: 'Another?', options, pick: 1, secret: false, closes_at: new Date(w.fake.clock.now() + 86_400_000).toISOString() }, currentPayload: {}, editedAt: null, shownEditedAt: null }));
    await waitFor(() => expect(b).toHaveTextContent('That poll was replaced on its post.'));
    expect(within(b).queryByRole('group', { name: /Another\?/u })).toBeNull();
    expect(within(b).queryByRole('group', { name: /Best kart/u })).toBeNull();
  });
});

describe('a thread spun from a public ballot', () => {
  test('its head names the character, the poll and the post, and the box names the ballot above the table', async () => {
    const w = world();
    open(w, await spinFrom(w, w.ballot));
    const b = await box();
    const head = b.querySelector('.kb-origin-head-text') as HTMLElement;
    expect(head).toHaveTextContent(/^ORIGIN · Spun from Wario's ballot in the poll “Best kart in the series\?” on #1 in A short thread$/u);
    expect(within(head).getByRole('link')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
    const poll = await question(b);
    const line = b.querySelector('.kb-origin-ballot') as HTMLElement;
    expect(line).toHaveTextContent(/^Wario voted for Pipe Frame, /u);
    /* Above the table, in the content area. */
    expect(line.compareDocumentPosition(poll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.querySelector('.kb-origin-area')).toContainElement(line);
  });
});

describe('the Ballots list of a poll', () => {
  test('has a Spin for each ballot line, which spins from that ballot', async () => {
    const w = world();
    const spin = vi.spyOn(w.fake, 'spin');
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    const poll = await screen.findByRole('group', { name: /^Best kart in the series\?/u });
    await userEvent.click(within(poll).getByRole('button', { name: 'Ballots' }));
    const list = await within(poll).findByRole('list', { name: 'Ballots' });
    const line = within(list).getAllByRole('listitem')[0]!;
    expect(line).toHaveTextContent(/^Wario picked Pipe Frame/u);
    await userEvent.click(within(line).getByRole('button', { name: "Spin from Wario's ballot" }));
    const form = await screen.findByRole('form', { name: "Spin a thread from Wario's ballot" });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About a ballot');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spin).toHaveBeenCalledWith(w.ballot, w.pipe, 'About a ballot', ''));
  });

  test('a secret poll has no list, so no ballot Spin is drawn', async () => {
    const w = world(true);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    const poll = await screen.findByRole('group', { name: /^Best kart in the series\?/u });
    expect(within(poll).queryByRole('button', { name: 'Ballots' })).toBeNull();
    expect(within(poll).getAllByRole('button', { name: 'Spin' })).toHaveLength(1);
  });
});

describe('a page read again after the poll was removed from its post', () => {
  const act = (kind: 'poll' | 'ballot', target: Id): Act => ({ id: `${kind}-1`, character: 'c1', kind, thread: 't1', targetActId: target, seq: null, createdAt: '2026-11-20T10:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null });
  const poll = (): Poll => ({ post: 'post-1', act: { ...act('poll', 'post-1'), id: 'poll-1', payload: { question: 'Q?', options: ['A', 'B'], pick: 1, secret: false, closes_at: '2026-11-22T10:00:00.000Z' } }, counts: [0, 0], voters: 0, endsAt: '2026-11-22T10:00:00.000Z', closed: false, close: null, balloted: false });
  const origin = (from: Act, polls: readonly Poll[]): PageOrigin => ({ act: from, plays: [], counts: [], moment: null, at: null, cast: [], polls, voters: [], votersMore: [], myBallots: [] });
  const take = (o: PageOrigin, store: Polls) => takeInOrigin(o, 'x', createPlays(), createTallies(), new Map(), undefined, store);

  test.each([['poll origin', 'poll', 'post-1'], ['ballot origin', 'ballot', 'poll-1']] as const)('a %s drops the removed poll\'s view', (_, kind, target) => {
    const store = createPolls();
    const from = act(kind, target);
    take(origin(from, [poll()]), store);
    expect(store.get('post-1')).toBeDefined();
    take(origin(from, []), store);
    expect(store.get('post-1')).toBeUndefined();
  });
});

describe('a ballot whose poll is gone', () => {
  test('shows the notice alone, with no ballot line of blank picks', async () => {
    const w = world();
    const heard = new Map<Id, ThreadListener>();
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { heard.set(t, l); return real(t, l); };
    open(w, await spinFrom(w, w.ballot));
    const b = await box();
    await question(b);
    await waitFor(() => expect(heard.has(w.thread)).toBe(true));
    act(() => heard.get(w.thread)!.onAct?.({ id: 'gone', character: w.spritey, kind: 'poll', thread: w.thread, targetActId: w.ids[0]!, seq: null, createdAt: new Date(w.fake.clock.now() + 5_000).toISOString(), payload: { removed: true }, currentPayload: {}, editedAt: null, shownEditedAt: null }));
    await waitFor(() => expect(b).toHaveTextContent('That poll is no longer on its post.'));
    expect(b.querySelector('.kb-origin-ballot')).toBeNull();
  });
});
