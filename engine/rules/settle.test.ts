import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCap, estimateForOwner, settle, shareEntries, type LedgerEntry } from './settle.ts';
import type { ClassInput, ClassRules, Earning, Instance, InputAct, InputReaction, SettlementInput } from './types.ts';
import { systemSettings, testSystem, testGroups } from './test-system.ts';

/* Two fake classes. "fan" earns a vote per whole excited-positive vote and loses one per bored-negative
   vote, each naming the reaction's time; "quiet" earns a flat 7 per post and records every input it is given. */
const seen: ClassInput[] = [];
const fan: ClassRules = {
  key: 'fan',
  name: 'Fan',
  earn: (input, settings) =>
    input.received.flatMap((r): Earning[] =>
      r.quadrant === 'excitedPositive' ? [{ reason: 'fan.love', amount: settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at }]
      : r.quadrant === 'boredNegative' ? [{ reason: 'fan.groan', amount: -settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at }]
      : []),
};
const quiet: ClassRules = {
  key: 'quiet',
  name: 'Quiet',
  earn: (input) => { seen.push(input); return input.posts.map((p) => ({ reason: 'quiet.post', amount: 7, act: p.act })); },
};

const instance: Instance = {
  key: 'test-world',
  system: testSystem,
  name: 'Test World',
  classes: [fan, quiet],
  cards: [{ key: 'splat', name: 'Splat', alignment: 'salty', rarity: 'common', playPrice: () => 0, canApply: () => ({ ok: true, value: undefined }), validateConfig: (c) => ({ ok: true, value: c }) }],
  reactions: [
    { key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' },
    { key: 'heart', emoji: '❤️', quadrant: 'excitedPositive' },
    { key: 'zzz', emoji: '💤', quadrant: 'boredNegative' },
    { key: 'tea', emoji: '☕', quadrant: 'calmPositive' },
    { key: 'tomato', emoji: '🍅', quadrant: 'excitedNegative' },
  ],
  settings: {
    walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 6, settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', invitesPerPlayer: 3, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } }, hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
    settlementLength: { unit: 'day', count: 1 }, seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite', postMaxLength: 20000, titleMaxLength: 120, postsPerPage: 20, hotReplies: 10, searchLanguage: 'english', searchRankPool: 5000, cardSettings: {}, economy: { 'splat.price': 100 }, ...systemSettings,
  },
  ranks: [{ name: 'Rookie', from: 0 }], groups: testGroups, pipStyles: [{ key: 'default', name: 'Default', full: '●', empty: '○' }], boards: [{ slug: 'general', name: 'General', description: '' }],
  copy: { announcementsThreadTitle: 'S{season} Promos' },
  packs: [], machine: [],
};

const H = 3_600_000;
const tidy = (x: number) => Math.round(x * 1e6) / 1e6;
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

/* ---- one player, one vote per Act, across windows (the owner's answer 2) ---- */
const W1 = { id: 'mon', from: FROM, to: TO };
const W2 = { id: 'tue', from: TO, to: TO + 24 * H };
const day = (window: typeof W1, reactions: InputReaction[], paid: SettlementInput['paid'] = []): SettlementInput => ({ ...base(), window, reactions, paid });

test('a player reacting on Monday and again on Tuesday is paid one vote in all, as on one day', () => {
  const monday = settle(day(W1, [react('p1', 'bob', 'bob-1', 'fire', FROM + H)]), instance);
  assert.equal(amountOf(monday, 'ann-fan', 'fan.love'), 10);
  const tuesday = settle(day(W2, [react('p1', 'bob', 'bob-1', 'fire', FROM + H), react('p1', 'bob', 'bob-1', 'heart', TO + H)], monday.paid), instance);
  assert.equal(amountOf(tuesday, 'ann-fan', 'fan.love'), 0, 'a second reaction in the same quadrant adds nothing to one vote');
  const sameDay = settle(day(W1, [react('p1', 'bob', 'bob-1', 'fire', FROM + H), react('p1', 'bob', 'bob-1', 'heart', FROM + 2 * H)]), instance);
  assert.equal(amountOf(monday, 'ann-fan', 'fan.love') + amountOf(tuesday, 'ann-fan', 'fan.love'), amountOf(sameDay, 'ann-fan', 'fan.love'));
});

test('a second reaction in a later window moves half the vote from one quadrant to the other', () => {
  const monday = settle(day(W1, [react('p1', 'bob', 'bob-1', 'fire', FROM + H)]), instance);
  const tuesday = settle(day(W2, [react('p1', 'bob', 'bob-1', 'fire', FROM + H), react('p1', 'bob', 'bob-1', 'zzz', TO + H)], monday.paid), instance);
  assert.equal(amountOf(tuesday, 'ann-fan', 'fan.love'), -5, 'half the love taken back');
  assert.equal(amountOf(tuesday, 'ann-fan', 'fan.groan'), -5, 'and paid as half a groan');
  assert.deepEqual(tuesday.paid, [{ player: 'bob', act: 'p1', weight: 1, shares: { excitedPositive: 0.5, excitedNegative: 0, calmPositive: 0, boredNegative: 0.5 } }]);
});

test('the halving is fixed in the window of a player\'s first reaction, and never earned again later', () => {
  const monday = settle(day(W1, [react('p1', 'bob', 'bob-1', 'fire', FROM + 4 * H), react('p2', 'bob', 'bob-1', 'fire', FROM + 6 * H)]), instance);
  assert.equal(amountOf(monday, 'ann-fan', 'fan.love'), 15, 'p1 whole, p2 halved');
  assert.equal(monday.paid.find((v) => v.act === 'p2')?.weight, 0.5);
  // On Tuesday p2 is the only Act Bob reacts to; its weight stays the half it was given.
  const tuesday = settle(day(W2, [react('p1', 'bob', 'bob-1', 'fire', FROM + 4 * H), react('p2', 'bob', 'bob-1', 'fire', FROM + 6 * H), react('p2', 'bob', 'bob-1', 'zzz', TO + H)], monday.paid), instance);
  assert.equal(tuesday.paid.find((v) => v.act === 'p2')?.weight, 0.5);
  assert.equal(amountOf(tuesday, 'ann-fan', 'fan.groan'), -3, 'half of a half vote, at -2.5, away from zero');
  assert.equal(tuesday.paid.find((v) => v.act === 'p1'), undefined, 'an Act nobody reacted to again is not written again');
});

test('a vote begun where no window settled it (between seasons) is paid as new, never a stall', () => {
  // Bob's fire came in a gap no window holds, and nothing was paid for it: Tuesday pays his whole
  // vote, split between his two reactions, at Tuesday's halving.
  const tuesday = settle(day(W2, [react('p1', 'bob', 'bob-1', 'fire', FROM + H), react('p1', 'bob', 'bob-1', 'zzz', TO + H)]), instance);
  assert.equal(amountOf(tuesday, 'ann-fan', 'fan.love'), 5);
  assert.equal(amountOf(tuesday, 'ann-fan', 'fan.groan'), -5);
  assert.deepEqual(tuesday.paid, [{ player: 'bob', act: 'p1', weight: 1, shares: { excitedPositive: 0.5, excitedNegative: 0, calmPositive: 0, boredNegative: 0.5 } }]);
});

test('a vote whose halving runs to nothing is paid nothing, and recorded so', () => {
  const tiny = { ...instance, settings: { ...instance.settings, halving: 1e-200 } };
  const acts = [...Array(4)].map((_, i) => post(`n${i}`, 'ann-fan', FROM + i));
  const r = settle({ ...day(W1, acts.map((a) => react(a.id, 'bob', 'bob-1', 'fire', FROM + 10 * H))), acts }, tiny);
  assert.ok(r.paid.every((v) => v.weight >= 0 && Number.isFinite(v.weight)));
  assert.equal(r.paid.find((v) => v.act === 'n3')?.weight, 0);
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
  assert.deepEqual(landedOnAnn, [{ act: 'k1', card: 'splat', alignment: 'salty', readsAs: 'salty', at: FROM + 4 * H + 10, on: 'p1' }]);
  seen.length = 0;
  settle(input, instance);
  const spunByCat = seen.filter((s) => s.character === 'cat-1').flatMap((s) => s.threadsSpun);
  assert.equal(spunByCat.length, 1);
  assert.deepEqual({ ...spunByCat[0], at: undefined }, { act: 's1', thread: 'spun', at: undefined, fromOthers: true, repliersBefore: 1, repliersNow: 3 },
    'Bob before; Dee and Ann in the window; Cat\'s own reply is not counted');
  assert.equal(spunByCat[0]!.at, FROM + 10 * H, 'placed when its count reached its total');
});

test('a spin from one of The System\'s own Acts settles, as a spin from someone else\'s; a target nobody named still throws', () => {
  const b = base();
  const { rules, inputs } = recorder();
  const fromTheSystem: SettlementInput = {
    ...b,
    systemActs: ['reveal-1'],
    acts: [...b.acts, { id: 's9', character: 'cat-1', kind: 'spin', at: FROM + 7 * H, thread: 'about-the-reveal', target: 'reveal-1' }, post('r9', 'bob-1', FROM + 8 * H, 'about-the-reveal')],
  };
  settle(fromTheSystem, withClasses(rules));
  const spun = inputs.flatMap((i) => i.threadsSpun).find((x) => x.act === 's9');
  assert.equal(spun?.fromOthers, true);
  assert.throws(() => settle({ ...fromTheSystem, systemActs: [] }, instance), /not in the input/);
});

test('a reaction to one of The System\'s own Acts settles and moves nobody\'s Aura, the reactor\'s included', () => {
  const b = base();
  const { rules, inputs } = recorder();
  const onTheSystem: SettlementInput = {
    ...b,
    systemActs: ['tally-1'],
    reactions: [...b.reactions, react('tally-1', 'bob', 'bob-1', 'fire', FROM + 7 * H), react('tally-1', 'ann', 'ann-fan', 'zzz', FROM + 8 * H)],
  };
  const r = settle(onTheSystem, withClasses(rules));
  assert.deepEqual(r.entries, settle(b, withClasses(recorder().rules)).entries, 'the same entries as with no reaction to it');
  assert.equal(r.paid.some((p) => p.act === 'tally-1'), false, 'no vote on it is paid, nor held to be moved later');
  assert.equal(inputs.some((i) => [...i.given, ...i.received, ...i.held].some((x) => x.act === 'tally-1')), false, 'no class is given it');
});

test('a Pepperoni play reads as the room leans on it in the window: Salty, Sweet, or Pepperoni on a tie', () => {
  const kind = (key: string, alignment: 'sweet' | 'salty' | 'pepperoni') => ({ key, name: key, alignment, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const { rules, inputs } = recorder();
  const world = { ...withClasses(rules), cards: [...instance.cards, kind('pep', 'pepperoni'), kind('sugar', 'sweet')] };
  const b = base();
  const play = (card: string): InputAct => ({ id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 7 * H, thread: 't1', target: 'q1', card });
  const reads = (votes: InputReaction[], card = 'pep') => {
    inputs.length = 0;
    settle({ ...b, acts: [...b.acts, play(card)], reactions: [...b.reactions, ...votes] }, world);
    const played = inputs.flatMap((i) => i.cardsPlayed).find((c) => c.act === 'k1')!;
    const landed = inputs.flatMap((i) => i.cardsLanded).find((c) => c.act === 'k1')!;
    return [played.alignment, played.readsAs, landed.readsAs];
  };
  const at = FROM + 8 * H;
  assert.deepEqual(reads([react('k1', 'ann', 'ann-fan', 'zzz', at), react('k1', 'dee', 'dee-1', 'tomato', at)]), ['pepperoni', 'salty', 'salty'], 'groans and heat: Salty');
  assert.deepEqual(reads([react('k1', 'ann', 'ann-fan', 'fire', at), react('k1', 'dee', 'dee-1', 'tea', at)]), ['pepperoni', 'sweet', 'sweet'], 'cheers and nods: Sweet');
  assert.deepEqual(reads([react('k1', 'ann', 'ann-fan', 'fire', at), react('k1', 'dee', 'dee-1', 'zzz', at)]), ['pepperoni', 'pepperoni', 'pepperoni'], 'a tie stays Pepperoni');
  assert.deepEqual(reads([]), ['pepperoni', 'pepperoni', 'pepperoni'], 'no reactions: Pepperoni');
  assert.deepEqual(reads([react('k1', 'cat', 'cat-1', 'zzz', at)]), ['pepperoni', 'pepperoni', 'pepperoni'], 'the caster\'s own player never moves the lean');
  assert.deepEqual(reads([react('k1', 'ann', 'ann-fan', 'zzz', at)], 'sugar'), ['sweet', 'sweet', 'sweet'], 'a Sweet card reads as Sweet whatever the room does');
  // Each player weighs one vote, split across their quadrants: Dee's cheer, groan and heat are a third each (-1/3 in all), Ann's
  // cheer is whole (+1), so the room leans Sweet; counted by reactions, not shares, it would be a tie.
  assert.deepEqual(reads([react('k1', 'dee', 'dee-1', 'fire', at), react('k1', 'dee', 'dee-1', 'zzz', at + 1), react('k1', 'dee', 'dee-1', 'tomato', at + 2), react('k1', 'ann', 'ann-fan', 'fire', at)]),
    ['pepperoni', 'sweet', 'sweet'], 'shares, not reactions');
});

/* The two players a Pepperoni card is between (the core loop design, section 2, #170): the room that decides its lean is everyone
   but the caster's player and the target post's author's player. */
test('a Pepperoni play\'s lean leaves out the target author\'s player: their second mask never tips it; a third player does', () => {
  const kind = (key: string, alignment: 'pepperoni') => ({ key, name: key, alignment, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const { rules, inputs } = recorder();
  const world = { ...withClasses(rules), cards: [...instance.cards, kind('pep', 'pepperoni')] };
  const b = base();
  // Cat casts on Ann's post p1; Ann's second mask (ann-quiet) groans at the card.
  const play: InputAct = { id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 7 * H, thread: 't1', target: 'p1', card: 'pep' };
  const reads = (votes: InputReaction[]) => {
    inputs.length = 0;
    settle({ ...b, acts: [...b.acts, play], reactions: [...b.reactions, ...votes] }, world);
    return inputs.flatMap((i) => i.cardsPlayed).find((c) => c.act === 'k1')!.readsAs;
  };
  const at = FROM + 8 * H;
  assert.equal(reads([react('k1', 'ann', 'ann-quiet', 'zzz', at)]), 'pepperoni', 'the author\'s own player never moves the lean');
  assert.equal(reads([react('k1', 'ann', 'ann-quiet', 'zzz', at), react('k1', 'dee', 'dee-1', 'zzz', at)]), 'salty', 'a third player does');
});

test('a Pepperoni play on a staff post has no author player to leave out: a third player\'s groan makes it Salty', () => {
  const kind = (key: string, alignment: 'pepperoni') => ({ key, name: key, alignment, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const { rules, inputs } = recorder();
  const world = { ...withClasses(rules), cards: [...instance.cards, kind('pep', 'pepperoni')] };
  const b = base();
  settle({
    ...b,
    acts: [...b.acts, { id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 7 * H, thread: 't1', target: 'boss-post', card: 'pep' }],
    unscoredTargets: [{ id: 'boss-post', kind: 'post', at: FROM + 1 * H, thread: 't1', staff: true }],
    reactions: [...b.reactions, react('k1', 'dee', 'dee-1', 'zzz', FROM + 8 * H)],
  }, world);
  assert.equal(inputs.flatMap((i) => i.cardsPlayed).find((c) => c.act === 'k1')!.readsAs, 'salty');
});

test('a Pepperoni play from an earlier window whose post is not in the input settles: its lean has no author to leave out', () => {
  const kind = (key: string, alignment: 'pepperoni') => ({ key, name: key, alignment, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const world = { ...withClasses(recorder().rules), cards: [...instance.cards, kind('pep', 'pepperoni')] };
  const b = base();
  // Cat's card from before the window, on a post the input does not hold; Dee reacts to the card in the window.
  const r = settle({
    ...b,
    acts: [...b.acts, { id: 'k0', character: 'cat-1', kind: 'card', at: FROM - 2 * H, thread: 't1', target: 'gone', card: 'pep' }],
    reactions: [...b.reactions, react('k0', 'dee', 'dee-1', 'zzz', FROM + 8 * H)],
  }, world);
  assert.ok(r.entries.length > 0);
});

test('the estimate\'s Pepperoni lean can recognize only the caller: the author\'s own reaction is left out for the author, counted for the caster', () => {
  const kind = (key: string, alignment: 'pepperoni') => ({ key, name: key, alignment, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const { rules, inputs } = recorder();
  const world = { ...withClasses(rules), cards: [...instance.cards, kind('pep', 'pepperoni')] };
  const b = base();
  const play: InputAct = { id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 7 * H, thread: 't1', target: 'p1', card: 'pep' };
  const at = FROM + 8 * H;
  const readsAs = () => inputs.flatMap((i) => [...i.cardsPlayed, ...i.cardsLanded]).find((c) => c.act === 'k1')!.readsAs;
  // Asked by Ann, the author: her own groan is hers, under her own key, and now left out as the author's (until #170 only the caster's was).
  inputs.length = 0;
  estimateForOwner({ ...b, acts: [...b.acts, play], reactions: [...b.reactions, react('k1', 'ann', 'ann-quiet', 'zzz', at)] }, world, 'ann');
  assert.equal(readsAs(), 'pepperoni');
  // Asked by Cat, the caster: estimate_input keys Ann's second mask's groan as a mask of its own, which the engine cannot tie to
  // the author, so it is counted, and the estimate's lean can differ from the settled one (the design's section 2).
  inputs.length = 0;
  estimateForOwner({
    ...b,
    characters: [...b.characters, { id: 'mask-a', player: 'key-a', classes: [] }],
    acts: [...b.acts, play],
    reactions: [...b.reactions, react('k1', 'key-a', 'mask-a', 'zzz', at)],
  }, world, 'cat');
  assert.equal(readsAs(), 'salty');
});

test('a Pepperoni play that reads as Sweet shares the Sweet hold: one player\'s two cards on a post pay what one would', () => {
  const kind = (key: string, alignment: 'sweet' | 'pepperoni') => ({ key, name: key, alignment, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const { rules, inputs } = recorder();
  const world = { ...withClasses(rules), cards: [...instance.cards, kind('pep', 'pepperoni'), kind('sugar', 'sweet')] };
  const b = base();
  const acts: InputAct[] = [
    { id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 7 * H, thread: 't1', target: 'p1', card: 'sugar' },
    { id: 'k2', character: 'cat-1', kind: 'card', at: FROM + 8 * H, thread: 't1', target: 'p1', card: 'pep' },
  ];
  settle({ ...b, acts: [...b.acts, ...acts], reactions: [...b.reactions, react('k2', 'bob', 'bob-1', 'fire', FROM + 9 * H), react('p1', 'dee', 'dee-1', 'fire', FROM + 10 * H)] }, world);
  const lifted = inputs.flatMap((i) => i.cardsPlayed).filter((c) => c.target === 'p1').map((c) => [c.act, c.readsAs, c.targetAfter.excitedPositive]);
  assert.deepEqual(lifted, [['k1', 'sweet', 1], ['k2', 'sweet', 0]], 'Dee\'s fire counts once, for the earlier of the two that read as Sweet');
});

test('two Sweet cards from one player on one post pay what one would: each vote counts once, for the earlier card', () => {
  const sweet = (key: string) => ({ key, name: key, alignment: 'sweet' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) });
  const { rules, inputs } = recorder();
  const world = { ...withClasses(rules), cards: [...instance.cards, sweet('sugar'), sweet('honey')] };
  const b = base();
  const cards: InputAct[] = [
    { id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 7 * H, thread: 't1', target: 'p1', card: 'sugar' },
    { id: 'k2', character: 'cat-1', kind: 'card', at: FROM + 8 * H, thread: 't1', target: 'p1', card: 'honey' },
  ];
  const after = (votes: InputReaction[], acts = cards) => {
    inputs.length = 0;
    settle({ ...b, acts: [...b.acts, ...acts], reactions: [...b.reactions, ...votes] }, world);
    return inputs.flatMap((i) => i.cardsPlayed).filter((c) => c.target === 'p1').map((c) => [c.act, c.targetAfter.excitedPositive]);
  };
  const lifts = [react('p1', 'dee', 'dee-1', 'fire', FROM + 9 * H)];
  assert.deepEqual(after(lifts), [['k1', 1], ['k2', 0]], 'Dee\'s fire after both counts for the earlier card alone');
  assert.deepEqual(after(lifts, [cards[0]!]), [['k1', 1]], 'as it would with the one card');
  assert.deepEqual(after([react('p1', 'dee', 'dee-1', 'fire', FROM + 7 * H + 30 * 60_000)]), [['k1', 1], ['k2', 0]], 'between the two: the first');
  // A Sweet card from an earlier window still holds the votes after it.
  const monday: InputAct = { ...cards[0]!, at: FROM - H };
  assert.deepEqual(after(lifts, [monday, cards[1]!]), [['k2', 0]], 'the earlier window\'s card holds them; the later card is paid none');
  // Per player and per alignment: another player's earlier Sweet card, or this player's earlier
  // Salty one, holds none of the votes a Sweet card of this player's draws.
  const bobs: InputAct = { id: 'k0', character: 'bob-1', kind: 'card', at: FROM + 6 * H, thread: 't1', target: 'p1', card: 'sugar' };
  assert.deepEqual(after(lifts, [bobs, cards[1]!]), [['k0', 1], ['k2', 1]], 'each player\'s own card holds the votes after it');
  const salty: InputAct = { id: 'k0', character: 'cat-1', kind: 'card', at: FROM + 6 * H, thread: 't1', target: 'p1', card: 'splat' };
  assert.deepEqual(after(lifts, [salty, cards[1]!]), [['k0', 1], ['k2', 1]], 'a Salty card holds Salty counting, never a Sweet card\'s');
  // A card whose kind the instance has since retired, from an earlier window, holds nothing.
  const retired: InputAct = { id: 'k0', character: 'cat-1', kind: 'card', at: FROM - H, thread: 't1', target: 'p1', card: 'gone' };
  assert.deepEqual(after(lifts, [retired, cards[1]!]), [['k2', 1]], 'the live card holds the votes');
});

/* ---- the edges: each case below is a boundary a one-character change would move ---- */

const recorder = (): { rules: ClassRules; inputs: ClassInput[] } => {
  const inputs: ClassInput[] = [];
  return { inputs, rules: { key: 'quiet', name: 'Quiet', earn: (i) => { inputs.push(i); return i.posts.map((p) => ({ reason: 'quiet.post', amount: 7, act: p.act })); } } };
};
const withClasses = (...extra: ClassRules[]): Instance => ({ ...instance, classes: [...instance.classes.filter((c) => !extra.some((e) => e.key === c.key)), ...extra] });

test('an entry carries the numbers its earnings were settled under; an entry whose earnings name none carries none (#57)', () => {
  const tuned: ClassRules = { key: 'quiet', name: 'Quiet', earn: (i) => i.posts.map((p) => ({ reason: 'quiet.post', amount: 7, act: p.act, params: { 'quiet.allowed': 4 } })) };
  const r = settle(base(), withClasses(tuned));
  assert.deepEqual(r.entries.find((e) => e.reason === 'quiet.post')?.params, { 'quiet.allowed': 4 });
  assert.equal('params' in r.entries.find((e) => e.reason === 'fan.love')!, false);
});

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
  const halves: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'fan.up', amount: 2.5 }, { reason: 'fan.down', amount: -2.5 }] : []) };
  const r = settle(base(), withClasses(halves));
  assert.equal(amountOf(r, 'ann-fan', 'fan.up'), 3);
  assert.equal(amountOf(r, 'ann-fan', 'fan.down'), -3);
});

test('a class that returns a number that is not one is refused, and a zero is no entry', () => {
  const broken: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'fan.x', amount: Number.NaN }] : []) };
  assert.throws(() => settle(base(), withClasses(broken)), /returned NaN/);
  const zero: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'fan.nothing', amount: 0, act: 'p1' }] : []) };
  const r = settle(base(), withClasses(zero));
  assert.ok(!r.entries.some((e) => e.reason === 'fan.nothing') && !r.details.some((d) => d.reason === 'fan.nothing'));
});

