import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import { RecordScreen } from './Record.tsx';
import { LoadedRecord } from '../loaded.tsx';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 12);

function world(fake: Fake, posts = 45) {
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const spritey = fake.seed.character(other, 'Spritey', 'face', { at: T0 });
  const { thread, act } = fake.seed.thread('general', spritey, 'A long one', 'first', { at: T0 });
  for (let i = 1; i < posts; i++) fake.seed.post(thread, spritey, `post number ${i + 1}`, { at: T0 + i * 60_000 });
  fake.seed.card(spritey, act, 'whoops', { at: T0 + DAY });
  fake.seed.reveal(spritey, thread, { class: 'face', at: T0 + 2 * DAY });
  const sys = fake.seed.thread('the-system', null, 'Turns', '');
  fake.seed.announceTurn(spritey, sys.thread, { at: T0 + 3 * DAY });
  fake.signInAs(me);
  return { spritey, thread };
}
const open = (fake: Fake, id: string, query = '') => renderIn(fake, <LoadedRecord id={id} />, { path: `/c/${id}/record${query}` });
const dataRows = () => screen.getAllByRole('row').slice(1);

describe('the full public record', () => {
  test('a signed-out visitor sees the front door, not the record', async () => {
    const fake = buildWorld();
    const w = world(fake);
    fake.signInAs(null);
    open(fake, w.spritey);
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByText(/The board is for players\./u)).toBeNull();
  });

  test('pages twenty to a page, newest first, and says which page', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey);
    expect(await screen.findByRole('heading', { level: 1, name: 'Spritey’s public record' })).toBeInTheDocument();
    await waitFor(() => expect(dataRows()).toHaveLength(20));
    /* "All" is what the profile's latest rows are: the Acts with the reveals and Turns, newest first. */
    expect(dataRows()[0]).toHaveTextContent('Announced a Turn');
    expect(dataRows()[1]).toHaveTextContent('Revealed: Face');
    expect(dataRows()[2]).toHaveTextContent('Played Whoops!');
    expect(screen.getByText(/Page 1 of 3/u)).toBeInTheDocument();
  });

  test('a "Played" row links to the post the play landed on, not the thread\'s top', async () => {
    const fake = buildWorld();
    const w = world(fake);
    /* Post #30 is on page 2 at twenty a page, so a link to the thread's top cannot pass for its permalink. */
    const target = fake.seed.post(w.thread, w.spritey, 'the target', { at: T0 + 5 * DAY });
    const seq = (await fake.actsById([target]))[0]!.seq!;
    fake.seed.card(w.spritey, target, 'whoops', { at: T0 + 6 * DAY });
    open(fake, w.spritey, '?kind=card');
    const rows = await waitFor(() => { const r = dataRows(); expect(r).toHaveLength(2); return r; });
    const hrefs = rows.map((r) => within(r).getByRole('link').getAttribute('href'));
    expect(hrefs[0]).toBe(threadHref(w.thread, pageOf(seq, 20), seq));
    expect(hrefs[1]).toBe(threadHref(w.thread, 1, 1));
  });

  test('"All" pages the merge exactly: every row once, in order, across the pages', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const sys = fake.seed.thread('the-system', null, 'Reveal', '');
    for (const d of [0.5, 25, 40]) fake.seed.post(sys.thread, null, '', { kind: 'reveal', at: T0 + d * DAY, payload: { season: 1, character: w.spritey, name: 'Spritey', place: 1, standing: 0, shown: [] } });
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const { unmount } = open(fake, w.spritey, `?page=${page}`);
      await waitFor(() => expect(dataRows().length).toBeGreaterThan(0));
      for (const r of dataRows()) seen.push(r.textContent!);
      unmount();
    }
    expect(seen).toHaveLength(51);
    /* Each row has its own time or words, so none appears twice. */
    expect(new Set(seen).size).toBe(51);
    expect(seen.filter((t) => /reveal: finished/u.test(t))).toHaveLength(3);
    /* newest first: the day-40 and day-25 season rows come before the Turn, day 3's. */
    const turn = seen.findIndex((t) => /Announced a Turn/u.test(t));
    expect(seen.findIndex((t) => /Season 1 reveal/u.test(t))).toBeLessThan(turn);
  });

  test('?page=3 shows the rest, and the pager links by keyboard', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?page=3');
    await waitFor(() => expect(dataRows()).toHaveLength(8));
    const user = userEvent.setup();
    const prev = screen.getByRole('link', { name: 'Previous page' });
    expect(prev).toHaveAttribute('href', `/c/${w.spritey}/record?page=2`);
    prev.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(dataRows()).toHaveLength(20));
    expect(screen.getByText(/Page 2 of 3/u)).toBeInTheDocument();
  });

  test('filters by kind with links, and a filter keeps no page', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?page=2');
    const cards = await screen.findByRole('link', { name: 'Cards' });
    expect(cards).toHaveAttribute('href', `/c/${w.spritey}/record?kind=card`);
    await userEvent.click(cards);
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(dataRows()[0]).toHaveTextContent('Played Whoops!');
    expect(screen.getByRole('link', { name: 'Posts' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Cards', { selector: '[aria-current="true"]' })).toBeInTheDocument();
  });

  test('the class filter lists the reveals and announced Turns', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?kind=class');
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    expect(screen.getByRole('table')).toHaveTextContent('Announced a Turn');
    expect(screen.getByRole('table')).toHaveTextContent('Revealed: Face');
  });

  test('the seasons filter lists the character\'s past reveal posts and links to them, and a Turn links to its tally', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const sys = fake.seed.thread('the-system', null, 'Reveal', '');
    fake.seed.post(sys.thread, null, '', { kind: 'reveal', payload: { season: 1, character: w.spritey, name: 'Spritey', place: 4, standing: 0, shown: [] } });
    open(fake, w.spritey, '?kind=seasons');
    const link = await screen.findByRole('link', { name: 'Season 1 reveal: finished #4' });
    expect(link).toHaveAttribute('href', `/t/${sys.thread}?page=1#post-2`);
  });

  test('the seasons view says it lists the latest fifty', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?kind=seasons');
    expect(await screen.findByText('The latest 50 season reveal posts.')).toBeInTheDocument();
  });

  test('a page past the end, or a waiting character, is plain', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?page=99');
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First page' })).toBeInTheDocument();
  });

  test('an absurd page number is read as a sane one', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const spy = vi.spyOn(fake, 'recordPage');
    open(fake, w.spritey, '?page=99999999999');
    await screen.findByText('Nothing on this page.');
    expect(spy.mock.calls[0]![2]).toBe(10_000);
  });

  test('a record page is one recordPage read, with the kind and page the address names, and none of the reads it replaces', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const page = vi.spyOn(fake, 'recordPage');
    const names = ['characterCounts', 'characterActs', 'actsById', 'characters', 'classReveals', 'turnsAnnounced', 'characterReveals'] as const;
    const spies = names.map((n) => [n, vi.spyOn(fake, n)] as const);
    open(fake, w.spritey, '?kind=post');
    await screen.findByRole('table');
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0]).toEqual([w.spritey, 'post', 1]);
    expect(spies.map(([n, spy]) => [n, spy.mock.calls.length])).toEqual(names.map((n) => [n, 0]));
  });

  test('its whole page is in the first render, from the document, and nothing is read for it', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const boot = await fake.boot();
    const doc = (await fake.recordPage(w.spritey, 'all', 2))!;
    const read = holdReads(fake, ['session']);
    renderIn(fake, <RecordScreen id={w.spritey} doc={doc} />, { path: `/c/${w.spritey}/record?page=2`, boot });
    expect(screen.getByRole('heading', { level: 1, name: /Spritey.s public record/u })).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 3/u)).toBeInTheDocument();
    expect(dataRows().length).toBeGreaterThan(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(read).toEqual([]);
  });

  test('a character that does not exist is the router\'s "cannot be found"', async () => {
    const fake = buildWorld();
    world(fake);
    open(fake, 'nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'The page cannot be found' })).toBeInTheDocument();
  });
});
