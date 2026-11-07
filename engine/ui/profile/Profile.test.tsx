import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import { ProfileScreen } from './Profile.tsx';
import { LoadedProfile } from '../loaded.tsx';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 12);
const OCT3 = Date.UTC(2026, 9, 3, 12);
const OCT20 = Date.UTC(2026, 9, 20, 12);

/** A viewer, Pipewrench (class: heel, nothing made public) and Spritey, who has posted, spun and played a card. */
function world(fake: Fake) {
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const spritey = fake.seed.character(other, 'Spritey', 'face', { at: T0 });
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel', { at: T0 + DAY });
  const waiting = fake.seed.character(other, 'Newcomer', 'face', { debuted: false });
  const { thread, act } = fake.seed.thread('general', spritey, 'A long one', 'first', { at: T0 + 2 * DAY });
  for (let i = 0; i < 4; i++) fake.seed.post(thread, spritey, `reply ${i + 1} [b]bold[/b]`, { at: T0 + 3 * DAY + i * 3_600_000 });
  fake.seed.card(spritey, act, 'whoops', { at: T0 + 4 * DAY });
  fake.seed.post(thread, pipe, 'hello', { at: T0 + 5 * DAY });
  fake.seed.settle({ at: Date.UTC(2026, 9, 29, 8, 17), debut: false, standings: { [spritey]: 350, [pipe]: 120 } });
  fake.signInAs(me);
  return { me, other, spritey, pipe, waiting, thread, act };
}

/** The value cell of a fact's row, found by its row header. */
const fact = (within_: HTMLElement, label: string): HTMLElement => {
  const th = within(within_).getByRole('rowheader', { name: label });
  return th.closest('tr')!.querySelector('td:not(.kb-about-avatar)') as HTMLElement;
};

const open = (id: string, w?: Fake) => (w ? renderIn(w, <LoadedProfile id={id} />, { path: `/c/${id}` }) : null);

describe('the public profile', () => {
  test('its facts: name, title, rank, exact standing and when it settled, place, counts, month joined, signature', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.spritey, fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'Spritey' })).toBeInTheDocument();
    const facts = screen.getByRole('table', { name: 'About Spritey' });
    await waitFor(() => expect(facts).toHaveTextContent('Midcarder'));
    expect(within(facts).getByRole('img', { name: 'Rank 2 of 3: Midcarder' })).toBeInTheDocument();
    expect(fact(facts, 'Aura this season')).toHaveTextContent('3.50');
    expect(fact(facts, 'Aura this season')).toHaveTextContent(/settled Oct 29/u);
    expect(fact(facts, 'Place')).toHaveTextContent(/^1 of 2/u);
    expect(fact(facts, 'Posts')).toHaveTextContent(/^5$/u);
    expect(fact(facts, 'Threads spun')).toHaveTextContent(/^0$/u);
    expect(fact(facts, 'Cards played')).toHaveTextContent(/^1$/u);
    expect(fact(facts, 'Joined')).toHaveTextContent(/^Oct 2026$/u);
    expect(within(fact(facts, 'Place')).getByRole('link', { name: 'season standings' })).toHaveAttribute('href', '/season?tab=rankings');
  });

  test('each fact is a row of a table under an "About" band, its label a row header (Title, Rank, Aura this season, Place, Posts, Threads spun, Cards played, Joined, in that order)', async () => {
    const fake = buildWorld();
    const w = world(fake);
    await fake.setProfile(w.pipe, 'Level editor guy', '[i]posting in pencil[/i]', 'default');
    open(w.pipe, fake);
    const facts = await screen.findByRole('table', { name: 'About Pipewrench' });
    await waitFor(() => expect(facts).toHaveTextContent('Level editor guy'));
    await waitFor(() => expect(facts).toHaveTextContent('Aura this season'));
    const table = facts;
    expect(within(table).getByRole('columnheader', { name: 'About Pipewrench' })).toBeInTheDocument();
    /* The table is named once, by its band, with no caption beside it. */
    expect(table.querySelector('caption')).toBeNull();
    expect(table.querySelector('td.kb-about-avatar')).toHaveAttribute('role', 'presentation');
    const labels = within(table).getAllByRole('rowheader').map((h) => h.textContent);
    expect(labels).toEqual(['Title', 'Rank', 'Aura this season', 'Place', 'Posts', 'Threads spun', 'Cards played', 'Joined']);
    for (const h of within(table).getAllByRole('rowheader')) expect(h.closest('tr')!.querySelector('td:not(.kb-about-avatar)')).not.toBeNull();
    expect(fact(facts, 'Title')).toHaveTextContent('Level editor guy');
    /* The signature closes the card, in a row of its own under the facts. */
    const rows = within(table).getAllByRole('row');
    expect(rows[rows.length - 1]).toHaveTextContent('posting in pencil');
  });

  test('a fact absent stays absent: no Title row without a title, no Class row without a reveal, no Place before anything settled', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    const c = fake.seed.character(account, 'Fresh', 'face');
    fake.signInAs(account);
    open(c, fake);
    const facts = await screen.findByRole('table', { name: 'About Fresh' });
    await waitFor(() => expect(facts).toHaveTextContent('Nothing has settled for it yet'));
    const labels = within(facts).getAllByRole('rowheader').map((h) => h.textContent);
    expect(labels).not.toContain('Title');
    expect(labels).not.toContain('Class');
    expect(labels).not.toContain('Place');
  });

  test('a title and a signature, as the character set them', async () => {
    const fake = buildWorld();
    const w = world(fake);
    await fake.setProfile(w.pipe, 'Professional Wrench', '[i]i fix things[/i]', 'default');
    open(w.pipe, fake);
    const facts = await screen.findByRole('table', { name: 'About Pipewrench' });
    expect(facts).toHaveTextContent('Professional Wrench');
    expect((await within(facts).findByText('i fix things')).tagName).toBe('EM');
  });

  test('before anything has settled, says so and gives no standing', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    const c = fake.seed.character(account, 'Fresh', 'face');
    fake.signInAs(account);
    open(c, fake);
    const facts = await screen.findByRole('table', { name: 'About Fresh' });
    await waitFor(() => expect(facts).toHaveTextContent('Nothing has settled for it yet'));
  });

  test('a character that is waiting to debut, and one that does not exist, are the same page: the router\'s "cannot be found"', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.waiting, fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'The page cannot be found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'index' })).toHaveAttribute('href', '/');
    expect(await fake.profilePage(w.waiting)).toBeNull();
  });

  test('a signed-out visitor sees the front door', async () => {
    const fake = buildWorld();
    const w = world(fake);
    fake.signInAs(null);
    open(w.spritey, fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByText(/The board is for players\./u)).toBeNull();
  });
});