test('a vote a player holds reaches the class of the mask that says it, with the player\'s rank, the other players before and now, and the lean without them', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const tie: SettlementInput = {
    ...b,
    acts: [...b.acts, post('t1p', 'ann-quiet', FROM + H)],
    reactions: [
      ...b.reactions,
      // Dee and Cat react at the same instant: Cat, the lower id, comes first.
      react('t1p', 'dee', 'dee-1', 'zzz', FROM + 2 * H),
      react('t1p', 'cat', 'cat-1', 'fire', FROM + 2 * H),
    ],
  };
  settle(tie, withClasses(rules));
  const held = inputs.flatMap((i) => i.held.map((h) => ({ ...h, by: i.character })));
  const row = (h: (typeof held)[number]) => [h.by, h.quadrant, h.rank, h.endsUp ?? 'none', h.othersBefore, h.othersNow, h.at];
  // Each sees where t1p leans without their own vote: Cat sees Dee's zzz, Dee sees Cat's fire.
  assert.deepEqual(held.filter((h) => h.act === 't1p').map(row).sort(), [
    ['cat-1', 'excitedPositive', 1, 'boredNegative', 0, 1, FROM + 2 * H],
    ['dee-1', 'boredNegative', 2, 'excitedPositive', 0, 1, FROM + 2 * H],
  ]);
  // p1: without Bob, Cat's half fire and half zzz tie; without Cat, Bob's fire leads. Cat holds both halves.
  assert.deepEqual(held.filter((h) => h.act === 'p1').map(row).sort(), [
    ['bob-1', 'excitedPositive', 1, 'none', 0, 1, FROM + 5 * H],
    ['cat-1', 'boredNegative', 2, 'excitedPositive', 0, 1, FROM + 4 * H],
    ['cat-1', 'excitedPositive', 2, 'excitedPositive', 0, 1, FROM + 4 * H],
  ]);
  assert.deepEqual(held.filter((h) => h.act === 'p1' && h.by === 'cat-1').map((h) => h.share), [0.5, 0.5]);
  // Each is held through the reaction that says its quadrant, at that reaction's own time.
  assert.deepEqual(held.filter((h) => h.act === 'p1').map((h) => [h.by, h.quadrant, h.reactedAt]).sort(), [
    ['bob-1', 'excitedPositive', FROM + 4 * H], ['cat-1', 'boredNegative', FROM + 5 * H + 1], ['cat-1', 'excitedPositive', FROM + 5 * H],
  ]);
});

