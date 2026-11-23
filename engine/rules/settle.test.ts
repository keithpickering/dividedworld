import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCap, entryKey, estimateForOwner, lineKey, settle, shareEntries, type LedgerEntry } from './settle.ts';
import type { ClassInput, ClassRules, Quadrant, Earning, Instance, InputAct, InputReaction, SettlementInput } from './types.ts';
import { systemSettings, testCosmeticsContent, testSystem, testGroups } from './test-system.ts';

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
  system: testSystem, withdrawn: [],
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
    walletCap: 600, vote: 10, halving: 0.5, revealPerk: 0.2, debateDays: 3, reactionCap: 3, postEffects: 8, crowdPayEach: 2, crowdFloor: 2, crowdPayMost: 10, charactersPerPlayer: 6, settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', invitesPerPlayer: 3, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } }, hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
    settlementLength: { unit: 'day', count: 1 }, seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite', postMaxLength: 20000, pollOptionsMax: 10, pollQuestionMax: 200, pollOptionMax: 100, pollLastsMin: { unit: 'hour', count: 1 }, pollLastsMax: { unit: 'day', count: 14 }, titleMaxLength: 120, postsPerPage: 20, hotReplies: 10, searchLanguage: 'english', searchRankPool: 5000, cardSettings: {}, economy: { 'splat.price': 100 }, ...systemSettings,
  },
  ranks: [{ name: 'Rookie', from: 0 }], groups: testGroups, pipStyles: [{ key: 'default', name: 'Default', full: '●', empty: '○' }], boards: [{ slug: 'general', name: 'General', description: '' }],
  copy: { announcementsThreadTitle: 'S{season} Promos' },
  packs: [], machine: [], ...testCosmeticsContent,
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
    { ...splat, key: 'laughBoost', gimmick: { kind: 'earn', reactions: ['laughing'], by: 0.5 } },
    { ...splat, key: 'dustBoost', gimmick: { kind: 'earn', quadrants: ['calmPositive'], by: 1e-8 } },
    { ...splat, key: 'castBoost', reaches: ['character'] as const, gimmick: { kind: 'earn', quadrants: ['calmPositive'], by: 0.1 } },
    { ...splat, key: 'calmHalf', gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 0.5 } },
    { ...splat, key: 'calmHalfB', reaches: ['character'] as const, gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 0.5 } },
    { ...splat, key: 'calmWhole', gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 1 } },
    { ...splat, key: 'fireFlat', gimmick: { kind: 'earn', reactions: ['fire'], flat: 0.5 } },
    { ...splat, key: 'heartFlat', gimmick: { kind: 'earn', reactions: ['heart'], flat: 1 } },
    { ...splat, key: 'teaFlat', gimmick: { kind: 'earn', reactions: ['tea'], flat: 0.25 } },
    { ...splat, key: 'tomatoFlat', gimmick: { kind: 'earn', reactions: ['tomato'], flat: 0.5 } },
    { ...splat, key: 'heatFlat', gimmick: { kind: 'earn', quadrants: ['excitedPositive'], flat: 0.25 } },
    { ...splat, key: 'heatChillFlat', gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'boredNegative'], flat: 0.5 } },
    { ...splat, key: 'cardFlat', gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 0.5, acts: ['card', 'spring'] } },
    { ...splat, key: 'dustFlat', gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 1e-8 } },
    { ...splat, key: 'softCushion', gimmick: { kind: 'cushion', share: 0.5 } },
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

/* How the room took what a play is scored against (docs/plans/2026-11-18-face-thunder-plan.md, Task 1): "lens" records every card it
   played. The target is Eve's post `tp`, or a staff post, or the cast a Reversal's spring caught; Ann's two masks are the caster's
   player, so one's votes never count toward the lean of what the other's card is scored against. */
const lensPlays: ClassInput['cardsPlayed'][number][] = [];
const lens: ClassRules = { key: 'lens', name: 'Lens', earn: (input) => { lensPlays.push(...input.cardsPlayed); return []; } };
const lensWorld: Instance = {
  ...instance,
  classes: [...instance.classes, lens],
  cards: [
    ...instance.cards,
    { ...splat, key: 'sugar', alignment: 'sweet' },
    { ...splat, key: 'plain', alignment: 'pepperoni' },
    { ...splat, key: 'catch', play: 'set', trap: { trigger: { on: 'cast' } } },
  ],
};
function lensBoard(acts: InputAct[], reactions: InputReaction[], over: Partial<SettlementInput> = {}): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'ann-lens', player: 'ann', classes: [{ class: 'lens', from: 0 }] },
      { id: 'ann-quiet', player: 'ann', classes: [{ class: 'quiet', from: 0 }] },
      ...['bob', 'cat', 'dee', 'eve'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    acts,
    reactions,
    ...over,
  };
}
const playsOf = (input: SettlementInput, options?: Parameters<typeof settle>[2]) => { lensPlays.length = 0; settle(input, lensWorld, options); return [...lensPlays]; };
const onTp = (): InputAct[] => [post('tp', 'eve-1', FROM + 1 * H), { id: 'k1', character: 'ann-lens', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'tp', card: 'splat' }];

