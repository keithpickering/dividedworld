import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { renderInWorld, testInstance } from '../test-world.tsx';
import { seedMoves } from '../board/move-world.ts';
import { IndexScreen } from './Index.tsx';

const T0 = Date.UTC(2026, 9, 20, 12);

beforeEach(() => localStorage.clear());

describe('the index', () => {
  test('lists the ordinary board and The System\'s, with its thread count, last post and read-only note', async () => {
    renderInWorld(<IndexScreen />, {
      seed: (f) => {
        const me = f.seed.account('me');
        const spritey = f.seed.character(f.seed.account('other'), 'Spritey', 'face', { at: T0 });
        f.seed.thread('general', spritey, 'One', 'x', { at: T0 });
        f.seed.thread('general', spritey, 'Two', 'x', { at: T0 + 1000 });
        f.seed.thread('the-system', null, 'The Bulletin', 'Tonight.', { at: T0 + 2000 });
        f.signInAs(me);
      },
    });
    const general = await screen.findByRole('link', { name: 'General' });
    expect(general).toHaveAttribute('href', '/b/general');
    const row = general.closest('tr')!;
    expect(row).toHaveTextContent('Anything.');
    expect(within(row).getByText('2', { selector: '.kb-num' })).toBeInTheDocument();
    expect(row).toHaveTextContent('Spritey');
    expect(within(row).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', expect.stringMatching(/^\/c\//u));
    /* WCAG 2.5.3: the time link's name starts with its visible text and says where it goes. */
    const latest = within(row).getByRole('link', { name: /latest post in General/u });
    expect(latest).not.toHaveAttribute('aria-label');
    expect(latest.textContent!.startsWith(latest.querySelector('time')!.textContent!)).toBe(true);
    const system = screen.getAllByRole('link', { name: 'The System' })[0]!.closest('tr')!;
    expect(system).toHaveTextContent('The System posts; you react and spin');
    expect(system).toHaveTextContent('The System');
    expect(screen.queryByText('NEW')).toBeNull();
  });

  test('a board with no threads has no last post', async () => {
    renderInWorld(<IndexScreen />, { seed: (f) => { f.signInAs(f.seed.account('me')); } });
    const row = (await screen.findByRole('link', { name: 'General' })).closest('tr')!;
    expect(row).toHaveTextContent('None yet');
  });

  test('a signed-out visitor sees the front door, not the index', async () => {
    renderInWorld(<IndexScreen />, { seed: () => {} });
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByText(/The board is for players\./u)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the index table keeps its roles in the phone layout', () => {
  test('rows and cells carry explicit roles', async () => {
    renderInWorld(<IndexScreen />, { seed: (f) => { f.signInAs(f.seed.account('me')); } });
    const row = (await screen.findByRole('link', { name: 'General' })).closest('tr')!;
    expect(row).toHaveAttribute('role', 'row');
    expect(row.querySelector('td')).toHaveAttribute('role', 'cell');
  });
});

describe('a board a move has renamed', () => {
  test('is listed by the name and description of the move in force, at the same address, and by its own again when the move ends', async () => {
    const { fake, seeded } = renderInWorld(<IndexScreen />, { seed: (f) => seedMoves(f, testInstance) });
    const renamed = await screen.findByRole('link', { name: 'Pointless Toast Palace' });
    expect(renamed).toHaveAttribute('href', '/b/general');
    expect(renamed.closest('tr')).toHaveTextContent('Welcome to the Pointless Toast Palace. Please butter responsibly.');
    expect(screen.queryByRole('link', { name: 'General' })).toBeNull();
    fake.seed.endMove(seeded.inForce, { why: 'reversed', by: 'admin' });
    expect((await fake.boards()).find((b) => b.slug === 'general')?.name).toBe('General');
  });
});

describe('who is online', () => {
  test('the index\'s foot holds "Who is online", with the window it counts', async () => {
    renderInWorld(<IndexScreen />, {
      seed: (f) => {
        const me = f.seed.account('me');
        f.seed.character(me, 'Spritey', 'face');
        f.signInAs(me);
      },
    });
    const box = await screen.findByRole('region', { name: 'Who is online' });
    expect(await within(box).findByRole('link', { name: 'Spritey' })).toBeInTheDocument();
    expect(box).toHaveTextContent('Characters active in the past 5 minutes');
  });
});
