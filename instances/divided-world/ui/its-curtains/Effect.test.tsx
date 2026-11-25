/**
 * It's Curtains' effect (docs/plans/2026-11-23-its-curtains-plan.md, Task 6). In a thread's post the engine draws the cover over the row and gives the effect `cover`: it
 * draws the words alone and only tells the Lens. Where a post has no row (the ORIGIN box, a moment, History) it covers the content area itself, keeps its own count of
 * opened curtains, makes the words under it inert and says they are covered, and the Lens's state and controls follow the reader's presses: Open, then Encore.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps, RowCover } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { useCovered } from '../../../../engine/ui/thread/cover.tsx';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { __stopConfetti } from './confetti.ts';
import { __resetPointer } from './Curtain.tsx';
import { ItsCurtainsEffect, stateOf } from './Effect.tsx';

vi.mock('../../../../engine/ui/audio/sound.ts', async (original) => {
  const actual = await original<typeof import('../../../../engine/ui/audio/sound.ts')>();
  return { ...actual, useSound: () => ({ play: async () => null, loop: () => ({ setGain() {}, stop() {} }), caption() {} }) };
});

const post = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-25T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const play = (id: string, layer: number, fabric = 'red'): CardPlay => ({ id, card: 'its-curtains', layer, caster: 'c2', message: '', config: { fabric }, playedAt: '2026-11-25T12:00:00Z', post: 'p1' });

/** What the words under the curtain are told: whether they are covered. */
function Probe() {
  return <p data-covered={String(useCovered())}>The words of the post.</p>;
}

function mount(over: Partial<EffectProps> = {}) {
  const show = vi.fn<(view: CardView | null) => void>();
  const met = vi.fn();
  const props: EffectProps = {
    covered: false,
    post, plays: [play('a', 1)], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false, moment: null,
    show, met, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <Probe />, ...over,
  };
  const view = renderInWorld(<div data-kb-content-area=""><ItsCurtainsEffect {...props} /></div>);
  return { show, met, props, ...view };
}
const last = (show: ReturnType<typeof mount>['show']): CardView => show.mock.calls.filter((c) => c[0] !== null).at(-1)![0]!;
const rowCover = (shut: number, total: number): RowCover => ({ shut, total, open: vi.fn(), encore: vi.fn() });
const words = () => screen.getByText('The words of the post.');

beforeEach(() => {
  __resetPointer();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});
afterEach(() => { cleanup(); __stopConfetti(); document.documentElement.removeAttribute('data-kb-motion'); });

describe('with the engine\'s cover (a post in a thread)', () => {
  test('draws the words alone: no curtain of its own, nothing made inert', () => {
    const { container } = mount({ cover: rowCover(1, 1) });
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[inert]')).toBeNull();
    expect(words()).toBeVisible();
  });

  test('tells the Lens the cover\'s state: one curtain shut, with Open as the control', () => {
    const c = rowCover(1, 1);
    const { show } = mount({ cover: c });
    const view = last(show);
    expect(view.state).toBe('Shut for you');
    expect(view.yours).toBe(true);
    expect(view.controls).toEqual([{ kind: 'press', label: 'Open the curtain', run: c.open }]);
    expect(viewProblems(view, { holds: false, covers: true })).toEqual([]);
  });

  test('tells which of a stack the reader is at, and ends in Encore once all are open', () => {
    const c = rowCover(2, 3);
    const { show, unmount } = mount({ cover: c, plays: [play('b', 2), play('a', 1)] });
    expect(last(show).state).toBe('2 of 3 shut for you');
    expect(viewProblems(last(show), { holds: false, covers: true })).toEqual([]);
    unmount();
    const open = rowCover(0, 3);
    const again = mount({ cover: open });
    expect(last(again.show).state).toBe('Open for you');
    expect(last(again.show).yours).toBe(false);
    expect(last(again.show).controls).toEqual([{ kind: 'press', label: 'Encore', run: open.encore }]);
  });

  test('has met the card once it is first drawn, and a moment meets nothing', () => {
    const live = mount({ cover: rowCover(1, 1) });
    expect(live.met).toHaveBeenCalledTimes(1);
    live.unmount();
    const moment = mount({ cover: rowCover(1, 1), moment: { at: 0 } });
    expect(moment.met).not.toHaveBeenCalled();
  });

  test('clears the Lens\'s view when it goes', () => {
    const { show, unmount } = mount({ cover: rowCover(1, 1) });
    unmount();
    expect(show).toHaveBeenLastCalledWith(null);
  });
});

