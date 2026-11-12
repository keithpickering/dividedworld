/**
 * Blind Study's effect (card notes Part 3, Task 11): it draws the post's words and nothing else (the reaction row's own line is the
 * engine's), and tells the Lens the four states: totals hidden from this reader, shown to the author or the caster, and showing once it ends.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { BlindStudyEffect } from './Effect.tsx';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-08T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const UP = '2026-11-14T12:00:00Z';
const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'b1', card: 'blind-study', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-11T12:00:00Z', post: 'p1', ends: UP, ...over });

function setup(over: Partial<EffectProps> = {}) {
  const show = vi.fn<(view: CardView | null) => void>();
  const props: EffectProps = {
    post, plays: [play()], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
    show, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p>The words of the post.</p>, ...over,
  };
  return { show, ...render(<BlindStudyEffect {...props} />) };
}
const last = (show: ReturnType<typeof setup>['show']): CardView => show.mock.calls.filter((c) => c[0] !== null).at(-1)![0]!;

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Blind Study', () => {
  test('draws the post\'s words and nothing else', () => {
    const { container } = setup();
    expect(screen.getByText('The words of the post.')).toBeVisible();
    expect(container.textContent).toBe('The words of the post.');
  });

  test('a reader who is neither the author nor the caster: the totals are hidden from you', () => {
    expect(last(setup().show)).toMatchObject({ progress: null, state: 'Totals hidden from you', ends: `${endsWords(UP)} The totals show then.`, controls: [], yours: false, notes: {} });
  });

  test('the post\'s author and the caster see the totals', () => {
    for (const reader of [{ author: true, caster: false }, { author: false, caster: true }]) {
      const { show, unmount } = setup({ reader });
      expect(last(show)).toMatchObject({ state: 'Totals shown to you', ends: `${endsWords(UP)} The totals show then.` });
      unmount();
    }
  });

  test('once the play\'s end has passed the totals are showing', () => {
    for (const reader of [{ author: false, caster: false }, { author: true, caster: false }]) {
      const { show, unmount } = setup({ reader, plays: [play({ ends: '2026-11-10T12:00:00Z' })] });
      expect(last(show).state).toBe('Totals are showing');
      expect(last(show).ends).toBeUndefined();
      unmount();
    }
  });

  test('the Lens\'s word rules pass for every state', () => {
    const states = [{ reader: { author: false, caster: false } }, { reader: { author: true, caster: false } }, { reader: { author: false, caster: true } }, { plays: [play({ ends: '2026-11-10T12:00:00Z' })] }];
    for (const over of states) {
      const { show, unmount } = setup(over);
      expect(viewProblems(last(show), { holds: false, covers: false })).toEqual([]);
      unmount();
    }
  });

  test('in a moment it says the same and meets nothing', () => {
    const met = vi.fn();
    const { show } = setup({ still: true, met });
    expect(last(show).controls).toEqual([]);
    expect(met).not.toHaveBeenCalled();
  });

  test('in a moment the play was up whatever the clock says: the totals are not showing', () => {
    const { show } = setup({ still: true, plays: [play({ ends: '2026-11-10T12:00:00Z' })] });
    expect(last(show).state).toBe('Totals hidden from you');
    expect(last(show).ends).toBeDefined();
  });

  test('meets the card once when it is first drawn up, and not for a play already over', () => {
    const up = vi.fn();
    setup({ met: up });
    expect(up).toHaveBeenCalledTimes(1);
    cleanup();
    const over = vi.fn();
    setup({ met: over, plays: [play({ ends: '2026-11-10T12:00:00Z' })] });
    expect(over).not.toHaveBeenCalled();
  });

  test('clears its view when it goes', () => {
    const { show, unmount } = setup();
    unmount();
    expect(show).toHaveBeenLastCalledWith(null);
  });
});
