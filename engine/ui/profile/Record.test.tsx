import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { RecordScreen } from './Record.tsx';

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
const open = (fake: Fake, id: string, query = '') => renderIn(fake, <RecordScreen id={id} />, { path: `/c/${id}/record${query}` });
const dataRows = () => screen.getAllByRole('row').slice(1);

describe('the full public record', () => {
  test('pages twenty to a page, newest first, and says which page', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey);
    expect(await screen.findByRole('heading', { level: 1, name: 'Spritey’s public record' })).toBeInTheDocument();
    await waitFor(() => expect(dataRows()).toHaveLength(20));
    expect(dataRows()[0]).toHaveTextContent('Played Whoops!');
    expect(screen.getByText(/Page 1 of 3/u)).toBeInTheDocument();
  });

  test('?page=3 shows the rest, and the pager links by keyboard', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?page=3');
    await waitFor(() => expect(dataRows()).toHaveLength(6));
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

  test('a page past the end, or a waiting character, is plain', async () => {
    const fake = buildWorld();
    const w = world(fake);
    open(fake, w.spritey, '?page=99');
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First page' })).toBeInTheDocument();
  });

  test('a character that does not exist is not found', async () => {
    const fake = buildWorld();
    world(fake);
    open(fake, 'nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'No such character' })).toBeInTheDocument();
    void within;
  });
});