test('a play is handed how the room took its target: positive shares minus negative, each player one vote', () => {
  const lean = playsOf(lensBoard(onTp(), [react('tp', 'bob', 'bob-1', 'zzz', FROM + 3 * H), react('tp', 'cat', 'cat-1', 'zzz', FROM + 4 * H), react('tp', 'dee', 'dee-1', 'fire', FROM + 5 * H)]))[0]!.targetLean;
  assert.equal(lean, -1, 'two players booed it and one cheered');
});
test('the caster\'s own player\'s votes, from any mask, are left out of the target\'s lean', () => {
  const lean = playsOf(lensBoard(onTp(), [react('tp', 'bob', 'bob-1', 'zzz', FROM + 3 * H), react('tp', 'ann', 'ann-quiet', 'zzz', FROM + 4 * H)]))[0]!.targetLean;
  assert.equal(lean, -1, 'Ann booing from her other mask is not counted');
});
test('one player\'s heat and cheer on the target are half a vote each, and cancel', () => {
  const lean = playsOf(lensBoard(onTp(), [react('tp', 'bob', 'bob-1', 'tomato', FROM + 3 * H), react('tp', 'bob', 'bob-1', 'fire', FROM + 4 * H)]))[0]!.targetLean;
  assert.equal(lean, 0);
});
test('a target\'s lean reads every reaction up to the window\'s end, those before the window included', () => {
  const acts: InputAct[] = [post('tp', 'eve-1', FROM - 10 * H), onTp()[1]!];
  const lean = playsOf(lensBoard(acts, [react('tp', 'bob', 'bob-1', 'zzz', FROM - 5 * H), react('tp', 'cat', 'cat-1', 'zzz', FROM - 4 * H)]))[0]!.targetLean;
  assert.equal(lean, -2, 'no reaction reached it in the window');
});
test('a target nobody reacted to has a lean of 0', () => {
  assert.equal(playsOf(lensBoard(onTp(), []))[0]!.targetLean, 0);
});
test('a staff post\'s lean is read from its own reactions', () => {
  const acts: InputAct[] = [{ id: 'k1', character: 'ann-lens', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'boss', card: 'splat' }];
  const staff = { id: 'boss', kind: 'post' as const, at: FROM + 1 * H, thread: 't1', staff: true as const };
  const lean = playsOf(lensBoard(acts, [react('boss', 'bob', 'bob-1', 'zzz', FROM + 3 * H), react('boss', 'cat', 'cat-1', 'tomato', FROM + 4 * H)], { unscoredTargets: [staff] }))[0]!.targetLean;
  assert.equal(lean, -2);
});
test('with the shared vote off, each reaction is a vote of its own in the lean', () => {
  const reactions = [react('tp', 'bob', 'bob-1', 'zzz', FROM + 3 * H), react('tp', 'bob', 'bob-1', 'tomato', FROM + 4 * H), react('tp', 'bob', 'bob-1', 'zzz', FROM + 5 * H)];
  assert.equal(playsOf(lensBoard(onTp(), reactions))[0]!.targetLean, -1, 'settled: one player, one vote');
  assert.equal(playsOf(lensBoard(onTp(), reactions), { sharedVote: false, halving: false })[0]!.targetLean, -3, 'estimated: three reactions');
});
test('a spring that caught a cast is handed how that cast reads this window; a play on a post is handed none', () => {
  const springOn = (castCard: string, staffCard?: string) => {
    const acts: InputAct[] = [
      post('ap', 'ann-lens', FROM + 1 * H),
      ...(staffCard === undefined ? [{ id: 'cast', character: 'bob-1', kind: 'card' as const, at: FROM + 2 * H, thread: 't1', target: 'ap', card: castCard }] : []),
      { id: 'sp', character: 'ann-lens', kind: 'spring', at: FROM + 3 * H, thread: 't1', target: 'ap', card: 'catch', by: staffCard === undefined ? 'cast' : 'visit' },
    ];
    const unscoredTargets = staffCard === undefined ? [] : [{ id: 'visit', kind: 'post' as const, at: FROM + 1 * H, thread: 't1', staff: true as const, card: staffCard }];
    return playsOf(lensBoard(acts, staffCard === undefined ? [react('cast', 'cat', 'cat-1', 'tomato', FROM + 4 * H)] : [], { unscoredTargets })).find((c) => c.act === 'sp')!;
  };
  assert.equal(springOn('splat').targetReadsAs, 'salty', 'a Salty cast');
  assert.equal(springOn('sugar').targetReadsAs, 'sweet', 'a Sweet cast');
  assert.equal(springOn('plain').targetReadsAs, 'salty', 'a Pepperoni cast a third player booed');
  assert.equal(springOn('x', 'splat').targetReadsAs, 'salty', 'a staff cast keeps its own alignment');
  assert.equal(springOn('x', 'sugar').targetReadsAs, 'sweet');
  assert.ok(!('targetReadsAs' in springOn('x', 'plain')), 'a Pepperoni staff cast has no room to read it');
  assert.ok(!('targetReadsAs' in playsOf(lensBoard(onTp(), []))[0]!), 'a play on a post');
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
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.boost')!.params, { card: 'calmBoost', by: 0.1 });
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
/* A post-local reaction (Overreaction): its kind is not one of the instance's, so the row carries its own quadrant. */
const local = (act: string, player: string, character: string, kind: string, at: number, quadrant?: Quadrant): InputReaction => ({ ...react(act, player, character, kind, at), ...(quadrant ? { quadrant } : {}) });
test('a post-local reaction pays a Face as a fire does, and costs a Jabroni as a zzz does, by the quadrant it was sent with', () => {
  const run = (kind: string, quadrant?: Quadrant) => settle(earnBoard([], [local('tp1', 'bob', 'bob-1', kind, FROM + 5 * H, quadrant)]), cardsWorld);
  assert.equal(amountOf(run('x-1f480', 'excitedPositive'), 'tom-1', 'kinded.nod'), amountOf(run('fire'), 'tom-1', 'kinded.nod'), 'paid as a fire');
  assert.equal(amountOf(run('x-1f480', 'excitedPositive'), 'tom-1', 'kinded.nod'), 10);
  assert.equal(amountOf(run('x-1f480', 'boredNegative'), 'tom-1', 'kinded.groan'), amountOf(run('zzz'), 'tom-1', 'kinded.groan'), 'costs as a zzz');
  assert.equal(amountOf(run('x-1f480', 'boredNegative'), 'tom-1', 'kinded.groan'), -10);
});
test('the instance\'s map wins over a quadrant sent with one of its own kinds', () => {
  const run = (quadrant?: Quadrant) => settle(earnBoard([], [local('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H, quadrant)]), cardsWorld);
  assert.equal(amountOf(run('boredNegative'), 'tom-1', 'kinded.nod'), amountOf(run(), 'tom-1', 'kinded.nod'), 'paid as a fire does');
  assert.equal(amountOf(run('boredNegative'), 'tom-1', 'kinded.nod'), 10);
  assert.equal(amountOf(run('boredNegative'), 'tom-1', 'kinded.groan'), 0, 'not costed as a zzz');
});
test('the estimate\'s lift counts a post-local reaction by its sent quadrant', () => {
  const b = base();
  const input: SettlementInput = {
    ...b,
    characters: [...b.characters, { id: 'cat-thief', player: 'cat', classes: [{ class: 'thief', from: 0 }] }],
    acts: [...b.acts, { id: 'k1', character: 'cat-thief', kind: 'card', at: FROM + 3 * H + 30, thread: 't1', target: 'p1', card: 'splat' }],
    reactions: [local('p1', 'bob', 'bob-1', 'x-1f480', FROM + 5 * H, 'excitedPositive')],
  };
  const thunder = estimateForOwner(input, withClasses(thief), 'cat').lines.filter((l) => l.reason === 'thief.thunder');
  assert.deepEqual(thunder.map((l) => [l.act, l.at, l.amount]), [['k1', FROM + 5 * H, 10]], 'one line, at the local reaction\'s time');
});
test('a post-local reaction sent with no quadrant is an unknown kind, as before', () => {
  assert.throws(() => settle(earnBoard([], [local('tp1', 'bob', 'bob-1', 'x-1f480', FROM + 5 * H)]), cardsWorld), /reaction kind "x-1f480"/);
});
test('an earn gimmick naming a reaction leaves a post-local reaction of the same quadrant alone', () => {
  const r = settle(earnBoard([onTom('g1', 'laughBoost', FROM + 2 * H)], [local('tp1', 'bob', 'bob-1', 'x-1f480', FROM + 5 * H, 'excitedPositive')]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'kinded.nod'), 10);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 0);
});
test('a gimmick on a post raises that post\'s earnings alone, and two gimmicks each raise on their own', () => {
  const onPost: InputAct = { id: 'g2', character: 'tom-1', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'tp1', card: 'fireBoost', ends: FROM + 20 * H };
  const r = settle(earnBoard([onPost], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('tp2', 'cat', 'cat-1', 'fire', FROM + 5 * H)]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 5, 'tp1 only');
  const both = settle(earnBoard([onTom('g1', 'calmBoost', FROM + 2 * H), onTom('g3', 'fireBoost', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp1', 'cat', 'cat-1', 'fire', FROM + 5 * H),
  ]), cardsWorld);
  assert.equal(amountOf(both, 'tom-1', 'card.boost'), 1 + 5, 'the calm vote by 10%, the fire vote by 50%');
  assert.deepEqual(both.entries.filter((e) => e.reason === 'card.boost').map((e) => [e.params, e.amount]), [[{ card: 'calmBoost', by: 0.1 }, 1], [{ card: 'fireBoost', by: 0.5 }, 5]], 'one entry per card, each naming its own');
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
  assert.deepEqual(r.entries.filter((e) => e.reason === 'card.boost').map((e) => [e.params, e.amount]), [[{ card: 'calmBoost', by: 0.1 }, 2]]);
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

/* ---- skim, ride and scored-as (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 3) ----
   Test cards of the test world: a skim card (a tenth of a vote), a ride gimmick (half a vote), a ride trap (a whole vote) and a Salty
   one that is a play like any other. Each pays a character as no class's earning, under `card.skim` and `card.ride`. */
const skimmer: ClassRules = { key: 'skimmer', name: 'Skimmer', earn: () => [] };
const payWorld: Instance = {
  ...cardsWorld,
  classes: [...cardsWorld.classes, skimmer],
  cards: [
    ...cardsWorld.cards,
    { ...splat, key: 'mooch', skim: { share: 0.1 } },
    { ...splat, key: 'toll', gimmick: { kind: 'ride', share: 0.5 } },
    { ...splat, key: 'chess', play: 'set', trap: { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } }, catches: () => 'splat' },
    { ...splat, key: 'offday', scoresAs: true },
    { ...splat, key: 'cushion', play: 'set', trap: { trigger: { on: 'cast' }, match: { upTo: 'common' }, outcome: { kind: 'ride', share: 0.25, every: true } } },
  ],
};
const WHO = ['tom', 'ann', 'bob', 'cat', 'dee', 'eve', 'fay'];
/** Tom's post `tp`; every player has a mask `<player>-1` and Tom and Ann a second, `-2`, on the quiet class. */
function payBoard(acts: InputAct[], reactions: InputReaction[], extra: Partial<SettlementInput> = {}): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [...WHO.map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })), ...['tom', 'ann'].map((p) => ({ id: `${p}-2`, player: p, classes: [{ class: 'quiet', from: 0 }] }))],
    acts: [post('tp', 'tom-1', FROM + 1 * H), ...acts],
    reactions,
    ...extra,
  };
}
const mooch = (id: string, character: string, over: Partial<InputAct> = {}): InputAct => ({ id, character, kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'tp', card: 'mooch', quadrant: 'calmPositive', ends: FROM + 20 * H, ...over });
const sk = (r: ReturnType<typeof settle>, character: string) => amountOf(r, character, 'card.skim');

test('a skim pays its caster a tenth of a vote per vote in the named quadrant on another player\'s post, and the poster is paid as without it', () => {
  const votes = [react('tp', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp', 'cat', 'cat-1', 'tea', FROM + 6 * H), react('tp', 'dee', 'dee-1', 'fire', FROM + 7 * H)];
  const r = settle(payBoard([mooch('sk', 'ann-1')], votes), payWorld);
  assert.equal(sk(r, 'ann-1'), 2, 'two calm votes, a tenth of a vote (1) each; the fire pays nothing');
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.skim')!.params, { card: 'mooch' });
  assert.deepEqual(r.details.filter((d) => d.reason === 'card.skim').map((d) => [d.act, d.quadrant, d.at, d.amount]), [['tp', 'calmPositive', FROM + 5 * H, 1], ['tp', 'calmPositive', FROM + 6 * H, 1]]);
  assert.deepEqual(r.entries.filter((e) => e.character === 'tom-1'), settle(payBoard([], votes), payWorld).entries.filter((e) => e.character === 'tom-1'));
  assert.deepEqual(r.byClass, settle(payBoard([], votes), payWorld).byClass, 'a skim is in no class\'s total');
});
test('a skim pays nothing before the play, at or after its end, or from a player who reacted to the post before the play', () => {
  const r = settle(payBoard([mooch('sk', 'ann-1')], [
    react('tp', 'bob', 'bob-1', 'tea', FROM + 2 * H - 1),
    react('tp', 'cat', 'cat-1', 'tea', FROM + 20 * H),
    react('tp', 'dee', 'dee-1', 'tea', FROM + 2 * H - 2), react('tp', 'dee', 'dee-1', 'tea', FROM + 5 * H),
    react('tp', 'eve', 'eve-1', 'tea', FROM + 20 * H - 1),
  ]), payWorld);
  assert.equal(sk(r, 'ann-1'), 1, 'only Eve, who arrived after the play and before its end');
});
test('a vote that was there before the play and moves out takes nothing back', () => {
  const r = settle(payBoard([mooch('sk', 'ann-1')], [react('tp', 'bob', 'bob-1', 'tea', FROM + 1 * H + 1), react('tp', 'bob', 'bob-1', 'zzz', FROM + 6 * H)]), payWorld);
  assert.equal(sk(r, 'ann-1'), 0);
});
test('a vote that arrives and moves out in a later window takes back exactly what it paid', () => {
  const play = mooch('sk', 'ann-1', { ends: FROM + 100 * H });
  const first = settle(payBoard([play], [react('tp', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), payWorld);
  assert.equal(sk(first, 'ann-1'), 1);
  const second = settle(payBoard([play], [react('tp', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp', 'bob', 'bob-1', 'zzz', TO + 3 * H)], { window: { id: 'w2', from: TO, to: TO + 24 * H }, paid: first.paid }), payWorld);
  assert.equal(sk(second, 'ann-1'), -1, 'the whole of it comes back');
  assert.equal(sk(first, 'ann-1') + sk(second, 'ann-1'), 0, 'the play never costs more than it paid');
});
test('a skim played in an earlier window and still up pays this window\'s votes', () => {
  const r = settle(payBoard([mooch('sk', 'ann-1', { at: FROM - 10 * H, ends: FROM + 100 * H })], [react('tp', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), payWorld);
  assert.equal(sk(r, 'ann-1'), 1);
});
test('a skim on the caster\'s own player\'s post pays nothing, whichever mask; nor does the caster\'s own player\'s vote', () => {
  const votes = [react('tp', 'bob', 'bob-1', 'tea', FROM + 5 * H)];
  assert.equal(sk(settle(payBoard([mooch('sk', 'tom-2')], votes), payWorld), 'tom-2'), 0);
  const own = settle(payBoard([mooch('sk', 'ann-1')], [react('tp', 'ann', 'ann-2', 'tea', FROM + 5 * H), react('tp', 'cat', 'cat-1', 'tea', FROM + 6 * H)]), payWorld);
  assert.equal(sk(own, 'ann-1'), 1, 'Cat\'s vote only');
});
test('a skim with no quadrant or no end pays nothing, and neither does one on a staff post', () => {
  const votes = [react('tp', 'bob', 'bob-1', 'tea', FROM + 5 * H)];
  const { quadrant: _q, ...noQuadrant } = mooch('sk', 'ann-1');
  const { ends: _e, ...noEnd } = mooch('sk', 'ann-1');
  assert.equal(sk(settle(payBoard([noQuadrant], votes), payWorld), 'ann-1'), 0);
  assert.equal(sk(settle(payBoard([noEnd], votes), payWorld), 'ann-1'), 0);
  const staff = settle(payBoard([mooch('sk', 'ann-1', { target: 'visit1' })], [react('visit1', 'bob', 'bob-1', 'tea', FROM + 5 * H)], { unscoredTargets: [{ id: 'visit1', kind: 'post', at: FROM + 1 * H, thread: 't1', staff: true }] }), payWorld);
  assert.equal(sk(staff, 'ann-1'), 0);
});
test('two skims by two players on one post each pay their own caster', () => {
  const r = settle(payBoard([mooch('sk1', 'ann-1'), mooch('sk2', 'bob-1', { at: FROM + 2 * H + 1 })], [react('tp', 'cat', 'cat-1', 'tea', FROM + 5 * H), react('tp', 'dee', 'dee-1', 'tea', FROM + 6 * H)]), payWorld);
  assert.equal(sk(r, 'ann-1'), 2);
  assert.equal(sk(r, 'bob-1'), 2);
});

/** Tom's Toll (a ride gimmick) on his own post, Ann's cast on it, and the votes on the cast. */
const toll = (over: Partial<InputAct> = {}): InputAct => ({ id: 'rg', character: 'tom-1', kind: 'card', at: FROM + 2 * H, thread: 't1', target: 'tp', card: 'toll', ends: FROM + 20 * H, ...over });
const cast = (id = 'cast', character = 'ann-1', at = FROM + 3 * H): InputAct => ({ id, character, kind: 'card', at, thread: 't1', target: 'tp', card: 'splat' });
const ride = (r: ReturnType<typeof settle>, character: string) => amountOf(r, character, 'card.ride');

test('a ride gimmick pays half a vote per vote, in any quadrant, on another player\'s cast made while it was up', () => {
  const votes = [react('cast', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('cast', 'cat', 'cat-1', 'zzz', FROM + 6 * H)];
  const r = settle(payBoard([toll(), cast()], votes), payWorld);
  assert.equal(ride(r, 'tom-1'), 10, 'half a vote (5) each');
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.ride')!.params, { card: 'toll' });
  assert.deepEqual(r.details.filter((d) => d.reason === 'card.ride').map((d) => [d.act, d.quadrant, d.amount]).sort(), [['cast', 'boredNegative', 5], ['cast', 'excitedPositive', 5]]);
  assert.deepEqual(r.entries.filter((e) => e.character === 'ann-1'), settle(payBoard([cast()], votes), payWorld).entries.filter((e) => e.character === 'ann-1'), 'the caster is paid as without it');
});
test('a ride gimmick pays nothing for the author\'s own cast, own vote, a cast outside its time or a vote at its end', () => {
  const votes = [react('cast', 'bob', 'bob-1', 'fire', FROM + 5 * H)];
  assert.equal(ride(settle(payBoard([toll(), cast('cast', 'tom-2')], votes), payWorld), 'tom-1'), 0, 'a cast by the author\'s other mask');
  assert.equal(ride(settle(payBoard([toll(), cast()], [react('cast', 'tom', 'tom-2', 'fire', FROM + 5 * H), react('cast', 'cat', 'cat-1', 'fire', FROM + 6 * H)]), payWorld), 'tom-1'), 5, 'the author\'s own vote on the cast is Cat\'s alone');
  assert.equal(ride(settle(payBoard([toll(), cast('cast', 'ann-1', FROM + 2 * H - 1)], votes), payWorld), 'tom-1'), 0, 'a cast made before it');
  assert.equal(ride(settle(payBoard([toll({ ends: FROM + 10 * H }), cast('cast', 'ann-1', FROM + 12 * H)], votes), payWorld), 'tom-1'), 0, 'a cast made after it ended');
  assert.equal(ride(settle(payBoard([toll({ ends: FROM + 10 * H }), cast()], [react('cast', 'bob', 'bob-1', 'fire', FROM + 10 * H), react('cast', 'cat', 'cat-1', 'fire', FROM + 10 * H - 1)]), payWorld), 'tom-1'), 5, 'a vote at its end pays nothing');
});

test('a ride gimmick pays nothing for a cast made exactly when it ends', () => {
  const votes = [react('cast', 'bob', 'bob-1', 'fire', FROM + 3 * H - 1)];
  assert.equal(ride(settle(payBoard([toll({ ends: FROM + 3 * H }), cast()], votes), payWorld), 'tom-1'), 0, 'a cast made at its end');
});
test('a ride gimmick pays a cast made at the same instant it was played', () => {
  assert.equal(ride(settle(payBoard([toll({ at: FROM + 3 * H }), cast()], [react('cast', 'bob', 'bob-1', 'fire', FROM + 5 * H)]), payWorld), 'tom-1'), 5, 'a cast made at the instant it was played');
});

/** Tom's 4D Chess sprung by Ann's cast, setting the calm quadrant. */
const spring = (over: Partial<InputAct> = {}): InputAct => ({ id: 'sp', character: 'tom-1', kind: 'spring', at: FROM + 4 * H, thread: 't1', target: 'tp', card: 'chess', by: 'cast', quadrant: 'calmPositive', ...over });

test('a ride spring pays a whole vote per vote in its quadrant on the cast that sprang it, in this window and a later one', () => {
  const votes = [react('cast', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('cast', 'cat', 'cat-1', 'fire', FROM + 6 * H)];
  const r = settle(payBoard([cast(), spring()], votes), payWorld);
  assert.equal(ride(r, 'tom-1'), 10, 'the calm vote at a whole vote; the fire pays nothing');
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.ride')!.params, { card: 'chess' });
  const later = settle(payBoard([cast(), spring()], [...votes, react('cast', 'dee', 'dee-1', 'tea', TO + 2 * H)], { window: { id: 'w2', from: TO, to: TO + 24 * H } }), payWorld);
  assert.equal(ride(later, 'tom-1'), 10, 'a later window pays the votes it holds, with no end');
  assert.equal(ride(settle(payBoard([cast('cast', 'tom-2'), spring()], votes), payWorld), 'tom-1'), 0, 'a cast by the setter\'s own player');
});
test('an every ride spring with no quadrant pays a quarter of a vote per other player\'s vote in all four quadrants, and Ann keeps her own pay', () => {
  const { quadrant: _q, ...noQuadrant } = spring({ card: 'cushion' });
  const votes = [react('cast', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('cast', 'cat', 'cat-1', 'tea', FROM + 6 * H), react('cast', 'dee', 'dee-1', 'zzz', FROM + 7 * H), react('cast', 'eve', 'eve-1', 'tomato', FROM + 8 * H), react('cast', 'tom', 'tom-2', 'fire', FROM + 9 * H)];
  const r = settle(payBoard([cast(), noQuadrant], votes), payWorld);
  assert.equal(ride(r, 'tom-1'), 10, 'four votes by others at a quarter of a vote (2.5) each; Tom\'s own player\'s pays nothing');
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.ride')!.params, { card: 'cushion' });
  assert.equal(r.details.filter((d) => d.reason === 'card.ride').length, 4);
  assert.deepEqual(r.entries.filter((e) => e.character === 'ann-1'), settle(payBoard([cast()], votes), payWorld).entries.filter((e) => e.character === 'ann-1'), 'Ann is paid as without it');
  const est = estimateForOwner(payBoard([cast(), noQuadrant], votes), payWorld, 'tom').lines.filter((l) => l.reason === 'card.ride');
  assert.equal(est.length, 4, 'the estimate shows the same lines to Tom\'s player');
  assert.equal(est.reduce((n, l) => n + l.amount, 0), 10);
  assert.equal(ride(settle(payBoard([cast(), spring({ card: 'cushion' })], votes), payWorld), 'tom-1'), 10, 'a quadrant on an every ride\'s spring is not read');
});
test('a named ride spring pays only its quadrant, and one with no quadrant pays nothing', () => {
  const votes = [react('cast', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('cast', 'cat', 'cat-1', 'fire', FROM + 6 * H)];
  assert.equal(ride(settle(payBoard([cast(), spring()], votes), payWorld), 'tom-1'), 10, 'chess pays its calm vote only');
  const { quadrant: _q, ...noQuadrant } = spring();
  assert.equal(ride(settle(payBoard([cast(), noQuadrant], votes), payWorld), 'tom-1'), 0, 'a chess spring with no quadrant');
});
test('a ride spring pays nothing for a vote by the setter\'s own player, on another mask', () => {
  const r = settle(payBoard([cast(), spring()], [react('cast', 'tom', 'tom-2', 'tea', FROM + 5 * H), react('cast', 'bob', 'bob-1', 'tea', FROM + 6 * H)]), payWorld);
  assert.equal(ride(r, 'tom-1'), 10, 'only Bob\'s calm vote pays');
});
test('a ride spring is still scored as a play of its card on the cast: a Salty one that outdraws it steals thunder', () => {
  const salty = { ...payWorld, cards: payWorld.cards.map((c) => (c.key === 'chess' ? { ...c, alignment: 'salty' as const } : c)) };
  const input = payBoard([cast(), spring()], [react('cast', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('sp', 'cat', 'cat-1', 'fire', FROM + 5 * H), react('sp', 'dee', 'dee-1', 'fire', FROM + 6 * H)]);
  const r = settle({ ...input, characters: input.characters.map((c) => (c.id === 'tom-1' ? { ...c, classes: [{ class: 'snatcher', from: 0 }] } : c)) }, salty);
  assert.equal(amountOf(r, 'tom-1', 'snatcher.stole'), 20);
  assert.equal(ride(r, 'tom-1'), 10);
});
test('a post with a ride gimmick and a ride spring pays one entry per card, and each is shared over its own Acts', () => {
  const input = payBoard([toll(), cast('c1'), cast('c2', 'ann-1', FROM + 3 * H + 1), spring({ by: 'c1' })], [
    react('c1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('c2', 'cat', 'cat-1', 'tea', FROM + 5 * H),
  ]);
  const r = settle(input, payWorld);
  const entries = r.entries.filter((e) => e.reason === 'card.ride');
  assert.deepEqual(entries.map((e) => [e.params, e.amount]), [[{ card: 'chess' }, 10], [{ card: 'toll' }, 10]]);
  const shares = shareEntries(input, payWorld, r.entries).filter((s) => s.reason === 'card.ride');
  assert.deepEqual(shares.map((s) => [s.params, s.act, s.amount]).sort(), [[{ card: 'chess' }, 'c1', 10], [{ card: 'toll' }, 'c1', 5], [{ card: 'toll' }, 'c2', 5]]);
});

test('a character named in scoredAs earns the named class\'s reasons for the whole window, and none of its own', () => {
  const input = payBoard([post('ap', 'ann-1', FROM + 3 * H), post('ap2', 'ann-1', FROM + 12 * H)], [react('ap', 'bob', 'bob-1', 'fire', FROM + 5 * H)], { scoredAs: [{ character: 'ann-1', class: 'fan', play: 'od' }] });
  const r = settle(input, payWorld);
  assert.equal(amountOf(r, 'ann-1', 'fan.love'), 10);
  assert.equal(amountOf(r, 'ann-1', 'quiet.post'), 0);
  assert.equal(amountOf(r, 'bob-1', 'quiet.post'), 0, 'bob posted nothing');
  assert.deepEqual(r.byClass, { fan: 10, quiet: amountOf(r, 'tom-1', 'quiet.post') + amountOf(r, 'tom-2', 'quiet.post') }, 'under the named class');
  assert.equal(amountOf(settle({ ...input, scoredAs: [] }, payWorld), 'ann-1', 'quiet.post'), 14, 'a character not named is untouched');
});
test('a character scored as a class that Turned inside the window is that class throughout; an unknown class throws', () => {
  const turned = (scoredAs: SettlementInput['scoredAs']): SettlementInput => {
    const input = payBoard([post('ap', 'ann-1', FROM + 3 * H), post('ap2', 'ann-1', FROM + 12 * H)], [react('ap2', 'bob', 'bob-1', 'fire', FROM + 13 * H)], { scoredAs });
    return { ...input, characters: input.characters.map((c) => (c.id === 'ann-1' ? { ...c, classes: [{ class: 'fan', from: 0 }, { class: 'quiet', from: FROM + 10 * H }] } : c)) };
  };
  const r = settle(turned([{ character: 'ann-1', class: 'quiet', play: 'od' }]), payWorld);
  assert.equal(amountOf(r, 'ann-1', 'quiet.post'), 14, 'both posts are the named class\'s');
  assert.equal(amountOf(r, 'ann-1', 'fan.love'), 0);
  assert.equal(amountOf(settle(turned(undefined), payWorld), 'ann-1', 'fan.love'), 0, 'unnamed, the fire on the later post is the quiet stretch\'s and pays nothing');
  assert.equal(amountOf(settle(turned([{ character: 'ann-1', class: 'fan', play: 'od' }]), payWorld), 'ann-1', 'fan.love'), 10, 'named a class it Turned from, the whole window is that class');
  assert.throws(() => settle(turned([{ character: 'ann-1', class: 'nope', play: 'od' }]), payWorld), /nope/);
});
test('card payouts are in no class\'s total, the log adds up to the entries, and the order of the input changes nothing', () => {
  const input = payBoard([mooch('sk', 'ann-1'), toll(), cast('c1', 'bob-1'), cast('c2', 'ann-1', FROM + 3 * H + 1), spring({ by: 'c2', character: 'cat-1' }), post('ap', 'ann-2', FROM + 3 * H)], [
    react('tp', 'dee', 'dee-1', 'tea', FROM + 5 * H), react('tp', 'eve', 'eve-1', 'tea', FROM + 6 * H),
    react('c1', 'dee', 'dee-1', 'fire', FROM + 5 * H), react('c1', 'eve', 'eve-1', 'tea', FROM + 6 * H), react('c2', 'fay', 'fay-1', 'tea', FROM + 6 * H), react('c2', 'dee', 'dee-1', 'tea', FROM + 6 * H),
    react('ap', 'fay', 'fay-1', 'fire', FROM + 7 * H),
  ], { scoredAs: [{ character: 'ann-2', class: 'fan', play: 'od' }] });
  const r = settle(input, payWorld);
  const paid = r.entries.filter((e) => e.reason.startsWith('card.'));
  assert.ok(paid.length >= 3, 'a skim, a ride gimmick and a ride spring were all paid');
  const total = r.entries.reduce((s, e) => s + e.amount, 0);
  assert.equal(Object.values(r.byClass).reduce((s, x) => s + x, 0), total - paid.reduce((s, e) => s + e.amount, 0), 'no payout in byClass');
  for (const e of r.entries) assert.equal(r.details.filter((d) => d.character === e.character && d.reason === e.reason && d.params?.card === e.params?.card).reduce((s, d) => s + d.amount, 0), e.amount, `${e.character} ${e.reason}`);
  const shuffled: SettlementInput = { ...input, characters: [...input.characters].reverse(), acts: [...input.acts].reverse(), reactions: [...input.reactions].reverse() };
  assert.deepEqual(settle(shuffled, payWorld), r);
});

/* Earns that do not add, and an earn a cast card carries (docs/plans/2026-11-11-card-notes-part-4-plan.md, Task 1). */
const castOn = (id: string, character: string, card: string, at: number, on: string, ends: number = FROM + 20 * H): InputAct => ({ id, character, kind: 'card', at, thread: 't1', card, reach: 'character', on, ends });
test('a cast earn on another player\'s character boosts that character\'s earnings, by the target\'s player, and pays the caster nothing', () => {
  const r = settle(earnBoard([castOn('g1', 'bob-1', 'castBoost', FROM + 2 * H, 'tom-1', FROM + 10 * H)], [
    react('tp1', 'cat', 'cat-1', 'tea', FROM + 5 * H),
    react('tp1', 'dee', 'dee-1', 'tea', FROM + 12 * H),
  ]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 1, 'inside [at, ends) only');
  const boost = r.entries.find((e) => e.reason === 'card.boost')!;
  assert.equal(boost.player, 'tom');
  assert.deepEqual(boost.params, { card: 'castBoost', by: 0.1 });
  assert.equal(r.entries.filter((e) => e.player === 'bob' && e.reason === 'card.boost').length, 0, 'the caster is paid nothing for it');
});
/* The flat Earn (docs/plans/2026-11-16-settlement-engine-plan.md, Task 2): a share of a vote for each vote, to any class, on posts unless the
   card names `acts`. The test classes: "kinded" gains from every quadrant but a groan and loses from a groan, "quiet" pays nothing for a vote. */
function flatBoard(gimmicks: InputAct[], reactions: InputReaction[], extra: InputAct[] = [], over: Partial<SettlementInput> = {}): SettlementInput {
  return {
    window: { id: 'w1', from: FROM, to: TO },
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: 'kinded', from: 0 }] },
      { id: 'tom-2', player: 'tom', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'uma-1', player: 'uma', classes: [{ class: 'quiet', from: 0 }] },
      ...['bob', 'cat', 'dee', 'eve', 'fay'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    acts: [post('tp1', 'tom-1', FROM + 1 * H), post('tp2', 'tom-1', FROM + 1 * H + 1), post('up1', 'uma-1', FROM + 1 * H), ...extra, ...gimmicks],
    reactions,
    ...over,
  };
}
const onUma = (id: string, card: string, at: number, ends = FROM + 20 * H): InputAct => ({ ...onTom(id, card, at, ends), character: 'uma-1', on: 'uma-1' });
const onPostBy = (id: string, character: string, card: string, target: string, at: number, ends = FROM + 20 * H): InputAct => ({ id, character, kind: 'card', at, thread: 't1', target, card, ends });
const boostsOf = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.reason === 'card.boost');
const boostTo = (r: ReturnType<typeof settle>, character: string) => amountOf(r, character, 'card.boost');

test('a flat earn pays its share of a vote for a vote in its quadrant to a class that gains there, one that loses there and one that ignores it, the same each', () => {
  const r = settle(flatBoard([onTom('g1', 'heatChillFlat', FROM + 2 * H), onUma('g2', 'heatChillFlat', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H), react('up1', 'dee', 'dee-1', 'fire', FROM + 5 * H),
  ]), cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'kinded.nod'), 10, 'tom gains from the fire');
  assert.equal(amountOf(r, 'tom-1', 'kinded.groan'), -10, 'and loses from the groan');
  assert.deepEqual(r.details.filter((d) => d.character === 'tom-1' && d.reason === 'card.boost').map((d) => d.amount), [5, 5], 'half a vote (5) each, the gain and the loss alike');
  assert.equal(boostTo(r, 'tom-1'), 10);
  assert.equal(boostTo(r, 'uma-1'), 5, 'a class that ignores a vote is paid the same');
});
test('a flat earn on a second Act of the window from one voter pays half, and the estimate pays whole', () => {
  const input = flatBoard([onTom('g1', 'calmWhole', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp2', 'bob', 'bob-1', 'tea', FROM + 6 * H)]);
  assert.equal(boostTo(settle(input, cardsWorld), 'tom-1'), 10 + 5, 'a whole vote, then half of one');
  const estimate = estimateForOwner(input, cardsWorld, 'tom');
  assert.equal(estimate.entries.filter((e) => e.reason === 'card.boost').reduce((s, e) => s + e.amount, 0), 20, 'each reaction a whole vote');
  assert.equal(estimate.lines.filter((l) => l.reason === 'card.boost').reduce((s, l) => s + l.amount, 0), 20);
});
test('a flat earn that names a reaction kind: one player leaving a heart then a fire is one voter in the settlement (first kind, the heart, pays nothing) and two in the estimate (the fire is its own voter and pays)', () => {
  const input = flatBoard([onTom('g1', 'fireFlat', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'heart', FROM + 5 * H), react('tp1', 'bob', 'bob-1', 'fire', FROM + 6 * H)]);
  const lines = estimateForOwner(input, cardsWorld, 'tom').lines.filter((l) => l.reason === 'card.boost');
  assert.deepEqual(lines.map((l) => [l.at, l.amount]), [[FROM + 6 * H, 5]], 'in the estimate each reaction is a voter of its own: the fire is paid whole at its own time and the heart nothing');
  assert.equal(boostTo(settle(input, cardsWorld), 'tom-1'), 0, 'the settlement is exact: the voter first kind in the quadrant is the heart, so the fire is not paid');
});
test('a flat earn pays nothing outside its time, at its end, in a quadrant it does not name, with no `ends`, or for the character\'s own player', () => {
  const one = (r: InputReaction, ends: number | null = FROM + 10 * H) => boostTo(settle(flatBoard([onTom('g1', 'calmHalf', FROM + 2 * H, ends)], [r]), cardsWorld), 'tom-1');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)), 5, 'inside it');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'tea', FROM + 2 * H - 1)), 0, 'before it');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'tea', FROM + 10 * H)), 0, 'at its end');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'tea', FROM + 12 * H)), 0, 'after it');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H)), 0, 'a quadrant it does not name');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), null), 0, 'a play with no `ends`');
  assert.equal(one(react('tp1', 'tom', 'tom-2', 'tea', FROM + 5 * H)), 0, 'the character\'s own player');
});
test('a flat earn that names a reaction pays it and leaves another of its quadrant and a post-local one alone', () => {
  const r = settle(flatBoard([onTom('g1', 'fireFlat', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H),
    react('tp2', 'cat', 'cat-1', 'heart', FROM + 5 * H),
    local('tp1', 'dee', 'dee-1', 'x-1f480', FROM + 5 * H, 'excitedPositive'),
  ]), cardsWorld);
  assert.equal(boostTo(r, 'tom-1'), 5, 'the fire alone');
});
test('with no `acts` a flat earn pays on a post and a spin and not on the character\'s card Act; with `acts` it pays on a card Act and a spring Act and not on a post', () => {
  const extra: InputAct[] = [
    { id: 'sn', character: 'tom-1', kind: 'spin', at: FROM + 1 * H + 3, thread: 's1' },
    { id: 'ck', character: 'tom-1', kind: 'card', at: FROM + 1 * H + 4, thread: 't1', target: 'tp1', card: 'splat' },
    { id: 'sg', character: 'tom-1', kind: 'spring', at: FROM + 1 * H + 5, thread: 't1', target: 'tp1', card: 'splat' },
  ];
  const votes = [react('tp1', 'dee', 'dee-1', 'tea', FROM + 5 * H), react('sn', 'eve', 'eve-1', 'tea', FROM + 5 * H), react('ck', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('sg', 'cat', 'cat-1', 'tea', FROM + 5 * H)];
  const posts = settle(flatBoard([onTom('g1', 'calmWhole', FROM + 2 * H)], votes, extra), cardsWorld);
  assert.deepEqual(posts.details.filter((d) => d.reason === 'card.boost').map((d) => [d.act, d.amount]).sort(), [['sn', 10], ['tp1', 10]], 'the post and the spin');
  const cards = settle(flatBoard([onTom('g1', 'cardFlat', FROM + 2 * H)], votes, extra), cardsWorld);
  assert.deepEqual(cards.details.filter((d) => d.reason === 'card.boost').map((d) => [d.act, d.amount]).sort(), [['ck', 5], ['sg', 5]], 'the card Act and the spring Act');
});
test('a voter who first reacted before the play is never paid for, though they add a reaction in its quadrant while it is up', () => {
  const r = settle(flatBoard([onTom('g1', 'heatChillFlat', FROM + 2 * H)], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 1 * H + 10), react('tp1', 'bob', 'bob-1', 'heart', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'heart', FROM + 5 * H),
  ]), cardsWorld);
  assert.equal(boostTo(r, 'tom-1'), 5, 'Cat alone');
});
test('a vote paid in one window that splits to another quadrant in the next, while the play is up, takes back that share\'s pay', () => {
  const play = onTom('g1', 'calmWhole', FROM + 2 * H, FROM + 100 * H);
  const first = settle(flatBoard([play], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.equal(boostTo(first, 'tom-1'), 10);
  const second = settle(flatBoard([play], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp1', 'bob', 'bob-1', 'tomato', TO + 3 * H)], [], { window: W2, paid: first.paid }), cardsWorld);
  assert.equal(boostTo(second, 'tom-1'), -5, 'half the vote left the calm quadrant');
  assert.ok(boostTo(first, 'tom-1') + boostTo(second, 'tom-1') >= 0, 'the play never costs its holder');
});
test('a vote that moves away after the play ended takes back nothing, and one that was there before the play never paid', () => {
  const ended = onTom('g1', 'calmWhole', FROM + 2 * H, FROM + 10 * H);
  const first = settle(flatBoard([ended], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  const second = settle(flatBoard([ended], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H), react('tp1', 'bob', 'bob-1', 'tomato', TO + 3 * H)], [], { window: W2, paid: first.paid }), cardsWorld);
  assert.equal(boostTo(first, 'tom-1'), 10);
  assert.equal(boostTo(second, 'tom-1'), 0, 'the play had ended');
  const up = onTom('g1', 'calmWhole', FROM + 2 * H, FROM + 100 * H);
  const early = settle(flatBoard([up], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 1 * H + 10)]), cardsWorld);
  const moved = settle(flatBoard([up], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 1 * H + 10), react('tp1', 'bob', 'bob-1', 'tomato', TO + 3 * H)], [], { window: W2, paid: early.paid }), cardsWorld);
  assert.equal(boostTo(early, 'tom-1') + boostTo(moved, 'tom-1'), 0, 'a vote there before the play was never paid and takes nothing back');
});
test('over many seeded sequences of windows, flat earns that name quadrants or reactions never cost the character: all its boost entries sum to zero or more, in the whole and after every window', () => {
  // A tiny LCG, so every run draws the same few hundred sequences.
  // Its first outputs of nearby seeds are correlated (seeds 1 to 400 span a narrow band of the first), so each seed's generator discards its first few.
  const lcg = (seed: number) => { let s = seed >>> 0; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; for (let i = 0; i < 8; i++) next(); return next; };
  const WINDOWS = 5;
  const voters = ['bob', 'cat', 'dee', 'eve', 'fay'];
  // The hot quadrant's two kinds are drawn twice as often, so a voter often leaves two kinds of one quadrant, which is where a kind-named play and a quadrant-named one part.
  const kinds = ['tea', 'tomato', 'fire', 'heart', 'fire', 'heart', 'tea', 'zzz'];
  const named = ['calmWhole', 'heatChillFlat', 'heatFlat', 'calmHalf'];
  const kinded = ['fireFlat', 'heartFlat', 'teaFlat', 'tomatoFlat'];
  // A vote of 1440 makes every amount a whole number, and the test asserts that, so the bound is exact and no tolerance is allowed: a share of a vote is a fraction with a denominator
  // that divides 60 (one to six reactions on a post, a fifth and a sixth of a vote), halving weight (a whole, a half) times flat (a quarter, a half, a whole) is a multiple of an eighth, and 60 times 8 divides 1440.
  // A loss of any size, even one hundredth, fails.
  const exact: Instance = { ...cardsWorld, settings: { ...cardsWorld.settings, vote: 1440 } };
  let withTakeBack = 0;
  let withEarlyFirst = 0;
  let withManyVoters = 0;
  let withHot = 0;
  let wide = 0;
  let wideTakeBack = 0;
  let wideKindedCrowd = 0;
  let wideEarlyFirst = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rand = lcg(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
    // Every third seed is hot, so exactly a third of the sequences are: the quarter-vote play of the hot quadrant beside a kind-named play of it, one voter on one post who first reacts early in the hot quadrant and then reacts again,
    // each time most often a window later, which is where a take-back can be priced by another play than the one that paid. The rest are wide: up to five voters on two posts, plays that start anywhere
    // and last a few hours or days, and first reactions before, inside and after the plays; any play may name quadrants or reaction kinds.
    const hot = seed % 3 === 0;
    if (hot) withHot++; else wide++;
    const plays: InputAct[] = [];
    const reactions: InputReaction[] = [];
    if (hot) {
      const aAt = FROM + int(0, 8) * H;
      const mode = int(0, 3);
      if (mode !== 1) plays.push(onTom('gA', 'heatFlat', aAt, aAt + int(60, 200) * H));
      if (mode !== 0) {
        const bAt = FROM + int(0, 8) * H;
        const bEnds = bAt + int(60, 200) * H;
        const card = pick(['fireFlat', 'heartFlat']);
        plays.push(rand() < 0.5 ? onPostBy('gB', 'tom-1', card, pick(['tp1', 'tp2']), bAt, bEnds) : onTom('gB', card, bAt, bEnds));
      }
      if (mode === 3) {
        const cAt = FROM + int(0, 8) * H;
        plays.push(onTom('gC', pick(kinded), cAt, cAt + int(60, 200) * H));
      }
      let at = FROM + int(9, 14) * H + int(0, 59) * 60_000;
      for (let n = pick([1, 2, 3, 5, 6]); n > 0; n--) {
        reactions.push(react('tp1', 'bob', 'bob-1', pick(['heart', 'fire', 'tea', 'tomato']), at));
        at += int(15, 40) * H + int(0, 59) * 60_000;
      }
    } else {
      // One flat earn on the character, and (usually) a second of another size on a post or the character, overlapping in part, each of a quadrant or of a kind.
      const aAt = FROM + int(0, 70) * H;
      plays.push(onTom('gA', pick([...named, ...kinded]), aAt, aAt + int(3, 80) * H));
      if (rand() < 0.8) {
        const bAt = FROM + int(0, 70) * H;
        const bEnds = bAt + int(3, 80) * H;
        const card = pick([...named, ...kinded]);
        plays.push(rand() < 0.5 ? onPostBy('gB', 'tom-1', card, pick(['tp1', 'tp2']), bAt, bEnds) : onTom('gB', card, bAt, bEnds));
      }
      for (const p of voters) {
        for (const act of ['tp1', 'tp2']) {
          if (rand() < 0.35) continue;
          let at = FROM + int(0, WINDOWS * 24 - 30) * H + int(0, 59) * 60_000;
          for (let n = int(1, 3); n > 0; n--) {
            reactions.push(react(act, p, `${p}-1`, pick(kinds), at));
            at += int(1, 40) * H + int(0, 59) * 60_000;
          }
        }
      }
    }
    // The guard counts: a voter whose first reaction on an Act is before a play started, and three or more voters.
    const firstOf = new Map<string, number>();
    for (const r of reactions) firstOf.set(`${r.act}|${r.player}`, Math.min(firstOf.get(`${r.act}|${r.player}`) ?? Infinity, r.at));
    const earlyFirst = [...firstOf.values()].some((first) => plays.some((g) => first < g.at));
    const manyVoters = new Set(reactions.map((r) => r.player)).size >= 3;
    const hasKinded = plays.some((g) => kinded.includes(g.card ?? ''));
    if (earlyFirst) withEarlyFirst++;
    if (manyVoters) withManyVoters++;
    if (!hot && earlyFirst) wideEarlyFirst++;
    if (!hot && hasKinded && manyVoters) wideKindedCrowd++;
    const windows = [...Array(WINDOWS)].map((_, k) => ({ id: `w${k}`, from: FROM + k * 24 * H, to: FROM + (k + 1) * 24 * H }));
    const paidSoFar = new Map<string, SettlementInput['paid'] extends readonly (infer P)[] | undefined ? P : never>();
    let all = 0;
    let sawNegative = false;
    for (const [k, window] of windows.entries()) {
      const r = settle(flatBoard(plays, reactions, [], { window, paid: [...paidSoFar.values()] }), exact);
      for (const p of r.paid) paidSoFar.set(`${p.player}|${p.act}`, p);
      for (const e of boostsOf(r)) {
        assert.equal(e.character, 'tom-1');
        assert.ok(Number.isInteger(e.amount), `seed ${seed}: an amount of ${e.amount} is rounded, so the bound is not exact`);
        all += e.amount;
        if (e.amount < 0) sawNegative = true;
      }
      assert.ok(all >= 0, `seed ${seed}: after window ${k} the plays have cost the character ${all}`);
    }
    assert.ok(all >= 0, `seed ${seed}: the plays cost the character ${all}`);
    // One play's own lines can sum below zero (the next test), so only the character's boosts as a whole are held to the bound.
    if (sawNegative) withTakeBack++;
    if (sawNegative && !hot) wideTakeBack++;
  }
  assert.ok(withTakeBack >= 20, `the draws must include take-backs (${withTakeBack}), or the property is not tested`);
  assert.ok(withEarlyFirst >= 40, `the draws must include a first reaction before a play (${withEarlyFirst}), or the gate is not tested`);
  assert.ok(withManyVoters >= 80, `the draws must include three or more voters (${withManyVoters}), or crowds are not tested`);
  assert.ok(withHot >= 80, `the draws must include hot sequences (${withHot})`);
  assert.ok(wide >= 200, `the draws must include wide sequences (${wide})`);
  assert.ok(wideTakeBack >= 15, `the wide draws must include take-backs (${wideTakeBack})`);
  assert.ok(wideKindedCrowd >= 100, `the wide draws must include a kind-named play with three or more voters (${wideKindedCrowd})`);
  assert.ok(wideEarlyFirst >= 150, `the wide draws must include a first reaction before a play (${wideEarlyFirst})`);
});
test('a take-back falls on the largest play still up, so one play\'s lines can sum below zero while the character\'s never do', () => {
  // A vote of 400, so that no amount rounds. The larger play (heatChillFlat, a half) ends at +10h; the smaller (heatFlat, a quarter) stays up. Bob first reacts while both are up.
  const bigVote: Instance = { ...cardsWorld, settings: { ...cardsWorld.settings, vote: 400 } };
  const larger = onTom('big', 'heatChillFlat', FROM + 2 * H, FROM + 10 * H);
  const smaller = onTom('small', 'heatFlat', FROM + 2 * H, FROM + 100 * H);
  const first = settle(flatBoard([larger, smaller], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H)]), bigVote);
  const second = settle(flatBoard([larger, smaller], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('tp1', 'bob', 'bob-1', 'tomato', TO + 3 * H)], [], { window: W2, paid: first.paid }), bigVote);
  const by = (card: string) => [first, second].flatMap((r) => boostsOf(r).filter((e) => (e.params as { card: string }).card === card)).reduce((t, e) => t + e.amount, 0);
  assert.deepEqual([boostTo(first, 'tom-1'), boostTo(second, 'tom-1')], [200, -50], 'paid under the larger play, taken back under the smaller one that is still up');
  assert.equal(by('heatChillFlat'), 200);
  assert.equal(by('heatFlat'), -50);
  assert.ok(by('heatFlat') < 0 && by('heatChillFlat') > 0, 'one play\'s lines sum below zero');
  assert.equal(by('heatChillFlat') + by('heatFlat'), 150);
  assert.ok(boostTo(first, 'tom-1') + boostTo(second, 'tom-1') > 0, 'the character\'s boosts as a whole are above zero');
});
/* A play that names a reaction kind applies to a vote line by the kind of the voter's FIRST reaction in the line's quadrant on that Act, which never
   changes (a reaction cannot be removed). So a line applies the same way when it is paid and when it is taken back, and no play takes back what it
   did not pay. */
