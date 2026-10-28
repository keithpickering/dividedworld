import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCap, previewForOwner, settle } from './settle.ts';
import type { ClassInput, ClassRules, Earning, Instance, InputAct, InputReaction, SettlementInput } from './types.ts';

/* Two fake classes. "fan" earns a vote per whole excited-positive vote and loses one per bored-negative
   vote; "quiet" earns a flat 7 per post and records every input it is given. */
const seen: ClassInput[] = [];
const fan: ClassRules = {
  key: 'fan',
  name: 'Fan',
  earn: (input, settings) =>
    input.received.flatMap((r): Earning[] =>
      r.quadrant === 'excitedPositive' ? [{ reason: 'fan.love', amount: settings.vote * r.votes, act: r.act, quadrant: r.quadrant }]
      : r.quadrant === 'boredNegative' ? [{ reason: 'fan.groan', amount: -settings.vote * r.votes, act: r.act, quadrant: r.quadrant }]
      : []),
};
const quiet: ClassRules = {
  key: 'quiet',
  name: 'Quiet',
  earn: (input) => { seen.push(input); return input.posts.map((p) => ({ reason: 'quiet.post', amount: 7, act: p.act })); },
};

const instance: Instance = {
  key: 'test-world',
  name: 'Test World',
  classes: [fan, quiet],
  cards: [{ key: 'splat', name: 'Splat', alignment: 'salty', basePrice: 100, playPrice: () => 0, canApply: () => ({ ok: true, value: undefined }), validateConfig: (c) => ({ ok: true, value: c }) }],
  reactions: [
    { key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' },
    { key: 'heart', emoji: '❤️', quadrant: 'excitedPositive' },
    { key: 'zzz', emoji: '💤', quadrant: 'boredNegative' },
    { key: 'tea', emoji: '☕', quadrant: 'calmPositive' },
    { key: 'tomato', emoji: '🍅', quadrant: 'excitedNegative' },
  ],
  settings: {
    walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 6, settlementCron: '17 8 * * *',
    seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  },
  boards: [{ slug: 'general', name: 'General', description: '' }],
};

const H = 3_600_000;
const FROM = 100 * H;
const TO = 124 * H;
const post = (id: string, character: string, at: number, thread = 't1'): InputAct => ({ id, character, kind: 'post', at, thread });
const react = (act: string, player: string, character: string, kind: string, at: number): InputReaction => ({ act, player, character, kind, at });

/** Ann plays a Fan (ann-fan) and a Quiet (ann-quiet); Bob, Cat and Dee each play one Quiet. */
function base(): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'ann-fan', player: 'ann', classes: [{ class: 'fan', from: 0 }] },
      { id: 'ann-quiet', player: 'ann', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'cat-1', player: 'cat', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'dee-1', player: 'dee', classes: [{ class: 'quiet', from: 0 }] },
    ],
    acts: [post('p1', 'ann-fan', FROM + 1 * H), post('p2', 'ann-fan', FROM + 2 * H), post('q1', 'bob-1', FROM + 3 * H)],
    reactions: [
      react('p1', 'bob', 'bob-1', 'fire', FROM + 4 * H),
      react('p1', 'cat', 'cat-1', 'fire', FROM + 5 * H),
      react('p1', 'cat', 'cat-1', 'zzz', FROM + 5 * H + 1),
      react('p2', 'bob', 'bob-1', 'heart', FROM + 6 * H),
    ],
  };
}
const amountOf = (r: ReturnType<typeof settle>, character: string, reason: string) =>
  r.entries.filter((e) => e.character === character && e.reason === reason).reduce((s, e) => s + e.amount, 0);

test('a window settles into entries per player and character, each with a reason', () => {
  const r = settle(base(), instance);
  // p1: Bob's whole vote of love (10), Cat's half of love (5) and half a groan (-5); p2: Bob's second Act, halved (5).
  assert.equal(amountOf(r, 'ann-fan', 'fan.love'), 20);
  assert.equal(amountOf(r, 'ann-fan', 'fan.groan'), -5);
  assert.equal(amountOf(r, 'bob-1', 'quiet.post'), 7);
  for (const e of r.entries) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(Number.isInteger(e.amount), 'entries are whole hundredths');
    assert.equal(e.window, 'w1');
  }
  assert.ok(r.entries.every((e) => e.player === (e.character.split('-')[0])));
});

test('entries are the same for the same inputs in any order', () => {
  const one = settle(base(), instance);
  const b = base();
  const shuffled: SettlementInput = { ...b, characters: [...b.characters].reverse(), acts: [...b.acts].reverse(), reactions: [b.reactions[2]!, b.reactions[0]!, b.reactions[3]!, b.reactions[1]!] };
  const two = settle(shuffled, instance);
  assert.deepEqual(two, one);
});

test('a reaction from the target\'s own player is never counted, even if one reached the function', () => {
  const b = base();
  const withSelf: SettlementInput = { ...b, reactions: [...b.reactions, react('p1', 'ann', 'ann-quiet', 'fire', FROM + 7 * H), react('q1', 'bob', 'bob-1', 'fire', FROM + 7 * H)] };
  assert.deepEqual(settle(withSelf, instance).entries, settle(base(), instance).entries);
});

