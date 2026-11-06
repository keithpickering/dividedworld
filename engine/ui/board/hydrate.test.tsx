import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { createFake } from '../data/fake.ts';
import { renderIn, testInstance } from '../test-world.tsx';
import { useLocation } from '../router.tsx';
import { BoardScreen } from './Board.tsx';

/*
 * The board hydrates its stores from a document (the forum-load plan, Task 13). A store that already has listeners must never be written while a
 * component renders (merge notifies synchronously), so a page turn's tallies go in outside the render. The probe wraps the stores' merge and
 * notes any call made while a component renders on a store that existed before the first frame was drawn.
 */
const probe = vi.hoisted(() => ({ armed: false, violations: [] as string[] }));
/* React's development build calls a component through `renderWithHooks`; an effect is called from the commit instead. */
const rendering = () => new Error().stack!.includes('renderWithHooks');

vi.mock('../thread/tallies.ts', async (original) => {
  const real = await original<typeof import('../thread/tallies.ts')>();
  return {
    ...real,
    createTallies: () => {
      const store = real.createTallies();
      const early = !probe.armed;
      const merge = store.merge.bind(store);
      store.merge = (act, t) => { if (probe.armed && early && rendering()) probe.violations.push(`tallies.merge(${act}) while rendering`); return merge(act, t); };
      return store;
    },
  };
});
vi.mock('../reactions/mine.ts', async (original) => {
  const real = await original<typeof import('../reactions/mine.ts')>();
  return {
    ...real,
    createMine: () => {
      const store = real.createMine();
      const early = !probe.armed;
      const merge = store.merge.bind(store);
      store.merge = (act, r) => { if (probe.armed && early && rendering()) probe.violations.push(`mine.merge(${act}) while rendering`); return merge(act, r); };
      return store;
    },
  };
});

describe('a board hydrated from its document', () => {
  test('a page turn where a tally grew writes to no store while rendering', async () => {
    const fake = createFake({ instance: testInstance });
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    for (let i = 0; i < 25; i++) fake.seed.thread('general', spritey, `Thread ${i}`, 'first');
    fake.signInAs(me);
    const boot = await fake.boot();
    const one = (await fake.boardPage('general', 1, []))!;
    const two = (await fake.boardPage('general', 2, []))!;
    const act = one.threads[0]!.id;
    const docs = { 1: { ...one, tallies: { [act]: { fire: 1 } } }, 2: { ...two, tallies: { [act]: { fire: 3 } } } };
    function Route() {
      const { query } = useLocation();
      return <BoardScreen slug="general" doc={query.get('page') === '2' ? docs[2] : docs[1]} />;
    }
    renderIn(fake, <Route />, { path: '/b/general', boot });
    probe.armed = true;
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Pages, top' })).getByRole('link', { name: 'Next' }));
    expect(window.location.search).toBe('?page=2');
    expect(probe.violations).toEqual([]);
  });
});
