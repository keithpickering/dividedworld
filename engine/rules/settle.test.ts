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
  assert.equal(love.reduce((s, d) => s + d.amount, 0), amountOf(settled, 'ann-fan', 'fan.love'));
});

test('a reaction\'s share counts its player\'s earlier reactions on the Act, and the window pays only its own', () => {
  const b = base();
  const later: SettlementInput = { ...b, reactions: [...b.reactions, react('q1', 'dee', 'dee-1', 'zzz', FROM - 1), react('p2', 'dee', 'dee-1', 'zzz', FROM - 1), react('p2', 'dee', 'dee-1', 'fire', FROM + 7 * H)] };
  // Dee's zzz on p2 came in an earlier window and is not paid here; her fire here is half her vote.
  assert.equal(amountOf(settle(later, instance), 'ann-fan', 'fan.love'), 25);
  assert.equal(amountOf(settle(later, instance), 'ann-fan', 'fan.groan'), -5);
});

test('the log\'s lines are whole hundredths that add up to their entry exactly', () => {
  const b = base();
  // Three players each split a vote three ways on p1: love comes in thirds of a vote, which do not round evenly.
  const thirds: SettlementInput = {
    ...b,
    acts: [...b.acts, post('p3', 'ann-fan', FROM + 3 * H), post('p4', 'ann-fan', FROM + 3 * H + 1)],
    reactions: ['p1', 'p3', 'p4'].flatMap((act) => ['fire', 'tea', 'tomato'].map((kind) => react(act, 'dee', 'dee-1', kind, FROM + 8 * H))),
  };
  const r = settle(thirds, instance);
  for (const e of r.entries) {
    const lines = r.details.filter((d) => d.character === e.character && d.reason === e.reason);
    assert.ok(lines.every((d) => Number.isInteger(d.amount)), 'whole hundredths');
    assert.equal(lines.reduce((s, d) => s + d.amount, 0), e.amount, `${e.character} ${e.reason}`);
  }
  assert.ok(r.details.filter((d) => d.reason === 'fan.love').length === 3);
});

test('a hostile reaction settled against an empty wallet leaves it at zero, and the standing goes negative', () => {
  const b = base();
  const groan: SettlementInput = { ...b, reactions: [react('p1', 'bob', 'bob-1', 'zzz', FROM + 4 * H)] };
  const r = settle(groan, instance);
  const ann = r.entries.filter((e) => e.player === 'ann');
  assert.deepEqual(ann.map((e) => e.amount), [-10]);
  assert.equal(applyCap(0, ann, 600).balance, 0);
  assert.equal(r.standings.find((s) => s.character === 'ann-fan')?.amount, -10);
});