const bigVote1200: Instance = { ...cardsWorld, settings: { ...cardsWorld.settings, vote: 1200 } };
const W3 = { id: 'wed', from: TO + 24 * H, to: TO + 48 * H };
test('a flat earn that names a reaction kind applies by the voter\'s first reaction in the quadrant, so it never takes back what it did not pay', () => {
  const play = onTom('g1', 'fireFlat', FROM + 2 * H, FROM + 100 * H);
  const heart = react('tp1', 'bob', 'bob-1', 'heart', FROM + 5 * H);
  const fire = react('tp1', 'bob', 'bob-1', 'fire', TO + 3 * H);
  const away = react('tp1', 'bob', 'bob-1', 'tomato', TO + 24 * H + 3 * H);
  const one = settle(flatBoard([play], [heart]), bigVote1200);
  const two = settle(flatBoard([play], [heart, fire], [], { window: W2, paid: one.paid }), bigVote1200);
  const three = settle(flatBoard([play], [heart, fire, away], [], { window: W3, paid: two.paid }), bigVote1200);
  assert.deepEqual([one, two, three].map((r) => boostTo(r, 'tom-1')), [0, 0, 0], 'the first reaction there was a heart, not the fire the play names: nothing paid, so nothing taken back');
});
test('a flat earn that names a reaction kind prices a take-back by the play that paid it: paid on the first kind, then another kind of the quadrant, then another quadrant', () => {
  const play = onTom('g1', 'fireFlat', FROM + 2 * H, FROM + 100 * H);
  const fire = react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H);
  const heart = react('tp1', 'bob', 'bob-1', 'heart', TO + 3 * H);
  const away = react('tp1', 'bob', 'bob-1', 'tomato', TO + 24 * H + 3 * H);
  const one = settle(flatBoard([play], [fire]), bigVote1200);
  const two = settle(flatBoard([play], [fire, heart], [], { window: W2, paid: one.paid }), bigVote1200);
  const three = settle(flatBoard([play], [fire, heart, away], [], { window: W3, paid: two.paid }), bigVote1200);
  assert.deepEqual([one, two, three].map((r) => boostTo(r, 'tom-1')), [600, 0, -200], 'a half of 1200 paid; the heart is the same quadrant as the fire, so no share moves and the amount is 0; the tomato takes back a third of it');
  assert.ok(boostTo(one, 'tom-1') + boostTo(two, 'tom-1') + boostTo(three, 'tom-1') >= 0);
});
test('a quadrant-named earn and a kind-named earn on one character never leave it below zero (heart, then fire, then six teas)', () => {
  // A vote of 1440, so that no amount rounds: shares of a half and an eighth, flats of a quarter and a half.
  const vote: Instance = { ...cardsWorld, settings: { ...cardsWorld.settings, vote: 1440 } };
  const plays = [onTom('quad', 'heatFlat', FROM + 2 * H, FROM + 100 * H), onTom('kind', 'fireFlat', FROM + 2 * H, FROM + 100 * H)];
  const heart = react('tp1', 'bob', 'bob-1', 'heart', FROM + 5 * H);
  const fire = react('tp1', 'bob', 'bob-1', 'fire', TO + 3 * H);
  const teas = [...Array(6)].map((_, i) => react('tp1', 'bob', 'bob-1', 'tea', TO + 24 * H + (3 + i) * 60_000));
  const one = settle(flatBoard(plays, [heart]), vote);
  const two = settle(flatBoard(plays, [heart, fire], [], { window: W2, paid: one.paid }), vote);
  const three = settle(flatBoard(plays, [heart, fire, ...teas], [], { window: W3, paid: two.paid }), vote);
  assert.deepEqual([one, two, three].map((r) => boostTo(r, 'tom-1')), [360, 0, -270], 'the quarter-vote play pays a vote (360), the fire changes no share, and the six teas take back 3/4 of a vote at the quarter');
  assert.ok([one, two, three].reduce((t, r) => t + boostTo(r, 'tom-1'), 0) >= 0, 'the character is not below zero');
});
test('inside one window the first reaction of the quadrant decides, not the last: another kind then the named kind pays nothing, the named kind then another pays the play', () => {
  const play = onTom('g1', 'fireFlat', FROM + 2 * H, FROM + 100 * H);
  const heart = react('tp1', 'bob', 'bob-1', 'heart', FROM + 5 * H);
  assert.equal(boostTo(settle(flatBoard([play], [heart, react('tp1', 'bob', 'bob-1', 'fire', FROM + 6 * H)]), cardsWorld), 'tom-1'), 0, 'heart first: the play names the fire, so it pays nothing');
  assert.equal(boostTo(settle(flatBoard([play], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 4 * H), react('tp1', 'bob', 'bob-1', 'heart', FROM + 6 * H)]), cardsWorld), 'tom-1'), 5, 'fire first: the play pays its half of a vote');
});
test('two flat earns on one vote, one on the character and one on the post, are one entry by the larger\'s card; a tie goes to the earlier play, then the smaller id', () => {
  const vote = [react('tp1', 'cat', 'cat-1', 'tea', FROM + 5 * H)];
  const larger = settle(flatBoard([onTom('g1', 'calmHalf', FROM + 2 * H), onPostBy('g2', 'tom-1', 'calmWhole', 'tp1', FROM + 2 * H)], vote), cardsWorld);
  assert.deepEqual(boostsOf(larger).map((e) => [e.params, e.amount]), [[{ card: 'calmWhole', flat: 1 }, 10]], 'one entry, not two');
  assert.equal(larger.details.filter((d) => d.reason === 'card.boost').length, 1);
  const earlier = settle(flatBoard([castOn('b', 'bob-1', 'calmHalfB', FROM + 2 * H, 'tom-1'), onTom('a', 'calmHalf', FROM + 3 * H)], vote), cardsWorld);
  assert.deepEqual(boostsOf(earlier).map((e) => e.params), [{ card: 'calmHalfB', flat: 0.5 }], 'the earlier play');
  const sameTime = settle(flatBoard([castOn('b', 'bob-1', 'calmHalfB', FROM + 2 * H, 'tom-1'), onTom('a', 'calmHalf', FROM + 2 * H)], vote), cardsWorld);
  assert.deepEqual(boostsOf(sameTime).map((e) => e.params), [{ card: 'calmHalf', flat: 0.5 }], 'same time and size: the smaller id, a');
  const overlap = settle(flatBoard([onTom('g1', 'calmHalf', FROM + 2 * H, FROM + 10 * H), onTom('g2', 'calmWhole', FROM + 6 * H, FROM + 20 * H)], [
    react('tp1', 'bob', 'bob-1', 'tea', FROM + 4 * H), react('tp1', 'cat', 'cat-1', 'tea', FROM + 8 * H), react('tp1', 'dee', 'dee-1', 'tea', FROM + 15 * H),
  ]), cardsWorld);
  assert.deepEqual(overlap.details.filter((d) => d.reason === 'card.boost').map((d) => [d.at, d.amount]).sort(), [[FROM + 4 * H, 5], [FROM + 8 * H, 10], [FROM + 15 * H, 10]], 'the smaller alone, the larger where both are up, the larger alone');
});
test('a flat earn and a `by` earn on one vote both pay', () => {
  const r = settle(flatBoard([onTom('g1', 'calmBoost', FROM + 2 * H), onTom('g2', 'calmHalf', FROM + 2 * H)], [react('tp1', 'cat', 'cat-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.deepEqual(boostsOf(r).map((e) => [e.params, e.amount]).sort((x, y) => String((x[0] as { card: string }).card).localeCompare(String((y[0] as { card: string }).card))), [[{ card: 'calmBoost', by: 0.1 }, 1], [{ card: 'calmHalf', flat: 0.5 }, 5]]);
});
test('a cast flat earn on another player\'s post pays the post\'s author and the caster nothing', () => {
  const r = settle(flatBoard([onPostBy('h1', 'bob-1', 'calmHalf', 'tp1', FROM + 2 * H)], [react('tp1', 'cat', 'cat-1', 'tea', FROM + 5 * H), react('tp2', 'dee', 'dee-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.deepEqual(boostsOf(r).map((e) => [e.player, e.character, e.amount]), [['tom', 'tom-1', 5]], 'the post tp1 alone');
  assert.equal(r.entries.filter((e) => e.player === 'bob' && e.reason === 'card.boost').length, 0);
});
test('a flat earn\'s entry carries { card, flat }, its details carry the card and add up to it, and it is in no class\'s total', () => {
  const input = flatBoard([onTom('g1', 'heatFlat', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H), react('tp1', 'cat', 'cat-1', 'fire', FROM + 6 * H), react('tp2', 'dee', 'dee-1', 'fire', FROM + 7 * H)]);
  const r = settle(input, cardsWorld);
  const [entry] = boostsOf(r);
  assert.deepEqual(entry!.params, { card: 'heatFlat', flat: 0.25 });
  assert.equal(entry!.amount, 8, '2.5 for each of three votes, 7.5 rounded');
  const details = r.details.filter((d) => d.reason === 'card.boost');
  assert.equal(details.length, 3);
  assert.equal(details.reduce((s, d) => s + d.amount, 0), entry!.amount);
  assert.ok(details.every((d) => d.params?.card === 'heatFlat' && Object.keys(d.params).length === 1 && d.quadrant === 'excitedPositive' && d.at !== undefined));
  assert.equal(r.byClass.kinded, amountOf(r, 'tom-1', 'kinded.nod'), 'a flat earn has no class');
});
test('a flat earn that rounds to nothing makes no entry, and a cushion play is no earn', () => {
  const dust = settle(flatBoard([onTom('g1', 'dustFlat', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.equal(boostsOf(dust).length, 0);
  assert.equal(dust.details.filter((d) => d.reason === 'card.boost').length, 0);
  const cushion = settle(flatBoard([onTom('g1', 'softCushion', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld);
  assert.equal(boostsOf(cushion).length, 0);
});
test('a flat earn an admin ended is not in the input, so it pays nothing', () => {
  assert.equal(boostTo(settle(flatBoard([], [react('tp1', 'bob', 'bob-1', 'tea', FROM + 5 * H)]), cardsWorld), 'tom-1'), 0);
});
test('a cast earn on one\'s own other mask boosts like a use', () => {
  const base = earnBoard([castOn('g1', 'tom-2', 'castBoost', FROM + 2 * H, 'tom-1')], [react('tp1', 'cat', 'cat-1', 'tea', FROM + 5 * H)]);
  const input: SettlementInput = { ...base, characters: [...base.characters, { id: 'tom-2', player: 'tom', classes: [{ class: 'quiet', from: 0 }] }] };
  const r = settle(input, cardsWorld);
  assert.equal(amountOf(r, 'tom-1', 'card.boost'), 1);
});
test('entryKey is the player and the line key, and the line key tells two cards, and a card and none, apart', () => {
  assert.equal(entryKey({ player: 'u', character: 'c', reason: 'card.ride', params: { card: 'x' } }), `u\u0000${lineKey('c', 'card.ride', 'x')}`);
  assert.equal(entryKey({ player: 'u', character: 'c', reason: 'face.cheered' }), `u\u0000${lineKey('c', 'face.cheered', null)}`);
  assert.equal(entryKey({ player: 'u', character: 'c', reason: 'card.ride', params: { card: 'x' } }), 'u\u0000c\u0000card.ride\u0000x');
  /* Any string is a card to the key, as it was to entryKey before lineKey; apply_settlement refuses an empty one (0150). */
  assert.equal(entryKey({ player: 'u', character: 'c', reason: 'card.ride', params: { card: '' } }), 'u\u0000c\u0000card.ride\u0000');
  assert.notEqual(lineKey('c', 'card.ride', 'x'), lineKey('c', 'card.ride', 'y'));
  assert.notEqual(lineKey('c', 'card.ride', 'x'), lineKey('c', 'card.ride', null));
});

/* The cushion (docs/plans/2026-11-16-settlement-engine-plan.md, Task 3): a share of a loss from a reaction given back. The test classes: "voted" pays
   a vote's worth for each reaction it receives, positive in the positive quadrants and negative in the others, and sets `votes` to the reaction's
   signed votes; "costly" charges 10 for each reaction it receives and sets no `votes`, a cost no reaction caused. */
const voted: ClassRules = {
  key: 'voted',
  name: 'Voted',
  earn: (input, settings) => input.received.map((r): Earning => {
    const gain = r.quadrant === 'excitedPositive' || r.quadrant === 'calmPositive';
    return { reason: gain ? 'voted.nod' : 'voted.sting', amount: (gain ? 1 : -1) * settings.vote * r.votes, votes: r.votes, act: r.act, quadrant: r.quadrant, at: r.at };
  }),
};
const costly: ClassRules = {
  key: 'costly',
  name: 'Costly',
  earn: (input) => input.received.map((r): Earning => ({ reason: 'costly.fee', amount: -10, act: r.act, quadrant: r.quadrant, at: r.at })),
};
/* "tallied" charges 20 for each post it has in the window, with no reaction to name: a loss the window's reactions caused together, marked `ofWindow`
   (docs/plans/2026-11-17-thick-skin-outdrawn-plan.md, Task 1). */
const tallied: ClassRules = {
  key: 'tallied',
  name: 'Tallied',
  earn: (input) => input.posts.map((p): Earning => ({ reason: 'tallied.outdrawn', amount: -20, act: p.act, ofWindow: true })),
};
const cushionWorld: Instance = {
  ...cardsWorld,
  classes: [...cardsWorld.classes, voted, costly, tallied],
  cards: [
    ...cardsWorld.cards,
    { ...splat, key: 'softCushionB', reaches: ['character'] as const, gimmick: { kind: 'cushion', share: 0.5 } },
    { ...splat, key: 'wholeCushion', gimmick: { kind: 'cushion', share: 1 } },
    { ...splat, key: 'quarterCushion', gimmick: { kind: 'cushion', share: 0.25 } },
  ],
};
function cushionBoard(gimmicks: InputAct[], reactions: InputReaction[], extra: InputAct[] = [], over: Partial<SettlementInput> = {}): SettlementInput {
  return flatBoard(gimmicks, reactions, extra, {
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: 'voted', from: 0 }] },
      { id: 'tom-2', player: 'tom', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'uma-1', player: 'uma', classes: [{ class: 'costly', from: 0 }] },
      { id: 'ted-1', player: 'ted', classes: [{ class: 'tallied', from: 0 }] },
      ...['bob', 'cat', 'dee', 'eve', 'fay'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
    ...over,
  });
}
const cushionsOf = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.reason === 'card.cushion');
const cushionTo = (r: ReturnType<typeof settle>, character: string) => amountOf(r, character, 'card.cushion');

test('a loss from a reaction is half given back under a 0.5 cushion; a gain is untouched; a loss outside its time is untouched', () => {
  const one = (r: InputReaction, ends = FROM + 10 * H) => cushionTo(settle(cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H, ends)], [r]), cushionWorld), 'tom-1');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)), 5, 'half of a loss of 10');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'tomato', FROM + 5 * H)), 5, 'a loss from any negative quadrant');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H)), 0, 'a gain');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'zzz', FROM + 2 * H - 1)), 0, 'before it');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'zzz', FROM + 10 * H)), 0, 'at its end');
  assert.equal(one(react('tp1', 'bob', 'bob-1', 'zzz', FROM + 12 * H)), 0, 'after it');
  const r = settle(cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]), cushionWorld);
  assert.equal(amountOf(r, 'tom-1', 'voted.sting'), -10, 'the class\'s own loss is whole');
});
test('a cushion with no `ends` gives nothing back', () => {
  assert.equal(cushionTo(settle(cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H, null)], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]), cushionWorld), 'tom-1'), 0);
});
test('an earning with a negative amount and no `votes`, a cost no reaction caused, is untouched', () => {
  const r = settle(cushionBoard([onUma('g1', 'softCushion', FROM + 2 * H)], [react('up1', 'dee', 'dee-1', 'zzz', FROM + 5 * H)]), cushionWorld);
  assert.equal(amountOf(r, 'uma-1', 'costly.fee'), -10);
  assert.equal(cushionsOf(r).length, 0);
});
test('a gain taken back and a loss taken back are untouched', () => {
  const play = onTom('g1', 'softCushion', FROM + 2 * H, FROM + 100 * H);
  const taken = (firstKind: string, thenKind: string) => {
    const first = settle(cushionBoard([play], [react('tp1', 'bob', 'bob-1', firstKind, FROM + 5 * H)]), cushionWorld);
    return settle(cushionBoard([play], [react('tp1', 'bob', 'bob-1', firstKind, FROM + 5 * H), react('tp1', 'bob', 'bob-1', thenKind, TO + 3 * H)], [], { window: W2, paid: first.paid }), cushionWorld);
  };
  const gain = taken('tea', 'fire');
  assert.ok(gain.details.some((d) => d.reason === 'voted.nod' && d.amount < 0), 'the calm vote was taken back (a negative amount on negative votes)');
  assert.equal(cushionsOf(gain).length, 0, 'a gain taken back is no loss');
  const loss = taken('zzz', 'tea');
  assert.equal(amountOf(loss, 'tom-1', 'voted.sting'), 5, 'a loss taken back pays back');
  assert.equal(cushionsOf(loss).length, 0, 'a loss taken back (positive amount) is untouched');
});
test('two cushions on one loss give back the larger alone; a tie goes to the earlier play, then the smaller id', () => {
  const loss = [react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H)];
  const larger = settle(cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H), onPostBy('g2', 'tom-1', 'wholeCushion', 'tp1', FROM + 2 * H)], loss), cushionWorld);
  assert.deepEqual(cushionsOf(larger).map((e) => [e.params, e.amount]), [[{ card: 'wholeCushion', share: 1 }, 10]], 'one entry, not two');
  assert.equal(larger.details.filter((d) => d.reason === 'card.cushion').length, 1);
  const earlier = settle(cushionBoard([castOn('b', 'bob-1', 'softCushionB', FROM + 2 * H, 'tom-1'), onTom('a', 'softCushion', FROM + 3 * H)], loss), cushionWorld);
  assert.deepEqual(cushionsOf(earlier).map((e) => e.params), [{ card: 'softCushionB', share: 0.5 }], 'the earlier play');
  const sameTime = settle(cushionBoard([castOn('b', 'bob-1', 'softCushionB', FROM + 2 * H, 'tom-1'), onTom('a', 'softCushion', FROM + 2 * H)], loss), cushionWorld);
  assert.deepEqual(cushionsOf(sameTime).map((e) => e.params), [{ card: 'softCushion', share: 0.5 }], 'same time and size: the smaller id, a');
});
test('a cushion on a post softens that post\'s losses alone', () => {
  const r = settle(cushionBoard([onPostBy('g1', 'bob-1', 'softCushion', 'tp1', FROM + 2 * H)], [react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H), react('tp2', 'dee', 'dee-1', 'zzz', FROM + 5 * H)]), cushionWorld);
  assert.deepEqual(cushionsOf(r).map((e) => [e.player, e.character, e.amount]), [['tom', 'tom-1', 5]], 'the post tp1 alone, to its author, never the caster');
  assert.deepEqual(r.details.filter((d) => d.reason === 'card.cushion').map((d) => d.act), ['tp1']);
});
test('a cushion beside a flat earn on the same vote: both entries, each as it would be alone', () => {
  const loss = [react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H)];
  const flat = onTom('g1', 'heatChillFlat', FROM + 2 * H);
  const soft = onTom('g2', 'softCushion', FROM + 2 * H);
  const both = settle(cushionBoard([flat, soft], loss), cushionWorld);
  const flatAlone = settle(cushionBoard([flat], loss), cushionWorld);
  const softAlone = settle(cushionBoard([soft], loss), cushionWorld);
  assert.deepEqual(boostsOf(both).map((e) => [e.params, e.amount]), boostsOf(flatAlone).map((e) => [e.params, e.amount]));
  assert.deepEqual(cushionsOf(both).map((e) => [e.params, e.amount]), cushionsOf(softAlone).map((e) => [e.params, e.amount]));
  assert.deepEqual(boostsOf(both).map((e) => e.amount), [5], 'the flat earn pays half a vote for the groan');
  assert.deepEqual(cushionsOf(both).map((e) => e.amount), [5], 'and the cushion gives half the loss back');
});
test('a cushion reads the class\'s own earnings alone: a `by` boost and a flat earn beside it are never cushioned', () => {
  const r = settle(cushionBoard([onTom('g1', 'calmBoost', FROM + 2 * H), onTom('g2', 'heatChillFlat', FROM + 2 * H), onTom('g3', 'softCushion', FROM + 2 * H)], [react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H)]), cushionWorld);
  assert.deepEqual(cushionsOf(r).map((e) => e.amount), [5], 'one cushion line, for the class\'s own loss alone');
});
test('a cushion entry carries { card, share }, its details carry the card and add up to it, and it is in no class\'s total', () => {
  const input = cushionBoard([onTom('g1', 'quarterCushion', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H), react('tp1', 'cat', 'cat-1', 'zzz', FROM + 6 * H), react('tp2', 'dee', 'dee-1', 'tomato', FROM + 7 * H)]);
  const r = settle(input, cushionWorld);
  const [entry] = cushionsOf(r);
  assert.deepEqual(entry!.params, { card: 'quarterCushion', share: 0.25 });
  assert.equal(entry!.amount, 8, '2.5 for each of three losses, 7.5 rounded');
  const details = r.details.filter((d) => d.reason === 'card.cushion');
  assert.equal(details.length, 3);
  assert.equal(details.reduce((s, d) => s + d.amount, 0), entry!.amount);
  assert.ok(details.every((d) => d.params?.card === 'quarterCushion' && Object.keys(d.params).length === 1 && d.quadrant !== undefined && d.at !== undefined));
  assert.equal(r.byClass.voted, amountOf(r, 'tom-1', 'voted.sting'), 'a cushion has no class');
});
test('the estimate shows the cushion\'s line at the reaction\'s time', () => {
  const input = cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H)], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]);
  const estimate = estimateForOwner(input, cushionWorld, 'tom');
  assert.deepEqual(estimate.entries.filter((e) => e.reason === 'card.cushion').map((e) => [e.params, e.amount]), [[{ card: 'softCushion' }, 5]]);
  assert.deepEqual(estimate.lines.filter((l) => l.reason === 'card.cushion').map((l) => [l.act, l.quadrant, l.at, l.amount]), [['tp1', 'boredNegative', FROM + 5 * H, 5]]);
});

