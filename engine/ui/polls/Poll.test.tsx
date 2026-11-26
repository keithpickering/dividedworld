/**
 * A poll on a post (docs/plans/2026-11-20-polls-plan.md, Task 5), drawn as the board draws it (docs/research/2026-11-20-polls/01-placement.html, option A): a
 * fieldset whose legend is the question, a table of the options with their bars and counts, and a foot with the form, the voter count and the links. Each state's
 * controls and words, the keyboard path, a refusal in the foot, and the live events (a `poll` event's counts, a ballot's name). The thread screen draws the post;
 * the fake is the backend, so a ballot is cast, counted and heard as the server would.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import { tapThread } from '../test-world.tsx';
import { openThread, threadWorld } from '../composer/support.tsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bodyOf, liftedOver } from '../cards/body.ts';
import type { CardUi } from '../cards/types.ts';
import { renderIn } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';

const DAY = 86_400_000;
beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** A thread whose first post, Spritey's, has a poll of three options; Wario and Bowser Jr. are other players' characters who have voted. */
function world(draft: Partial<{ question: string; options: string[]; pick: number; secret: boolean; lasts: { unit: 'day'; count: number } }> = {}) {
  const w = threadWorld(2);
  const third = w.fake.seed.account('third');
  const wario = w.fake.seed.character(third, 'Wario', 'heel');
  const junior = w.fake.seed.character(third, 'Bowser Jr.', 'face');
  const poll = w.fake.seed.poll(w.ids[0]!, { question: 'Best kart in the series?', options: ['Pipe Frame', 'Badwagon', 'Mr. Scooty'], pick: 1, secret: false, lasts: { unit: 'day', count: 2 }, ...draft });
  w.fake.seed.ballot(wario, poll, [0]);
  w.fake.seed.ballot(junior, poll, [1]);
  return { ...w, wario, junior, poll };
}
const group = () => screen.findByRole('group', { name: /^Best kart in the series\?/u });
const row = (poll: HTMLElement, option: string) => within(poll).getByText(option).closest('tr')!;
/** The fake's clock is fixed, and a poll's events are ordered by the time of the Act that made them: each press is made a moment after the last, as a person's are. */
const later = (w: { fake: { clock: { advance(ms: number): void } } }) => w.fake.clock.advance(1_000);

