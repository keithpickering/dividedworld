/**
 * `useMachine`: the machine's slots as the server shows them, with what a screen needs to say plainly when they cannot be had: a
 * first read that has not answered (loading, so no screen says "empty" before it knows), a read that failed (no slots, never a guess),
 * and reads that overlap (the latest request is the one shown).
 */
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Slot } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { useMachine } from './machine.ts';

function Probe() {
  const { slots, status, look } = useMachine();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="slots">{slots === null ? 'none' : slots.map((s) => s.price).join(',')}</p>
      <button type="button" onClick={() => void look()}>Look</button>
    </div>
  );
}

const slot = (price: number): Slot => ({ id: `s${price}`, position: 1, item: { card: 'whoops' }, rarity: 'common', availability: 'onSale', price, move: null });
const text = (id: string) => screen.getByTestId(id).textContent;

describe('the machine as a screen reads it', () => {
  test('is loading until the first read answers, and ready after it', async () => {
    const fake = buildWorld();
    let answer: (s: readonly Slot[]) => void = () => {};
    vi.spyOn(fake, 'machine').mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderIn(fake, <Probe />);
    expect(text('status')).toBe('loading');
    expect(text('slots')).toBe('none');
    await act(async () => { answer([slot(100)]); });
    expect(text('status')).toBe('ready');
    expect(text('slots')).toBe('100');
  });

  test('a read that fails is failed, with no slots, and a look again can recover', async () => {
    const fake = buildWorld();
    const read = vi.spyOn(fake, 'machine').mockRejectedValueOnce(new Error('down'));
    renderIn(fake, <Probe />);
    await waitFor(() => expect(text('status')).toBe('failed'));
    expect(text('slots')).toBe('none');
    read.mockResolvedValueOnce([slot(250)]);
    await act(async () => { screen.getByRole('button', { name: 'Look' }).click(); });
    await waitFor(() => expect(text('status')).toBe('ready'));
    expect(text('slots')).toBe('250');
  });

  test('an answer older than the latest request is ignored, however late it lands', async () => {
    const fake = buildWorld();
    const answers: ((s: readonly Slot[]) => void)[] = [];
    vi.spyOn(fake, 'machine').mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    renderIn(fake, <Probe />);
    await act(async () => { screen.getByRole('button', { name: 'Look' }).click(); });
    expect(answers).toHaveLength(2);
    /* The second request answers first; the first, older, answers after it and must not replace it. */
    await act(async () => { answers[1]!([slot(175)]); });
    await act(async () => { answers[0]!([slot(100)]); });
    expect(text('slots')).toBe('175');
    expect(text('status')).toBe('ready');
  });

  test('a stale failure does not undo a newer answer', async () => {
    const fake = buildWorld();
    const settle: { ok: (s: readonly Slot[]) => void; no: (e: Error) => void }[] = [];
    vi.spyOn(fake, 'machine').mockImplementation(() => new Promise((ok, no) => { settle.push({ ok, no }); }));
    renderIn(fake, <Probe />);
    await act(async () => { screen.getByRole('button', { name: 'Look' }).click(); });
    await act(async () => { settle[1]!.ok([slot(175)]); });
    await act(async () => { settle[0]!.no(new Error('late')); });
    expect(text('status')).toBe('ready');
    expect(text('slots')).toBe('175');
  });
});
