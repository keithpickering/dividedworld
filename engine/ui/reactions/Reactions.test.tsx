import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act, Id } from '../data/api.ts';
import { createPlays } from '../cards/plays.ts';
import { dayAndTime } from '../characters/format.ts';
import { localKey } from '../../rules/emoji.ts';
import type { Instance, Quadrant } from '../../rules/types.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Page } from '../glass/Page.tsx';
import { POPOVER_ROOM, POPOVER_WIDTH } from './Picker.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { usePlayer } from '../player.tsx';
import { createTallies } from '../thread/tallies.ts';
import { createMine, REACTION_GRACE_MS } from './mine.ts';
import { CANT_TAKE_BACK, Reactions, readable, useReactionChips } from './Reactions.tsx';
import { LoadedThread } from '../loaded.tsx';
import { StagedCtx } from '../staged.ts';

/* The HUD's estimate is asked for through the player; this file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

/* A press holds its reaction for REACTION_GRACE_MS before it is sent (reaction-grace design): every test runs on a fake clock, which still follows real time so the screen settles, and a test that expects the send advances it by `afterGrace`. */
beforeEach(() => { landed.mockClear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
/* The HUD's chosen character is kept in the browser (player.tsx): a test that swaps it must not leave the choice for the next. */
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
const afterGrace = () => act(async () => { await vi.advanceTimersByTimeAsync(REACTION_GRACE_MS); });

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
/* The row's own polite status (the glass tooltip beside it has one of its own), and the picker's count status. */
const rowStatus = () => document.querySelector<HTMLElement>('[data-kb-row-status]')!;
const leftStatus = (p: ReturnType<typeof within>) => p.getAllByRole('status').find((x: HTMLElement) => x.classList.contains('kb-picker-left'))!;
const picker = () => screen.getByRole('dialog', { name: /^React to / });
const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'React' }));
  return within(picker());
};

describe('the chips', () => {
  /* The reactions are meta tiles (the meta acts design, sections 1, 5 and 6): buttons where the player can react, plain tiles where not. */
  describe('as tiles', () => {
    const tile = (name: string | RegExp) => screen.getByRole('button', { name });

    test('on another player\'s post each shown kind is a button named by its count and the character it reacts as', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 2, tea: 1 }); });
      await screen.findByRole('button', { name: 'React' });
      const list = screen.getByRole('list', { name: 'Reactions' });
      expect(list).toHaveClass('kb-reaction-list');
      const fire = within(list).getByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' });
      expect(fire).toHaveClass('kb-meta-tile', 'kb-reaction');
      expect(fire).toHaveAttribute('data-kb-reaction', 'fire');
      expect(fire.closest('li')).not.toBeNull();
      expect(fire.querySelector('.kb-meta-tile-in')).toHaveAttribute('aria-hidden', 'true');
      expect(within(list).getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' })).toBeInTheDocument();
      expect(within(list).queryByRole('button', { name: /Tomato/u })).toBeNull();
    });

    test('on the HUD character\'s own post they are no buttons, there is no React, and each is named in its hidden span', async () => {
      const w = world();
      const v = show(w, w.sibling, w.hooligan);
      act(() => { v.tallies.merge(w.sibling, { fire: 2, tea: 1 }); v.mine.add({ act: w.sibling, kind: 'tea', character: w.pipe }); });
      const list = await screen.findByRole('list', { name: 'Reactions' });
      expect(within(list).queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'React' })).toBeNull();
      const fire = within(list).getByText('Fire, 2');
      expect(fire).toHaveClass('kb-visually-hidden');
      expect(fire.closest('.kb-reaction')!.tagName).toBe('SPAN');
      expect(fire.closest('.kb-reaction')).toHaveAttribute('data-kb-reaction', 'fire');
      expect(within(list).getByText('Tea, 1, including yours').closest('li')!.querySelector('.kb-reaction')).toHaveAttribute('data-kb-own', '');
    });

    test('your own kind is aria-disabled and named "including yours"; with the cap reached a free kind says so', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 2, tea: 1 }); v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
      const own = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
      expect(own).toHaveAttribute('aria-disabled', 'true');
      expect(own).toHaveAttribute('data-kb-own', '');
      expect(tile('Tea, 1. React as Mrs. Hooligan')).not.toHaveAttribute('aria-disabled');
      act(() => { v.mine.add({ act: w.theirs, kind: 'tomato', character: w.pipe }); v.mine.add({ act: w.theirs, kind: 'zzz', character: w.hooligan }); });
      const capped = tile('Tea, 1. You have left all 3 of your reactions on this post');
      expect(capped).toHaveAttribute('aria-disabled', 'true');
      expect(capped).not.toHaveAttribute('data-kb-own');
      expect(tile('Fire, 2, including yours, can\'t be taken back')).toHaveAttribute('aria-disabled', 'true');
    });

    test('pressing a free tile reacts as the HUD character, raises its count, marks it yours, keeps focus and says so in the row', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      /* Another player's fire is on the post already, as the server counts it: the press makes two. */
      const fan = w.fake.seed.account('fan');
      w.fake.seed.react(fan, w.fake.seed.character(fan, 'Fan', 'face'), w.theirs, 'fire');
      act(() => { v.tallies.merge(w.theirs, { fire: 1 }); });
      const react = vi.spyOn(w.fake, 'react');
      await userEvent.click(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
      await afterGrace();
      const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
      expect(react).toHaveBeenCalledTimes(1);
      expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
      expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan }]);
      expect(done).toHaveAttribute('data-kb-own', '');
      expect(done).toHaveAttribute('aria-disabled', 'true');
      expect(done).toHaveFocus();
      expect(rowStatus()).toHaveTextContent('Reacted with Fire as Mrs. Hooligan');
      expect(rowStatus()).toHaveClass('kb-visually-hidden');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(landed).toHaveBeenCalledTimes(1);
    });

    test('the status sentence is cleared when the HUD character changes', async () => {
      const w = world();
      const tallies = createTallies();
      const Swap = () => { const p = usePlayer(); return <button type="button" onClick={() => p.setHudCharacter(w.pipe)}>Swap mask</button>; };
      renderIn(w.fake, <><Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={createMine()} /><Swap /></>);
      act(() => { tallies.merge(w.theirs, { fire: 2 }); });
      await userEvent.click(await screen.findByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' }));
      await afterGrace();
      await waitFor(() => expect(rowStatus()).toHaveTextContent('Reacted with Fire'));
      await userEvent.click(screen.getByRole('button', { name: 'Swap mask' }));
      await waitFor(() => expect(rowStatus()).toBeEmptyDOMElement());
    });

    test('pressing a disabled tile sends nothing', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 2 }); v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
      const react = vi.spyOn(w.fake, 'react');
      await userEvent.click(await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' }));
      await new Promise((r) => setTimeout(r, 30));
      expect(react).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    test('a refusal at the send is the row\'s alert under it, and opens no picker', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 2 }); });
      w.fake.react = async () => ({ ok: false as const, error: 'you have left 3 reactions here, the most there are' });
      await userEvent.click(await screen.findByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' }));
      await afterGrace();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('you have left 3 reactions here, the most there are');
      expect(v.container.querySelector('.kb-reactions')).toContainElement(alert);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    test('a refusal that arrives after the HUD character changed is still the row\'s alert, and opens no picker', async () => {
      const w = world();
      const tallies = createTallies();
      const Swap = () => { const p = usePlayer(); return <button type="button" onClick={() => p.setHudCharacter(w.pipe)}>Swap mask</button>; };
      renderIn(w.fake, <><Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={createMine()} /><Swap /></>);
      act(() => { tallies.merge(w.theirs, { fire: 1 }); });
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      w.fake.react = async () => { await gate; return { ok: false as const, error: 'too late to matter' }; };
      await userEvent.click(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
      await userEvent.click(screen.getByRole('button', { name: 'Swap mask' }));
      await afterGrace();
      release();
      await new Promise((r) => setTimeout(r, 50));
      /* The pressed reaction is still the first mask's and is still refused; the words are plain, and nothing opens or stamps. */
      expect(await screen.findByRole('alert')).toHaveTextContent('too late to matter');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.querySelector('[data-kb-landed]')).toBeNull();
    });

    test('a refusal clears the sentence of the reaction before it', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 1, tea: 1 }); });
      await userEvent.click(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
      await afterGrace();
      await waitFor(() => expect(rowStatus()).toHaveTextContent('Reacted with Fire'));
      w.fake.react = async () => ({ ok: false as const, error: 'no more for you' });
      await userEvent.click(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' }));
      await afterGrace();
      await screen.findByRole('alert');
      expect(rowStatus().textContent).not.toMatch(/Reacted with/u);
    });

    test('a second kind pressed while the first is in flight is held, not dropped: it is sent after it, and the row is busy meanwhile', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      const fan = w.fake.seed.account('fan');
      w.fake.seed.react(fan, w.fake.seed.character(fan, 'Fan', 'face'), w.theirs, 'fire');
      act(() => { v.tallies.merge(w.theirs, { fire: 1, tea: 1 }); });
      const original = w.fake.react.bind(w.fake);
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const react = vi.fn(async (...a: Parameters<typeof original>) => { await gate; return original(...a); });
      w.fake.react = react as typeof w.fake.react;
      const fire = await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' });
      await userEvent.click(fire);
      await userEvent.click(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' }));
      expect(react).not.toHaveBeenCalled();
      await afterGrace();
      expect(react).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('list', { name: 'Reactions' }).closest('.kb-reactions')).toHaveAttribute('aria-busy', 'true');
      release();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' })).toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Tea, 1, including yours, can\'t be taken back' })).toBeInTheDocument());
      expect(react).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('list', { name: 'Reactions' }).closest('.kb-reactions')).not.toHaveAttribute('aria-busy');
    });

    test('the row is one tab stop: Tab reaches React first, arrows move without wrapping, Home and End go to the ends, and Tab back returns to the last one', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 2, tea: 1, zzz: 1 }); v.mine.add({ act: w.theirs, kind: 'tea', character: w.pipe }); });
      await screen.findByRole('button', { name: 'React' });
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
      await userEvent.tab();
      expect(document.body).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
      await userEvent.keyboard('{ArrowLeft}');
      const buttons = within(screen.getByRole('list', { name: 'Reactions' })).getAllByRole('button');
      expect(buttons).toHaveLength(3);
      expect(buttons[2]).toHaveFocus();
      await userEvent.keyboard('{Home}');
      /* Walking the row from its start reaches the disabled tile too. */
      const reached: string[] = [];
      for (let i = 0; i < 3; i++) {
        if (i > 0) await userEvent.keyboard('{ArrowRight}');
        if ((document.activeElement as HTMLElement).getAttribute('aria-disabled') === 'true') reached.push(document.activeElement!.getAttribute('data-kb-reaction')!);
      }
      expect(reached).toEqual(['tea']);
      await userEvent.keyboard('{Home}');
      expect(buttons[0]).toHaveFocus();
      await userEvent.keyboard('{ArrowLeft}');
      expect(buttons[0]).toHaveFocus();
      await userEvent.keyboard('{End}');
      expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
      await userEvent.keyboard('{Home}{ArrowRight}');
      expect(buttons[1]).toHaveFocus();
      await userEvent.tab();
      await userEvent.tab({ shift: true });
      expect(buttons[1]).toHaveFocus();
    });

    test('the row carries data-kb-over-ink in a post, and nothing wears data-kb-look', async () => {
      const w = world();
      const v = show(w, w.theirs, w.spritey);
      act(() => { v.tallies.merge(w.theirs, { fire: 1 }); });
      expect(v.container.querySelector('.kb-reactions')).toHaveAttribute('data-kb-over-ink');
      expect(v.container.querySelector('[data-kb-look]')).toBeNull();
    });

    test('React is a meta tile too, its plus hidden from its name', async () => {
      const w = world();
      show(w, w.theirs, w.spritey);
      const react = await screen.findByRole('button', { name: 'React' });
      expect(react).toHaveClass('kb-meta-tile', 'kb-reaction', 'kb-react-button');
      expect(react.querySelector('.kb-meta-tile-in > span[aria-hidden="true"]')).toHaveTextContent('+');
    });
  });

  test('show each kind with its count, and name the player\'s own as theirs', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    await screen.findByRole('button', { name: 'React' });
    act(() => { v.tallies.merge(w.theirs, { fire: 2, tea: 1 }); v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    expect(screen.getByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' })).toBeInTheDocument();
    expect(screen.queryByText(/Tomato/u)).toBeNull();
    const own = screen.getByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(own).toHaveAttribute('data-kb-own', '');
    expect(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' })).not.toHaveAttribute('data-kb-own');
  });

  test('converge when counts arrive twice or out of order: each kind keeps its largest', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    await screen.findByRole('button', { name: 'React' });
    act(() => { v.tallies.merge(w.theirs, { fire: 3 }); });
    act(() => { v.tallies.merge(w.theirs, { fire: 2 }); });
    act(() => { v.tallies.merge(w.theirs, { fire: 3, tea: 1 }); });
    act(() => { v.tallies.merge(w.theirs, { fire: 3, tea: 1 }); });
    act(() => { v.tallies.merge(w.theirs, { tea: 0, fire: 1 }); });
    expect(screen.getByRole('button', { name: 'Fire, 3. React as Mrs. Hooligan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' })).toBeInTheDocument();
  });

  test('make an emoji name of a key', () => {
    expect(readable('raised-hands')).toBe('Raised hands');
    expect(readable('fire')).toBe('Fire');
  });
});

