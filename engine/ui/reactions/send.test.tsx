import { act } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MyCharacter } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { createTallies } from '../thread/tallies.ts';
import { createMine, REACTION_GRACE_MS } from './mine.ts';
import { useReactionSend } from './send.ts';

/* The HUD's estimate is asked for through the player; this file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

beforeEach(() => { landed.mockClear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', 'face');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { act: theirs } = fake.seed.thread('general', spritey, 'A thread', 'their post');
  fake.signInAs(me);
  const as: MyCharacter = { id: hooligan, name: 'Mrs. Hooligan' } as MyCharacter;
  return { fake, me, hooligan, theirs, as };
}

function mount(w: ReturnType<typeof world>) {
  const tallies = createTallies();
  const mine = createMine();
  const answers: { kind: string; character: string; answer: unknown }[] = [];
  const out: { current: ReturnType<typeof useReactionSend> | null; setAs: (a: MyCharacter | null) => void } = { current: null, setAs: () => {} };
  const Probe = () => {
    const [as, setAs] = useState<MyCharacter | null>(w.as);
    out.setAs = setAs;
    out.current = useReactionSend({ act: w.theirs, as, tallies, mine, onAnswer: (a) => { answers.push(a); } });
    return null;
  };
  const view = renderIn(w.fake, <Probe />);
  return { tallies, mine, out, answers, view };
}

const grace = async (ms = REACTION_GRACE_MS) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useReactionSend', () => {
  test('a press sends nothing and holds the kind pending as the HUD character', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    let held: unknown;
    act(() => { held = v.out.current!.press('fire'); });
    expect(held).toBe('held');
    expect(react).not.toHaveBeenCalled();
    expect(v.mine.pending(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan, due: Date.now() + REACTION_GRACE_MS }]);
    expect(v.mine.get(w.theirs)).toEqual([]);
  });

  test('sends nothing a millisecond early; at the grace sends once, as the pressed character, and lands it', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); });
    await grace(REACTION_GRACE_MS - 1);
    expect(react).not.toHaveBeenCalled();
    await grace(1);
    expect(react).toHaveBeenCalledTimes(1);
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
    expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan }]);
    expect(v.mine.pending(w.theirs)).toEqual([]);
    expect(v.tallies.get(w.theirs)).toEqual({ fire: 1 });
    expect(v.answers).toEqual([{ kind: 'fire', character: w.hooligan, answer: 'sent' }]);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(v.out.current!.busy).toBe(false);
  });

  test('an undo within the grace sends nothing, ever, and empties pending', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); });
    await grace(REACTION_GRACE_MS - 1);
    let undone: boolean | undefined;
    act(() => { undone = v.out.current!.undo('fire'); });
    expect(undone).toBe(true);
    expect(v.mine.pending(w.theirs)).toEqual([]);
    await grace(REACTION_GRACE_MS * 3);
    expect(react).not.toHaveBeenCalled();
    expect(v.out.current!.undo('fire')).toBe(false);
    v.view.unmount();
    await grace(1);
    expect(react).not.toHaveBeenCalled();
  });

  test('a press of a kind already pending or sent answers busy', async () => {
    const w = world();
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); });
    expect(v.out.current!.press('fire')).toBe('busy');
    await grace();
    expect(v.out.current!.press('fire')).toBe('busy');
  });

  test('answers busy with no character to react as', () => {
    const w = world();
    const v = mount(w);
    act(() => { v.out.setAs(null); });
    expect(v.out.current!.press('fire')).toBe('busy');
    expect(v.mine.pending(w.theirs)).toEqual([]);
  });

  test('two kinds pressed a second apart send in order; the second, due while the first is in flight, is not dropped', async () => {
    const w = world();
    const real = w.fake.react.bind(w.fake);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    w.fake.react = async (...args: Parameters<typeof real>) => { if (first) { first = false; await gate; } return real(...args); };
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); });
    await grace(1000);
    act(() => { v.out.current!.press('tea'); });
    await grace(REACTION_GRACE_MS - 1000);
    expect(react).toHaveBeenCalledTimes(1);
    expect(v.out.current!.busy).toBe(true);
    await grace(1000);
    expect(react).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    expect(react.mock.calls.map((c) => c[2])).toEqual(['fire', 'tea']);
    expect(v.mine.get(w.theirs).map((r) => r.kind)).toEqual(['fire', 'tea']);
    expect(v.answers.map((a) => a.kind)).toEqual(['fire', 'tea']);
    expect(v.out.current!.busy).toBe(false);
  });

  test('a mask change after the press still sends as the first character', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); });
    act(() => { v.out.setAs({ id: 'someone-else', name: 'Else' } as unknown as MyCharacter); });
    await grace();
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
  });

  test('unmounting with one pending sends it at once', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); });
    await act(async () => { v.view.unmount(); await vi.advanceTimersByTimeAsync(0); });
    expect(react).toHaveBeenCalledTimes(1);
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
    expect(v.mine.get(w.theirs)).toHaveLength(1);
    await grace(REACTION_GRACE_MS * 2);
    expect(react).toHaveBeenCalledTimes(1);
  });

  test('unmounting sends only what this hook pressed', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    v.mine.hold({ act: w.theirs, kind: 'tea', character: w.hooligan, due: Date.now() + REACTION_GRACE_MS });
    await act(async () => { v.view.unmount(); await vi.advanceTimersByTimeAsync(0); });
    expect(react).not.toHaveBeenCalled();
  });

  test('pagehide sends what is pending at once, with keepalive, and only once', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); v.out.current!.press('tea'); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(0); });
    expect(react.mock.calls).toEqual([[w.theirs, w.hooligan, 'fire', { keepalive: true }], [w.theirs, w.hooligan, 'tea', { keepalive: true }]]);
    await grace(REACTION_GRACE_MS * 2);
    expect(react).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(0); });
    expect(react).toHaveBeenCalledTimes(2);
  });

  test('removes its pagehide listener when nothing is pending', () => {
    const w = world();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const v = mount(w);
    const hides = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === 'pagehide').length;
    act(() => { v.out.current!.press('fire'); });
    expect(hides(add)).toBe(1);
    act(() => { v.out.current!.undo('fire'); });
    expect(hides(remove)).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });

  test('a refusal releases the pending kind, answers in the server\'s words, and takes the player\'s own reactions from the re-read', async () => {
    const w = world();
    /* Another tab left Tea; this screen's `mine` does not know yet. */
    w.fake.seed.react(w.me, w.hooligan, w.theirs, 'tea');
    const mineRead = vi.spyOn(w.fake, 'myReactions');
    w.fake.react = async () => ({ ok: false as const, error: 'you have left 3 reactions here, the most there are' });
    const v = mount(w);
    expect(v.mine.get(w.theirs)).toEqual([]);
    act(() => { v.out.current!.press('fire'); });
    expect(v.mine.pending(w.theirs)).toHaveLength(1);
    await grace();
    expect(v.answers).toEqual([{ kind: 'fire', character: w.hooligan, answer: { refusal: 'you have left 3 reactions here, the most there are' } }]);
    expect(v.mine.pending(w.theirs)).toEqual([]);
    expect(mineRead).toHaveBeenCalledWith([w.theirs]);
    expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'tea', character: w.hooligan }]);
    expect(v.tallies.get(w.theirs)).toEqual({});
    expect(landed).not.toHaveBeenCalled();
  });

  test('a failure of the re-read does not replace the server\'s words', async () => {
    const w = world();
    w.fake.react = async () => ({ ok: false as const, error: 'the server\'s words' });
    const v = mount(w);
    v.mine.merge = () => { throw new Error('merge broke'); };
    act(() => { v.out.current!.press('tea'); });
    await grace();
    expect(v.answers).toEqual([{ kind: 'tea', character: w.hooligan, answer: { refusal: 'the server\'s words' } }]);
  });

  test('a throw is a refusal in the plain sentence, adds nothing, releases the kind, and the next press works', async () => {
    const w = world();
    const real = w.fake.react.bind(w.fake);
    w.fake.react = async () => { throw new Error('offline'); };
    const v = mount(w);
    act(() => { v.out.current!.press('tea'); });
    await grace();
    expect(v.answers[0]!.answer).toEqual({ refusal: 'The reaction could not be sent. Try again.' });
    expect(v.mine.get(w.theirs)).toEqual([]);
    expect(v.mine.pending(w.theirs)).toEqual([]);
    expect(v.tallies.get(w.theirs)).toEqual({});
    expect(v.out.current!.busy).toBe(false);
    w.fake.react = real;
    act(() => { v.out.current!.press('tea'); });
    await grace();
    expect(v.answers[1]!.answer).toBe('sent');
  });

  test('asks for the estimate once per sent kind', async () => {
    const w = world();
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); v.out.current!.press('tea'); });
    await grace();
    expect(v.answers.map((a) => a.answer)).toEqual(['sent', 'sent']);
    expect(landed).toHaveBeenCalledTimes(2);
  });

  test('a pending kind is undoable from another row of the Act: nothing is ever sent, pending empties and the first row\'s pagehide listener is gone', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const a = mount(w);
    const tallies = createTallies();
    const second: { current: ReturnType<typeof useReactionSend> | null } = { current: null };
    const Other = () => { second.current = useReactionSend({ act: w.theirs, as: w.as, tallies, mine: a.mine, onAnswer: () => {} }); return null; };
    renderIn(w.fake, <Other />);
    act(() => { a.out.current!.press('fire'); });
    await grace(1000);
    let undone: boolean | undefined;
    act(() => { undone = second.current!.undo('fire'); });
    expect(undone).toBe(true);
    expect(a.mine.pending(w.theirs)).toEqual([]);
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(0); });
    await grace(REACTION_GRACE_MS * 2);
    expect(react).not.toHaveBeenCalled();
    expect(a.mine.get(w.theirs)).toEqual([]);
    expect(second.current!.undo('fire')).toBe(false);
  });

  test('a kind already taken onto the queue answers false to another row\'s undo, and is sent once', async () => {
    const w = world();
    const real = w.fake.react.bind(w.fake);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    w.fake.react = async (...args: Parameters<typeof real>) => { await gate; return real(...args); };
    const react = vi.spyOn(w.fake, 'react');
    const a = mount(w);
    const second: { current: ReturnType<typeof useReactionSend> | null } = { current: null };
    const Other = () => { second.current = useReactionSend({ act: w.theirs, as: w.as, tallies: createTallies(), mine: a.mine, onAnswer: () => {} }); return null; };
    renderIn(w.fake, <Other />);
    act(() => { a.out.current!.press('fire'); });
    await grace();
    expect(second.current!.undo('fire')).toBe(false);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    expect(react).toHaveBeenCalledTimes(1);
    expect(a.mine.get(w.theirs)).toHaveLength(1);
  });

  test('two rows of one Act send one at a time: the second row\'s due send waits for the first\'s answer', async () => {
    const w = world();
    const real = w.fake.react.bind(w.fake);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    w.fake.react = async (...args: Parameters<typeof real>) => { if (first) { first = false; await gate; } return real(...args); };
    const react = vi.spyOn(w.fake, 'react');
    const a = mount(w);
    const answersB: string[] = [];
    const second: { current: ReturnType<typeof useReactionSend> | null } = { current: null };
    const Other = () => { second.current = useReactionSend({ act: w.theirs, as: w.as, tallies: createTallies(), mine: a.mine, onAnswer: (x) => { answersB.push(x.kind); } }); return null; };
    renderIn(w.fake, <Other />);
    act(() => { a.out.current!.press('fire'); });
    await grace(1000);
    act(() => { second.current!.press('tea'); });
    await grace(REACTION_GRACE_MS);
    expect(react).toHaveBeenCalledTimes(1);
    await grace(1000);
    expect(react).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    expect(react.mock.calls.map((c) => c[2])).toEqual(['fire', 'tea']);
    expect(a.answers.map((x) => x.kind)).toEqual(['fire']);
    expect(answersB).toEqual(['tea']);
  });

  test('a refusal of the first queued kind still sends the second, and each answer reaches onAnswer', async () => {
    const w = world();
    const real = w.fake.react.bind(w.fake);
    w.fake.react = async (...args: Parameters<typeof real>) => (args[2] === 'fire' ? { ok: false as const, error: 'no fire' } : real(...args));
    const v = mount(w);
    act(() => { v.out.current!.press('fire'); v.out.current!.press('tea'); });
    await grace();
    expect(v.answers).toEqual([{ kind: 'fire', character: w.hooligan, answer: { refusal: 'no fire' } }, { kind: 'tea', character: w.hooligan, answer: 'sent' }]);
    expect(v.mine.pending(w.theirs)).toEqual([]);
    expect(v.mine.get(w.theirs).map((r) => r.kind)).toEqual(['tea']);
  });

  test('an onAnswer that throws strands nothing: the rest of the lane is sent and the kind can be pressed again', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const mine = createMine();
    const boom: { current: ReturnType<typeof useReactionSend> | null } = { current: null };
    const Probe = () => { boom.current = useReactionSend({ act: w.theirs, as: w.as, tallies: createTallies(), mine, onAnswer: () => { throw new Error('ui broke'); } }); return null; };
    renderIn(w.fake, <Probe />);
    act(() => { boom.current!.press('fire'); boom.current!.press('tea'); });
    await grace();
    expect(react).toHaveBeenCalledTimes(2);
    expect(mine.get(w.theirs)).toHaveLength(2);
    expect(boom.current!.busy).toBe(false);
  });
});
