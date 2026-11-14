/**
 * Below the Fold's effect (docs/plans/2026-11-11-below-the-fold-plan.md, Task 3): a post that wears it is one bar until a reader
 * presses it. Read here: folded at mount, a press opens and a second folds, the keyboard presses the same button, the Lens is
 * told each state in the plan's words, a play's moment draws it folded and untouchable, and the effect clears its view when it goes.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { BelowTheFoldEffect } from './Effect.tsx';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-11T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const play: CardPlay = { id: 'f1', card: 'below-the-fold', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-11T12:00:00Z', post: 'p1' };

/** The effect's props, with `show` and `met` spies; `over` changes any of them. */
function setup(over: Partial<EffectProps> = {}) {
  const show = vi.fn<(view: CardView | null) => void>();
  const met = vi.fn();
  const props: EffectProps = {
    post, plays: [play], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
    show, met, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p>The words of the post.</p>, ...over,
  };
  const rendered = render(<BelowTheFoldEffect {...props} />);
  return { show, met, props, ...rendered };
}
const bar = () => screen.getByRole('button', { name: /Show post|Hide post/u });
const last = (show: ReturnType<typeof setup>['show']): CardView => show.mock.calls.filter((c) => c[0] !== null).at(-1)![0]!;

afterEach(cleanup);

describe('Below the Fold', () => {
  test('is folded at mount: the bar says Show post, and the post\'s words are not visible', () => {
    setup();
    expect(bar()).toHaveTextContent('Show post');
    expect(bar()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('The words of the post.')).not.toBeVisible();
  });

  test('a press opens it and a second press folds it', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(bar());
    expect(bar()).toHaveAttribute('aria-expanded', 'true');
    expect(bar()).toHaveTextContent('Hide post');
    expect(screen.getByText('The words of the post.')).toBeVisible();
    await user.click(bar());
    expect(bar()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('The words of the post.')).not.toBeVisible();
  });

  test('the bar names the region it controls, and the arrow is hidden from a screen reader', () => {
    const { container } = setup();
    const id = bar().getAttribute('aria-controls')!;
    expect(id).not.toBe('');
    expect(container.querySelector(`#${CSS.escape(id)}`)).toContainElement(screen.getByText('The words of the post.', { selector: 'p' }));
    expect(bar().querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  test('the keyboard opens it: Enter and Space on the focused button', async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(bar()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(bar()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(bar()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(bar()).toHaveAttribute('aria-expanded', 'true');
  });

  test('says the folded view at mount and the open view after a press, and the view\'s control toggles it too', async () => {
    const user = userEvent.setup();
    const { show } = setup();
    const folded = last(show);
    expect(folded).toMatchObject({ progress: null, state: 'Folded for you', ends: 'Ends when you press Show post.', yours: true, notes: {} });
    expect(folded.controls).toHaveLength(1);
    expect(folded.controls[0]).toMatchObject({ kind: 'press', label: 'Show post' });
    await user.click(bar());
    const open = last(show);
    expect(open).toMatchObject({ progress: null, state: 'Open for you', ends: 'Ends when you press Show post.', yours: false, notes: {} });
    expect(open.controls[0]).toMatchObject({ kind: 'press', label: 'Hide post' });
    expect(viewProblems(folded, { holds: false, covers: true })).toEqual([]);
    expect(viewProblems(open, { holds: false, covers: false })).toEqual([]);
    /* The Lens's own control folds it again, and opens it again. */
    act(() => { (last(show).controls[0] as { run: () => void }).run(); });
    expect(bar()).toHaveAttribute('aria-expanded', 'false');
    act(() => { (last(show).controls[0] as { run: () => void }).run(); });
    expect(bar()).toHaveAttribute('aria-expanded', 'true');
  });

  test('meets the card once, when the bar is first drawn, and not again on a press', async () => {
    const user = userEvent.setup();
    const { met } = setup();
    expect(met).toHaveBeenCalledTimes(1);
    await user.click(bar());
    await user.click(bar());
    expect(met).toHaveBeenCalledTimes(1);
  });

  test('in a play\'s moment it is drawn folded with the bar disabled: a click changes nothing, no controls are said, nothing is met', async () => {
    const user = userEvent.setup();
    const { show, met } = setup({ still: true });
    expect(bar()).toBeDisabled();
    await user.click(bar());
    expect(bar()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('The words of the post.')).not.toBeVisible();
    const view = last(show);
    expect(view.state).toBe('Folded for you');
    expect(view.controls).toEqual([]);
    expect(met).not.toHaveBeenCalled();
  });

  test('in the ORIGIN box it behaves as in the thread', async () => {
    const user = userEvent.setup();
    setup({ place: 'origin' });
    expect(bar()).toHaveAttribute('aria-expanded', 'false');
    await user.click(bar());
    expect(screen.getByText('The words of the post.')).toBeVisible();
  });

  test('it is folded for everyone alike: the author and the caster see the same bar', () => {
    for (const reader of [{ author: true, caster: false }, { author: false, caster: true }]) {
      const { unmount } = setup({ reader });
      expect(bar()).toHaveAttribute('aria-expanded', 'false');
      expect(bar()).not.toBeDisabled();
      unmount();
    }
  });

  test('the bar is one of the pieces a post keeps over its ink (`data-kb-over-ink`), so Whoops! starts no scrub from a press on it, and the press still reaches everything above', () => {
    const { container } = setup();
    expect(bar().closest('[data-kb-over-ink]')).toBe(bar());
    const reached = vi.fn();
    for (const type of ['pointerdown', 'touchstart']) container.addEventListener(type, reached);
    fireEvent.pointerDown(bar());
    fireEvent.touchStart(bar());
    expect(reached).toHaveBeenCalledTimes(2);
  });

  test('clears its view when it goes', () => {
    const { show, unmount } = setup();
    unmount();
    expect(show).toHaveBeenLastCalledWith(null);
  });

  test('in a post\'s row (given `fold`) it draws the children and no bar of its own, and tells the Lens the row\'s state with the row\'s press', () => {
    const toggle = vi.fn();
    const { container, show, met, rerender, props } = setup({ fold: { open: false, toggle } });
    expect(container.querySelector('.dw-fold-bar')).toBeNull();
    expect(screen.getByText('The words of the post.')).toBeVisible();
    const folded = last(show);
    expect(folded).toMatchObject({ progress: null, state: 'Folded for you', ends: 'Ends when you press Show post.', yours: true, notes: {} });
    expect(folded.controls).toHaveLength(1);
    expect(folded.controls[0]).toMatchObject({ kind: 'press', label: 'Show post', run: toggle });
    expect(met).toHaveBeenCalledTimes(1);
    rerender(<BelowTheFoldEffect {...props} fold={{ open: true, toggle }} />);
    const open = last(show);
    expect(open).toMatchObject({ state: 'Open for you', yours: false });
    expect(open.controls[0]).toMatchObject({ kind: 'press', label: 'Hide post', run: toggle });
    expect(met).toHaveBeenCalledTimes(1);
    expect(viewProblems(folded, { holds: false, covers: true })).toEqual([]);
    expect(viewProblems(open, { holds: false, covers: false })).toEqual([]);
  });

  test('without `fold` the bar shows its words first and a chevron after them', () => {
    setup();
    const el = bar();
    expect(el.firstElementChild).toHaveTextContent('Show post');
    expect(el.lastElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(el.lastElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
