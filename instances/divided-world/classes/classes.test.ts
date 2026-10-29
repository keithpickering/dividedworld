/**
 * Divided World's classes, one test per cell of the design's section 6 table (income and
 * weakness), plus the plan's Task 4 cases. Most build a class's input directly; the ones about
 * how Acts reach a class run the whole settlement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { face } from './face.ts';
import { heel } from './heel.ts';
import { lurker } from './lurker.ts';
import { jabroni } from './jabroni.ts';
import { classes } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { estimateForOwner, settle } from '../../../engine/rules/settle.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import type {
  ClassInput, ClassRules, HeldVote, LandedCard, PlayedCard, Quadrant, ReceivedReaction, SettlementInput, SpunThread,
} from '../../../engine/rules/types.ts';

const none: Record<Quadrant, number> = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
const input = (over: Partial<ClassInput>): ClassInput => ({
  character: 'c', from: 0, to: 100, posts: [], received: [], given: [], held: [], cardsPlayed: [], cardsLanded: [], threadsSpun: [], ...over,
});
const got = (quadrant: Quadrant, votes = 1, actKind: 'post' | 'card' = 'post', act = 'a1'): ReceivedReaction => ({ act, actKind, quadrant, at: 10, votes });
const card = (over: Partial<PlayedCard>): PlayedCard => ({
  act: 'k1', card: 'whoops', alignment: 'salty', at: 5, target: 'p9', onOthers: true, votes: 0, targetVotes: 0, targetAfter: none, ...over,
});
const total = (rules: ClassRules, i: ClassInput, reason?: string) =>
  rules.earn(i, settings).filter((e) => !reason || e.reason === reason).reduce((s, e) => s + e.amount, 0);

test('the instance holds the four classes and is whole', () => {
  assert.deepEqual(classes.map((c) => c.key), ['face', 'heel', 'lurker', 'jabroni']);
  assert.deepEqual(instanceProblems(instance), []);
});

/* ---- Face ---- */
test('Face earns from excited-positive reactions on its own posts and cards', () => {
  assert.equal(total(face, input({ received: [got('excitedPositive'), got('excitedPositive', 0.5, 'card', 'k1')] })), 15);
});
test('Face earns from a Sweet card it plays on another\'s post when that post then draws excited-positive reactions', () => {
  const k = card({ alignment: 'sweet', targetAfter: { ...none, excitedPositive: 2 } });
  assert.equal(total(face, input({ cardsPlayed: [k] })), 20);
  assert.equal(total(face, input({ cardsPlayed: [{ ...k, onOthers: false }] })), 0, 'not on its own player\'s post');
  assert.equal(total(face, input({ cardsPlayed: [{ ...k, alignment: 'salty' }] })), 0, 'not a Salty card');
});
test('Face\'s weakness: bored-negative reactions on its Acts', () => {
  assert.equal(total(face, input({ received: [got('boredNegative'), got('boredNegative', 0.25, 'card', 'k1')] })), -12.5);
});
test('Face\'s weakness: its card outdrawing the post it landed on', () => {
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 3, targetVotes: 2 })] })), -20);
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 2, targetVotes: 2 })] })), 0, 'a tie is not outdrawing');
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 3, targetVotes: 1, onOthers: false })] })), 0, 'not on its own player\'s post');
});
test('Face is unmoved by the quadrants it does not read', () => {
  assert.equal(total(face, input({ received: [got('excitedNegative'), got('calmPositive')] })), 0);
});

/* ---- Heel ---- */
test('Heel earns from excited-negative reactions (heat) on its own posts and cards', () => {
  assert.equal(total(heel, input({ received: [got('excitedNegative'), got('excitedNegative', 1, 'card', 'k1')] })), 20);
});
test('Heel earns from a Salty card that outdraws the post it landed on', () => {
  assert.equal(total(heel, input({ cardsPlayed: [card({ votes: 3, targetVotes: 1 })] })), 20);
  assert.equal(total(heel, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 3, targetVotes: 1 })] })), 0, 'not a Sweet one');
  assert.equal(total(heel, input({ cardsPlayed: [card({ votes: 3, targetVotes: 1, onOthers: false })] })), 0, 'not on its own player\'s post');
});
test('Heel\'s weakness: calm-positive reactions (polite shrugs) on its Acts', () => {
  assert.equal(total(heel, input({ received: [got('calmPositive', 0.5)] })), -5);
});
test('Heel is unmoved by the quadrants it does not read', () => {
  assert.equal(total(heel, input({ received: [got('excitedPositive'), got('boredNegative')] })), 0);
});
test('a Heel\'s thunder-stealing Salty card pays and a Face\'s costs', () => {
  const thunder = input({ cardsPlayed: [card({ alignment: 'salty', votes: 4, targetVotes: 1 })] });
  assert.equal(total(heel, thunder), 20);
  assert.equal(total(face, thunder), -20);
});

