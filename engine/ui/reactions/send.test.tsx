import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MyCharacter } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { createTallies } from '../thread/tallies.ts';
import { createMine } from './mine.ts';
import { useReactionSend } from './send.ts';

/* The HUD's estimate is asked for through the player; this file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

beforeEach(() => { landed.mockClear(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', 'face');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { act: theirs } = fake.seed.thread('general', spritey, 'A thread', 'their post');
  fake.signInAs(me);
  const as: MyCharacter = { id: hooligan, name: 'Mrs. Hooligan' } as MyCharacter;
  return { fake, hooligan, theirs, as };
}

function mount(w: ReturnType<typeof world>) {
  const tallies = createTallies();
  const mine = createMine();
  const out: { current: ReturnType<typeof useReactionSend> | null } = { current: null };
  const Probe = () => { out.current = useReactionSend({ act: w.theirs, as: w.as, tallies, mine }); return null; };
  renderIn(w.fake, <Probe />);
  return { tallies, mine, out };
}

describe('useReactionSend', () => {
  test('records the reaction as the HUD character, merges the tally, adds to mine and asks for the estimate once', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    let result: unknown;
    await act(async () => { result = await v.out.current!.send('fire'); });
    expect(result).toBe('sent');
    expect(react).toHaveBeenCalledWith(w.theirs, w.hooligan, 'fire');
    expect(v.mine.get(w.theirs)).toEqual([{ act: w.theirs, kind: 'fire', character: w.hooligan }]);
    expect(v.tallies.get(w.theirs)).toEqual({ fire: 1 });
    expect(landed).toHaveBeenCalledTimes(1);
    expect(v.out.current!.busy).toBe(false);
  });

  test('answers a refusal in the server\'s words and re-reads the player\'s own reactions', async () => {
    const w = world();
    const mineRead = vi.spyOn(w.fake, 'myReactions');
    w.fake.react = async () => ({ ok: false as const, error: 'you have left 3 reactions here, the most there are' });
    const v = mount(w);
    let result: unknown;
    await act(async () => { result = await v.out.current!.send('tea'); });
    expect(result).toEqual({ refusal: 'you have left 3 reactions here, the most there are' });
    expect(mineRead).toHaveBeenCalledWith([w.theirs]);
    expect(landed).not.toHaveBeenCalled();
  });

  test('answers a throw with the plain sentence', async () => {
    const w = world();
    w.fake.react = async () => { throw new Error('offline'); };
    const v = mount(w);
    let result: unknown;
    await act(async () => { result = await v.out.current!.send('tea'); });
    expect(result).toEqual({ refusal: 'The reaction could not be sent. Try again.' });
  });

  test('a second send while the first is in flight answers busy, and the fake holds one reaction', async () => {
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    const v = mount(w);
    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = v.out.current!.send('fire');
      second = await v.out.current!.send('tea');
      await first;
    });
    expect(second).toBe('busy');
    await waitFor(() => expect(v.out.current!.busy).toBe(false));
    expect(react).toHaveBeenCalledTimes(1);
    expect(v.mine.get(w.theirs)).toHaveLength(1);
  });
});
