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
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import { BlindStudyEffect } from './Effect.tsx';

/** The page's clock is the backend's (`api.now()`); a test's is its own fake one. */
const kayfa = { api: { now: () => Date.now() } } as unknown as Kayfa;
const inPage = (el: React.ReactElement) => <KayfaProvider value={kayfa}>{el}</KayfaProvider>;

const NOW = Date.parse('2026-11-12T12:00:00Z');
const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-08T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const UP = '2026-11-14T12:00:00Z';
const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'b1', card: 'blind-study', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-11T12:00:00Z', post: 'p1', ends: UP, ...over });

function setup(over: Partial<EffectProps> = {}) {
  const show = vi.fn<(view: CardView | null) => void>();
  const props: EffectProps = {
    covered: false,
    post, plays: [play()], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false, moment: null,
    show, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p>The words of the post.</p>, ...over,
  };
  return { show, ...render(inPage(<BlindStudyEffect {...props} />)) };
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
    expect(last(setup().show)).toMatchObject({ progress: null, state: 'Totals hidden from you', ends: `${endsWords(UP, NOW)} The totals show then.`, controls: [], yours: false, notes: {} });
  });

  test('the post\'s author and the caster see the totals', () => {
    for (const reader of [{ author: true, caster: false }, { author: false, caster: true }]) {
      const { show, unmount } = setup({ reader });
      expect(last(show)).toMatchObject({ state: 'Totals shown to you', ends: `${endsWords(UP, NOW)} The totals show then.` });
      unmount();
    }
  });

  test('once the play\'s end has passed it gives no view: the engine says a spent kind\'s heading', () => {
    for (const reader of [{ author: false, caster: false }, { author: true, caster: false }]) {
      const { show, unmount } = setup({ reader, plays: [play({ ends: '2026-11-10T12:00:00Z' })] });
      expect(show.mock.calls.at(-1)![0]).toBeNull();
      unmount();
    }
  });

  test('the Lens\'s word rules pass for every state', () => {
    const states = [{ reader: { author: false, caster: false } }, { reader: { author: true, caster: false } }, { reader: { author: false, caster: true } }];
    for (const over of states) {
      const { show, unmount } = setup(over);
      expect(viewProblems(last(show), { holds: false, covers: false })).toEqual([]);
      unmount();
    }
  });

  /* The moment's time is before the play's end; today's clock (NOW) is after it. */
  const AT = Date.parse('2026-11-09T12:00:00Z');
  test('in a moment it says the same and meets nothing', () => {
    const met = vi.fn();
    const { show } = setup({ moment: { at: AT }, met });
    expect(last(show).state).toBe('Totals hidden from you');
    expect(last(show).controls).toEqual([]);
    expect(met).not.toHaveBeenCalled();
  });

  test('in a moment before the end the play is up whatever today\'s clock says: the totals are not showing, and nothing is met', () => {
    const met = vi.fn();
    const { show } = setup({ moment: { at: AT }, met, plays: [play({ ends: '2026-11-10T12:00:00Z' })] });
    expect(last(show).state).toBe('Totals hidden from you');
    expect(last(show).ends).toBeDefined();
    expect(met).not.toHaveBeenCalled();
  });

  test('on a live post with the same clock the totals are showing, whatever a stale `still` flag says', () => {
    const { show } = setup({ still: true, moment: null, plays: [play({ ends: '2026-11-10T12:00:00Z' })] });
    expect(show.mock.calls.at(-1)![0]).toBeNull();
    cleanup();
    const met = vi.fn();
    setup({ still: true, moment: null, met });
    expect(met).toHaveBeenCalledTimes(1);
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
