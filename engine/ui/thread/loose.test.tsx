/**
 * A post wearing a live play of a card that draws the reactions (`CardUi.drawsReactions`) has no tiles in its row: the row keeps its bar with one line, and the card's `Effect` is
 * given the row's logic as `EffectProps.reactions`, the same press with the same grace and undo. The cards here are the engine's own test cards, never an instance's.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi, EffectProps } from '../cards/types.ts';
import { LoadedThread } from '../loaded.tsx';
import { REACTION_GRACE_MS } from '../reactions/mine.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';

const rules = (key: string): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], playPrice: () => 0, validateConfig: (c) => ok(c ?? {}),
  canApply: (t, e, _c, now) => landsOn({ key, reaches: ['post'] }, t, e, now), lasts: { unit: 'day', count: 1 },
});
const instance: Instance = { ...testInstance, cards: [...testInstance.cards, rules('loose'), rules('plain')] };

/** An effect with a press button and a picker button that use the deck it is given. */
const Loose = ({ reactions, children }: EffectProps) => {
  return (
    <div data-testid="fx-loose" data-deck={reactions === undefined ? 'none' : reactions.canReact ? 'live' : 'plain'}>
      {reactions?.chips.map((c) => <span key={c.key} data-testid={`chip-${c.key}`}>{c.key} {c.count}{c.pending ? ' pending' : ''}</span>)}
      <button type="button" onClick={() => { reactions?.press('fire'); }}>catch fire</button>
      <button type="button" onClick={(e) => reactions?.picker.open(e.currentTarget, true)}>catch another</button>
      {children}
    </div>
  );
};
const Plain = ({ reactions, children }: EffectProps) => <div data-testid="fx-plain" data-deck={reactions === undefined ? 'none' : 'given'}>{children}</div>;
const art = { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = [
  { key: 'loose', art, describe: () => 'loose', Effect: Loose, drawsReactions: true },
  { key: 'plain', art, describe: () => 'plain', Effect: Plain },
];
const LINE = "This post's reactions are loose inside it.";

function world() {
  const fake = buildWorld(undefined, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const fan = fake.seed.account('fan');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const fanChar = fake.seed.character(fan, 'Fan', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const ids = [first, fake.seed.post(thread, pipe, 'post 2'), fake.seed.post(thread, spritey, 'post 3')];
  fake.seed.react(fan, fanChar, ids[2]!, 'fire');
  fake.signInAs(me);
  return { fake, me, pipe, spritey, thread, ids };
}
const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, cards, instance });
const post3 = () => screen.findByRole('article', { name: /^Post 3 by Spritey$/u });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('a post that wears a card that draws the reactions', () => {
  test('the row shows one line and no tiles, and the effect is given the deck', async () => {
    const w = world();
    w.fake.seed.card(w.pipe, w.ids[2]!, 'loose');
    open(w);
    const article = await post3();
    await waitFor(() => expect(within(article).getByTestId('fx-loose')).toHaveAttribute('data-deck', 'live'));
    expect(within(article).getByText(LINE)).toBeInTheDocument();
    expect(within(article).queryByRole('list', { name: 'Reactions' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'React' })).toBeNull();
    expect(within(article).queryByRole('button', { name: /^Fire, / })).toBeNull();
    await waitFor(() => expect(within(article).getByTestId('chip-fire')).toHaveTextContent('fire 1'));
  });

  test('press sends after the grace, and the second press of a pending kind undoes it and sends nothing', async () => {
    const w = world();
    w.fake.seed.card(w.pipe, w.ids[2]!, 'loose');
    const react = vi.spyOn(w.fake, 'react');
    open(w);
    const article = await post3();
    await waitFor(() => expect(within(article).getByTestId('fx-loose')).toHaveAttribute('data-deck', 'live'));
    const press = () => act(() => { fireEvent.click(within(article).getByRole('button', { name: 'catch fire' })); });
    press();
    await waitFor(() => expect(within(article).getByTestId('chip-fire')).toHaveTextContent('fire 2 pending'));
    await wait(100);
    expect(react).not.toHaveBeenCalled();
    press();
    await waitFor(() => expect(within(article).getByTestId('chip-fire')).toHaveTextContent('fire 1'));
    await wait(REACTION_GRACE_MS * 2);
    expect(react).not.toHaveBeenCalled();
    press();
    await wait(REACTION_GRACE_MS + 100);
    await waitFor(() => expect(react).toHaveBeenCalledTimes(1));
    expect(react.mock.calls[0]).toContain('fire');
  });

  test('the picker opened with onlyNew lists no kind already on the post', async () => {
    const w = world();
    w.fake.seed.card(w.pipe, w.ids[2]!, 'loose');
    open(w);
    const article = await post3();
    await waitFor(() => expect(within(article).getByTestId('fx-loose')).toHaveAttribute('data-deck', 'live'));
    act(() => { fireEvent.click(within(article).getByRole('button', { name: 'catch another' })); });
    const dialog = within(await screen.findByRole('dialog', { name: /^React to / }));
    expect(dialog.queryByRole('button', { name: 'Fire, Hype' })).toBeNull();
    expect(dialog.getByRole('button', { name: 'Tea, Calm' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Tomato, Heat' })).toBeInTheDocument();
  });

  test('on the author\'s own screen the tiles are plain: the line, no React, and a press sends nothing', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'loose');
    const react = vi.spyOn(w.fake, 'react');
    open(w);
    const article = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(within(article).getByTestId('fx-loose')).toHaveAttribute('data-deck', 'plain'));
    expect(within(article).getByText(LINE)).toBeInTheDocument();
    act(() => { fireEvent.click(within(article).getByRole('button', { name: 'catch fire' })); });
    act(() => { fireEvent.click(within(article).getByRole('button', { name: 'catch another' })); });
    await wait(REACTION_GRACE_MS + 100);
    expect(react).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /^React to / })).toBeNull();
    expect(within(article).queryByTestId('chip-fire')).toBeNull();
  });

  test('a card that does not draw the reactions is given no deck and leaves the row as it is', async () => {
    const w = world();
    w.fake.seed.card(w.pipe, w.ids[2]!, 'plain');
    open(w);
    const article = await post3();
    expect(within(article).getByTestId('fx-plain')).toHaveAttribute('data-deck', 'none');
    expect(within(article).getByRole('list', { name: 'Reactions' })).toBeInTheDocument();
    expect(within(article).getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(within(article).queryByText(LINE)).toBeNull();
  });

  test('a play of the card that has ended gives the row back', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    const play = w.fake.seed.card(w.pipe, w.ids[2]!, 'loose');
    open(w);
    const article = await post3();
    await waitFor(() => expect(within(article).getByText(LINE)).toBeInTheDocument());
    await act(async () => { expect((await w.fake.reverseCard(play)).ok).toBe(true); });
    await waitFor(() => expect(within(article).getByRole('list', { name: 'Reactions' })).toBeInTheDocument());
    expect(within(article).getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(within(article).queryByText(LINE)).toBeNull();
    expect(within(article).queryByTestId('fx-loose')).toBeNull();
  });
});