/* Review round for Task 3. "stray" pays a loss of 10, with `votes`, for each reaction its character receives, but names the Act "up1", which is not
   its character's own: a cushion keys on the Act an earning names, so only the owner check keeps it from reaching another character's loss. */
const stray: ClassRules = {
  key: 'stray',
  name: 'Stray',
  earn: (input) => input.received.map((r): Earning => ({ reason: 'stray.loss', amount: -10, votes: 1, act: 'up1', quadrant: r.quadrant, at: r.at })),
};
const strayWorld: Instance = { ...cushionWorld, classes: [...cushionWorld.classes, stray] };
test('a cushion on an Act reaches a loss that names the Act only when the Act is the earning character\'s own', () => {
  const input = cushionBoard([onPostBy('g1', 'bob-1', 'softCushion', 'up1', FROM + 2 * H)], [react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H)], [], {
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: 'stray', from: 0 }] },
      { id: 'uma-1', player: 'uma', classes: [{ class: 'quiet', from: 0 }] },
      ...['bob', 'cat'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
  });
  const r = settle(input, strayWorld);
  assert.equal(amountOf(r, 'tom-1', 'stray.loss'), -10, 'the loss is there');
  assert.equal(cushionsOf(r).length, 0, 'a cushion on uma\'s post never softens a loss of tom\'s');
});
test('a tie between a play on the Act and a play on the character goes to the Act\'s play when it is earlier, or at the same time has the smaller id', () => {
  const loss = [react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H)];
  const cards = (e: ReturnType<typeof settle>) => cushionsOf(e).map((x) => (x.params as { card: string }).card);
  const earlier = settle(cushionBoard([onPostBy('z', 'bob-1', 'softCushion', 'tp1', FROM + 2 * H), castOn('a', 'bob-1', 'softCushionB', FROM + 3 * H, 'tom-1')], loss), cushionWorld);
  assert.deepEqual(cards(earlier), ['softCushion'], 'the Act\'s play is earlier, though its id is larger and the character\'s play is met first');
  const smaller = settle(cushionBoard([onPostBy('a', 'bob-1', 'softCushion', 'tp1', FROM + 2 * H), castOn('b', 'bob-1', 'softCushionB', FROM + 2 * H, 'tom-1')], loss), cushionWorld);
  assert.deepEqual(cards(smaller), ['softCushion'], 'at the same time the Act\'s play has the smaller id');
});
test('the same cushion play pays with an `ends` and not without one', () => {
  const loss = [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)];
  assert.equal(cushionTo(settle(cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H, FROM + 10 * H)], loss), cushionWorld), 'tom-1'), 5, 'with an `ends` it pays');
  /* The `ends !== undefined` guard where the plays are indexed is not what turns the `no ends` test red when it is removed: with no `ends`, the
     window test `e.at < undefined` is false anyway. The pair shows the play is the same and only the `ends` differs. */
  assert.equal(cushionTo(settle(cushionBoard([onTom('g1', 'softCushion', FROM + 2 * H, null)], loss), cushionWorld), 'tom-1'), 0, 'without one it pays nothing');
});
test('a voter who moves one vote across two loss quadrants draws a quarter of a vote more than a half cushion\'s share of the loss that stands', () => {
  /* A vote is worth 100 here so that no half of a half rounds: the entries are whole numbers. */
  const big: Instance = { ...cushionWorld, settings: { ...cushionWorld.settings, vote: 100 } };
  const play = onTom('g1', 'softCushion', FROM + 2 * H, FROM + 100 * H);
  const first = settle(cushionBoard([play], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]), big);
  const second = settle(cushionBoard([play], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H), react('tp1', 'bob', 'bob-1', 'tomato', TO + 3 * H)], [], { window: W2, paid: first.paid }), big);
  const sum = (rs: ReturnType<typeof settle>[], reason: string) => rs.flatMap((r) => r.details.filter((d) => d.character === 'tom-1' && d.reason === reason)).reduce((t, d) => t + d.amount, 0);
  const stands = sum([first, second], 'voted.sting');
  const given = sum([first, second], 'card.cushion');
  assert.equal(stands, -100, 'one vote stands as a loss of 100');
  assert.equal(given - -0.5 * stands, 25, 'the cushion gave 75 against the 50 that half of 100 is: a quarter of a vote over');
});
test('a voter who moves one vote from a loss quadrant to one that is no loss leaves the same quarter of a vote of cushion behind', () => {
  const big: Instance = { ...cushionWorld, settings: { ...cushionWorld.settings, vote: 100 } };
  const play = onTom('g1', 'softCushion', FROM + 2 * H, FROM + 100 * H);
  const first = settle(cushionBoard([play], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]), big);
  const second = settle(cushionBoard([play], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H), react('tp1', 'bob', 'bob-1', 'tea', TO + 3 * H)], [], { window: W2, paid: first.paid }), big);
  const sum = (rs: ReturnType<typeof settle>[], reason: string) => rs.flatMap((r) => r.details.filter((d) => d.character === 'tom-1' && d.reason === reason)).reduce((t, d) => t + d.amount, 0);
  assert.equal(sum([first, second], 'voted.sting'), -50, 'half a vote of loss stands');
  assert.equal(sum([first, second], 'card.cushion'), 50, 'the cushion given stays at 50, a quarter of a vote over half of what stands');
});

