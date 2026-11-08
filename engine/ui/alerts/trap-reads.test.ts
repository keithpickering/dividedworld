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
const api = (calls: string[][]) => ({
  actsById: async (ids: readonly string[]) => { calls.push([...ids]); return ids.flatMap((i) => world.get(i) ?? []); },
  characters: async (ids: readonly string[]) => ids.map((id) => ({ id, name: id === 'cPipe' ? 'Pipewrench' : 'x' })),
}) as never;

describe('readTrapActs', () => {
  test('a card landed from a back: reads the spring, then the set, then the setter\'s name', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', spring: 'sp' } })]]);
    const got = await readTrapActs(api(calls), [row('k')], held, new Map());
    assert.deepEqual(calls, [['sp'], ['set1']]);
    assert.deepEqual([...got.acts.keys()].sort(), ['set1', 'sp']);
    assert.deepEqual([...got.names], [['cPipe', 'Pipewrench']]);
  });
  test('a cast a trap caught names the set itself; what is held is not read again', async () => {
    const calls: string[][] = [];
    const held = new Map([['k', act('k', { kind: 'card', payload: { card: 'whoops', caught: 'set1' } })]]);
    const got = await readTrapActs(api(calls), [row('k')], held, new Map([['cPipe', 'Pipewrench']]));
    assert.deepEqual(calls, [['set1']]);
    assert.deepEqual([...got.names], []);
    assert.deepEqual([...got.acts.keys()], ['set1']);
  });
  test('other alerts read nothing, and a failed read leaves the plain words', async () => {
    const calls: string[][] = [];
    assert.deepEqual([...(await readTrapActs(api(calls), [row('k', 'quote')], new Map(), new Map())).acts], []);
    assert.deepEqual(calls, []);
    const failing = { actsById: async () => { throw new Error('down'); }, characters: async () => [] } as never;
    const held = new Map([['k', act('k', { kind: 'card', payload: { spring: 'sp' } })]]);
    assert.deepEqual([...(await readTrapActs(failing, [row('k')], held, new Map())).acts], []);
  });
});
