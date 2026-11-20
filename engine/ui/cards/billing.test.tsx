/**
 * Billing: the order of a post's tags. The play that has drawn the most (its public reaction count plus
 * the threads spun from it) is billed first, ties going to the newest, then to the id, so the order is
 * total and two readers with the same counts see the same order. `billPost` reads the plays store, so this is a vitest file, where the store's imports load.
 */
import { expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { billing, billPost, drawnOf } from './billing.ts';
import { createPlays } from './plays.ts';
import type { CardPlay } from './types.ts';

const play = (id: string, playedAt: string): CardPlay => ({
  id, card: 'whoops', layer: 1, caster: 'c', message: '', config: {}, playedAt, post: 'p',
});
const a = play('a', '2026-10-31T21:00:00.000Z');
const b = play('b', '2026-10-31T21:05:00.000Z');
const c = play('c', '2026-10-31T21:10:00.000Z');
const ids = (plays: readonly CardPlay[]) => plays.map((p) => p.id);

test('the most drawn play is billed first', () => {
  const drawn = new Map([['a', 2], ['b', 9], ['c', 5]]);
  expect(ids(billing([a, b, c], (id) => drawn.get(id) ?? 0))).toEqual(['b', 'c', 'a']);
});

test('a tie in draws goes to the newest play', () => {
  const drawn = new Map([['a', 4], ['b', 4], ['c', 1]]);
  expect(ids(billing([a, b, c], (id) => drawn.get(id) ?? 0))).toEqual(['b', 'a', 'c']);
});

test('a tie in draws and in time goes to the id, so the order is total', () => {
  const same = '2026-10-31T21:00:00.000Z';
  const x = play('x', same);
  const y = play('y', same);
  expect(ids(billing([y, x], () => 3))).toEqual(['x', 'y']);
  expect(ids(billing([x, y], () => 3))).toEqual(['x', 'y']);
});

test('no plays bill nothing', () => {
  expect(billing([], () => 0)).toEqual([]);
});

test('billing leaves the plays it was given in their order', () => {
  const given = [a, b, c];
  billing(given, (id) => (id === 'c' ? 1 : 0));
  expect(ids(given)).toEqual(['a', 'b', 'c']);
});

test('drawn is the sum of the tally plus the threads spun from the play; a kind at zero adds nothing', () => {
  expect(drawnOf({ heart: 3, laugh: 2 }, 1)).toBe(6);
  expect(drawnOf({ heart: 0, laugh: 2 }, 0)).toBe(2);
  expect(drawnOf({}, 0)).toBe(0);
  expect(drawnOf({}, 4)).toBe(4);
});

test('billing reads nothing but its arguments: the same counts in another insertion order give the same order', () => {
  const one = new Map([['a', 5], ['b', 5], ['c', 7]]);
  const two = new Map([['c', 7], ['b', 5], ['a', 5]]);
  const first = ids(billing([a, b, c], (id) => one.get(id) ?? 0));
  const second = ids(billing([c, a, b], (id) => two.get(id) ?? 0));
  expect(first).toEqual(['c', 'b', 'a']);
  expect(second).toEqual(first);
});

test('each play\'s draw is asked once, and a draw that is not a number counts as none', () => {
  let asked = 0;
  const order = billing([a, b, c], (id) => { asked += 1; return id === 'a' ? Number.NaN : id === 'b' ? 1 : 0; });
  expect(asked).toBe(3);
  expect(ids(order)).toEqual(['b', 'c', 'a']);
});

/* `billPost`: spent kinds go last when a page is read (docs/plans/2026-11-20-spent-marks-design.md, section 4). */
const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const HOUR = 3_600_000;
const none = new Set<string>();
const act = (id: string, card: string, minute: number, over: boolean): Act => ({
  id, character: 'c', kind: 'card', thread: 't', targetActId: 'p', seq: null, createdAt: new Date(NOW - 1000 * (100 - minute)).toISOString(),
  payload: { card, layer: minute, message: '', config: {}, ...(over ? { ends: new Date(NOW - HOUR).toISOString() } : { ends: new Date(NOW + HOUR).toISOString() }) }, currentPayload: {}, editedAt: null, shownEditedAt: null,
});
function billed(made: readonly Act[], drawn: Record<string, number>, counted?: readonly string[]) {
  const plays = createPlays();
  plays.add(made);
  const has = new Set(counted ?? made.map((m) => m.id));
  billPost(plays, 'p', { has: (id) => has.has(id) }, (id) => drawn[id] ?? 0, { now: NOW, keeps: none });
  return { plays, order: () => plays.get('p').billed.map((x) => x.id) };
}

test('a spent kind drawn most is billed after a live kind drawn least', () => {
  const r = billed([act('s1', 'spent', 1, true), act('l1', 'live', 2, false)], { s1: 9, l1: 0 });
  expect(r.order()).toEqual(['l1', 's1']);
});

test('two spent kinds keep billing order between them, and so do two live ones', () => {
  const r = billed([act('s1', 'sa', 1, true), act('s2', 'sb', 2, true), act('l1', 'la', 3, false), act('l2', 'lb', 4, false)], { s1: 1, s2: 5, l1: 2, l2: 7 });
  expect(r.order()).toEqual(['l2', 'l1', 's2', 's1']);
});

test('a kind with one live play and one over is live, judged on all its counted plays', () => {
  const r = billed([act('a1', 'mixed', 1, true), act('a2', 'mixed', 2, false), act('s1', 'spent', 3, true)], { a1: 9, a2: 0, s1: 3 });
  expect(r.order()).toEqual(['a1', 'a2', 's1']);
});

test('a play that arrives live after billing keeps its place after the spent ones', () => {
  const r = billed([act('s1', 'spent', 1, true), act('l1', 'live', 2, false)], { s1: 9 });
  r.plays.add([act('n1', 'newer', 3, false)]);
  expect(r.order()).toEqual(['l1', 's1', 'n1']);
});