/* A window's loss and the cushion's second way (docs/plans/2026-11-17-thick-skin-outdrawn-plan.md, Task 1): an earning a class marks `ofWindow` is a loss
   the window's reactions caused together, charged as the window settles, so a cushion up at the window's end (`from <= window.to < ends`) gives its share
   back. Ted's one post, ep1, is charged 20 by "tallied". */
const tedPost = [post('ep1', 'ted-1', FROM + 1 * H)];
const tedBoard = (gimmicks: InputAct[], reactions: InputReaction[] = [], over: Partial<SettlementInput> = {}) => cushionBoard(gimmicks, reactions, tedPost, over);
const onTed = (id: string, card: string, at: number, ends: number | null = TO + 5 * H): InputAct => ({ ...onTom(id, card, at, ends), character: 'ted-1', on: 'ted-1' });
const tallyWith = (change: (e: Earning) => Earning): Instance => ({ ...cushionWorld, classes: cushionWorld.classes.map((k) => (k.key === 'tallied' ? { ...k, earn: (i, s) => k.earn(i, s).map(change) } : k)) });
const backToTed = (r: ReturnType<typeof settle>) => cushionTo(r, 'ted-1');

test('a cushion up at the window\'s end gives back its share of a window\'s loss, in a line with the Act and no time or quadrant', () => {
  const r = settle(tedBoard([onTed('g1', 'softCushion', FROM + 2 * H)]), cushionWorld);
  assert.equal(amountOf(r, 'ted-1', 'tallied.outdrawn'), -20, 'the class\'s own loss is whole');
  assert.deepEqual(cushionsOf(r).map((e) => [e.character, e.params, e.amount]), [['ted-1', { card: 'softCushion', share: 0.5 }, 10]]);
  const lines = r.details.filter((d) => d.reason === 'card.cushion');
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.act, 'ep1');
  assert.equal(lines[0]!.amount, 10);
  assert.ok(!('at' in lines[0]!) && !('quadrant' in lines[0]!), 'no time and no quadrant: no reaction is named');
});
test('a cushion that ends before the window\'s end, or exactly at it, gives back nothing of a window\'s loss; one played in its last hour does', () => {
  const back = (play: InputAct) => backToTed(settle(tedBoard([play]), cushionWorld));
  assert.equal(back(onTed('g1', 'softCushion', FROM + 2 * H, FROM + 10 * H)), 0, 'ended before the window\'s end');
  assert.equal(back(onTed('g1', 'softCushion', FROM + 2 * H, TO)), 0, 'ends exactly at the window\'s end');
  assert.equal(back(onTed('g1', 'softCushion', FROM + 2 * H, TO + 1)), 10, 'up one moment past it');
  assert.equal(back(onTed('g1', 'softCushion', TO - H, TO + 2 * H)), 10, 'played in the last hour, after everything else');
});
test('a cushion on the Act, and not on the character, softens a window\'s loss on that Act', () => {
  const r = settle(tedBoard([onPostBy('g1', 'bob-1', 'softCushion', 'ep1', FROM + 2 * H, TO + 5 * H)]), cushionWorld);
  assert.deepEqual(cushionsOf(r).map((e) => [e.character, e.amount]), [['ted-1', 10]]);
  assert.deepEqual(r.details.filter((d) => d.reason === 'card.cushion').map((d) => d.act), ['ep1']);
});
test('two cushions up at the window\'s end on a window\'s loss give back the larger alone, in one entry', () => {
  const r = settle(tedBoard([onTed('g1', 'softCushion', FROM + 2 * H), onPostBy('g2', 'bob-1', 'wholeCushion', 'ep1', FROM + 3 * H, TO + 5 * H)]), cushionWorld);
  assert.deepEqual(cushionsOf(r).map((e) => [e.params, e.amount]), [[{ card: 'wholeCushion', share: 1 }, 20]]);
  assert.equal(r.details.filter((d) => d.reason === 'card.cushion').length, 1);
});
test('a window\'s loss is softened only where it is a loss, marked, and on the character\'s own Act', () => {
  const play = onTed('g1', 'softCushion', FROM + 2 * H);
  const gain = settle(tedBoard([play]), tallyWith((e) => ({ ...e, amount: 20 })));
  assert.equal(amountOf(gain, 'ted-1', 'tallied.outdrawn'), 20);
  assert.equal(cushionsOf(gain).length, 0, 'a positive amount is read by nothing');
  const unmarked = settle(tedBoard([play, onUma('g2', 'softCushion', FROM + 2 * H, TO + 5 * H)], [react('up1', 'dee', 'dee-1', 'zzz', FROM + 5 * H)]), tallyWith(({ ofWindow: _, ...e }) => e));
  assert.equal(amountOf(unmarked, 'ted-1', 'tallied.outdrawn'), -20, 'the loss is there');
  assert.equal(cushionsOf(unmarked).length, 0, 'without the mark it is no window\'s loss, and `costly`\'s cost with no votes gets none either');
  assert.equal(amountOf(unmarked, 'uma-1', 'costly.fee'), -10);
  const elsewhere = settle(tedBoard([play, onTom('g3', 'softCushion', FROM + 2 * H, TO + 5 * H)]), tallyWith((e) => ({ ...e, act: 'tp1' })));
  assert.equal(amountOf(elsewhere, 'ted-1', 'tallied.outdrawn'), -20);
  assert.equal(cushionsOf(elsewhere).length, 0, 'naming another character\'s Act, even one under a cushion');
});
test('a loss from a reaction is still softened by its own time, marked or not, while a window\'s loss is read at the window\'s end', () => {
  const plays = [onTom('g1', 'softCushion', FROM + 2 * H, FROM + 10 * H), onTed('g2', 'softCushion', FROM + 2 * H, FROM + 10 * H)];
  const r = settle(tedBoard(plays, [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]), cushionWorld);
  assert.equal(cushionTo(r, 'tom-1'), 5, 'the reaction\'s way is unchanged: half of 10, inside the cushion');
  assert.equal(backToTed(r), 0, 'and the cushion that ended before the window\'s end gives back none of the window\'s loss');
  const marked: Instance = { ...cushionWorld, classes: cushionWorld.classes.map((k) => (k.key === 'voted' ? { ...k, earn: (i, s) => k.earn(i, s).map((e) => ({ ...e, ofWindow: true as const })) } : k)) };
  const markedVotes = settle(tedBoard([onTom('g1', 'softCushion', FROM + 2 * H, FROM + 10 * H)], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H)]), marked);
  assert.equal(cushionTo(markedVotes, 'tom-1'), 5, 'an earning with votes and an `at` is read by its `at` though it is marked');
});
test('the same input with its rows reversed settles to the same entries and details', () => {
  const input = tedBoard([onTed('g1', 'softCushion', FROM + 2 * H), onTom('g2', 'softCushion', FROM + 2 * H, TO + 5 * H)], [react('tp1', 'bob', 'bob-1', 'zzz', FROM + 5 * H), react('tp2', 'cat', 'cat-1', 'tomato', FROM + 6 * H)]);
  const flipped: SettlementInput = { ...input, acts: [...input.acts].reverse(), reactions: [...input.reactions].reverse(), characters: [...input.characters].reverse() };
  const a = settle(input, cushionWorld);
  const b = settle(flipped, cushionWorld);
  assert.ok(cushionsOf(a).length >= 2);
  assert.deepEqual(b.entries, a.entries);
  assert.deepEqual(b.details, a.details);
});
test('the next window, with the cushion still up and the post now before the window, has no cushion line for it', () => {
  const r = settle(tedBoard([onTed('g1', 'softCushion', FROM + 2 * H, TO + 30 * H)], [], { window: W2 }), cushionWorld);
  assert.equal(amountOf(r, 'ted-1', 'tallied.outdrawn'), 0);
  assert.equal(cushionsOf(r).length, 0);
});
test('with the vote unshared and unhalved and the window ending mid-day, the cushion line is there with the loss line, and with the post removed neither is', () => {
  const options = { sharedVote: false, halving: false };
  const window = { id: 'half', from: FROM, to: FROM + 12 * H };
  const play = onTed('g1', 'softCushion', FROM + 2 * H, FROM + 20 * H);
  const r = settle(tedBoard([play], [], { window }), cushionWorld, options);
  assert.equal(amountOf(r, 'ted-1', 'tallied.outdrawn'), -20);
  assert.equal(backToTed(r), 10);
  const none = settle(cushionBoard([play], [], [], { window }), cushionWorld, options);
  assert.equal(amountOf(none, 'ted-1', 'tallied.outdrawn'), 0);
  assert.equal(cushionsOf(none).length, 0);
});