test('a true tie is no direction, though taking a player\'s thirds out of the lean leaves dust', () => {
  const { rules, inputs } = recorder();
  const b = base();
  // Without Bob, one whole excited-positive (Dee) and one whole excited-negative (Cat): a tie, though
  // subtracting Bob's two thirds and one third leaves 0.9999999999999999 against 1.
  const dust: SettlementInput = {
    ...b,
    acts: [...b.acts, post('d1', 'ann-quiet', FROM + H)],
    reactions: [
      ...b.reactions,
      react('d1', 'bob', 'bob-1', 'fire', FROM + 2 * H),
      react('d1', 'bob', 'bob-1', 'heart', FROM + 2 * H + 1),
      react('d1', 'bob', 'bob-1', 'tomato', FROM + 2 * H + 2),
      react('d1', 'cat', 'cat-1', 'tomato', FROM + 3 * H),
      react('d1', 'dee', 'dee-1', 'fire', FROM + 4 * H),
    ],
  };
  settle(dust, withClasses(rules));
  const bob = inputs.filter((i) => i.character === 'bob-1').flatMap((i) => i.held).filter((h) => h.act === 'd1');
  assert.ok(bob.length > 0);
  assert.deepEqual([...new Set(bob.map((h) => h.endsUp))], [null]);
});

test('a vote is held out to its class only in a window another player first reacted in, said by the mask that holds the quadrant', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const later: SettlementInput = {
    ...b,
    characters: [...b.characters, { id: 'cat-2', player: 'cat', classes: [{ class: 'quiet', from: 0 }] }],
    acts: [...b.acts, post('old', 'ann-quiet', FROM - 10 * H)],
    reactions: [
      ...b.reactions,
      react('old', 'bob', 'bob-1', 'fire', FROM - 9 * H),
      react('old', 'cat', 'cat-1', 'fire', FROM - 8 * H),
      // Cat reacts again in the window through another mask; nobody new arrives on 'old'.
      react('old', 'cat', 'cat-2', 'tea', FROM + 9 * H),
    ],
  };
  settle(later, withClasses(rules));
  assert.deepEqual(inputs.flatMap((i) => i.held).filter((h) => h.act === 'old'), [], 'no other player arrived on it in the window');
  inputs.length = 0;
  const arriving: SettlementInput = { ...later, reactions: [...later.reactions, react('old', 'dee', 'dee-1', 'zzz', FROM + 10 * H)] };
  settle(arriving, withClasses(rules));
  const held = inputs.flatMap((i) => i.held.map((h) => ({ ...h, by: i.character }))).filter((h) => h.act === 'old');
  assert.deepEqual(held.filter((h) => h.by === 'bob-1').map((h) => [h.othersBefore, h.othersNow, h.at]), [[1, 2, FROM + 10 * H]], 'Bob: Cat before the window, Dee in it');
  assert.deepEqual(held.filter((h) => h.by.startsWith('cat')).map((h) => [h.by, h.quadrant, h.share, h.othersBefore, h.othersNow]).sort(),
    [['cat-1', 'excitedPositive', 0.5, 1, 2], ['cat-2', 'calmPositive', 0.5, 1, 2]], 'each half said by the mask that reacted in its quadrant');
  assert.deepEqual(held.filter((h) => h.by === 'dee-1'), [], 'Dee arrived after both: no other player came after Dee, so Dee\'s crowd did not grow');
  // Two of Cat's masks in one quadrant: the later one says the whole of it, as a share paid is said.
  inputs.length = 0;
  const sameQuadrant: SettlementInput = { ...arriving, reactions: [...arriving.reactions, react('old', 'cat', 'cat-2', 'fire', FROM + 9 * H + 1)] };
  settle(sameQuadrant, withClasses(rules));
  const cats = inputs.flatMap((i) => i.held.map((h) => ({ ...h, by: i.character }))).filter((h) => h.act === 'old' && h.by.startsWith('cat') && h.quadrant === 'excitedPositive');
  assert.deepEqual(cats.map((h) => [h.by, tidy(h.share)]), [['cat-2', tidy(2 / 3)]]);
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
  const thirds: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'fan.x', amount: 1 / 3, act: 'b' }, { reason: 'fan.x', amount: 1 / 3, act: 'a' }, { reason: 'fan.x', amount: 1 / 3, act: 'c' }] : []) };
  const r = settle(base(), withClasses(thirds));
  assert.equal(amountOf(r, 'ann-fan', 'fan.x'), 1);
  assert.deepEqual(r.details.filter((d) => d.reason === 'fan.x').map((d) => [d.act, d.amount]), [['a', 1]], 'the tie goes to the first key; the others round to nothing and are not shown');
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
  const thirds: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason: 'fan.x', amount: 1 / 3 }, { reason: 'fan.y', amount: 1 / 3 }] : []) };
  assert.equal(settle(base(), withClasses(thirds)).byClass.fan, 1);
});

test('a reason that is not the class contract\'s shape is refused before anything is written', () => {
  for (const reason of ['cheered', 'Fan.love', 'fan.', 'fan love', 'fan.love!']) {
    const bad: ClassRules = { key: 'fan', name: 'Fan', earn: (i) => (i.received.length ? [{ reason, amount: 1 }] : []) };
    assert.throws(() => settle(base(), withClasses(bad)), /reason/, reason);
  }
});

