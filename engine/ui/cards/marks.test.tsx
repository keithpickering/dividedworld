/**
 * The marks over a post (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 1): one button per card kind in the
 * post's date row, in billing order, with a count, an edge that follows the card's view, a gold notch when the card says
 * the reader has something to do, and a corner sign when a play has drawn more public reactions than its post. Too many
 * kinds end in a "+N" mark. The ghost mark (an armed card's) is tested with the rest of playing a card (play.test.tsx).
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id, ThreadListener } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { CardUi, CardView, EffectProps } from './types.ts';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function width(phone: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: phone && q.includes('max-width: 40em'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }) as unknown as MediaQueryList);
}

/** Six kinds of card, so a post can carry more marks than a strip draws. */
const KEYS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'] as const;
const instance = {
  ...testInstance,
  cards: KEYS.map((key, i) => ({ ...testInstance.cards[0]!, key, name: `Card ${i + 1}` })),
};
const art = { color: 'red', ink: 'white', mark: '/mark.svg' };
const cardUi = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, describe: () => 'Does a thing. And more.', summary: 'Does a thing.', art, ...extra });
const cards: CardUi[] = KEYS.map((k) => cardUi(k));

function world() {
  const fake = buildWorld(undefined, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const mineToo = fake.seed.post(thread, pipe, 'post 3');
  fake.signInAs(me);
  /* Plays a minute apart, so with nothing drawn the newest is billed first. */
  const play = (kind: string, on: Id = second, by: Id = spritey) => { fake.clock.advance(60_000); return fake.seed.card(by, on, kind, { message: '' }); };
  return { fake, me, pipe, spritey, thread, second, mineToo, play };
}
const open = (w: { fake: Fake; thread: Id }, ui: readonly CardUi[] = cards) =>
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: ui });
const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });
/** The marks a reader can reach on a post, in the order they are drawn. */
const marks = (post: HTMLElement) => within(post).queryAllByRole('button', { name: /Opens the cards on this post\.|cards played on this post$/u });
const names = (post: HTMLElement) => marks(post).map((m) => m.getAttribute('aria-label') ?? m.textContent);

function tap(fake: Fake) {
  let listener: ThreadListener | undefined;
  const real = fake.subscribeThread.bind(fake);
  fake.subscribeThread = (t, l) => { listener = l; return real(t, l); };
  return () => listener!;
}

