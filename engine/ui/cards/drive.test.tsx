/**
 * The drive on `EffectProps` (docs/plans/2026-11-03-jimmy-wails-plan.md, Task 5): a card with `drive` is given each of its drives on the post
 * (its plays, close, total, count and latest gifts), read for the whole page in one `driveGifts` call and kept live from the thread's channel;
 * `give` answers in the database's words; a card with no `drive` is given none. The cards are the engine's own test cards, never an instance's.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { Answer, Id } from '../data/api.ts';
import { createFake } from '../data/fake.ts';
import { renderIn, testInstance } from '../test-world.tsx';
import { driveStore, drivesOfPlays, useDriveGifts } from './drives.ts';
import { PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import type { CardPlay, CardUi, Drive, EffectProps } from './types.ts';

const base = { alignment: 'sweet' as const, rarity: 'common' as const, playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const rule = (key: string, extra: Partial<CardRules> = {}): CardRules => ({ ...base, key, name: key, stack: 3, canApply: (t, e, _config, now) => landsOn({ key }, t, e, now), ...extra });
const appeal = rule('appeal', { drive: { lasts: { unit: 'day', count: 7 }, gifts: ['driveGift1', 'driveGift2'], overhead: 'driveOverhead' } });
const plain = rule('plain');
const instance: Instance = { ...testInstance, cards: [appeal, plain], settings: { ...testInstance.settings, economy: { ...testInstance.settings.economy, driveGift1: 10, driveGift2: 25, driveOverhead: 20 } } };

/* What each effect was last given, by card and post, so a test can read the props the engine hands it. */
const given = new Map<string, EffectProps>();
const art = { color: 'red', ink: 'white', canvas: '', mark: '', credit: 'Test' };
const drawing: CardUi = {
  key: 'appeal', describe: () => 'appeal', art,
  Effect: (props: EffectProps) => {
    given.set(`appeal:${props.post.id}`, props);
    return (
      <div data-testid={`drive-${props.post.id}`}>
        {(props.drives ?? []).map((d: Drive) => <span key={d.id} data-drive={d.id}>{`total ${d.total} count ${d.count} gifts ${d.gifts.length} ${d.open ? 'open' : 'closed'}`}</span>)}
        {props.children}
      </div>
    );
  },
};
const quiet: CardUi = {
  key: 'plain', describe: () => 'plain', art,
  Effect: (props: EffectProps) => { given.set(`plain:${props.post.id}`, props); return <div>{props.children}</div>; },
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); given.clear(); });

function seeded(posts = 1) {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
  const boFace = fake.seed.character(bo, 'Bo Face', 'face');
  const opening = fake.seed.thread('general', boFace, 'A thread', 'first words');
  const ids = [opening.act, ...Array.from({ length: posts - 1 }, (_, i) => fake.seed.post(opening.thread, boFace, `post ${i + 2}`))];
  fake.seed.wallet(ana, 100);
  fake.seed.wallet(bo, 0);
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, boFace, thread: opening.thread, ids };
}
type World = ReturnType<typeof seeded>;

/** A page of posts, each drawn in a PostEffects over the plays the fake holds for them, as the thread reads them. */
async function page(w: World, posts: readonly Id[] = w.ids) {
  /* The screen reads the time from Date (a drive's close is judged against it); the fake's clock is its own story, so Date is set to it. */
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(w.fake.clock.now());
  const plays = createPlays();
  plays.add(await w.fake.cardsOnMany(posts, 40));
  const acts = await Promise.all(posts.map((p) => w.fake.act(p)));
  return renderIn(w.fake, (
    <>{acts.map((a) => (
      <div key={a!.id} data-testid={`post-${a!.id}`}>
        <PostEffects plays={plays} post={a!} place="thread" nameOf={() => 'Someone'}><p>{a!.currentPayload.body as string}</p></PostEffects>
      </div>
    ))}</>
  ), { cards: [drawing, quiet], instance });
}
const refused = (error: string): Answer<never> => ({ ok: false, error } as Answer<never>);