describe('an open public poll', () => {
  test('is a fieldset named for its question, with the ballots\' kind, the choice and the time left in Courier', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    expect(poll.tagName).toBe('FIELDSET');
    expect(poll.querySelector('legend')).toHaveTextContent(/^Best kart in the series\?public ballots · choose 1 · closes in 2 days$/u);
  });

  test('has a radio, the bar, and a count with its percent for each option, and the names of the voters under it', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    expect(within(poll).getAllByRole('radio').map((r) => r.getAttribute('name'))).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
    expect(row(poll, 'Pipe Frame')).toHaveTextContent('1 · 50%');
    expect(row(poll, 'Badwagon')).toHaveTextContent('1 · 50%');
    expect(row(poll, 'Mr. Scooty')).toHaveTextContent('0 · 0%');
    expect(row(poll, 'Pipe Frame')).toHaveTextContent('Wario');
    expect(row(poll, 'Badwagon')).toHaveTextContent('Bowser Jr.');
    /* The bars are only a picture; the counts are the text. */
    for (const bar of poll.querySelectorAll('.kb-poll-bar')) expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  test('says how many characters voted, never who a count is made of beyond the names it lists', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    expect(within(poll).getByText('2 characters voted')).toBeInTheDocument();
  });

  test('stands in the post\'s content area, as ink the effects paint under, with no border box of its own beyond the table', async () => {
    const w = world();
    openThread(w);
    const poll = (await group()).closest('[data-kb-over-ink]')!;
    expect(poll).not.toBeNull();
    expect(poll.closest('[data-kb-content-area]')).not.toBeNull();
    /* After the words, before the reactions. */
    const body = poll.closest('[data-kb-content-area]')!;
    const order = [...body.children];
    expect(order.indexOf(poll)).toBeGreaterThan(order.findIndex((c) => c.textContent?.includes('post 1')));
    expect(order.indexOf(poll)).toBeLessThan(order.findIndex((c) => c.classList.contains('kb-reactions')));
  });

  test('has no accessibility violations', async () => {
    const w = world();
    const view = openThread(w);
    await group();
    const found = await axeViolations(view.container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('voting', () => {
  test('offers "Vote as" the HUD\'s mask, which waits for a pick, and a ballot cast by keyboard lands, is announced and moves the counts', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    const vote = within(poll).getByRole('button', { name: 'Vote as Pipewrench' });
    expect(vote).toHaveAttribute('aria-disabled', 'true');
    const user = userEvent.setup();
    await user.click(within(poll).getByRole('radio', { name: 'Badwagon' }));
    /* Out of the radio group by keyboard and onto the button. */
    await user.keyboard('{Tab}');
    expect(within(poll).getByRole('button', { name: 'Vote as Pipewrench' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(row(poll, 'Badwagon')).toHaveTextContent('2 · 67%'));
    expect(row(poll, 'Badwagon')).toHaveTextContent('Bowser Jr., Pipewrench');
    expect(within(poll).getByText('3 characters voted')).toBeInTheDocument();
    expect(await within(poll).findByRole('status')).toHaveTextContent('Ballot cast as Pipewrench');
    /* It is the HUD mask's counted ballot now: its pick is checked and the form changes it. */
    expect(within(poll).getByRole('radio', { name: 'Badwagon' })).toBeChecked();
    expect(within(poll).getByRole('button', { name: 'Change ballot as Pipewrench' })).toBeInTheDocument();
    expect(within(poll).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  test('a changed ballot moves the mask\'s name, and a withdrawal takes it off every option', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    const user = userEvent.setup();
    later(w);
    await user.click(within(poll).getByRole('radio', { name: 'Pipe Frame' }));
    await user.click(within(poll).getByRole('button', { name: 'Vote as Pipewrench' }));
    await waitFor(() => expect(row(poll, 'Pipe Frame')).toHaveTextContent('Pipewrench'));
    later(w);
    await user.click(within(poll).getByRole('radio', { name: 'Mr. Scooty' }));
    await user.click(within(poll).getByRole('button', { name: 'Change ballot as Pipewrench' }));
    await waitFor(() => expect(row(poll, 'Mr. Scooty')).toHaveTextContent('Pipewrench'));
    expect(row(poll, 'Pipe Frame')).not.toHaveTextContent('Pipewrench');
    later(w);
    await user.click(within(poll).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(within(poll).getByText('2 characters voted')).toBeInTheDocument());
    expect(poll.querySelector('.kb-poll-table')).not.toHaveTextContent('Pipewrench');
    expect(await within(poll).findByRole('status')).toHaveTextContent('Ballot withdrawn as Pipewrench');
    expect(within(poll).getByRole('button', { name: 'Vote as Pipewrench' })).toBeInTheDocument();
    expect(within(poll).queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  test('a mask that already voted comes up with its picks checked, and another mask of the same player with none', async () => {
    const w = world();
    w.fake.seed.ballot(w.pipe, w.poll, [2]);
    openThread(w);
    const poll = await group();
    expect(within(poll).getByRole('radio', { name: 'Mr. Scooty' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(within(poll).getByRole('button', { name: 'Vote as Zed' })).toBeInTheDocument());
    for (const r of within(poll).getAllByRole('radio')) expect(r).not.toBeChecked();
  });

  test('a server refusal stands in the foot, an alert, and the form stays for another try', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    vi.spyOn(w.fake, 'castBallot').mockResolvedValueOnce({ ok: false, error: 'that poll has closed' });
    const user = userEvent.setup();
    await user.click(within(poll).getByRole('radio', { name: 'Badwagon' }));
    await user.click(within(poll).getByRole('button', { name: 'Vote as Pipewrench' }));
    expect(await within(poll).findByRole('alert')).toHaveTextContent('that poll has closed');
    expect(within(poll).getByRole('radio', { name: 'Badwagon' })).toBeChecked();
    expect(within(poll).getByRole('button', { name: 'Vote as Pipewrench' })).toHaveAttribute('aria-disabled', 'false');
    expect(within(poll).getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('a poll that lets more than one be picked', () => {
  test('has checkboxes, says "choose 2", and is refused before a send for more than it allows, in the database\'s words', async () => {
    const w = world({ pick: 2, options: ['One', 'Two', 'Three', 'Four'] });
    const cast = vi.spyOn(w.fake, 'castBallot');
    openThread(w);
    const poll = await screen.findByRole('group', { name: /^Best kart in the series\?/u });
    expect(poll.querySelector('legend')).toHaveTextContent('choose 2');
    expect(within(poll).getAllByRole('checkbox')).toHaveLength(4);
    const user = userEvent.setup();
    for (const n of ['One', 'Two', 'Three']) await user.click(within(poll).getByRole('checkbox', { name: n }));
    await user.click(within(poll).getByRole('button', { name: 'Vote as Pipewrench' }));
    expect(await within(poll).findByRole('alert')).toHaveTextContent('pick up to 2 options');
    expect(cast).not.toHaveBeenCalled();
    await user.click(within(poll).getByRole('checkbox', { name: 'Three' }));
    await user.click(within(poll).getByRole('button', { name: 'Vote as Pipewrench' }));
    await waitFor(() => expect(cast).toHaveBeenCalledWith(w.poll, w.pipe, [0, 1]));
  });
});

describe('a secret poll', () => {
  test('says so, lists no voter and has no ballots list, yet counts and keeps the caller\'s own ballot checked', async () => {
    const w = world({ secret: true });
    w.fake.seed.ballot(w.pipe, w.poll, [1]);
    openThread(w);
    const poll = await group();
    expect(poll.querySelector('legend')).toHaveTextContent('secret ballots · choose 1');
    expect(row(poll, 'Badwagon')).toHaveTextContent('2 · 67%');
    expect(poll.querySelector('.kb-poll-who')).toBeNull();
    expect(poll.querySelector('.kb-poll-table')).not.toHaveTextContent(/Wario|Bowser|Pipewrench/u);
    expect(within(poll).queryByRole('button', { name: /^Ballots/u })).toBeNull();
    expect(within(poll).getByRole('radio', { name: 'Badwagon' })).toBeChecked();
  });
});

describe('a closed poll', () => {
  test('has no inputs, says when it closed and says why nothing can be cast', async () => {
    const w = world();
    w.fake.clock.advance(3 * DAY);
    openThread(w);
    const poll = await group();
    expect(within(poll).queryAllByRole('radio')).toHaveLength(0);
    expect(within(poll).queryByRole('button', { name: /^Vote as/u })).toBeNull();
    expect(poll.querySelector('legend')).toHaveTextContent(/closed [A-Z][a-z]{2} \d{1,2}, \d{4}$/u);
    expect(within(poll).getByText('This poll has closed, so no more ballots can be cast.')).toBeInTheDocument();
    expect(row(poll, 'Pipe Frame')).toHaveTextContent('1 · 50%');
  });
});

describe('who can vote', () => {
  test('no character of the player\'s that can act: no inputs, one plain line', async () => {
    const w = world();
    w.fake.signInAs(w.fake.seed.account('nobody'));
    openThread(w);
    const poll = await group();
    expect(within(poll).queryAllByRole('radio')).toHaveLength(0);
    expect(within(poll).getByText('None of your characters can vote yet. Make a character, and vote as it.')).toBeInTheDocument();
  });

  test('a banned mask: no inputs, the ban\'s words, and the other mask of the same player can vote', async () => {
    const w = world();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const visit = w.fake.seed.visit(clerk, w.ids[1]!, { at: w.fake.clock.now() - 3_600_000, endsInMs: 60_000 });
    const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
    w.fake.seed.ban(w.pipe, w.fake.clock.now() + 5 * 3_600_000, { infraction: inf });
    openThread(w);
    const poll = await group();
    expect(within(poll).queryAllByRole('radio')).toHaveLength(0);
    const note = within(poll).getByText(/is banned until/u).closest('p')!;
    expect(note).toHaveTextContent(/^Pipewrench is banned until .+\. The ban ends by itself then, and it holds only this character: switch to another in the HUD to post as her\. Appeal to the Boss/u);
    expect(within(note).getByRole('button', { name: /^Appeal to the Boss/u })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(within(poll).getAllByRole('radio')).toHaveLength(3));
  });
});

describe('closing', () => {
  test('the author\'s mask has "Close poll", which ends it for good and says it was closed early by its author', async () => {
    const w = world();
    const mine = w.fake.seed.poll(w.ids[1]!, { question: 'My own question?', options: ['Yes', 'No'], pick: 1, secret: false, lasts: { unit: 'day', count: 3 } });
    expect(mine).toBeTruthy();
    openThread(w);
    const poll = await screen.findByRole('group', { name: /^My own question\?/u });
    expect(within(screen.getByRole('group', { name: /^Best kart/u })).queryByRole('button', { name: 'Close poll' })).toBeNull();
    await userEvent.click(within(poll).getByRole('button', { name: 'Close poll' }));
    await waitFor(() => expect(poll.querySelector('legend')).toHaveTextContent(/closed early by its author$/u));
    expect(within(poll).queryAllByRole('radio')).toHaveLength(0);
    expect(within(poll).queryByRole('button', { name: 'Close poll' })).toBeNull();
  });

  test('an admin has "Close poll" on any poll, and it says so as "closed early by an admin"', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    openThread(w);
    const poll = await group();
    await userEvent.click(await within(poll).findByRole('button', { name: 'Close poll' }));
    await waitFor(() => expect(poll.querySelector('legend')).toHaveTextContent(/closed early by an admin$/u));
  });
});

describe('the ballots a public poll keeps', () => {
  test('are listed on request, newest first, in plain words with who switched and who withdrew', async () => {
    const w = world();
    w.fake.clock.advance(60_000);
    w.fake.seed.ballot(w.wario, w.poll, [2]);
    w.fake.clock.advance(60_000);
    w.fake.seed.ballot(w.junior, w.poll, []);
    openThread(w);
    const poll = await group();
    await userEvent.click(within(poll).getByRole('button', { name: 'Ballots' }));
    const list = await within(poll).findByRole('list', { name: 'Ballots' });
    const lines = within(list).getAllByRole('listitem').map((li) => li.textContent!.replace(/, [A-Z][a-z]{2} \d{1,2}.*$/u, ''));
    expect(lines).toEqual(['Bowser Jr. withdrew', 'Wario switched to Mr. Scooty', 'Bowser Jr. picked Badwagon', 'Wario picked Pipe Frame']);
  });

  test('a secret poll has no list to open', async () => {
    const w = world({ secret: true });
    openThread(w);
    const poll = await group();
    expect(within(poll).queryByRole('button', { name: 'Ballots' })).toBeNull();
  });
});

describe('many voters on one option', () => {
  test('the first eight names, then "and N more", which opens the whole list', async () => {
    const w = world();
    const crowd = w.fake.seed.account('crowd');
    for (let i = 1; i <= 11; i++) w.fake.seed.ballot(w.fake.seed.character(crowd, `Fan ${String(i).padStart(2, '0')}`, 'face'), w.poll, [0]);
    openThread(w);
    const poll = await group();
    const first = row(poll, 'Pipe Frame');
    const more = within(first).getByRole('button', { name: 'and 4 more' });
    expect(first).toHaveTextContent(/Wario/u);
    expect(first.textContent).not.toContain('Fan 11');
    await userEvent.click(more);
    expect(first).toHaveTextContent('Fan 11');
    expect(within(first).queryByRole('button', { name: /and \d+ more/u })).toBeNull();
  });
});

describe('live', () => {
  /* Times on the fake's own clock, which the poll's end is dated on. */
  let at = (ms: number) => new Date(ms).toISOString();
  /* An event is heard only once the screen's channels have joined, as Realtime delivers nothing sooner, so the catch-up
     read their joins ask is asked before it and cannot land over it (issue #1156). tapThread would hand an event to a
     listener not yet joined; reach joins after the thread channel, so its count says both have. */
  const heardOn = async (w: ReturnType<typeof world>) => {
    const tap = tapThread(w.fake);
    at = (ms) => new Date(w.fake.clock.now() + ms).toISOString();
    openThread(w);
    await waitFor(() => expect(w.fake.broadcast.reachListeners()).toBe(1));
    return tap;
  };

  test('a `poll` event replaces the counts, and an older one heard late changes nothing', async () => {
    const w = world();
    const tap = await heardOn(w);
    const poll = await group();
    const base = { poll: w.poll, voters: 6, endsAt: at(DAY), closed: false };
    act(() => tap().onPoll?.({ ...base, counts: [1, 5, 0], at: at(2_000) }));
    await waitFor(() => expect(row(poll, 'Badwagon')).toHaveTextContent('5 · 83%'));
    expect(within(poll).getByText('6 characters voted')).toBeInTheDocument();
    act(() => tap().onPoll?.({ ...base, counts: [1, 1, 0], voters: 2, at: at(1_000) }));
    expect(row(poll, 'Badwagon')).toHaveTextContent('5 · 83%');
  });

  test('a ballot heard live on a public poll moves the character\'s name, reading a stranger once', async () => {
    const w = world();
    const tap = await heardOn(w);
    const poll = await group();
    const stranger = w.fake.seed.character(w.fake.seed.account('late'), 'Latecomer', 'face');
    const read = vi.spyOn(w.fake, 'characters');
    const ballot = (picks: number[], ms: number) => ({ id: `b-${ms}`, character: stranger, kind: 'ballot' as const, thread: w.thread, targetActId: w.poll, seq: null, createdAt: at(ms), payload: { picks }, currentPayload: { picks }, editedAt: null, shownEditedAt: null });
    act(() => tap().onAct?.(ballot([2], 1_000)));
    await waitFor(() => expect(row(poll, 'Mr. Scooty')).toHaveTextContent('Latecomer'));
    act(() => tap().onAct?.(ballot([0], 2_000)));
    await waitFor(() => expect(row(poll, 'Pipe Frame')).toHaveTextContent('Latecomer'));
    expect(row(poll, 'Mr. Scooty')).not.toHaveTextContent('Latecomer');
    expect(read.mock.calls.filter(([ids]) => (ids as Id[]).includes(stranger))).toHaveLength(1);
  });

  test('a poll Act heard live (an edit\'s) replaces the post\'s poll, and a removal takes it away', async () => {
    const w = world();
    const tap = await heardOn(w);
    await group();
    const act2 = (payload: Record<string, unknown>, ms: number) => ({ id: `p-${ms}`, character: w.spritey, kind: 'poll' as const, thread: w.thread, targetActId: w.ids[0]!, seq: null, createdAt: at(ms), payload, currentPayload: payload, editedAt: null, shownEditedAt: null });
    act(() => tap().onAct?.(act2({ question: 'Best course?', options: ['Rainbow Road', 'Mute City'], pick: 1, secret: false, closes_at: at(DAY) }, 5_000)));
    const next = await screen.findByRole('group', { name: /^Best course\?/u });
    expect(within(next).getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('group', { name: /^Best kart/u })).toBeNull();
    act(() => tap().onAct?.(act2({ removed: true }, 6_000)));
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Best course/u })).toBeNull());
  });
});

describe('the board\'s stylesheet', () => {
  test('draws no color of its own, takes its ink from the post\'s tokens, and puts each option\'s bar and count on its own line on a phone', () => {
    const css = readFileSync(join(process.cwd(), 'engine/ui/polls/poll.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|hsl/u);
    expect(css).toMatch(/@media \(max-width: 40em\)/u);
    expect(css).toMatch(/\.kb-poll-bar/u);
  });
});

describe('what is drawn beside the poll', () => {
  test('its SpunInto stands in the foot for a thread spun from the poll', async () => {
    const w = world();
    const made = await w.fake.spin(w.poll, w.pipe, 'Karts, settled', 'Carrying on over here.');
    expect(made.ok).toBe(true);
    openThread(w);
    const poll = await group();
    const spun = await within(poll).findByText(/Spun into:/u);
    expect(within(spun.closest('p')!).getByRole('link', { name: 'Karts, settled' })).toBeInTheDocument();
  });

  test('its SpunInto names the board of a thread spun onto another board', async () => {
    const w = world();
    const made = await w.fake.spin(w.poll, w.pipe, 'Karts, elsewhere', 'Over there.', undefined, undefined, 'off-topic');
    expect(made.ok).toBe(true);
    openThread(w);
    const poll = await group();
    const spun = await within(poll).findByText(/Spun into:/u);
    await waitFor(() => expect(spun.closest('p')).toHaveTextContent('↳ Spun into: Karts, elsewhere (on Off Topic, 0 replies)'));
  });

  test('a hidden post draws no poll', async () => {
    const w = world();
    w.fake.seed.hide(w.ids[0]!, 'hide');
    openThread(w);
    await screen.findByRole('article', { name: /^Post 1 /u });
    await screen.findByRole('article', { name: /^Post 2 /u });
    expect(screen.queryByRole('group', { name: /^Best kart/u })).toBeNull();
  });
});

describe('the ballots record across a page edge', () => {
  test('words the oldest loaded line neutrally while an earlier ballot may be on the next page, and exactly once it is loaded', async () => {
    const w = world();
    const X = w.fake.seed.character(w.fake.seed.account('flipper'), 'Flipper', 'face');
    /* 52 ballots of Flipper's, a second apart: the newest 50 of the record are all its. */
    for (let n = 0; n < 52; n++) { later(w); w.fake.seed.ballot(X, w.poll, [n % 2]); }
    openThread(w);
    const poll = await group();
    await userEvent.click(within(poll).getByRole('button', { name: 'Ballots' }));
    const list = await within(poll).findByRole('list', { name: 'Ballots' });
    const items = () => within(list).getAllByRole('listitem').map((li) => li.textContent!);
    await waitFor(() => expect(items()).toHaveLength(50));
    expect(items()[0]).toMatch(/^Flipper switched to /u);
    expect(items()[49]).toMatch(/^Flipper voted for /u);
    await userEvent.click(within(poll).getByRole('button', { name: 'Show older ballots' }));
    await waitFor(() => expect(items()).toHaveLength(54));
    expect(items()[53]).toMatch(/^Wario picked Pipe Frame/u);
    expect(items().filter((t) => /^Flipper picked /u.test(t))).toHaveLength(1);
    expect(items().filter((t) => /voted for/u.test(t))).toHaveLength(0);
  });
});

describe('a voter the thread already knows', () => {
  test('is named from the thread, never read again for the poll', async () => {
    const w = world();
    const tap = tapThread(w.fake);
    openThread(w);
    const poll = await group();
    await screen.findByRole('article', { name: /^Post 2 /u });
    const read = vi.spyOn(w.fake, 'characters');
    const t = new Date(w.fake.clock.now() + 1_000).toISOString();
    act(() => tap().onAct?.({ id: 'b-known', character: w.pipe, kind: 'ballot', thread: w.thread, targetActId: w.poll, seq: null, createdAt: t, payload: { picks: [2] }, currentPayload: { picks: [2] }, editedAt: null, shownEditedAt: null }));
    await waitFor(() => expect(row(poll, 'Mr. Scooty')).toHaveTextContent('Pipewrench'));
    expect(read.mock.calls.filter(([ids]) => (ids as Id[]).includes(w.pipe))).toHaveLength(0);
  });
});

describe('under a card\'s ink', () => {
  /* An effect paints its ink under the words in the post's content area and takes a press in that area that is not on something lifted over the ink. */
  const presses = { n: 0 };
  const ink: CardUi = {
    key: 'whoops', art: { color: 'var(--kb-fg)', ink: 'var(--kb-bg)', canvas: '', mark: '', credit: 'Test' }, describe: () => 'ink',
    Effect: ({ children }) => (
      <div
        data-kb-effect-ink="" data-testid="ink"
        ref={(el) => {
          const body = el === null ? null : bodyOf(el);
          if (body === null || body.dataset.kbWatched) return;
          body.dataset.kbWatched = '1';
          body.addEventListener('pointerdown', (e) => { if (!liftedOver(e.target, body)) presses.n++; });
        }}
      >{children}</div>
    ),
  };
  test('the ink and the poll share the content area, and a press inside the poll starts nothing', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[0]!, 'whoops', { message: 'ink', layer: 1, live: true });
    presses.n = 0;
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, cards: [ink] });
    const poll = await group();
    const inkEl = await screen.findByTestId('ink');
    const area = poll.closest('[data-kb-content-area]')!;
    expect(area.contains(inkEl)).toBe(true);
    expect(inkEl.contains(poll)).toBe(false);
    expect(poll.closest('[data-kb-over-ink]')).not.toBeNull();
    const user = userEvent.setup();
    await user.click(within(poll).getByRole('radio', { name: 'Badwagon' }));
    expect(presses.n).toBe(0);
    expect(within(poll).getByRole('radio', { name: 'Badwagon' })).toBeChecked();
    await user.click(within(inkEl).getByText('post 1'));
    expect(presses.n).toBe(1);
  });
});

describe('focus', () => {
  const kept = (poll: HTMLElement) => expect(poll.contains(document.activeElement) && document.activeElement !== document.body).toBe(true);
  test('stays inside the poll after a vote, a change and a withdrawal', async () => {
    const w = world();
    openThread(w);
    const poll = await group();
    const user = userEvent.setup();
    later(w);
    await user.click(within(poll).getByRole('radio', { name: 'Badwagon' }));
    await user.click(within(poll).getByRole('button', { name: 'Vote as Pipewrench' }));
    await within(poll).findByText('Ballot cast as Pipewrench');
    kept(poll);
    later(w);
    await user.click(within(poll).getByRole('radio', { name: 'Mr. Scooty' }));
    await user.click(within(poll).getByRole('button', { name: 'Change ballot as Pipewrench' }));
    await waitFor(() => expect(within(poll).getByRole('radio', { name: 'Mr. Scooty' })).toBeChecked());
    await waitFor(() => expect(row(poll, 'Mr. Scooty')).toHaveTextContent('Pipewrench'));
    kept(poll);
    later(w);
    await user.click(within(poll).getByRole('button', { name: 'Withdraw' }));
    await within(poll).findByText('Ballot withdrawn as Pipewrench');
    kept(poll);
  });
});

describe('a long list of names', () => {
  test('opens 100 at a time, with "show more" for the rest', async () => {
    const w = world();
    const crowd = w.fake.seed.account('crowd');
    for (let i = 1; i <= 130; i++) w.fake.seed.ballot(w.fake.seed.character(crowd, `Fan ${String(i).padStart(3, '0')}`, 'face'), w.poll, [0]);
    openThread(w);
    const poll = await group();
    const first = row(poll, 'Pipe Frame');
    await userEvent.click(within(first).getByRole('button', { name: /^and \d+ more$/u }));
    expect(first.textContent).toContain('Fan 091');
    expect(first.textContent).not.toContain('Fan 130');
    await userEvent.click(await within(first).findByRole('button', { name: /^show \d+ more names$/u }));
    expect(first).toHaveTextContent('Fan 130');
  });
});