/* ---- Lurker ---- */
const held = (over: Partial<HeldVote>): HeldVote => ({ act: 'p1', quadrant: 'excitedPositive', at: 10, reactedAt: 5, share: 1, rank: 1, othersBefore: 2, othersNow: 3, endsUp: 'excitedPositive', ...over });
test('Lurker earns from reacting early in the direction a post ends up, once three other players have reacted', () => {
  assert.equal(total(lurker, input({ held: [held({ rank: 3 })] })), 10, 'third to react is early');
  assert.equal(total(lurker, input({ held: [held({ rank: 4 })] })), 0, 'fourth is not');
  assert.equal(total(lurker, input({ held: [held({ endsUp: 'boredNegative' })] })), 0, 'the wrong direction pays nothing');
  assert.equal(total(lurker, input({ held: [held({ endsUp: null })] })), 0, 'a post with no direction pays nothing');
  assert.equal(total(lurker, input({ held: [held({ othersBefore: 1, othersNow: 2 })] })), 0, 'two other players are not yet a crowd');
  assert.equal(total(lurker, input({ held: [held({ othersBefore: 3, othersNow: 4 })] })), 0, 'a call is paid once, in the window its crowd arrives');
  assert.equal(total(lurker, input({ held: [held({ othersBefore: 0, othersNow: 5 })] })), 10, 'a crowd arriving at once pays');
  assert.equal(total(lurker, input({ held: [held({ share: 0.5 })] })), 5, 'a hedged call is paid the part that landed');
});
test('an override of the Lurker\'s call changes what a call pays, and the class reads every number it uses from settings', () => {
  const tuned = withOverrides(settings, { economy: { 'lurker.earlyMatch': 30, 'heel.saltyOutdraws': 50, 'face.cardOutdraws': -70, 'jabroni.saltyLanded': 40 } });
  assert.equal(lurker.earn(input({ held: [held({ rank: 1 })] }), tuned).reduce((s, e) => s + e.amount, 0), 30);
  assert.equal(heel.earn(input({ cardsPlayed: [card({ votes: 2, targetVotes: 1 })] }), tuned).find((e) => e.reason === 'heel.stoleThunder')?.amount, 50);
  assert.equal(face.earn(input({ cardsPlayed: [card({ votes: 2, targetVotes: 1 })] }), tuned).find((e) => e.reason === 'face.stoleThunder')?.amount, -70);
  assert.equal(jabroni.earn(input({ cardsLanded: [{ act: 'k', card: 'whoops', alignment: 'salty', at: 1, on: 'p' }] }), tuned)[0]?.amount, 40);
  for (const c of classes) for (const read of c.reads ?? []) { const key = typeof read === 'string' ? read : read.key; assert.ok(key in settings.economy, `${c.key} reads ${key}`); }
  // And each of the Lurker's other numbers, so none can turn back into a literal unseen.
  const lurkerTuned = withOverrides(settings, { economy: { 'lurker.crowd': 1, 'lurker.earlyPlayers': 1, 'lurker.spunThreadRepliers': 1, 'lurker.spunThread': 70, 'lurker.postsAllowed': 0, 'lurker.overPosting': -30 } });
  assert.equal(lurker.earn(input({ held: [held({ rank: 2 })] }), lurkerTuned).length, 0, 'second is no longer early');
  assert.equal(lurker.earn(input({ held: [held({ othersBefore: 0, othersNow: 1 })] }), lurkerTuned)[0]?.amount, 10, 'one other player is a crowd of one');
  assert.equal(lurker.earn(input({ threadsSpun: [spin({ repliersBefore: 0, repliersNow: 1 })] }), lurkerTuned)[0]?.amount, 70);
  assert.equal(lurker.earn(input({ posts: [{ act: 'p', at: 1 }] }), lurkerTuned)[0]?.amount, -30);
  assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'lurker.postsAllowed': -1 } }) }).join('\n'), /lurker\.postsAllowed/);
});