/* The stamp (Reactions.tsx, reactions.css): a reaction this screen left lands on its tile; nothing else does. */
describe('the stamp', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); });
  /* One kind already on the post from a fan, as the server counts it, so a press makes two. */
  const fanned = (kind: string) => {
    const w = world();
    const fan = w.fake.seed.account('fan');
    w.fake.seed.react(fan, w.fake.seed.character(fan, 'Fan', 'face'), w.theirs, kind);
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.tallies.merge(w.theirs, { [kind]: 1 }); });
    return { w, v };
  };

  test('a pressed tile lands when it is sent, in its quadrant\'s class color, with its seal, its wave and eight shards', async () => {
    fanned('fire');
    await userEvent.click(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    await afterGrace();
    const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(done).toHaveAttribute('data-kb-landed', 'now');
    expect(done.style.getPropertyValue('--kb-reaction-hue')).toBe('var(--kb-glass-class-face-large)');
    const stamp = done.querySelector('.kb-reaction-stamp')!;
    expect(stamp).toHaveAttribute('aria-hidden', 'true');
    expect(stamp.querySelectorAll('.kb-reaction-seal')).toHaveLength(1);
    expect(stamp.querySelectorAll('.kb-reaction-wave')).toHaveLength(1);
    expect(stamp.querySelectorAll('.kb-reaction-shard')).toHaveLength(8);
    expect(done.querySelector('.kb-reaction-count')).toHaveTextContent('2');
  });

  test('a kind whose quadrant has no class takes no color of its own (the stylesheet gives it the gold)', async () => {
    fanned('tea');
    await userEvent.click(await screen.findByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' }));
    await afterGrace();
    const done = await screen.findByRole('button', { name: 'Tea, 2, including yours, can\'t be taken back' });
    expect(done).toHaveAttribute('data-kb-landed', 'now');
    expect(done.style.getPropertyValue('--kb-reaction-hue')).toBe('');
  });

  test('a count that arrives from anyone else stamps nothing', async () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.tallies.merge(w.theirs, { fire: 1 }); });
    const fire = await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' });
    act(() => { v.tallies.merge(w.theirs, { fire: 2 }); });
    await screen.findByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' });
    expect(fire).not.toHaveAttribute('data-kb-landed');
    expect(document.querySelector('.kb-reaction-stamp')).toBeNull();
  });

  test('a kind chosen in the picker leaves the picker at the press, and lands on the row at the send', async () => {
    fanned('fire');
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: /^Fire/u }));
    /* The picker leaves at the press, five seconds before the send, so the stamp has no exit to wait for. */
    expect(screen.queryByRole('dialog')).toBeNull();
    await afterGrace();
    const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(done).toHaveAttribute('data-kb-landed', 'now');
  });

  test('the stamp leaves the tile once it has played', async () => {
    fanned('fire');
    await userEvent.click(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    await afterGrace();
    const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    await waitFor(() => expect(done).not.toHaveAttribute('data-kb-landed'), { timeout: 2500 });
    expect(done.querySelector('.kb-reaction-stamp')).toBeNull();
  });

  test('under Off the tile lands with no stamp to draw', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    fanned('fire');
    await userEvent.click(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    await afterGrace();
    const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(done).toHaveAttribute('data-kb-own', '');
    expect(done.querySelector('.kb-reaction-stamp')).toBeNull();
  });

  test('a send waiting on its answer is marked sending (not before it), and the mark goes with the answer', async () => {
    const { w } = fanned('fire');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = w.fake.react.bind(w.fake);
    w.fake.react = async (...args) => { await gate; return real(...args); };
    const fire = await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' });
    await userEvent.click(fire);
    /* Held for the grace, then in flight: the mark is the send's, not the grace's. */
    expect(fire).not.toHaveAttribute('data-kb-sending');
    await afterGrace();
    expect(fire).toHaveAttribute('data-kb-sending', '');
    release();
    const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(done).not.toHaveAttribute('data-kb-sending');
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
    expect(p.getByRole('button', { name: 'Fire, Hype, your reaction' })).toHaveAttribute('aria-disabled', 'true');
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

    test('Home and End go to the first and the last, and a kind already left is reached like any other', async () => {
      await openBig(['c2']);
      await waitFor(() => expect(on()).toBe('e1'));
      expect(await press('End')).toBe('c4');
      expect(await press('Home')).toBe('e1');
      expect(await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown')).toBe('c1');
      expect(await press('ArrowRight')).toBe('c2');
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

      test('Home and End go to the first and the last, and a kind already left is reached like any other', async () => {
        onAPhone();
        await openBig(['c2']);
        await waitFor(() => expect(on()).toBe('e1'));
        expect(await press('End')).toBe('c4');
        expect(await press('Home')).toBe('e1');
        await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown');
        expect(on()).toBe('p4');
        expect(await press('ArrowDown')).toBe('c2');
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
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(react).not.toHaveBeenCalled();
    await afterGrace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fire, 1, including yours, can\'t be taken back' })).toBeInTheDocument());
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
    expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'React' })).toHaveFocus();
    expect(landed).toHaveBeenCalledTimes(1);
  });

  test('shows a refusal in the server\'s words under the row once the picker\'s choice is sent: the picker went at the choice', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    w.fake.react = async () => ({ ok: false as const, error: 'you have left 3 reactions here, the most there are' });
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
    await afterGrace();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('you have left 3 reactions here, the most there are');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(alert).toHaveClass('kb-reactions-refusal');
    expect(landed).not.toHaveBeenCalled();
  });

  test('says plainly when the request could not be sent at all', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    w.fake.react = async () => { throw new Error('offline'); };
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
    await afterGrace();
    expect(await screen.findByRole('alert')).toHaveTextContent('The reaction could not be sent. Try again.');
  });
});

