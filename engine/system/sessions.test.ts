import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Persona, PoolSettings } from '../rules/types.ts';
import { sessionRng } from './pool.ts';
import { drawSessions } from './sessions.ts';

const pool = (over: Partial<PoolSettings['sessions']> = {}): PoolSettings =>
  ({ sessions: { perDay: 3, minutes: { least: 20, most: 70 }, waking: { from: 8, to: 22 }, ...over } }) as unknown as PoolSettings;
const persona = (habits?: Persona['habits']): Persona => ({ key: 'p1', habits }) as unknown as Persona;
const draw = (p: Persona, day: string, s: PoolSettings) => drawSessions(p, day, s, sessionRng(day, p.key));
const dayN = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);

test('the same day and persona draw the same; another day draws differently', () => {
  const a = draw(persona(), '2026-11-22', pool());
  assert.equal(a.length, 3);
  assert.deepEqual(draw(persona(), '2026-11-22', pool()), a);
  assert.notDeepEqual(draw(persona(), '2026-11-23', pool()), a);
});

test('no overlap, lengths whole rounds, on the grid, inside the hours, over 1,000 days', () => {
  for (let i = 0; i < 1000; i++) {
    const s = draw(persona(), dayN(i), pool());
    assert.ok(s.length >= 1);
    s.forEach((x, j) => {
      assert.equal(x.start % 15, 0);
      assert.equal((x.end - x.start) % 15 === 0 || x.end === 1440, true);
      assert.ok(x.end - x.start >= 15);
      assert.ok(x.start >= 8 * 60 && x.start < 22 * 60);
      assert.ok(x.end <= 1440);
      if (j > 0) assert.ok(s[j - 1]!.end <= x.start, `overlap on ${dayN(i)}`);
    });
  }
});

test('a waking span wrapping past midnight', () => {
  const p = pool({ waking: { from: 22, to: 4 }, perDay: 4 });
  for (let i = 0; i < 200; i++) {
    for (const x of draw(persona(), dayN(i), p)) {
      const h = Math.floor(x.start / 60);
      assert.ok(h >= 22 || h < 4, `start hour ${h}`);
      assert.ok(x.end <= 1440);
    }
  }
});

test('perDay 0 draws none', () => {
  assert.deepEqual(draw(persona(), '2026-11-22', pool({ perDay: 0 })), []);
  assert.deepEqual(draw(persona({ perDay: 0 }), '2026-11-22', pool()), []);
});

test("a persona's hours override the waking span, and a short window draws fewer", () => {
  const p = persona({ hours: [3], perDay: 5, minutes: { least: 30, most: 30 } });
  for (let i = 0; i < 50; i++) {
    const s = draw(p, dayN(i), pool());
    assert.ok(s.length >= 1 && s.length <= 2, `drew ${s.length}`);
    for (const x of s) assert.ok(x.start >= 180 && x.start < 240);
  }
});

test('a session drawn to cross midnight is cut at 24:00', () => {
  const s = draw(persona({ hours: [23], perDay: 1, minutes: { least: 180, most: 180 } }), '2026-11-22', pool());
  assert.equal(s.length, 1);
  assert.equal(s[0]!.end, 1440);
});

test('a length is rounded up to whole rounds: 20 minutes is a 30-minute session', () => {
  const p = persona({ perDay: 1, minutes: { least: 20, most: 20 } });
  for (let i = 0; i < 50; i++) {
    for (const x of draw(p, dayN(i), pool())) assert.equal(x.end - x.start, 30);
  }
});
