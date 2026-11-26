import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { JOBS } from '../../rules/jobs.ts';
import { buildWorld, testInstance } from '../test-world.tsx';
import type { ScreenSettings } from '../data/api.ts';
import { useJobHealth, useJobLate } from './useJobHealth.ts';

const MINUTE = 60_000;

/** A page with two parts that each read the jobs, as the strip and a waiting note on one page do. */
function Strip() {
  const health = useJobHealth();
  return <p data-testid="strip">{health === null ? 'unknown' : health.filter((h) => h.stopped).map((h) => h.job).join(',') || 'none'}</p>;
}
function Note() {
  const late = useJobLate('kayfabb-mail');
  return <p data-testid="note">{late === null ? 'on time' : `late since ${late.since}`}</p>;
}

function page(fake: Fake) {
  const kayfa: Kayfa = { api: fake, instance: testInstance, ui: {} as Kayfa['ui'], settings: {} as ScreenSettings };
  return render(<KayfaProvider value={kayfa}><Strip /><Note /></KayfaProvider>);
}

/** Every job running, as a new world has them, but for the ones a test stops. */
const runningWorld = (): Fake => buildWorld();

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useJobHealth', () => {
  test('two consumers in one minute make one read, and a minute later another', async () => {
    const fake = runningWorld();
    const read = vi.spyOn(fake, 'jobStatus');
    page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('strip')).toHaveTextContent('none');
    /* A part that mounts later in the same minute (a note opened) reads nothing: the page's cache answers it. */
    fake.clock.advance(20_000);
    const later = page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(read).toHaveBeenCalledTimes(1);
    later.unmount();
    fake.clock.advance(MINUTE - 20_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a read that failed shows nothing late, never a stopped job', async () => {
    const fake = buildWorld();
    for (const j of JOBS) fake.seed.noJob(j.name); // no job has a row: all would read stopped if the rows were taken as read
    fake.seed.failNextRead('offline');
    page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('strip')).toHaveTextContent('unknown');
    expect(screen.getByTestId('note')).toHaveTextContent('on time');
  });

  test('a read that failed is read again a minute later, and its answer shows', async () => {
    const fake = runningWorld();
    fake.seed.job('kayfabb-mail', { lastOkAt: new Date(fake.clock.now() - 3 * 60 * MINUTE).toISOString() });
    fake.seed.failNextRead('offline');
    page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('strip')).toHaveTextContent('unknown');
    fake.clock.advance(MINUTE);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
    expect(screen.getByTestId('strip')).toHaveTextContent('kayfabb-mail');
  });

  test('the minute timer stops when the last part reading the jobs is gone', async () => {
    const fake = runningWorld();
    const view = page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a stopped job is returned by useJobLate, and the others are not', async () => {
    const fake = runningWorld();
    const old = new Date(fake.clock.now() - 3 * 60 * MINUTE).toISOString();
    fake.seed.job('kayfabb-mail', { lastOkAt: old });
    page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('note')).toHaveTextContent(`late since ${old}`);
    expect(screen.getByTestId('strip')).toHaveTextContent('kayfabb-mail');
  });

  test('each minute recomputes from the rows held: a job runs out its grace without a new read', async () => {
    const fake = runningWorld();
    const read = vi.spyOn(fake, 'jobStatus');
    fake.seed.job('kayfabb-mail', { lastOkAt: new Date(fake.clock.now()).toISOString() });
    page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('note')).toHaveTextContent('on time');
    /* The row says it ran at the start and no newer one comes: 11 minutes on, the minute's read finds mail (10 minutes of grace) late. */
    read.mockClear();
    fake.clock.advance(11 * MINUTE);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
    expect(screen.getByTestId('note')).toHaveTextContent('late since');
  });

  test('a minute where nothing changed re-renders no consumer', async () => {
    const fake = runningWorld();
    /* Rows that say each job last ran at one fixed time: a job that ran again would change `since`, which is a change. */
    const ran = new Date(fake.clock.now()).toISOString();
    for (const j of JOBS) fake.seed.job(j.name, { lastOkAt: ran });
    let renders = 0;
    function Counted() {
      const health = useJobHealth();
      renders += 1;
      return <p data-testid="counted">{health === null ? 'unknown' : 'known'}</p>;
    }
    const kayfa: Kayfa = { api: fake, instance: testInstance, ui: {} as Kayfa['ui'], settings: {} as ScreenSettings };
    render(<KayfaProvider value={kayfa}><Counted /></KayfaProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('counted')).toHaveTextContent('known');
    const before = renders;
    for (let i = 0; i < 3; i += 1) {
      fake.clock.advance(MINUTE);
      await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
    }
    expect(renders).toBe(before);
  });
});
