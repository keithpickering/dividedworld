/**
 * The reads a trapStruck alert's words need (trap-reads.ts): the spring and the set a card names, and the setter's character, each in one call.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Act, Alert } from '../data/api.ts';
import { readTrapActs } from './trap-reads.ts';

const act = (id: string, o: Partial<Act> = {}): Act => ({ id, character: 'c', kind: 'post', thread: 't', targetActId: null, seq: null, createdAt: '2026-11-02T09:41:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...o });
const row = (act: string | null, kind: Alert['kind'] = 'trapStruck'): Alert => ({ kind, sub: null, act, character: 'c1', at: '2026-11-02T09:41:00.000Z', thread: 't', name: null, title: null, count: null });
const world = new Map([['sp', act('sp', { kind: 'spring', character: 'cPipe', payload: { set: 'set1' } })], ['set1', act('set1', { kind: 'set', character: 'cPipe' })]]);
let staffSetter = false;
const api = (calls: string[][]) => ({
  actsById: async (ids: readonly string[]) => { calls.push([...ids]); return ids.flatMap((i) => world.get(i) ?? []); },
  characters: async (ids: readonly string[]) => ids.map((id) => ({ id, name: id === 'cPipe' ? 'Pipewrench' : 'x', ...(id === 'cPipe' && staffSetter ? { staff: 'clerk' } : {}) })),
}) as never;

describe('readTrapActs', () => {
  test('a card landed from a back: reads the spring, then the set, then the setter\'s name', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', spring: 'sp' } })]]);
    const got = await readTrapActs(api(calls), [row('k')], held);
    assert.deepEqual(calls, [['sp'], ['set1']]);
    assert.deepEqual([...got.acts.keys()].sort(), ['set1', 'sp']);
    assert.deepEqual([...got.names], [['cPipe', 'Pipewrench']]);
  });
  test('a cast a trap caught names the set itself; a staff setter is told apart', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', caught: 'set1' } })]]);
    staffSetter = true;
    const got = await readTrapActs(api(calls), [row('k')], held);
    staffSetter = false;
    assert.deepEqual(calls, [['set1']]);
    assert.deepEqual([...got.staff], ['cPipe']);
    assert.deepEqual([...got.acts.keys()], ['set1']);
  });
  test('a cast that rode a ride back names the set itself, as a catch does, and the setter is named', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', rode: 'set1' } })]]);
    const got = await readTrapActs(api(calls), [row('k')], held);
    assert.deepEqual(calls, [['set1']]);
    assert.deepEqual([...got.names], [['cPipe', 'Pipewrench']]);
  });
  test('a cast a refund handed back names the play that handed it back, and the setter is named', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', handedBack: { by: 'set1', card: 'kick' } } })]]);
    const got = await readTrapActs(api(calls), [row('k')], held);
    assert.deepEqual(calls, [['set1']]);
    assert.deepEqual([...got.names], [['cPipe', 'Pipewrench']]);
  });
  test('a cast that rode and was then refunded by a sign names the ride\'s set, never the sign', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', rode: 'set1', handedBack: { by: 'sign1', card: 'kick' } } })]]);
    await readTrapActs(api(calls), [row('k')], held);
    assert.deepEqual(calls, [['set1']]);
  });
  test('a cast a lockout back let land names its spring (`lockedOut`); the spring names the set, and the setter is named', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', lockedOut: 'sp' } })]]);
    const got = await readTrapActs(api(calls), [row('k')], held);
    assert.deepEqual(calls, [['sp'], ['set1']]);
    assert.deepEqual([...got.names], [['cPipe', 'Pipewrench']]);
  });
  test('a lockout an admin ended: the card_end on its spring is read by the spring id, once, for the caster\'s and the setter\'s alerts', async () => {
    const calls: string[][] = [];
    const lock = act('lk', { kind: 'spring', character: 'cPipe', targetActId: 'post1', payload: { did: 'lockedOut', locks: 'cX', until: '2026-11-03T09:41:00.000Z' } });
    const end = act('en', { kind: 'card_end', character: 'cAdmin', targetActId: 'lk' });
    const other = act('en2', { kind: 'card_end', targetActId: 'elsewhere' });
    const spy: unknown = { ...(api([]) as object), cardEnds: async (ids: readonly string[]) => { calls.push([...ids]); return [end, other]; } };
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', lockedOut: 'lk' } })], ['lk', lock]]);
    const got = await readTrapActs(spy as never, [row('k'), row('lk', 'trapSprang')], held);
    assert.deepEqual(calls, [['lk']]);
    assert.deepEqual([...got.acts.keys()], ['en']);
  });
  test('a failed character read keeps the Acts already read', async () => {
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', spring: 'sp' } })]]);
    const noFaces = { actsById: async (ids: readonly string[]) => ids.flatMap((i) => world.get(i) ?? []), characters: async () => { throw new Error('down'); } } as never;
    const got = await readTrapActs(noFaces, [row('k')], held);
    assert.deepEqual([...got.acts.keys()].sort(), ['set1', 'sp']);
    assert.deepEqual([...got.names], []);
  });
  test('other alerts read nothing, and a failed read leaves the plain words', async () => {
    const calls: string[][] = [];
    assert.deepEqual([...(await readTrapActs(api(calls), [row('k', 'quote')], new Map())).acts], []);
    assert.deepEqual(calls, []);
    const failing = { actsById: async () => { throw new Error('down'); }, characters: async () => [] } as never;
    const held = new Map([['k', act('k', { kind: 'card', payload: { spring: 'sp' } })]]);
    assert.deepEqual([...(await readTrapActs(failing, [row('k')], held)).acts], []);
  });
});
