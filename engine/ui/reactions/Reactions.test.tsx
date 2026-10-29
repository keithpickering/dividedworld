import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import type { Instance, Quadrant } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { createTallies } from '../thread/tallies.ts';
import { createMine } from './mine.ts';
import { Reactions, readable } from './Reactions.tsx';

/* The HUD's estimate is asked for through the player; this file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

beforeEach(() => { landed.mockClear(); });

/** Test instance: fire = hype (top right), tomato = heat (top left), zzz = groan (bottom left), tea = calm (bottom right). */
function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', 'face');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: theirs } = fake.seed.thread('general', spritey, 'A thread', 'their post');
  const mine = fake.seed.post(thread, pipe, 'my post');
  const sibling = fake.seed.post(thread, hooligan, 'my other mask');
  fake.signInAs(me);
  return { fake, me, other, pipe, hooligan, spritey, thread, theirs, mine, sibling };
}

/** One post's reactions, on stores the test holds, so it can deliver counts as the server would. */
function show(w: ReturnType<typeof world>, act: Id, author: Id | null) {
  const tallies = createTallies();
  const mine = createMine();
  const view = renderIn(w.fake, <Reactions act={act} author={author} tallies={tallies} mine={mine} />);
  return { tallies, mine, ...view };
}

const picker = () => screen.getByRole('dialog', { name: /^React as / });
const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'React' }));
  return within(picker());
};

describe('the chips', () => {
  test('show each kind with its count, and name the player\'s own as theirs', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.tallies.merge(w.theirs, { fire: 2, tea: 1 }); v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    expect(screen.getByText('Fire, 2, including yours')).toBeInTheDocument();
    expect(screen.getByText('Tea, 1')).toBeInTheDocument();
    expect(screen.queryByText(/Tomato/u)).toBeNull();
    const own = screen.getByText('Fire, 2, including yours').closest('li')!;
    expect(own).toHaveAttribute('data-kb-own', '');
    expect(screen.getByText('Tea, 1').closest('li')).not.toHaveAttribute('data-kb-own');
  });

  test('converge when counts arrive twice or out of order: each kind keeps its largest', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.tallies.merge(w.theirs, { fire: 3 }); });
    act(() => { v.tallies.merge(w.theirs, { fire: 2 }); });
    act(() => { v.tallies.merge(w.theirs, { fire: 3, tea: 1 }); });
    act(() => { v.tallies.merge(w.theirs, { fire: 3, tea: 1 }); });
    act(() => { v.tallies.merge(w.theirs, { tea: 0, fire: 1 }); });
    expect(screen.getByText('Fire, 3')).toBeInTheDocument();
    expect(screen.getByText('Tea, 1')).toBeInTheDocument();
  });

  test('make an emoji name of a key', () => {
    expect(readable('raised-hands')).toBe('Raised hands');
    expect(readable('fire')).toBe('Fire');
  });
});

describe('who gets a React button', () => {
  test('another player\'s post does', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    expect(await screen.findByRole('button', { name: 'React' })).toBeInTheDocument();
  });

  test('the HUD character\'s own post shows its tally and no button', async () => {
    const w = world();
    const v = show(w, w.sibling, w.hooligan);
    act(() => { v.tallies.merge(w.sibling, { fire: 1 }); });
    await screen.findByText('Fire, 1');
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByRole('button', { name: 'React' })).toBeNull();
  });

  test('a post by another of the player\'s characters shows no button either', async () => {
    const w = world();
    const v = show(w, w.mine, w.pipe);
    act(() => { v.tallies.merge(w.mine, { tea: 2 }); });
    await screen.findByText('Tea, 2');
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByRole('button', { name: 'React' })).toBeNull();
  });
});