describe('without a cover (the ORIGIN box, a moment, History)', () => {
  test('covers the content area it stands in, and says its words are covered', () => {
    const { container } = mount();
    const area = container.querySelector('[data-kb-content-area]')!;
    expect(area.querySelector('.dw-curtain-overlay button')).toHaveAccessibleName('Open the curtain');
    expect(words()).toHaveAttribute('data-covered', 'true');
    expect(words().closest('[inert]')).not.toBeNull();
  });

  test('the Lens goes from "Shut for you" with Open to "Open for you" with Encore, and back on Encore', () => {
    const { show } = mount();
    expect(last(show).state).toBe('Shut for you');
    expect(last(show).yours).toBe(true);
    expect(last(show).controls.map((c) => c.kind === 'press' && c.label)).toEqual(['Open the curtain']);
    fireEvent.click(screen.getByRole('button', { name: 'Open the curtain' }), { detail: 1 });
    expect(screen.queryByRole('button', { name: 'Open the curtain' })).toBeNull();
    expect(words()).toHaveAttribute('data-covered', 'false');
    expect(words().closest('[inert]')).toBeNull();
    expect(last(show).state).toBe('Open for you');
    expect(last(show).yours).toBe(false);
    const encore = last(show).controls[0]!;
    expect(encore).toMatchObject({ kind: 'press', label: 'Encore' });
    act(() => { if (encore.kind === 'press') encore.run(); });
    expect(last(show).state).toBe('Shut for you');
    expect(screen.getByRole('button', { name: 'Open the curtain' })).toBeInTheDocument();
    expect(words()).toHaveAttribute('data-covered', 'true');
  });

  test('a stack is opened one at a time, outermost first, and the Lens counts them', () => {
    const { show } = mount({ plays: [play('a', 1, 'gold'), play('b', 2, 'royal-blue')] });
    expect(last(show).state).toBe('2 of 2 shut for you');
    expect(screen.getByRole('button', { name: 'Open the curtain, 1 of 2' })).toHaveAttribute('data-dw-fabric', 'royal-blue');
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    expect(screen.getByRole('button', { name: 'Open the curtain, 2 of 2' })).toHaveAttribute('data-dw-fabric', 'gold');
    expect(last(show).state).toBe('1 of 2 shut for you');
    expect(words()).toHaveAttribute('data-covered', 'true');
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    expect(last(show).state).toBe('Open for you');
  });

  test('the Lens\'s Open control opens one too', () => {
    const { show } = mount();
    const open = last(show).controls[0]!;
    act(() => { if (open.kind === 'press') open.run(); });
    expect(last(show).state).toBe('Open for you');
  });

  test('every view it gives holds to the Lens\'s words', () => {
    const { show } = mount({ plays: [play('a', 1), play('b', 2)] });
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    for (const [v] of show.mock.calls) if (v) expect(viewProblems(v, { holds: false, covers: v.yours })).toEqual([]);
  });

  test('has met the card at its first draw, once', () => {
    const { met } = mount();
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    expect(met).toHaveBeenCalledTimes(1);
  });
});

describe('the Lens\'s state counts what is shut, not where the reader stands', () => {
  test('3 shut of 3 says 3, and 1 shut of 3 says 1', () => {
    expect(stateOf(3, 3)).toBe('3 of 3 shut for you');
    expect(stateOf(1, 3)).toBe('1 of 3 shut for you');
    expect(stateOf(0, 3)).toBe('Open for you');
    expect(stateOf(1, 1)).toBe('Shut for you');
  });
});
