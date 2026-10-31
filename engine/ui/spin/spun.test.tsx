/** The loader behind "Spun into": batching, bounds, the clock, and what a failure leaves behind. */
import { describe, expect, test, vi } from 'vitest';
import { SPUN_FROM_MAX, type Id, type KayfaApi, type ThreadSummary } from '../data/api.ts';
import { SPUN_CACHE_SIZE, SPUN_CHUNK, SPUN_READ_LIMIT, SPUN_SHOWN, SPUN_TTL_MS, createSpunLoader, primeSpun, spunCount } from './spun.ts';

const thread = (origin: Id, n: number): ThreadSummary => ({
  id: `${origin}-t${n}`, board: 'b', title: `T${n}`, originActId: origin, createdAt: '2026-10-29T12:00:00Z', lastAt: '2026-10-29T12:00:00Z', lastSeq: 1,
  replies: 0, firstAct: null, firstCharacter: null, lastAct: null, lastCharacter: null, repliesThisWeek: 0, originThread: null, originTitle: null, originSeq: null,
});

function setup(spins: Readonly<Record<Id, number>> = {}) {
  const many = vi.fn(async (acts: readonly Id[], limit: number) => acts.flatMap((a) => Array.from({ length: spins[a] ?? 0 }, (_, i) => thread(a, i))).slice(0, limit));
  const one = vi.fn(async (act: Id, limit = SPUN_FROM_MAX) => Array.from({ length: spins[act] ?? 0 }, (_, i) => thread(act, i)).slice(0, limit));
  const api = { spunFromMany: many, spunFrom: one } as unknown as KayfaApi;
  let now = 1_000;
  const loader = createSpunLoader(api, () => now);
  return { loader, many, one, tick: (ms: number) => { now += ms; } };
}

describe('the Spun-into loader', () => {
  test('answers within the time to live from one read, and reads again after it', async () => {
    const { loader, many, tick } = setup({ a: 2 });
    expect((await loader.ask('a')).threads).toHaveLength(2);
    tick(SPUN_TTL_MS - 1);
    await loader.ask('a');
    expect(many).toHaveBeenCalledTimes(1);
    tick(1);
    await loader.ask('a');
    expect(many).toHaveBeenCalledTimes(2);
  });

  test('asks of one tick go out together, in chunks of the chunk size, each read limited', async () => {
    const { loader, many } = setup();
    const ids = Array.from({ length: SPUN_CHUNK * 2 + 5 }, (_, i) => `a${i}`);
    await Promise.all(ids.map((id) => loader.ask(id)));
    expect(many.mock.calls.map(([acts, limit]) => [acts.length, limit])).toEqual([[SPUN_CHUNK, SPUN_READ_LIMIT], [SPUN_CHUNK, SPUN_READ_LIMIT], [5, SPUN_READ_LIMIT]]);
  });

  test('remembers only the last five hundred Acts, the oldest forgotten first', async () => {
    const { loader, many } = setup();
    const ids = Array.from({ length: SPUN_CACHE_SIZE + 1 }, (_, i) => `a${i}`);
    await Promise.all(ids.map((id) => loader.ask(id)));
    const reads = many.mock.calls.length;
    await loader.ask(`a${SPUN_CACHE_SIZE}`);
    expect(many.mock.calls.length).toBe(reads);
    await loader.ask('a0');
    expect(many.mock.calls.length).toBe(reads + 1);
  });

  test('forget makes the next ask read again', async () => {
    const { loader, many } = setup({ a: 1 });
    await loader.ask('a');
    loader.forget('a');
    await loader.ask('a');
    expect(many).toHaveBeenCalledTimes(2);
  });

  test('a read that failed answers with nothing and is not remembered', async () => {
    const { loader, many } = setup({ a: 1 });
    many.mockRejectedValueOnce(new Error('down'));
    expect(await loader.ask('a')).toEqual({ threads: [], more: 0, atLeast: false });
    expect((await loader.ask('a')).threads).toHaveLength(1);
    expect(many).toHaveBeenCalledTimes(2);
  });

  test('a late failure forgets only its own entry, not one asked for since', async () => {
    const { loader, many } = setup({ a: 1 });
    let fail!: () => void;
    many.mockImplementationOnce(() => new Promise((_, reject) => { fail = () => reject(new Error('late')); }));
    const first = loader.ask('a');
    await Promise.resolve();
    loader.forget('a');
    expect((await loader.ask('a')).threads).toHaveLength(1);
    fail();
    await first;
    await loader.ask('a');
    expect(many).toHaveBeenCalledTimes(2);
  });

  test('keeps the first five of an Act and how many more', async () => {
    const { loader } = setup({ a: SPUN_SHOWN + 3 });
    const got = await loader.ask('a');
    expect(got.threads).toHaveLength(SPUN_SHOWN);
    expect([got.more, got.atLeast]).toEqual([3, false]);
  });

  test('a read cut at its limit has each Act asked alone, so no list is short without saying so', async () => {
    const { loader, many, one } = setup({ big: SPUN_READ_LIMIT + 50, small: 1 });
    const [big, small] = await Promise.all([loader.ask('big'), loader.ask('small')]);
    expect(many).toHaveBeenCalledTimes(1);
    expect(one.mock.calls.map(([a]) => a).sort()).toEqual(['big', 'small']);
    expect(big.more).toBe(SPUN_FROM_MAX - SPUN_SHOWN);
    expect(big.atLeast).toBe(true);
    expect([small.threads.length, small.atLeast]).toEqual([1, false]);
  });
});

describe('priming the spins of a page', () => {
  test('asks each Act once, in the line\'s chunks, and answers for every Act asked, a failed read counting as none spun', async () => {
    const many = vi.fn(async (acts: readonly Id[]) => {
      if (acts.includes('bad')) throw new Error('down');
      return acts.filter((a) => a === 'a').map((a) => thread(a, 0));
    });
    const api = { spunFromMany: many, spunFrom: vi.fn(async () => []) } as unknown as KayfaApi;
    const ids = ['a', 'a', ...Array.from({ length: SPUN_CHUNK }, (_, i) => `x${i}`), 'bad'];
    const spun = await primeSpun(api, ids);
    expect(many.mock.calls.map(([acts]) => acts.length)).toEqual([SPUN_CHUNK, 2]);
    expect(spun.size).toBe(SPUN_CHUNK + 2);
    expect(spunCount(spun.get('a')!)).toBe(1);
    expect(spunCount(spun.get('x0')!)).toBe(0);
    expect(spunCount(spun.get('bad')!)).toBe(0);
  });
});