/* ---- a post's debate (the Tweener catalyst plan, Task 1) ---- */

const DAY = 24 * H;
const debateCast = [['ann', 2], ['bob', 2], ['cat', 1], ['dee', 1], ['eve', 1]] as const;
/** Ann plays ann-1 and ann-2, Bob plays bob-1 and bob-2, and Cat, Dee and Eve one each; every character holds the recording class. */
const debateBoard = (acts: InputAct[], quotes: { act: string; quoted: string }[], reactions: InputReaction[] = [], over: Partial<SettlementInput> = {}): SettlementInput => ({
  window: { id: 'w1', from: FROM, to: TO },
  characters: debateCast.flatMap(([p, n]) => Array.from({ length: n }, (_, i) => ({ id: `${p}-${i + 1}`, player: p, classes: [{ class: 'quiet', from: 0 }] }))),
  acts, reactions, quotes, ...over,
});
const debateWorld = (rules: ClassRules): Instance => ({ ...withClasses(rules), cards: [...instance.cards, sugar, { ...sugar, key: 'half', gimmick: { kind: 'cushion' as const, share: 0.5 } }] });
const debatesOf = (inputs: readonly ClassInput[], act?: string) => inputs.flatMap((i) => i.debates).filter((d) => act === undefined || d.act === act);
const voicesOf = (d: { posts: readonly { voice: number }[] } | undefined) => d?.posts.map((p) => p.voice);
const quote = (act: string, quoted: string) => ({ act, quoted });
const spin = (id: string, character: string, at: number, thread: string, target: string): InputAct => ({ id, character, kind: 'spin', at, thread, target });