describe('the picker', () => {
  test('is a 2x2 grid of named quadrants, each button named by its emoji and quadrant', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    const p = await open();
    expect(picker()).toHaveAccessibleName('React as Mrs. Hooligan');
    const groups = p.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Heat', 'Hype', 'Groan', 'Calm']);
    expect(p.getByRole('button', { name: 'Fire, Hype' })).toBeInTheDocument();
    expect(p.getByRole('button', { name: 'Tomato, Heat' })).toBeInTheDocument();
    expect(p.getByRole('button', { name: 'Zzz, Groan' })).toBeInTheDocument();
    expect(p.getByRole('button', { name: 'Tea, Calm' })).toBeInTheDocument();
    expect(p.getByText('3 of 3 left')).toBeInTheDocument();
  });

  test('counts what is left across all the player\'s characters', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    const p = await open();
    expect(p.getByText('2 of 3 left')).toBeInTheDocument();
    expect(p.getByRole('button', { name: /^Fire, Hype/u })).toBeDisabled();
    expect(p.getByRole('button', { name: 'Tea, Calm' })).toBeEnabled();
  });

  test('at none left offers no kind at all and says so plainly: a fourth is not offered', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => {
      for (const kind of ['fire', 'tea', 'zzz']) v.mine.add({ act: w.theirs, kind, character: w.pipe });
    });
    const p = await open();
    expect(p.getByText('0 of 3 left')).toBeInTheDocument();
    expect(p.getByText('You have left all 3 of your reactions on this post. You cannot leave another.')).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /Tomato/u })).toBeNull();
    expect(p.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  test('moves with the arrow keys over the grid as it looks, Home and End, and Escape closes and returns focus', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    const p = await open();
    const button = screen.getByRole('button', { name: 'React' });
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent;
    await waitFor(() => expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus());
    await userEvent.keyboard('{ArrowRight}');
    expect(p.getByRole('button', { name: 'Fire, Hype' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(p.getByRole('button', { name: 'Tea, Calm' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(p.getByRole('button', { name: 'Zzz, Groan' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(p.getByRole('button', { name: 'Zzz, Groan' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(p.getByRole('button', { name: 'Tea, Calm' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus();
    expect(focused()).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  describe('with sixteen kinds, four to a quadrant', () => {
    /* Top left to bottom right: e (excited, negative), p (excited, positive), b (bored, negative), c (calm, positive). */
    const big = (): Instance => ({
      ...testInstance,
      reactions: (['e:excitedNegative', 'p:excitedPositive', 'b:boredNegative', 'c:calmPositive'] as const).flatMap((q) => {
        const [letter, quadrant] = q.split(':') as [string, Quadrant];
        return [1, 2, 3, 4].map((n) => ({ key: `${letter}${n}`, emoji: `${letter}${n}`, quadrant }));
      }),
    });
    const bigWorld = () => {
      const fake = buildWorld(undefined, big());
      const me = fake.seed.account('me');
      const other = fake.seed.account('other');
      const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
      const spritey = fake.seed.character(other, 'Spritey', 'face');
      const { act: theirs } = fake.seed.thread('general', spritey, 'A thread', 'their post');
      fake.signInAs(me);
      return { fake, pipe, spritey, theirs };
    };
    const openBig = async (own: string[] = []) => {
      const w = bigWorld();
      const tallies = createTallies();
      const mine = createMine();
      for (const kind of own) mine.add({ act: w.theirs, kind, character: w.pipe });
      renderIn(w.fake, <Reactions act={w.theirs} author={w.spritey} tallies={tallies} mine={mine} />, { instance: big() });
      await userEvent.click(await screen.findByRole('button', { name: 'React' }));
    };
    const on = () => document.activeElement?.getAttribute('data-kb-reaction');
    const press = async (...keys: string[]) => { for (const k of keys) await userEvent.keyboard(`{${k}}`); return on(); };

    test('Left and Right go along a row of the whole grid, across into the next quadrant', async () => {
      await openBig();
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('ArrowRight')).toBe('e2');
      expect(await press('ArrowRight')).toBe('p1');
      expect(await press('ArrowRight')).toBe('p2');
      expect(await press('ArrowRight')).toBe('p2');
      expect(await press('ArrowLeft', 'ArrowLeft')).toBe('e2');
    });

    test('Up and Down go along a column of the whole grid, across into the quadrant below and above', async () => {
      await openBig();
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('ArrowDown')).toBe('e3');
      expect(await press('ArrowDown')).toBe('b1');
      expect(await press('ArrowDown')).toBe('b3');
      expect(await press('ArrowDown')).toBe('b3');
      expect(await press('ArrowUp', 'ArrowUp', 'ArrowUp')).toBe('e1');
      expect(await press('ArrowUp')).toBe('e1');
      expect(await press('ArrowRight', 'ArrowRight', 'ArrowRight')).toBe('p2');
      expect(await press('ArrowDown', 'ArrowDown')).toBe('c2');
      expect(await press('ArrowDown')).toBe('c4');
      expect(await press('ArrowLeft')).toBe('c3');
      expect(await press('ArrowLeft')).toBe('b4');
    });

    test('Home and End go to the first and the last, and a kind already left is stepped over', async () => {
      await openBig(['c2']);
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('End')).toBe('c4');
      expect(await press('Home')).toBe('e1');
      await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown');
      expect(on()).toBe('p4');
      expect(await press('ArrowDown')).toBe('c4');
    });
  });

  test('has one tab stop, and arrows skip a kind already left', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    const p = await open();
    await userEvent.keyboard('{ArrowDown}');
    expect(p.getByRole('button', { name: 'Zzz, Groan' })).toHaveFocus();
    const tabbable = p.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(tabbable.filter((b) => b.closest('[role="group"]'))).toHaveLength(1);
  });

  test('is a sheet above the HUD for a phone, and the same markup serves a desktop popover', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    await open();
    expect(picker()).toHaveClass('kb-sheet', 'kb-picker');
  });
});

describe('reacting', () => {
  test('leaves the reaction as the HUD character, shows it as the player\'s own, closes, and asks for the estimate', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    const react = vi.spyOn(w.fake, 'react');
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Fire, Hype' }));
    await waitFor(() => expect(screen.getByText('Fire, 1, including yours')).toBeInTheDocument());
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
    expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
    expect(landed).toHaveBeenCalledTimes(1);
  });

  test('shows a refusal in the server\'s words beside the picker, and keeps the picker open', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    w.fake.react = async () => ({ ok: false as const, error: 'you have left 3 reactions here, the most there are' });
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('you have left 3 reactions here, the most there are');
    expect(picker()).toContainElement(alert);
    expect(landed).not.toHaveBeenCalled();
  });

  test('says plainly when the request could not be sent at all', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    w.fake.react = async () => { throw new Error('offline'); };
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The reaction could not be sent. Try again.');
  });
});

describe('in a thread', () => {
  test('the player\'s own reactions come with the page, and their own posts have no button', async () => {
    const { ThreadScreen } = await import('../thread/Thread.tsx');
    const w = world();
    w.fake.seed.react(w.me, w.pipe, w.theirs, 'tea');
    w.fake.seed.react(w.other, w.spritey, w.mine, 'fire');
    renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}` });
    expect(await screen.findByText('Tea, 1, including yours')).toBeInTheDocument();
    const own = screen.getByRole('article', { name: /^Post 2 /u });
    expect(within(own).getByText('Fire, 1')).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'React' })).toBeNull();
    expect(within(screen.getByRole('article', { name: /^Post 1 /u})).getByRole('button', { name: 'React' })).toBeInTheDocument();
  });
});