describe('the profile\'s record table', () => {
  test('names its roles outright, so the phone\'s block layout cannot drop them', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.pipe, fake);
    const region = await screen.findByRole('region', { name: 'Public record' });
    const table = await waitFor(() => { const t = region.querySelector('table'); expect(t).not.toBeNull(); return t!; });
    expect(table).toHaveAttribute('role', 'table');
    expect(table.querySelectorAll('thead[role="rowgroup"], tbody[role="rowgroup"]')).toHaveLength(2);
    expect(table.querySelectorAll('tr:not([role="row"]), th:not([role="columnheader"]), td:not([role="cell"])')).toHaveLength(0);
  });
});

describe('what the profile says of a class: only what its player made public', () => {
  test('a class its player never stated is nowhere on the page', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.pipe, fake);
    await screen.findByRole('heading', { level: 1, name: 'Pipewrench' });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Public record' })).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent(/Heel|Face|Jabroni/u);
  });

  test('the latest reveal is stated as of its date, and a later announced Turn says it has Turned since', async () => {
    const fake = buildWorld();
    const w = world(fake);
    fake.seed.reveal(w.pipe, w.thread, { class: 'heel', at: OCT3 });
    open(w.pipe, fake);
    const facts = await screen.findByRole('table', { name: 'About Pipewrench' });
    await waitFor(() => expect(facts).toHaveTextContent('Revealed: Heel (Oct 3)'));
    expect(facts).not.toHaveTextContent('Has Turned since');
  });

  test('a Turn announced after the reveal makes the statement out of date', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const sys = fake.seed.thread('announcements', null, 'Turns', '');
    fake.seed.reveal(w.pipe, w.thread, { class: 'heel', at: OCT3 });
    fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20 });
    open(w.pipe, fake);
    const facts = await screen.findByRole('table', { name: 'About Pipewrench' });
    await waitFor(() => expect(facts).toHaveTextContent('Revealed: Heel (Oct 3)'));
    expect(facts).toHaveTextContent('Has Turned since (Oct 20)');
  });

  test('the public record lists every reveal, and an announced Turn names the old class only if it was announced with it', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const sys = fake.seed.thread('announcements', null, 'Turns', '');
    fake.seed.reveal(w.pipe, w.thread, { class: 'face', at: OCT3 });
    // A tally written before #23 still says since when; the record never dates the old class.
    fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20, was: 'face', since: '2026-10-01T12:00:00Z' });
    fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20 + DAY });
    open(w.pipe, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    await waitFor(() => expect(record).toHaveTextContent('Revealed: Face'));
    expect(record).toHaveTextContent('Announced a Turn from Face');
    expect(record).not.toHaveTextContent('since');
    expect(record).toHaveTextContent(/Announced a Turn(?! from)/u);
    expect(record).not.toHaveTextContent('Heel');
  });
});