describe('a drive is read for the page in one call and kept live', () => {
  test('a page of ten posts with drives makes one driveGifts call, naming every drive', async () => {
    const w = seeded(10);
    const drives = w.ids.map((p) => w.fake.seed.card(w.boFace, p, 'appeal'));
    const read = vi.spyOn(w.fake, 'driveGifts');
    await page(w);
    await waitFor(() => expect(screen.getAllByText(/total 0 count 0/u)).toHaveLength(10));
    expect(read).toHaveBeenCalledTimes(1);
    expect(new Set(read.mock.calls[0]![0])).toEqual(new Set(drives));
  });

  test('a page with no drive card never reads gifts', async () => {
    const w = seeded(2);
    w.fake.seed.card(w.boFace, w.ids[0]!, 'plain');
    const read = vi.spyOn(w.fake, 'driveGifts');
    await page(w);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(read).not.toHaveBeenCalled();
  });

  test('a gift broadcast on the thread adds to the total, count and latest gifts on every screen, without a reload', async () => {
    const w = seeded(1);
    const drive = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    await page(w);
    await page(w);
    await waitFor(() => expect(screen.getAllByText('total 0 count 0 gifts 0 open')).toHaveLength(2));
    const read = vi.spyOn(w.fake, 'driveGifts');
    await act(async () => { await w.fake.donate(w.anaFace, drive, 25); });
    await waitFor(() => expect(screen.getAllByText('total 25 count 1 gifts 1 open')).toHaveLength(2));
    expect(read).not.toHaveBeenCalled();
  });

  test('a gift broadcast from a giver the thread has not read is named on the wall: the read carries the name, and a live gift is named from the character\'s public name', async () => {
    const w = seeded(1);
    const drive = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    w.fake.clock.advance(1000);
    await w.fake.donate(w.anaFace, drive, 10);
    await page(w);
    await waitFor(() => expect(screen.getByText('total 10 count 1 gifts 1 open')).toBeInTheDocument());
    const wall = () => given.get(`appeal:${w.ids[0]}`)!.drives![0]!.gifts.map((g) => g.name);
    expect(wall()).toEqual(['Ana Face']);
    const dan = w.fake.seed.character(w.ana, 'Dan Face', 'face');
    w.fake.clock.advance(1000);
    await act(async () => { await w.fake.donate(dan, drive, 25); });
    await waitFor(() => expect(wall()).toEqual(['Dan Face', 'Ana Face']));
  });

  test('a reader\'s own gift is counted once, however its answer and its broadcast arrive', async () => {
    const w = seeded(1);
    const drive = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    await page(w);
    await waitFor(() => expect(screen.getByText('total 0 count 0 gifts 0 open')).toBeInTheDocument());
    const gift = await act(async () => given.get(`appeal:${w.ids[0]}`)!.give(drive, 10));
    expect(gift).toMatchObject({ ok: true });
    await waitFor(() => expect(screen.getByText('total 10 count 1 gifts 1 open')).toBeInTheDocument());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByText('total 10 count 1 gifts 1 open')).toBeInTheDocument();
  });

  test('moreGifts appends the next page by the keyset cursor', async () => {
    const w = seeded(1);
    const drive = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    w.fake.seed.wallet(w.ana, 1000);
    for (let i = 0; i < 25; i++) { w.fake.clock.advance(1000); await w.fake.donate(w.anaFace, drive, 10); }
    const more = vi.spyOn(w.fake, 'driveGiftsPage');
    await page(w);
    await waitFor(() => expect(screen.getByText('total 250 count 25 gifts 20 open')).toBeInTheDocument());
    await act(async () => { await given.get(`appeal:${w.ids[0]}`)!.moreGifts(drive); });
    await waitFor(() => expect(screen.getByText('total 250 count 25 gifts 25 open')).toBeInTheDocument());
    expect(more).toHaveBeenCalledTimes(1);
    expect(more.mock.calls[0]![0]).toBe(drive);
    expect(more.mock.calls[0]![1]).toMatchObject({ id: expect.any(String), at: expect.any(String) });
  });
});