/* ---- the live estimate (the screens' design, section 7) ---- */

/** A class that pays, for each vote it holds, how many others had reacted to the Act by now. */
const counter: ClassRules = {
  key: 'counter', name: 'Counter',
  earn: (input) => input.held.map((h) => ({ reason: 'counter.crowd', amount: h.othersNow * 100 + h.rank, act: h.act, quadrant: h.quadrant })),
};
const counting = (b: SettlementInput): SettlementInput => ({ ...b, characters: b.characters.map((c) => (c.id === 'ann-quiet' ? { ...c, classes: [{ class: 'counter', from: 0 }] } : c)) });

test('the options\' defaults are the exact settlement', () => {
  const b = base();
  // As settle() read this window before it had options (b7ad22d), pinned.
  assert.deepEqual({ entries: settle(b, instance).entries, details: settle(b, instance).details }, {
    entries: [
      { window: 'w1', player: 'ann', character: 'ann-fan', reason: 'fan.groan', amount: -5 },
      { window: 'w1', player: 'ann', character: 'ann-fan', reason: 'fan.love', amount: 20 },
      { window: 'w1', player: 'bob', character: 'bob-1', reason: 'quiet.post', amount: 7 },
    ],
    // The entries as then; the details one line per reaction since each earning names its time (the clues plan, Task 2).
    details: [
      { player: 'ann', character: 'ann-fan', reason: 'fan.groan', act: 'p1', quadrant: 'boredNegative', at: FROM + 5 * H + 1, amount: -5 },
      { player: 'ann', character: 'ann-fan', reason: 'fan.love', act: 'p1', quadrant: 'excitedPositive', at: FROM + 4 * H, amount: 10 },
      { player: 'ann', character: 'ann-fan', reason: 'fan.love', act: 'p1', quadrant: 'excitedPositive', at: FROM + 5 * H, amount: 5 },
      { player: 'ann', character: 'ann-fan', reason: 'fan.love', act: 'p2', quadrant: 'excitedPositive', at: FROM + 6 * H, amount: 5 },
      { player: 'bob', character: 'bob-1', reason: 'quiet.post', act: 'q1', amount: 7 },
    ],
  });
  assert.deepEqual(settle(b, instance, { sharedVote: true, halving: true }), settle(b, instance));
  assert.deepEqual(settle(b, instance, {}), settle(b, instance));
});

test('the estimate values each reaction as a whole vote alone: before the shared vote and the halving', () => {
  const e = estimateForOwner(base(), instance, 'ann');
  const love = e.lines.filter((l) => l.reason === 'fan.love');
  // Bob's fire and Cat's fire on p1, and Bob's heart on p2, each a whole vote: the exact settlement pays 10, 5 and 5.
  assert.deepEqual(love.map((l) => [l.act, l.at, l.amount]), [['p1', FROM + 4 * H, 10], ['p1', FROM + 5 * H, 10], ['p2', FROM + 6 * H, 10]]);
  assert.deepEqual(e.lines.filter((l) => l.reason === 'fan.groan').map((l) => [l.act, l.quadrant, l.at, l.amount]), [['p1', 'boredNegative', FROM + 5 * H + 1, -10]]);
  assert.equal(settle(base(), instance).entries.find((x) => x.reason === 'fan.love')?.amount, 20, 'the exact settlement is unchanged');
});

test('with the shared vote off, a second reaction from one player never changes the first\'s amount', () => {
  const b = base();
  const one = { ...b, reactions: b.reactions.filter((r) => !(r.player === 'cat' && r.kind === 'zzz')) };
  const first = (i: SettlementInput) => estimateForOwner(i, instance, 'ann').lines.find((l) => l.act === 'p1' && l.at === FROM + 5 * H);
  assert.deepEqual(first(b), first(one));
  assert.equal(first(b)?.amount, 10);
});

test('with the halving off, a third post\'s reaction counts whole', () => {
  const b = base();
  const three = { ...b, acts: [...b.acts, post('p3', 'ann-fan', FROM + 2 * H + 1)], reactions: [...b.reactions, react('p3', 'bob', 'bob-1', 'fire', FROM + 7 * H)] };
  assert.equal(estimateForOwner(three, instance, 'ann').lines.find((l) => l.act === 'p3')?.amount, 10);
  assert.equal(settle(three, instance).entries.length > 0, true);
});

test('the estimate for one player is the same whoever else reacted, and through how many characters', () => {
  const b = counting(base());
  const world = withClasses(counter);
  // Ann's quiet mask reacts to Bob's q1, which Cat then reacts to twice.
  const spread: SettlementInput = { ...b, reactions: [...b.reactions, react('q1', 'ann', 'ann-quiet', 'fire', FROM + 3 * H + 1), react('q1', 'cat', 'cat-1', 'tea', FROM + 9 * H), react('q1', 'cat', 'cat-1', 'zzz', FROM + 9 * H + 1)] };
  // The same reactions, the second from Dee: two players, not one.
  const two: SettlementInput = { ...spread, reactions: spread.reactions.map((r) => (r.act === 'q1' && r.kind === 'zzz' ? { ...r, player: 'dee', character: 'dee-1' } : r)) };
  // And Cat's two from two masks of Cat's.
  const masks: SettlementInput = { ...spread, characters: [...spread.characters, { id: 'cat-2', player: 'cat', classes: [{ class: 'quiet', from: 0 }] }], reactions: spread.reactions.map((r) => (r.act === 'q1' && r.kind === 'zzz' ? { ...r, character: 'cat-2' } : r)) };
  const of = (i: SettlementInput) => estimateForOwner(i, world, 'ann');
  assert.ok(of(spread).lines.some((l) => l.reason === 'counter.crowd'), 'the class reads its held vote');
  assert.deepEqual(of(two), of(spread));
  assert.deepEqual(of(masks), of(spread));
  // The same is not true of the exact settlement, which counts players: the estimate is what changed.
  assert.notDeepEqual(settle(two, world).entries.filter((x) => x.player === 'ann'), settle(spread, world).entries.filter((x) => x.player === 'ann'));
});

test('the estimate carries the caller\'s own characters only, never who reacted, and its lines add up to its entries', () => {
  const e = estimateForOwner(base(), instance, 'ann');
  assert.ok(e.entries.length > 0);
  assert.ok([...e.entries, ...e.lines].every((x) => x.character.startsWith('ann-')));
  const said = JSON.stringify(e);
  for (const who of ['bob', 'cat', 'dee']) assert.ok(!said.includes(who), `${who} reached the estimate`);
  assert.ok(!said.includes('player'), 'no line names a player');
  for (const entry of e.entries) {
    const sum = e.lines.filter((l) => l.character === entry.character && l.reason === entry.reason).reduce((t, l) => t + l.amount, 0);
    assert.equal(sum, entry.amount, `${entry.character} ${entry.reason}`);
  }
});

test('the estimate ranks reactions at the same instant alike, whatever keys their reactors are given', () => {
  const b = counting(base());
  const world = withClasses(counter);
  const tied: SettlementInput = { ...b, reactions: [...b.reactions, react('q1', 'ann', 'ann-quiet', 'fire', FROM + 9 * H), react('q1', 'cat', 'cat-1', 'tea', FROM + 9 * H), react('q1', 'dee', 'dee-1', 'zzz', FROM + 10 * H)] };
  // Cat's key sorts after Ann's; renamed, before it.
  const renamed: SettlementInput = { ...tied, characters: tied.characters.map((c) => (c.player === 'cat' ? { ...c, player: 'aaa' } : c)), reactions: tied.reactions.map((r) => (r.player === 'cat' ? { ...r, player: 'aaa' } : r)) };
  const crowd = (i: SettlementInput) => estimateForOwner(i, world, 'ann').lines.filter((l) => l.reason === 'counter.crowd');
  assert.ok(crowd(tied).length > 0);
  assert.deepEqual(crowd(renamed), crowd(tied));
});

test('a reveal is an Act of its character like a card: its reactions are scored, it counts in the halving, and it is no post', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const unmask: InputAct = { id: 'u1', character: 'ann-fan', kind: 'unmask', at: FROM + 30 * 60_000, thread: 't1' };
  const input: SettlementInput = { ...b, acts: [unmask, ...b.acts], reactions: [react('u1', 'bob', 'bob-1', 'fire', FROM + 3 * H), ...b.reactions] };
  // Its cheer pays its character's class, as any of its Acts' would.
  const r = settle(input, instance);
  assert.deepEqual(r.details.filter((d) => d.act === 'u1').map((d) => [d.reason, d.amount]), [['fan.love', 10]]);
  // And it is Bob's first Act of Ann's voted on, so p1 and p2, after it, are his second and third: halved, then halved again.
  assert.equal(amountOf(r, 'ann-fan', 'fan.love'), amountOf(settle(b, instance), 'ann-fan', 'fan.love') - 5 - 2.5 + 10 + 0.5);
  settle({ ...input, acts: [{ ...unmask, character: 'ann-quiet' }, ...b.acts] }, withClasses(rules));
  const received = inputs.filter((i) => i.character === 'ann-quiet').flatMap((i) => i.received);
  assert.deepEqual(received.map((x) => [x.act, x.actKind]), [['u1', 'unmask']], 'a class reads a reveal\'s reactions, named as a reveal\'s');
  assert.deepEqual(inputs.filter((i) => i.character === 'ann-quiet').flatMap((i) => i.posts), [], 'a reveal is not a post');
});

test('an announce is an Act of its character like an unmask: its reactions are scored', () => {
  const { rules, inputs } = recorder();
  const b = base();
  const announce: InputAct = { id: 'a1', character: 'ann-fan', kind: 'announce', at: FROM + 30 * 60_000, thread: 't1' };
  const input: SettlementInput = { ...b, acts: [announce, ...b.acts], reactions: [react('a1', 'bob', 'bob-1', 'fire', FROM + 3 * H), ...b.reactions] };
  const r = settle(input, instance);
  // Not a System Act's reaction: the cheer pays its character's class, which a System Act's reaction never does. This
  // guards against a kind filter or a systemActs listing that would drop it.
  assert.deepEqual(r.details.filter((d) => d.act === 'a1').map((d) => [d.reason, d.amount]), [['fan.love', 10]], 'its cheer pays its character\'s class');
  settle({ ...input, acts: [{ ...announce, character: 'ann-quiet' }, ...b.acts] }, withClasses(rules));
  const received = inputs.filter((i) => i.character === 'ann-quiet').flatMap((i) => i.received);
  assert.deepEqual(received.map((x) => [x.act, x.actKind]), [['a1', 'announce']]);
  assert.deepEqual(inputs.filter((i) => i.character === 'ann-quiet').flatMap((i) => i.posts), [], 'an announce is not a post');
});

/* ---- the shares: each entry split across the posts the live estimate valued ---- */

