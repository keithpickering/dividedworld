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
    expect(within(card).getByText('Test Cores')).toBeInTheDocument();
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
    expect(fake).toBeTruthy();
  });
});

describe('a staff profile\'s career', () => {
  const led = (season: number, from: string, until: string | null, how: string) => ({ season, from, until, how });
  test('lists the seasons it led and the offices it held, newest first, in plain words', async () => {
    open('director', (f) => f.seed.career('director', {
      led: [led(2, '2026-02-01T00:00:00+00:00', '2026-03-29T00:00:00+00:00', 'rotation'), led(5, '2026-06-07T00:00:00+00:00', null, 'nomination')],
      offices: [{ office: 'mod', from: '2026-03-29T00:00:00+00:00', until: '2026-06-07T00:00:00+00:00', cause: 'handover' }],
    }));
    const career = await screen.findByRole('region', { name: 'Career' });
    const items = await within(career).findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Boss in Season 5, from 2026-06-07 until now, named by the Boss before it.');
    expect(items[1]).toHaveTextContent('Mod Bot from 2026-03-29 to 2026-06-07, at a handover.');
    expect(items[2]).toHaveTextContent('Boss in Season 2, from 2026-02-01 to 2026-03-29 (8 weeks), by rotation.');
  });
  test('says plainly that a persona that never served has no career, and keeps another persona\'s seasons out of it', async () => {
    open('bot', (f) => f.seed.career('director', { led: [led(1, '2026-01-01T00:00:00+00:00', null, 'seed')], offices: [] }));
    const career = await screen.findByRole('region', { name: 'Career' });
    await waitFor(() => expect(career).toHaveTextContent('No office held yet.'));
    expect(career).not.toHaveTextContent('Season 1');
    expect(within(career).queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('a Mod Bot\'s profile', () => {
  test('is the same screen with a MODERATOR badge and its own title, and says plainly that its log is empty until it makes its visits', async () => {
    open('bot');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hall Monitor' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'About Hall Monitor' });
    expect(within(card).getByText('MODERATOR')).toBeInTheDocument();
    expect(within(card).getByText('Test Cores')).toBeInTheDocument();
    expect(within(card).queryByText('ADMINISTRATOR')).toBeNull();
    expect(card).toHaveTextContent('Keeper of the Hall');
    expect(await screen.findByText(/Nothing here yet\. A Mod Bot's moderation log stays empty until Mod Bots start their visits\./u)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Moderation log, newest first' })).toBeNull();
  });
});

describe('a member or benched persona\'s profile', () => {
  test.each(['member', 'benched'] as const)('a %s shows the group chip and no office title', async (office) => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('reader'));
    const id = fake.seed.staff(`p-${office}`, 'Backup Persona', office, { title: 'Understudy', at: fake.clock.now() - 86_400_000 });
    renderIn(fake, <ProfileScreen id={id} />, { path: `/c/${id}` });
    await screen.findByRole('heading', { level: 1, name: 'Backup Persona' });
    const card = await screen.findByRole('region', { name: 'About Backup Persona' });
    expect(within(card).getByText('Test Cores')).toBeInTheDocument();
    expect(within(card).queryByText('ADMINISTRATOR')).toBeNull();
    expect(within(card).queryByText('MODERATOR')).toBeNull();
  });
});

describe('the career\'s loading and failure', () => {
  test('a failed load is announced in an alert region', async () => {
    open('director', (f) => { f.staffCareer = () => Promise.reject(new Error('down')); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Its career could not be loaded');
    expect(within(screen.getByRole('region', { name: 'Career' })).getByRole('alert')).toBe(alert);
  });
  test('loading is announced in a status region, and goes when the career arrives', async () => {
    let arrive!: () => void;
    open('director', (f) => { f.staffCareer = () => new Promise((res) => { arrive = () => res({ led: [], offices: [] }); }); });
    const career = await screen.findByRole('region', { name: 'Career' });
    expect(within(career).getByRole('status')).toHaveTextContent('Reading the career');
    arrive();
    await waitFor(() => expect(within(career).getByRole('status')).toBeEmptyDOMElement());
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

describe('a Boss\'s log after a handover', () => {
  const DAY = 86_400_000;
  test('says who keeps a move it wrote, and that the others ended at the handover', async () => {
    open('director', (fake, world) => {
      fake.seed.staff('the-clerk', 'The Clerk', 'boss', { title: 'Keeper of Forms' });
      fake.seed.keepMove(world.inForce, 'the-clerk', { at: fake.clock.now() - 3_600_000 });
      const aside = fake.seed.move('director', { board: world.general, name: 'Set Aside Alley', at: fake.clock.now() - 2 * DAY });
      fake.seed.endMove(aside, { why: 'superseded', by: 'boss', at: fake.clock.now() - DAY });
      const forgotten = fake.seed.move('director', { board: world.second, name: 'Forgotten Fen Place', at: fake.clock.now() - 3 * DAY });
      fake.seed.endMove(forgotten, { why: 'superseded', by: 'inheritance', at: fake.clock.now() - 2 * DAY });
    });
    await waitFor(async () => expect(await rows()).toHaveLength(6));
    const all = await rows();
    const byName = (name: string) => all.find((r) => within(r).queryByText(new RegExp(name, 'u')) !== null || r.textContent?.includes(name))!;
    expect(within(byName('Pointless Toast Palace')).getAllByRole('cell').at(-1)).toHaveTextContent('in force, kept by The Clerk');
    expect(within(byName('Set Aside Alley')).getAllByRole('cell').at(-1)).toHaveTextContent('ended at the handover');
    expect(within(byName('Forgotten Fen Place')).getAllByRole('cell').at(-1)).toHaveTextContent('ended at the handover');
  });

  test('names a keeper who has not debuted in plain words to a non-admin, never its key', async () => {
    open('director', (fake, world) => {
      fake.seed.staff('the-waiting', 'Waiting Persona', 'member', { debuted: false });
      fake.seed.keepMove(world.inForce, 'the-waiting', { at: fake.clock.now() - 3_600_000 });
    });
    await waitFor(async () => expect(await rows()).toHaveLength(4));
    const text = (await log()).textContent ?? '';
    expect(text).toContain('kept by a Boss who has not been introduced');
    expect(text).not.toContain('the-waiting');
    expect(text).not.toContain('Waiting Persona');
  });

});