describe('what an effect is given of a drive', () => {
  test('a card with no drive is given none, and a drive card is given its drive, its close and the reader\'s wallet', async () => {
    const w = seeded(1);
    const drive = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    w.fake.seed.card(w.boFace, w.ids[0]!, 'plain');
    await page(w);
    await waitFor(() => expect(given.get(`appeal:${w.ids[0]}`)?.drives).toHaveLength(1));
    expect(given.get(`plain:${w.ids[0]}`)!.drives).toBeUndefined();
    const mine = given.get(`appeal:${w.ids[0]}`)!;
    expect(mine.drives![0]).toMatchObject({ id: drive, open: true, total: 0, count: 0, gifts: [] });
    expect(mine.drives![0]!.plays.map((p) => p.id)).toEqual([drive]);
    expect(Date.parse(mine.drives![0]!.closes)).toBe(Date.parse(mine.drives![0]!.plays[0]!.playedAt) + 7 * 86_400_000);
    await waitFor(() => expect(given.get(`appeal:${w.ids[0]}`)!.wallet).toEqual({ balance: 100, cap: expect.any(Number) }));
  });

  test('a drive past its close is not open', async () => {
    const w = seeded(1);
    w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    w.fake.clock.advance(8 * 86_400_000);
    await page(w);
    await waitFor(() => expect(screen.getByText('total 0 count 0 gifts 0 closed')).toBeInTheDocument());
  });

  test('give returns the answer, and a refusal comes back as its words', async () => {
    const w = seeded(1);
    const drive = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    await page(w);
    await waitFor(() => expect(given.get(`appeal:${w.ids[0]}`)?.drives).toHaveLength(1));
    const props = () => given.get(`appeal:${w.ids[0]}`)!;
    expect(await act(async () => props().give(drive, 12))).toEqual(refused('a gift here is one of 0.10, 0.25'));
    const answer = await act(async () => props().give(drive, 25));
    expect(answer).toMatchObject({ ok: true, value: { balance: 75, act: { kind: 'donation', targetActId: drive } } });
  });
});

/*
 * Which plays make a drive (#447): the one client helper that mirrors the server's drive_plays and place_cast (0152_drives.sql). Plays here are plain,
 * so each test says which fact of a play it is about.
 */
describe('drivesOfPlays: which plays make a drive', () => {
  const DAY = 86_400_000;
  const T0 = Date.parse('2026-11-01T00:00:00Z');
  const rules = new Map([['appeal', appeal.drive!]]);
  const play = (id: string, at: number, extra: Partial<CardPlay> = {}): CardPlay => ({ id, card: 'appeal', layer: 1, caster: null, message: '', config: {}, playedAt: new Date(at).toISOString(), post: 'post', ...extra });
  const ids = (plays: readonly CardPlay[], now = T0) => drivesOfPlays(plays, rules, now).map((d) => [d.id, d.plays.map((p) => p.id), d.open] as const);

  test('two drives on one post: the one that closed and the one that is open', () => {
    const plays = [play('a', T0, { drive: 'a' }), play('b', T0 + 9 * DAY, { drive: 'b' })];
    expect(ids(plays, T0 + 10 * DAY)).toEqual([['a', ['a'], false], ['b', ['b'], true]]);
  });

  test('a play joining an open drive is one of its plays, and the drive stays one', () => {
    const plays = [play('a', T0, { drive: 'a' }), play('b', T0 + DAY, { drive: 'a' })];
    expect(ids(plays, T0 + 2 * DAY)).toEqual([['a', ['a', 'b'], true]]);
  });

  test('a drive closes `lasts` after its latest play, not its first', () => {
    const plays = [play('a', T0, { drive: 'a' }), play('b', T0 + 6 * DAY, { drive: 'a' })];
    const [drive] = drivesOfPlays(plays, rules, T0 + 8 * DAY);
    expect(drive!.closes).toBe(T0 + 13 * DAY);
    expect(drive!.open).toBe(true);
    expect(drivesOfPlays(plays, rules, T0 + 13 * DAY)[0]!.open).toBe(false);
  });

  test('a caught play is left out', () => {
    const plays = [play('a', T0, { drive: 'a' }), play('c', T0 + DAY, { drive: 'a', caught: 'set' })];
    expect(ids(plays)).toEqual([['a', ['a'], true]]);
    expect(drivesOfPlays([plays[1]!], rules, T0)).toEqual([]);
  });

  test('an ended play is left out: an admin\'s end, a refund, a passed end; one still ahead is kept', () => {
    const ended: Partial<CardPlay>[] = [{ reversed: true }, { untaken: true }, { ends: new Date(T0 + DAY).toISOString() }];
    for (const e of ended) expect(ids([play('a', T0, { drive: 'a' }), play('x', T0 + DAY, { drive: 'a', ...e })], T0 + 2 * DAY)).toEqual([['a', ['a'], true]]);
    expect(ids([play('a', T0, { drive: 'a' }), play('x', T0 + DAY, { drive: 'a', ends: new Date(T0 + 3 * DAY).toISOString() })], T0 + 2 * DAY)).toEqual([['a', ['a', 'x'], true]]);
  });

  test('an ended play does not hold its drive open: the close is the latest play still up', () => {
    const plays = [play('a', T0, { drive: 'a' }), play('x', T0 + 6 * DAY, { drive: 'a', reversed: true })];
    expect(drivesOfPlays(plays, rules, T0 + 8 * DAY)[0]!.closes).toBe(T0 + 7 * DAY);
  });

  test('a play that names no drive is its own drive, and a card with no drive makes none', () => {
    const plays = [play('a', T0), play('b', T0 + DAY, { drive: 'a' }), play('p', T0, { card: 'plain' })];
    expect(ids(plays, T0 + DAY)).toEqual([['a', ['a', 'b'], true]]);
    expect(ids([play('a', T0), play('b', T0 + DAY)])).toEqual([['a', ['a'], true], ['b', ['b'], true]]);
  });
});

