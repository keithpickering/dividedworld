/**
 * Cards beyond a post on the thread's screens (docs/plans/2026-11-01-card-reach-plan.md, Task 4): a page reads the live plays above
 * its posts once; a character's plays are marks on every postbit of it in view, a thread's on the thread's head; with a character
 * card armed, a ghost mark is on each postbit it can land on and nowhere else; a post's words are wrapped in the board's effect,
 * then the thread's, then the author's, then the post's own; and a play beyond a post stops drawing at its end without a reread.
 * The cards are the engine's own test cards, never an instance's.
 */
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { Frame } from '../frame/Frame.tsx';
import { PlayerProvider, hudKey } from '../player.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { createFake } from '../data/fake.ts';
import { ThreadScreen } from '../thread/Thread.tsx';
import { PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import type { CardUi, EffectProps } from './types.ts';
import { LoadedThread } from '../loaded.tsx';

const base = { priceKey: 'test.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const reaching = (key: string, name: string, rarity: CardRules['rarity'], reaches: CardRules['reaches'], extra: Partial<CardRules> = {}): CardRules => ({
  ...base, key, name, alignment: 'pepperoni', rarity, reaches, lasts: { unit: 'day', count: 1 }, ...extra,
  canApply: (t, e, _config, now) => landsOn({ key, reaches }, t, e, now),
});
const sparkle = reaching('sparkle', 'Sparkle', 'uncommon', ['character']);
const beacon = reaching('beacon', 'Beacon', 'rare', ['thread']);
const rumble = reaching('rumble', 'Rumble', 'legendary', ['board']);
const dab = reaching('dab', 'Dab', 'common', ['post'], { lasts: undefined });
const instance: Instance = { ...testInstance, cards: [sparkle, beacon, rumble, dab], settings: { ...testInstance.settings, economy: { 'test.price': 100 } } };
/* Each card's effect wraps the words in a box naming it, and the reach it was drawn from. */
const Wrap = (key: string) => function Effect({ children, reach }: EffectProps) { return <div data-kb-wrap={key} data-kb-reach={reach}>{children}</div>; };
const cards: CardUi[] = ['sparkle', 'beacon', 'rumble', 'dab'].map((key) => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect: Wrap(key) }));

/* The first render of the Frame in a file parses the house CSS, which takes a few seconds under jsdom. */
vi.setConfig({ testTimeout: 20_000 });
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/* On the wall clock: a play beyond a post is drawn until its end, read against the time as the server writes it. */
function world() {
  const fake = createFake({ instance, now: () => Date.now() });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face', { pronouns: PRONOUN_PRESETS.she });
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const { thread, act: p1 } = fake.seed.thread('general', spritey, 'Glitter everywhere', 'the first post');
  const ids = [p1, fake.seed.post(thread, gloomba, 'second'), fake.seed.post(thread, spritey, 'third'), fake.seed.post(thread, pipe, 'mine'), fake.seed.post(thread, spritey, 'fifth')];
  fake.seed.cards(me, { sparkle: 2, beacon: 1 });
  fake.seed.wallet(me, 500);
  fake.signInAs(me);
  localStorage.setItem(hudKey(me), pipe);
  return { fake, thread, ids, me, pipe, spritey, gloomba };
}
async function open(w: ReturnType<typeof world>) {
  renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards });
  await screen.findByRole('article', { name: /^Post 5 /u });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const postbit = (seq: number) => post(seq).querySelector('.kb-postbit') as HTMLElement;
const sparkleMark = (el: HTMLElement) => within(el).queryByRole('button', { name: /^Sparkle, 1 play\b.*Opens the cards on this character\./u });

