import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import type { Instance, Quadrant } from '../../rules/types.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Page } from '../glass/Page.tsx';
import { POPOVER_ROOM, POPOVER_WIDTH } from './Picker.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { usePlayer } from '../player.tsx';
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
afterEach(() => { vi.unstubAllGlobals(); });

/** A phone's window, narrower than the popover's room, where the picker is the sheet (jsdom's own window is 1024px wide). */
function onAPhone() {
  vi.stubGlobal('innerWidth', 390);
}

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
  const view = renderIn(w.fake, <Reactions act={act} author={author} authorName="Spritey" tallies={tallies} mine={mine} />);
  return { tallies, mine, ...view };
}

/* Named as the React board names it (glass Task 2.1; it was "React as" the HUD's character, which is now its description). */
const picker = () => screen.getByRole('dialog', { name: /^React to / });
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
    expect(picker()).toHaveAccessibleName('React to Spritey\'s post');
    const groups = p.getAllByRole('group');
    expect(groups).toHaveLength(4);
    ['Heat', 'Hype', 'Groan', 'Calm'].forEach((name, i) => expect(groups[i]).toHaveAccessibleName(name));
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
    expect(p.getByRole('button', { name: 'Fire, Hype, your reaction' })).toBeDisabled();
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
      renderIn(w.fake, <Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} />, { instance: big() });
      await userEvent.click(await screen.findByRole('button', { name: 'React' }));
    };
    const on = () => document.activeElement?.getAttribute('data-kb-reaction');
    const press = async (...keys: string[]) => { for (const k of keys) await userEvent.keyboard(`{${k}}`); return on(); };

    /* In the popover a quadrant's four kinds are a row, as the React board draws them. */
    test('Left and Right go along a row of the whole grid, across into the next quadrant', async () => {
      await openBig();
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('ArrowRight', 'ArrowRight', 'ArrowRight')).toBe('e4');
      expect(await press('ArrowRight')).toBe('p1');
      expect(await press('ArrowRight', 'ArrowRight', 'ArrowRight')).toBe('p4');
      expect(await press('ArrowRight')).toBe('p4');
      expect(await press('ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft')).toBe('e4');
    });

    test('Up and Down go along a column of the whole grid, across into the quadrant below and above', async () => {
      await openBig();
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('ArrowDown')).toBe('b1');
      expect(await press('ArrowDown')).toBe('b1');
      expect(await press('ArrowUp')).toBe('e1');
      expect(await press('ArrowUp')).toBe('e1');
      expect(await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight')).toBe('p1');
      expect(await press('ArrowDown')).toBe('c1');
      expect(await press('ArrowLeft')).toBe('b4');
    });

    test('Home and End go to the first and the last, and a kind already left is stepped over', async () => {
      await openBig(['c2']);
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('End')).toBe('c4');
      expect(await press('Home')).toBe('e1');
      expect(await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown')).toBe('c1');
      expect(await press('ArrowRight')).toBe('c3');
    });

    /* On the phone's sheet there is room for two across, so a quadrant's kinds are two rows of two (the grid before the glass). */
    describe('on a phone\'s sheet, two to a row', () => {
      test('Left and Right go along a row of the whole grid, across into the next quadrant', async () => {
        onAPhone();
        await openBig();
        await waitFor(() => expect(on()).toBe('e1'));
        expect(await press('ArrowRight')).toBe('e2');
        expect(await press('ArrowRight')).toBe('p1');
        expect(await press('ArrowRight')).toBe('p2');
        expect(await press('ArrowRight')).toBe('p2');
        expect(await press('ArrowLeft', 'ArrowLeft')).toBe('e2');
      });

      test('Up and Down go along a column of the whole grid, across into the quadrant below and above', async () => {
        onAPhone();
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
        onAPhone();
        await openBig(['c2']);
        await waitFor(() => expect(on()).toBe('e1'));
        expect(await press('End')).toBe('c4');
        expect(await press('Home')).toBe('e1');
        await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown');
        expect(on()).toBe('p4');
        expect(await press('ArrowDown')).toBe('c4');
      });
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

/** The same, with an outside control before and after, and a handle on the player's HUD. */
function showAround(w: ReturnType<typeof world>) {
  const tallies = createTallies();
  const mine = createMine();
  const probe: { player: ReturnType<typeof usePlayer> | null } = { player: null };
  const Probe = () => { probe.player = usePlayer(); return null; };
  renderIn(w.fake, (
    <>
      <input aria-label="before" />
      <Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} />
      <button type="button">after</button>
      <Probe />
    </>
  ));
  return { tallies, mine, probe };
}
/** A react that waits to be let go, then does what the backend does. */
function held(w: ReturnType<typeof world>) {
  const real = w.fake.react.bind(w.fake);
  let release = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const react = vi.fn(async (...a: Parameters<typeof real>) => { await gate; return real(...a); });
  w.fake.react = react as typeof w.fake.react;
  return { react, release };
}

describe('from the Task 6 quality review', () => {
  test('describes the dialog by what is left, in a status that is heard when it changes', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    const p = await open();
    expect(p.getByRole('status')).toHaveTextContent('3 of 3 left');
    expect(picker()).toHaveAccessibleDescription('3 of 3 left, reacting as Mrs. Hooligan');
    act(() => { v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    expect(p.getByRole('status')).toHaveTextContent('2 of 3 left');
  });

  test('after a refusal reads the player\'s own reactions again, so what another tab left is shown as left', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    w.fake.seed.react(w.me, w.pipe, w.theirs, 'tea');
    w.fake.react = async () => ({ ok: false as const, error: 'you have already left that reaction here' });
    const p = await open();
    expect(p.getByText('3 of 3 left')).toBeInTheDocument();
    await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('you have already left that reaction here');
    await waitFor(() => expect(p.getByText('2 of 3 left')).toBeInTheDocument());
    expect(p.getByRole('button', { name: /^Tea, Calm/u })).toBeDisabled();
  });

  /* In the glass the page behind is inert, so the picker is closed by Esc, not by a click on the page; focus is back on React and the reaction landing moves it nowhere. */
  test('a reaction that lands after the picker was closed is still recorded, and takes focus nowhere', async () => {
    const w = world();
    const v = showAround(w);
    const gate = held(w);
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Fire, Hype' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'React' })).toHaveFocus());
    act(() => screen.getByLabelText('before').focus());
    gate.release();
    await waitFor(() => expect(screen.getByText('Fire, 1, including yours')).toBeInTheDocument());
    expect(v.mine.get(w.theirs)).toHaveLength(1);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('before')).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('sends one reaction at a time: a second click while the first is in flight is ignored', async () => {
    const w = world();
    showAround(w);
    const gate = held(w);
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Fire, Hype' }));
    await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
    await userEvent.click(p.getByRole('button', { name: 'Fire, Hype' }));
    gate.release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(gate.react).toHaveBeenCalledTimes(1);
  });

  /* In the glass a press outside lands on the overlay's dimmed page, which closes it and gives focus back to React, as every overlay does. */
  test('closes on a press outside, on the dimmed page, and focus goes back to React', async () => {
    const w = world();
    showAround(w);
    await open();
    fireEvent.mouseDown(picker().closest('.kb-glass-overlay')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'React' })).toHaveFocus());
  });

  /* In the glass focus is held: what used to close the picker (focus moving outside) is brought back inside it. */
  test('holds focus: focus sent outside it comes back inside, and the picker stays open', async () => {
    const w = world();
    showAround(w);
    const p = await open();
    await waitFor(() => expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus());
    act(() => screen.getByLabelText('before').focus());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(picker()).toContainElement(document.activeElement as HTMLElement);
  });

  test('closes by its Close button and returns focus to React', async () => {
    const w = world();
    showAround(w);
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
  });

  /* In the glass Tab is held inside: from Close it comes back round to the grid's one stop, where it used to leave and close. */
  test('puts Close after the grid: Tab from the grid reaches it, and Tab from it comes back round to the grid', async () => {
    const w = world();
    showAround(w);
    const p = await open();
    await waitFor(() => expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus());
    await userEvent.tab();
    expect(p.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.tab();
    expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(p.getByRole('button', { name: 'Fire, Hype' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(p.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  /* The choice: a picker belongs to the character it was opened for, so changing the HUD's character closes it (a reaction never goes out under a mask other than the one the label named). */
  test('closes when the HUD\'s character changes, and does not come back', async () => {
    const w = world();
    const v = showAround(w);
    await open();
    expect(picker()).toHaveAccessibleDescription(/reacting as Mrs\. Hooligan$/u);
    act(() => v.probe.player!.setHudCharacter(w.pipe));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => v.probe.player!.setHudCharacter(w.hooligan));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('dims a kind already left by its emoji alone, so its border keeps its contrast', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    const p = await open();
    const own = p.getByRole('button', { name: /^Fire, Hype/u });
    expect(own).toBeDisabled();
    expect(getComputedStyle(own).opacity).toBe('1');
    expect(getComputedStyle(own.firstElementChild!).opacity).toBe('0.4');
  });
});

/* Glass Task 2.1: the picker as the React board draws it, a glass overlay (docs/research/2026-10-29-two-worlds/03-react.html). */
describe('in the glass', () => {
  test('opens as a glass overlay named as the board names it, on the react smoke, with the page behind inert and focus inside', async () => {
    const w = world();
    const { container } = show(w, w.theirs, w.spritey);
    await open();
    const dialog = picker();
    expect(dialog).toHaveAccessibleName('React to Spritey\'s post');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('kb-glass-dialog');
    expect(dialog.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'react');
    expect(container).toHaveAttribute('inert');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  test('Esc closes the picker only: on a glass page the page stays, and focus goes back to React', async () => {
    const w = world();
    const tallies = createTallies();
    const mine = createMine();
    renderIn(w.fake, <Page surface="settings"><Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} /></Page>, { path: '/settings' });
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /^React to / })).toBeNull();
    expect(window.location.pathname).toBe('/settings');
    await waitFor(() => expect(screen.getByRole('button', { name: 'React' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'React' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('says the board\'s words: its heading, the count in its bar, the two axes and the hint', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    const p = await open();
    expect(p.getByRole('heading', { name: 'React' })).toBeInTheDocument();
    expect(picker().querySelector('.kb-glass-dialog-bar')).toContainElement(p.getByRole('status'));
    expect(p.getByRole('status')).toHaveTextContent(/^3 of 3 left$/u);
    expect(p.getByText('Excited')).toBeInTheDocument();
    expect(p.getByText('Low-key')).toBeInTheDocument();
    expect(p.getByText('Arrow keys move, Enter reacts. Outlined: yours.')).toBeInTheDocument();
  });

  test('names each group by its visible label, and the player\'s own kind as theirs', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.mine.add({ act: w.theirs, kind: 'tea', character: w.pipe }); });
    const p = await open();
    const heat = p.getByRole('group', { name: 'Heat' });
    const label = document.getElementById(heat.getAttribute('aria-labelledby') ?? '');
    expect(heat).toContainElement(label);
    expect(label).toHaveTextContent('Heat');
    expect(p.getByRole('button', { name: 'Tea, Calm, your reaction' })).toHaveAttribute('data-kb-own', '');
  });

  test('wears each quadrant\'s class colors where the instance gives one, and the glass\'s text where it gives none', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    const p = await open();
    expect(p.getByRole('group', { name: 'Heat' }).getAttribute('style')).toContain('var(--kb-glass-class-heel-large)');
    expect(p.getByRole('group', { name: 'Hype' }).getAttribute('style')).toContain('var(--kb-glass-class-face-fill)');
    expect(p.getByRole('group', { name: 'Groan' }).getAttribute('style') ?? '').not.toContain('--kb-glass-class-');
  });

  test('lays a quadrant\'s kinds four across in the popover', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    await open();
    expect(picker().querySelector('.kb-picker-grid')).toHaveAttribute('data-kb-columns', '4');
  });

  test('and two across in a window too narrow for the popover, where the picker is a sheet', async () => {
    onAPhone();
    const w = world();
    show(w, w.theirs, w.spritey);
    await open();
    expect(picker().querySelector('.kb-picker-grid')).toHaveAttribute('data-kb-columns', '2');
    expect(picker()).toHaveAttribute('data-kb-place', 'sheet');
  });
});

/* The room the picker asks the overlay for is its stylesheet's width with the phone's gutters, so the two cannot drift apart. */
describe('the popover\'s room', () => {
  test('is reactions.css\'s picker width and 16px either side', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reactions.css'), 'utf8');
    const width = /\.kb-glass-dialog\.kb-picker\s*\{[^}]*?\bwidth:\s*(\d+)px/u.exec(css)?.[1];
    expect(Number(width)).toBe(POPOVER_WIDTH);
    expect(POPOVER_ROOM).toBe(Number(width) + 2 * 16);
  });
});