/** Each entry's shares, summed: what the shares of each entry add up to. */
const shareTotals = (shares: ReturnType<typeof shareEntries>) => {
  const out = new Map<string, number>();
  for (const s of shares) { const k = `${s.player}\u0000${s.character}\u0000${s.reason}`; out.set(k, (out.get(k) ?? 0) + s.amount); }
  return out;
};
const assertSharesAddUp = (entries: readonly LedgerEntry[], shares: ReturnType<typeof shareEntries>) => {
  const totals = shareTotals(shares);
  for (const s of shares) {
    assert.ok(Number.isInteger(s.amount) && s.amount !== 0, 'a share is whole hundredths, never 0');
    assert.ok(entries.some((e) => e.player === s.player && e.character === s.character && e.reason === s.reason), 'a share names an entry');
  }
  for (const e of entries) {
    const k = `${e.player}\u0000${e.character}\u0000${e.reason}`;
    if (totals.has(k)) assert.equal(totals.get(k), e.amount, `${e.character} ${e.reason}`);
  }
};

test('each entry\'s shares add up to it exactly', () => {
  const b = base();
  // Thirds of a vote on three posts, which do not round evenly, beside the base window's.
  const thirds: SettlementInput = {
    ...b,
    acts: [...b.acts, post('p3', 'ann-fan', FROM + 3 * H), post('p4', 'ann-fan', FROM + 3 * H + 1)],
    reactions: [...b.reactions, ...['p1', 'p3', 'p4'].flatMap((act) => ['fire', 'tea', 'tomato'].map((kind) => react(act, 'dee', 'dee-1', kind, FROM + 8 * H)))],
  };
  for (const input of [b, thirds]) {
    const { entries } = settle(input, instance);
    const shares = shareEntries(input, instance, entries);
    assert.ok(shares.length > 0);
    assert.ok(entries.every((e) => shareTotals(shares).has(`${e.player}\u0000${e.character}\u0000${e.reason}`)), 'every entry here has weight of its sign');
    assertSharesAddUp(entries, shares);
  }
  // The base window's love: 20, split as the estimate valued it, a whole vote for each of three reactions: two on p1, one on p2.
  const love = shareEntries(b, instance, settle(b, instance).entries).filter((s) => s.reason === 'fan.love');
  assert.deepEqual(love.map((s) => [s.act, s.quadrant, s.amount]), [['p1', 'excitedPositive', 13], ['p2', 'excitedPositive', 7]]);
});

test('three fires on one post from one player share an entry as three from three players do', () => {
  const characters = [
    { id: 'ann-fan', player: 'ann', classes: [{ class: 'fan', from: 0 }] },
    ...['bob-1', 'bob-2', 'bob-3', 'cat-1', 'dee-1', 'eve-1'].map((id) => ({ id, player: id.split('-')[0]!, classes: [{ class: 'quiet', from: 0 }] })),
  ];
  const acts = [post('p1', 'ann-fan', FROM + H), post('p2', 'ann-fan', FROM + 2 * H)];
  // One player behind three masks on p1, and Eve on p2.
  const onePlayer: SettlementInput = {
    window: { id: 'w1', from: FROM, to: TO }, characters, acts,
    reactions: [react('p1', 'bob', 'bob-1', 'fire', FROM + 3 * H), react('p1', 'bob', 'bob-2', 'fire', FROM + 4 * H), react('p1', 'bob', 'bob-3', 'fire', FROM + 5 * H), react('p2', 'eve', 'eve-1', 'fire', FROM + 6 * H)],
  };
  // The same three fires from three players.
  const threePlayers: SettlementInput = {
    ...onePlayer,
    reactions: [react('p1', 'bob', 'bob-1', 'fire', FROM + 3 * H), react('p1', 'cat', 'cat-1', 'fire', FROM + 4 * H), react('p1', 'dee', 'dee-1', 'fire', FROM + 5 * H), react('p2', 'eve', 'eve-1', 'fire', FROM + 6 * H)],
  };
  // The exact settlement tells them apart (one vote on p1, or three): the shares must not.
  assert.notDeepEqual(settle(onePlayer, instance).details.map((d) => d.amount), settle(threePlayers, instance).details.map((d) => d.amount));
  const entries = settle(onePlayer, instance).entries;
  const one = shareEntries(onePlayer, instance, entries);
  assert.deepEqual(one.map((s) => [s.act, s.amount]), [['p1', 15], ['p2', 5]], 'three whole votes on p1 to one on p2');
  assert.deepEqual(shareEntries(threePlayers, instance, entries), one);
});

/* A spinner's class: 10 for each spun thread whose repliers reach two in the window. */
const spinner: ClassRules = {
  key: 'spinner',
  name: 'Spinner',
  earn: (input) => input.threadsSpun.filter((t) => t.repliersBefore < 2 && t.repliersNow >= 2).map((t) => ({ reason: 'spinner.crowd', amount: 10, act: t.act })),
};

test('a reason the estimate pays on another post than the settlement does is shared on the estimate\'s', () => {
  const b = base();
  const input: SettlementInput = {
    ...b,
    characters: [...b.characters, { id: 'ann-spin', player: 'ann', classes: [{ class: 'spinner', from: 0 }] }, { id: 'bob-2', player: 'bob', classes: [{ class: 'quiet', from: 0 }] }, { id: 'cat-2', player: 'cat', classes: [{ class: 'quiet', from: 0 }] }],
    acts: [
      ...b.acts,
      // s1: Bob replies in the window as two masks, so the estimate counts two repliers and the settlement one.
      { id: 's1', character: 'ann-spin', kind: 'spin', at: FROM - 5 * H, thread: 'one', target: 'q1' },
      post('o1', 'bob-1', FROM + 7 * H, 'one'), post('o2', 'bob-2', FROM + 8 * H, 'one'),
      // s2: Cat replied before the window as two masks, and Dee replies in it: the settlement's count reaches two in the window, the estimate's was two already.
      { id: 's2', character: 'ann-spin', kind: 'spin', at: FROM - 5 * H, thread: 'two', target: 'q1' },
      post('t1', 'cat-1', FROM - 4 * H, 'two'), post('t2', 'cat-2', FROM - 3 * H, 'two'), post('t3', 'dee-1', FROM + 9 * H, 'two'),
    ],
  };
  const world = withClasses(spinner);
  const exact = settle(input, world);
  assert.deepEqual(exact.details.filter((d) => d.reason === 'spinner.crowd').map((d) => d.act), ['s2'], 'the settlement pays s2');
  const shares = shareEntries(input, world, exact.entries).filter((s) => s.reason === 'spinner.crowd');
  assert.deepEqual(shares.map((s) => [s.act, s.amount]), [['s1', 10]], 'the share is on s1, the estimate\'s');
});

test('a negative entry is shared negatively, and an entry with no weight of its sign has no shares', () => {
  const b = base();
  const groan: SettlementInput = { ...b, reactions: [...b.reactions, react('p2', 'dee', 'dee-1', 'zzz', FROM + 7 * H)] };
  const { entries } = settle(groan, instance);
  const shares = shareEntries(groan, instance, entries).filter((s) => s.reason === 'fan.groan');
  assert.ok(shares.length === 2 && shares.every((s) => s.amount < 0));
  assertSharesAddUp(entries, shares);
  // An entry the estimate holds nothing of its sign for: a groan of -5 handed in where the estimate has only love.
  const love: SettlementInput = { ...b, reactions: b.reactions.filter((r) => r.kind !== 'zzz') };
  const odd: LedgerEntry[] = [{ window: 'w1', player: 'ann', character: 'ann-fan', reason: 'fan.groan', amount: -5 }, { window: 'w1', player: 'ann', character: 'ann-fan', reason: 'fan.love', amount: -3 }];
  assert.deepEqual(shareEntries(love, instance, odd), [], 'no groan in the estimate, and love only of the other sign');
});

/* A thief's class: a card's stolen thunder, its target's cheers after it, paid on the card's own Act. */
const thief: ClassRules = {
  key: 'thief',
  name: 'Thief',
  earn: (input, settings) => input.cardsPlayed.map((c) => ({ reason: 'thief.thunder', amount: settings.vote * c.targetAfter.excitedPositive, act: c.act, quadrant: 'excitedPositive' as const, valuing: { act: c.target, from: c.at } })),
};

test('a card\'s stolen thunder is shared on the card\'s own Act', () => {
  const b = base();
  const input: SettlementInput = {
    ...b,
    characters: [...b.characters, { id: 'cat-thief', player: 'cat', classes: [{ class: 'thief', from: 0 }] }],
    acts: [...b.acts, { id: 'k1', character: 'cat-thief', kind: 'card', at: FROM + 3 * H + 30, thread: 't1', target: 'p1', card: 'splat' }],
  };
  const world = withClasses(thief);
  const { entries } = settle(input, world);
  assert.ok(entries.some((e) => e.reason === 'thief.thunder'));
  const shares = shareEntries(input, world, entries).filter((s) => s.reason === 'thief.thunder');
  assert.deepEqual(shares.map((s) => [s.character, s.act, s.quadrant]), [['cat-thief', 'k1', 'excitedPositive']]);
  assertSharesAddUp(entries, shares);
});

test('the shares are the same in any input order', () => {
  const b = base();
  const input: SettlementInput = { ...b, reactions: [...b.reactions, react('p2', 'dee', 'dee-1', 'zzz', FROM + 7 * H), react('p2', 'cat', 'cat-1', 'fire', FROM + 7 * H)] };
  const { entries } = settle(input, instance);
  const one = shareEntries(input, instance, entries);
  const shuffled: SettlementInput = { ...input, characters: [...input.characters].reverse(), acts: [...input.acts].reverse(), reactions: [...input.reactions].reverse() };
  assert.ok(one.length > 0);
  assert.deepEqual(shareEntries(shuffled, instance, [...entries].reverse()), one);
});

/* A class that pays a cheer and charges a groan under one reason, each on the reaction's post. */
const mixed: ClassRules = {
  key: 'mixed',
  name: 'Mixed',
  earn: (input, settings) => input.received.flatMap((r): Earning[] =>
    r.quadrant === 'excitedPositive' ? [{ reason: 'mixed.feel', amount: settings.vote * r.votes, act: r.act, at: r.at }]
    : r.quadrant === 'boredNegative' ? [{ reason: 'mixed.feel', amount: -settings.vote * r.votes, act: r.act, at: r.at }]
    : []),
};