describe('the plays above a page', () => {
  test('come with the page\'s one document, for its distinct authors, its thread and its board, however many posts it holds', async () => {
    const w = world();
    const above = vi.spyOn(w.fake, 'effectsAbove');
    const page = vi.spyOn(w.fake, 'threadPage');
    await open(w);
    await waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    expect(above).not.toHaveBeenCalled();
  });

  test('a character\'s live play is a mark on every postbit of it in view, opening the Lens, and on no other', async () => {
    const w = world();
    w.fake.seed.reach(w.gloomba, 'character', w.spritey, 'sparkle', { post: w.ids[1 - 1]!, ends: Date.now() + 86_400_000, message: 'Shine.' });
    await open(w);
    for (const seq of [1, 3, 5]) expect(await within(postbit(seq)).findByRole('button', { name: /^Sparkle, 1 play\b.*Opens the cards on this character\./u })).toBeInTheDocument();
    for (const seq of [2, 4]) expect(sparkleMark(postbit(seq))).toBeNull();
    /* Not on the post's own date row: it is the character's, not the post's. */
    expect(within(post(1).querySelector('.kb-act-meta') as HTMLElement).queryByRole('button', { name: /^Sparkle/u })).toBeNull();
    const user = userEvent.setup();
    await user.click(sparkleMark(postbit(3))!);
    const lens = await screen.findByRole('dialog');
    expect(lens).toHaveTextContent('Gloomba');
    expect(lens).toHaveAccessibleName('Cards on this character');
    await user.click(within(lens).getByRole('button', { name: '1 play · Gloomba' }));
    expect(within(lens).getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(lens).toHaveTextContent('Shine.');
    expect(lens).toHaveTextContent(/Ends \w+ \d+, \d+:\d\d\s[AP]M/u);
  });

  test('a thread\'s live play is a mark on the thread\'s head', async () => {
    const w = world();
    w.fake.seed.reach(w.gloomba, 'thread', w.thread, 'beacon', { ends: Date.now() + 86_400_000 });
    await open(w);
    const head = document.querySelector('.kb-thread-head') as HTMLElement;
    expect(await within(head).findByRole('button', { name: /^Beacon, 1 play\b.*Opens the cards on this thread\./u })).toBeInTheDocument();
    for (const seq of [1, 2, 3, 4, 5]) expect(within(post(seq)).queryByRole('button', { name: /^Beacon/u })).toBeNull();
  });
});

describe('a character card armed', () => {
  test('puts a ghost mark on every postbit in view it can land on, and nowhere else', async () => {
    const w = world();
    /* Gloomba already carries one, so its postbit takes no second. */
    w.fake.seed.reach(w.pipe, 'character', w.gloomba, 'sparkle', { post: w.ids[1]!, ends: Date.now() + 86_400_000 });
    await open(w);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
    await user.click(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: /^Sparkle, Pepperoni, Cast, uncommon postcard/u })[0]!);
    const ghost = (seq: number) => within(postbit(seq)).queryByRole('button', { name: /^Play Sparkle on /u });
    await waitFor(() => expect(ghost(1)).not.toBeNull());
    expect(ghost(1)).toHaveAccessibleName('Play Sparkle on Spritey');
    for (const seq of [3, 4, 5]) expect(ghost(seq)).not.toBeNull();
    expect(ghost(2)).toBeNull();
    /* Never on a post's own strip or the thread's head: the card reaches characters alone. */
    for (const seq of [1, 2, 3, 4, 5]) expect(within(post(seq).querySelector('.kb-act-meta') as HTMLElement).queryByRole('button', { name: /^Play Sparkle/u })).toBeNull();
    expect(within(document.querySelector('.kb-thread-head') as HTMLElement).queryByRole('button', { name: /^Play Sparkle/u })).toBeNull();
    /* It opens the play form on the character, and the play lands there. */
    await user.click(ghost(3)!);
    const dialog = await screen.findByRole('dialog', { name: /Sparkle/u });
    expect(dialog).toHaveTextContent('On Spritey, on every post of hers, until its time is up.');
    await user.click(within(dialog).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(() => expect(within(postbit(5)).getByRole('button', { name: /^Sparkle, 1 play\b.*Opens the cards on this character\./u })).toBeInTheDocument());
    /* The ghost is gone with the play, so focus goes back to the post it was played from. */
    await waitFor(() => expect(document.activeElement).toBe(post(3)));
  });
});

