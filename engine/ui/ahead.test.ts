import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { LOAD_LIMIT_MS, readAhead, resetReadAhead } from './ahead.ts';

/* The runner's timers are faked; the microtasks that follow a settle are flushed by the one real clock left. */
const flush = () => new Promise<void>((r) => setImmediate(r));
const tick = async (ms: number) => { mock.timers.tick(ms); await flush(); };

/* A read whose answer the test gives when it chooses. */
function manual() {
  let resolve!: (v?: unknown) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  const start = mock.fn(() => promise);
  return { start, resolve, reject };
}

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); resetReadAhead(); });
afterEach(() => { mock.timers.reset(); });

describe('the read-ahead gate', () => {
  test('the first starts at once', () => {
    const a = manual();
    readAhead(a.start);
    assert.equal(a.start.mock.callCount(), 1);
  });
  test('a second waits until the first resolves', async () => {
    const a = manual(); const b = manual();
    readAhead(a.start); readAhead(b.start);
    assert.equal(b.start.mock.callCount(), 0);
    a.resolve();
    await flush();
    assert.equal(b.start.mock.callCount(), 1);
  });
  test('a second also starts when the first rejects', async () => {
    const a = manual(); const b = manual();
    readAhead(a.start); readAhead(b.start);
    a.reject(new Error('no'));
    await flush();
    assert.equal(b.start.mock.callCount(), 1);
  });
  test('a third replaces the second, which is never called', async () => {
    const a = manual(); const b = manual(); const c = manual();
    readAhead(a.start); readAhead(b.start); readAhead(c.start);
    a.resolve();
    await flush();
    assert.equal(b.start.mock.callCount(), 0);
    assert.equal(c.start.mock.callCount(), 1);
  });
  test('a withdrawn waiter is never called, and the next rest starts normally after the first settles', async () => {
    const a = manual(); const b = manual(); const c = manual();
    readAhead(a.start);
    const withdraw = readAhead(b.start);
    withdraw();
    a.resolve();
    await flush();
    assert.equal(b.start.mock.callCount(), 0);
    readAhead(c.start);
    assert.equal(c.start.mock.callCount(), 1);
  });
  test('withdrawing twice, or a replaced one, is harmless', async () => {
    const a = manual(); const b = manual(); const c = manual();
    readAhead(a.start);
    const wb = readAhead(b.start);
    readAhead(c.start);
    wb(); wb();
    a.resolve();
    await flush();
    assert.equal(c.start.mock.callCount(), 1);
  });
  test('a read that never settles lets go at the load limit', async () => {
    const a = manual(); const b = manual();
    readAhead(a.start); readAhead(b.start);
    await tick(LOAD_LIMIT_MS - 1);
    assert.equal(b.start.mock.callCount(), 0);
    await tick(1);
    assert.equal(b.start.mock.callCount(), 1);
  });
  test('a late settle of a read that was let go does not release the next one', async () => {
    const a = manual(); const b = manual(); const c = manual();
    readAhead(a.start); readAhead(b.start);
    await tick(LOAD_LIMIT_MS);
    readAhead(c.start);
    a.resolve();
    await flush();
    /* b holds the gate, c waits: a's late answer let nothing go. */
    assert.equal(c.start.mock.callCount(), 0);
    b.resolve();
    await flush();
    assert.equal(c.start.mock.callCount(), 1);
  });
  test('a start that throws does not jam the gate', async () => {
    const boom = mock.fn((): Promise<unknown> => { throw new Error('sync'); });
    const b = manual();
    readAhead(boom);
    readAhead(b.start);
    assert.equal(b.start.mock.callCount(), 1);
  });
  test('a waiter whose start throws lets the gate go to nothing', async () => {
    const a = manual(); const b = manual();
    const boom = mock.fn((): Promise<unknown> => { throw new Error('sync'); });
    readAhead(a.start); readAhead(boom);
    a.resolve();
    await flush();
    readAhead(b.start);
    assert.equal(b.start.mock.callCount(), 1);
  });
  test('withdrawing after start does nothing', async () => {
    const a = manual(); const b = manual();
    const withdraw = readAhead(a.start);
    readAhead(b.start);
    withdraw();
    assert.equal(a.start.mock.callCount(), 1);
    a.resolve();
    await flush();
    assert.equal(b.start.mock.callCount(), 1);
  });
});