test('a debate is every post that quotes the spark, transitively, and the spin and posts of a thread another player spun from it, each by a numbered voice', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H), post('b', 'cat-1', FROM + 3 * H), spin('s', 'cat-1', FROM + 4 * H, 'sp', 'p1'), post('c', 'dee-1', FROM + 5 * H, 'sp'), post('x', 'eve-1', FROM + 6 * H, 'unrelated')],
    [quote('a', 'p1'), quote('b', 'a')],
  ), debateWorld(rules));
  const d = debatesOf(inputs, 'p1');
  assert.equal(d.length, 1);
  assert.deepEqual(d[0]!.posts, [{ at: FROM + 2 * H, voice: 1 }, { at: FROM + 3 * H, voice: 2 }, { at: FROM + 4 * H, voice: 2 }, { at: FROM + 5 * H, voice: 3 }]);
  assert.equal(d[0]!.at, FROM + 1 * H, 'the post\'s own time');
  assert.equal(d[0]!.inOwnDebate, false);
  assert.equal(JSON.stringify(d).includes('bob'), false, 'a voice names no one');
});

test('two masks of one player are one voice with the shared vote on, and two voices with it off', () => {
  const b = debateBoard([post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H), post('b', 'bob-2', FROM + 3 * H), post('c', 'cat-1', FROM + 4 * H)], [quote('a', 'p1'), quote('b', 'p1'), quote('c', 'p1')]);
  const on = spy();
  settle(b, debateWorld(on.rules));
  assert.deepEqual(voicesOf(debatesOf(on.inputs, 'p1')[0]), [1, 1, 2]);
  const off = spy();
  settle(b, debateWorld(off.rules), { sharedVote: false });
  assert.deepEqual(voicesOf(debatesOf(off.inputs, 'p1')[0]), [1, 2, 3]);
});

test('the author\'s other mask quoting the spark is voice 0, with the shared vote off as on', () => {
  const b = debateBoard([post('p1', 'ann-1', FROM + 1 * H), post('a', 'ann-2', FROM + 2 * H), post('b', 'bob-1', FROM + 3 * H)], [quote('a', 'p1'), quote('b', 'p1')]);
  for (const options of [{}, { sharedVote: false }]) {
    const { rules, inputs } = spy();
    settle(b, debateWorld(rules), options);
    assert.deepEqual(voicesOf(debatesOf(inputs, 'p1')[0]), [0, 1]);
  }
});

test('a thread the author\'s own player spun from the spark adds nothing, its posts included', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H), spin('s', 'ann-2', FROM + 3 * H, 'sp', 'p1'), post('c', 'dee-1', FROM + 4 * H, 'sp')],
    [quote('a', 'p1')],
  ), debateWorld(rules));
  assert.deepEqual(voicesOf(debatesOf(inputs, 'p1')[0]), [1]);
});

test('a post that quotes the spark at or after the window\'s end is no member', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', TO - 1), post('b', 'cat-1', TO), post('c', 'dee-1', TO + H)],
    [quote('a', 'p1'), quote('b', 'p1'), quote('c', 'a')],
  ), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs, 'p1')[0]?.posts, [{ at: TO - 1, voice: 1 }]);
});

test('a quote that does not name an earlier post in the input is read as none: a cycle, a self-quote, a later post, an unknown Act and a tie by id', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H), post('b', 'cat-1', FROM + 3 * H), post('m1', 'dee-1', FROM + 5 * H), post('m2', 'eve-1', FROM + 5 * H)],
    [quote('a', 'p1'), quote('b', 'a'), quote('a', 'b'), quote('b', 'b'), quote('p1', 'b'), quote('a', 'ghost'), quote('m1', 'm2')],
  ), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs).map((d) => d.act).sort(), ['a', 'p1'], 'no post is a spark of a quote from an earlier or equal one');
  assert.deepEqual(debatesOf(inputs, 'p1')[0]?.posts, [{ at: FROM + 2 * H, voice: 1 }, { at: FROM + 3 * H, voice: 2 }]);
  assert.deepEqual(debatesOf(inputs, 'a')[0]?.posts, [{ at: FROM + 3 * H, voice: 1 }]);
});

test('a spark with no member in the window is not handed over, and neither is one older than debateDays before it', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('old', 'ann-1', FROM - 2 * DAY), post('earlier', 'bob-1', FROM - 2 * DAY + H), post('stale', 'ann-1', FROM - 4 * DAY), post('quoted', 'bob-1', FROM + H), post('edge', 'ann-1', FROM - 3 * DAY), post('quotedEdge', 'bob-1', FROM + 2 * H)],
    [quote('earlier', 'old'), quote('quoted', 'stale'), quote('quotedEdge', 'edge')],
  ), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs).map((d) => d.act), ['edge'], 'only the one made exactly debateDays before the window\'s start, with a member inside it');
});

test('the author\'s second post, quoting a reply to the first, is in its own debate; a first post quoting another player\'s post is not', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('a1', 'ann-1', FROM + 1 * H), post('b1', 'bob-1', FROM + 2 * H), post('a2', 'ann-2', FROM + 3 * H), post('c1', 'cat-1', FROM + 4 * H)],
    [quote('b1', 'a1'), quote('a2', 'b1'), quote('c1', 'a2')],
  ), debateWorld(rules));
  assert.equal(debatesOf(inputs, 'a1')[0]?.inOwnDebate, false);
  assert.equal(debatesOf(inputs, 'b1')[0]?.inOwnDebate, false, 'Bob\'s first post quotes Ann\'s');
  assert.equal(debatesOf(inputs, 'a2')[0]?.inOwnDebate, true);
});

test('a post inside a thread spun from an earlier post by the same player is in its own debate', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), spin('s', 'bob-1', FROM + 2 * H, 'sp', 'p1'), post('a2', 'ann-2', FROM + 3 * H, 'sp'), post('c1', 'cat-1', FROM + 4 * H)],
    [quote('c1', 'a2')],
  ), debateWorld(rules));
  assert.equal(debatesOf(inputs, 'a2')[0]?.inOwnDebate, true);
  assert.deepEqual(voicesOf(debatesOf(inputs, 'p1')[0]), [1, 0], 'the author took part in the thread');
});

test('an Act that is not in the input (a staff post, one of The System\'s) is no member', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H)],
    [quote('a', 'p1'), quote('staff1', 'p1'), quote('a', 'sys1')],
    [], { systemActs: ['sys1'] },
  ), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs, 'p1')[0]?.posts, [{ at: FROM + 2 * H, voice: 1 }]);
});

test('a card or a reaction is no member: only posts and spins are', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H), { id: 'k', character: 'cat-1', kind: 'card', at: FROM + 3 * H, thread: 't1', target: 'p1', card: 'sugar' }],
    [quote('a', 'p1'), quote('k', 'p1')],
  ), debateWorld(rules));
  assert.deepEqual(voicesOf(debatesOf(inputs, 'p1')[0]), [1]);
});

test('a spark with two calm votes from an earlier window and none in this one has them before and now; one a fire joined has calm before and half calm, half hype now', () => {
  const { rules, inputs } = spy();
  const calm = { ...noVote, calmPositive: 1 };
  settle(debateBoard(
    [post('p1', 'ann-1', FROM - 5 * H), post('q1', 'bob-1', FROM + 1 * H), post('p2', 'ann-1', FROM - 4 * H), post('q2', 'bob-1', FROM + 2 * H)],
    [quote('q1', 'p1'), quote('q2', 'p2')],
    [react('p1', 'cat', 'cat-1', 'tea', FROM - 3 * H), react('p1', 'dee', 'dee-1', 'tea', FROM - 2 * H), react('p2', 'cat', 'cat-1', 'tea', FROM - 3 * H), react('p2', 'cat', 'cat-1', 'fire', FROM + 3 * H)],
    { paid: [{ player: 'cat', act: 'p1', weight: 1, shares: { ...noVote, calmPositive: 1 } }, { player: 'dee', act: 'p1', weight: 1, shares: { ...noVote, calmPositive: 1 } }, { player: 'cat', act: 'p2', weight: 1, shares: { ...noVote, calmPositive: 1 } }] },
  ), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs, 'p1')[0]?.standing, { before: [calm, calm], now: [calm, calm] });
  assert.deepEqual(debatesOf(inputs, 'p2')[0]?.standing, { before: [calm], now: [{ ...noVote, calmPositive: 0.5, excitedPositive: 0.5 }] }, 'a fire beside the calm splits the one vote');
});

test('the estimate\'s standing is each earlier reaction as a voter of its own, for a spark no vote moved on', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM - 5 * H), post('q1', 'bob-1', FROM + 1 * H)],
    [quote('q1', 'p1')],
    [react('p1', 'cat', 'cat-1', 'tea', FROM - 3 * H), react('p1', 'cat', 'cat-1', 'fire', FROM - 2 * H)],
  ), debateWorld(rules), { sharedVote: false, halving: false });
  assert.deepEqual(bySize(debatesOf(inputs, 'p1')[0]!.standing.now), bySize([{ ...noVote, calmPositive: 1 }, { ...noVote, excitedPositive: 1 }]));
});

test('a spark with a debate and a vote in the window but no member in it is handed over, placed by the vote; one with no member at all is not', () => {
  const { rules, inputs } = spy();
  settle(debateBoard(
    [post('p1', 'ann-1', FROM - 3 * H), post('a', 'bob-1', FROM - 2 * H), post('p2', 'ann-1', FROM - 3 * H)],
    [quote('a', 'p1')],
    [react('p1', 'cat', 'cat-1', 'fire', FROM + 2 * H), react('p2', 'cat', 'cat-1', 'fire', FROM + 2 * H)],
  ), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs).map((d) => d.act), ['p1']);
  assert.deepEqual(debatesOf(inputs, 'p1')[0]?.posts, [{ at: FROM - 2 * H, voice: 1 }]);
});

const turned = (b: SettlementInput, at: number): SettlementInput => ({ ...b, characters: b.characters.map((c) => (c.id === 'ann-1' ? { ...c, classes: [{ class: 'quiet', from: 0 }, { class: 'quiet', from: at }] } : c)) });

test('a character that Turns inside the window is handed the debate in both stretches, placed only in the stretch of the latest member', () => {
  const { rules, inputs } = spy();
  const b = debateBoard([post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H), post('b', 'cat-1', FROM + 9 * H)], [quote('a', 'p1'), quote('b', 'p1')]);
  settle(turned(b, FROM + 5 * H), debateWorld(rules));
  const mine = inputs.filter((i) => i.character === 'ann-1').sort((x, y) => x.from - y.from);
  assert.deepEqual(mine.map((i) => i.debates.map((d) => [d.act, d.placed])), [[['p1', false]], [['p1', true]]], 'placed by Cat\'s post at +9H, in the later stretch');
  assert.deepEqual(mine.map((i) => i.debates[0]!.paid), [{}, {}], 'no sums, no paid');
});

test('a tallied earning comes back in `tallied`, summed by Act and reason across the stretches of a Turn, whole, with 0s left out', () => {
  const tally: ClassRules = { key: 'quiet', name: 'Quiet', earn: (i) => (i.character !== 'ann-1' ? [] : [
    { reason: 'quiet.fuse', amount: 7.4, act: 'p1', tally: true },
    { reason: 'quiet.back', amount: -3, act: 'p1', tally: true },
    { reason: 'quiet.fuse', amount: 0.2, act: 'a', tally: true },
    { reason: 'quiet.plain', amount: 5, act: 'p1' },
  ]) };
  const b = debateBoard([post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H)], [quote('a', 'p1')]);
  const r = settle(turned(b, FROM + 5 * H), debateWorld(tally));
  assert.deepEqual(r.tallied, [{ act: 'p1', reason: 'quiet.back', amount: -6 }, { act: 'p1', reason: 'quiet.fuse', amount: 15 }]);
  assert.deepEqual(settle(debateBoard([post('p1', 'ann-1', FROM + 1 * H)], []), debateWorld(spy().rules)).tallied, []);
});

test('a tally is summed before it is rounded, and is the same whatever order the Acts arrive in', () => {
  const thirds: ClassRules = { key: 'quiet', name: 'Quiet', earn: (i) => (i.character !== 'ann-1' ? [] : [0, 1, 2].map(() => ({ reason: 'quiet.fuse', amount: 0.4, act: 'p1', tally: true as const }))) };
  const acts = [post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H)];
  const r = settle(debateBoard(acts, [quote('a', 'p1')]), debateWorld(thirds));
  assert.deepEqual(r.tallied, [{ act: 'p1', reason: 'quiet.fuse', amount: 1 }]);
  assert.deepEqual(settle(debateBoard([...acts].reverse(), [quote('a', 'p1')]), debateWorld(thirds)).tallied, r.tallied);
});

test('a tallied earning with no act is refused, since a tally is kept by Act', () => {
  const bare: ClassRules = { key: 'quiet', name: 'Quiet', earn: (i) => (i.character !== 'ann-1' ? [] : [{ reason: 'quiet.fuse', amount: 5, tally: true }]) };
  const b = debateBoard([post('p1', 'ann-1', FROM + 1 * H), post('a', 'bob-1', FROM + 2 * H)], [quote('a', 'p1')]);
  assert.throws(() => settle(b, debateWorld(bare)), /tallied quiet\.fuse with no act/);
});

test('a spark older than debateDays with a nonzero tallied sum and a vote moved on it in the window is handed with its paid; without the sum it is not', () => {
  const run = (tallied?: SettlementInput['tallied']) => {
    const { rules, inputs } = spy();
    settle(debateBoard(
      [post('old', 'ann-1', FROM - 6 * DAY), post('e', 'bob-1', FROM - 5 * DAY)],
      [quote('e', 'old')],
      [react('old', 'cat', 'cat-1', 'fire', FROM + 2 * H)],
      tallied ? { tallied } : {},
    ), debateWorld(rules));
    return debatesOf(inputs, 'old');
  };
  const d = run([{ act: 'old', reason: 'quiet.fuse', amount: 20 }, { act: 'old', reason: 'quiet.back', amount: -5 }]);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0]!.paid, { 'quiet.fuse': 20, 'quiet.back': -5 });
  assert.equal(d[0]!.placed, true, 'the vote placed it');
  assert.deepEqual(run(), []);
  assert.deepEqual(run([{ act: 'old', reason: 'quiet.fuse', amount: 0 }]), [], 'a zero sum is no sum');
  const still = spy();
  settle(debateBoard([post('old', 'ann-1', FROM - 6 * DAY), post('e', 'bob-1', FROM - 5 * DAY)], [quote('e', 'old')], [], { tallied: [{ act: 'old', reason: 'quiet.fuse', amount: 20 }] }), debateWorld(still.rules));
  assert.deepEqual(debatesOf(still.inputs), [], 'no vote moved on it in the window');
});

