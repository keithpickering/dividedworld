import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { seedMoves } from '../board/move-world.ts';
import { MOVES_LOG_PAGE } from '../data/api.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ProfileScreen } from './Profile.tsx';

beforeEach(() => localStorage.clear());

function open(who: 'director' | 'bot' | 'spritey', build?: (fake: ReturnType<typeof buildWorld>, w: ReturnType<typeof seedMoves>) => void) {
  const fake = buildWorld();
  const w = seedMoves(fake, testInstance);
  build?.(fake, w);
  const id = { director: w.director, bot: w.bot, spritey: w.spritey }[who];
  renderIn(fake, <ProfileScreen id={id} />, { path: `/c/${id}` });
  return { fake, w };
}

const log = () => screen.findByRole('table', { name: 'Moderation log, newest first' });
const rows = async () => within(await log()).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0);

describe('a Boss\'s profile', () => {
  test('is the ordinary profile with an admin\'s fields: name, an ADMINISTRATOR badge, its title and the table the Boss wrote about itself', async () => {
    const { w } = open('director');
    expect(await screen.findByRole('heading', { level: 1, name: 'The Director' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'About The Director' });
    expect(within(card).getByText('ADMINISTRATOR')).toBeInTheDocument();
    expect(card).toHaveTextContent('Head of Board Operations (Toast Division)');
    const table = await within(card).findByRole('table', { name: 'About The Director, in its own words' });
    const row = (name: string) => within(table).getByRole('rowheader', { name }).closest('tr')!;
    expect(row('Interests')).toHaveTextContent('toast, artisanal breads, the 1998 film Small Soldiers (since Tuesday)');
    expect(within(row('Favorite Members')).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${w.spritey}`);
    expect(within(row('Favorite Members')).getByRole('link', { name: 'Pipewrench' })).toHaveAttribute('href', `/c/${w.pipewrench}`);
    expect(row('Current Mood')).toHaveTextContent('Disappointed but Hopeful');
    expect(row('Posts')).toHaveTextContent(/^Posts0/u);
    expect(card).toHaveTextContent('A forum is like a loaf of bread. Somebody has to slice it.');
    expect(card).toHaveTextContent('what it says about itself, in character, and it may bluff');
  });

  test('has no standing, no class and no season record', async () => {
    open('director');
    await screen.findByRole('heading', { level: 1, name: 'The Director' });
    await log();
    expect(screen.queryByText(/Aura this season/u)).toBeNull();
    expect(screen.queryByText(/Place \d/u)).toBeNull();
    expect(screen.queryByText(/Nothing has settled/u)).toBeNull();
    expect(screen.queryByText(/Revealed:/u)).toBeNull();
    expect(screen.queryByRole('img', { name: /^Rank / })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Public record' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'season standings' })).toBeNull();
  });

  test('shows its moderation log beside it: each move\'s date, what was done with links to the boards, and how it ended, newest first', async () => {
    const { w } = open('director');
    await waitFor(async () => expect(await rows()).toHaveLength(4));
    const [inForce, met, expired, reversed] = await rows();
    expect(inForce).toHaveTextContent('Renamed General to Pointless Toast Palace');
    expect(within(inForce!).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([`/b/${w.general}`, `/b/${w.general}`]);
    expect(within(inForce!).getAllByRole('cell').at(-1)).toHaveTextContent('in force');
    expect(met).toHaveTextContent('Renamed Off Topic to Lawn Bowling Lounge');
    expect(within(met!).getAllByRole('cell').at(-1)).toHaveTextContent('undone: 12 posted');
    expect(expired).toHaveTextContent('Renamed General to Pirate Puns Palace');
    expect(within(expired!).getAllByRole('cell').at(-1)).toHaveTextContent(/^ran out Oct \d+$/u);
    expect(reversed).toHaveTextContent('Renamed Off Topic to Small Soldiers Situation Room');
    expect(within(reversed!).getAllByRole('cell').at(-1)).toHaveTextContent('reversed by an admin');
    expect(within(inForce!).getAllByRole('cell')[0]).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}$/u);
    expect(screen.getByText(/Every move this staff member has made, newest first\./u)).toBeInTheDocument();
  });

  test('pages its log by keyset: Older shows the next page after the last row, and goes when nothing older is left', async () => {
    const { fake, w } = open('director', (f, world) => {
      for (let i = 0; i < 20; i++) f.seed.move('director', { board: world.second, name: `Old Hall ${String(i).padStart(2, '0')}`, at: f.clock.now() - (30 + i) * 86_400_000, expiresAt: f.clock.now() - 20 * 86_400_000 });
    });
    await waitFor(async () => expect(await rows()).toHaveLength(MOVES_LOG_PAGE));
    const older = screen.getByRole('button', { name: /^Older/u });
    await userEvent.click(older);
    await waitFor(async () => expect(await rows()).toHaveLength(24));
    expect((await rows()).at(-1)).toHaveTextContent('Old Hall 19');
    expect(screen.queryByRole('button', { name: /^Older/u })).toBeNull();
    expect(w.director).toBeTruthy();
    expect(fake).toBeTruthy();
  });
});

describe('a Mod Bot\'s profile', () => {
  test('is the same screen with a MODERATOR badge and its own title, and says plainly that its log is empty until it makes its visits', async () => {
    open('bot');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hall Monitor' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'About Hall Monitor' });
    expect(within(card).getByText('MODERATOR')).toBeInTheDocument();
    expect(within(card).queryByText('ADMINISTRATOR')).toBeNull();
    expect(card).toHaveTextContent('Keeper of the Hall');
    expect(await screen.findByText(/Nothing here yet\. A Mod Bot's moderation log stays empty until Mod Bots start their visits\./u)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Moderation log, newest first' })).toBeNull();
  });
});

describe('an ordinary character\'s profile', () => {
  test('has no badge and no moderation log', async () => {
    open('spritey');
    await screen.findByRole('heading', { level: 1, name: 'Spritey' });
    await waitFor(() => expect(screen.getByRole('region', { name: 'About Spritey' })).toHaveTextContent('Posts:'));
    expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
    expect(screen.queryByText('MODERATOR')).toBeNull();
    expect(screen.queryByText(/Moderation log/u)).toBeNull();
  });
});