describe('one mark per kind', () => {
  test('three plays of one card are one mark, "×3", named by the card, the count and the card\'s state', async () => {
    const w = world();
    w.play('k1'); w.play('k1'); w.play('k1');
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    const [mark] = marks(post);
    expect(mark).toHaveTextContent('×3');
    expect(mark).toHaveAccessibleName('Card 1, 3 plays, Does a thing. Opens the cards on this post.');
    expect(mark).toHaveAttribute('aria-expanded', 'false');
  });

  test('one play draws no count, and is named "1 play"', async () => {
    const w = world();
    w.play('k2');
    open(w);
    const [mark] = await waitFor(() => { const m = marks(within(document.body).getByRole('article', { name: /^Post 2 /u })); expect(m).toHaveLength(1); return m; });
    expect(mark).not.toHaveTextContent('×');
    expect(mark).toHaveAccessibleName('Card 2, 1 play, Does a thing. Opens the cards on this post.');
  });

  test('a card the instance gives no looks for is a mark all the same, named once, and a post with no plays has none', async () => {
    const w = world();
    w.play('k1');
    open(w, []);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    expect(marks(post)[0]).toHaveAccessibleName('Card 1, 1 play. Opens the cards on this post.');
    expect(marks(await article(3))).toHaveLength(0);
  });

  test('six kinds on a desktop draw four marks and "+2", which names itself and opens on the first kind it hides', async () => {
    width(false);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(5));
    /* Billing: nothing drawn, so the newest first. */
    expect(names(post).slice(0, 4).map((n) => /^Card \d/u.exec(n!)![0])).toEqual(['Card 6', 'Card 5', 'Card 4', 'Card 3']);
    const more = within(post).getByRole('button', { name: '+2 more cards played on this post' });
    expect(more).toHaveTextContent('+2');
    expect(more).not.toHaveAttribute('aria-describedby');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(document.body).getByRole('dialog', { name: /^Card 2 by Spritey/u })).toBeInTheDocument();
  });

  test('on a phone it draws three and "+3"', async () => {
    width(true);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(4));
    expect(within(post).getByRole('button', { name: '+3 more cards played on this post' })).toHaveTextContent('+3');
  });

  test('a mark opens the first billed play of its kind, and stays expanded while it is open', async () => {
    const w = world();
    w.play('k1');
    open(w);
    const post = await article(2);
    const mark = await waitFor(() => { const [m] = marks(post); expect(m).toBeDefined(); return m!; });
    await userEvent.click(mark);
    expect(screen.getByRole('dialog', { name: 'Card 1 by Spritey' })).toBeInTheDocument();
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(mark).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('order never moves while the page is read', () => {
  test('a play of a new kind that arrives live lands at the end, and a live tally on a play leaves the order as it was', async () => {
    width(false);
    const w = world();
    const first = w.play('k1'); w.play('k2'); w.play('k3');
    const tapped = tap(w.fake);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(3));
    const order = () => names(post).map((n) => /^Card \d/u.exec(n!)![0]);
    expect(order()).toEqual(['Card 3', 'Card 2', 'Card 1']);
    /* The oldest play draws the most, live: the page's order is not reread. */
    act(() => { tapped().onTally?.(first, { fire: 5 }); });
    await waitFor(() => expect(marks(post)[2]).toHaveAccessibleName(/^Card 1, 1 play, .* One has more reactions than the post\.$/u));
    expect(order()).toEqual(['Card 3', 'Card 2', 'Card 1']);
    act(() => { w.fake.seed.card(w.spritey, w.second, 'k4', { live: true }); });
    await waitFor(() => expect(marks(post)).toHaveLength(4));
    expect(order()).toEqual(['Card 3', 'Card 2', 'Card 1', 'Card 4']);
  });
});

describe('the corner sign', () => {
  test('appears when a play of the kind has more public reactions than its post, and goes when the post catches up', async () => {
    const w = world();
    const p = w.play('k1');
    const tapped = tap(w.fake);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    const sign = () => marks(post)[0]!.querySelector('[data-kb-more]');
    expect(sign()).toBeNull();
    act(() => { tapped().onTally?.(p, { fire: 2 }); });
    await waitFor(() => expect(sign()).not.toBeNull());
    expect(marks(post)[0]).toHaveAccessibleName('Card 1, 1 play, Does a thing. Opens the cards on this post. One has more reactions than the post.');
    /* A tie is not more. */
    act(() => { tapped().onTally?.(w.second, { fire: 2 }); });
    await waitFor(() => expect(sign()).toBeNull());
    expect(marks(post)[0]).toHaveAccessibleName('Card 1, 1 play, Does a thing. Opens the cards on this post.');
  });

  test('looks only at the plays of its own kind', async () => {
    const w = world();
    w.play('k1');
    const other = w.play('k2');
    const tapped = tap(w.fake);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(2));
    act(() => { tapped().onTally?.(other, { fire: 3 }); });
    await waitFor(() => expect(marks(post).filter((m) => m.querySelector('[data-kb-more]'))).toHaveLength(1));
    expect(marks(post).find((m) => m.querySelector('[data-kb-more]'))).toHaveAccessibleName(/^Card 2, /u);
  });
});

