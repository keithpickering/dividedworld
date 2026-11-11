/**
 * A writing card's tails on the screens (docs/plans/2026-11-07-you-were-saying-plan.md, Task 6): the page reads the tails of its posts in one
 * request, never one per post, and not at all where no play on it is a card that writes; a `card_text` event reads that one post again;
 * History draws each version's own tail, still; a moment draws the version it landed on; and the body is a block a tail can follow inline.
 * The cards are the engine's own test cards, never an instance's.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { BbCode } from '../bbcode/render.tsx';
import type { Act, Id, KayfaApi, Tail } from '../data/api.ts';
import { createFake } from '../data/fake.ts';
import { ThreadCtx, type ThreadContext } from '../thread/context.ts';
import { useHistory } from '../thread/lines.tsx';
import { renderIn, testInstance } from '../test-world.tsx';
import { MomentEffects, PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import { HELD_POSTS, POLL_FIRST, POLL_LAST, tailStore, TAILS_PER_READ } from './tails.ts';
import type { CardUi, EffectProps, Written } from './types.ts';

const base = { alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const rule = (key: string, extra: Partial<CardRules> = {}): CardRules => ({ ...base, key, name: key, canApply: (t, e, _config, now) => landsOn({ key }, t, e, now), ...extra });
const wrote = rule('wrote', { stack: 3, validateState: (s) => ok(s), writes: { tokens: () => 10, frame: () => ({ prompt: '', stop: [] }) } });
const plain = rule('plain');
const instance: Instance = { ...testInstance, cards: [wrote, plain] };

const words = (w: Written | undefined) => (w === undefined ? 'none' : 'text' in w ? w.text : 'waiting' in w ? '...' : 'failed');
/* A writing effect: the words, then each play's tail after them (`data-kb-tail`), saying whether it was drawn still. */
const tailing: CardUi = {
  key: 'wrote', describe: () => 'wrote', art: { color: 'red', ink: 'white', canvas: '', mark: '', credit: 'Test' },
  Effect: ({ children, plays, written, still }: EffectProps) => (
    <>{children}{plays.map((p) => <span key={p.id} data-kb-tail data-play={p.id} data-still={String(still)}>{words(written.get(p.id))}</span>)}</>
  ),
};
const quiet: CardUi = { key: 'plain', describe: () => 'plain', art: tailing.art, Effect: ({ children }: EffectProps) => <div>{children}</div> };

afterEach(() => { vi.restoreAllMocks(); });

function seeded() {
  const fake = createFake({ instance });
  const me = fake.seed.account('me');
  const mask = fake.seed.character(me, 'Spritey', 'face');
  const opening = fake.seed.thread('general', mask, 'A thread', 'first words');
  const p1 = opening.act;
  const p2 = fake.seed.post(opening.thread, mask, 'second words');
  const p3 = fake.seed.post(opening.thread, mask, 'third words');
  fake.signInAs(me);
  return { fake, me, mask, thread: opening.thread, p1, p2, p3 };
}
type World = ReturnType<typeof seeded>;

/** A page of posts: each drawn in a PostEffects over the plays the fake holds for them, as the thread reads them. */
async function page(w: World, posts: readonly Id[]) {
  const plays = createPlays();
  plays.add(await w.fake.cardsOnMany(posts, 40));
  const acts = await Promise.all(posts.map((p) => w.fake.act(p)));
  const view = renderIn(w.fake, (
    <>{acts.map((a) => (
      <div key={a!.id} data-testid={`post-${a!.id}`}>
        <PostEffects plays={plays} post={a!} place="thread" nameOf={() => 'Someone'}><p>{a!.currentPayload.body as string}</p></PostEffects>
      </div>
    ))}</>
  ), { cards: [tailing, quiet], instance });
  return { plays, view };
}
const tailsOf = (post: Id) => within(screen.getByTestId(`post-${post}`)).queryAllByText(/.*/u, { selector: '[data-kb-tail]' });
const nextTick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('PostEffects gives a writing card its plays\' tails', () => {
  test('two plays and their tails: each play gets its own text', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    const b = w.fake.seed.card(w.mask, w.p1, 'wrote');
    w.fake.seed.text(a, w.p1, { text: ' one' }, { quiet: true });
    w.fake.seed.text(b, w.p1, { text: ' two' }, { quiet: true });
    await page(w, [w.p1]);
    expect(await screen.findByText('one')).toHaveAttribute('data-play', a);
    expect(screen.getByText('two')).toHaveAttribute('data-play', b);
  });

  test('a play whose generation is waiting is waiting, and its text types in when it is delivered', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    await page(w, [w.p1]);
    expect(await screen.findByText('...')).toHaveAttribute('data-play', a);
    act(() => { w.fake.seed.text(a, w.p1, { text: 'arrived' }); });
    expect(await screen.findByText('arrived')).toHaveAttribute('data-play', a);
  });
});