test('a reason that pays and costs: each post\'s lines are netted, and a post of the other sign is no share', () => {
  const b = base();
  const input: SettlementInput = {
    ...b,
    characters: b.characters.map((c) => (c.id === 'ann-fan' ? { ...c, classes: [{ class: 'mixed', from: 0 }] } : c)),
    acts: [...b.acts, post('p3', 'ann-fan', FROM + 3 * H + 1)],
    reactions: [...b.reactions, react('p3', 'dee', 'dee-1', 'zzz', FROM + 7 * H)],
  };
  const world = withClasses(mixed);
  const { entries } = settle(input, world);
  // Exact: p1 10 + 5 - 5, p2 5, p3 -10. The estimate: p1 10 + 10 - 10, p2 10, p3 -10.
  assert.deepEqual(entries.filter((e) => e.reason === 'mixed.feel').map((e) => e.amount), [5]);
  const shares = shareEntries(input, world, entries).filter((s) => s.reason === 'mixed.feel');
  assert.deepEqual(shares.map((s) => [s.act, s.amount]), [['p1', 3], ['p2', 2]], 'p1 nets to one cheer, p2 is one, and p3\'s groan is of the other sign');
});

test('an entry whose estimate holds weight of its sign on no Act has no shares, rather than handing that part to a post', () => {
  const placed: ClassRules = { key: 'placed', name: 'Placed', earn: (input) => input.posts.flatMap((p): Earning[] => [{ reason: 'placed.both', amount: 10, act: p.act }, { reason: 'placed.both', amount: 10 }, { reason: 'placed.post', amount: 10, act: p.act }]) };
  const b = base();
  const input: SettlementInput = { ...b, characters: b.characters.map((c) => (c.id === 'bob-1' ? { ...c, classes: [{ class: 'placed', from: 0 }] } : c)) };
  const world = withClasses(placed);
  const { entries } = settle(input, world);
  assert.equal(entries.find((e) => e.reason === 'placed.both')?.amount, 20);
  assert.deepEqual(shareEntries(input, world, entries).filter((s) => s.character === 'bob-1').map((s) => [s.reason, s.act, s.amount]), [['placed.post', 'q1', 10]]);
});

test('a reaction reaches the class of the reacted Act\'s author with the Act\'s own time: never the window\'s start or the reaction\'s', () => {
  seen.length = 0;
  const b = base();
  // Bob's old post, made two windows before this one; Cat reacts to it in this window.
  const old = FROM - 2 * (TO - FROM) + 5 * H;
  settle({ ...b, acts: [...b.acts, post('old', 'bob-1', old)], reactions: [...b.reactions, react('old', 'cat', 'cat-1', 'tea', FROM + 7 * H)] }, instance);
  const got = seen.filter((s) => s.character === 'bob-1').flatMap((s) => s.received).filter((r) => r.act === 'old');
  assert.equal(got.length, 1);
  assert.equal(got[0]!.actAt, old);
  assert.equal(got[0]!.at, FROM + 7 * H);
});

test('a reaction on a card carries the card\'s own time', () => {
  seen.length = 0;
  const b = base();
  const cardAt = FROM - 30 * H;
  settle({
    ...b,
    acts: [...b.acts, { id: 'k1', character: 'bob-1', kind: 'card', at: cardAt, thread: 't1', target: 'p1', card: 'splat' }],
    reactions: [...b.reactions, react('k1', 'cat', 'cat-1', 'fire', FROM + 12 * H)],
  }, instance);
  const got = seen.filter((s) => s.character === 'bob-1').flatMap((s) => s.received).filter((r) => r.act === 'k1');
  assert.equal(got.length, 1);
  assert.equal(got[0]!.actKind, 'card');
  assert.equal(got[0]!.actAt, cardAt);
});

/* Cards on a staff post and a trap's spring (docs/plans/2026-11-01-card-plays-plan.md, Task 5). "outdraw" earns 20 for a card
   that drew more than its target and loses 20 for one that drew less, naming the card; "fan" and "quiet" are as above. */
const outdraw: ClassRules = {
  key: 'outdraw',
  name: 'Outdraw',
  earn: (input) => input.cardsPlayed.flatMap((c): Earning[] =>
    c.votes > c.targetVotes ? [{ reason: 'outdraw.won', amount: 20, act: c.act }] : c.votes < c.targetVotes ? [{ reason: 'outdraw.lost', amount: -20, act: c.act }] : []),
};
const staffWorld: Instance = { ...instance, classes: [...instance.classes, outdraw] };
function staffBoard(cardVoters: string[], postVoters: string[]): SettlementInput {
  const voters = ['bob', 'cat', 'dee'];
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'ann-out', player: 'ann', classes: [{ class: 'outdraw', from: 0 }] },
      ...voters.map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    // The staff post is no character's in the input: it is an unscored target, its author marked staff.
    acts: [{ id: 'k1', character: 'ann-out', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'boss-post', card: 'splat' }],
    unscoredTargets: [{ id: 'boss-post', kind: 'post', at: FROM + 1 * H, thread: 't1', staff: true }],
    reactions: [
      ...cardVoters.map((p, i) => react('k1', p, `${p}-1`, 'fire', FROM + (3 + i) * H)),
      ...postVoters.map((p, i) => react('boss-post', p, `${p}-1`, 'fire', FROM + (3 + i) * H)),
    ],
  };
}

test('a card on a staff post earns its caster by class, judged against the post\'s reactions, and the post pays nobody', () => {
  const won = settle(staffBoard(['bob', 'cat'], ['dee']), staffWorld);
  assert.equal(amountOf(won, 'ann-out', 'outdraw.won'), 20, 'two players drew to the card, one to the staff post');
  assert.deepEqual(won.entries.filter((e) => e.character === 'boss-post' || e.reason.startsWith('quiet.')).map((e) => e.reason), [], 'the staff post pays nobody, and its reactors are paid nothing for reacting');
  const lost = settle(staffBoard(['bob'], ['cat', 'dee']), staffWorld);
  assert.equal(amountOf(lost, 'ann-out', 'outdraw.lost'), -20, 'outdrawn by the staff post');
  const played = (() => { seen.length = 0; return settle(staffBoard(['bob'], ['cat', 'dee']), { ...staffWorld, classes: [{ ...outdraw, earn: (i, s) => { seen.push(i); return outdraw.earn(i, s); } }, quiet, fan] }); })();
  assert.ok(played);
  const card = seen.flatMap((s) => s.cardsPlayed).find((c) => c.act === 'k1')!;
  assert.deepEqual([card.onOthers, card.votes, card.targetVotes, card.targetAfter.excitedPositive], [true, 1, 2, 2], 'the staff post is someone else\'s, its votes counted once each');
  assert.ok(!seen.some((s) => s.cardsLanded.length), 'a card on a staff post lands on no character');
});

test('a spring settles as a play of its trap card on the trapped post: its reactions pay its setter by class', () => {
  seen.length = 0;
  const b = base();
  const input: SettlementInput = {
    ...b,
    characters: [...b.characters, { id: 'ann-out', player: 'ann', classes: [{ class: 'outdraw', from: 0 }] }],
    acts: [...b.acts, post('own', 'ann-out', FROM + 1 * H), { id: 'sp', character: 'ann-out', kind: 'spring', at: FROM + 2 * H, thread: 't1', target: 'own', card: 'splat' }],
    reactions: [...b.reactions, react('sp', 'bob', 'bob-1', 'fire', FROM + 3 * H), react('sp', 'cat', 'cat-1', 'fire', FROM + 3 * H)],
  };
  const r = settle(input, { ...staffWorld, classes: [{ ...outdraw, earn: (i, s) => { seen.push(i); return outdraw.earn(i, s); } }, quiet, fan] });
  assert.equal(amountOf(r, 'ann-out', 'outdraw.won'), 20, 'the spring drew two players, the trapped post none');
  const played = seen.filter((s) => s.character === 'ann-out').flatMap((s) => s.cardsPlayed);
  assert.deepEqual(played.map((c) => [c.act, c.card, c.alignment, c.target, c.onOthers]), [['sp', 'splat', 'salty', 'own', false]]);
});

test('a settlement with no staff target and no spring is as it was', () => {
  const b = base();
  assert.deepEqual(settle({ ...b, unscoredTargets: [] }, instance), settle(b, instance));
});

/* Spring scoring and Earn (docs/plans/2026-11-11-card-types-plan.md, Task 2). A Reversal's spring (a set card's, with `by`) is scored
   against the Act that sprang it; a face-down Move's spring stays on its own post, because the card it lands on the quoting post is
   the play there (#420): "snatcher" earns 20 for a Salty play that outdraws what it landed on, "lifter" a vote per excited-positive vote a Sweet
   play's target draws after it; "kinded" pays every reaction its own vote and names the reaction's kind. */
