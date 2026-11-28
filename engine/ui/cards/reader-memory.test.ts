/**
 * What a reader keeps (engine/ui/cards/reader-memory.ts): a reader's own progress on a play, kept in their browser under one key for each play, and in the
 * page's memory when the browser's storage refuses. Plain node has no `localStorage`, so each test stands one in on `globalThis`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { readerMemory } from './reader-memory.ts';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const install = (store: Store) => Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
const mapStore = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};
const parseNum = (raw: unknown): number | null => (typeof raw === 'number' ? raw : null);

afterEach(() => {
  if (real) Object.defineProperty(globalThis, 'localStorage', real);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('readerMemory', () => {
  test('a value set is got back, and kept in storage as JSON under kb-reader:<play>', () => {
    const store = mapStore();
    install(store);
    const m = readerMemory('play-a', parseNum);
    assert.equal(m.get(), null);
    m.set(7);
    assert.equal(m.get(), 7);
    assert.equal(store.data.get('kb-reader:play-a'), '7');
  });
  test('another play\'s key is separate', () => {
    install(mapStore());
    readerMemory('play-b1', parseNum).set(1);
    readerMemory('play-b2', parseNum).set(2);
    assert.equal(readerMemory('play-b1', parseNum).get(), 1);
    assert.equal(readerMemory('play-b2', parseNum).get(), 2);
  });
  test('a storage that throws on getItem and setItem still keeps the value for the page', () => {
    const boom = () => {
      throw new Error('storage is off');
    };
    install({ getItem: boom, setItem: boom, removeItem: boom });
    const m = readerMemory('play-c', parseNum);
    m.set(5);
    assert.equal(m.get(), 5);
    assert.equal(readerMemory('play-c', parseNum).get(), 5);
    m.clear();
    assert.equal(m.get(), null);
  });
  test('a stored value parse refuses reads as null', () => {
    const store = mapStore();
    install(store);
    store.data.set('kb-reader:play-d', '"not a number"');
    assert.equal(readerMemory('play-d', parseNum).get(), null);
    store.data.set('kb-reader:play-d', '{broken');
    assert.equal(readerMemory('play-d', parseNum).get(), null);
  });
  test('clear removes it', () => {
    const store = mapStore();
    install(store);
    const m = readerMemory('play-e', parseNum);
    m.set(3);
    m.clear();
    assert.equal(m.get(), null);
    assert.equal(store.data.has('kb-reader:play-e'), false);
  });
  test('a storage that reads but refuses setItem: the newer value this page set wins over the older one stored', () => {
    const store = mapStore();
    store.data.set('kb-reader:play-f', '1');
    install({ ...store, setItem: () => { throw new Error('full'); } });
    const m = readerMemory('play-f', parseNum);
    assert.equal(m.get(), 1);
    m.set(2);
    assert.equal(m.get(), 2);
  });
  test('a storage that reads but refuses removeItem: a cleared key stays null', () => {
    const store = mapStore();
    store.data.set('kb-reader:play-g', '1');
    install({ ...store, removeItem: () => { throw new Error('refused'); } });
    const m = readerMemory('play-g', parseNum);
    assert.equal(m.get(), 1);
    m.clear();
    assert.equal(m.get(), null);
  });
  test('with no localStorage at all the page still keeps the value', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    const m = readerMemory('play-h', parseNum);
    assert.equal(m.get(), null);
    m.set(9);
    assert.equal(m.get(), 9);
    m.clear();
    assert.equal(m.get(), null);
  });
});