describe('in a thread', () => {
  test('the player\'s own reactions come with the page, and their own posts have no button', async () => {
    const { ThreadScreen } = await import('../thread/Thread.tsx');
    const w = world();
    w.fake.seed.react(w.me, w.pipe, w.theirs, 'tea');
    w.fake.seed.react(w.other, w.spritey, w.mine, 'fire');
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
    expect(await screen.findByRole('button', { name: 'Tea, 1, including yours, can\'t be taken back' })).toBeInTheDocument();
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
    expect(leftStatus(p)).toHaveTextContent('3 of 3 left');
    expect(picker()).toHaveAccessibleDescription('3 of 3 left, reacting as Mrs. Hooligan');
    act(() => { v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    expect(leftStatus(p)).toHaveTextContent('2 of 3 left');
  });

  test('after a refusal reads the player\'s own reactions again, so what another tab left is shown as left', async () => {
    const w = world();
    show(w, w.theirs, w.spritey);
    w.fake.seed.react(w.me, w.pipe, w.theirs, 'tea');
    w.fake.react = async () => ({ ok: false as const, error: 'you have already left that reaction here' });
    const p0 = await open();
    expect(p0.getByText('3 of 3 left')).toBeInTheDocument();
    await userEvent.click(p0.getByRole('button', { name: 'Tea, Calm' }));
    await afterGrace();
    expect(await screen.findByRole('alert')).toHaveTextContent('you have already left that reaction here');
    /* The picker went at the choice; opened again it shows what the re-read found. */
    const p = await open();
    await waitFor(() => expect(p.getByText('2 of 3 left')).toBeInTheDocument());
    expect(p.getByRole('button', { name: /^Tea, Calm/u })).toHaveAttribute('aria-disabled', 'true');
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
    await afterGrace();
    gate.release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fire, 1, including yours, can\'t be taken back' })).toBeInTheDocument());
    expect(v.mine.get(w.theirs)).toHaveLength(1);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('before')).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('sends one reaction at a time: a kind chosen while another is in flight waits for it, and is not dropped', async () => {
    const w = world();
    showAround(w);
    const gate = held(w);
    const p = await open();
    await userEvent.click(p.getByRole('button', { name: 'Fire, Hype' }));
    await afterGrace();
    expect(gate.react).toHaveBeenCalledTimes(1);
    const again = await open();
    await userEvent.click(again.getByRole('button', { name: 'Tea, Calm' }));
    await afterGrace();
    /* Fire is still in flight: Tea is on the queue behind it. */
    expect(gate.react).toHaveBeenCalledTimes(1);
    gate.release();
    await waitFor(() => expect(gate.react).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(own).toHaveAttribute('aria-disabled', 'true');
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
    expect(picker().querySelector('.kb-glass-dialog-bar')).toContainElement(leftStatus(p));
    expect(leftStatus(p)).toHaveTextContent(/^3 of 3 left$/u);
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

describe('on a staged page (the front door)', () => {
  /* No one signed in, every backend method wrapped: a staged row answers locally and asks the server nothing. */
  function staged() {
    const fake = buildWorld();
    const called: string[] = [];
    for (const [key, value] of Object.entries(fake)) {
      if (typeof value === 'function' && (key === 'react' || key === 'myReactions')) {
        (fake as unknown as Record<string, unknown>)[key] = (...a: unknown[]) => { called.push(key); return (value as (...x: unknown[]) => unknown)(...a); };
      }
    }
    const tallies = createTallies();
    const mine = createMine();
    tallies.merge('front-door:0', { fire: 2 });
    renderIn(fake, <StagedCtx.Provider value={true}><Reactions act="front-door:0" author="front-door:ann" authorName="Ann" tallies={tallies} mine={mine} /></StagedCtx.Provider>);
    return { called, tallies, mine };
  }

  test('offers React and its tiles as buttons with no one signed in, and names no mask', async () => {
    staged();
    expect(await screen.findByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fire, 2. React' })).toBeInTheDocument();
  });

  test('a tile pressed grows its count and is the visitor\'s own, with no request and no estimate', async () => {
    const { called, tallies, mine } = staged();
    await userEvent.click(await screen.findByRole('button', { name: 'Fire, 2. React' }));
    await afterGrace();
    expect(await screen.findByRole('button', { name: 'Fire, 3, including yours, can\'t be taken back' })).toBeInTheDocument();
    expect(tallies.get('front-door:0')).toEqual({ fire: 3 });
    expect(mine.get('front-door:0').map((r) => r.kind)).toEqual(['fire']);
    expect(called).toEqual([]);
    expect(landed).not.toHaveBeenCalled();
  });

  test('holds the cap itself, as the server would: two presses in one tick with one reaction left land one', async () => {
    const { tallies, mine } = staged();
    act(() => { tallies.merge('front-door:0', { tomato: 1, tea: 1, zzz: 1 }); mine.add({ act: 'front-door:0', kind: 'zzz', character: 'x' }); mine.add({ act: 'front-door:0', kind: 'fire', character: 'x' }); });
    const tomato = screen.getByRole('button', { name: /^Tomato, 1/ });
    const tea = screen.getByRole('button', { name: /^Tea, 1/ });
    await act(async () => { fireEvent.click(tomato); fireEvent.click(tea); });
    await afterGrace();
    expect(mine.get('front-door:0')).toHaveLength(3);
    expect((tallies.get('front-door:0').tomato ?? 0) + (tallies.get('front-door:0').tea ?? 0)).toBe(3);
  });

  test('a kind already the visitor\'s is not counted again', async () => {
    const { tallies, mine } = staged();
    const fire = screen.getByRole('button', { name: 'Fire, 2. React' });
    await act(async () => { fireEvent.click(fire); });
    await afterGrace();
    /* Pressed again once it is the visitor's own (a second press inside the grace is the undo, which a test of the grace holds). */
    await act(async () => { fireEvent.click(fire); });
    await afterGrace();
    expect(tallies.get('front-door:0')).toEqual({ fire: 3 });
    expect(mine.get('front-door:0')).toHaveLength(1);
  });

  test('the picker is described by what is left alone, and a pick lands locally', async () => {
    const { called } = staged();
    await userEvent.click(await screen.findByRole('button', { name: 'React' }));
    expect(picker()).toHaveAccessibleDescription('3 of 3 left');
    await userEvent.click(within(picker()).getByRole('button', { name: /^Tomato, / }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await afterGrace();
    expect(screen.getByRole('button', { name: 'Tomato, 1, including yours, can\'t be taken back' })).toBeInTheDocument();
    expect(called).toEqual([]);
  });
});

/* The grace (reaction-grace design, sections 2 to 6): a press holds the reaction on this screen for REACTION_GRACE_MS, and only the end of it sends. */
describe('the grace', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); });
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  /* The press waits for the render's effects (the HUD's mask settles them) so one of them cannot clear what the press said. */
  const press = async (el: HTMLElement) => { await act(async () => {}); act(() => { fireEvent.click(el); }); };
  const PENDING_FIRE = /^Fire, sending in \d seconds? as Mrs\. Hooligan\. Press again to undo$/u;
  const status = () => rowStatus();
  /* One fire already on the post, as the server counts it: a press makes two. */
  const fanned = () => {
    const w = world();
    const fan = w.fake.seed.account('fan');
    w.fake.seed.react(fan, w.fake.seed.character(fan, 'Fan', 'face'), w.theirs, 'fire');
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.tallies.merge(w.theirs, { fire: 1, tea: 1 }); });
    return { w, v };
  };

  test('a tile press shows the pending chip with one more, in its pending style, and sends nothing', async () => {
    const { w, v } = fanned();
    const react = vi.spyOn(w.fake, 'react');
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    const tile = screen.getByRole('button', { name: PENDING_FIRE });
    expect(tile).toHaveAttribute('data-kb-pending', '');
    expect(tile).not.toHaveAttribute('aria-disabled');
    expect(tile).toHaveAccessibleName('Fire, sending in 5 seconds as Mrs. Hooligan. Press again to undo');
    expect(tile.querySelector('.kb-reaction-count')).toHaveTextContent('2');
    expect(tile.style.getPropertyValue('--kb-grace-due')).toBe(`${REACTION_GRACE_MS}ms`);
    expect(tile.style.getPropertyValue('--kb-grace-ms')).toBe(`${REACTION_GRACE_MS}ms`);
    expect(status()).toHaveTextContent('Reacting with Fire as Mrs. Hooligan in 5 seconds');
    expect(v.mine.pending(w.theirs).map((p) => p.kind)).toEqual(['fire']);
    expect(v.mine.get(w.theirs)).toEqual([]);
    await wait(100);
    expect(react).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
  });

  test('a kind with no chip yet gets one while it is pending', async () => {
    const { w, v } = fanned();
    await screen.findByRole('button', { name: 'React' });
    act(() => { v.mine.hold({ act: w.theirs, kind: 'zzz', character: w.hooligan, due: Date.now() + 3000 }); });
    const tile = screen.getByRole('button', { name: /^Zzz, sending in 3 seconds as Mrs\. Hooligan/u });
    expect(tile).toHaveAttribute('data-kb-pending', '');
    expect(tile.querySelector('.kb-reaction-count')).toHaveTextContent('1');
    expect(tile.style.getPropertyValue('--kb-grace-due')).toBe('3000ms');
  });

  test('a second press within the grace undoes it: the count is back, nothing is ever sent, and the status says undone', async () => {
    const { w, v } = fanned();
    const react = vi.spyOn(w.fake, 'react');
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    await wait(2000);
    await press(screen.getByRole('button', { name: PENDING_FIRE }));
    const back = screen.getByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' });
    expect(back).not.toHaveAttribute('data-kb-pending');
    expect(back.querySelector('.kb-reaction-count')).toHaveTextContent('1');
    expect(status()).toHaveTextContent('Fire undone');
    expect(v.mine.pending(w.theirs)).toEqual([]);
    await wait(REACTION_GRACE_MS * 2);
    expect(react).not.toHaveBeenCalled();
  });

  test('the grace\'s end sends once, and the stamp (and the "Reacted" status) comes then, not at the press', async () => {
    const { w, v } = fanned();
    const react = vi.spyOn(w.fake, 'react');
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    /* No stamp at the press, nor within its own length (1400ms) after it, and the status is still the press's. */
    expect(screen.getByRole('button', { name: PENDING_FIRE })).not.toHaveAttribute('data-kb-landed');
    expect(document.querySelector('.kb-reaction-stamp')).toBeNull();
    expect(status()).not.toHaveTextContent('Reacted');
    await wait(1000);
    expect(screen.getByRole('button', { name: /^Fire, sending/u })).not.toHaveAttribute('data-kb-landed');
    expect(status()).not.toHaveTextContent('Reacted');
    await wait(REACTION_GRACE_MS - 2000);
    expect(react).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Fire, sending/u })).not.toHaveAttribute('data-kb-landed');
    await wait(1000);
    const done = await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(react).toHaveBeenCalledTimes(1);
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
    expect(done).toHaveAttribute('data-kb-landed', 'now');
    expect(done).not.toHaveAttribute('data-kb-pending');
    expect(done).toHaveAttribute('data-kb-own', '');
    expect(status()).toHaveTextContent('Reacted with Fire as Mrs. Hooligan');
    expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan }]);
    expect(v.mine.pending(w.theirs)).toEqual([]);
    expect(landed).toHaveBeenCalledTimes(1);
  });

  test('the name\'s seconds are the whole seconds left at render, rounded up', async () => {
    fanned();
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    await wait(1500);
    expect(screen.getByRole('button', { name: /^Fire, sending in 4 seconds as/u })).toBeInTheDocument();
    await wait(3000);
    expect(screen.getByRole('button', { name: /^Fire, sending in 1 second as/u })).toBeInTheDocument();
  });

  test('the ring\'s start is set once for a pending kind: the once-a-second re-renders leave --kb-grace-due as it was', async () => {
    fanned();
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    const due = () => screen.getByRole('button', { name: /^Fire, sending/u }).style.getPropertyValue('--kb-grace-due');
    const first = due();
    expect(first).toBe(`${REACTION_GRACE_MS}ms`);
    await wait(1000);
    /* The name has moved on (the row did re-render); the ring's delay must not, or a running animation would be pushed along. */
    expect(screen.getByRole('button', { name: /^Fire, sending in 4 seconds/u })).toBeInTheDocument();
    expect(due()).toBe(first);
    await wait(1000);
    expect(screen.getByRole('button', { name: /^Fire, sending in 3 seconds/u })).toBeInTheDocument();
    expect(due()).toBe(first);
  });

  test('a row first drawn 2 seconds into the grace carries what is left, about 3000ms', async () => {
    const { w, v } = fanned();
    await screen.findByRole('button', { name: 'React' });
    act(() => { v.mine.hold({ act: w.theirs, kind: 'tea', character: w.hooligan, due: Date.now() + REACTION_GRACE_MS }); });
    await wait(2000);
    const later = renderIn(w.fake, <Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={v.tallies} mine={v.mine} pickerAt="button" />);
    const tile = await within(later.container).findByRole('button', { name: /^Tea, sending/u });
    const left = Number.parseInt(tile.style.getPropertyValue('--kb-grace-due'), 10);
    expect(left).toBeGreaterThan(2800);
    expect(left).toBeLessThanOrEqual(3000);
    /* The first row's own tile keeps its own start. */
    expect(screen.getAllByRole('button', { name: /^Tea, sending/u })[0]!.style.getPropertyValue('--kb-grace-due')).toBe(`${REACTION_GRACE_MS}ms`);
  });

  test('the once-a-second re-render runs only while something is pending', async () => {
    const { w } = fanned();
    await screen.findByRole('button', { name: 'React' });
    const idle = vi.getTimerCount();
    await press(screen.getByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    /* The hook's send timer and the row's interval. */
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(idle + 2);
    await press(screen.getByRole('button', { name: /^Fire, sending/u }));
    expect(vi.getTimerCount()).toBe(idle);
    await press(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' }));
    await wait(REACTION_GRACE_MS);
    await screen.findByRole('button', { name: /^Tea, 1, including yours/u });
    await wait(1500);
    expect(w.theirs).toBeTruthy();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(idle + 1);
  });

  test('a pending kind counts toward the cap: with a cap of 2, one sent and one pending, a third tile is aria-disabled with the cap\'s words', async () => {
    const w = world();
    const tallies = createTallies();
    const mine = createMine();
    renderIn(w.fake, <Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} />, { settings: { reactionCap: 2 } });
    act(() => { tallies.merge(w.theirs, { fire: 1, tea: 1, zzz: 1 }); mine.add({ act: w.theirs, kind: 'zzz', character: w.pipe }); });
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    const third = screen.getByRole('button', { name: 'Tea, 1. You have left all 2 of your reactions on this post' });
    expect(third).toHaveAttribute('aria-disabled', 'true');
    await press(third);
    expect(mine.pending(w.theirs).map((p) => p.kind)).toEqual(['fire']);
    /* Undoing the pending one frees its place. */
    await press(screen.getByRole('button', { name: PENDING_FIRE }));
    expect(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' })).not.toHaveAttribute('aria-disabled');
  });

  test('a refusal at the grace\'s end shows the row\'s alert, releases the pending look, and opens no picker', async () => {
    const { w, v } = fanned();
    w.fake.react = async () => ({ ok: false as const, error: 'you have left 3 reactions here, the most there are' });
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    await wait(REACTION_GRACE_MS);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('you have left 3 reactions here, the most there are');
    expect(alert).toHaveClass('kb-notice', 'kb-reactions-refusal');
    expect(alert).toHaveAttribute('data-kb-tone', 'refusal');
    expect(alert.closest('.kb-reactions')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' })).not.toHaveAttribute('data-kb-pending');
    expect(v.mine.pending(w.theirs)).toEqual([]);
    /* It goes at the next press on the row. */
    await press(screen.getByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('under reduced motion the seconds left are drawn as text and count down, and the send is still at 5 seconds', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const { w } = fanned();
    const react = vi.spyOn(w.fake, 'react');
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    const text = () => screen.getByRole('button', { name: /^Fire, sending/u }).querySelector('.kb-reaction-grace');
    expect(text()).toHaveTextContent('5');
    await wait(1500);
    expect(text()).toHaveTextContent('4');
    await wait(1000);
    expect(text()).toHaveTextContent('3');
    await wait(1500);
    expect(react).not.toHaveBeenCalled();
    expect(text()).toHaveTextContent('1');
    await wait(1000);
    await screen.findByRole('button', { name: 'Fire, 2, including yours, can\'t be taken back' });
    expect(react).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.kb-reaction-grace')).toBeNull();
  });

  test('with full motion the seconds-left text is not drawn (the ring is)', async () => {
    fanned();
    await press(await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    expect(document.querySelector('.kb-reaction-grace')).toBeNull();
  });

  test('the ring\'s duration is a property set from the constant: reactions.css holds no second literal for it', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reactions.css'), 'utf8');
    const ring = /\.kb-reaction\[data-kb-pending\]::after\s*\{[^}]*\}/u.exec(css)?.[0] ?? '';
    expect(ring).not.toBe('');
    expect(ring).toMatch(/animation:[^;]*var\(--kb-grace-ms\)/u);
    expect(ring).not.toMatch(/\b5000\b|\b5s\b/u);
  });

  test('the thread\'s row and another row for the same Act (the Lens\'s) both show the pending chip, and either can undo it', async () => {
    const w = world();
    const tallies = createTallies();
    const mine = createMine();
    renderIn(w.fake, (
      <>
        <div data-testid="thread"><Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} /></div>
        <div data-testid="lens"><Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} pickerAt="button" /></div>
      </>
    ));
    act(() => { tallies.merge(w.theirs, { fire: 1 }); });
    const react = vi.spyOn(w.fake, 'react');
    const thread = within(screen.getByTestId('thread'));
    const lens = within(screen.getByTestId('lens'));
    await press(await thread.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' }));
    expect(thread.getByRole('button', { name: PENDING_FIRE })).toHaveAttribute('data-kb-pending', '');
    expect(lens.getByRole('button', { name: PENDING_FIRE })).toHaveAttribute('data-kb-pending', '');
    await press(lens.getByRole('button', { name: PENDING_FIRE }));
    expect(thread.getByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' })).toBeInTheDocument();
    await wait(REACTION_GRACE_MS * 2);
    expect(react).not.toHaveBeenCalled();
  });

  describe('on the staged page', () => {
    function stagedRow() {
      const fake = buildWorld();
      const called: string[] = [];
      for (const key of ['react', 'myReactions'] as const) {
        const real = fake[key].bind(fake) as (...x: unknown[]) => unknown;
        (fake as unknown as Record<string, unknown>)[key] = (...a: unknown[]) => { called.push(key); return real(...a); };
      }
      const tallies = createTallies();
      const mine = createMine();
      tallies.merge('front-door:0', { fire: 2 });
      const { unmount } = renderIn(fake, <StagedCtx.Provider value={true}><Reactions act="front-door:0" author="front-door:ann" authorName="Ann" tallies={tallies} mine={mine} /></StagedCtx.Provider>);
      return { called, tallies, mine, unmount };
    }

    test('a press is pending with the same grace, an undo within it changes nothing, and nothing is called', async () => {
      const { called, tallies, mine } = stagedRow();
      await press(await screen.findByRole('button', { name: 'Fire, 2. React' }));
      const tile = screen.getByRole('button', { name: 'Fire, sending in 5 seconds. Press again to undo' });
      expect(tile).toHaveAttribute('data-kb-pending', '');
      expect(tile.querySelector('.kb-reaction-count')).toHaveTextContent('3');
      expect(status()).toHaveTextContent('Reacting with Fire in 5 seconds');
      expect(tallies.get('front-door:0')).toEqual({ fire: 2 });
      await wait(2000);
      await press(tile);
      expect(screen.getByRole('button', { name: 'Fire, 2. React' })).toBeInTheDocument();
      expect(status()).toHaveTextContent('Fire undone');
      await wait(REACTION_GRACE_MS * 2);
      expect(tallies.get('front-door:0')).toEqual({ fire: 2 });
      expect(mine.get('front-door:0')).toEqual([]);
      expect(called).toEqual([]);
    });

    test('leaving the page ends the grace early and does not end the reaction: the held kind lands locally, with no request and no stamp', async () => {
      const { called, tallies, mine, unmount } = stagedRow();
      await press(await screen.findByRole('button', { name: 'Fire, 2. React' }));
      expect(mine.pending('front-door:0').map((p) => p.kind)).toEqual(['fire']);
      unmount();
      expect(mine.pending('front-door:0')).toEqual([]);
      expect(mine.get('front-door:0').map((r) => r.kind)).toEqual(['fire']);
      expect(tallies.get('front-door:0')).toEqual({ fire: 3 });
      await wait(REACTION_GRACE_MS * 2);
      expect(tallies.get('front-door:0')).toEqual({ fire: 3 });
      expect(called).toEqual([]);
      expect(landed).not.toHaveBeenCalled();
    });

    test('at the grace\'s end the count grows and the kind is the visitor\'s, with the stamp then, and no request or estimate', async () => {
      const { called, tallies, mine } = stagedRow();
      await press(await screen.findByRole('button', { name: 'Fire, 2. React' }));
      await wait(REACTION_GRACE_MS - 1000);
      expect(tallies.get('front-door:0')).toEqual({ fire: 2 });
      await wait(1000);
      const done = await screen.findByRole('button', { name: 'Fire, 3, including yours, can\'t be taken back' });
      expect(done).toHaveAttribute('data-kb-landed', 'now');
      expect(tallies.get('front-door:0')).toEqual({ fire: 3 });
      expect(mine.get('front-door:0').map((r) => r.kind)).toEqual(['fire']);
      expect(mine.pending('front-door:0')).toEqual([]);
      expect(status()).toHaveTextContent('Reacted with Fire');
      expect(called).toEqual([]);
      expect(landed).not.toHaveBeenCalled();
    });
  });
});

/* Card notes, Part 3: a reaction a card adds to one post, and a post whose totals a card hides. */
describe('a post-local reaction and a blind post', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}), canApply: () => ok(undefined), alignment: 'pepperoni' as const, reaches: ['post' as const] };
  const veiling: Instance = {
    ...testInstance,
    cards: [
      ...testInstance.cards,
      { ...base, key: 'blind-study', name: 'Blind Study', rarity: 'uncommon', lasts: { unit: 'day', count: 3 }, veil: 'totals' },
      { ...base, key: 'overreaction', name: 'Overreaction', rarity: 'common', stack: 3, reaction: true },
    ],
  };
  const SKULL = '\u{1F480}';
  const skullKey = localKey(SKULL);
  let n = 0;
  /** A card play on a post, as the thread's plays hold it: the Act of the card, its configuration and its caster. */
  const play = (post: Id, card: string, caster: Id, payload: Record<string, unknown> = {}): Act => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, character: caster, kind: 'card', thread: 'thread', targetActId: post, seq: null,
    createdAt: '2026-10-29T12:00:00Z', payload: { card, message: '', config: {}, layer: 1, ...payload }, currentPayload: {}, editedAt: null, shownEditedAt: null,
  });
  const skull = (post: Id, caster: Id, quadrant = 'excitedPositive') => play(post, 'overreaction', caster, { config: { emoji: SKULL, quadrant } });
  /** One post's row on stores the test holds, with this plays' store, for the reader the world signs in (Pipewrench and Mrs. Hooligan). */
  function row(w: ReturnType<typeof world>, post: Id, author: Id | null, acts: readonly Act[]) {
    const tallies = createTallies();
    const mine = createMine();
    const plays = createPlays();
    plays.add(acts);
    const view = renderIn(w.fake, <Reactions act={post} author={author} authorName="Spritey" tallies={tallies} mine={mine} plays={plays} />, { instance: veiling });
    return { tallies, mine, plays, ...view };
  }

  describe('the row', () => {
    test('draws a chip for a local key from the key alone, named by the emoji and "added by a card", with its count', async () => {
      const w = world();
      const v = row(w, w.theirs, w.spritey, []);
      act(() => { v.tallies.merge(w.theirs, { fire: 1, [skullKey]: 2 }); });
      const chip = await screen.findByRole('button', { name: `${SKULL}, added by a card, 2. React as Mrs. Hooligan` });
      expect(chip).toHaveAttribute('data-kb-reaction', skullKey);
      expect(chip).toHaveTextContent(`${SKULL} 2`);
      expect(screen.getByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' })).toBeInTheDocument();
    });

    test('a key that is no emoji draws no chip', async () => {
      const w = world();
      const v = row(w, w.theirs, w.spritey, []);
      act(() => { v.tallies.merge(w.theirs, { fire: 1, 'x-zzzz': 4, 'x-110000': 4 }); });
      await screen.findByRole('button', { name: 'Fire, 1. React as Mrs. Hooligan' });
      expect(within(screen.getByRole('list', { name: 'Reactions' })).getAllByRole('listitem')).toHaveLength(1);
    });

    test('the quadrant\'s label is in the chip\'s name when a play of the card says it', async () => {
      const w = world();
      const v = row(w, w.theirs, w.spritey, [skull(w.theirs, w.spritey)]);
      act(() => { v.tallies.merge(w.theirs, { [skullKey]: 1 }); });
      expect(await screen.findByRole('button', { name: `${SKULL}, Hype, added by a card, 1. React as Mrs. Hooligan` })).toBeInTheDocument();
    });

    test('pressing it reacts with its key', async () => {
      const w = world();
      const v = row(w, w.theirs, w.spritey, []);
      act(() => { v.tallies.merge(w.theirs, { [skullKey]: 1 }); });
      const react = vi.spyOn(w.fake, 'react').mockResolvedValue({ ok: true, value: { act: w.theirs, tally: { [skullKey]: 2 } } });
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${SKULL}, added by a card, 1`, 'u') }));
      await afterGrace();
      expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, skullKey);
    });

    test('an ended kind is a chip with no press, since the server would refuse it', async () => {
      const w = world();
      const ended = skull(w.theirs, w.spritey);
      const v = row(w, w.theirs, w.spritey, [ended]);
      act(() => { v.plays.setEnded([ended.id]); v.tallies.merge(w.theirs, { [skullKey]: 3 }); });
      const list = await screen.findByRole('list', { name: 'Reactions' });
      expect(within(list).queryByRole('button')).toBeNull();
      expect(within(list).getByText(`${SKULL}, Hype, added by a card, 3`)).toBeInTheDocument();
    });
  });

  describe('the picker', () => {
    test('lists a local kind in its quadrant\'s group after the instance\'s, named by the emoji, the quadrant\'s label and "added by a card"', async () => {
      const w = world();
      row(w, w.theirs, w.spritey, [skull(w.theirs, w.spritey)]);
      const grid = await open();
      const hype = grid.getByRole('group', { name: 'Hype' });
      const buttons = within(hype).getAllByRole('button');
      expect(buttons.map((b) => b.getAttribute('data-kb-reaction'))).toEqual(['fire', skullKey]);
      expect(buttons[1]).toHaveAccessibleName(`${SKULL}, Hype, added by a card`);
      expect(buttons[1]).toHaveTextContent(SKULL);
    });

    test('an ended kind is not offered, nor a caught play\'s', async () => {
      const w = world();
      const ended = skull(w.theirs, w.spritey);
      const caught = play(w.theirs, 'overreaction', w.spritey, { config: { emoji: '\u{1F525}', quadrant: 'calmPositive' }, caught: 'some-set' });
      const v = row(w, w.theirs, w.spritey, [ended, caught]);
      act(() => { v.plays.setEnded([ended.id]); });
      const grid = await open();
      expect(grid.queryByRole('button', { name: /added by a card/u })).toBeNull();
      expect(grid.getAllByRole('button').flatMap((b) => b.getAttribute('data-kb-reaction') ?? [])).toEqual(['tomato', 'fire', 'zzz', 'tea']);
    });

    test('choosing a local kind reacts with its key', async () => {
      const w = world();
      row(w, w.theirs, w.spritey, [skull(w.theirs, w.spritey, 'boredNegative')]);
      const react = vi.spyOn(w.fake, 'react').mockResolvedValue({ ok: true, value: { act: w.theirs, tally: { [skullKey]: 1 } } });
      const grid = await open();
      await userEvent.click(grid.getByRole('button', { name: `${SKULL}, Groan, added by a card` }));
      await afterGrace();
      expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, skullKey);
    });

    test('the arrow keys reach it in the grid like any kind', async () => {
      const w = world();
      row(w, w.theirs, w.spritey, [skull(w.theirs, w.spritey, 'calmPositive')]);
      const grid = await open();
      const mine = grid.getByRole('button', { name: `${SKULL}, Calm, added by a card` });
      const tea = grid.getByRole('button', { name: /^Tea, Calm/u });
      expect([tea.dataset.kbRow, mine.dataset.kbRow]).toEqual(['1', '1']);
      expect(Number(mine.dataset.kbCol)).toBeGreaterThan(Number(tea.dataset.kbCol));
    });
  });

  describe('a blind post', () => {
    const when = '2099-01-02T15:30:00Z';
    const blind = (post: Id, caster: Id, ends = when) => play(post, 'blind-study', caster, { ends });
    const until = dayAndTime(when);

    test('for a third reader: no totals, her own reactions as chips with no number, and one line saying until when', async () => {
      const w = world();
      const v = row(w, w.theirs, w.spritey, [blind(w.theirs, w.fake.seed.character(w.fake.seed.account('caster'), 'Caster', 'face'))]);
      /* Counts she read before the card landed stay out of sight, and anything the page brings. */
      act(() => { v.tallies.merge(w.theirs, { fire: 4, tea: 2 }); v.mine.add({ act: w.theirs, kind: 'tea', character: w.hooligan }); });
      const list = await screen.findByRole('list', { name: 'Reactions' });
      await screen.findByRole('button', { name: 'React' });
      const chips = within(list).getAllByRole('listitem');
      expect(chips).toHaveLength(1);
      expect(within(list).getByRole('button', { name: 'Tea, yours, can\'t be taken back' })).toBeInTheDocument();
      expect(chips[0]).toHaveTextContent(/^E$/u);
      expect(chips[0]!.querySelector('[data-kb-own]')).not.toBeNull();
      expect(screen.getByText(`Reaction totals are hidden on this post until ${until}.`)).toBeInTheDocument();
      expect(screen.queryByText(/Only you and/u)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Fire/u })).toBeNull();
      expect(await screen.findByRole('button', { name: 'React' })).toBeInTheDocument();
    });

    test('useReactionChips hides counts exactly where the row does, and draws every count where the row does', async () => {
      const w = world();
      const Probe = ({ post, author, tallies, mine, plays }: { post: Id; author: Id | null; tallies: ReturnType<typeof createTallies>; mine: ReturnType<typeof createMine>; plays: ReturnType<typeof createPlays> }) => {
        const { shown } = useReactionChips(post, author, tallies, mine, plays);
        return <p data-testid="chips">{shown.map((c) => `${c.key}:${c.count === null ? 'hidden' : c.count}`).join(',')}</p>;
      };
      const tallies = createTallies();
      const mine = createMine();
      const plays = createPlays();
      const caster = w.fake.seed.character(w.fake.seed.account('caster'), 'Caster', 'face');
      plays.add([blind(w.theirs, caster)]);
      renderIn(w.fake, <><Probe post={w.theirs} author={w.spritey} tallies={tallies} mine={mine} plays={plays} /><Reactions act={w.theirs} author={w.spritey} authorName="Spritey" tallies={tallies} mine={mine} plays={plays} /></>, { instance: veiling });
      act(() => { tallies.merge(w.theirs, { fire: 4, tea: 2 }); mine.add({ act: w.theirs, kind: 'tea', character: w.hooligan }); });
      await screen.findByRole('button', { name: 'Tea, yours, can\'t be taken back' });
      expect(screen.getByTestId('chips')).toHaveTextContent(/^tea:hidden$/u);
      expect(screen.queryByRole('button', { name: /^Fire/u })).toBeNull();
    });

    test('useReactionChips gives every count to the author\'s player', async () => {
      const w = world();
      const Probe = ({ tallies, mine, plays }: { tallies: ReturnType<typeof createTallies>; mine: ReturnType<typeof createMine>; plays: ReturnType<typeof createPlays> }) => {
        const { shown } = useReactionChips(w.sibling, w.hooligan, tallies, mine, plays);
        return <p data-testid="chips">{shown.map((c) => `${c.key}:${c.count === null ? 'hidden' : c.count}`).join(',')}</p>;
      };
      const tallies = createTallies();
      const mine = createMine();
      const plays = createPlays();
      plays.add([blind(w.sibling, w.spritey)]);
      renderIn(w.fake, <Probe tallies={tallies} mine={mine} plays={plays} />, { instance: veiling });
      act(() => { tallies.merge(w.sibling, { fire: 2, tea: 1 }); });
      await waitFor(() => expect(screen.getByTestId('chips')).toHaveTextContent('fire:2,tea:1'));
    });

    test('with none of her own, the line stands alone', async () => {
      const w = world();
      row(w, w.theirs, w.spritey, [blind(w.theirs, w.spritey)]);
      expect(await screen.findByText(`Reaction totals are hidden on this post until ${until}.`)).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Reactions' })).toBeNull();
    });

    test('for the author\'s player the totals come as ever, with the line naming the caster', async () => {
      const w = world();
      const v = row(w, w.sibling, w.hooligan, [blind(w.sibling, w.spritey)]);
      act(() => { v.tallies.merge(w.sibling, { fire: 2, tea: 1 }); });
      const list = await screen.findByRole('list', { name: 'Reactions' });
      expect(within(list).getByText('Fire, 2')).toBeInTheDocument();
      expect(within(list).getByText('Tea, 1')).toBeInTheDocument();
      expect(screen.getByText(`Only you and the caster can see these until ${until}.`)).toBeInTheDocument();
      expect(screen.queryByText(/Reaction totals are hidden/u)).toBeNull();
    });

    test('for the caster the totals come as ever, with the line naming the author', async () => {
      const w = world();
      const v = row(w, w.theirs, w.spritey, [blind(w.theirs, w.pipe)]);
      act(() => { v.tallies.merge(w.theirs, { fire: 2 }); });
      expect(await screen.findByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' })).toBeInTheDocument();
      expect(screen.getByText(`Only you and the author can see these until ${until}.`)).toBeInTheDocument();
    });

    test('for one who is both, the line says only you', async () => {
      const w = world();
      row(w, w.sibling, w.hooligan, [blind(w.sibling, w.pipe)]);
      expect(await screen.findByText(`Only you can see these until ${until}.`)).toBeInTheDocument();
    });

    test('with no play of the card, or its play ended by an admin, the row is as ever', async () => {
      const w = world();
      const ended = blind(w.theirs, w.spritey);
      const v = row(w, w.theirs, w.spritey, [ended]);
      act(() => { v.plays.setEnded([ended.id]); v.tallies.merge(w.theirs, { fire: 2 }); });
      expect(await screen.findByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' })).toBeInTheDocument();
      expect(screen.queryByText(/Reaction totals are hidden|Only you/u)).toBeNull();
    });

    test('the line goes when its time passes, with nothing read', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const w = world();
        /* The page's clock is the backend's (`api.now()`), the fake's own, which the test advances. */
        const soon = new Date(w.fake.clock.now() + 5_000).toISOString();
        const v = row(w, w.theirs, w.spritey, [blind(w.theirs, w.spritey, soon)]);
        act(() => { v.tallies.merge(w.theirs, { fire: 2 }); });
        expect(await screen.findByText(/^Reaction totals are hidden on this post until /u)).toBeInTheDocument();
        await act(async () => { w.fake.clock.advance(6_000); await vi.advanceTimersByTimeAsync(6_000); });
        expect(screen.queryByText(/^Reaction totals are hidden/u)).toBeNull();
        expect(screen.getByRole('button', { name: 'Fire, 2. React as Mrs. Hooligan' })).toBeInTheDocument();
      } finally { vi.useRealTimers(); }
    });
  });
});

/* Reaction grace, Task 6: "Reactions can't be taken back" (design section 7), the glass tooltip on a press of your own sent kind. */
describe('the can\'t-be-taken-back tooltip', () => {
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const press = async (el: HTMLElement) => { await act(async () => {}); act(() => { fireEvent.click(el); }); };
  /* Fire is the player's own and sent (and counted twice); tea is another's. */
  const sent = () => {
    const w = world();
    const v = show(w, w.theirs, w.spritey);
    act(() => { v.tallies.merge(w.theirs, { fire: 2, tea: 1 }); v.mine.add({ act: w.theirs, kind: 'fire', character: w.pipe }); });
    return { w, v };
  };
  const OWN = 'Fire, 2, including yours, can\'t be taken back';

  test('the words are one constant', () => { expect(CANT_TAKE_BACK).toBe('Reactions can\'t be taken back.'); });

  test('pressing your own sent tile shows the tooltip with the words and sends nothing', async () => {
    const { w } = sent();
    const react = vi.spyOn(w.fake, 'react');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await press(await screen.findByRole('button', { name: OWN }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(CANT_TAKE_BACK);
    await wait(REACTION_GRACE_MS * 2);
    expect(react).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: OWN })).toHaveAttribute('aria-disabled', 'true');
  });

  test('a second press while it is open restarts its 3 seconds', async () => {
    sent();
    const own = await screen.findByRole('button', { name: OWN });
    await press(own);
    await wait(2000);
    await press(screen.getByRole('button', { name: OWN }));
    await wait(2000);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await wait(1100);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('pressing a different own tile while it is open moves the tooltip to that tile and gives it a fresh 3 seconds (no focus change)', async () => {
    const { w, v } = sent();
    act(() => { v.tallies.merge(w.theirs, { tomato: 1 }); v.mine.add({ act: w.theirs, kind: 'tomato', character: w.pipe }); });
    const fire = await screen.findByRole('button', { name: OWN });
    const tomato = screen.getByRole('button', { name: 'Tomato, 1, including yours, can\'t be taken back' });
    await press(fire);
    await wait(2000);
    await press(tomato);
    const tip = screen.getByRole('tooltip');
    expect(tomato.getAttribute('aria-describedby') ?? '').toContain(tip.id);
    expect(fire.getAttribute('aria-describedby') ?? '').not.toContain(tip.id);
    await wait(2500);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await wait(600);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('under full motion the tooltip leaves with its exit after the 3 seconds, and a press after it closed opens and says it again', async () => {
    sent();
    expect(document.documentElement.getAttribute('data-kb-motion')).not.toBe('reduce');
    await press(await screen.findByRole('button', { name: OWN }));
    await wait(3050);
    /* Just closed: the panel is still on the page, leaving (hidden from readers), for its exit. */
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.querySelector('.kb-tooltip-wrap[data-kb-exiting]')).not.toBeNull();
    /* (That the leaving panel is removed once its exit ends is Layers' own, held in glass/layer tests: Motion's frame loop does not run reliably late in this file.) */
    await press(screen.getByRole('button', { name: OWN }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(CANT_TAKE_BACK);
    await wait(200);
    expect(screen.getAllByRole('status').some((x) => x.textContent === CANT_TAKE_BACK)).toBe(true);
  });

  test('the tooltip is said in the polite status when it opens', async () => {
    sent();
    await press(await screen.findByRole('button', { name: OWN }));
    await wait(200);
    expect(screen.getAllByRole('status').some((x) => x.textContent === CANT_TAKE_BACK)).toBe(true);
  });

  test('the tile\'s name says it can\'t be taken back (the totals-hidden wording is held in the blind post\'s test)', async () => {
    sent();
    expect(await screen.findByRole('button', { name: OWN })).toBeInTheDocument();
  });

  test('a pending tile shows no tooltip when pressed: it undoes', async () => {
    const { w, v } = sent();
    await press(await screen.findByRole('button', { name: 'Tea, 1. React as Mrs. Hooligan' }));
    await press(screen.getByRole('button', { name: /^Tea, sending in/u }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(v.mine.pending(w.theirs)).toEqual([]);
  });

  describe('in the picker', () => {
    test('your own kind is aria-disabled and not disabled; pressing it shows the tooltip and the picker stays open and sends nothing', async () => {
      const { w } = sent();
      const react = vi.spyOn(w.fake, 'react');
      const p = await open();
      const own = p.getByRole('button', { name: 'Fire, Hype, your reaction' });
      expect(own).toHaveAttribute('aria-disabled', 'true');
      expect(own).not.toBeDisabled();
      expect(own).toHaveAttribute('data-kb-own', '');
      own.focus();
      await press(own);
      expect(screen.getByRole('tooltip')).toHaveTextContent(CANT_TAKE_BACK);
      expect(own).toHaveFocus();
      expect(own.getAttribute('aria-describedby') ?? '').toContain(screen.getByRole('tooltip').id);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await wait(REACTION_GRACE_MS * 2);
      expect(react).not.toHaveBeenCalled();
    });

    test('the arrow keys land on your own kind', async () => {
      sent();
      const p = await open();
      await waitFor(() => expect(p.getByRole('button', { name: 'Tomato, Heat' })).toHaveFocus());
      await userEvent.keyboard('{ArrowRight}');
      expect(p.getByRole('button', { name: 'Fire, Hype, your reaction' })).toHaveFocus();
    });

    test('a second press while it is open restarts its 3 seconds', async () => {
      sent();
      const p = await open();
      const own = p.getByRole('button', { name: 'Fire, Hype, your reaction' });
      await press(own);
      await wait(2000);
      await press(p.getByRole('button', { name: 'Fire, Hype, your reaction' }));
      await wait(2000);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      await wait(1100);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    test('pressing a different own kind while it is open moves the tooltip to that kind and gives it a fresh 3 seconds', async () => {
      const { w, v } = sent();
      act(() => { v.mine.add({ act: w.theirs, kind: 'tomato', character: w.pipe }); });
      const p = await open();
      const fire = p.getByRole('button', { name: 'Fire, Hype, your reaction' });
      const tomato = p.getByRole('button', { name: 'Tomato, Heat, your reaction' });
      await press(fire);
      await wait(2000);
      await press(tomato);
      const tip = screen.getByRole('tooltip');
      expect(tomato.getAttribute('aria-describedby') ?? '').toContain(tip.id);
      expect(fire.getAttribute('aria-describedby') ?? '').not.toContain(tip.id);
      await wait(2500);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      await wait(600);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    test('at the cap no grid is drawn, so no kind is offered to press', async () => {
      const { w, v } = sent();
      act(() => { v.mine.add({ act: w.theirs, kind: 'tomato', character: w.pipe }); v.mine.add({ act: w.theirs, kind: 'zzz', character: w.hooligan }); });
      const p = await open();
      /* At the cap no grid is drawn at all, so no kind is drawn disabled and none is an own kind button. */
      expect(p.queryAllByRole('button', { name: /your reaction/u }).length).toBe(0);
    });

    test('with one slot left a free kind is enabled and another\'s own stays aria-disabled', async () => {
      const { v, w } = sent();
      act(() => { v.mine.add({ act: w.theirs, kind: 'tomato', character: w.pipe }); });
      const p = await open();
      expect(p.getByRole('button', { name: 'Tea, Calm' })).toBeEnabled();
      expect(p.getByRole('button', { name: 'Tomato, Heat, your reaction' })).toHaveAttribute('aria-disabled', 'true');
    });

    test('choosing a free kind closes the picker at once, the row shows it pending, and nothing is sent until the grace ends', async () => {
      const { w, v } = sent();
      const react = vi.spyOn(w.fake, 'react');
      const p = await open();
      await userEvent.click(p.getByRole('button', { name: 'Tea, Calm' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: /^Tea, sending in/u })).toHaveAttribute('data-kb-pending', '');
      expect(react).not.toHaveBeenCalled();
      expect(v.mine.pending(w.theirs).map((x) => x.kind)).toEqual(['tea']);
      await afterGrace();
      expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'tea');
    });

    test('a pending kind is drawn as yours and pending; pressing it undoes it', async () => {
      const { w, v } = sent();
      const react = vi.spyOn(w.fake, 'react');
      act(() => { v.mine.hold({ act: w.theirs, kind: 'tea', character: w.hooligan, due: Date.now() + REACTION_GRACE_MS }); });
      const p = await open();
      const tea = p.getByRole('button', { name: /^Tea, Calm/u });
      expect(tea).toHaveAttribute('data-kb-own', '');
      expect(tea).toHaveAttribute('data-kb-pending', '');
      await press(tea);
      expect(v.mine.pending(w.theirs)).toEqual([]);
      expect(screen.queryByRole('tooltip')).toBeNull();
      await wait(REACTION_GRACE_MS * 2);
      expect(react).not.toHaveBeenCalled();
    });
  });
});
