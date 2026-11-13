/**
 * A thread play of a card that keeps (`CardRules.keeps`, Feelin' Glam's rule) as `PostEffects` draws it: every post wrapped while it is up, only the posts written
 * while it was up once its time is over, none once an admin ended it; and a card drawn by another (`CardUi.drawnBy`), whose plays join the named card's effect on the
 * post as one wrap. The cards are the engine's own test cards, never an instance's.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { PlayerProvider } from '../player.tsx';
import { buildWorld, renderIn, testInstance, testKeeper, testKeeperMask } from '../test-world.tsx';
import { PostEffects } from './Effects.tsx';
import { PostMarks } from './Marks.tsx';
import type { ReachAt } from './PlayActions.tsx';
import { createPlays } from './plays.ts';
import { createTallies } from '../thread/tallies.ts';
import { createMine } from '../reactions/mine.ts';
import type { CardUi, EffectProps } from './types.ts';

const post = (key: string): CardRules => ({
  key, name: key, alignment: 'sweet', rarity: 'common', reaches: ['post'], stack: 3, playPrice: () => 0, validateConfig: (c: unknown) => ok(c),
  canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now),
});
const WRITES: CardRules['writes'] = { tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) };
const glow: CardRules = { ...post('glow'), reaches: ['character'], canApply: (t, e, _c, now) => landsOn({ key: 'glow', reaches: ['character'] }, t, e, now) };
const instance: Instance = { ...testInstance, cards: [post('fab'), testKeeper, testKeeperMask, glow, post('one'), { ...post('scribe'), writes: WRITES }] };
const DAY = 24 * 60 * 60 * 1000;
/** The play's time, the fake backend's first (`START`), and its end a week on. */
const PLAYED = '2026-10-29T12:00:00.000Z';
const ENDS = '2026-11-05T12:00:00.000Z';
const THREAD = 't1';

const words = (id: string, createdAt: string): Act => ({ id, character: 'c1', kind: 'post', thread: THREAD, targetActId: null, seq: 1, createdAt, payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null });
/** Written before the play, while it was up, and after its end. */
const BEFORE = words('before', '2026-10-28T12:00:00.000Z');
const INSIDE = words('inside', '2026-11-01T12:00:00.000Z');
const AFTER = words('after', '2026-11-06T12:00:00.000Z');
const keeperPlay = (id = 'glam'): Act => ({ id, character: 'c9', kind: 'card', thread: THREAD, targetActId: null, seq: null, createdAt: PLAYED, payload: { card: 'keeper', layer: 1, message: '', config: {}, reach: 'thread', thread: THREAD, ends: ENDS }, currentPayload: {}, editedAt: null, shownEditedAt: null });
const fabPlay = (id: string, on: string, n: number): Act => ({ id, character: 'c9', kind: 'card', thread: THREAD, targetActId: on, seq: null, createdAt: `2026-10-29T12:00:0${n}.000Z`, payload: { card: 'fab', layer: n, message: '', config: {} }, currentPayload: {}, editedAt: null, shownEditedAt: null });
const ended = (play: string): Act => ({ id: `end-${play}`, character: null, kind: 'card_end', thread: THREAD, targetActId: play, seq: null, createdAt: '2026-10-30T12:00:00.000Z', payload: { why: 'reversed', by: 'admin' }, currentPayload: {}, editedAt: null, shownEditedAt: null });

const wrap = (key: string) => ({ children }: EffectProps): ReactNode => <div data-kb-wrap={key}>{children}</div>;
/** An effect that says what it was given: its plays' ids and each one's reach (a post's own plays carry none). */
const spy = ({ plays, states, released, children }: EffectProps): ReactNode => (
  <div data-kb-wrap="fab" data-plays={plays.map((p) => p.id).join(',')} data-reaches={plays.map((p) => p.reach ?? 'post').join(',')} data-states={Object.keys(states).sort().join(',')} data-released={[...released].sort().join(',')}>{children}</div>
);
const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
const look = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, art, describe: () => `${key}.`, ...extra });