describe('the page\'s tails are one request', () => {
  test('a page of posts reads every post\'s tails in a single call, however many posts hold a writing play', async () => {
    const w = seeded();
    for (const p of [w.p1, w.p2, w.p3]) w.fake.seed.card(w.mask, p, 'wrote');
    const read = vi.spyOn(w.fake, 'tails');
    await page(w, [w.p1, w.p2, w.p3]);
    await waitFor(() => expect(tailsOf(w.p3)).toHaveLength(1));
    expect(read).toHaveBeenCalledTimes(1);
    expect(new Set(read.mock.calls[0]![0])).toEqual(new Set([w.p1, w.p2, w.p3]));
  });

  test('a page whose plays are no writing cards, or that has none, never asks', async () => {
    const w = seeded();
    w.fake.seed.card(w.mask, w.p1, 'plain');
    const read = vi.spyOn(w.fake, 'tails');
    await page(w, [w.p1, w.p2]);
    await nextTick();
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText('first words')).toBeInTheDocument();
  });

  test('more than 200 posts are read in calls of at most 200', async () => {
    const tails = vi.fn(async (_posts: readonly Id[]): Promise<readonly Tail[]> => []);
    const api = { tails, subscribeThread: () => () => {} } as unknown as KayfaApi;
    const store = tailStore(api);
    const posts = Array.from({ length: 450 }, (_, i) => `post-${i}`);
    for (const p of posts) store.watch({ id: p, thread: 't1' }, [`play-${p}`], null);
    await waitFor(() => expect(tails).toHaveBeenCalledTimes(3));
    expect(tails.mock.calls.map((c) => c[0].length)).toEqual([TAILS_PER_READ, TAILS_PER_READ, 50]);
    expect(new Set(tails.mock.calls.flatMap((c) => c[0])).size).toBe(450);
  });
});

