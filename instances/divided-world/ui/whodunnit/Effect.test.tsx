/**
 * Whodunnit?'s effect (card notes Part 3, Task 11): while the veil is up the post is drawn as it is, with the Lens told who it hides the
 * author from; once the play's end has passed the post carries one line under its words saying the card wore off and whose post it was
 * all along; a play an admin ended draws no line; a moment draws it as it was up, whatever the clock says, and binds nothing.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { dayAndTime } from '../../../../engine/ui/characters/format.ts';
import { ThreadCtx, type ThreadContext } from '../../../../engine/ui/thread/context.ts';
import { WhodunnitEffect } from './Effect.tsx';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-08T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const UP = '2026-11-14T12:00:00Z';
const OVER = '2026-11-10T12:00:00Z';
const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'w1', card: 'whodunnit', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-11T12:00:00Z', post: 'p1', ends: UP, ...over });

function setup(over: Partial<EffectProps> = {}, standIn: string | null = null) {
  const show = vi.fn<(view: CardView | null) => void>();
  const met = vi.fn();
  const props: EffectProps = {
    post, plays: [play()], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
    show, met, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: (c) => (c === 'c1' ? 'Gloomba' : 'Spritey'), give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p>The words of the post.</p>, ...over,
  };
  /* The thread knows which character is the veil's stand-in (office `anonymous`); `standIn` is that, the engine's answer for this page. */
  const ctx = { standIn: (c: string | null) => c === standIn } as unknown as ThreadContext;
  const tree = (p: EffectProps) => <ThreadCtx.Provider value={ctx}><WhodunnitEffect {...p} /></ThreadCtx.Provider>;
  const out = render(tree(props));
  return { show, met, props, ...out, again: (next: Partial<EffectProps>) => out.rerender(tree({ ...props, ...next })) };
}
const last = (show: ReturnType<typeof setup>['show']): CardView => show.mock.calls.filter((c) => c[0] !== null).at(-1)![0]!;

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Whodunnit? while it is up', () => {
  test('draws the post\'s words and nothing over them, no line and no controls', () => {
    const { container } = setup();
    expect(screen.getByText('The words of the post.')).toBeVisible();
    expect(container.querySelector('.dw-whodunnit-wore')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(last(setup().show).controls).toEqual([]);
  });

  test('says the reader\'s view: the author is hidden from everyone, and when the name comes back', () => {
    const { show } = setup();
    const view = last(show);
    expect(view).toMatchObject({ progress: null, state: 'Author hidden from everyone', ends: `${endsWords(UP)} The author's name comes back then.`, yours: false, notes: {} });
    expect(view.report).toBeUndefined();
  });

  test('says to the post\'s author that it is theirs and that everyone else, and this page, sees the stand-in', () => {
    const { show } = setup({ reader: { author: true, caster: false } });
    expect(last(show)).toMatchObject({ state: 'Author hidden from everyone', report: 'This is your post. Everyone else sees the stand-in in your place, and so does this page.' });
  });

  test('never reads who played the card: the caster\'s view is the same', () => {
    const a = last(setup().show);
    cleanup();
    const b = last(setup({ reader: { author: false, caster: true } }).show);
    expect(b).toEqual(a);
  });

  test('the Lens\'s word rules pass for every view', () => {
    for (const reader of [{ author: false, caster: false }, { author: true, caster: false }]) {
      const { show, unmount } = setup({ reader });
      expect(viewProblems(last(show), { holds: false, covers: false })).toEqual([]);
      unmount();
    }
    const { show } = setup({ plays: [play({ ends: OVER })] });
    expect(viewProblems(last(show), { holds: false, covers: false })).toEqual([]);
  });

  test('meets the card once', () => {
    const { met } = setup();
    expect(met).toHaveBeenCalledTimes(1);
  });

  test('clears its view when it goes', () => {
    const { show, unmount } = setup();
    unmount();
    expect(show).toHaveBeenLastCalledWith(null);
  });
});

describe('Whodunnit? once it has worn off', () => {
  test('draws one line under the words: when it wore off, and whose post it was all along, by the name the page gives the post\'s character', () => {
    const { container } = setup({ plays: [play({ ends: OVER })] });
    const line = container.querySelector('.dw-whodunnit-wore')!;
    expect(line).toHaveTextContent(`Whodunnit? wore off on ${dayAndTime(OVER)}. This post was Gloomba's all along.`);
    expect(screen.getByText('The words of the post.')).toBeVisible();
    expect(container.querySelectorAll('.dw-whodunnit-wore')).toHaveLength(1);
  });

  test('until the page is read again it is still up: the post is still the stand-in, so no line and the name is not back', () => {
    const stand = { ...post, character: 'anon' } as Act;
    const { container, show, again } = setup({ post: stand, plays: [play({ ends: '2026-11-12T11:59:59Z' })] }, 'anon');
    expect(container.querySelector('.dw-whodunnit-wore')).toBeNull();
    expect(last(show).state).toBe('Author hidden from everyone');
    /* The read that carries the true character arrives. */
    again({ post, plays: [play({ ends: '2026-11-12T11:59:59Z' })] });
    expect(container.querySelector('.dw-whodunnit-wore')).toHaveTextContent("This post was Gloomba's all along.");
    expect(last(show).state).toBe('The name is back');
  });

  test('says the name is back to the Lens, with no controls', () => {
    const { show } = setup({ plays: [play({ ends: OVER })] });
    expect(last(show)).toMatchObject({ state: 'The name is back', controls: [], yours: false });
  });

  test('draws the line when the time passes while the page is open', () => {
    const { container } = setup({ plays: [play({ ends: '2026-11-12T12:00:05Z' })] });
    expect(container.querySelector('.dw-whodunnit-wore')).toBeNull();
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(container.querySelector('.dw-whodunnit-wore')).not.toBeNull();
  });

  test('a play an admin ended draws no line: the play is reversed and the effect is gone', () => {
    const { container, show } = setup({ plays: [play({ ends: OVER, reversed: true })] });
    expect(container.querySelector('.dw-whodunnit-wore')).toBeNull();
    expect(screen.getByText('The words of the post.')).toBeVisible();
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ state: expect.anything() }));
  });

  test('a play with no end shown draws no line', () => {
    const { container } = setup({ plays: [play({ ends: undefined })] });
    expect(container.querySelector('.dw-whodunnit-wore')).toBeNull();
  });
});

describe('Whodunnit? in a play\'s moment', () => {
  test.each([[OVER], [UP]])('drawn still with an end of %s, the play was up at the moment: no line, the name is not back, whatever the clock says; nothing is met and nothing is bound', (ends) => {
    const { container, show, met } = setup({ still: true, plays: [play({ ends })] });
    expect(container.querySelector('.dw-whodunnit-wore')).toBeNull();
    expect(last(show).state).toBe('Author hidden from everyone');
    expect(met).not.toHaveBeenCalled();
    expect(last(show).controls).toEqual([]);
    for (const el of [...container.querySelectorAll<HTMLElement>('*')]) {
      fireEvent.pointerDown(el); fireEvent.keyDown(el, { key: ' ' }); fireEvent.click(el);
    }
    expect(met).not.toHaveBeenCalled();
    expect(container.querySelector('[inert]')).toBeNull();
    expect(viewProblems(last(show), { holds: false, covers: false })).toEqual([]);
  });
});
