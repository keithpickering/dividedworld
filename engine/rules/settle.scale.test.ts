/**
 * The settlement at a busy instance's scale ("Weigh a design at the scale of a busy
 * instance"): one window with many players, characters, Acts and reactions, timed. The bound
 * is loose on purpose, many times the measured time, so it fails on a cost that grows with
 * the product of two lists (each card scanning every vote, each spin every Act), not on a
 * slow machine. It asserts a wall-clock bound, so test:engine runs alone in the build
 * (tools/build.mjs, SERIAL).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle } from './settle.ts';
import type { ClassRules, Instance, InputAct, InputReaction, SettlementInput } from './types.ts';

const counting: ClassRules = {
  key: 'counting',
  name: 'Counting',
  earn: (i) => [
    ...i.received.map((r) => ({ reason: 'busy.received', amount: r.votes, act: r.act, quadrant: r.quadrant })),
    ...i.given.map((g) => ({ reason: 'busy.given', amount: g.rank <= 3 ? 1 : 0, act: g.act })),
    ...i.cardsPlayed.map((c) => ({ reason: 'busy.card', amount: c.votes - c.targetVotes, act: c.act })),
    ...i.threadsSpun.map((t) => ({ reason: 'busy.spun', amount: t.repliersNow - t.repliersBefore, act: t.act })),
  ],
};
const kinds = ['fire', 'tomato', 'tea', 'zzz'] as const;
const instance: Instance = {
  key: 'busy', name: 'Busy', classes: [counting], boards: [{ slug: 'b', name: 'B', description: '' }],
  copy: { turnsThreadTitle: 'S{season} Turns', revealTitle: 'S{season} Reveal', revealBody: 'All.' },
  cards: [{ key: 'splat', name: 'Splat', alignment: 'salty', priceKey: 'splat.price', playPrice: () => 0, canApply: () => ({ ok: true, value: undefined }), validateConfig: (c) => ({ ok: true, value: c }) }],
  reactions: [
    { key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' }, { key: 'tomato', emoji: '🍅', quadrant: 'excitedNegative' },
    { key: 'tea', emoji: '☕', quadrant: 'calmPositive' }, { key: 'zzz', emoji: '💤', quadrant: 'boredNegative' },
  ],
  settings: {
    walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 6, settlementCron: '17 8 * * *',
    settlementLength: { unit: 'day', count: 1 }, seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite', postMaxLength: 20000, titleMaxLength: 120, economy: { 'splat.price': 100 },
  },
};

/** A deterministic pseudo-random sequence, so the window is the same every run. */
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }

function busyWindow(players: number, actsCount: number, reactionsCount: number): SettlementInput {
  const next = rng(7);
  const characters = Array.from({ length: players * 6 }, (_, i) => ({ id: `c${i}`, player: `p${Math.floor(i / 6)}`, classes: [{ class: 'counting', from: 0 }] }));
  const acts: InputAct[] = [];
  for (let i = 0; i < actsCount; i++) {
    const character = `c${Math.floor(next() * characters.length)}`;
    const at = 1_000 + i;
    const roll = next();
    if (roll < 0.05 && i > 0) acts.push({ id: `a${i}`, character, kind: 'card', at, thread: `t${i % 200}`, target: `a${Math.floor(next() * i)}`, card: 'splat' });
    else if (roll < 0.08) acts.push({ id: `a${i}`, character, kind: 'spin', at, thread: `s${i}`, ...(i > 0 ? { target: `a${Math.floor(next() * i)}` } : {}) });
    else acts.push({ id: `a${i}`, character, kind: 'post', at, thread: next() < 0.3 ? `s${Math.floor(next() * i)}` : `t${i % 200}` });
  }
  const reactions: InputReaction[] = [];
  for (let i = 0; i < reactionsCount; i++) {
    const p = Math.floor(next() * players);
    reactions.push({ act: `a${Math.floor(next() * actsCount)}`, player: `p${p}`, character: `c${p * 6 + Math.floor(next() * 6)}`, kind: kinds[Math.floor(next() * 4)]!, at: 1_000 + actsCount + i });
  }
  return { window: { id: 'busy', from: 0, to: 10_000_000 }, characters, acts, reactions };
}

test('one window with 500 players, 3,000 characters, 20,000 Acts and 100,000 reactions settles in seconds', () => {
  const input = busyWindow(500, 20_000, 100_000);
  const start = performance.now();
  const r = settle(input, instance);
  const ms = performance.now() - start;
  console.log(`  settled ${input.reactions.length} reactions on ${input.acts.length} Acts into ${r.entries.length} entries in ${Math.round(ms)} ms`);
  assert.ok(r.entries.length > 1000);
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  assert.equal(sum(r.standings.map((x) => x.amount)), sum(r.entries.map((e) => e.amount)), 'the standings are the entries');
  for (const e of r.entries.slice(0, 500)) {
    assert.equal(sum(r.details.filter((d) => d.character === e.character && d.reason === e.reason).map((d) => d.amount)), e.amount, 'the log adds up');
  }
  assert.ok(ms < 15_000, `took ${Math.round(ms)} ms`);
});
