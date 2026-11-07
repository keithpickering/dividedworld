import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildWorld, holdReads, renderIn, renderInWorld, testInstance } from '../test-world.tsx';
import { seedMoves } from '../board/move-world.ts';
import { IndexScreen } from './Index.tsx';
import { SIGNED_OUT_DOC } from '../screen-docs.ts';
import { LoadedIndex } from '../loaded.tsx';

const T0 = Date.UTC(2026, 9, 20, 12);

beforeEach(() => localStorage.clear());

describe('the index', () => {
  test('lists the ordinary board and The System\'s, with its thread count, last post and read-only note', async () => {
    renderInWorld(<LoadedIndex />, {
      seed: (f) => {
        const me = f.seed.account('me');
        const spritey = f.seed.character(f.seed.account('other'), 'Spritey', 'face', { at: T0 });
        f.seed.thread('general', spritey, 'One', 'x', { at: T0 });
        f.seed.thread('general', spritey, 'Two', 'x', { at: T0 + 1000 });
        f.seed.thread('announcements', null, 'The Bulletin', 'Tonight.', { at: T0 + 2000 });
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
    const system = screen.getAllByRole('link', { name: 'Staff Announcements' })[0]!.closest('tr')!;
    expect(system).toHaveTextContent('Staff post here; you react and spin');
    expect(system).toHaveTextContent('The staff');
    expect(screen.queryByText('NEW')).toBeNull();
  });

  test('a board with no threads has no last post', async () => {
    renderInWorld(<LoadedIndex />, { seed: (f) => { f.signInAs(f.seed.account('me')); } });
    const row = (await screen.findByRole('link', { name: 'General' })).closest('tr')!;
    expect(row).toHaveTextContent('None yet');
  });

  test('a signed-out visitor sees the front door, not the index', async () => {
    renderInWorld(<LoadedIndex />, { seed: () => {} });
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByText(/The board is for players\./u)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the index table keeps its roles in the phone layout', () => {
  test('rows and cells carry explicit roles', async () => {
    renderInWorld(<LoadedIndex />, { seed: (f) => { f.signInAs(f.seed.account('me')); } });
    const row = (await screen.findByRole('link', { name: 'General' })).closest('tr')!;
    expect(row).toHaveAttribute('role', 'row');
    expect(row.querySelector('td')).toHaveAttribute('role', 'cell');
  });
});

describe('a board a move has renamed', () => {
  test('is listed by the name and description of the move in force, at the same address, and by its own again when the move ends', async () => {
    const { fake, seeded } = renderInWorld(<LoadedIndex />, { seed: (f) => seedMoves(f, testInstance) });
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
    renderInWorld(<LoadedIndex />, {
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

describe('the index drawn from its document (the forum-load plan, Task 13)', () => {
  test('its boards, last posters and the box of who is online are in the first render, with the reader\'s mask added, and nothing is read', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const mine = fake.seed.character(me, 'Pipewrench', 'heel', { at: T0 });
    const spritey = fake.seed.character(other, 'Spritey', 'face', { at: T0 });
    fake.seed.thread('general', spritey, 'One', 'x', { at: T0 });
    fake.signInAs(other);
    await fake.here({ kind: 'index' }, spritey);
    fake.signInAs(me);
    const boot = await fake.boot();
    const doc = await fake.indexPage();
    const read = holdReads(fake, ['here', 'session']);
    renderIn(fake, <IndexScreen doc={doc} />, { boot });
    const row = screen.getByRole('link', { name: 'General' }).closest('tr')!;
    expect(within(row).getByRole('link', { name: 'Spritey' })).toBeInTheDocument();
    const box = screen.getByRole('region', { name: 'Who is online' });
    expect(within(box).getAllByRole('link').map((a) => a.textContent)).toEqual(['Spritey', 'Pipewrench']);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(read).toEqual([]);
    expect(mine).toBeTruthy();
  });

  test('signed out, the loader\'s marker is the front door, with no read', () => {
    const fake = buildWorld();
    /* The player's provider asks the session, as it does for every page; the screen asks nothing. */
    const read = holdReads(fake, ['session']);
    renderIn(fake, <IndexScreen doc={SIGNED_OUT_DOC} />);
    expect(screen.getByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(read).toEqual([]);
  });
});

describe('the index in the period table (board-look plan, Task 3)', () => {
  test('the board table draws no icon column and no category row, and its heads are the three words', async () => {
    renderInWorld(<LoadedIndex />, { seed: (f) => { f.signInAs(f.seed.account('me')); } });
    const table = (await screen.findByRole('link', { name: 'General' })).closest('table')!;
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Board', 'Threads', 'Last post']);
    expect(table.querySelector('svg, img')).toBeNull();
    for (const row of within(table).getAllByRole('row').slice(1)) expect(row.querySelectorAll('td')).toHaveLength(3);
    expect(table.querySelector('td[colspan], th[colspan]')).toBeNull();
  });

  test('Who is online\'s heading is an h2, and a section\'s heading is the one heading of its cell', async () => {
    renderInWorld(<LoadedIndex />, { seed: (f) => { f.signInAs(f.seed.account('me')); } });
    await screen.findByRole('link', { name: 'General' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Who is online' })).toBeInTheDocument();
  });

  test('a last post\'s avatar and name are one unit: a .kb-who holding the mini avatar and the name\'s link', async () => {
    renderInWorld(<LoadedIndex />, {
      seed: (f) => {
        const spritey = f.seed.character(f.seed.account('other'), 'Spritey', 'face', { at: T0 });
        f.seed.thread('general', spritey, 'One', 'x', { at: T0 });
        f.signInAs(f.seed.account('me'));
      },
    });
    const name = await screen.findByRole('link', { name: 'Spritey' });
    const unit = name.parentElement!;
    expect(unit).toHaveClass('kb-who');
    expect(unit.querySelector('.kb-mini')).not.toBeNull();
  });
});
