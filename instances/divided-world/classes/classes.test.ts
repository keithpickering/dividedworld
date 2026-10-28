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
import { settle } from '../../../engine/rules/settle.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import type {
  ClassInput, ClassRules, GivenReaction, LandedCard, PlayedCard, Quadrant, ReceivedReaction, SettlementInput, SpunThread,
} from '../../../engine/rules/types.ts';

const none: Record<Quadrant, number> = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
const input = (over: Partial<ClassInput>): ClassInput => ({
  character: 'c', from: 0, to: 100, posts: [], received: [], given: [], cardsPlayed: [], cardsLanded: [], threadsSpun: [], ...over,
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
const gave = (over: Partial<GivenReaction>): GivenReaction => ({ act: 'p1', quadrant: 'excitedPositive', at: 10, share: 1, rank: 1, endsUp: 'excitedPositive', ...over });
test('Lurker earns from reacting early in the direction a post ends up', () => {
  assert.equal(total(lurker, input({ given: [gave({ rank: 3 })] })), 10, 'third to react is early');
  assert.equal(total(lurker, input({ given: [gave({ rank: 4 })] })), 0, 'fourth is not');
  assert.equal(total(lurker, input({ given: [gave({ endsUp: 'boredNegative' })] })), 0, 'the wrong direction pays nothing');
  assert.equal(total(lurker, input({ given: [gave({ endsUp: null })] })), 0, 'a post with no direction pays nothing');
});
test('Lurker\'s early call is paid by its share, so hedging across quadrants pays a part', () => {
  const hedged = [gave({ share: 1 / 3 }), gave({ quadrant: 'boredNegative', share: 1 / 3 }), gave({ quadrant: 'calmPositive', share: 1 / 3 })];
  assert.ok(Math.abs(total(lurker, input({ given: hedged })) - 10 / 3) < 1e-9);
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
const world = { ...instance, cards: [{ key: 'whoops', name: 'Whoops!', alignment: 'salty' as const, basePrice: 100, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] };
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
  assert.equal(sum(r, 'lu'), 20 + 10, 'the Lurker: two votes on its card, and its early, matching tomato on p1');
  assert.equal(sum(r, 'he'), 10, 'the Heel: heat from the Lurker\'s tomato, nothing from the card\'s reactions');
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
    given: [gave({ act: 'x1' })],
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
  assert.equal(total(lurker, input({ given: [gave({ rank: 0 })] })), 0);
});