test('cards and spun threads reach a class as the plan reads them', () => {
  seen.length = 0;
  const b = base();
  const input: SettlementInput = {
    ...b,
    acts: [
      ...b.acts,
      // Bob splats Ann's p1, and his own q1, which lands on nobody else.
      { id: 'k1', character: 'bob-1', kind: 'card', at: FROM + 4 * H + 10, thread: 't1', target: 'p1', card: 'splat' },
      { id: 'k2', character: 'bob-1', kind: 'card', at: FROM + 4 * H + 20, thread: 't1', target: 'q1', card: 'splat' },
      // Cat spins a thread from Ann's p2 before the window; Bob replied before it, Dee and Ann reply in it.
      { id: 's1', character: 'cat-1', kind: 'spin', at: FROM - 3 * H, thread: 'spun', target: 'p2' },
      post('r1', 'bob-1', FROM - 2 * H, 'spun'),
      post('r2', 'dee-1', FROM + 9 * H, 'spun'),
      post('r3', 'ann-quiet', FROM + 10 * H, 'spun'),
      post('r4', 'cat-1', FROM + 11 * H, 'spun'),
    ],
    reactions: [
      ...b.reactions,
      react('k1', 'cat', 'cat-1', 'fire', FROM + 12 * H),
      react('k1', 'dee', 'dee-1', 'fire', FROM + 12 * H),
      // On the target after the card: Dee's heart, and Bob's own, which never counts toward his card.
      react('p1', 'dee', 'dee-1', 'heart', FROM + 13 * H),
      react('p1', 'bob', 'bob-1', 'heart', FROM + 13 * H),
    ],
  };
  settle(input, instance);
  const bob = seen.filter((s) => s.character === 'bob-1').flatMap((s) => s.cardsPlayed);
  assert.equal(bob.length, 2);
  const k1 = bob.find((c) => c.act === 'k1')!;
  assert.equal(k1.alignment, 'salty');
  assert.equal(k1.onOthers, true);
  assert.equal(k1.votes, 2, 'Cat and Dee on the card');
  assert.equal(k1.targetVotes, 3, 'Bob, Cat and Dee on p1 in the window');
  assert.deepEqual(k1.targetAfter, { excitedPositive: 1.5, excitedNegative: 0, calmPositive: 0, boredNegative: 0.5 },
    'after the card: Cat\'s split vote and Dee\'s heart; Bob\'s fire came before it and his heart is his own');
  const k2 = bob.find((c) => c.act === 'k2')!;
  assert.equal(k2.onOthers, false, 'a card on the player\'s own post lands on nobody else');
  const landedOnBob = seen.filter((s) => s.character === 'bob-1').flatMap((s) => s.cardsLanded);
  assert.deepEqual(landedOnBob, [], 'a player\'s own card never lands on them');
  seen.length = 0;
  settle({ ...input, characters: input.characters.map((c) => (c.id === 'ann-fan' ? { ...c, classes: [{ class: 'quiet', from: 0 }] } : c)) }, instance);
  const landedOnAnn = seen.filter((s) => s.character === 'ann-fan').flatMap((s) => s.cardsLanded);
  assert.deepEqual(landedOnAnn, [{ act: 'k1', card: 'splat', alignment: 'salty', at: FROM + 4 * H + 10, on: 'p1' }]);
  seen.length = 0;
  settle(input, instance);
  const spunByCat = seen.filter((s) => s.character === 'cat-1').flatMap((s) => s.threadsSpun);
  assert.equal(spunByCat.length, 1);
  assert.deepEqual({ ...spunByCat[0], at: undefined }, { act: 's1', thread: 'spun', at: undefined, fromOthers: true, repliersBefore: 1, repliersNow: 3 },
    'Bob before; Dee and Ann in the window; Cat\'s own reply is not counted');
  assert.equal(spunByCat[0]!.at, FROM + 10 * H, 'placed when its count reached its total');
});

/* ---- the edges: each case below is a boundary a one-character change would move ---- */

const recorder = (): { rules: ClassRules; inputs: ClassInput[] } => {
  const inputs: ClassInput[] = [];
  return { inputs, rules: { key: 'quiet', name: 'Quiet', earn: (i) => { inputs.push(i); return i.posts.map((p) => ({ reason: 'quiet.post', amount: 7, act: p.act })); } } };
};
const withClasses = (...extra: ClassRules[]): Instance => ({ ...instance, classes: [...instance.classes.filter((c) => !extra.some((e) => e.key === c.key)), ...extra] });

test('a reaction at exactly the window\'s start is paid, and an Act at exactly its end is not read', () => {
  const b = base();
  const edge: SettlementInput = { ...b, acts: [...b.acts, post('end', 'bob-1', TO)], reactions: [...b.reactions, react('p1', 'dee', 'dee-1', 'fire', FROM)] };
  const r = settle(edge, instance);
  assert.equal(amountOf(r, 'ann-fan', 'fan.love'), 30, 'Dee\'s fire at the start is a whole vote');
  assert.equal(amountOf(r, 'bob-1', 'quiet.post'), 7, 'Bob\'s post at the end is the next window\'s');
});

test('a Turn at the window\'s start covers the whole window; one at its end covers none of it; a reaction at the Turn\'s instant is the new class\'s', () => {
  const b = base();
  const at = (from: number) => ({ ...b, characters: b.characters.map((c) => (c.id === 'ann-fan' ? { ...c, classes: [{ class: 'fan', from: 0 }, { class: 'quiet', from }] } : c)) });
  assert.equal(amountOf(settle(at(FROM), instance), 'ann-fan', 'fan.love'), 0);
  assert.equal(amountOf(settle(at(TO), instance), 'ann-fan', 'fan.love'), 20);
  assert.equal(amountOf(settle(at(FROM + 4 * H), instance), 'ann-fan', 'fan.love'), 0, 'Bob\'s fire lands at the Turn\'s instant, under the new class');
});