test('a half cushion on the spark\'s character that ended before the window but after the spark is 0.5; one that ended before the spark is 0; two plays give the larger', () => {
  const play = (id: string, card: string, at: number, ends: number, target: string): InputAct => ({ id, character: 'cat-1', kind: 'card', at, thread: 't1', target, card, ends });
  const run = (plays: InputAct[]) => {
    const { rules, inputs } = spy();
    settle(debateBoard([post('p1', 'ann-1', FROM - 10 * H), post('q1', 'bob-1', FROM + 1 * H), ...plays], [quote('q1', 'p1')]), debateWorld(rules));
    return debatesOf(inputs, 'p1')[0]?.cushioned;
  };
  assert.equal(run([]), 0);
  assert.equal(run([play('g1', 'half', FROM - 12 * H, FROM - 5 * H, 'p1')]), 0.5, 'on the post, ended before the window, after the spark');
  assert.equal(run([play('g1', 'half', FROM - 20 * H, FROM - 11 * H, 'p1')]), 0, 'ended before the spark');
  const quarter = { ...sugar, key: 'quarterC', gimmick: { kind: 'cushion' as const, share: 0.25 } };
  const { rules, inputs } = spy();
  const world = { ...debateWorld(rules), cards: [...debateWorld(rules).cards, quarter] };
  settle(debateBoard([post('p1', 'ann-1', FROM - 10 * H), post('q1', 'bob-1', FROM + 1 * H), play('g1', 'quarterC', FROM - 12 * H, FROM - 5 * H, 'p1'), { ...play('g2', 'half', FROM - 9 * H, FROM - 4 * H, 'ann-1'), reach: 'character' as const, on: 'ann-1', target: undefined } as InputAct], [quote('q1', 'p1')]), world);
  assert.equal(debatesOf(inputs, 'p1')[0]?.cushioned, 0.5, 'two plays: the larger');
});

test('a class is given no debates for a window post that quotes nothing and sits in no spun thread', () => {
  const { rules, inputs } = spy();
  settle(debateBoard([post('p1', 'ann-1', FROM + 1 * H), post('p2', 'bob-1', FROM + 2 * H)], []), debateWorld(rules));
  assert.deepEqual(debatesOf(inputs), []);
});

/* ---- crowd pay (docs/plans/2026-11-20-crowd-pay-design.md): a flat sum for each Act of another player a player first reacts to in the window ---- */
const crowdOf = (input: SettlementInput, settings: Partial<Instance['settings']> = {}) =>
  settle(input, { ...instance, settings: { ...instance.settings, ...settings } }).crowd;
const crowdBoard = (reactions: InputReaction[], acts: InputAct[] = [post('c1', 'bob-1', FROM + 1 * H), post('c2', 'bob-1', FROM + 2 * H), post('c3', 'bob-1', FROM + 3 * H)]): SettlementInput =>
  ({ ...base(), acts, reactions });

test('crowd pay: one Act pays one each, whether the player reacted once or three times with two masks', () => {
  assert.deepEqual(crowdOf(crowdBoard([react('c1', 'ann', 'ann-fan', 'fire', FROM + 5 * H)])), [{ player: 'ann', acts: ['c1'], amount: 2 }]);
  const three = crowdBoard([
    react('c1', 'ann', 'ann-fan', 'fire', FROM + 5 * H),
    react('c1', 'ann', 'ann-quiet', 'tea', FROM + 6 * H),
    react('c1', 'ann', 'ann-fan', 'zzz', FROM + 7 * H),
  ]);
  assert.deepEqual(crowdOf(three), [{ player: 'ann', acts: ['c1'], amount: 2 }]);
});

test('crowd pay is blind to the quadrant: a hype and a heat reaction each pay the same', () => {
  const r = crowdBoard([react('c1', 'ann', 'ann-fan', 'fire', FROM + 5 * H), react('c2', 'ann', 'ann-fan', 'tomato', FROM + 6 * H)]);
  assert.deepEqual(crowdOf(r), [{ player: 'ann', acts: ['c1', 'c2'], amount: 4 }]);
});

test('crowd pay: an Act first reacted to before the window pays nothing when reacted to again inside it', () => {
  const r = crowdBoard([
    react('c1', 'ann', 'ann-fan', 'fire', FROM - 5 * H),
    react('c1', 'ann', 'ann-fan', 'tea', FROM + 5 * H),
    react('c2', 'ann', 'ann-fan', 'fire', FROM + 6 * H),
  ], [post('c1', 'bob-1', FROM - 9 * H), post('c2', 'bob-1', FROM + 2 * H)]);
  assert.deepEqual(crowdOf(r), [{ player: 'ann', acts: ['c2'], amount: 2 }]);
});

test('crowd pay: a reaction on a System Act or an unscored staff post pays nothing', () => {
  const r: SettlementInput = {
    ...crowdBoard([
      react('sys-1', 'ann', 'ann-fan', 'fire', FROM + 5 * H),
      react('boss-post', 'ann', 'ann-fan', 'fire', FROM + 6 * H),
    ]),
    systemActs: ['sys-1'],
    unscoredTargets: [{ id: 'boss-post', kind: 'post', at: FROM + 1 * H, thread: 't1', staff: true }],
  };
  assert.deepEqual(crowdOf(r), []);
});

test('crowd pay: a reaction on an Act of the player\'s own character pays nothing', () => {
  const r = crowdBoard([react('own', 'ann', 'ann-quiet', 'fire', FROM + 5 * H), react('c1', 'ann', 'ann-quiet', 'fire', FROM + 6 * H)], [post('own', 'ann-fan', FROM + 1 * H), post('c1', 'bob-1', FROM + 2 * H)]);
  assert.deepEqual(crowdOf(r), [{ player: 'ann', acts: ['c1'], amount: 2 }]);
});

test('crowd pay: past the cap the earliest first reactions are paid, a tie in time going to the smaller Act id', () => {
  const r = crowdBoard([
    react('c3', 'ann', 'ann-fan', 'fire', FROM + 5 * H),
    react('c2', 'ann', 'ann-fan', 'fire', FROM + 7 * H),
    react('c1', 'ann', 'ann-fan', 'fire', FROM + 7 * H),
  ]);
  assert.deepEqual(crowdOf(r, { crowdPayMost: 2 }), [{ player: 'ann', acts: ['c3', 'c1'], amount: 4 }]);
  assert.deepEqual(crowdOf(r, { crowdPayMost: 10 }), [{ player: 'ann', acts: ['c3', 'c1', 'c2'], amount: 6 }]);
});

test('crowd pay: crowdPayEach 0 gives no rows', () => {
  assert.deepEqual(crowdOf(crowdBoard([react('c1', 'ann', 'ann-fan', 'fire', FROM + 5 * H)]), { crowdPayEach: 0 }), []);
});

test('crowd pay is the same in whatever order the rows arrive, and rows are sorted by player', () => {
  const r = crowdBoard([
    react('c1', 'dee', 'dee-1', 'fire', FROM + 5 * H),
    react('c2', 'ann', 'ann-fan', 'fire', FROM + 6 * H),
    react('c1', 'ann', 'ann-fan', 'zzz', FROM + 6 * H),
    react('c3', 'cat', 'cat-1', 'tea', FROM + 8 * H),
  ]);
  const want = crowdOf(r);
  assert.deepEqual(want.map((w) => w.player), ['ann', 'cat', 'dee']);
  assert.deepEqual(want[0], { player: 'ann', acts: ['c1', 'c2'], amount: 4 });
  assert.deepEqual(crowdOf({ ...r, reactions: [...r.reactions].reverse(), acts: [...r.acts].reverse(), characters: [...r.characters].reverse() }), want);
});

test('crowd pay is a wallet\'s alone: entries, standings and byClass are the same at 2 and at 0', () => {
  const r = base();
  const on = settle(r, instance);
  const off = settle(r, { ...instance, settings: { ...instance.settings, crowdPayEach: 0 } });
  assert.ok(on.crowd.length > 0 && off.crowd.length === 0);
  assert.deepEqual(on.entries, off.entries);
  assert.deepEqual(on.standings, off.standings);
  assert.deepEqual(on.byClass, off.byClass);
});

test('the estimate\'s crowd is the caller\'s row of crowd pay, never another player\'s', () => {
  // Ann and Dee each reacted to two of Bob's Acts; each is asked, and each is told only of their own.
  const r = crowdBoard([
    react('c1', 'ann', 'ann-fan', 'fire', FROM + 5 * H), react('c2', 'ann', 'ann-fan', 'fire', FROM + 6 * H),
    react('c1', 'dee', 'dee-1', 'fire', FROM + 7 * H), react('c3', 'dee', 'dee-1', 'fire', FROM + 8 * H),
  ]);
  assert.deepEqual(estimateForOwner(r, instance, 'ann').crowd, { acts: ['c1', 'c2'], amount: 4 });
  assert.deepEqual(estimateForOwner(r, instance, 'dee').crowd, { acts: ['c1', 'c3'], amount: 4 });
  assert.equal(estimateForOwner(r, instance, 'cat').crowd, null, 'a player with no crowd Acts has none');
  assert.ok(!JSON.stringify(estimateForOwner(r, instance, 'ann').crowd).includes('c3'), 'Dee\'s Act is not in Ann\'s answer');
});

/* ---- The reveal perk (class balance design, section 2): what a class marks `fromReactions` earns `revealPerk` more while the reveal is current ---- */
/** "flagged" marks the earnings a reaction caused: fire is a flagged gain, zzz a flagged loss; tea is a gain it does not mark. */
const flagged: ClassRules = {
  key: 'flagged',
  name: 'Flagged',
  earn: (input, settings) => input.received.map((r): Earning => {
    if (r.quadrant === 'excitedPositive') return { reason: 'flagged.cheer', amount: settings.vote * r.votes, votes: r.votes, fromReactions: true, act: r.act, quadrant: r.quadrant, at: r.at };
    if (r.quadrant === 'calmPositive') return { reason: 'flagged.calm', amount: settings.vote * r.votes, votes: r.votes, act: r.act, quadrant: r.quadrant, at: r.at };
    return { reason: 'flagged.sting', amount: -settings.vote * r.votes, votes: r.votes, fromReactions: true, act: r.act, quadrant: r.quadrant, at: r.at };
  }),
};
const perkWorld: Instance = { ...cushionWorld, classes: [...cushionWorld.classes, flagged], settings: { ...cushionWorld.settings, revealPerk: 0.2 } };
const perkBoard = (classes: { class: string; from: number }[], reveals: number[], reactions: InputReaction[], gimmicks: InputAct[] = []): SettlementInput =>
  flatBoard(gimmicks, reactions, [], {
    characters: [
      { id: 'tom-1', player: 'tom', classes, reveals },
      { id: 'tom-2', player: 'tom', classes: [{ class: 'quiet', from: 0 }] },
      { id: 'uma-1', player: 'uma', classes: [{ class: 'quiet', from: 0 }] },
      ...['bob', 'cat', 'dee', 'eve', 'fay'].map((p) => ({ id: `${p}-1`, player: p, classes: [{ class: 'quiet', from: 0 }] })),
    ],
  });
const perksOf = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.reason === 'reveal.perk');
const FLAG = [{ class: 'flagged', from: 0 }];

test('a revealed character earns a fifth more on a flagged gain, and nothing on an unflagged gain or a loss', () => {
  const r = settle(perkBoard(FLAG, [FROM - H], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'tea', FROM + 6 * H),
    react('tp1', 'dee', 'dee-1', 'zzz', FROM + 7 * H),
  ]), perkWorld);
  assert.deepEqual(perksOf(r).map((e) => [e.character, e.amount, e.params]), [['tom-1', 2, { share: 0.2 }]]);
  assert.equal(amountOf(r, 'tom-1', 'flagged.cheer'), 10, 'the class\'s own earning is whole');
  assert.deepEqual(r.details.filter((d) => d.reason === 'reveal.perk').map((d) => [d.act, d.quadrant, d.at, d.amount]), [['tp1', 'excitedPositive', FROM + 5 * H, 2]]);
});

test('a character never revealed earns no perk', () => {
  assert.equal(perksOf(settle(perkBoard(FLAG, [], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H)]), perkWorld)).length, 0);
});

test('a silent Turn ends the perk from the Turn\'s time, inside the window', () => {
  const turned = [{ class: 'flagged', from: 0 }, { class: 'flagged', from: FROM + 8 * H }];
  const r = settle(perkBoard(turned, [FROM - H], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'fire', FROM + 9 * H),
  ]), perkWorld);
  assert.deepEqual(r.details.filter((d) => d.reason === 'reveal.perk').map((d) => d.at), [FROM + 5 * H], 'the vote before the Turn is perked, the one after is not');
});

test('a new reveal after the Turn starts the perk again', () => {
  const turned = [{ class: 'flagged', from: 0 }, { class: 'flagged', from: FROM + 8 * H }];
  const r = settle(perkBoard(turned, [FROM - H, FROM + 10 * H], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'fire', FROM + 9 * H),
    react('tp1', 'dee', 'dee-1', 'fire', FROM + 11 * H),
  ]), perkWorld);
  assert.deepEqual(r.details.filter((d) => d.reason === 'reveal.perk').map((d) => d.at), [FROM + 5 * H, FROM + 11 * H]);
});

test('a reveal made at a Turn\'s moment is current', () => {
  const turned = [{ class: 'flagged', from: 0 }, { class: 'flagged', from: FROM + 8 * H }];
  const r = settle(perkBoard(turned, [FROM + 8 * H], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H),
    react('tp1', 'cat', 'cat-1', 'fire', FROM + 9 * H),
  ]), perkWorld);
  assert.deepEqual(r.details.filter((d) => d.reason === 'reveal.perk').map((d) => d.at), [FROM + 9 * H], 'the later vote is perked; the one before the reveal is not');
});

test('revealPerk 0 pushes nothing', () => {
  const r = settle(perkBoard(FLAG, [FROM - H], [react('tp1', 'bob', 'bob-1', 'fire', FROM + 5 * H)]), { ...perkWorld, settings: { ...perkWorld.settings, revealPerk: 0 } });
  assert.equal(perksOf(r).length, 0);
});

test('a Thick Skin up cushions the loss and gives nothing back on the perk entry', () => {
  const r = settle(perkBoard(FLAG, [FROM - H], [
    react('tp1', 'bob', 'bob-1', 'fire', FROM + 6 * H),
    react('tp1', 'cat', 'cat-1', 'zzz', FROM + 5 * H),
  ], [onTom('g1', 'softCushion', FROM + 2 * H)]), perkWorld);
  assert.deepEqual(cushionsOf(r).map((e) => e.amount), [5], 'only the class\'s own loss is cushioned');
  assert.deepEqual(perksOf(r).map((e) => e.amount), [2]);
});