const snatcher: ClassRules = {
  key: 'snatcher',
  name: 'Snatcher',
  earn: (input) => input.cardsPlayed.filter((c) => c.readsAs === 'salty' && c.onOthers && c.votes > c.targetVotes).map((c): Earning => ({ reason: 'snatcher.stole', amount: 20, act: c.act })),
};
const lifter: ClassRules = {
  key: 'lifter',
  name: 'Lifter',
  earn: (input, settings) => input.cardsPlayed.filter((c) => c.readsAs === 'sweet' && c.onOthers && c.targetAfter.excitedPositive > 0)
    .map((c): Earning => ({ reason: 'lifter.lifted', amount: settings.vote * c.targetAfter.excitedPositive, act: c.act })),
};
const kinded: ClassRules = {
  key: 'kinded',
  name: 'Kinded',
  earn: (input, settings) => input.received.map((r): Earning => ({
    reason: r.quadrant === 'boredNegative' ? 'kinded.groan' : 'kinded.nod', amount: (r.quadrant === 'boredNegative' ? -1 : 1) * settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at, kind: r.kind,
  })),
};
const splat = instance.cards[0]!;
const cardsWorld: Instance = {
  ...instance,
  classes: [...instance.classes, snatcher, lifter, kinded],
  cards: [
    ...instance.cards,
    { ...splat, key: 'catch', play: 'set', trap: { trigger: { on: 'cast' } } },
    { ...splat, key: 'cheer', alignment: 'sweet', play: 'set', trap: { trigger: { on: 'visit' } } },
    { ...splat, key: 'calmBoost', gimmick: { kind: 'earn', quadrants: ['calmPositive'], by: 0.1 } },
    { ...splat, key: 'fireBoost', gimmick: { kind: 'earn', reactions: ['fire'], by: 0.5 } },
    { ...splat, key: 'dustBoost', gimmick: { kind: 'earn', quadrants: ['calmPositive'], by: 1e-8 } },
  ],
};
function springBoard(castBy: string, extra: InputAct[] = [], unscoredTargets: SettlementInput['unscoredTargets'] = []): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'ann-snatcher', player: 'ann', classes: [{ class: 'snatcher', from: 0 }] },
      { id: 'ann-lift', player: 'ann', classes: [{ class: 'lifter', from: 0 }] },
      { id: 'ann-quiet', player: 'ann', classes: [{ class: 'quiet', from: 0 }] },
      ...['bob', 'cat', 'dee'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    acts: [
      post('ap', 'ann-snatcher', FROM + 1 * H),
      { id: 'cast', character: castBy, kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'ap', card: 'splat' },
      { id: 'sp', character: 'ann-snatcher', kind: 'spring', at: FROM + 3 * H, thread: 't1', target: 'ap', card: 'catch', by: 'cast' },
      ...extra,
    ],
    unscoredTargets,
    reactions: [react('sp', 'cat', 'cat-1', 'fire', FROM + 4 * H), react('sp', 'dee', 'dee-1', 'fire', FROM + 5 * H)],
  };
}
test('a spring catching another player\'s cast is scored against the cast, and a Salty one that outdraws it steals thunder', () => {
  const r = settle(springBoard('bob-1'), cardsWorld);
  assert.equal(amountOf(r, 'ann-snatcher', 'snatcher.stole'), 20, 'the spring drew two players, the cast none');
});
test('a spring catching the setter\'s own other mask\'s cast earns nothing', () => {
  const r = settle(springBoard('ann-quiet'), cardsWorld);
  assert.equal(amountOf(r, 'ann-snatcher', 'snatcher.stole'), 0);
});
test('a Sweet spring on a staff visit that draws hype lifts it, and a spring with no `by` keeps its trapped post', () => {
  const visit = { id: 'visit1', kind: 'post' as const, at: FROM + 1 * H, thread: 't1', staff: true as const };
  const b = springBoard('bob-1', [], [visit]);
  const sweet = (extra: Partial<InputAct>): SettlementInput => ({
    ...b,
    acts: [post('ap', 'ann-lift', FROM + 1 * H), { id: 'sp', character: 'ann-lift', kind: 'spring', at: FROM + 3 * H, thread: 't1', target: 'ap', card: 'cheer', ...extra }],
    reactions: [react('visit1', 'cat', 'cat-1', 'fire', FROM + 4 * H), react('visit1', 'dee', 'dee-1', 'fire', FROM + 5 * H)],
  });
  assert.equal(amountOf(settle(sweet({ by: 'visit1' }), cardsWorld), 'ann-lift', 'lifter.lifted'), 20, 'two players cheered the visit after the spring');
  assert.equal(amountOf(settle(sweet({ by: 'unseen-visit' }), cardsWorld), 'ann-lift', 'lifter.lifted'), 0, 'a staff Act nobody reacted to');
  assert.equal(amountOf(settle(sweet({}), cardsWorld), 'ann-lift', 'lifter.lifted'), 0, 'without `by`, the trapped post is its own and its reactions are not the visit\'s');
});
test('a face-down Move that lands by a quote is one play on the quoter: its spring stays on the setter\'s own post', () => {
  /* "sold" loses 20 for each Salty card landed on it; "snatcher" earns 20 for a Salty play on another's Act that outdraws it. Ann set
     Splat (a Move) face down on her post; Bob's post quoted it, so the spring names Bob's post in `by` and the card lands there. */
  const landings: ClassInput['cardsLanded'][number][] = [];
  const plays: ClassInput['cardsPlayed'][number][] = [];
  const sold: ClassRules = {
    key: 'sold', name: 'Sold',
    earn: (input) => { landings.push(...input.cardsLanded); return input.cardsLanded.filter((c) => c.readsAs === 'salty').map((c): Earning => ({ reason: 'sold.theL', amount: -20, act: c.act })); },
  };
  const world: Instance = { ...cardsWorld, classes: [...cardsWorld.classes.filter((c) => c.key !== 'snatcher'), sold, { ...snatcher, earn: (i, s) => { plays.push(...i.cardsPlayed); return snatcher.earn(i, s); } }] };
  const b: SettlementInput = {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'ann-snatcher', player: 'ann', classes: [{ class: 'snatcher', from: 0 }] },
      { id: 'bob-sold', player: 'bob', classes: [{ class: 'sold', from: 0 }] },
      ...['cat', 'dee'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    acts: [
      post('ap', 'ann-snatcher', FROM + 1 * H),
      post('bq', 'bob-sold', FROM + 2 * H),
      { id: 'sp', character: 'ann-snatcher', kind: 'spring', at: FROM + 2 * H, thread: 't1', target: 'ap', card: 'splat', by: 'bq' },
      { id: 'laid', character: 'ann-snatcher', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'bq', card: 'splat' },
    ],
    // The room reacts to the spring's Act, so a spring scored on Bob's post would outdraw it.
    reactions: [react('sp', 'cat', 'cat-1', 'fire', FROM + 4 * H), react('sp', 'dee', 'dee-1', 'fire', FROM + 5 * H)],
  };
  const r = settle(b, world);
  assert.deepEqual(landings.map((c) => c.act), ['laid'], 'one landing on Bob: the card, not the spring too');
  assert.equal(amountOf(r, 'bob-sold', 'sold.theL'), -20, 'Bob sells one L');
  assert.deepEqual(plays.map((c) => [c.act, c.target, c.onOthers]).sort(), [['laid', 'bq', true], ['sp', 'ap', false]], 'the spring is a play on Ann\'s own post');
  assert.equal(amountOf(r, 'ann-snatcher', 'snatcher.stole'), 0, 'the spring\'s reactions outdraw nothing of Bob\'s');
  // The estimate is the same function, so it counts one landing too.
  landings.length = 0;
  estimateForOwner(b, world, 'bob');
  assert.deepEqual(landings.map((c) => c.act), ['laid']);
});

