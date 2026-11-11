/**
 * The marks over a post (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 1): one button per card kind in the
 * post's date row, in billing order, with a count, an edge that follows the card's view, a gold notch when the card says
 * the reader has something to do, and a corner sign when a play has drawn more public reactions than its post. Too many
 * kinds end in a "+N" mark. The ghost mark (an armed card's) is tested with the rest of playing a card (play.test.tsx).
 */
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id, ThreadListener } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { CardUi, CardView, EffectProps } from './types.ts';
import { LoadedThread } from '../loaded.tsx';

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
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: ui });
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
    expect(within(document.body).getByRole('tab', { name: 'Card 2', selected: true })).toBeInTheDocument();
  });

  test('on a phone it draws two and "+4"', async () => {
    width(true);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(3));
    expect(within(post).getByRole('button', { name: '+4 more cards played on this post' })).toHaveTextContent('+4');
  });

  test('a mark opens the Lens on its kind, and stays expanded while it is open', async () => {
    const w = world();
    w.play('k1');
    open(w);
    const post = await article(2);
    const mark = await waitFor(() => { const [m] = marks(post); expect(m).toBeDefined(); return m!; });
    await userEvent.click(mark);
    expect(screen.getByRole('tab', { name: 'Card 1', selected: true })).toBeInTheDocument();
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

/* An admin's end (supabase/migrations/0092_card_end.sql): a kind whose plays an admin all ended is dimmed as a caught one is, its mark kept to say so. */
describe('a mark whose plays an admin ended', () => {
  const dimmed = (post: HTMLElement) => marks(post).map((m) => m.getAttribute('data-kb-caught'));

  test('is dimmed when every play of its kind was ended, and not while one is still in force', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    const ended = w.play('k1'); const alsoEnded = w.play('k1'); w.play('k2'); const one = w.play('k3'); w.play('k3');
    for (const p of [ended, alsoEnded, one]) expect((await w.fake.reverseCard(p)).ok).toBe(true);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(3));
    /* Billed newest first: k3 (one of two ended), k2 (untouched), k1 (both ended). */
    expect(dimmed(post)).toEqual([null, null, 'true']);
  });
});

/*
 * A visit's mark (the Mod Bots design, section 9): the Marks' glass tile first in the strip, the stopwatch and the time left as h:mm, redrawn each
 * minute, or how it went; its name for a screen reader says the Mod, the time or how it ended, and that it opens the visit.
 */
