import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import { ProfileScreen } from './Profile.tsx';

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

const open = (id: string, w?: Fake) => (w ? renderIn(w, <ProfileScreen id={id} />, { path: `/c/${id}` }) : null);

describe('the public profile', () => {
  test('its facts: name, title, rank, exact standing and when it settled, place, counts, month joined, signature', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.spritey, fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'Spritey' })).toBeInTheDocument();
    const facts = screen.getByRole('region', { name: 'About Spritey' });
    await waitFor(() => expect(facts).toHaveTextContent('Midcarder'));
    expect(within(facts).getByRole('img', { name: 'Rank 2 of 3: Midcarder' })).toBeInTheDocument();
    expect(facts).toHaveTextContent('3.50');
    expect(facts).toHaveTextContent(/settled Oct 29/u);
    expect(facts).toHaveTextContent('Place 1');
    expect(facts).toHaveTextContent('Posts: 5');
    expect(facts).toHaveTextContent('Threads spun: 0');
    expect(facts).toHaveTextContent('Cards played: 1');
    expect(facts).toHaveTextContent('Joined Oct 2026');
    expect(within(facts).getByRole('link', { name: 'season standings' })).toHaveAttribute('href', '/standings');
  });

  test('a title and a signature, as the character set them', async () => {
    const fake = buildWorld();
    const w = world(fake);
    await fake.setProfile(w.pipe, 'Professional Wrench', '[i]i fix things[/i]', 'default');
    open(w.pipe, fake);
    const facts = await screen.findByRole('region', { name: 'About Pipewrench' });
    expect(facts).toHaveTextContent('Professional Wrench');
    expect((await within(facts).findByText('i fix things')).tagName).toBe('EM');
  });

  test('before anything has settled, says so and gives no standing', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    const c = fake.seed.character(account, 'Fresh', 'face');
    fake.signInAs(account);
    open(c, fake);
    const facts = await screen.findByRole('region', { name: 'About Fresh' });
    await waitFor(() => expect(facts).toHaveTextContent('Nothing has settled for it yet'));
  });

  test('a character that is waiting to debut, and one that does not exist, are the same page: not found', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.waiting, fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'No such character' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the index' })).toHaveAttribute('href', '/');
  });

  test('a signed-out visitor is asked to sign in', async () => {
    const fake = buildWorld();
    const w = world(fake);
    fake.signInAs(null);
    open(w.spritey, fake);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
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
    const facts = await screen.findByRole('region', { name: 'About Pipewrench' });
    await waitFor(() => expect(facts).toHaveTextContent('Revealed: Heel (Oct 3)'));
    expect(facts).not.toHaveTextContent('Has Turned since');
  });

  test('a Turn announced after the reveal makes the statement out of date', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const sys = fake.seed.thread('the-system', null, 'Turns', '');
    fake.seed.reveal(w.pipe, w.thread, { class: 'heel', at: OCT3 });
    fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20 });
    open(w.pipe, fake);
    const facts = await screen.findByRole('region', { name: 'About Pipewrench' });
    await waitFor(() => expect(facts).toHaveTextContent('Revealed: Heel (Oct 3)'));
    expect(facts).toHaveTextContent('Has Turned since (Oct 20)');
  });

  test('the public record lists every reveal, and an announced Turn names the old class only if it was announced with it', async () => {
    const fake = buildWorld();
    const w = world(fake);
    const sys = fake.seed.thread('the-system', null, 'Turns', '');
    fake.seed.reveal(w.pipe, w.thread, { class: 'face', at: OCT3 });
    fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20, was: 'face', since: '2026-10-01T12:00:00Z' });
    fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20 + DAY });
    open(w.pipe, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    await waitFor(() => expect(record).toHaveTextContent('Revealed: Face'));
    expect(record).toHaveTextContent('Announced a Turn from Face (since Oct 1)');
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
    const body = within(record).getAllByRole('row').slice(1);
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
    const sys = fake.seed.thread('the-system', null, 'Turns', '');
    const tally = fake.seed.announceTurn(w.pipe, sys.thread, { at: OCT20 });
    const reveal = fake.seed.post(sys.thread, null, '', {
      kind: 'reveal', at: OCT20 + DAY, payload: { season: 1, character: w.pipe, name: 'Pipewrench', place: 2, standing: 120, shown: [] },
    });
    return { ...w, sys: sys.thread, tally, reveal };
  }

  test('the place is of the whole season, from one count', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(w.spritey, fake);
    const facts = await screen.findByRole('region', { name: 'About Spritey' });
    await waitFor(() => expect(facts).toHaveTextContent('Place 1 of 2'));
  });

  test('a past season\'s reveal post is a row of the record that links to the post', async () => {
    const fake = buildWorld();
    const w = withReveals(fake);
    open(w.pipe, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    const link = await within(record).findByRole('link', { name: 'Season 1 reveal: finished #2' });
    expect(link).toHaveAttribute('href', `/t/${w.sys}?page=1#post-3`);
  });

  test('an announced Turn links to its tally', async () => {
    const fake = buildWorld();
    const w = withReveals(fake);
    open(w.pipe, fake);
    const record = await screen.findByRole('region', { name: 'Public record' });
    const link = await within(record).findByRole('link', { name: 'Announced a Turn' });
    expect(link).toHaveAttribute('href', `/t/${w.sys}?page=1#post-2`);
  });

  test('the profile reads these once, never once per row', async () => {
    const fake = buildWorld();
    const w = withReveals(fake);
    const by = vi.spyOn(fake, 'actsById');
    const rv = vi.spyOn(fake, 'characterReveals');
    const place = vi.spyOn(fake, 'standingPlace');
    const latest = vi.spyOn(fake, 'characterActs');
    const ranked = vi.spyOn(fake, 'standingsPage');
    const size = vi.spyOn(fake, 'standingsCount');
    open(w.pipe, fake);
    await screen.findByRole('link', { name: 'Announced a Turn' });
    expect(by).toHaveBeenCalledTimes(1);
    expect(rv).toHaveBeenCalledTimes(1);
    /* A profile's place is one call that counts index ranges: it never ranks the season or counts its characters. */
    expect(place).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(ranked).not.toHaveBeenCalled();
    expect(size).not.toHaveBeenCalled();
  });
});