test('a character whose first class starts inside the window is settled from then', () => {
  const b = base();
  const late = { ...b, characters: b.characters.map((c) => (c.id === 'ann-fan' ? { ...c, classes: [{ class: 'fan', from: FROM + 5 * H }] } : c)) };
  assert.equal(amountOf(settle(late, instance), 'ann-fan', 'fan.love'), 10, 'only Cat\'s half and Bob\'s heart, after it existed');
});

test('two classes from the same instant are refused, rather than settled by whichever came first', () => {
  const b = base();
  const twice = { ...b, characters: b.characters.map((c) => (c.id === 'ann-fan' ? { ...c, classes: [{ class: 'fan', from: 0 }, { class: 'quiet', from: 0 }] } : c)) };
  assert.throws(() => settle(twice, instance), /two classes from the same instant/);
});

test('rounding is half away from zero, in both directions', () => {
  const halves: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'up', amount: 2.5 }, { reason: 'down', amount: -2.5 }] : []) };
  const r = settle(base(), withClasses(halves));
  assert.equal(amountOf(r, 'ann-fan', 'up'), 3);
  assert.equal(amountOf(r, 'ann-fan', 'down'), -3);
});

test('a class that returns a number that is not one is refused, and a zero is no entry', () => {
  const broken: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'x', amount: Number.NaN }] : []) };
  assert.throws(() => settle(base(), withClasses(broken)), /returned NaN/);
  const zero: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'nothing', amount: 0, act: 'p1' }] : []) };
  const r = settle(base(), withClasses(zero));
  assert.ok(!r.entries.some((e) => e.reason === 'nothing') && !r.details.some((d) => d.reason === 'nothing'));
});

test('a reacting player\'s rank and where a post ends up reach the class, with ties settled the same way every time', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const tie: SettlementInput = {
    ...b,
    acts: [...b.acts, post('t1p', 'ann-quiet', FROM + H)],
    reactions: [
      ...b.reactions,
      // Dee and Cat react at the same instant: Cat, the lower id, comes first. Their votes tie, so t1p has no direction.
      react('t1p', 'dee', 'dee-1', 'zzz', FROM + 2 * H),
      react('t1p', 'cat', 'cat-1', 'fire', FROM + 2 * H),
    ],
  };
  settle(tie, withClasses(rules));
  const given = inputs.flatMap((i) => i.given.map((g) => ({ ...g, by: i.character })));
  assert.deepEqual(given.filter((g) => g.act === 't1p').map((g) => [g.by, g.rank, g.endsUp]).sort(), [['cat-1', 1, null], ['dee-1', 2, null]]);
  // p1: Bob first (rank 1), Cat second; Bob's whole fire and Cat's half fire outweigh Cat's half zzz.
  assert.deepEqual(given.filter((g) => g.act === 'p1').map((g) => [g.by, g.rank, g.endsUp]).sort(),
    [['bob-1', 1, 'excitedPositive'], ['cat-1', 2, 'excitedPositive'], ['cat-1', 2, 'excitedPositive']]);
});