describe('the public record on the profile', () => {
  test('shows the latest few rows, newest first, and links to the full record', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.spritey, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    await waitFor(() => expect(within(record).getAllByRole('row').length).toBeGreaterThan(1));
    /* One table: the band ("Public record"), the heads (When, What), then at most five rows. */
    const rows = within(record).getAllByRole('row');
    expect(within(record).getAllByRole('table')).toHaveLength(1);
    expect(within(rows[0]!).getByRole('heading', { level: 2, name: 'Public record' })).toBeInTheDocument();
    expect(within(rows[1]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'What']);
    const body = rows.slice(2);
    expect(body.length).toBeLessThanOrEqual(5);
    expect(body[0]).toHaveTextContent('Played Whoops!');
    expect(within(record).getByRole('link', { name: 'See the full record' })).toHaveAttribute('href', `/c/${w.spritey}/record`);
  });

  test('a "Played" row links to the post the play landed on', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const target = fake.seed.post(w.thread, w.spritey, 'the target', { at: T0 + 5 * DAY });
    const seq = (await fake.actsById([target]))[0]!.seq!;
    fake.seed.card(w.spritey, target, 'whoops', { at: T0 + 6 * DAY });
    open(w.spritey, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    await waitFor(() => expect(record).toHaveTextContent('Played Whoops!'));
    expect(within(record).getAllByText(/Played Whoops!/u)[0]!.closest('a')).toHaveAttribute('href', threadHref(w.thread, pageOf(seq, 20), seq));
  });

  test('a character with nothing public yet says so', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    const c = fake.seed.character(account, 'Fresh', 'face');
    fake.signInAs(account);
    open(c, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    await waitFor(() => expect(record).toHaveTextContent('Nothing yet.'));
  });
});

describe('past seasons, announced Turns and the size of the season', () => {
  function withReveals(fake: Fake) {
    const w = world(fake);
    const sys = fake.seed.thread('announcements', null, 'Turns', '');
    const tally = fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20 });
    fake.seed.seasonResults(1, [{ character: w.pipe, place: 2, standing: 120 }], { at: OCT20 + DAY });
    return { ...w, sys: sys.thread, tally };
  }

  test('the place is of the whole season, from one count', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.spritey, fake);
    const facts = await screen.findByRole('table', { name: 'About Spritey' });
    await waitFor(() => expect(fact(facts, 'Place')).toHaveTextContent(/^1 of 2/u));
  });

  test('a past season is a row of the record that links to its row on Rankings', async () => {
    const fake = buildWorld();
    const w = withReveals(fake);
    open(w.pipe, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    const link = await within(record).findByRole('link', { name: 'Season 1: finished #2' });
    expect(link).toHaveAttribute('href', `/season?tab=rankings&season=1&character=${w.pipe}`);
  });

  test('an announced Turn links to its tally', async () => {
    const fake = buildWorld();
    const w = withReveals(fake);
    open(w.pipe, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    const link = await within(record).findByRole('link', { name: 'Announced a Turn' });
    expect(link).toHaveAttribute('href', `/t/${w.sys}?page=1#post-2`);
  });

  test('the profile is one profilePage read, and none of the reads it replaces', async () => {
    const fake = buildWorld();
    const w = withReveals(fake);
    const page = vi.spyOn(fake, 'profilePage');
    const names = ['actsById', 'standingPlace', 'characterActs', 'standingsPage', 'standingsCount', 'characterCounts', 'classReveals', 'turnsAnnounced', 'characters', 'lastSettledAt', 'season'] as const;
    const spies = names.map((n) => [n, vi.spyOn(fake, n)] as const);
    open(w.pipe, fake);
    await screen.findByRole('link', { name: 'Announced a Turn' });
    expect(page).toHaveBeenCalledTimes(1);
    expect(spies.map(([n, spy]) => [n, spy.mock.calls.length])).toEqual(names.map((n) => [n, 0]));
  });

  test('its whole page is in the first render, from the document, and nothing is read for it', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const boot = await fake.boot();
    const doc = (await fake.profilePage(w.spritey))!;
    const read = holdReads(fake, ['session']);
    renderIn(fake, <ProfileScreen id={w.spritey} doc={doc} />, { path: `/c/${w.spritey}`, boot });
    const facts = screen.getByRole('table', { name: 'About Spritey' });
    expect(facts).toHaveTextContent('Midcarder');
    expect(fact(facts, 'Posts')).toHaveTextContent(/^5$/u);
    expect(screen.getByRole('region', { name: 'Public record' })).toHaveTextContent('Posted:');
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(read).toEqual([]);
  });

});