test('Lurker\'s early call is paid by its share, so hedging across quadrants pays a part', () => {
  const hedged = [held({ share: 1 / 3 }), held({ quadrant: 'boredNegative', share: 1 / 3 }), held({ quadrant: 'calmPositive', share: 1 / 3 })];
  assert.ok(Math.abs(total(lurker, input({ held: hedged })) - 10 / 3) < 1e-9);
});
const spin = (over: Partial<SpunThread>): SpunThread => ({ act: 's1', thread: 't', at: 10, fromOthers: true, repliersBefore: 0, repliersNow: 3, ...over });
test('Lurker earns from a thread it spins from another\'s Act once three other players reply, in the window that happens', () => {
  assert.equal(total(lurker, input({ threadsSpun: [spin({})] })), 20);
  assert.equal(total(lurker, input({ threadsSpun: [spin({ repliersNow: 2 })] })), 0, 'two is not enough');
  assert.equal(total(lurker, input({ threadsSpun: [spin({ repliersBefore: 3, repliersNow: 5 })] })), 0, 'paid once, in the window it crossed three');
  assert.equal(total(lurker, input({ threadsSpun: [spin({ repliersBefore: 2, repliersNow: 4 })] })), 20);
  assert.equal(total(lurker, input({ threadsSpun: [spin({ fromOthers: false })] })), 0, 'not from its own player\'s Act');
});
test('Lurker earns from reactions to cards it plays', () => {
  assert.equal(total(lurker, input({ received: [got('boredNegative', 1, 'card', 'k1'), got('excitedPositive', 0.5, 'card', 'k1')] })), 15);
  assert.equal(total(lurker, input({ received: [got('excitedPositive', 1, 'post')] })), 0, 'not reactions to its posts');
});
test('Lurker\'s weakness: each post beyond three in a window', () => {
  const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ act: `p${i}`, at: i }));
  assert.equal(total(lurker, input({ posts: posts(3) })), 0);
  assert.equal(total(lurker, input({ posts: posts(5) })), -20);
});

/* ---- Jabroni ---- */
const landed = (alignment: 'sweet' | 'salty' | 'pepperoni'): LandedCard => ({ act: 'k1', card: 'x', alignment, at: 5, on: 'p1' });
test('Jabroni earns from bored-negative reactions (the groan) on its own posts and cards', () => {
  assert.equal(total(jabroni, input({ received: [got('boredNegative'), got('boredNegative', 0.5, 'card', 'k1')] })), 15);
});
test('Jabroni earns from Salty cards landing on its posts (selling the L)', () => {
  assert.equal(total(jabroni, input({ cardsLanded: [landed('salty'), landed('salty')] })), 40);
  assert.equal(total(jabroni, input({ cardsLanded: [landed('sweet'), landed('pepperoni')] })), 0);
});
test('Jabroni\'s weakness: excited-positive reactions (being taken sincerely) on its Acts', () => {
  assert.equal(total(jabroni, input({ received: [got('excitedPositive', 0.5)] })), -5);
});
test('Jabroni is unmoved by the quadrants it does not read', () => {
  assert.equal(total(jabroni, input({ received: [got('excitedNegative'), got('calmPositive')] })), 0);
});