/** The posts drawn with these plays, `late` after the backend's clock has run on that long. */
function setup(cards: CardUi[], acts: Act[], posts: Act[], late = 0, more?: (store: ReturnType<typeof createPlays>) => void) {
  const fake = buildWorld({}, instance);
  if (late > 0) fake.clock.advance(late);
  const kayfa = { api: fake, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const store = createPlays();
  store.add(acts);
  more?.(store);
  const tree = (list: Act[]) => (
    <KayfaProvider value={kayfa}><PlayerProvider api={fake}>
      {list.map((p) => <div key={p.id} data-post={p.id}><PostEffects plays={store} post={p} place="thread" nameOf={() => 'x'}><span>{p.id}</span></PostEffects></div>)}
    </PlayerProvider></KayfaProvider>
  );
  const shown = render(tree(posts));
  /** The posts whose words sit inside a wrap of this card. */
  const wrapped = (key: string) => [...shown.container.querySelectorAll(`[data-post]`)].filter((el) => el.querySelector(`[data-kb-wrap="${key}"]`)).map((el) => el.getAttribute('data-post')!);
  return { fake, container: shown.container, wrapped };
}

afterEach(() => { vi.useRealTimers(); });

describe('a thread play of a card that keeps', () => {
  const cards = () => [look('keeper', { Effect: wrap('keeper') })];

  test('while it is up every post of the thread is wrapped, whenever it was written', () => {
    const w = setup(cards(), [keeperPlay()], [BEFORE, INSIDE, AFTER]);
    expect(w.wrapped('keeper')).toEqual(['before', 'inside', 'after']);
  });

  test('after its end only a post written while it was up is wrapped', () => {
    const w = setup(cards(), [keeperPlay()], [BEFORE, INSIDE, AFTER], 8 * DAY);
    expect(w.wrapped('keeper')).toEqual(['inside']);
  });

  test('the posts redraw at its end by themselves: the others lose it, the kept one does not', () => {
    vi.useFakeTimers();
    const w = setup(cards(), [keeperPlay()], [BEFORE, INSIDE, AFTER]);
    expect(w.wrapped('keeper')).toEqual(['before', 'inside', 'after']);
    act(() => { w.fake.clock.advance(7 * DAY + 1000); vi.advanceTimersByTime(7 * DAY + 1000); });
    expect(w.wrapped('keeper')).toEqual(['inside']);
  });

  test('a play an admin ended wraps none, up or over', () => {
    const w = setup(cards(), [keeperPlay(), ended('glam')], [BEFORE, INSIDE, AFTER]);
    expect(w.wrapped('keeper')).toEqual([]);
  });

  test('an admin\'s end of a worn-off play takes the level off every post at once, the one written inside its window too', () => {
    const w = setup(cards(), [keeperPlay(), ended('glam')], [BEFORE, INSIDE, AFTER], 8 * DAY);
    expect(w.wrapped('keeper')).toEqual([]);
  });

  test('a card that does not keep wraps nothing once its time is over', () => {
    const plain = { ...keeperPlay(), payload: { ...keeperPlay().payload, card: 'fab' } };
    const w = setup([look('fab', { Effect: wrap('fab') })], [plain], [INSIDE], 8 * DAY);
    expect(w.wrapped('fab')).toEqual([]);
  });
});

/* A character play of a card that keeps (the Glitter Bomb keeps design): every post of the character while it is up, only the character's posts written while it was up after. */
describe('a character play of a card that keeps', () => {
  const by = (id: string, character: string, createdAt: string): Act => ({ ...words(id, createdAt), character });
  const maskPlay = (id = 'mask', card = 'keepermask'): Act => ({ id, character: 'c9', kind: 'card', thread: THREAD, targetActId: null, seq: null, createdAt: PLAYED, payload: { card, layer: 1, message: '', config: {}, reach: 'character', character: 'c1', ends: ENDS }, currentPayload: {}, editedAt: null, shownEditedAt: null });
  const mine = [by('c1-before', 'c1', '2026-10-28T12:00:00.000Z'), by('c1-inside', 'c1', '2026-11-01T12:00:00.000Z'), by('c1-after', 'c1', '2026-11-06T12:00:00.000Z'), by('c2-inside', 'c2', '2026-11-01T12:00:00.000Z')];
  const cards = () => [look('keepermask', { Effect: wrap('keepermask') }), look('fab', { Effect: wrap('fab') })];
  /** An effect that says whether it was given `kept`: present as an attribute only when it is set. */
  const asks = ({ kept, children }: EffectProps): ReactNode => <div data-kb-wrap="keepermask" data-kept={kept === undefined ? undefined : String(kept)}>{children}</div>;
  const keptOf = (w: ReturnType<typeof setup>, id: string) => w.container.querySelector(`[data-post="${id}"] [data-kb-wrap="keepermask"]`)?.getAttribute('data-kept') ?? null;

  test('while it is up every post by the character is wrapped, none by another, and `kept` is not set', () => {
    const w = setup([look('keepermask', { Effect: asks })], [maskPlay()], mine);
    expect(w.wrapped('keepermask')).toEqual(['c1-before', 'c1-inside', 'c1-after']);
    for (const id of ['c1-before', 'c1-inside', 'c1-after']) expect(keptOf(w, id)).toBeNull();
  });

  test('after its end only the character\'s posts written while it was up are wrapped, with `kept`; another character\'s post inside the window is not', () => {
    const w = setup([look('keepermask', { Effect: asks })], [maskPlay()], mine, 8 * DAY);
    expect(w.wrapped('keepermask')).toEqual(['c1-inside']);
    expect(keptOf(w, 'c1-inside')).toBe('true');
  });

  test('the posts redraw at its end by themselves: the others lose it, the kept one is given `kept`', () => {
    vi.useFakeTimers();
    const w = setup([look('keepermask', { Effect: asks })], [maskPlay()], mine);
    expect(w.wrapped('keepermask')).toEqual(['c1-before', 'c1-inside', 'c1-after']);
    act(() => { w.fake.clock.advance(7 * DAY + 1000); vi.advanceTimersByTime(7 * DAY + 1000); });
    expect(w.wrapped('keepermask')).toEqual(['c1-inside']);
    expect(keptOf(w, 'c1-inside')).toBe('true');
  });

  test('a play an admin ended wraps none, up or over', () => {
    expect(setup(cards(), [maskPlay(), ended('mask')], mine).wrapped('keepermask')).toEqual([]);
    expect(setup(cards(), [maskPlay(), ended('mask')], mine, 8 * DAY).wrapped('keepermask')).toEqual([]);
  });

  test('a card that does not keep wraps nothing once its time is over', () => {
    const w = setup(cards(), [maskPlay('plain', 'fab')], mine, 8 * DAY);
    expect(w.wrapped('fab')).toEqual([]);
  });

  test('`kept` is absent for a live post-reach play, and for a post-reach play whose time is over', () => {
    const own = ({ kept, children }: EffectProps): ReactNode => <div data-kb-wrap="fab" data-kept={kept === undefined ? undefined : String(kept)}>{children}</div>;
    const live = setup([look('fab', { Effect: own })], [fabPlay('f1', 'c1-inside', 1)], mine);
    expect(live.container.querySelector('[data-post="c1-inside"] [data-kb-wrap="fab"]')!.hasAttribute('data-kept')).toBe(false);
    const over = { ...fabPlay('f2', 'c1-inside', 2), payload: { ...fabPlay('f2', 'c1-inside', 2).payload, ends: ENDS } };
    const late = setup([look('fab', { Effect: own })], [over], mine, 8 * DAY);
    expect(late.container.querySelector('[data-post="c1-inside"] [data-kb-wrap="fab"]')!.hasAttribute('data-kept')).toBe(false);
  });
});

describe('a card drawn by another', () => {
  const cards = () => [look('fab', { Effect: spy }), look('keeper', { drawnBy: 'fab' })];

  test('a post with two plays of the named card and one lent play mounts one effect, given all three, the lent one last and carrying its reach', () => {
    const w = setup(cards(), [keeperPlay(), fabPlay('f1', 'inside', 1), fabPlay('f2', 'inside', 2)], [INSIDE]);
    const wraps = w.container.querySelectorAll('[data-kb-wrap]');
    expect(wraps).toHaveLength(1);
    expect(wraps[0]!.getAttribute('data-plays')).toBe('f1,f2,glam');
    expect(wraps[0]!.getAttribute('data-reaches')).toBe('post,post,thread');
  });

  test('a post with none of its own mounts the named card\'s effect given the lent play alone', () => {
    const w = setup(cards(), [keeperPlay()], [INSIDE]);
    const wraps = w.container.querySelectorAll('[data-kb-wrap]');
    expect(wraps).toHaveLength(1);
    expect(wraps[0]!.getAttribute('data-plays')).toBe('glam');
    expect(wraps[0]!.getAttribute('data-reaches')).toBe('thread');
  });

  test('the play order is the post\'s own plays first, the lent after, whether or not the post has its own, so what an effect seeds from its first play does not move when one joins', () => {
    const lentOnly = setup(cards(), [keeperPlay()], [INSIDE]);
    expect(lentOnly.container.querySelector('[data-kb-wrap]')!.getAttribute('data-plays')).toBe('glam');
    const both = setup(cards(), [keeperPlay(), fabPlay('f1', 'inside', 1)], [INSIDE]);
    expect(both.container.querySelector('[data-kb-wrap]')!.getAttribute('data-plays')).toBe('f1,glam');
    const other = setup(cards(), [fabPlay('f1', 'inside', 1), keeperPlay(), fabPlay('f2', 'inside', 2)], [INSIDE]);
    expect(other.container.querySelector('[data-kb-wrap]')!.getAttribute('data-plays')).toBe('f1,f2,glam');
  });

  test('a lent play keeps its saved state and its release: the effect is given them with its own plays\'', () => {
    const saved = { state: { level: 3 }, savedAt: '2026-10-30T12:00:00.000Z' };
    const w = setup(cards(), [keeperPlay(), fabPlay('f1', 'inside', 1)], [INSIDE], 0, (store) => {
      store.setStates({ glam: saved, f1: saved });
      store.setReleased(['glam']);
    });
    const wrap = w.container.querySelector('[data-kb-wrap]')!;
    expect(wrap.getAttribute('data-states')).toBe('f1,glam');
    expect(wrap.getAttribute('data-released')).toBe('glam');
    /* With none of its own, the lent play's state is still given. */
    const alone = setup(cards(), [keeperPlay()], [INSIDE], 0, (store) => store.setStates({ glam: saved }));
    expect(alone.container.querySelector('[data-kb-wrap]')!.getAttribute('data-states')).toBe('glam');
  });

  test('nothing is mounted for the lending card itself, and a post the play does not fall on is drawn untouched', () => {
    const w = setup(cards(), [keeperPlay()], [INSIDE]);
    expect(w.container.querySelector('[data-kb-wrap="keeper"]')).toBeNull();
    const late = setup(cards(), [keeperPlay(), fabPlay('f1', 'before', 1)], [BEFORE], 8 * DAY);
    /* The post's own play still draws; the lent one, ended before this post was written, is not handed over. */
    expect(late.container.querySelector('[data-kb-wrap="fab"]')!.getAttribute('data-plays')).toBe('f1');
  });

  test('a card that writes is still innermost with a lent play, as one effect of the named card; a card without it wraps it', () => {
    const tail = ({ plays, children }: EffectProps): ReactNode => <>{children}<span data-kb-tail="scribe" data-plays={plays.map((p) => p.id).join(',')} /></>;
    const cards = [look('scribe', { Effect: tail }), look('one', { Effect: wrap('one') }), look('top', { Effect: wrap('top'), takeover: true }), look('keeper', { drawnBy: 'scribe' })];
    const w = setup(cards, [keeperPlay(), { ...keeperPlay('one-1'), payload: { ...keeperPlay().payload, card: 'one' } }], [INSIDE]);
    const words = w.container.querySelector('span:not([data-kb-tail])')!;
    const tails = w.container.querySelectorAll('[data-kb-tail]');
    expect(tails).toHaveLength(1);
    expect(tails[0]!.getAttribute('data-plays')).toBe('glam');
    /* The words' next sibling is the writer's tail, and the plain card wraps both. */
    expect(words.nextElementSibling).toBe(tails[0]);
    expect(words.closest('[data-kb-wrap="one"]')).not.toBeNull();
    expect(tails[0]!.closest('[data-kb-wrap="one"]')).not.toBeNull();
  });
});

/* The Lens a character's postbit opens lists the plays its strip marks there (the Glitter Bomb keeps plan, Task 4): an ended kept play only for a post written while it was up. */
describe('the Lens on a character\'s postbit', () => {
  const maskPlay: Act = { id: 'mask', character: 'c9', kind: 'card', thread: THREAD, targetActId: null, seq: null, createdAt: PLAYED, payload: { card: 'keepermask', layer: 1, message: '', config: {}, reach: 'character', character: 'c1', ends: ENDS }, currentPayload: {}, editedAt: null, shownEditedAt: null };
  const glowPlay: Act = { ...maskPlay, id: 'glow', createdAt: '2026-10-29T12:00:01.000Z', payload: { ...maskPlay.payload, card: 'glow', ends: '2026-12-01T12:00:00.000Z' } };
  const cards = [look('keepermask'), look('glow')];
  const tabsAt = async (postAt: string) => {
    const fake = buildWorld({}, instance);
    fake.clock.advance(8 * DAY);
    const store = createPlays();
    store.add([maskPlay, glowPlay]);
    const reachAt = { reach: 'character', target: 'c1', name: 'C1', fromPost: BEFORE, thread: THREAD, board: 'general', title: 'T', to: '/t', plays: store, know: async () => {}, focusBack: () => null } as unknown as ReachAt;
    renderIn(fake, <PostMarks post="c1" postAt={postAt} plays={store} compare={false} to="/t" nameOf={() => 'x'} faceOf={() => null} tallies={createTallies()} mine={createMine()} reachAt={reachAt} onSpin={() => {}} />, { instance, cards });
    await userEvent.click(await screen.findByRole('button', { name: /^glow, 1 play/u }));
    const lens = await screen.findByRole('dialog', { name: 'Cards on this character' });
    return { tabs: within(lens).getAllByRole('tab').map((t) => t.textContent), text: lens.textContent ?? '' };
  };

  test('lists only the live play on a post written outside the ended kept play\'s window', async () => {
    expect((await tabsAt('2026-11-06T12:00:00.000Z')).tabs).toEqual(['glow']);
  });

  test('lists the ended kept play too on a post written while it was up', async () => {
    const { tabs } = await tabsAt('2026-11-01T12:00:00.000Z');
    expect(tabs).toEqual(['Keeper Mask', 'glow']);
  });
});
