import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, holdReads, renderIn, testInstance } from '../test-world.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Instance } from '../../rules/types.ts';
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

describe('the pronouns line', () => {
  test('a default character shows it/its, a custom set shows xe/xem, in a Pronouns row of its facts', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const plain = fake.seed.character(fake.seed.account('a'), 'Plain', 'face');
    const xe = fake.seed.character(fake.seed.account('b'), 'Xenia', 'face', { pronouns: { subject: 'xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: false } });
    fake.signInAs(me);
    const first = renderIn(fake, <LoadedProfile id={plain} />, { path: `/c/${plain}` });
    expect(await screen.findByText('it/its')).toHaveClass('kb-profile-pronouns', 'kb-muted');
    expect(screen.getByRole('rowheader', { name: 'Pronouns' }).closest('tr')).toHaveTextContent('it/its');
    first.unmount();
    renderIn(fake, <LoadedProfile id={xe} />, { path: `/c/${xe}` });
    expect(await screen.findByText('xe/xem')).toHaveClass('kb-profile-pronouns', 'kb-muted');
    expect(screen.getByRole('rowheader', { name: 'Pronouns' }).closest('tr')).toHaveTextContent('xe/xem');
  });
});

describe('the public profile', () => {
  test('a character at 0 Aura or below has no place this season: its Place says unplaced, never a number (#492)', async () => {
    const fake = buildWorld();
    const w = world(fake);
    fake.seed.settle({ at: Date.UTC(2026, 9, 30, 8), debut: false, standings: { [w.pipe]: 0 } });
    open(w.pipe, fake);
    const facts = await screen.findByRole('table', { name: 'About Pipewrench' });
    await waitFor(() => expect(fact(facts, 'Aura this season')).toHaveTextContent('0.00'));
    expect(fact(facts, 'Place')).toHaveTextContent(/^Unplaced \(a place needs Aura above 0\) in season/u);
    expect(fact(facts, 'Place')).not.toHaveTextContent(/\d of \d/u);
  });

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

  test('each fact is a row of a table under an "About" band, its label a row header (Title, Rank, Group, Pronouns, Aura this season, Place, Posts, Threads spun, Cards played, Joined, in that order)', async () => {
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
    expect(labels).toEqual(['Title', 'Rank', 'Group', 'Pronouns', 'Aura this season', 'Place', 'Posts', 'Threads spun', 'Cards played', 'Joined']);
    for (const h of within(table).getAllByRole('rowheader')) expect(h.closest('tr')!.querySelector('td:not(.kb-about-avatar)')).not.toBeNull();
    expect(fact(facts, 'Title')).toHaveTextContent('Level editor guy');
    expect(fact(facts, 'Group').querySelector('.kb-group-bar')).toHaveTextContent('Members');
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
    const c = fake.seed.character(account, 'Fresh', 'face', { pronouns: PRONOUN_PRESETS.she });
    fake.signInAs(account);
    open(c, fake);
    const facts = await screen.findByRole('table', { name: 'About Fresh' });
    await waitFor(() => expect(facts).toHaveTextContent('Nothing has settled for her yet'));
  });

  test('a character that is waiting to debut, and one that does not exist, are the same page: the router\'s "cannot be found"', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.waiting, fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'The character you requested does not exist.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Click here to return to the index' })).toHaveAttribute('href', '/');
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
    /* The trophy case is not in the document (it carries only the shown few): the case is read once the page stands, and nothing else is. */
    const read = holdReads(fake, ['session', 'trophies', 'beltLineage']);
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

describe('the Wearing row and the trophy case', () => {
  const shop: Instance = {
    ...testInstance,
    gear: [
      { key: 'band', name: 'Headband', line: 'Holds a thought in place.', rarity: 'common' },
      { key: 'tall', name: 'Tall Hat', line: 'Taller than it needs to be.', rarity: 'rare' },
    ],
    trophies: { kinds: [...testInstance.trophies.kinds, { key: 'belt', name: 'Test Belt', belt: true }], seasonPlaces: ['p1', 'p2', 'p3'], boss: ['belt'], demandMet: 'met' },
  };
  const piece = (gear: string, layer: number) => ({ gear, x: 0.5, y: 0.2, w: 0.5, turn: 0, layer });
  async function dressed() {
    const fake = buildWorld(undefined, shop);
    const owner = fake.seed.account('owner');
    const spritey = fake.seed.character(owner, 'Spritey', 'face', { at: T0 });
    const rival = fake.seed.character(fake.seed.account('rival'), 'Sock Puppet', 'heel', { at: T0 });
    fake.seed.avatar(spritey, { square: 'https://img.test/s.webp', portrait: 'https://img.test/s-tall.webp' });
    fake.seed.gear(owner, { band: 1, tall: 1 });
    fake.signInAs(owner);
    /* Placed tall hat first and headband second, but layers say headband (0) then hat (1) after the sort. */
    expect((await fake.setOutfit(spritey, [piece('tall', 1), piece('band', 0)])).ok).toBe(true);
    return { fake, spritey, rival };
  }

  test('"Wearing" lists the outfit in layer order, by the gear\'s name in words', async () => {
    const { fake, spritey } = await dressed();
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const facts = await screen.findByRole('table', { name: 'About Spritey' });
    expect(fact(facts, 'Wearing')).toHaveTextContent('Headband, Tall Hat');
  });

  test('a character wearing nothing has no Wearing row', async () => {
    const fake = buildWorld(undefined, shop);
    const bare = fake.seed.character(fake.seed.account('a'), 'Bare', 'face', { at: T0 });
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <LoadedProfile id={bare} />, { path: `/c/${bare}`, instance: shop });
    const facts = await screen.findByRole('table', { name: 'About Bare' });
    expect(within(facts).queryByRole('rowheader', { name: 'Wearing' })).toBeNull();
  });

  test('the case is newest first, each with its giver in plain words, "an admin" and never an account', async () => {
    const { fake, spritey } = await dressed();
    fake.seed.award(spritey, 'p1', { at: Date.UTC(2026, 9, 21, 12), by: 'admin', line: 'Best walk cycle.' });
    fake.seed.award(spritey, 'met', { at: Date.UTC(2026, 9, 14, 12), by: 'demand' });
    fake.seed.award(spritey, 'p2', { at: Date.UTC(2026, 9, 29, 12), by: 'season' });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const table = await screen.findByRole('table', { name: /trophies/iu });
    const rows = within(table).getAllByRole('row').filter((r) => r.querySelector('td.kb-trophy-what'));
    expect(rows.map((r) => r.querySelector('.kb-trophy-name')!.textContent)).toEqual(['P2', 'P1', 'Met']);
    expect(rows[1]).toHaveTextContent('Best walk cycle.');
    expect(rows[1]).toHaveTextContent('Given by an admin, Oct 21');
    expect(rows[0]).toHaveTextContent('Given by the season');
    expect(table).not.toHaveTextContent(/owner|account/iu);
    expect(within(rows[1]!).getByAltText('P1')).toHaveAttribute('title', 'P1');
  });

  test('a reversed award is not in the case', async () => {
    const { fake, spritey } = await dressed();
    const id = fake.seed.award(spritey, 'p1', { by: 'admin' });
    fake.seed.award(spritey, 'p2', { by: 'admin' });
    const admin = fake.seed.account('boss', { admin: true });
    fake.signInAs(admin);
    expect((await fake.reverseAward(id)).ok).toBe(true);
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const table = await screen.findByRole('table', { name: /trophies/iu });
    expect(table).toHaveTextContent('P2');
    expect(table).not.toHaveTextContent('P1');
  });

  test('"More" pages the case with the cursor, and the page before stays', async () => {
    const { fake, spritey } = await dressed();
    for (let i = 0; i < 52; i++) fake.seed.award(spritey, 'p1', { at: T0 + i * 3_600_000, by: 'admin' });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const table = await screen.findByRole('table', { name: /trophies/iu });
    expect(table.querySelectorAll('td.kb-trophy-what')).toHaveLength(50);
    act(() => screen.getByRole('button', { name: 'More trophies' }).click());
    await waitFor(() => expect(table.querySelectorAll('td.kb-trophy-what')).toHaveLength(52));
    expect(screen.queryByRole('button', { name: 'More trophies' })).toBeNull();
  });

  test('a belt whose name begins with "The" is not given a second one in its lineage heading', async () => {
    const the: Instance = { ...shop, trophies: { ...shop.trophies, kinds: shop.trophies.kinds.map((k) => (k.key === 'belt' ? { ...k, name: 'The Test Belt' } : k)) } };
    const fake = buildWorld(undefined, the);
    const spritey = fake.seed.character(fake.seed.account('owner'), 'Spritey', 'face', { at: T0 });
    fake.seed.award(spritey, 'belt', { at: Date.UTC(2026, 10, 2, 12), by: 'boss' });
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: the });
    expect(await screen.findByRole('heading', { name: "The Test Belt's lineage" })).toBeInTheDocument();
  });

  test('a belt\'s lineage is under the case, newest holder first, each holder a link', async () => {
    const { fake, spritey, rival } = await dressed();
    fake.seed.award(rival, 'belt', { at: Date.UTC(2026, 9, 9, 12), by: 'admin' });
    fake.seed.award(spritey, 'belt', { at: Date.UTC(2026, 10, 2, 12), by: 'boss' });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const lineage = await screen.findByRole('table', { name: /Test Belt.*holders/iu });
    const rows = within(lineage).getAllByRole('row').filter((r) => r.querySelector('td.kb-lineage-span'));
    expect(rows.map((r) => r.querySelector('a')!.textContent)).toEqual(['Spritey', 'Sock Puppet']);
    expect(rows[0]).toHaveTextContent('Nov 2 – now');
    expect(rows[1]).toHaveTextContent(/Oct 9 – Nov 2/u);
    expect(within(rows[0]!).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${spritey}`);
  });

  test('an award links to the move or the season it came from, and an admin\'s links nowhere', async () => {
    const { fake, spritey } = await dressed();
    fake.seed.staff('sighbot', 'Sighbot', 'boss');
    const move = fake.seed.trophyMove('sighbot', { character: spritey, trophy: 'belt' });
    const anno = fake.seed.trophyMove('sighbot', { character: spritey, trophy: 'met' });
    fake.seed.award(spritey, 'belt', { at: Date.UTC(2026, 9, 21, 12), by: 'boss', move });
    fake.seed.award(spritey, 'met', { at: Date.UTC(2026, 9, 14, 12), by: 'demand', move: anno });
    fake.seed.award(spritey, 'p2', { at: Date.UTC(2026, 9, 29, 12), by: 'season' });
    fake.seed.award(spritey, 'p1', { at: Date.UTC(2026, 9, 30, 12), by: 'admin' });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const table = await screen.findByRole('table', { name: /trophies/iu });
    const row = (name: string) => within(table).getAllByRole('row').find((r) => r.querySelector('.kb-trophy-name')?.textContent === name)!;
    const post = within(row('Test Belt')).getByRole('link', { name: 'its post' });
    expect(post.getAttribute('href')).toMatch(new RegExp(`^/t/[^#?]+#post-\\d+$`, 'u'));
    expect(row('Test Belt')).toHaveTextContent('Given by Sighbot, the Boss, Oct 21');
    expect(within(row('Met')).getByRole('link', { name: 'the move' }).getAttribute('href')).toMatch(/^\/t\//u);
    expect(within(row('P2')).getByRole('link', { name: 'season 1' })).toHaveAttribute('href', '/season?tab=rankings&season=1');
    expect(within(row('P1')).queryByRole('link')).toBeNull();
  });

  test('the case says which trophies the mask shows on posts, and a held belt since when', async () => {
    const { fake, spritey } = await dressed();
    const chosen = fake.seed.award(spritey, 'p1', { at: Date.UTC(2026, 9, 21, 12), by: 'admin' });
    fake.seed.award(spritey, 'p2', { at: Date.UTC(2026, 9, 20, 12), by: 'admin' });
    fake.seed.award(spritey, 'belt', { at: Date.UTC(2026, 10, 2, 12), by: 'admin' });
    expect((await fake.showTrophies(spritey, [chosen])).ok).toBe(true);
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const table = await screen.findByRole('table', { name: /trophies/iu });
    const row = (name: string) => within(table).getAllByRole('row').find((r) => r.querySelector('.kb-trophy-name')?.textContent === name)!;
    expect(row('Test Belt')).toHaveTextContent('champion since Nov 2');
    expect(row('Test Belt').querySelector('td.kb-trophy-shown')).toHaveTextContent('On posts');
    expect(row('P1').querySelector('td.kb-trophy-shown')).toHaveTextContent('On posts');
    expect(row('P2').querySelector('td.kb-trophy-shown')).toBeEmptyDOMElement();
    expect(row('P2')).not.toHaveTextContent('champion since');
  });

  test('a lineage row says how its reign began, and earlier holders come by a button from the cursor', async () => {
    const { fake, spritey, rival } = await dressed();
    fake.seed.staff('sighbot', 'Sighbot', 'boss');
    for (let i = 0; i < 22; i++) fake.seed.award(i % 2 ? spritey : rival, 'belt', { at: Date.UTC(2026, 8, 1) + i * 86_400_000, by: i === 0 ? 'admin' : 'boss' });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const lineage = await screen.findByRole('table', { name: /Test Belt.*holders/iu });
    const rows = () => within(lineage).getAllByRole('row').filter((r) => r.querySelector('td.kb-lineage-span'));
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toHaveTextContent('by Sighbot, the Boss');
    act(() => screen.getByRole('button', { name: 'Earlier holders' }).click());
    await waitFor(() => expect(rows()).toHaveLength(22));
    expect(rows()[21]).toHaveTextContent('by an admin');
    expect(screen.queryByRole('button', { name: 'Earlier holders' })).toBeNull();
  });

  test('a lineage still loading when "More trophies" is pressed still shows', async () => {
    const { fake, spritey } = await dressed();
    for (let i = 0; i < 52; i++) fake.seed.award(spritey, 'p1', { at: T0 + i * 3_600_000, by: 'admin' });
    fake.seed.award(spritey, 'belt', { at: T0 + 100 * 3_600_000, by: 'admin' });
    const real = fake.beltLineage.bind(fake);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(fake, 'beltLineage').mockImplementation(async (...args) => { await gate; return real(...args); });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const more = await screen.findByRole('button', { name: 'More trophies' });
    act(() => more.click());
    await waitFor(() => expect(screen.getByRole('table', { name: /trophies/iu }).querySelectorAll('td.kb-trophy-what')).toHaveLength(53));
    release();
    expect(await screen.findByRole('table', { name: /Test Belt.*holders/iu })).toBeInTheDocument();
  });

  test('a failed older page, first lineage read and earlier-holders read each say so and offer "Try again"', async () => {
    const { fake, spritey, rival } = await dressed();
    for (let i = 0; i < 52; i++) fake.seed.award(spritey, 'p1', { at: T0 + i * 3_600_000, by: 'admin' });
    for (let i = 0; i < 22; i++) fake.seed.award(i % 2 ? spritey : rival, 'belt', { at: T0 + 200 * 3_600_000 + i * 3_600_000, by: 'admin' });
    const trophies = vi.spyOn(fake, 'trophies');
    const lineage = vi.spyOn(fake, 'beltLineage');
    lineage.mockRejectedValueOnce(new Error('down'));
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    /* The first lineage read fails: a sentence, then the read again. */
    const sentence = await screen.findByText(/lineage could not be read/iu);
    act(() => within(sentence.parentElement!).getByRole('button', { name: 'Try again' }).click());
    const table = await screen.findByRole('table', { name: /Test Belt.*holders/iu });
    const rows = () => within(table).getAllByRole('row').filter((r) => r.querySelector('td.kb-lineage-span'));
    expect(rows()).toHaveLength(20);
    /* Earlier holders fails: a sentence, the reigns kept, then it comes. */
    lineage.mockRejectedValueOnce(new Error('down'));
    act(() => screen.getByRole('button', { name: 'Earlier holders' }).click());
    await screen.findByText(/earlier holders could not be read/iu);
    expect(rows()).toHaveLength(20);
    act(() => screen.getByRole('button', { name: 'Try again' }).click());
    await waitFor(() => expect(rows()).toHaveLength(22));
    /* The older page fails: a sentence, then it comes. */
    trophies.mockRejectedValueOnce(new Error('down'));
    act(() => screen.getByRole('button', { name: 'More trophies' }).click());
    const older = await screen.findByText(/earlier trophies could not be read/iu);
    act(() => within(older.parentElement!).getByRole('button', { name: 'Try again' }).click());
    await waitFor(() => expect(screen.queryByText(/earlier trophies could not be read/iu)).toBeNull());
    await waitFor(() => expect(screen.getAllByRole('table', { name: /trophies/iu })[0]!.querySelectorAll('td.kb-trophy-what').length).toBeGreaterThan(50));
  });

  test('"Try again" on the first page reads once however often it is pressed', async () => {
    const { fake, spritey } = await dressed();
    fake.seed.award(spritey, 'p1', { by: 'admin' });
    const trophies = vi.spyOn(fake, 'trophies');
    trophies.mockRejectedValueOnce(new Error('down'));
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    const again = await screen.findByRole('button', { name: 'Try again' });
    act(() => { again.click(); again.click(); });
    await screen.findByRole('table', { name: /trophies/iu });
    expect(trophies).toHaveBeenCalledTimes(2);
  });

  test('passes axe with the row, the case and a lineage drawn', async () => {
    const { fake, spritey } = await dressed();
    fake.seed.award(spritey, 'belt', { by: 'boss' });
    fake.seed.award(spritey, 'p1', { by: 'admin' });
    renderIn(fake, <LoadedProfile id={spritey} />, { path: `/c/${spritey}`, instance: shop });
    await screen.findByRole('table', { name: /Test Belt.*holders/iu });
    const bad = await axeViolations(document.body);
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});