/* ---- through the settlement ---- */
/* A Salty card of the test's own, so these cases need no card of the instance's. */
const world = { ...instance, cards: [{ key: 'whoops', name: 'Whoops!', alignment: 'salty' as const, priceKey: 'whoops.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] };
const H = 3_600_000;
function board(lurkerClass = 'lurker'): SettlementInput {
  return {
    window: { id: 'w', from: 0, to: 24 * H },
    characters: [
      { id: 'lu', player: 'pl', classes: [{ class: lurkerClass, from: -1 }] },
      { id: 'he', player: 'ph', classes: [{ class: 'heel', from: -1 }] },
      { id: 'fa', player: 'pf', classes: [{ class: 'face', from: -1 }] },
      { id: 'ja', player: 'pj', classes: [{ class: 'jabroni', from: -1 }] },
    ],
    acts: [
      { id: 'p1', character: 'he', kind: 'post', at: 1 * H, thread: 't' },
      { id: 'k1', character: 'lu', kind: 'card', at: 2 * H, thread: 't', target: 'p1', card: 'whoops' },
    ],
    reactions: [
      { act: 'k1', player: 'pf', character: 'fa', kind: 'fire', at: 3 * H },
      { act: 'k1', player: 'pj', character: 'ja', kind: 'zzz', at: 3 * H },
      { act: 'p1', player: 'pl', character: 'lu', kind: 'tomato', at: 4 * H },
    ],
  };
}
const sum = (s: ReturnType<typeof settle>, character: string) => s.entries.filter((e) => e.character === character).reduce((t, e) => t + e.amount, 0);

test('reactions to a card count for the card\'s player, under their class', () => {
  const r = settle(board(), world);
  assert.equal(sum(r, 'lu'), 20, 'the Lurker: two votes on its card; its tomato on p1, alone there, calls nothing');
  assert.equal(sum(r, 'he'), 10, 'the Heel: heat from the Lurker\'s tomato, nothing from the card\'s reactions');
});

/* A Lurker's call needs a crowd (the plan's Task E; the owner's answer 15, on #4). */
function crowd(reactions: SettlementInput['reactions'], window = { id: 'w1', from: 0, to: 24 * H }, paid: SettlementInput['paid'] = []): SettlementInput {
  return {
    window,
    characters: [
      { id: 'lu', player: 'pl', classes: [{ class: 'lurker', from: -1 }] },
      ...['au', 'o1', 'o2', 'o3', 'o4'].map((id) => ({ id, player: `p-${id}`, classes: [{ class: 'face', from: -1 }] })),
    ],
    acts: Array.from({ length: 60 }, (_, i) => ({ id: `p${i + 1}`, character: 'au', kind: 'post' as const, at: i + 1, thread: 't' })),
    reactions,
    paid,
  };
}
const by = (who: string, kind: string, at: number, act = 'p1') => ({ act, player: who === 'lu' ? 'pl' : `p-${who}`, character: who, kind, at });
const called = (s: ReturnType<typeof settle>) => s.entries.filter((e) => e.character === 'lu' && e.reason === 'lurker.calledIt').reduce((t, e) => t + e.amount, 0);
const D2 = { id: 'w2', from: 24 * H, to: 48 * H };
const D3 = { id: 'w3', from: 48 * H, to: 72 * H };
const upTo = (...settled: ReturnType<typeof settle>[]) => [...new Map(settled.flatMap((s) => s.paid).map((p) => [`${p.player} ${p.act}`, p])).values()];

test('a Lurker reacting alone to a post is never paid for the call', () => {
  assert.equal(called(settle(crowd([by('lu', 'fire', H)]), world)), 0);
});

test('a Lurker\'s call is paid in the window the third other player arrives, by the direction then, and once', () => {
  const day1 = [by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'zzz', 3 * H)];
  const w1 = settle(crowd(day1), world);
  assert.equal(called(w1), 0, 'two other players are not yet a crowd');
  const day2 = [...day1, by('o3', 'fire', 25 * H)];
  const w2 = settle(crowd(day2, D2, upTo(w1)), world);
  assert.equal(called(w2), 10, 'the third arrives: the post leans excited-positive without the Lurker, as the Lurker called');
  const w3 = settle(crowd([...day2, by('o4', 'fire', 49 * H)], D3, upTo(w1, w2)), world);
  assert.equal(called(w3), 0, 'a fourth pays nothing more');
  // Had the third leaned the other way, the call is judged by the direction then, and a later turn never rescues it.
  const against = [...day1, by('o3', 'zzz', 25 * H)];
  const w2x = settle(crowd(against, D2, upTo(w1)), world);
  assert.equal(called(w2x), 0);
  assert.equal(called(settle(crowd([...against, by('o4', 'fire', 49 * H), by('o4', 'heart', 49 * H)], D3, upTo(w1, w2x)), world)), 0);
});

test('where a post ends up is read without the calling Lurker\'s own vote', () => {
  // Without the Lurker, one excited-positive, one bored-negative and one calm-positive: no direction,
  // though the Lurker's own fire would have tipped it.
  assert.equal(called(settle(crowd([by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'zzz', 3 * H), by('o3', 'tea', 4 * H)]), world)), 0);
  assert.equal(called(settle(crowd([by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'fire', 3 * H), by('o3', 'tea', 4 * H)]), world)), 10);
});

test('a hedged call is paid its exact share: a third of 7.5 is 2.5, which rounds to 3', () => {
  const tuned = { ...world, settings: withOverrides(world.settings, { economy: { 'lurker.earlyMatch': 7.5 } }) };
  const hedged = [by('lu', 'fire', H), by('lu', 'tea', H + 1), by('lu', 'zzz', H + 2), by('o1', 'fire', 2 * H), by('o2', 'fire', 3 * H), by('o3', 'fire', 4 * H)];
  assert.equal(called(settle(crowd(hedged), tuned)), 3);
});