test('a class is given only Acts and votes, never who reacted', () => {
  seen.length = 0;
  settle(base(), instance);
  const text = JSON.stringify(seen);
  for (const id of ['ann', 'bob', 'cat', 'dee']) assert.ok(!text.includes(`"${id}"`), `${id} reached a class`);
  for (const id of ['bob-1', 'cat-1']) {
    const given = seen.filter((s) => s.character === id).flatMap((s) => s.given);
    assert.ok(given.length > 0, `${id}'s own reactions reach its own class as reactions it gave`);
  }
  const received = seen.flatMap((s) => s.received);
  assert.ok(received.every((r) => !('player' in r) && !('character' in r)));
});

test('nothing at or after the window\'s end is read, and nothing before it is paid', () => {
  const b = base();
  const later: SettlementInput = {
    ...b,
    acts: [...b.acts, post('late', 'ann-fan', TO), post('early', 'ann-fan', FROM - H)],
    reactions: [
      ...b.reactions,
      react('p1', 'dee', 'dee-1', 'fire', TO),
      // At the end: read, it would split Bob's one vote on p1 in two.
      react('p1', 'bob', 'bob-1', 'zzz', TO),
      react('early', 'dee', 'dee-1', 'fire', FROM - 1),
      // Before the start: counted as a vote, it would make p1 Bob's second Act by ann-fan, and halve it.
      react('early', 'bob', 'bob-1', 'fire', FROM - 1),
    ],
  };
  assert.deepEqual(settle(later, instance).entries, settle(base(), instance).entries);
});

test('a character that Turned inside the window is settled under each class for its own stretch', () => {
  seen.length = 0;
  const b = base();
  const turned: SettlementInput = {
    ...b,
    characters: b.characters.map((c) => (c.id === 'ann-fan' ? { ...c, classes: [{ class: 'fan', from: 0 }, { class: 'quiet', from: FROM + 5 * H + 30 }] } : c)),
  };
  const r = settle(turned, instance);
  // Bob's fire and Cat's fire land while ann-fan is a Fan; Cat's zzz lands a moment later, still before the Turn.
  // Bob's heart on p2 lands after the Turn, when ann-fan is Quiet and earns nothing for it.
  assert.equal(amountOf(r, 'ann-fan', 'fan.love'), 15);
  assert.equal(amountOf(r, 'ann-fan', 'fan.groan'), -5);
  const stretches = seen.filter((s) => s.character === 'ann-fan');
  assert.equal(stretches.length, 1, 'the Quiet stretch is one input');
  assert.equal(stretches[0]?.from, FROM + 5 * H + 30);
  assert.equal(stretches[0]?.to, TO);
  assert.deepEqual(r.byClass, { fan: 10, quiet: 7 });
});

test('each settlement records what each class earned', () => {
  const r = settle(base(), instance);
  assert.deepEqual(r.byClass, { fan: 15, quiet: 7 });
});

test('a reaction the instance does not have is refused, not guessed at', () => {
  const b = base();
  assert.throws(() => settle({ ...b, reactions: [...b.reactions, react('p1', 'dee', 'dee-1', 'shrug', FROM + H)] }, instance), /reaction kind "shrug"/);
});

test('a class the instance does not have is refused', () => {
  const b = base();
  assert.throws(() => settle({ ...b, characters: [...b.characters, { id: 'eve-1', player: 'eve', classes: [{ class: 'ghost', from: 0 }] }] }, instance), /class "ghost"/);
});

test('a hostile reaction never takes the wallet below zero', () => {
  const w = applyCap(5, [{ amount: -10 }], 600);
  assert.equal(w.balance, 0);
  assert.equal(w.floored, 5);
  assert.equal(w.overflow, 0);
});

test('Aura past the cap leaves the wallet and stays in the standing', () => {
  const b = base();
  const r = settle(b, instance);
  const ann = r.entries.filter((e) => e.player === 'ann');
  const w = applyCap(590, ann, 600);
  assert.equal(w.balance, 600);
  assert.equal(w.overflow, 5, '590 + 15 is 605; 5 overflowed');
  assert.equal(r.standings.find((s) => s.character === 'ann-fan')?.amount, 15, 'the standing keeps all 15');
});

test('a wallet inside its bounds moves by the sum of the entries', () => {
  assert.deepEqual(applyCap(100, [{ amount: 30 }, { amount: -20 }], 600), { balance: 110, change: 10, overflow: 0, floored: 0 });
});

test('the owner\'s live preview is the settlement so far, for their own characters only', () => {
  const b = base();
  const open: SettlementInput = { ...b, window: { id: 'open', from: FROM, to: FROM + 5 * H + 2 } };
  const preview = previewForOwner(open, instance, 'ann');
  const settled = settle(open, instance);
  assert.deepEqual(preview.entries, settled.entries.filter((e) => e.player === 'ann'));
  assert.ok(preview.entries.length > 0);
  assert.ok(preview.details.every((d) => d.character.startsWith('ann-')));
  assert.ok(!JSON.stringify(preview).includes('"bob"') && !JSON.stringify(preview).includes('"cat"'), 'no other player reaches the preview');
  // Its details say which Act, which quadrant and how much, and add up to the entries.
  const love = preview.details.filter((d) => d.reason === 'fan.love');
  assert.ok(love.every((d) => d.act === 'p1' && d.quadrant === 'excitedPositive'));
  assert.equal(Math.round(love.reduce((s, d) => s + d.amount, 0)), amountOf(settled, 'ann-fan', 'fan.love'));
});
