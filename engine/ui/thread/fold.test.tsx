/**
 * A post wearing a live play of a card that folds the row (`CardUi.foldsRow`) is drawn as one bar (`FoldBar`) with its row behind it.
 * The cards here are the engine's own test cards, never an instance's.
 */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi, EffectProps } from '../cards/types.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';

const rules = (key: string, extra: Partial<CardRules> = {}): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], playPrice: () => 0, validateConfig: (c) => ok(c ?? {}),
  canApply: (t, e, _c, now) => landsOn({ key, reaches: ['post'] }, t, e, now),
  ...extra,
});
const instance: Instance = {
  ...testInstance,
  anonymous: { name: 'Nobody', tagline: 'Could be anyone.' },
  cards: [...testInstance.cards, rules('folder', { lasts: { unit: 'day', count: 1 } }), rules('whodunnit', { lasts: { unit: 'minute', count: 10 }, veil: 'author' })],
};

/* The fixture effect keeps a count of its own and a button that folds the row from inside it, as an instance's Lens does. */
const Counter = ({ fold, children }: EffectProps) => {
  const [n, setN] = useState(0);
  return (
    <div data-testid="fx-folder">
      <button type="button" onClick={() => setN(n + 1)}>count {n}</button>
      <button type="button" onClick={fold?.toggle}>fold from inside</button>
      {children}
    </div>
  );
};
const cards: CardUi[] = [{ key: 'folder', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'folder', Effect: Counter, foldsRow: true }];

function world() {
  const fake = buildWorld(undefined, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const ids = [first, fake.seed.post(thread, pipe, 'post 2'), fake.seed.post(thread, spritey, 'post 3')];
  fake.signInAs(me);
  return { fake, me, other, pipe, spritey, thread, ids };
}
const open = (w: { fake: ReturnType<typeof buildWorld>; thread: string }) =>
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, cards, instance });
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const toggleOf = (article: HTMLElement) => within(article).getByRole('button', { name: /^(Show|Hide) post #/u });
const grid = (article: HTMLElement) => article.querySelector<HTMLElement>('.kb-act-grid')!;

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('a post that wears a card that folds the row', () => {
  test('is drawn as a bar with the avatar, the name, its number and Show post, and its row hidden', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const bar = second.querySelector<HTMLElement>('.kb-fold-bar')!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector('.kb-fold-name')).toHaveTextContent('Pipewrench');
    expect(bar.querySelector('.kb-fold-seq')).toHaveTextContent('#2');
    expect(bar.querySelector('.kb-fold-avatar')).not.toBeNull();
    const toggle = toggleOf(second);
    expect(toggle).toHaveTextContent('Show post');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', grid(second).id);
    expect(second).toHaveAttribute('data-kb-fold', 'folded');
    expect(grid(second)).toHaveAttribute('hidden');
    /* A post with no such play draws no bar and an open grid. */
    expect(post(3).querySelector('.kb-fold-bar')).toBeNull();
    expect(grid(post(3))).not.toHaveAttribute('hidden');
    expect(post(3)).not.toHaveAttribute('data-kb-fold');
  });

  test('opens on a press and folds on a second, by click, Enter and Space', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const toggle = toggleOf(second);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide post');
    expect(grid(second)).not.toHaveAttribute('hidden');
    expect(second).toHaveAttribute('data-kb-fold', 'open');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(grid(second)).toHaveAttribute('hidden');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('keeps its marks on the bar, folded and open, and the same node through a press', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const mark = await within(second).findByRole('button', { name: /^folder, 1 play/u });
    expect(mark.closest('.kb-fold-bar')).not.toBeNull();
    expect(mark.closest('.kb-act-meta')).toBeNull();
    await userEvent.click(toggleOf(second));
    expect(mark.isConnected).toBe(true);
    expect(mark.closest('.kb-fold-bar')).not.toBeNull();
    expect(second.querySelector('.kb-act-meta .kb-mark')).toBeNull();
    await userEvent.click(toggleOf(second));
    expect(mark.isConnected).toBe(true);
  });

  test('keeps a cell\'s state across a fold and an open', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await userEvent.click(toggleOf(second));
    await userEvent.click(within(second).getByRole('button', { name: 'count 0' }));
    expect(within(second).getByRole('button', { name: 'count 1' })).toBeInTheDocument();
    await userEvent.click(toggleOf(second));
    await userEvent.click(toggleOf(second));
    expect(within(second).getByRole('button', { name: 'count 1' })).toBeInTheDocument();
  });

  test('under a veil shows the stand-in\'s name and avatar on the bar, never the author\'s', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    w.fake.seed.cards(w.other, { whodunnit: 1 });
    w.fake.signInAs(w.other);
    expect((await w.fake.playCard('whodunnit', w.spritey, w.ids[1]!, {}, '')).ok).toBe(true);
    w.fake.signInAs(w.other);
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Nobody$/u });
    const bar = second.querySelector<HTMLElement>('.kb-fold-bar')!;
    expect(bar.querySelector('.kb-fold-name')).toHaveTextContent('Nobody');
    expect(bar.querySelector('.kb-fold-avatar')).toHaveTextContent('N');
    expect(bar.innerHTML).not.toContain('Pipewrench');
    expect(toggleOf(second)).toHaveAccessibleName('Show post #2 by Nobody');
  });

  test('stops folding when an admin ends the play, and the grid is the same element', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const before = grid(second);
    expect(before).toHaveAttribute('hidden');
    await act(async () => { expect((await w.fake.reverseCard(played)).ok).toBe(true); });
    await waitFor(() => expect(second.querySelector('.kb-fold-bar')).toBeNull());
    expect(grid(second)).toBe(before);
    expect(before).not.toHaveAttribute('hidden');
    expect(second).not.toHaveAttribute('data-kb-fold');
  });

  test('moves focus to the toggle when the row folds from inside it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await userEvent.click(toggleOf(second));
    const inside = within(second).getByRole('button', { name: 'fold from inside' });
    inside.focus();
    expect(document.activeElement).toBe(inside);
    await userEvent.click(inside);
    expect(grid(second)).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(toggleOf(second));
  });

  test('names its toggle for the post and its author, folded and open', async () => {
    const w = world();
    w.fake.seed.card(w.pipe, w.ids[2]!, 'folder');
    open(w);
    const third = await screen.findByRole('article', { name: /^Post 3 by Spritey$/u });
    expect(toggleOf(third)).toHaveAccessibleName('Show post #3 by Spritey');
    await userEvent.click(toggleOf(third));
    expect(toggleOf(third)).toHaveAccessibleName('Hide post #3 by Spritey');
  });
});