function earnBoard(gimmicks: InputAct[], reactions: InputReaction[]): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: 'kinded', from: 0 }] },
      ...['bob', 'cat', 'dee'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    acts: [post('tp1', 'tom-1', FROM + 1 * H), post('tp2', 'tom-1', FROM + 1 * H + 1), ...gimmicks],
    reactions,
  };
}
const onTom = (id: string, card: string, at: number, ends: number | null = FROM + 20 * H): InputAct => ({ id, character: 'tom-1', kind: 'card', at, thread: 't1', card, reach: 'character', on: 'tom-1', ...(ends !== null ? { ends } : {}) });
test('an earn gimmick raises positive earnings from its quadrants inside its window, and nothing outside it', () => {
  const r = settle(earnBoard([onTom('g1', 'calmBoost', FROM + 2 * H, FROM + 10 * H)], [
    react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'tea', FROM + 12 * H),
    react('tp1', 'dee', 'dee-1', 'tea', FROM + 1 * H),
  ]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'kinded.nod'), 30);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 1, '10% of the one vote inside [at, ends)');
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.boost')!.params, { card: 'calmBoost' });
});
test('an earn gimmick never raises a negative earning, and one from a quadrant it does not name is left alone', () => {
  const r = settle(earnBoard([onTom('g1', 'calmBoost', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'fire', FROM + 5 * H),
  ]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'kinded.groan'), -10);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 0);
});
test('an earn gimmick that names a reaction raises that reaction and leaves another of the same quadrant alone', () => {
  const r = settle(earnBoard([onTom('g1', 'fireBoost', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H),
    react('tp2', 'cat', 'cat-1', 'heart', FROM + 5 * H),
  ]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'kinded.nod'), 20);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 5, 'half of the fire vote only');
});
test('a gimmick on a post raises that post\'s earnings alone, and two gimmicks each raise on their own', () => {
  const onPost: InputAct = { id: 'g2', character: 'tom-1', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'tp1', card: 'fireBoost', ends: FROM + 20 * H };
  const r = settle(earnBoard([onPost], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('tp2', 'cat', 'cat-1', 'fire', FROM + 5 * H)]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 5, 'tp1 only');
  const both = settle(earnBoard([onTom('g1', 'calmBoost', FROM + 2 * H), onTom('g3', 'fireBoost', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp1', 'cat', 'cat-1', 'fire', FROM + 5 * H),
  ]), cardsWorld);
  assert.equal(amountOf(both, 'tom-1', 'card.boost'), 1 + 5, 'the calm vote by 10%, the fire vote by 50%');
  assert.deepEqual(both.entries.filter((e) => e.reason === 'card.boost').map((e) => [e.params, e.amount]), [[{ card: 'calmBoost' }, 1], [{ card: 'fireBoost' }, 5]], 'one entry per card, each naming its own');
  assert.equal(both.details.filter((d) => d.reason === 'card.boost').reduce((s, d) => s + d.amount, 0), 6, 'the log\'s lines add up to the entries');
});
test('two Earn cards on different posts split each boost entry over its own card\'s posts alone', () => {
  const onPost = (id: string, card: string, target: string): InputAct => ({ id, character: 'tom-1', kind: 'card', at: FROM + 2 * H, thread: 't1', target, card, ends: FROM + 20 * H });
  const input = earnBoard([onPost('g1', 'calmBoost', 'tp1'), onPost('g2', 'fireBoost', 'tp2')], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp2', 'cat', 'cat-1', 'fire', FROM + 5 * H)]);
  const r = settle(input, cardsWorld);
  const boosts = r.entries.filter((e) => e.reason === 'card.boost');
  assert.equal(boosts.length, 2);
  const shares = shareEntries(input, cardsWorld, boosts).filter((x) => x.reason === 'card.boost');
  const postsOf = (card: string) => shares.filter((x) => x.amount === boosts.find((e) => e.params?.card === card)!.amount).map((x) => x.act);
  assert.deepEqual(postsOf('calmBoost'), ['tp1']);
  assert.deepEqual(postsOf('fireBoost'), ['tp2']);
  assert.equal(shares.length, 2, 'each entry lands on one post');
});
test('an earn gimmick play with no `ends` is malformed and boosts nothing', () => {
  const r = settle(earnBoard([onTom('g1', 'calmBoost', FROM + 2 * H, null)], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'kinded.nod'), 10);
  assert.equal(r.entries.filter((e) => e.reason === 'card.boost').length, 0);
});
test('a boost that rounds to nothing makes no card.boost entry', () => {
  const r = settle(earnBoard([onTom('g1', 'dustBoost', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.equal(r.entries.filter((e) => e.reason === 'card.boost').length, 0);
  assert.equal(r.details.filter((e) => e.reason === 'card.boost').length, 0);
});
test('the same card on a character and on one of its posts is one entry, each play boosting', () => {
  const onPost: InputAct = { id: 'g2', character: 'tom-1', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'tp1', card: 'calmBoost', ends: FROM + 20 * H };
  const r = settle(earnBoard([onTom('g1', 'calmBoost', FROM + 2 * H), onPost], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.deepEqual(r.entries.filter((e) => e.reason === 'card.boost').map((e) => [e.params, e.amount]), [[{ card: 'calmBoost' }, 2]]);
});
test('an earn gimmick played before the window, still up in it, boosts the window\'s earnings', () => {
  const r = settle(earnBoard([onTom('g1', 'calmBoost', FROM - 2 * H, FROM + 10 * H)], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp1', 'cat', 'cat-1', 'tea', FROM + 11 * H)]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 1, 'the vote before `ends` only');
});
test('an earn gimmick an admin ended is not in the input, so it boosts nothing', () => {
  const r = settle(earnBoard([], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 0);
});

/* Cards beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 6): a play on a character, a thread or a board has no target
   post to outdraw. Its own reactions pay its caster by class, as any Act's do; the class rules that read a card's target post pass
   it over; and it lands on nobody's posts. */
test('a play beyond a post is paid by its own reactions, and no class rule reads a target post for it', () => {
  seen.length = 0;
  const b = base();
  const input: SettlementInput = {
    ...b,
    acts: [
      ...b.acts,
      // Ann's Fan plays a character card on Bob's mask; its Act sits on q1, the post whose postbit took it, but it is no play on q1.
      { id: 'g1', character: 'ann-fan', kind: 'card', at: FROM + 7 * H, thread: 't1', reach: 'character', card: 'splat' },
      // Bob's Quiet plays one on a thread.
      { id: 'g2', character: 'bob-1', kind: 'card', at: FROM + 7 * H + 1, thread: 't1', reach: 'thread', card: 'splat' },
    ],
    reactions: [...b.reactions, react('g1', 'dee', 'dee-1', 'fire', FROM + 8 * H), react('g2', 'dee', 'dee-1', 'fire', FROM + 8 * H)],
  };
  const r = settle(input, instance);
  assert.equal(amountOf(r, 'ann-fan', 'fan.love'), amountOf(settle(base(), instance), 'ann-fan', 'fan.love') + 10, 'Dee\'s fire on the play pays its caster');
  assert.deepEqual(seen.filter((s) => s.character === 'bob-1').flatMap((s) => s.cardsPlayed), [], 'no target post to outdraw');
  assert.deepEqual(seen.flatMap((s) => s.cardsLanded), [], 'a character play lands on none of its character\'s posts');
  assert.ok(seen.find((s) => s.character === 'bob-1')!.received.some((x) => x.act === 'g2'), 'its reactions reach its caster\'s class');
});

test('a card with no target and no reach is still refused, not guessed at', () => {
  const b = base();
  assert.throws(() => settle({ ...b, acts: [...b.acts, { id: 'k9', character: 'bob-1', kind: 'card', at: FROM + 7 * H, thread: 't1', card: 'splat' }] }, instance), /has no target/);
});

/* ---- a character's standings, and the crowd a card drew (the Tweener plan, Task 1) ---- */

const noVote = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
const bySize = <T>(xs: readonly T[]) => [...xs].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
/** Every class input the spy was given, whatever character it was for. */
const spy = (key = 'quiet'): { rules: ClassRules; inputs: ClassInput[] } => {
  const inputs: ClassInput[] = [];
  return { inputs, rules: { key, name: key, earn: (i) => { inputs.push(i); return []; } } };
};
const standingOn = (inputs: readonly ClassInput[], act: string) => inputs.flatMap((i) => i.standings).find((s) => s.act === act);
const sugar = { key: 'sugar', name: 'Sugar', alignment: 'sweet' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };

test('a standing holds every other player\'s vote before the window and now, each at its weight', () => {
  const { rules, inputs } = spy('fan');
  const b = base();
  const earlier = post('e1', 'ann-fan', FROM - 10 * H);
  settle({
    ...b,
    acts: [...b.acts, earlier],
    reactions: [...b.reactions, react('e1', 'bob', 'bob-1', 'fire', FROM - 5 * H), react('e1', 'cat', 'cat-1', 'tomato', FROM + 2 * H)],
    paid: [{ player: 'bob', act: 'e1', weight: 1, shares: { ...noVote, excitedPositive: 1 } }],
  }, withClasses(rules));
  const s = standingOn(inputs, 'e1');
  assert.equal(s?.actKind, 'post');
  assert.equal(s?.at, FROM + 2 * H);
  assert.deepEqual(s?.before, [{ ...noVote, excitedPositive: 1 }]);
  assert.deepEqual(bySize(s?.now ?? []), bySize([{ ...noVote, excitedPositive: 1 }, { ...noVote, excitedNegative: 1 }]));
});

test('a player whose reactions on an Act are a fire and a tomato stands as half and half in one Standing', () => {
  const { rules, inputs } = spy();
  const b = base();
  settle({ ...b, acts: [...b.acts, post('x1', 'bob-1', FROM + 1 * H)], reactions: [...b.reactions, react('x1', 'cat', 'cat-1', 'fire', FROM + 5 * H), react('x1', 'cat', 'cat-1', 'tomato', FROM + 6 * H)] }, withClasses(rules));
  const s = standingOn(inputs, 'x1');
  assert.deepEqual(s?.before, []);
  assert.deepEqual(s?.now, [{ ...noVote, excitedPositive: 0.5, excitedNegative: 0.5 }]);
});

test('a halved vote stands at its halved weight', () => {
  const { rules, inputs } = spy('fan');
  settle(base(), withClasses(rules));
  // Bob voted on p1, then on the author's second Act p2, which weighs half.
  assert.deepEqual(standingOn(inputs, 'p2')?.now, [{ ...noVote, excitedPositive: 0.5 }]);
  assert.deepEqual(standingOn(inputs, 'p1')?.now.find((v) => v.excitedPositive === 1), { ...noVote, excitedPositive: 1 });
});

test('the author\'s own player\'s reactions are in no standing', () => {
  const { rules, inputs } = spy('fan');
  const b = base();
  settle({ ...b, acts: [...b.acts, post('x1', 'ann-fan', FROM + 1 * H)], reactions: [...b.reactions, react('x1', 'ann', 'ann-quiet', 'fire', FROM + 5 * H), react('p1', 'ann', 'ann-quiet', 'fire', FROM + 5 * H)] }, withClasses(rules));
  assert.equal(standingOn(inputs, 'x1'), undefined);
  assert.equal(standingOn(inputs, 'p1')?.now.length, 2);
});

test('the estimate sees two reactions by one player as two Standings at a whole vote each', () => {
  const { rules, inputs } = spy('fan');
  const b = base();
  estimateForOwner({ ...b, acts: [...b.acts, post('x1', 'ann-fan', FROM + 1 * H)], reactions: [...b.reactions, react('x1', 'cat', 'cat-1', 'fire', FROM + 5 * H), react('x1', 'cat', 'cat-1', 'tomato', FROM + 6 * H)] }, withClasses(rules), 'ann');
  assert.deepEqual(bySize(standingOn(inputs, 'x1')?.now ?? []), bySize([{ ...noVote, excitedPositive: 1 }, { ...noVote, excitedNegative: 1 }]));
});

/** Ann's post p1; Cat plays a card on it at FROM + 5H; Dee reacted before it; Bob and Eve first react after it. */
function crowd(): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'ann-1', player: 'ann', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'cat-1', player: 'cat', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'dee-1', player: 'dee', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'eve-1', player: 'eve', classes: [{ class: 'quiet', from: 0 }] },
    ],
    acts: [post('p1', 'ann-1', FROM + 1 * H), { id: 'k1', character: 'cat-1', kind: 'card', at: FROM + 5 * H, thread: 't1', target: 'p1', card: 'sugar' }],
    reactions: [
      react('p1', 'dee', 'dee-1', 'fire', FROM + 3 * H),
      react('p1', 'bob', 'bob-1', 'fire', FROM + 7 * H),
      react('p1', 'eve', 'eve-1', 'tomato', FROM + 9 * H),
      react('p1', 'dee', 'dee-1', 'tea', FROM + 10 * H),
      react('p1', 'cat', 'cat-1', 'fire', FROM + 11 * H),
    ],
  };
}
const crowdWorld = (rules: ClassRules): Instance => ({ ...withClasses(rules), cards: [...instance.cards, sugar] });
const playOf = (inputs: readonly ClassInput[], act: string) => inputs.flatMap((i) => i.cardsPlayed).find((c) => c.act === act)!;

test('a card draws the players whose first reaction came after it, at their vote now, and not one who reacted before and moved', () => {
  const { rules, inputs } = spy();
  settle(crowd(), crowdWorld(rules));
  const drawn = playOf(inputs, 'k1').drawnAfter;
  assert.equal(drawn?.at, FROM + 9 * H);
  assert.deepEqual(bySize(drawn?.now ?? []), bySize([{ ...noVote, excitedPositive: 1 }, { ...noVote, excitedNegative: 1 }]));
});

test('a second card by the same player on the same post, of another alignment, draws nothing', () => {
  const { rules, inputs } = spy();
  const b = crowd();
  settle({ ...b, acts: [...b.acts, { id: 'k2', character: 'cat-1', kind: 'card', at: FROM + 6 * H, thread: 't1', target: 'p1', card: 'splat' }] }, crowdWorld(rules));
  assert.notEqual(playOf(inputs, 'k1').drawnAfter, null);
  assert.equal(playOf(inputs, 'k2').drawnAfter, null);
});

test('a card nobody first reacted after draws nothing', () => {
  const { rules, inputs } = spy();
  const b = crowd();
  settle({ ...b, reactions: b.reactions.filter((r) => r.player === 'dee' || r.player === 'cat') }, crowdWorld(rules));
  assert.equal(playOf(inputs, 'k1').drawnAfter, null);
});

test('the estimate leaves the caster\'s own later reaction out of the crowd a card drew', () => {
  const { rules, inputs } = spy();
  estimateForOwner(crowd(), crowdWorld(rules), 'cat');
  const drawn = playOf(inputs, 'k1').drawnAfter;
  // Bob's fire, Eve's tomato and Dee's tea after the play (each estimate reaction is a voter of its own); Cat's own fire at 11H is not one.
  assert.deepEqual(bySize(drawn?.now ?? []), bySize([{ ...noVote, excitedPositive: 1 }, { ...noVote, excitedNegative: 1 }, { ...noVote, calmPositive: 1 }]));
});

test('a play held by the same player\'s earlier-window play, of any alignment, draws nothing', () => {
  const { rules, inputs } = spy();
  const b = crowd();
  settle({ ...b, acts: [b.acts[0]!, { id: 'k0', character: 'cat-1', kind: 'card', at: FROM - 5 * H, thread: 't1', target: 'p1', card: 'splat' }, b.acts[1]!] }, crowdWorld(rules));
  assert.equal(playOf(inputs, 'k1').drawnAfter, null);
});

test('the lists in a standing and a drawn crowd are in one order that names no player', () => {
  const { rules, inputs } = spy();
  settle(crowd(), crowdWorld(rules));
  const drawn = playOf(inputs, 'k1').drawnAfter!.now;
  assert.deepEqual(drawn, [{ ...noVote, excitedNegative: 1 }, { ...noVote, excitedPositive: 1 }]);
});
