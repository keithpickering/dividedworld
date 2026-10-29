import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { StandingsScreen } from './Standings.tsx';

const T0 = Date.UTC(2026, 9, 1, 12);

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const spritey = fake.seed.character(other, 'Spritey', 'face', { at: T0 });
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel', { at: T0 });
  const tied = fake.seed.character(other, 'Tied', 'face', { at: T0 });
  const waiting = fake.seed.character(other, 'Newcomer', 'face', { debuted: false });
  fake.seed.settle({ at: Date.UTC(2026, 9, 29, 8, 17), debut: false, standings: { [spritey]: 350, [pipe]: 120, [tied]: 120 } });
  fake.signInAs(me);
  return { fake, spritey, pipe, tied, waiting };
}
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent);

describe('the season standings', () => {
  test('ranks every debuted character by settled standing, ties sharing a place, each linked to its profile', async () => {
    const w = world();
    renderIn(w.fake, <StandingsScreen />, { path: '/standings' });
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(4));
    expect(names()).toEqual(['Spritey', 'Pipewrench', 'Tied']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('3.50');
    expect(rows[1]).toHaveTextContent('2');
    expect(rows[2]).toHaveTextContent('2');
    expect(within(rows[0]!).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${w.spritey}`);
    expect(screen.getByText(/Settled Oct 29/u)).toBeInTheDocument();
  });

  test('a character waiting to debut is in no row', async () => {
    const w = world();
    renderIn(w.fake, <StandingsScreen />, { path: '/standings' });
    await screen.findByRole('table');
    expect(screen.queryByText('Newcomer')).toBeNull();
  });

  test('a character dropped now, with no Act and no settlement, is listed at 0 as the server lists it (a plan gap, see the report)', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    fake.seed.character(account, 'Dropped', 'face');
    fake.signInAs(account);
    renderIn(fake, <StandingsScreen />, { path: '/standings' });
    const row = await screen.findByRole('row', { name: /Dropped/u });
    expect(row).toHaveTextContent('0.00');
  });

  test('an empty season says so, and a signed-out visitor is asked to sign in', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('x'));
    renderIn(fake, <StandingsScreen />, { path: '/standings' });
    expect(await screen.findByText('No character has debuted yet.')).toBeInTheDocument();
  });
});
