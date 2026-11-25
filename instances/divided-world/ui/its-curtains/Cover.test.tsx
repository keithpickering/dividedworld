/**
 * The row cover the engine mounts over a thread's post (docs/plans/2026-11-23-its-curtains-plan.md, Task 6; engine/ui/thread/cover.tsx): the outermost shut curtain
 * in its fabric, the next under it, the press counting from the outermost, and the engine's open called when the halves are out.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardPlay, RowCover } from '../../../../engine/ui/cards/types.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { __stopConfetti } from './confetti.ts';
import { ItsCurtainsCover } from './Cover.tsx';
import { __resetPointer } from './Curtain.tsx';
import { TUNING } from './tuning.ts';

const hub = vi.hoisted(() => ({ play: vi.fn(async () => null), loop: vi.fn(() => ({ setGain: vi.fn(), stop: vi.fn() })) }));
vi.mock('../../../../engine/ui/audio/sound.ts', async (original) => {
  const actual = await original<typeof import('../../../../engine/ui/audio/sound.ts')>();
  return { ...actual, useSound: () => ({ play: hub.play, loop: hub.loop, caption: vi.fn() }) };
});

const play = (id: string, fabric: unknown, layer: number): CardPlay => ({ id, card: 'its-curtains', layer, caster: 'c1', message: '', config: { fabric }, playedAt: '2026-11-25T10:00:00.000Z', post: 'p1' });
const cover = (shut: number, total: number) => ({ shut, total, open: vi.fn(), encore: vi.fn() }) satisfies RowCover;

beforeEach(() => {
  __resetPointer();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillRect() {}, fillStyle: '' })) as never;
});
afterEach(() => { cleanup(); __stopConfetti(); vi.useRealTimers(); document.documentElement.removeAttribute('data-kb-motion'); });

describe('the row cover', () => {
  test('draws the outermost shut curtain in its fabric, and the next one under it', () => {
    const c = cover(2, 2);
    const { container } = renderInWorld(<ItsCurtainsCover plays={[play('b', 'royal-blue', 2), play('a', 'gold', 1)]} cover={c} post="p1" />);
    expect(container.querySelector('button[data-dw-fabric="royal-blue"]')).not.toBeNull();
    expect(container.querySelector('[data-dw-under][data-dw-fabric="gold"]')).not.toBeNull();
  });

  test('a lone curtain has none under it, and its button says no count', () => {
    const { container } = renderInWorld(<ItsCurtainsCover plays={[play('a', 'emerald', 1)]} cover={cover(1, 1)} post="p1" />);
    expect(container.querySelector('[data-dw-under]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the curtain' })).toBeInTheDocument();
  });

  test('counts from the outermost: 1 of 3, and once one is open 2 of 3', () => {
    const view = renderInWorld(<ItsCurtainsCover plays={[play('c', 'red', 3), play('b', 'gold', 2), play('a', 'black', 1)]} cover={cover(3, 3)} post="p1" />);
    expect(screen.getByRole('button', { name: 'Open the curtain, 1 of 3' })).toBeInTheDocument();
    view.unmount();
    renderInWorld(<ItsCurtainsCover plays={[play('b', 'gold', 2), play('a', 'black', 1)]} cover={cover(2, 3)} post="p1" />);
    expect(screen.getByRole('button', { name: 'Open the curtain, 2 of 3' })).toBeInTheDocument();
  });

  test('a fabric that is not on the list is drawn red', () => {
    const { container } = renderInWorld(<ItsCurtainsCover plays={[play('a', '#00ff00', 1)]} cover={cover(1, 1)} post="p1" />);
    expect(container.querySelector('button[data-dw-fabric="red"]')).not.toBeNull();
  });

  test('a press opens the engine\'s cover once the halves are out, not before', () => {
    vi.useFakeTimers();
    const c = cover(1, 1);
    renderInWorld(<ItsCurtainsCover plays={[play('a', 'purple', 1)]} cover={c} post="p1" />);
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    expect(c.open).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(TUNING.openMs + TUNING.settleMs + 1); });
    expect(c.open).toHaveBeenCalledTimes(1);
  });

  test('draws nothing when no curtain is left shut', () => {
    const { container } = renderInWorld(<ItsCurtainsCover plays={[]} cover={cover(0, 1)} post="p1" />);
    expect(container.querySelector('[data-dw-curtain]')).toBeNull();
  });
});