test('a reaction at the very instant a card is played is not "after" it; a reply at the window\'s start is in the window', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const input: SettlementInput = {
    ...b,
    acts: [
      ...b.acts,
      { id: 'k1', character: 'bob-1', kind: 'card', at: FROM + 5 * H, thread: 't1', target: 'p1', card: 'splat' },
      { id: 's1', character: 'cat-1', kind: 'spin', at: FROM - 3 * H, thread: 'spun', target: 'q1' },
      { id: 's2', character: 'cat-1', kind: 'spin', at: FROM - 3 * H, thread: 'spun2', target: 'q1' },
      post('r1', 'dee-1', FROM, 'spun'),
      post('r2', 'cat-1', FROM + H, 'spun2'),
      { id: 's3', character: 'dee-1', kind: 'spin', at: FROM + H, thread: 'spun3', target: 'q1' },
    ],
  };
  settle(input, withClasses(rules));
  const k1 = inputs.flatMap((i) => i.cardsPlayed).find((c) => c.act === 'k1')!;
  assert.equal(k1.targetAfter.excitedPositive, 0, 'Cat\'s fire on p1 lands at the card\'s instant');
  const spun = inputs.flatMap((i) => i.threadsSpun);
  assert.deepEqual(spun.find((t) => t.act === 's1') && { b: spun.find((t) => t.act === 's1')!.repliersBefore, n: spun.find((t) => t.act === 's1')!.repliersNow }, { b: 0, n: 1 });
  assert.equal(spun.find((t) => t.act === 's1')!.fromOthers, true);
  assert.equal(spun.some((t) => t.act === 's2'), false, 'spun before the window and nothing new: not given');
  assert.deepEqual(spun.find((t) => t.act === 's3') && [spun.find((t) => t.act === 's3')!.repliersNow, spun.find((t) => t.act === 's3')!.fromOthers], [0, true], 'spun in the window: given, with none yet');
  const own = settle({ ...input, acts: [...input.acts, { id: 's4', character: 'bob-1', kind: 'spin', at: FROM + H, thread: 'spun4', target: 'q1' }] }, withClasses(rules));
  void own;
  assert.equal(inputs.flatMap((i) => i.threadsSpun).find((t) => t.act === 's4')?.fromOthers, false, 'spun from its own player\'s Act');
});

test('a card whose target is not in the input is refused, and a card retired from the instance only matters inside the window', () => {
  const b = base();
  assert.throws(() => settle({ ...b, acts: [...b.acts, { id: 'k9', character: 'bob-1', kind: 'card', at: FROM + H, thread: 't1', target: 'gone', card: 'splat' }] }, instance), /Act gone is not in the input/);
  const old = { ...b, acts: [...b.acts, { id: 'k0', character: 'bob-1', kind: 'card' as const, at: FROM - H, thread: 't1', target: 'p1', card: 'retired' }] };
  assert.doesNotThrow(() => settle(old, instance));
  assert.throws(() => settle({ ...b, acts: [...b.acts, { id: 'k8', character: 'bob-1', kind: 'card', at: FROM + H, thread: 't1', target: 'p1', card: 'retired' }] }, instance), /"retired"/);
});

test('the log\'s rounding is shared the same way every time, and a line that rounds to nothing is not shown', () => {
  const thirds: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'x', amount: 1 / 3, act: 'b' }, { reason: 'x', amount: 1 / 3, act: 'a' }, { reason: 'x', amount: 1 / 3, act: 'c' }] : []) };
  const r = settle(base(), withClasses(thirds));
  assert.equal(amountOf(r, 'ann-fan', 'x'), 1);
  assert.deepEqual(r.details.filter((d) => d.reason === 'x').map((d) => [d.act, d.amount]), [['a', 1]], 'the tie goes to the first key; the others round to nothing and are not shown');
});

test('a reply at exactly the window\'s end is the next window\'s, and only posts are posts', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const input: SettlementInput = {
    ...b,
    acts: [
      ...b.acts,
      { id: 's1', character: 'cat-1', kind: 'spin', at: FROM + H, thread: 'spun', target: 'q1' },
      post('r1', 'dee-1', FROM + 2 * H, 'spun'),
      post('r2', 'ann-quiet', TO, 'spun'),
      { id: 'k1', character: 'bob-1', kind: 'card', at: FROM + 5 * H, thread: 't1', target: 'p1', card: 'splat' },
    ],
  };
  settle(input, withClasses(rules));
  assert.equal(inputs.flatMap((i) => i.threadsSpun).find((t) => t.act === 's1')?.repliersNow, 1);
  const bobPosts = inputs.filter((i) => i.character === 'bob-1').flatMap((i) => i.posts.map((p) => p.act));
  const catPosts = inputs.filter((i) => i.character === 'cat-1').flatMap((i) => i.posts.map((p) => p.act));
  assert.deepEqual(bobPosts, ['q1'], 'a card is not a post');
  assert.deepEqual(catPosts, [], 'a spin is not a post');
});

test('what each class earned is rounded like an entry', () => {
  const thirds: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'x', amount: 1 / 3 }, { reason: 'y', amount: 1 / 3 }] : []) };
  assert.equal(settle(base(), withClasses(thirds)).byClass.fan, 1);
});
