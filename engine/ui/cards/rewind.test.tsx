/**
 * A post under a live rewind (Time Machine design, 4.2): `PostEffects` draws the words of the version the rewind names in place of the post's own, and only the plays
 * the rewind lets show (those played at or before its point, and from the rewind play on). A hidden play is not ended: everything is drawn again when the rewind's time is up.
 * The cards are the engine's own test cards, never an instance's.
 */
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act, Rewind } from '../data/api.ts';
import { createFake } from '../data/fake.ts';
import { PlayerProvider } from '../player.tsx';
import { testGlass, testInstance } from '../test-world.tsx';
import { PostEffects } from './Effects.tsx';
import { PlayProvider } from './play.tsx';
import { createPlays, hydrate } from './plays.ts';
import type { CardUi, EffectProps } from './types.ts';

const rules = (key: string, extra: Partial<CardRules> = {}): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'common', reaches: ['post'], playPrice: () => 0, validateConfig: (c: unknown) => ok(c),
  canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now), ...extra,
});
const instance: Instance = { ...testInstance, cards: [rules('early'), rules('late'), rules('beacon', { reaches: ['thread'] }), rules('clock', { rarity: 'rare', rewind: { upTo: 'rare' }, lasts: { unit: 'day', count: 1 } })] };
const wrap = (key: string) => ({ children }: EffectProps): ReactNode => <div data-kb-wrap={key}>{children}</div>;
const ui = (key: string): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect: wrap(key) });
const cards = ['early', 'late', 'clock', 'beacon'].map(ui);

const T = (m: number) => `2026-11-14T10:${String(m).padStart(2, '0')}:00.000Z`;
const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: T(0), payload: { body: 'new words' }, currentPayload: { body: 'new words' }, editedAt: T(3), shownEditedAt: T(3) };
const old: Act = { ...post, currentPayload: { body: 'old words' }, editedAt: null, shownEditedAt: null };
const play = (card: string, id: string, at: string, ends?: string): Act => ({
  id, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p1', seq: null, createdAt: at,
  payload: { card, message: '', config: {}, layer: 1, ...(ends ? { ends } : {}) }, currentPayload: {}, editedAt: null, shownEditedAt: null,
});
/** The point is minute 2: `early` was played at 1, `late` at 4, the rewind at 5. */
const early = play('early', 'e', T(1));
const late = play('late', 'l', T(4));
const rewindAt = (ends: string) => play('clock', 'r', T(5), ends);
const view = (at = T(2)): Rewind => ({ play: 'r', post: 'p1', at, version: old });

function draw(rewinds: readonly Rewind[], played: readonly Act[]) {
  const api = createFake({ instance, now: () => Date.now() });
  const kayfa = { api, instance, ui: { cards, glass: testGlass }, settings: {} } as unknown as Kayfa;
  const store = createPlays();
  hydrate(store, played, {}, [], {}, {}, [], [], rewinds);
  const body = (version: Act) => <span data-kb-words>{String(version.currentPayload.body)}</span>;
  return {
    store,
    ...render(
      <KayfaProvider value={kayfa}><PlayerProvider api={api}><PlayProvider>
        <PostEffects plays={store} post={post} place="thread" nameOf={() => 'x'} bodyOf={body}>{body(post)}</PostEffects>
      </PlayProvider></PlayerProvider></KayfaProvider>,
    ),
  };
}
const wraps = (el: HTMLElement) => [...el.querySelectorAll('[data-kb-wrap]')].map((w) => w.getAttribute('data-kb-wrap')).sort();
const words = (el: HTMLElement) => el.querySelector('[data-kb-words]')?.textContent;
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('a post under a live rewind', () => {
  test('draws the old words and not the new', () => {
    const { container } = draw([view()], [early, late, rewindAt(ahead(60_000))]);
    expect(words(container)).toBe('old words');
    expect(container.textContent).not.toContain('new words');
  });

  test('hides a card played after the point and keeps one before it and the rewind itself', () => {
    const { container } = draw([view()], [early, late, rewindAt(ahead(60_000))]);
    expect(wraps(container)).toEqual(['clock', 'early']);
  });

  test('draws the present and every card as before while the rewind\'s view is not in, then rewound once it is', () => {
    const { container, store } = draw([], [early, late, rewindAt(ahead(60_000))]);
    expect(words(container)).toBe('new words');
    expect(wraps(container)).toEqual(['clock', 'early', 'late']);
    store.setRewinds([view()]);
    return waitFor(() => { expect(words(container)).toBe('old words'); expect(wraps(container)).toEqual(['clock', 'early']); });
  });

  test('draws everything again once the rewind\'s time passes, with no read', async () => {
    const { container } = draw([view()], [early, late, rewindAt(ahead(400))]);
    expect(words(container)).toBe('old words');
    await waitFor(() => { expect(words(container)).toBe('new words'); expect(wraps(container)).toEqual(['clock', 'early', 'late']); }, { timeout: 3_000 });
  });

  test('draws everything again when an admin ends the rewind', async () => {
    const { container, store } = draw([view()], [early, late, rewindAt(ahead(60_000))]);
    expect(words(container)).toBe('old words');
    store.setEnded(['r']);
    await waitFor(() => expect(words(container)).toBe('new words'));
  });
});

describe('a play above the post (a thread\'s), under a live rewind', () => {
  const sibling: Act = { ...post, id: 'p2', seq: 2 };
  /** A thread-reach play, played at minute `m`, up for a minute. */
  const beacon = (id: string, m: number): Act => ({
    id, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p0', seq: null, createdAt: T(m),
    payload: { card: 'beacon', message: '', config: {}, layer: 1, reach: 'thread', thread: 't1', ends: ahead(60_000) }, currentPayload: {}, editedAt: null, shownEditedAt: null,
  });
  function both(played: readonly Act[]) {
    const api = createFake({ instance, now: () => Date.now() });
    const kayfa = { api, instance, ui: { cards, glass: testGlass }, settings: {} } as unknown as Kayfa;
    const store = createPlays();
    hydrate(store, [...played, rewindAt(ahead(60_000))], {}, [], {}, {}, [], [], [view()]);
    const body = (version: Act) => <span data-kb-words>{String(version.currentPayload.body)}</span>;
    const one = (act: Act) => <PostEffects plays={store} post={act} place="thread" nameOf={() => 'x'} bodyOf={body}>{body(act)}</PostEffects>;
    return render(<KayfaProvider value={kayfa}><PlayerProvider api={api}><PlayProvider><div id="a">{one(post)}</div><div id="b">{one(sibling)}</div></PlayProvider></PlayerProvider></KayfaProvider>);
  }
  const at = (c: HTMLElement, id: string) => wraps(c.querySelector<HTMLElement>(`#${id}`)!);

  test('a thread play between the point and the rewind is hidden on the rewound post and drawn on a sibling', () => {
    const { container } = both([beacon('b1', 4)]);
    expect(at(container, 'a')).toEqual(['clock']);
    expect(at(container, 'b')).toEqual(['beacon']);
  });

  test('a thread play before the point is drawn on both', () => {
    const { container } = both([beacon('b0', 1)]);
    expect(at(container, 'a')).toEqual(['beacon', 'clock']);
    expect(at(container, 'b')).toEqual(['beacon']);
  });
});