describe('a thread card armed', () => {
  test('puts its ghost on the thread\'s head alone, and focus goes back to the title after the play', async () => {
    const w = world();
    await open(w);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
    await user.click(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: /^Beacon, Pepperoni, Cast, rare postcard/u })[0]!);
    const head = document.querySelector('.kb-thread-head') as HTMLElement;
    const ghost = await within(head).findByRole('button', { name: 'Play Beacon on “Glitter everywhere”' });
    for (const seq of [1, 2, 3, 4, 5]) expect(within(post(seq)).queryByRole('button', { name: /^Play Beacon/u })).toBeNull();
    await user.click(ghost);
    const dialog = await screen.findByRole('dialog', { name: /Beacon/u });
    await user.click(within(dialog).getByRole('button', { name: 'Play as Pipewrench' }));
    expect(await within(head).findByRole('button', { name: /^Beacon, 1 play\b/u })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(head.querySelector('h1')));
  });
});

describe('what a post wears', () => {
  const at = '2026-10-29T12:00:00.000Z';
  const play = (card: string, payload: Record<string, unknown>, target: string | null): Act => ({
    id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: target, seq: null, createdAt: at,
    payload: { card, message: '', config: {}, ...payload }, currentPayload: {}, editedAt: null, shownEditedAt: null,
  });
  const words: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at, payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
  const kayfa = { api: buildWorld({}, instance), instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const wrapped = (store: ReturnType<typeof createPlays>, board: string | null): ReactNode => (
    <KayfaProvider value={kayfa}><PlayerProvider api={kayfa.api}><PostEffects plays={store} post={words} board={board} place="thread" nameOf={() => 'x'}><span data-kb-words>hi</span></PostEffects></PlayerProvider></KayfaProvider>
  );
  const later = new Date(Date.now() + 3_600_000).toISOString();

  test('in the board\'s effect, then the thread\'s, then the author\'s, then the post\'s own, each told its reach', () => {
    const store = createPlays();
    store.add([
      play('dab', { layer: 1 }, 'p1'),
      play('sparkle', { reach: 'character', character: 'c1', ends: later }, 'p1'),
      play('beacon', { reach: 'thread', thread: 't1', ends: later }, 'p0'),
      play('rumble', { reach: 'board', board: 'b1', ends: later }, null),
    ]);
    render(wrapped(store, 'b1'));
    const chain: string[] = [];
    for (let el: HTMLElement | null = document.querySelector('[data-kb-words]'); el; el = el.parentElement) if (el.dataset.kbWrap) chain.push(`${el.dataset.kbWrap}:${el.dataset.kbReach}`);
    /* Innermost first: the board's wraps the words, and the post's own is outermost. */
    expect(chain).toEqual(['rumble:board', 'beacon:thread', 'sparkle:character', 'dab:post']);
  });

  test('a play beyond a post stops drawing at its end, without a reread', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = createPlays();
    store.add([play('sparkle', { reach: 'character', character: 'c1', ends: new Date(Date.now() + 5_000).toISOString() }, 'p1')]);
    render(wrapped(store, null));
    expect(document.querySelector('[data-kb-wrap="sparkle"]')).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    expect(document.querySelector('[data-kb-wrap="sparkle"]')).toBeNull();
    expect(document.querySelector('[data-kb-words]')).not.toBeNull();
  });

  test('an ended play beyond a post is no mark on the postbit, and goes at its end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = world();
    w.fake.seed.reach(w.gloomba, 'character', w.spritey, 'sparkle', { post: w.ids[0]!, ends: Date.now() + 60_000 });
    await open(w);
    const reads = vi.spyOn(w.fake, 'effectsAbove');
    expect(await within(postbit(1)).findByRole('button', { name: /^Sparkle, 1 play\b.*Opens the cards on this character\./u })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    await waitFor(() => expect(sparkleMark(postbit(1))).toBeNull());
    expect(reads).not.toHaveBeenCalled();
  });
});