/** An effect that says a view, as an instance's card does (`EffectProps.show`). */
const saying = (view: (props: EffectProps) => CardView): CardUi['Effect'] => function Says(props: EffectProps) {
  const { show } = props;
  const v = view(props);
  /* Serialized so a view rebuilt every render is the effect's one view. */
  const key = JSON.stringify(v);
  useEffect(() => { show(v); }, [show, key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return <>{props.children}</>;
};
const base: CardView = { progress: null, state: '18% washed', yours: false, controls: [], notes: {} };

describe('what a mark shows of the card\'s view', () => {
  test('its state is the middle of its name, its progress is the edge, and no progress draws no edge', async () => {
    const w = world();
    w.play('k1'); w.play('k1'); w.play('k1'); w.play('k2');
    const ui = [cardUi('k1', { Effect: saying(() => ({ ...base, progress: 0.18 })) }), cardUi('k2', { Effect: saying(() => ({ ...base, progress: null, state: 'Sticking' })) }), ...cards.slice(2)];
    open(w, ui);
    const post = await article(2);
    await waitFor(() => expect(marks(post)[1]).toHaveAccessibleName('Card 1, 3 plays, 18% washed. Opens the cards on this post.'));
    const [two, one] = marks(post);
    expect(one!.style.getPropertyValue('--kb-mark-progress')).toBe('0.18');
    expect(one).toHaveAttribute('data-kb-edge', 'true');
    expect(two).toHaveAccessibleName('Card 2, 1 play, Sticking. Opens the cards on this post.');
    expect(two).not.toHaveAttribute('data-kb-edge');
    expect(two!.style.getPropertyValue('--kb-mark-progress')).toBe('');
  });

  test('the notch follows `yours`: a post\'s author has it and a reader has not, and the name says so', async () => {
    const w = world();
    w.play('k1', w.second);
    w.play('k1', w.mineToo);
    const ui = [cardUi('k1', { Effect: saying((p) => ({ ...base, yours: p.reader.author })) }), ...cards.slice(1)];
    open(w, ui);
    const theirs = await article(2);
    const mine = await article(3);
    await waitFor(() => expect(marks(mine)[0]).toHaveAccessibleName('Card 1, 1 play, 18% washed. Opens the cards on this post. Yours to act on.'));
    expect(mine.querySelector('[data-kb-notch]')).not.toBeNull();
    expect(marks(theirs)[0]).toHaveAccessibleName('Card 1, 1 play, 18% washed. Opens the cards on this post.');
    expect(theirs.querySelector('[data-kb-notch]')).toBeNull();
  });

  test('the corner sign and the notch both add to the name, in that order', async () => {
    const w = world();
    const p = w.play('k1', w.mineToo);
    const tapped = tap(w.fake);
    open(w, [cardUi('k1', { Effect: saying((pr) => ({ ...base, yours: pr.reader.author })) }), ...cards.slice(1)]);
    const mine = await article(3);
    await waitFor(() => expect(mine.querySelector('[data-kb-notch]')).not.toBeNull());
    act(() => { tapped().onTally?.(p, { fire: 1 }); });
    await waitFor(() => expect(marks(mine)[0]).toHaveAccessibleName('Card 1, 1 play, 18% washed. Opens the cards on this post. One has more reactions than the post. Yours to act on.'));
  });
});

describe('what a reaction redraws', () => {
  test('a tally on a play of one kind does not redraw the mark of another, and a play of a new kind leaves the old kinds\' marks as they were', async () => {
    const w = world();
    w.play('k1');
    const second = w.play('k2');
    const tapped = tap(w.fake);
    /* A mark asks its card for the ink on every draw it makes, so the calls count the draws. */
    const draws = { k1: 0, k2: 0 };
    const counting = (key: 'k1' | 'k2') => cardUi(key, { tag: () => { draws[key]++; return undefined; } });
    open(w, [counting('k1'), counting('k2'), ...cards.slice(2)]);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(2));
    await act(async () => {});
    const before = { ...draws };
    act(() => { tapped().onTally?.(second, { fire: 2 }); });
    await waitFor(() => expect(post.querySelector('[data-kb-card="k2"]')).toHaveAccessibleName(/One has more reactions/u));
    expect(draws.k1, 'the other kind\'s mark is not drawn again').toBe(before.k1);
    expect(draws.k2).toBeGreaterThan(before.k2);
    /* The strip is drawn again for a play of a third kind, and the first two kinds' marks keep the same plays. */
    const mid = { ...draws };
    act(() => { w.fake.seed.card(w.spritey, w.second, 'k3', { live: true }); });
    await waitFor(() => expect(marks(post)).toHaveLength(3));
    expect(draws).toEqual(mid);
  });
});

describe('the room a strip takes', () => {
  test('the strip tells the row its measured width, so the row\'s words can keep clear of it', async () => {
    const seen: ((entries: unknown[]) => void)[] = [];
    vi.stubGlobal('ResizeObserver', class { constructor(cb: (e: unknown[]) => void) { seen.push(cb); } observe() {} disconnect() {} unobserve() {} });
    const w = world();
    w.play('k1');
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    const strip = post.querySelector('.kb-marks') as HTMLElement;
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ width: 87.2 } as DOMRect);
    act(() => { for (const cb of seen) cb([{ target: strip }]); });
    expect(strip.parentElement!.style.getPropertyValue('--kb-marks-width')).toBe('88px');
  });
});

describe('a strip that compares nothing listens to nothing', () => {
  test('with compare off it holds no tally subscription; with it on it holds some', async () => {
    const { MarkStrip } = await import('./Marks.tsx');
    const { createTallies } = await import('../thread/tallies.ts');
    const { createPlays } = await import('./plays.ts');
    const w = world();
    const play = w.play('k1');
    const [on] = await w.fake.acts(w.thread, 2, 2);
    for (const compare of [false, true]) {
      const tallies = createTallies();
      const plays = createPlays();
      plays.add([ (await w.fake.cardsOn(on!.id, 5))[0]! ]);
      plays.setBilling(on!.id, [play]);
      const view = renderIn(w.fake, <MarkStrip post={on!.id} plays={plays} tallies={tallies} onOpen={() => {}} compare={compare} />, { instance, cards });
      await waitFor(() => expect(view.container.querySelectorAll('.kb-mark')).toHaveLength(1));
      expect(tallies.listening() > 0, `compare=${compare}`).toBe(compare);
      view.unmount();
    }
  });
});
