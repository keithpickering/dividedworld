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
import { useHistory } from '../thread/lines.tsx';
import { renderIn, testInstance } from '../test-world.tsx';
import { MomentEffects, PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import { tailStore, TAILS_PER_READ } from './tails.ts';
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