test('a Lurker reacting first to sixty fresh posts earns nothing from them alone', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => by('lu', 'fire', 2 * H + i, `p${i + 1}`));
  assert.deepEqual(settle(crowd(sixty), world).entries.filter((e) => e.character === 'lu'), []);
});

test('a Lurker\'s cards and reactions never count as posting', () => {
  const b = board();
  const many: SettlementInput = {
    ...b,
    acts: [...b.acts, ...[2, 3, 4, 5].map((n) => ({ id: `k${n}`, character: 'lu', kind: 'card' as const, at: (2 + n) * H, thread: 't', target: 'p1', card: 'whoops' }))],
    reactions: [...b.reactions, ...['fire', 'tea'].map((kind) => ({ act: 'p1', player: 'pl', character: 'lu', kind, at: 5 * H }))],
  };
  const r = settle(many, world);
  assert.equal(r.entries.filter((e) => e.reason === 'lurker.postedTooMuch').length, 0);
});

test('a Lurker\'s fourth post costs', () => {
  const b = board();
  const posts: SettlementInput = { ...b, acts: [...b.acts, ...[1, 2, 3, 4].map((n) => ({ id: `lp${n}`, character: 'lu', kind: 'post' as const, at: (5 + n) * H, thread: 't' }))] };
  assert.equal(settle(posts, world).entries.find((e) => e.reason === 'lurker.postedTooMuch')?.amount, -10);
});

test('reactions to a card count for the card\'s player under whichever class they hold', () => {
  const asHeel = settle(board('heel'), world);
  // The card's player is now a Heel: the fire and the zzz on its card are not heat and pay nothing,
  // but its Salty card drew two votes to its target's one, which a Heel is paid for.
  assert.deepEqual(asHeel.entries.filter((e) => e.character === 'lu').map((e) => [e.reason, e.amount]), [['heel.stoleThunder', 20]]);
  const b = board('heel');
  const heated: SettlementInput = { ...b, reactions: [...b.reactions, { act: 'k1', player: 'pf', character: 'fa', kind: 'tomato', at: 5 * H }] };
  assert.equal(sum(settle(heated, world), 'lu'), 25, 'and the Face\'s player\'s tomato on the card is half their vote, of heat');
});

test('a Lurker\'s spun thread is not a post', () => {
  const b = board();
  const spins: SettlementInput = {
    ...b,
    acts: [
      ...b.acts,
      ...[1, 2, 3].map((n) => ({ id: `lp${n}`, character: 'lu', kind: 'post' as const, at: (5 + n) * H, thread: 't' })),
      { id: 'ls', character: 'lu', kind: 'spin' as const, at: 10 * H, thread: 'spun', target: 'p1' },
    ],
  };
  assert.equal(settle(spins, world).entries.filter((e) => e.reason === 'lurker.postedTooMuch').length, 0);
});

test('each class names what it paid in its own words, with the Act and the quadrant, for the player\'s log', () => {
  const all = input({
    posts: [1, 2, 3, 4].map((n) => ({ act: `p${n}`, at: n })),
    received: [got('excitedPositive', 1, 'post', 'p1'), got('excitedNegative', 1, 'post', 'p2'), got('calmPositive', 1, 'post', 'p3'), got('boredNegative', 1, 'card', 'k1')],
    held: [held({ act: 'x1' })],
    cardsPlayed: [card({ act: 'k1', alignment: 'salty', votes: 3, targetVotes: 1 }), card({ act: 'k2', alignment: 'sweet', targetAfter: { ...none, excitedPositive: 1 } })],
    cardsLanded: [landed('salty')],
    threadsSpun: [spin({ act: 's1' })],
  });
  const shape = (rules: ClassRules) => rules.earn(all, settings).map((e) => [e.reason, e.act, e.quadrant ?? null]);
  assert.deepEqual(shape(face), [
    ['face.cheered', 'p1', 'excitedPositive'], ['face.liftedAPost', 'k2', 'excitedPositive'],
    ['face.boredTheRoom', 'k1', 'boredNegative'], ['face.stoleThunder', 'k1', null],
  ]);
  assert.deepEqual(shape(heel), [['heel.drewHeat', 'p2', 'excitedNegative'], ['heel.stoleThunder', 'k1', null], ['heel.shrugged', 'p3', 'calmPositive']]);
  assert.deepEqual(shape(lurker), [['lurker.calledIt', 'x1', 'excitedPositive'], ['lurker.spunAThread', 's1', null], ['lurker.cardDrew', 'k1', 'boredNegative'], ['lurker.postedTooMuch', 'p4', null]]);
  assert.deepEqual(shape(jabroni), [['jabroni.drewTheGroan', 'k1', 'boredNegative'], ['jabroni.soldTheL', 'k1', null], ['jabroni.takenSincerely', 'p1', 'excitedPositive']]);
});

