import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
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

/** Every job scheduled every minute and last good at the clock, but for the ones a test stops. */
function runningWorld(): Fake {
  const fake = buildWorld();
  for (const j of ['chatter', 'conceal', 'mail', 'meet', 'search-rebuild', 'settle', 'staff', 'system-tick', 'view-counts', 'write']) {
    fake.seed.job(`kayfabb-${j}`, { lastOkAt: new Date(fake.clock.now()).toISOString() });
  }
  return fake;
}

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
    const fake = buildWorld(); // no job has a row: all would read stopped if the rows were taken as read
    fake.seed.failNextRead('offline');
    page(fake);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('strip')).toHaveTextContent('unknown');
    expect(screen.getByTestId('note')).toHaveTextContent('on time');
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
});