describe('a drive past an ended play', () => {
  test('a play whose end has passed is not part of the drive an effect is given', async () => {
    const w = seeded(1);
    const first = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    w.fake.clock.advance(1000);
    w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal', { ends: new Date(w.fake.clock.now() - 1).toISOString() });
    await page(w);
    await waitFor(() => expect(given.get(`appeal:${w.ids[0]}`)?.drives).toHaveLength(1));
    expect(given.get(`appeal:${w.ids[0]}`)!.drives![0]!.plays.map((p) => p.id)).toEqual([first]);
  });
});

describe('the drives a page watches', () => {
  test('a new drive id appearing keeps an existing drive\'s total and its `more` page, and reads only the new one', async () => {
    const w = seeded(2);
    const one = w.fake.seed.card(w.boFace, w.ids[0]!, 'appeal');
    const two = w.fake.seed.card(w.boFace, w.ids[1]!, 'appeal');
    w.fake.seed.wallet(w.ana, 1000);
    for (let i = 0; i < 25; i++) { w.fake.clock.advance(1000); await w.fake.donate(w.anaFace, one, 10); }
    function Probe() {
      const [ids, setIds] = useState<readonly Id[]>([one]);
      const gifts = useDriveGifts(w.thread, ids);
      return (
        <>
          <button onClick={() => setIds([one, two])}>add</button>
          <button onClick={() => void driveStore(w.fake).more(one)}>more</button>
          {ids.map((id) => { const g = gifts.get(id)!; return <span key={id} data-testid={id === one ? 'one' : 'two'}>{`${g.loaded ? 'loaded' : 'unread'} ${g.total} ${g.gifts.length}`}</span>; })}
        </>
      );
    }
    renderIn(w.fake, <Probe />, { cards: [drawing, quiet], instance });
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('loaded 250 20'));
    fireEvent.click(screen.getByText('more'));
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('loaded 250 25'));
    const read = vi.spyOn(w.fake, 'driveGifts');
    fireEvent.click(screen.getByText('add'));
    /* The drive already watched is never shown unread, nor read again. */
    expect(screen.getByTestId('one')).toHaveTextContent('loaded 250 25');
    await waitFor(() => expect(screen.getByTestId('two')).toHaveTextContent('loaded 0 0'));
    expect(screen.getByTestId('one')).toHaveTextContent('loaded 250 25');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toEqual([two]);
  });
});