describe('a visit\'s mark', () => {
  const MINUTE = 60_000;
  const visited = (endsInMinutes = 161) => {
    const w = world();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns: PRONOUN_PRESETS.she });
    const visit = w.fake.seed.visit(clerk, w.second, { at: Date.now(), endsInMs: endsInMinutes * MINUTE });
    return { ...w, clerk, visit };
  };
  const visitMark = async (seq = 2) => within(await article(seq)).findByRole('button', { name: /Opens the visit\.$/u });

  test('is a button named for the Mod, the time left and what it opens, showing the time as h:mm', async () => {
    const w = visited();
    open(w);
    const mark = await visitMark();
    expect(mark).toHaveAccessibleName('The Clerk is on a visit to this post, 2:41 left, 2 hours 41 minutes. Opens the visit.');
    expect(mark).toHaveTextContent('2:41');
    expect(mark).toHaveAttribute('aria-haspopup', 'dialog');
    expect(mark).toHaveAttribute('aria-expanded', 'false');
    expect(mark).toHaveClass('kb-meta-tile');
  });

  test('is first in the strip, ahead of the cards\' marks', async () => {
    const w = visited();
    w.play('k1'); w.play('k2');
    open(w);
    const post = await article(2);
    await waitFor(() => expect(within(post).getAllByRole('button', { name: /Opens the (visit|cards on this post)\./u })).toHaveLength(3));
    const strip = within(post).getAllByRole('button', { name: /Opens the (visit|cards on this post)\./u });
    expect(strip[0]).toHaveAccessibleName(/Opens the visit\.$/u);
    expect(strip[1]).toHaveAccessibleName(/Card 2/u);
  });

  test('takes one of the strip\'s places: four cards and a visit are the visit, three cards and "+1"', async () => {
    const w = visited();
    for (const k of ['k1', 'k2', 'k3', 'k4']) w.play(k);
    open(w);
    const post = await article(2);
    await waitFor(() => expect(within(post).getByRole('button', { name: /^\+1 more card/u })).toBeInTheDocument());
    expect(within(post).getAllByRole('button', { name: /Opens the cards on this post\./u })).toHaveLength(3);
  });

  test('a post with no visit has no visit mark', async () => {
    const w = world();
    w.play('k1');
    open(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    expect(within(post).queryByRole('button', { name: /Opens the visit\./u })).toBeNull();
  });

  test('redraws its time each minute while the visit is open, and stops at the time\'s end', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const w = visited(161);
      open(w);
      const mark = await visitMark();
      expect(mark).toHaveTextContent('2:41');
      await act(async () => { vi.advanceTimersByTime(MINUTE); });
      expect(mark).toHaveTextContent('2:40');
      expect(mark).toHaveAccessibleName(/2:40 left, 2 hours 40 minutes/u);
      await act(async () => { vi.advanceTimersByTime(160 * MINUTE); });
      expect(mark).toHaveTextContent('0:00');
    } finally { vi.useRealTimers(); }
  });

  test('every mark and panel shares one minute clock, which stops with the last of them', async () => {
    const started: unknown[] = [];
    const cleared: unknown[] = [];
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      const id = realSet(fn, ms, ...rest);
      if (ms === 60_000) started.push(id);
      return id;
    }) as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: Parameters<typeof clearInterval>[0]) => { cleared.push(id); realClear(id); }) as typeof clearInterval);
    const w = visited();
    const third = w.fake.seed.post(w.thread, w.spritey, 'post 4');
    w.fake.seed.visit(w.clerk, third, { at: Date.now(), endsInMs: 90 * MINUTE });
    const view = open(w);
    await visitMark(2);
    await visitMark(4);
    expect(started).toHaveLength(1);
    view.unmount();
    expect(cleared).toContain(started[0]);
  });

  test('a visit past its end, still open, stops asking for the clock; one that ended never did', async () => {
    const started: unknown[] = [];
    const realSet = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      const id = realSet(fn, ms, ...rest);
      if (ms === 60_000) started.push(id);
      return id;
    }) as typeof setInterval);
    const w = visited(-5);
    const filed = w.fake.seed.post(w.thread, w.spritey, 'post 4');
    const v = w.fake.seed.visit(w.clerk, filed, { at: Date.now(), endsInMs: 90 * MINUTE });
    w.fake.seed.visitEnd(v, { outcome: 'filed', line: 'Filed.' });
    open(w);
    expect(await visitMark(2)).toHaveTextContent('0:00');
    await visitMark(4);
    expect(started).toHaveLength(0);
  });

  test.each([
    ['filed', 'Filed', 'The Clerk filed her visit to this post. Opens the visit.'],
    ['intercepted', 'Talked down', 'The Clerk\'s visit to this post was talked down. Opens the visit.'],
    ['trapped', 'Trapped', 'The Clerk\'s visit to this post was trapped, ended by a trap. Opens the visit.'],
  ] as const)('a visit that ended %s says so in place of the time', async (outcome, text, label) => {
    const w = visited();
    w.fake.seed.visitEnd(w.visit, { outcome, line: 'Done.' });
    open(w);
    const mark = await visitMark();
    expect(mark).toHaveTextContent(text);
    expect(mark).not.toHaveTextContent(/\d:\d\d/u);
    expect(mark).toHaveAccessibleName(label);
  });

  test('opens the Lens on the visit\'s tab and the same mark closes it', async () => {
    const w = visited();
    open(w);
    const mark = await visitMark();
    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    const lens = screen.getByRole('dialog', { name: 'Visit to this post' });
    expect(within(lens).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(mark);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* A play whose first generation failed was refunded and is over (0148): the mark counts the plays that took, and says plainly when none did. */
describe('a play that did not take', () => {
  const writing = { ...testInstance.cards[0]!, key: 'kw', name: 'Card W', stack: 3, writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
  const own = { ...testInstance, cards: [writing] };
  function writingWorld() {
    const fake = buildWorld(undefined, own);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.signInAs(me);
    const play = () => { fake.clock.advance(60_000); return fake.seed.card(spritey, second, 'kw', { message: '' }); };
    return { fake, thread, second, play };
  }
  const draw = (w: { fake: Fake; thread: Id }) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: own, cards: [cardUi('kw')] });

  test('three casts, one of them refunded, are "×2": the mark counts the plays that took', async () => {
    const w = writingWorld();
    const [, , lost] = [w.play(), w.play(), w.play()];
    w.fake.seed.text(lost!, w.second, { failed: true }, { quiet: true });
    draw(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    expect(marks(post)[0]).toHaveTextContent('×2');
    expect(marks(post)[0]).toHaveAccessibleName(/^Card W, 2 plays/u);
    expect(marks(post)[0]).not.toHaveAttribute('data-kb-caught');
  });

  test('a post whose only play did not take keeps its mark, dimmed, naming the one play and what became of it', async () => {
    const w = writingWorld();
    const lost = w.play();
    w.fake.seed.text(lost, w.second, { failed: true }, { quiet: true });
    draw(w);
    const post = await article(2);
    await waitFor(() => expect(marks(post)).toHaveLength(1));
    expect(marks(post)[0]).not.toHaveTextContent('×');
    expect(marks(post)[0]).toHaveAttribute('data-kb-caught', 'true');
    expect(marks(post)[0]).toHaveAccessibleName("Card W, 1 play, Didn't take. Opens the cards on this post.");
  });
});