describe('a card_text event reads that one post again', () => {
  test('only the post whose play it names is read, and what it holds is drawn', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    const b = w.fake.seed.card(w.mask, w.p2, 'wrote');
    await page(w, [w.p1, w.p2]);
    await waitFor(() => expect(screen.getAllByText('...')).toHaveLength(2));
    const read = vi.spyOn(w.fake, 'tails');
    act(() => { w.fake.seed.text(a, w.p1, { text: 'only here' }); });
    expect(await screen.findByText('only here')).toHaveAttribute('data-play', a);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toEqual([w.p1]);
    expect(within(screen.getByTestId(`post-${w.p2}`)).getByText('...')).toHaveAttribute('data-play', b);
  });

  test('a first generation that failed for good is learned from the event: the play is over on this page, with one more read of that post\'s plays', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    const b = w.fake.seed.card(w.mask, w.p2, 'wrote');
    const { plays } = await page(w, [w.p1, w.p2]);
    await waitFor(() => expect(screen.getAllByText('...')).toHaveLength(2));
    const shown = () => plays.get(w.p1).plays.filter((p) => !p.untaken).length;
    expect(shown()).toBe(1);
    const tails = vi.spyOn(w.fake, 'tails');
    const read = vi.spyOn(w.fake, 'cardsOnMany');
    act(() => { w.fake.seed.text(a, w.p1, { failed: true }); });
    await waitFor(() => expect(plays.get(w.p1).plays[0]?.untaken).toBe(true));
    expect(shown()).toBe(0);
    expect(tails).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toEqual([w.p1]);
    /* The play is no layer now, so no tail is drawn for it; the other post is as it was. */
    await waitFor(() => expect(within(screen.getByTestId(`post-${w.p1}`)).queryByText('...')).toBeNull());
    expect(within(screen.getByTestId(`post-${w.p2}`)).getByText('...')).toHaveAttribute('data-play', b);
    expect(plays.get(w.p2).plays[0]?.untaken).toBeUndefined();
    await nextTick();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a failed regeneration after a text makes no extra read of the plays: the play took', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    w.fake.seed.text(a, w.p1, { text: 'kept tail' }, { quiet: true });
    const { plays } = await page(w, [w.p1]);
    await screen.findByText('kept tail');
    const edited = await w.fake.edit(w.p1, w.mask, 'edited words');
    expect(edited.ok).toBe(true);
    const read = vi.spyOn(w.fake, 'cardsOnMany');
    act(() => { w.fake.seed.text(a, (edited as { value: Act }).value.id, { failed: true }); });
    await nextTick();
    expect(read).not.toHaveBeenCalled();
    expect(plays.get(w.p1).plays[0]?.untaken).toBeUndefined();
  });

  test('an event for a play the page does not hold is ignored', async () => {
    const w = seeded();
    const held = w.fake.seed.card(w.mask, w.p1, 'wrote');
    const elsewhere = w.fake.seed.card(w.mask, w.p3, 'wrote');
    await page(w, [w.p1]);
    await screen.findByText('...');
    const read = vi.spyOn(w.fake, 'tails');
    act(() => { w.fake.seed.text(elsewhere, w.p3, { text: 'not here' }); });
    await nextTick();
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByText('not here')).toBeNull();
    expect(screen.getByText('...')).toHaveAttribute('data-play', held);
  });

  test('a post edited since it was read is read again, so the tail waiting for the edit shows as waiting', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    w.fake.seed.text(a, w.p1, { text: 'old tail' }, { quiet: true });
    const plays = createPlays();
    plays.add(await w.fake.cardsOnMany([w.p1], 8));
    let show!: (post: Act) => void;
    function Post({ first }: { readonly first: Act }) {
      const [post, set] = useState(first);
      show = set;
      return <PostEffects plays={plays} post={post} place="thread" nameOf={() => ''}><p>words</p></PostEffects>;
    }
    renderIn(w.fake, <Post first={(await w.fake.act(w.p1))!} />, { cards: [tailing], instance });
    await screen.findByText('old tail');
    const read = vi.spyOn(w.fake, 'tails');
    expect((await w.fake.edit(w.p1, w.mask, 'edited words')).ok).toBe(true);
    const next = (await w.fake.act(w.p1))!;
    act(() => { show(next); });
    expect(await screen.findByText('...')).toHaveAttribute('data-play', a);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('the body is a block a tail follows inline', () => {
  test('the tail is the next sibling of the body\'s container, and that container is inline where a tail follows it', async () => {
    const w = seeded();
    const a = w.fake.seed.card(w.mask, w.p1, 'wrote');
    w.fake.seed.text(a, w.p1, { text: ' and on it went' }, { quiet: true });
    const plays = createPlays();
    plays.add(await w.fake.cardsOnMany([w.p1], 8));
    const post = (await w.fake.act(w.p1))!;
    renderIn(w.fake, <div className="kb-act-main"><PostEffects plays={plays} post={post} place="thread" nameOf={() => ''}><BbCode text="the last line" /></PostEffects></div>, { cards: [tailing], instance });
    const tail = await screen.findByText('and on it went');
    const body = document.querySelector<HTMLElement>('.kb-bb')!;
    expect(body.nextElementSibling).toBe(tail);
    expect(body.parentElement).toBe(tail.parentElement);
    expect(getComputedStyle(body).display).toBe('inline');
    /* Nothing follows the words where no tail does: the body stays the block it always was. */
    const lone = document.createElement('div');
    lone.innerHTML = '<div class="kb-bb">words</div><p>after</p>';
    document.body.append(lone);
    expect(getComputedStyle(lone.querySelector('.kb-bb')!).display).toBe('block');
  });
});

/* A post by the signed-in mask, edited twice: three versions, and a writing play on it. An edit's answer is the post, so the versions are read from its History. */
async function edited() {
  const w = seeded();
  const play = w.fake.seed.card(w.mask, w.p1, 'wrote');
  w.fake.clock.advance(60_000);
  expect((await w.fake.edit(w.p1, w.mask, 'second version')).ok).toBe(true);
  w.fake.clock.advance(60_000);
  expect((await w.fake.edit(w.p1, w.mask, 'third version')).ok).toBe(true);
  const [, e1, e2] = (await w.fake.history(w.p1)).map((v) => v.id);
  return { ...w, play, e1: e1!, e2: e2! };
}

describe('History draws each version\'s own tail, still', () => {
  test('three versions and two rows draw two tails, each in its version, with no input and no clear', async () => {
    const w = await edited();
    w.fake.seed.text(w.play, w.p1, { text: 'first tail' }, { quiet: true });
    w.fake.seed.text(w.play, w.e2, { text: 'third tail' }, { quiet: true });
    function History() { const h = useHistory(w.p1); return <>{h.button}{h.panel}</>; }
    renderIn(w.fake, <History />, { cards: [tailing, quiet], instance });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const list = await screen.findByRole('list', { name: 'Versions of this post, oldest first' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    await waitFor(() => expect(list.querySelectorAll('[data-kb-tail]')).toHaveLength(2));
    expect(within(rows[0]!).getByText('first tail')).toHaveAttribute('data-still', 'true');
    expect(rows[1]!.querySelector('[data-kb-tail]')).toBeNull();
    expect(within(rows[2]!).getByText('third tail')).toHaveAttribute('data-still', 'true');
  });
});

describe('a moment draws the tail of the version it landed on', () => {
  test('the version current when the play landed, not the one current now', async () => {
    const w = seeded();
    w.fake.clock.advance(60_000);
    expect((await w.fake.edit(w.p1, w.mask, 'second version')).ok).toBe(true);
    w.fake.clock.advance(60_000);
    const play = w.fake.seed.card(w.mask, w.p1, 'wrote');
    w.fake.clock.advance(60_000);
    expect((await w.fake.edit(w.p1, w.mask, 'third version')).ok).toBe(true);
    const [, e1, e2] = (await w.fake.history(w.p1)).map((v) => v.id);
    w.fake.seed.text(play, e1!, { text: 'then tail' }, { quiet: true });
    w.fake.seed.text(play, e2!, { text: 'now tail' }, { quiet: true });
    const moment = (await w.fake.playMoment(play))!;
    expect(moment.version.currentPayload.body).toBe('second version');
    renderIn(w.fake, <MomentEffects moment={moment} place="thread" nameOf={() => ''} onWords={() => {}}><span>second version</span></MomentEffects>, { cards: [tailing], instance });
    const tail = await screen.findByText('then tail');
    expect(tail).toHaveAttribute('data-still', 'true');
    expect(screen.queryByText('now tail')).toBeNull();
  });
});

describe('a post nobody asked about is not read', () => {
  test('the store of an api is one, and watching a post with no play reads nothing', async () => {
    const tails = vi.fn(async () => [] as readonly Tail[]);
    const api = { tails, subscribeThread: () => () => {} } as unknown as KayfaApi;
    expect(tailStore(api)).toBe(tailStore(api));
    tailStore(api).watch({ id: 'p', thread: 't' }, [], null);
    await nextTick();
    expect(tails).not.toHaveBeenCalled();
  });
});

/* The store alone, over an api whose answers the test sets, with the clock held: what a reader does when an event was missed. */
function rig() {
  let held: Tail[] = [];
  let failing = 0;
  const tails = vi.fn(async (posts: readonly Id[]): Promise<readonly Tail[]> => {
    if (failing > 0) { failing -= 1; throw new Error('offline'); }
    return held.filter((r) => posts.includes(r.post));
  });
  const api = { tails, subscribeThread: () => () => {} } as unknown as KayfaApi;
  const row = (post: Id, play: Id, text: string | null): Tail => ({ post, play, version: `${post}-v`, text, failed: false, waiting: text === null, createdAt: text === null ? null : 'then' });
  return { api, tails, store: tailStore(api), row, set: (rows: Tail[]) => { held = rows; }, fail: (n: number) => { failing = n; } };
}
const hidden = (is: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (is ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
};
const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const textOf = (rows: readonly Tail[]) => rows.map((r) => r.text);

describe('a waiting cursor is not left behind by a missed event', () => {
  afterEach(() => { vi.useRealTimers(); hidden(false); });

  test('a post watched again after its text came while nobody listened is read again, and draws the text', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.set([r.row('p', 'a', null)]);
    const off = r.store.watch({ id: 'p', thread: 't' }, ['a'], 'e1');
    await pass(0);
    expect(r.store.rows('p').map((x) => x.waiting)).toEqual([true]);
    off();
    await pass(0);
    r.set([r.row('p', 'a', 'came')]);
    r.store.watch({ id: 'p', thread: 't' }, ['a'], 'e1');
    await pass(0);
    expect(r.tails).toHaveBeenCalledTimes(2);
    expect(textOf(r.store.rows('p'))).toEqual(['came']);
  });

  test('a waiting row is read again on a timer that backs off, and stops when its text arrives', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.set([r.row('p', 'a', null)]);
    r.store.watch({ id: 'p', thread: 't' }, ['a'], null);
    await pass(0);
    expect(r.tails).toHaveBeenCalledTimes(1);
    await pass(POLL_FIRST - 1);
    expect(r.tails).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(r.tails).toHaveBeenCalledTimes(2);
    await pass(POLL_FIRST * 2);
    expect(r.tails).toHaveBeenCalledTimes(3);
    await pass(POLL_FIRST * 4);
    expect(r.tails).toHaveBeenCalledTimes(4);
    /* The delay stops growing at its last value. */
    await pass(POLL_LAST);
    expect(r.tails).toHaveBeenCalledTimes(5);
    await pass(POLL_LAST);
    expect(r.tails).toHaveBeenCalledTimes(6);
    r.set([r.row('p', 'a', 'here')]);
    await pass(POLL_LAST);
    expect(textOf(r.store.rows('p'))).toEqual(['here']);
    const calls = r.tails.mock.calls.length;
    await pass(10 * POLL_LAST);
    expect(r.tails).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('two waiting posts are one call a tick, and a post that is not waiting is not in it', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.set([r.row('p1', 'a', null), r.row('p2', 'b', null), r.row('p3', 'c', 'done')]);
    for (const [p, play] of [['p1', 'a'], ['p2', 'b'], ['p3', 'c']] as const) r.store.watch({ id: p, thread: 't' }, [play], null);
    await pass(0);
    expect(r.tails).toHaveBeenCalledTimes(1);
    await pass(POLL_FIRST);
    expect(r.tails).toHaveBeenCalledTimes(2);
    expect(new Set(r.tails.mock.calls[1]![0])).toEqual(new Set(['p1', 'p2']));
  });

  test('no timer runs with nothing waiting, after the last watcher goes, or while the document is hidden', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.set([r.row('p', 'a', 'text')]);
    const off = r.store.watch({ id: 'p', thread: 't' }, ['a'], null);
    await pass(0);
    expect(vi.getTimerCount()).toBe(0);
    off();
    r.set([r.row('q', 'b', null)]);
    const offQ = r.store.watch({ id: 'q', thread: 't' }, ['b'], null);
    await pass(0);
    expect(vi.getTimerCount()).toBe(1);
    offQ();
    await pass(0);
    expect(vi.getTimerCount()).toBe(0);
    const before = r.tails.mock.calls.length;
    await pass(POLL_LAST * 3);
    expect(r.tails).toHaveBeenCalledTimes(before);
    /* Hidden: it waits, with no timer, and goes on when the document is shown. */
    hidden(true);
    r.store.watch({ id: 'q', thread: 't' }, ['b'], null);
    await pass(0);
    expect(vi.getTimerCount()).toBe(0);
    await pass(POLL_LAST * 3);
    expect(r.tails).toHaveBeenCalledTimes(before + 1);
    hidden(false);
    await pass(POLL_FIRST);
    expect(r.tails).toHaveBeenCalledTimes(before + 2);
  });

  test('a read that failed is asked again on the same backoff while the post is watched', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.set([r.row('p', 'a', 'late')]);
    r.fail(1);
    const off = r.store.watch({ id: 'p', thread: 't' }, ['a'], null);
    await pass(0);
    expect(r.tails).toHaveBeenCalledTimes(1);
    expect(r.store.rows('p')).toHaveLength(0);
    await pass(POLL_FIRST);
    expect(r.tails).toHaveBeenCalledTimes(2);
    expect(textOf(r.store.rows('p'))).toEqual(['late']);
    expect(vi.getTimerCount()).toBe(0);
    off();
  });
});

describe('what the store keeps', () => {
  test('a post nobody watches is dropped once more posts than the store holds have been read', async () => {
    const r = rig();
    r.set([r.row('p0', 'a', 'kept for a while')]);
    r.store.watch({ id: 'p0', thread: 't' }, ['a'], null)();
    await nextTick();
    expect(textOf(r.store.rows('p0'))).toEqual(['kept for a while']);
    for (let i = 1; i <= HELD_POSTS; i += 1) r.store.watch({ id: `q${i}`, thread: 't' }, [`a${i}`], null);
    await nextTick();
    expect(r.store.rows('p0')).toHaveLength(0);
    r.store.watch({ id: 'p0', thread: 't' }, ['a'], null);
    const asked = r.tails.mock.calls.length;
    await nextTick();
    expect(r.tails.mock.calls.length).toBeGreaterThan(asked);
    expect(textOf(r.store.rows('p0'))).toEqual(['kept for a while']);
  });

  test('a moment beside the live post, which names an older edit, makes no read of its own', async () => {
    const r = rig();
    r.set([r.row('p', 'a', 'text')]);
    r.store.watch({ id: 'p', thread: 't' }, ['a'], '2026-11-07T12:00:00.000Z');
    await nextTick();
    expect(r.tails).toHaveBeenCalledTimes(1);
    r.store.watch({ id: 'p', thread: 't' }, ['a'], '2026-11-07T11:00:00.000Z');
    await nextTick();
    /* And the live post's own stamp is still the one held: the same stamp again is no read. */
    r.store.watch({ id: 'p', thread: 't' }, ['a'], '2026-11-07T12:00:00.000Z');
    await nextTick();
    expect(r.tails).toHaveBeenCalledTimes(1);
  });
});

describe('History reads only where the post has a writing play', () => {
  const context = (plays: ReturnType<typeof createPlays>) => ({ plays, nameOf: () => '' }) as unknown as ThreadContext;
  function History({ post }: { readonly post: Id }) { const h = useHistory(post); return <>{h.button}{h.panel}</>; }
  async function open(w: Awaited<ReturnType<typeof edited>>, plays?: ReturnType<typeof createPlays>) {
    const view = renderIn(w.fake, plays ? <ThreadCtx.Provider value={context(plays)}><History post={w.p1} /></ThreadCtx.Provider> : <History post={w.p1} />, { cards: [tailing, quiet], instance });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByRole('list', { name: 'Versions of this post, oldest first' });
    await nextTick();
    return view;
  }

  test('a post with no writing play asks for no tails, and, in a thread, for no plays either', async () => {
    const w = seeded();
    w.fake.seed.card(w.mask, w.p1, 'plain');
    w.fake.clock.advance(60_000);
    expect((await w.fake.edit(w.p1, w.mask, 'second version')).ok).toBe(true);
    const plays = createPlays();
    plays.add(await w.fake.cardsOnMany([w.p1], 8));
    const tails = vi.spyOn(w.fake, 'tails');
    const on = vi.spyOn(w.fake, 'cardsOn');
    await open({ ...w, play: '', e1: '', e2: '' }, plays);
    expect(tails).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });

  test('where the thread is not known, the plays are read, and no tails where none of them writes', async () => {
    const w = seeded();
    w.fake.seed.card(w.mask, w.p1, 'plain');
    w.fake.clock.advance(60_000);
    expect((await w.fake.edit(w.p1, w.mask, 'second version')).ok).toBe(true);
    const tails = vi.spyOn(w.fake, 'tails');
    const on = vi.spyOn(w.fake, 'cardsOn');
    await open({ ...w, play: '', e1: '', e2: '' });
    expect(on).toHaveBeenCalledTimes(1);
    expect(tails).not.toHaveBeenCalled();
  });

  test('a post with a writing play reads its tails once, from the plays the thread holds', async () => {
    const w = await edited();
    w.fake.seed.text(w.play, w.p1, { text: 'first tail' }, { quiet: true });
    const plays = createPlays();
    plays.add(await w.fake.cardsOnMany([w.p1], 8));
    const tails = vi.spyOn(w.fake, 'tails');
    const on = vi.spyOn(w.fake, 'cardsOn');
    await open(w, plays);
    expect(await screen.findByText('first tail')).toHaveAttribute('data-still', 'true');
    expect(tails).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalled();
  });
});