test('a Lurker is never paid for a reaction with no rank', () => {
  assert.equal(total(lurker, input({ held: [held({ rank: 0 })] })), 0);
});

test('the estimate hangs a lifted post on the votes the lift counts, after the card, never on the card\'s own', () => {
  const H = 3_600_000;
  const FROM = 100 * H;
  const lines = estimateForOwner({
    window: { id: 'w', from: FROM, to: FROM + 24 * H },
    characters: [
      { id: 'ann-face', player: 'ann', classes: [{ class: 'face', from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'heel', from: 0 }] },
      { id: 'cat-1', player: 'cat', classes: [{ class: 'heel', from: 0 }] },
      { id: 'dee-1', player: 'dee', classes: [{ class: 'heel', from: 0 }] },
    ],
    acts: [
      { id: 'p', character: 'bob-1', kind: 'post', at: FROM + 1 * H, thread: 't' },
      { id: 'card', character: 'ann-face', kind: 'card', at: FROM + 2 * H, thread: 't', target: 'p', card: 'stick-around' },
    ],
    reactions: [
      // Before Ann's card, Dee's cheer on the post lifts nothing; after it, Cat's does.
      { act: 'p', player: 'cat', character: 'cat-1', kind: 'fire', at: FROM + 3 * H },
      { act: 'p', player: 'dee', character: 'dee-1', kind: 'fire', at: FROM + 1.5 * H },
      // Neither Bob's own cheer on his post nor one at the card's very instant lifts it: settle
      // counts neither, so no line hangs on them.
      { act: 'p', player: 'bob', character: 'bob-1', kind: 'fire', at: FROM + 4 * H },
      { act: 'p', player: 'dee', character: 'dee-1', kind: 'fire', at: FROM + 2 * H },
      // Dee also cheers Ann's card itself, which is the card's draw, not the post's lift.
      { act: 'card', player: 'dee', character: 'dee-1', kind: 'fire', at: FROM + 9 * H },
    ],
  }, instance, 'ann').lines;
  assert.deepEqual(lines.filter((l) => l.reason === 'face.liftedAPost').map((l) => [l.act, l.at, l.amount]), [['card', FROM + 3 * H, 10]]);
});

test('the estimate shows a Lurker\'s call on the Lurker\'s own reaction, whole, never apportioned over the crowd', () => {
  const lines = estimateForOwner(crowd([by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'fire', 3 * H), by('o3', 'fire', 4 * H)]), world, 'pl').lines;
  assert.deepEqual(lines.filter((l) => l.reason === 'lurker.calledIt').map((l) => [l.act, l.quadrant, l.at, l.amount]), [['p1', 'excitedPositive', H, 10]]);
});

test('the estimate shows each of a Lurker\'s reactions on a post at its own call: the early one whole, the late one nothing', () => {
  // The fire comes first; the heart, after three others, ranks fifth and calls nothing. Split
  // evenly, each would show half the fire's call.
  const lines = estimateForOwner(crowd([by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'fire', 3 * H), by('o3', 'fire', 4 * H), by('lu', 'heart', 5 * H)]), world, 'pl').lines;
  assert.deepEqual(lines.filter((l) => l.reason === 'lurker.calledIt').map((l) => [l.act, l.quadrant, l.at, l.amount]), [['p1', 'excitedPositive', H, 10]]);
});

test('the estimate shows two reactions in one quadrant as two lines, each a whole vote at its own time', () => {
  const lines = estimateForOwner(crowd([by('o1', 'fire', H), by('o2', 'heart', 2 * H)]), world, 'p-au').lines;
  assert.deepEqual(lines.filter((l) => l.reason === 'face.cheered').map((l) => [l.act, l.quadrant, l.at, l.amount]), [['p1', 'excitedPositive', H, 10], ['p1', 'excitedPositive', 2 * H, 10]]);
});
