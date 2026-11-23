/**
 * Divided World's classes, one test per cell of the design's section 6 table (income and
 * weakness), plus the plan's Task 4 cases. Most build a class's input directly; the ones about
 * how Acts reach a class run the whole settlement.
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { face } from './face.ts';
import { heel } from './heel.ts';
import { lurker } from './lurker.ts';
import { jabroni } from './jabroni.ts';
import { technician } from './technician.ts';
import { tweener, crossedAt, refundAt } from './tweener.ts';
import { classes } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { estimateForOwner, settle } from '../../../engine/rules/settle.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import type {
  ClassInput, ClassRules, HeldVote, SparkedDebate, LandedCard, PlayedCard, Quadrant, ReceivedReaction, SettlementInput, SpunThread, Standing,
} from '../../../engine/rules/types.ts';

const none: Record<Quadrant, number> = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
const input = (over: Partial<ClassInput>): ClassInput => ({
  character: 'c', from: 0, to: 100, posts: [], received: [], given: [], held: [], cardsPlayed: [], cardsLanded: [], threadsSpun: [], standings: [], debates: [], ...over,
});
const got = (quadrant: Quadrant, votes = 1, actKind: 'post' | 'card' = 'post', act = 'a1', actAt = 0, kind = 'reaction'): ReceivedReaction => ({ act, actKind, quadrant, at: 10, actAt, kind, votes });
const card = (over: Partial<PlayedCard>): PlayedCard => ({
  act: 'k1', card: 'whoops', alignment: 'salty', at: 5, target: 'p9', onOthers: true, votes: 0, targetVotes: 0, targetAfter: none, drawnAfter: null, targetLean: 0, ...over,
  readsAs: over.readsAs ?? over.alignment ?? 'salty',
});
const total = (rules: ClassRules, i: ClassInput, reason?: string) =>
  rules.earn(i, settings).filter((e) => !reason || e.reason === reason).reduce((s, e) => s + e.amount, 0);

test('the instance holds its classes, in the order every screen draws them, and is whole', () => {
  assert.deepEqual(classes.map((c) => c.key), ['face', 'heel', 'jabroni', 'technician', 'tweener', 'lurker']);
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
  assert.equal(total(face, input({ cardsPlayed: [{ ...k, alignment: 'salty', readsAs: 'salty' }] })), 0, 'not a Salty card');
});
test('Face\'s weakness: bored-negative reactions on its Acts', () => {
  assert.equal(total(face, input({ received: [got('boredNegative'), got('boredNegative', 0.25, 'card', 'k1')] })), -12.5);
});
test('Face\'s weakness: its card outdrawing the post it landed on', () => {
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 3, targetVotes: 2 })] })), -20);
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 2, targetVotes: 2 })] })), 0, 'a tie is not outdrawing');
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'sweet', votes: 3, targetVotes: 1, onOthers: false })] })), 0, 'not on its own player\'s post');
});
test("Face's outdrawn loss is marked a window's loss: an Act, and no one reaction's time or votes", () => {
  const [e] = face.earn(input({ cardsPlayed: [card({ alignment: 'sweet', votes: 3, targetVotes: 2 })] }), settings).filter((x) => x.reason === 'face.stoleThunder');
  assert.equal(e?.ofWindow, true);
  assert.equal(e?.act, 'k1');
  assert.equal(e?.at, undefined);
  assert.equal(e?.votes, undefined);
});
/* Stolen thunder is charged only where there was thunder the room valued (docs/plans/2026-11-18-face-thunder-design.md, section 3). */
const outdrew = (over: Partial<PlayedCard>) => input({ cardsPlayed: [card({ votes: 2, targetVotes: 1, ...over })] });
test('Face\'s weakness: outdrawing a post the room cheered, split on or said nothing about costs; one it booed costs nothing', () => {
  assert.equal(total(face, outdrew({ targetLean: 1 }), 'face.stoleThunder'), -20, 'well received');
  assert.equal(total(face, outdrew({ targetLean: 0 }), 'face.stoleThunder'), -20, 'a tie, or no reaction at all');
  assert.equal(total(face, outdrew({ targetLean: -1 }), 'face.stoleThunder'), 0, 'booed');
  assert.equal(total(face, input({ cardsPlayed: [card({ votes: 1, targetVotes: 1, targetLean: 1 })] }), 'face.stoleThunder'), 0, 'not outdrawn');
});
test('Face\'s weakness: outdrawing a cast that reads as Salty costs nothing, whatever the room made of it; any other cast costs', () => {
  assert.equal(total(face, outdrew({ targetLean: 1, targetReadsAs: 'salty' }), 'face.stoleThunder'), 0);
  assert.equal(total(face, outdrew({ targetLean: 1, targetReadsAs: 'sweet' }), 'face.stoleThunder'), -20);
  assert.equal(total(face, outdrew({ targetLean: 1, targetReadsAs: 'pepperoni' }), 'face.stoleThunder'), -20);
});
test('a Heel\'s stolen thunder pays at every lean, and for a Salty cast too', () => {
  for (const over of [{ targetLean: 1 }, { targetLean: 0 }, { targetLean: -1 }, { targetLean: 1, targetReadsAs: 'salty' as const }]) {
    assert.equal(total(heel, outdrew(over), 'heel.stoleThunder'), 20, JSON.stringify(over));
  }
});
test('Face is unmoved by the quadrants it does not read', () => {
  assert.equal(total(face, input({ received: [got('excitedNegative'), got('calmPositive')] })), 0);
});

/* ---- Heel ---- */
test('Heel earns from excited-negative reactions (heat) on its own posts and cards', () => {
  assert.equal(total(heel, input({ received: [got('excitedNegative'), got('excitedNegative', 1, 'card', 'k1')] })), 40, 'two votes of heat, each paying two votes\' worth');
});
test('a Heel\'s heat pays double and its shrug costs one: one heat and one calm vote net 2 * vote - vote', () => {
  assert.equal(total(heel, input({ received: [got('excitedNegative'), got('calmPositive')] })), 2 * settings.vote - settings.vote);
  const tuned = withOverrides(settings, { economy: { 'heel.heatVotes': 1.5 } });
  assert.equal(heel.earn(input({ received: [got('excitedNegative')] }), tuned).find((e) => e.reason === 'heel.drewHeat')?.amount, 15);
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
  assert.equal(total(lurker, input({ held: [held({ endsUp: 'boredNegative' })] }), 'lurker.calledIt'), 0, 'the wrong direction pays nothing');
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
  assert.equal(jabroni.earn(input({ cardsLanded: [{ act: 'k', card: 'whoops', alignment: 'salty', readsAs: 'salty', at: 1, on: 'p' }] }), tuned)[0]?.amount, 40);
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
  assert.ok(Math.abs(total(lurker, input({ held: hedged }), 'lurker.calledIt') - 10 / 3) < 1e-9);
});
test('Lurker\'s early call in another quadrant than where the post ends up costs what a right one pays', () => {
  assert.equal(total(lurker, input({ held: [held({ endsUp: 'boredNegative' })] }), 'lurker.misread'), -10, 'a miss costs a hit\'s pay');
  assert.equal(total(lurker, input({ held: [held({ endsUp: 'excitedPositive' })] }), 'lurker.misread'), 0, 'a hit costs nothing');
  assert.equal(total(lurker, input({ held: [held({ endsUp: 'boredNegative', share: 0.5 })] })), -5, 'a miss is by its share');
  const [e] = lurker.earn(input({ held: [held({ endsUp: 'boredNegative' })] }), settings);
  assert.equal(e?.reason, 'lurker.misread');
  assert.equal(e?.votes, undefined, 'not a reaction the character received, so no cushion reads it');
});
test('a post that ties costs the Lurker nothing', () => {
  assert.equal(total(lurker, input({ held: [held({ endsUp: null })] })), 0);
});
test('a vote split over three quadrants, one of them right, nets minus a third of the early match', () => {
  const split = [held({ share: 1 / 3 }), held({ quadrant: 'boredNegative', share: 1 / 3 }), held({ quadrant: 'calmPositive', share: 1 / 3 })];
  assert.ok(Math.abs(total(lurker, input({ held: split })) - (-10 / 3)) < 1e-9);
});
test('a miss before the crowd arrives costs nothing yet, and costs in the window it arrives', () => {
  const miss = { endsUp: 'boredNegative' as const };
  assert.equal(total(lurker, input({ held: [held({ ...miss, othersBefore: 1, othersNow: 2 })] })), 0, 'two other players are not yet a crowd');
  assert.equal(total(lurker, input({ held: [held({ ...miss, othersBefore: 2, othersNow: 3 })] })), -10, 'the window the crowd arrives');
  assert.equal(total(lurker, input({ held: [held({ ...miss, othersBefore: 3, othersNow: 4 })] })), 0, 'and not again');
  assert.equal(total(lurker, input({ held: [held({ ...miss, rank: 4 })] })), 0, 'a late vote is no early call');
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
const landed = (alignment: 'sweet' | 'salty' | 'pepperoni', readsAs = alignment): LandedCard => ({ act: 'k1', card: 'x', alignment, readsAs, at: 5, on: 'p1' });
test('Jabroni earns from bored-negative reactions (the groan) on its own posts and cards', () => {
  assert.equal(total(jabroni, input({ received: [got('boredNegative'), got('boredNegative', 0.5, 'card', 'k1')] })), 30, 'a vote and a half of groan, each paying two votes\' worth');
});
test('a Jabroni\'s groan pays double and being taken sincerely costs one: one groan and one hype vote net 2 * vote - vote', () => {
  assert.equal(total(jabroni, input({ received: [got('boredNegative'), got('excitedPositive')] })), 2 * settings.vote - settings.vote);
  const tuned = withOverrides(settings, { economy: { 'jabroni.groanVotes': 1.5 } });
  assert.equal(jabroni.earn(input({ received: [got('boredNegative')] }), tuned).find((e) => e.reason === 'jabroni.drewTheGroan')?.amount, 15);
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

/* ---- Technician ---- */
const DAY = 86_400_000;
/** A calm vote landing at 10 on an Act posted `age` milliseconds before it. */
const calmAged = (age: number, votes = 1, actKind: 'post' | 'card' = 'post') => got('calmPositive', votes, actKind, 'a1', 10 - age);
test('Technician earns from calm-positive reactions on its own posts and cards (Respected)', () => {
  assert.equal(total(technician, input({ received: [got('calmPositive'), got('calmPositive', 0.5, 'card', 'k1')] }), 'technician.respected'), 15);
});
test('Technician\'s weakness: excited-negative reactions (heat) on its posts and cards (Dragged in)', () => {
  assert.equal(total(technician, input({ received: [got('excitedNegative'), got('excitedNegative', 0.5, 'card', 'k1')] }), 'technician.draggedIn'), -15);
});
test('Technician is unmoved by hype and the groan', () => {
  assert.equal(total(technician, input({ received: [got('excitedPositive'), got('boredNegative'), got('excitedPositive', 1, 'card', 'k1')] })), 0);
});
test('Evergreen pays on a post reacted to 3 days old to the millisecond, and not one millisecond before', () => {
  assert.equal(total(technician, input({ received: [calmAged(3 * DAY)] }), 'technician.evergreen'), 5);
  assert.equal(total(technician, input({ received: [calmAged(3 * DAY - 1)] }), 'technician.evergreen'), 0);
  assert.equal(total(technician, input({ received: [calmAged(3 * DAY)] })), 15, 'on top of Respected');
});
test('Evergreen never pays on a card, however old', () => {
  assert.equal(total(technician, input({ received: [calmAged(400 * DAY, 1, 'card')] }), 'technician.evergreen'), 0);
});
test('Evergreen pays only calm-positive votes', () => {
  assert.equal(total(technician, input({ received: [{ ...calmAged(9 * DAY), quadrant: 'excitedPositive' }] }), 'technician.evergreen'), 0);
});
test('a calm vote withdrawn from an old post takes the bonus back; from a young post, nothing', () => {
  assert.equal(total(technician, input({ received: [calmAged(5 * DAY, -0.5)] }), 'technician.evergreen'), -2.5);
  assert.equal(total(technician, input({ received: [calmAged(DAY, -0.5)] }), 'technician.evergreen'), 0);
});
test('Evergreen names the Act, the quadrant and the reaction\'s time, for the log and the estimate', () => {
  const e = technician.earn(input({ received: [calmAged(4 * DAY)] }), settings).find((x) => x.reason === 'technician.evergreen');
  assert.deepEqual(e, { reason: 'technician.evergreen', amount: 5, act: 'a1', quadrant: 'calmPositive', at: 10, kind: 'reaction', votes: 1, fromReactions: true });
});
test('an override of the Technician\'s numbers changes the age and the amount', () => {
  const sooner = withOverrides(settings, { economy: { 'technician.evergreenDays': 1 } });
  assert.equal(total(technician, input({ received: [calmAged(2 * DAY)] }), 'technician.evergreen'), 0);
  assert.equal(technician.earn(input({ received: [calmAged(2 * DAY)] }), sooner).find((x) => x.reason === 'technician.evergreen')?.amount, 5);
  const richer = withOverrides(settings, { economy: { 'technician.evergreen': 12 } });
  assert.equal(technician.earn(input({ received: [calmAged(3 * DAY)] }), richer).find((x) => x.reason === 'technician.evergreen')?.amount, 12);
});
test('an instance missing the Technician\'s age, or holding it at 0 or 2.5, is refused', () => {
  const { 'technician.evergreenDays': _, ...without } = settings.economy;
  assert.match(instanceProblems({ ...instance, settings: { ...settings, economy: without } }).join('\n'), /technician\.evergreenDays/);
  for (const days of [0, 2.5]) {
    assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'technician.evergreenDays': days } }) }).join('\n'), /technician\.evergreenDays/, String(days));
  }
  const { 'technician.evergreen': __, ...noBonus } = settings.economy;
  assert.match(instanceProblems({ ...instance, settings: { ...settings, economy: noBonus } }).join('\n'), /technician\.evergreen\b/);
});

/* ---- through the settlement ---- */
/* A Salty card of the test's own, so these cases need no card of the instance's. */
const world = { ...instance, cards: [{ key: 'whoops', name: 'Whoops!', alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] };
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
      { act: 'k1', player: 'pj', character: 'ja', kind: 'facepalm', at: 3 * H },
      { act: 'p1', player: 'pl', character: 'lu', kind: 'tomato', at: 4 * H },
    ],
  };
}
const sum = (s: ReturnType<typeof settle>, character: string) => s.entries.filter((e) => e.character === character).reduce((t, e) => t + e.amount, 0);

test('reactions to a card count for the card\'s player, under their class', () => {
  const r = settle(board(), world);
  assert.equal(sum(r, 'lu'), 20, 'the Lurker: two votes on its card; its tomato on p1, alone there, calls nothing');
  assert.equal(sum(r, 'he'), 20, 'the Heel: heat from the Lurker\'s tomato, paid two votes\' worth, nothing from the card\'s reactions');
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
  const day1 = [by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'facepalm', 3 * H)];
  const w1 = settle(crowd(day1), world);
  assert.equal(called(w1), 0, 'two other players are not yet a crowd');
  const day2 = [...day1, by('o3', 'fire', 25 * H)];
  const w2 = settle(crowd(day2, D2, upTo(w1)), world);
  assert.equal(called(w2), 10, 'the third arrives: the post leans excited-positive without the Lurker, as the Lurker called');
  const w3 = settle(crowd([...day2, by('o4', 'fire', 49 * H)], D3, upTo(w1, w2)), world);
  assert.equal(called(w3), 0, 'a fourth pays nothing more');
  // Had the third leaned the other way, the call is judged by the direction then, and a later turn never rescues it.
  const against = [...day1, by('o3', 'facepalm', 25 * H)];
  const w2x = settle(crowd(against, D2, upTo(w1)), world);
  assert.equal(called(w2x), 0);
  assert.equal(called(settle(crowd([...against, by('o4', 'fire', 49 * H), by('o4', 'heart', 49 * H)], D3, upTo(w1, w2x)), world)), 0);
});

test('where a post ends up is read without the calling Lurker\'s own vote', () => {
  // Without the Lurker, one excited-positive, one bored-negative and one calm-positive: no direction,
  // though the Lurker's own fire would have tipped it.
  assert.equal(called(settle(crowd([by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'facepalm', 3 * H), by('o3', 'folded-hands', 4 * H)]), world)), 0);
  assert.equal(called(settle(crowd([by('lu', 'fire', H), by('o1', 'fire', 2 * H), by('o2', 'fire', 3 * H), by('o3', 'folded-hands', 4 * H)]), world)), 10);
});

test('a hedged call is paid its exact share: a third of 7.5 is 2.5, which rounds to 3', () => {
  const tuned = { ...world, settings: withOverrides(world.settings, { economy: { 'lurker.earlyMatch': 7.5 } }) };
  const hedged = [by('lu', 'fire', H), by('lu', 'folded-hands', H + 1), by('lu', 'facepalm', H + 2), by('o1', 'fire', 2 * H), by('o2', 'fire', 3 * H), by('o3', 'fire', 4 * H)];
  assert.equal(called(settle(crowd(hedged), tuned)), 3);
});

test('a wrong early call costs in the window the crowd arrives, and a Thick Skin up on the Lurker gives nothing back', () => {
  const lost = (s: ReturnType<typeof settle>) => s.entries.filter((e) => e.character === 'lu' && e.reason === 'lurker.misread').reduce((t, e) => t + e.amount, 0);
  const day1 = [by('lu', 'fire', H), by('o1', 'facepalm', 2 * H), by('o2', 'facepalm', 3 * H)];
  const w1 = settle(crowd(day1), world);
  assert.equal(lost(w1), 0, 'two other players are not yet a crowd');
  const day2 = [...day1, by('o3', 'facepalm', 25 * H)];
  const w2 = settle(crowd(day2, D2, upTo(w1)), world);
  assert.equal(lost(w2), -10, 'the third arrives: the post leans bored-negative without the Lurker');
  const cushion = { ...world.cards[0]!, key: 'thick', reaches: ['character'] as const, gimmick: { kind: 'cushion' as const, share: 1 } };
  const withCushion = { ...world, cards: [...world.cards, cushion] };
  const up = { id: 'c1', character: 'lu', kind: 'card' as const, at: 24 * H + 1, thread: 't', card: 'thick', reach: 'character' as const, on: 'lu', ends: 40 * H };
  const input2 = crowd(day2, D2, upTo(w1));
  const w2c = settle({ ...input2, acts: [...input2.acts, up] }, withCushion);
  assert.equal(lost(w2c), -10, 'the miss is whole under a cushion');
  assert.equal(w2c.entries.filter((e) => e.reason === 'card.cushion').length, 0, 'nothing given back');
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
    reactions: [...b.reactions, ...['fire', 'folded-hands'].map((kind) => ({ act: 'p1', player: 'pl', character: 'lu', kind, at: 5 * H }))],
  };
  const r = settle(many, world);
  assert.equal(r.entries.filter((e) => e.reason === 'lurker.postedTooMuch').length, 0);
});

test('a Lurker\'s fourth post costs', () => {
  const b = board();
  const posts: SettlementInput = { ...b, acts: [...b.acts, ...[1, 2, 3, 4].map((n) => ({ id: `lp${n}`, character: 'lu', kind: 'post' as const, at: (5 + n) * H, thread: 't' }))] };
  assert.equal(settle(posts, world).entries.find((e) => e.reason === 'lurker.postedTooMuch')?.amount, -10);
});

test('a Lurker\'s entries whose words state a number carry the number they were settled under (#57)', () => {
  const b = board();
  const posts: SettlementInput = { ...b, acts: [...b.acts, ...[1, 2, 3, 4].map((n) => ({ id: `lp${n}`, character: 'lu', kind: 'post' as const, at: (5 + n) * H, thread: 't' }))] };
  assert.deepEqual(settle(posts, world).entries.find((e) => e.reason === 'lurker.postedTooMuch')?.params, { 'lurker.postsAllowed': 3 });
  const tuned = { ...world, settings: { ...world.settings, economy: { ...world.settings.economy, 'lurker.postsAllowed': 2 } } };
  assert.deepEqual(settle(posts, tuned).entries.find((e) => e.reason === 'lurker.postedTooMuch')?.params, { 'lurker.postsAllowed': 2 });
});

test('reactions to a card count for the card\'s player under whichever class they hold', () => {
  const asHeel = settle(board('heel'), world);
  // The card's player is now a Heel: the fire and the facepalm on its card are not heat and the class pays nothing for them, so the crowd floor does
  // (2 on each whole vote; both quadrants are a Heel's neutral ones), and its Salty card drew two votes to its target's one, which a Heel is paid for.
  assert.deepEqual(asHeel.entries.filter((e) => e.character === 'lu').map((e) => [e.reason, e.amount]), [['crowd.floor', 4], ['heel.stoleThunder', 20]]);
  const b = board('heel');
  const heated: SettlementInput = { ...b, reactions: [...b.reactions, { act: 'k1', player: 'pf', character: 'fa', kind: 'tomato', at: 5 * H }] };
  // The Face's player now reacts with fire and tomato, so the fire is half their vote: 1 of crowd floor, plus 2 on the other player's whole facepalm, 3 in all (it was 2 + 2).
  assert.equal(sum(settle(heated, world), 'lu'), 33, 'and the Face\'s player\'s tomato on the card is half their vote, of heat, paid two votes\' worth, plus the crowd floor on the fire and the facepalm');
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
  const aged = input({ received: [got('calmPositive', 1, 'post', 'p3', 10 - 3 * 86_400_000), got('excitedNegative', 1, 'card', 'k1')] });
  assert.deepEqual(technician.earn(aged, settings).map((e) => [e.reason, e.act, e.quadrant ?? null]), [
    ['technician.respected', 'p3', 'calmPositive'], ['technician.evergreen', 'p3', 'calmPositive'], ['technician.draggedIn', 'k1', 'excitedNegative'],
  ]);
});

test('a calm vote on a Technician\'s 4-day-old post pays 15 hundredths under its two reasons; on a Heel\'s post it charges', () => {
  const W = { id: 'w', from: 10 * DAY, to: 11 * DAY };
  const r = settle({
    window: W,
    characters: [
      { id: 'te', player: 'pt', classes: [{ class: 'technician', from: -1 }] },
      { id: 'he', player: 'ph', classes: [{ class: 'heel', from: -1 }] },
      { id: 'fa', player: 'pf', classes: [{ class: 'face', from: -1 }] },
    ],
    acts: [
      { id: 'old', character: 'te', kind: 'post', at: 6 * DAY, thread: 't' },
      { id: 'hp', character: 'he', kind: 'post', at: 6 * DAY + 1, thread: 'u' },
    ],
    reactions: [
      { act: 'old', player: 'pf', character: 'fa', kind: 'thumbs-up', at: 10 * DAY + H },
      { act: 'hp', player: 'pf', character: 'fa', kind: 'thumbs-up', at: 10 * DAY + H },
    ],
  }, world);
  const of = (c: string, reason: string) => r.entries.filter((e) => e.character === c && e.reason === reason).reduce((t, e) => t + e.amount, 0);
  assert.equal(of('te', 'technician.respected'), 10);
  assert.equal(of('te', 'technician.evergreen'), 5);
  assert.equal(sum(r, 'te'), 15);
  assert.ok(sum(r, 'he') < 0, 'the Heel is charged for the same vote: the foil holds both ways');
});

test('the estimate shows the Technician\'s evergreen line whole at the reaction\'s own time', () => {
  const at = 10 * DAY + 3 * H;
  const lines = estimateForOwner({
    window: { id: 'w', from: 10 * DAY, to: 11 * DAY },
    characters: [
      { id: 'te', player: 'pt', classes: [{ class: 'technician', from: -1 }] },
      ...['o1', 'o2', 'o3'].map((id) => ({ id, player: `p-${id}`, classes: [{ class: 'face', from: -1 }] })),
    ],
    acts: [{ id: 'old', character: 'te', kind: 'post', at: 5 * DAY, thread: 't' }],
    reactions: [
      { act: 'old', player: 'p-o1', character: 'o1', kind: 'thumbs-up', at },
      { act: 'old', player: 'p-o2', character: 'o2', kind: 'thumbs-up', at: at + H },
      { act: 'old', player: 'p-o3', character: 'o3', kind: 'thumbs-up', at: at + 2 * H },
    ],
  }, world, 'pt').lines;
  assert.deepEqual(lines.filter((l) => l.reason === 'technician.evergreen').map((l) => [l.act, l.quadrant, l.at, l.amount]), [
    ['old', 'calmPositive', at, 5], ['old', 'calmPositive', at + H, 5], ['old', 'calmPositive', at + 2 * H, 5],
  ]);
});

test('a Lurker is never paid for a reaction with no rank', () => {
  assert.equal(total(lurker, input({ held: [held({ rank: 0 })] })), 0);
});

test('the estimate hangs a lifted post on the votes the lift counts, after the card, never on the card\'s own', () => {
  const H = 3_600_000;
  const FROM = 100 * H;
  const input = {
    window: { id: 'w', from: FROM, to: FROM + 24 * H },
    characters: [
      { id: 'ann-face', player: 'ann', classes: [{ class: 'face', from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'heel', from: 0 }] },
      { id: 'cat-1', player: 'cat', classes: [{ class: 'heel', from: 0 }] },
      { id: 'dee-1', player: 'dee', classes: [{ class: 'heel', from: 0 }] },
    ],
    acts: [
      { id: 'p', character: 'bob-1', kind: 'post' as const, at: FROM + 1 * H, thread: 't' },
      { id: 'card', character: 'ann-face', kind: 'card' as const, at: FROM + 2 * H, thread: 't', target: 'p', card: 'stick-around' },
    ],
    reactions: [
      // Before Ann's card, Dee's cheer on the post lifts nothing; after it, Cat's does.
      { act: 'p', player: 'cat', character: 'cat-1', kind: 'fire', at: FROM + 3 * H },
      { act: 'p', player: 'dee', character: 'dee-1', kind: 'fire', at: FROM + 1.5 * H },
      // Neither Bob's own cheer on his post nor one at the card's very instant lifts it, read as the settlement reads them: settle
      // counts neither, so no line hangs on them.
      { act: 'p', player: 'bob', character: 'bob-1', kind: 'fire', at: FROM + 4 * H },
      { act: 'p', player: 'dee', character: 'dee-1', kind: 'fire', at: FROM + 2 * H },
      // Dee also cheers Ann's card itself, which is the card's draw, not the post's lift.
      { act: 'card', player: 'dee', character: 'dee-1', kind: 'fire', at: FROM + 9 * H },
    ],
  };
  const lifts = (i: typeof input) => estimateForOwner(i, instance, 'ann').lines.filter((l) => l.reason === 'face.liftedAPost').map((l) => [l.act, l.at, l.amount]);
  assert.deepEqual(lifts(input), [['card', FROM + 3 * H, 10]]);
  // The estimate's own input (estimate_input) keys every reaction but the caller's by its mask, so Bob's cheer on his own post is
  // anyone's there, and lifts the card: the live estimate counts what the settlement will not (the core loop design, section 1).
  const asEstimated = {
    ...input,
    characters: [...input.characters, { id: 'mask-b', player: 'key-b', classes: [] }],
    reactions: input.reactions.map((r) => (r.player === 'bob' ? { ...r, player: 'key-b', character: 'mask-b' } : r)),
  };
  assert.deepEqual(lifts(asEstimated), [['card', FROM + 3 * H, 10], ['card', FROM + 4 * H, 10]]);
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

test('the estimate shows two reactions on a Lurker\'s card as two lines, each a whole vote at its own time', () => {
  const b = board();
  const lines = estimateForOwner({ ...b, reactions: [{ act: 'k1', player: 'pf', character: 'fa', kind: 'fire', at: 3 * H }, { act: 'k1', player: 'pj', character: 'ja', kind: 'heart', at: 5 * H }] }, world, 'pl').lines;
  assert.deepEqual(lines.filter((l) => l.reason === 'lurker.cardDrew').map((l) => [l.act, l.quadrant, l.at, l.amount]), [['k1', 'excitedPositive', 3 * H, 10], ['k1', 'excitedPositive', 5 * H, 10]]);
});

/* A reveal of a class (the class reveal design, section 4): an Act like any of its character's. */
test('a Face\'s reveal drawing a cheer pays the Face\'s cheer; a Lurker\'s reveal is no post toward its limit', () => {
  const W = { id: 'w1', from: 0, to: 24 * H };
  const reveal = (id: string, character: string, at: number) => ({ id, character, kind: 'unmask' as const, at, thread: 't' });
  const posts = (character: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${character}-p${i}`, character, kind: 'post' as const, at: (i + 2) * H, thread: 't' }));
  const r = settle({
    window: W,
    characters: [
      { id: 'fa', player: 'pf', classes: [{ class: 'face', from: -1 }] },
      { id: 'lu', player: 'pl', classes: [{ class: 'lurker', from: -1 }] },
      { id: 'he', player: 'ph', classes: [{ class: 'heel', from: -1 }] },
    ],
    // The Lurker posts as many times as it may, and reveals besides.
    acts: [reveal('u-fa', 'fa', H), reveal('u-lu', 'lu', H), ...posts('lu', settings.economy['lurker.postsAllowed']!)],
    reactions: [{ act: 'u-fa', player: 'ph', character: 'he', kind: 'fire', at: 2 * H }],
  }, world);
  assert.deepEqual(r.entries.filter((e) => e.character === 'fa').map((e) => [e.reason, e.amount]), [['face.cheered', settings.vote]]);
  assert.deepEqual(r.entries.filter((e) => e.character === 'lu' && e.reason === 'lurker.postedTooMuch'), []);
});

/* A card on a staff post earns its caster by class (#122; docs/plans/2026-11-01-card-plays-plan.md, Task 5): the Boss's post is
   the target it is judged against, and the Boss earns nothing. */
function onTheBoss(card: { by: string; card: string }, cardVoters: string[], postVoters: string[], postKind = 'facepalm'): SettlementInput {
  const voters = ['v1', 'v2', 'v3', 'v4', 'v5'];
  return {
    window: { id: 'w', from: 0, to: 24 * H },
    characters: [
      { id: 'he', player: 'ph', classes: [{ class: 'heel', from: -1 }] },
      { id: 'fa', player: 'pf', classes: [{ class: 'face', from: -1 }] },
      ...voters.map((v) => ({ id: v, player: `p-${v}`, classes: [{ class: 'jabroni', from: -1 }] })),
    ],
    acts: [{ id: 'k1', character: card.by, kind: 'card', at: 2 * H, thread: 't', target: 'boss-post', card: card.card }],
    unscoredTargets: [{ id: 'boss-post', kind: 'post', at: 1 * H, thread: 't', staff: true }],
    reactions: [
      ...cardVoters.map((v, i) => ({ act: 'k1', player: `p-${v}`, character: v, kind: 'facepalm', at: (3 + i) * H })),
      ...postVoters.map((v, i) => ({ act: 'boss-post', player: `p-${v}`, character: v, kind: postKind, at: (3 + i) * H })),
    ],
  };
}

test('a Heel\'s Salty card that draws more than a Boss\'s post earns the Heel\'s +0.20, and the Boss earns nothing', () => {
  const r = settle(onTheBoss({ by: 'he', card: 'whoops' }, ['v1', 'v2'], ['v3']), world);
  assert.deepEqual(r.entries.filter((e) => e.reason === 'heel.stoleThunder').map((e) => [e.character, e.amount]), [['he', 20]]);
  assert.ok(r.entries.every((e) => ['he', 'fa', 'v1', 'v2', 'v3'].includes(e.character)), 'no entry for the Boss or its post');
  assert.equal(settle(onTheBoss({ by: 'he', card: 'whoops' }, ['v1'], ['v2', 'v3']), world).entries.filter((e) => e.reason === 'heel.stoleThunder').length, 0, 'outdrawn by the Boss\'s post, it steals nothing');
});

test('a Face\'s Sweet card that draws more than a Boss\'s post the room cheered pays the Face\'s −0.20; one the room booed, nothing', () => {
  const sweet = { ...world, cards: [...world.cards, { ...world.cards[0]!, key: 'stick-around', name: 'Stick Around', alignment: 'sweet' as const }] };
  const r = settle(onTheBoss({ by: 'fa', card: 'stick-around' }, ['v1', 'v2'], ['v3'], 'fire'), sweet);
  assert.deepEqual(r.entries.filter((e) => e.reason === 'face.stoleThunder').map((e) => [e.character, e.amount]), [['fa', -20]]);
  assert.equal(settle(onTheBoss({ by: 'fa', card: 'stick-around' }, ['v1'], ['v2', 'v3'], 'fire'), sweet).entries.filter((e) => e.reason === 'face.stoleThunder').length, 0, 'outdrawn by the Boss\'s post, it pays nothing');
  assert.equal(settle(onTheBoss({ by: 'fa', card: 'stick-around' }, ['v1', 'v2', 'v3'], ['v4', 'v5']), sweet).entries.filter((e) => e.reason === 'face.stoleThunder').length, 0, 'the Boss\'s post booed by two: upstaging it is the Face doing its job');
});

/* Cards beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 6): a Heel's Salty card on a character has no target post to
   outdraw, so it earns no outdraw bonus, however its own reactions go; the same card on a post that it outdraws does. */
test('a Heel\'s Salty character card earns no outdraw bonus', () => {
  const heelCard = (over: Record<string, unknown>): SettlementInput => ({
    window: { id: 'w', from: 0, to: 24 * H },
    characters: [
      { id: 'he', player: 'ph', classes: [{ class: 'heel', from: -1 }] },
      { id: 'fa', player: 'pf', classes: [{ class: 'face', from: -1 }] },
      { id: 'ja', player: 'pj', classes: [{ class: 'jabroni', from: -1 }] },
    ],
    acts: [
      { id: 'p1', character: 'fa', kind: 'post', at: 1 * H, thread: 't' },
      { id: 'k1', character: 'he', kind: 'card', at: 2 * H, thread: 't', card: 'whoops', ...over },
    ],
    reactions: [{ act: 'k1', player: 'pj', character: 'ja', kind: 'fire', at: 3 * H }],
  });
  const bonus = (s: ReturnType<typeof settle>) => s.entries.filter((e) => e.character === 'he' && e.reason === 'heel.stoleThunder').length;
  assert.equal(bonus(settle(heelCard({ target: 'p1' }), world)), 1, 'on a post it outdraws, it earns the bonus');
  assert.equal(bonus(settle(heelCard({ reach: 'character' }), world)), 0, 'on a character, nothing to outdraw');
});

/* ---- The room decides: a Pepperoni card read as the alignment its reactions lean (the Autocorrect design, section 8) ---- */
test('a Pepperoni card that read as Salty on a Jabroni\'s post sells the L; one that read as Sweet, or stayed Pepperoni, does not', () => {
  assert.equal(total(jabroni, input({ cardsLanded: [landed('pepperoni', 'salty')] }), 'jabroni.soldTheL'), 20);
  assert.equal(total(jabroni, input({ cardsLanded: [landed('pepperoni', 'sweet'), landed('pepperoni')] }), 'jabroni.soldTheL'), 0);
});
test('a Pepperoni card that read as Salty and outdrew the post pays a Heel; one that stayed Pepperoni does not', () => {
  assert.equal(total(heel, input({ cardsPlayed: [card({ alignment: 'pepperoni', readsAs: 'salty', votes: 2, targetVotes: 1 })] }), 'heel.stoleThunder'), 20);
  assert.equal(total(heel, input({ cardsPlayed: [card({ alignment: 'pepperoni', readsAs: 'pepperoni', votes: 2, targetVotes: 1 })] }), 'heel.stoleThunder'), 0);
});
test('a Pepperoni card that read as Sweet lifts another\'s post for a Face; one that read as Salty does not', () => {
  const lift = { alignment: 'pepperoni' as const, targetAfter: { ...none, excitedPositive: 2 } };
  assert.equal(total(face, input({ cardsPlayed: [card({ ...lift, readsAs: 'sweet' })] }), 'face.liftedAPost'), 20);
  assert.equal(total(face, input({ cardsPlayed: [card({ ...lift, readsAs: 'salty' })] }), 'face.liftedAPost'), 0);
});
test('settled whole: a Pepperoni card drawing groans on a Jabroni\'s post sells the L; drawing cheers, it does not', () => {
  const pep = { key: 'pep', name: 'Pep', alignment: 'pepperoni' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
  const pepWorld = { ...world, cards: [...world.cards, pep] };
  const b = board();
  const onJa = (kind: string): SettlementInput => ({
    ...b,
    acts: [...b.acts, { id: 'jp', character: 'ja', kind: 'post', at: 5 * H, thread: 't' }, { id: 'kp', character: 'he', kind: 'card', at: 6 * H, thread: 't', target: 'jp', card: 'pep' }],
    reactions: [...b.reactions, { act: 'kp', player: 'pf', character: 'fa', kind, at: 7 * H }, { act: 'kp', player: 'pl', character: 'lu', kind, at: 7 * H }],
  });
  const sold = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.character === 'ja' && e.reason === 'jabroni.soldTheL').length;
  assert.equal(sold(settle(onJa('facepalm'), pepWorld)), 1);
  assert.equal(sold(settle(onJa('fire'), pepWorld)), 0);
});
test('settled whole: a Jabroni\'s own second mask groaning at a Pepperoni card on the Jabroni\'s post sells no L (#170)', () => {
  const pep = { key: 'pep', name: 'Pep', alignment: 'pepperoni' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
  const pepWorld = { ...world, cards: [...world.cards, pep] };
  const b = board();
  const r = settle({
    ...b,
    characters: [...b.characters, { id: 'ja2', player: 'pj', classes: [{ class: 'face', from: -1 }] }],
    acts: [...b.acts, { id: 'jp', character: 'ja', kind: 'post', at: 5 * H, thread: 't' }, { id: 'kp', character: 'he', kind: 'card', at: 6 * H, thread: 't', target: 'jp', card: 'pep' }],
    reactions: [...b.reactions, { act: 'kp', player: 'pj', character: 'ja2', kind: 'facepalm', at: 7 * H }],
  }, pepWorld);
  assert.equal(r.entries.filter((e) => e.character === 'ja' && e.reason === 'jabroni.soldTheL').length, 0);
});
test('a Pepperoni card that stayed Pepperoni (a tie) lifts nothing for a Face', () => {
  assert.equal(total(face, input({ cardsPlayed: [card({ alignment: 'pepperoni', readsAs: 'pepperoni', targetAfter: { ...none, excitedPositive: 2 } })] }), 'face.liftedAPost'), 0);
});
test('settled whole: a Pepperoni card drawing heat that outdraws the post pays a Heel; one cheered pays a Face for the lift after it', () => {
  const pep = { key: 'pep', name: 'Pep', alignment: 'pepperoni' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
  const pepWorld = { ...world, cards: [...world.cards, pep] };
  const b = board();
  const cast = (by: string, kind: string, lift: boolean): SettlementInput => ({
    ...b,
    acts: [...b.acts, { id: 'jp', character: 'ja', kind: 'post', at: 5 * H, thread: 't' }, { id: 'kp', character: by, kind: 'card', at: 6 * H, thread: 't', target: 'jp', card: 'pep' }],
    reactions: [...b.reactions,
      ...[['pl', 'lu'], ['pj', 'ja']].filter(([p]) => p !== b.characters.find((c) => c.id === by)!.player).map(([player, character]) => ({ act: 'kp', player: player!, character: character!, kind, at: 7 * H })),
      ...(lift ? [{ act: 'jp', player: 'pl', character: 'lu', kind: 'fire', at: 8 * H }] : [])],
  });
  const paid = (r: ReturnType<typeof settle>, who: string, reason: string) => r.entries.filter((e) => e.character === who && e.reason === reason).length;
  assert.equal(paid(settle(cast('he', 'tomato', false), pepWorld), 'he', 'heel.stoleThunder'), 1, 'heat on it, outdrawing the post: Salty, and a Heel is paid');
  assert.equal(paid(settle(cast('he', 'fire', false), pepWorld), 'he', 'heel.stoleThunder'), 0, 'cheered, it reads as Sweet: no thunder stolen');
  assert.equal(paid(settle(cast('fa', 'fire', true), pepWorld), 'fa', 'face.liftedAPost'), 1, 'cheered, it reads as Sweet, and the post\'s cheer after it lifts it for a Face');
  assert.equal(paid(settle(cast('fa', 'facepalm', true), pepWorld), 'fa', 'face.liftedAPost'), 0, 'groaned at, it reads as Salty: no lift');
});

/* A Reversal's spring settles on what sprang it (`by`): the cast it caught, or a staff visit. A face-down Move's spring stays on its own post (#420). */
const reversal = (key: string, alignment: 'salty' | 'sweet', on: 'cast' | 'visit') => ({ ...world.cards[0]!, key, name: key, alignment, play: 'set' as const, trap: { trigger: { on } } });
test('settled whole: a Salty spring catching another player\'s cast that it outdraws pays a Heel; catching its own other mask\'s cast pays nothing', () => {
  const b = board();
  const spring = (castBy: string): SettlementInput => ({
    ...b,
    characters: [...b.characters, { id: 'he2', player: 'ph', classes: [{ class: 'face', from: -1 }] }],
    acts: [...b.acts,
      { id: 'hp', character: 'he', kind: 'post', at: 5 * H, thread: 't' },
      { id: 'cast', character: castBy, kind: 'card', at: 6 * H, thread: 't', target: 'hp', card: 'whoops' },
      { id: 'sp', character: 'he', kind: 'spring', at: 7 * H, thread: 't', target: 'hp', card: 'counter', by: 'cast' }],
    reactions: [...b.reactions, { act: 'sp', player: 'pl', character: 'lu', kind: 'tomato', at: 8 * H }, { act: 'sp', player: 'pj', character: 'ja', kind: 'tomato', at: 8 * H }],
  });
  const stole = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.character === 'he' && e.reason === 'heel.stoleThunder').length;
  const counterWorld = { ...world, cards: [...world.cards, reversal('counter', 'salty', 'cast')] };
  assert.equal(stole(settle(spring('fa'), counterWorld)), 1, 'another player\'s cast, outdrawn by the spring');
  assert.equal(stole(settle(spring('he2'), counterWorld)), 0, 'the setter\'s own other mask\'s cast');
});
test('settled whole: a Face\'s Sweet spring that outdraws the Salty cast it caught is not charged; one that outdraws a Sweet cast is', () => {
  const b = board();
  const saveWorld = { ...world, cards: [...world.cards, reversal('save', 'sweet', 'cast'), { ...world.cards[0]!, key: 'stick-around', name: 'Stick Around', alignment: 'sweet' as const }] };
  const save = (cast: string): SettlementInput => ({
    ...b,
    acts: [...b.acts,
      { id: 'fp', character: 'fa', kind: 'post', at: 5 * H, thread: 't' },
      { id: 'cast', character: 'he', kind: 'card', at: 6 * H, thread: 't', target: 'fp', card: cast },
      { id: 'sp', character: 'fa', kind: 'spring', at: 7 * H, thread: 't', target: 'fp', card: 'save', by: 'cast' }],
    // The room cheers the save; nobody reacts to the cast itself.
    reactions: [...b.reactions, { act: 'sp', player: 'pl', character: 'lu', kind: 'fire', at: 8 * H }, { act: 'sp', player: 'pj', character: 'ja', kind: 'fire', at: 8 * H }],
  });
  const charged = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.character === 'fa' && e.reason === 'face.stoleThunder').map((e) => e.amount);
  assert.deepEqual(charged(settle(save('whoops'), saveWorld)), [], 'the other player swung first, with a Salty play');
  assert.deepEqual(charged(settle(save('stick-around'), saveWorld)), [-20], 'upstaging a Sweet play is the case the weakness is for');
});
test('settled whole: a face-down Salty Move that lands by a Jabroni\'s quote sells one L, and its spring steals no thunder', () => {
  const b = board();
  const input: SettlementInput = {
    ...b,
    acts: [...b.acts,
      { id: 'hp', character: 'he', kind: 'post', at: 5 * H, thread: 't' },
      { id: 'jq', character: 'ja', kind: 'post', at: 6 * H, thread: 't' },
      // The quote springs the back on the Heel's own post, and the spring lands the card on the quoting post.
      { id: 'sp', character: 'he', kind: 'spring', at: 6 * H, thread: 't', target: 'hp', card: 'whoops', by: 'jq' },
      { id: 'laid', character: 'he', kind: 'card', at: 6 * H, thread: 't', target: 'jq', card: 'whoops' }],
    reactions: [...b.reactions, { act: 'sp', player: 'pl', character: 'lu', kind: 'tomato', at: 8 * H }, { act: 'sp', player: 'pf', character: 'fa', kind: 'tomato', at: 8 * H }],
  };
  const entries = (r: { entries: readonly { character: string; reason: string; amount: number }[] }, who: string, reason: string) => r.entries.filter((e) => e.character === who && e.reason === reason);
  const r = settle(input, world);
  assert.equal(entries(r, 'ja', 'jabroni.soldTheL').reduce((t, e) => t + e.amount, 0), economyOf(settings, 'jabroni.saltyLanded'), 'one Salty card landed on the Jabroni, not the card and its spring');
  assert.equal(entries(r, 'he', 'heel.stoleThunder').length, 0, 'the spring is on the Heel\'s own post, so its reactions outdraw nothing of the Jabroni\'s');
  assert.equal(entries(estimateForOwner(input, world, 'pj'), 'ja', 'jabroni.soldTheL').reduce((t, e) => t + e.amount, 0), economyOf(settings, 'jabroni.saltyLanded'), 'the estimate counts one landing too');
});
test('settled whole: a Sweet spring on a staff visit that draws hype pays a Face, and its estimate values the visit\'s reactions', () => {
  const b = board();
  const sweetWorld = { ...world, cards: [...world.cards, reversal('sweetie', 'sweet', 'visit')] };
  const input: SettlementInput = {
    ...b,
    acts: [...b.acts, { id: 'fp', character: 'fa', kind: 'post', at: 5 * H, thread: 't' }, { id: 'sp', character: 'fa', kind: 'spring', at: 6 * H, thread: 't', target: 'fp', card: 'sweetie', by: 'visit1' }],
    unscoredTargets: [{ id: 'visit1', kind: 'post', at: 4 * H, thread: 't', staff: true }],
    reactions: [...b.reactions, { act: 'visit1', player: 'pl', character: 'lu', kind: 'fire', at: 7 * H }, { act: 'visit1', player: 'pj', character: 'ja', kind: 'fire', at: 8 * H }],
  };
  const r = settle(input, sweetWorld);
  assert.equal(r.entries.filter((e) => e.character === 'fa' && e.reason === 'face.liftedAPost').reduce((t, e) => t + e.amount, 0), 2 * settings.vote);
  const lines = estimateForOwner(input, sweetWorld, 'pf').lines.filter((l) => l.reason === 'face.liftedAPost');
  assert.deepEqual(lines.map((l) => l.at), [7 * H, 8 * H], 'one line per cheer on the visit, so the lift is valued on the Act its reactions are on');
});

/* ---- Tweener ---- */
const lean = (q: 'excitedPositive' | 'excitedNegative', n: number, share = 1): Standing[] =>
  Array.from({ length: n }, () => ({ ...none, [q]: share }));
const room = (hype: number, heat: number): Standing[] => [...lean('excitedPositive', hype), ...lean('excitedNegative', heat)];
const standing = (before: readonly Standing[], now: readonly Standing[]): ClassInput['standings'][number] =>
  ({ act: 'a1', actKind: 'post', at: 10, before, now });
const split = (before: readonly Standing[], now: readonly Standing[]) =>
  total(tweener, input({ standings: [standing(before, now)] }), 'tweener.splitTheRoom');

test('Tweener splits the room: pays twice the smaller side, new this window', () => {
  assert.equal(split([], room(6, 6)), 12 * settings.vote);
  assert.equal(split([], room(10, 2)), 4 * settings.vote);
  assert.equal(split([], room(12, 0)), 0);
});
test('Tweener counts each player once: one player\'s half-and-half hedge pays nothing', () => {
  assert.equal(split([], [{ ...none, excitedPositive: 0.5, excitedNegative: 0.5 }]), 0);
});
test('Tweener counts a player by net lean: 🔥🔥🍅 from one player and 🍅 from another is hype 1/3, heat 1', () => {
  const now: Standing[] = [{ ...none, excitedPositive: 2 / 3, excitedNegative: 1 / 3 }, { ...none, excitedNegative: 1 }];
  assert.ok(Math.abs(split([], now) - (2 / 3) * settings.vote) < 1e-9);
});
test('Tweener is paid only the change since the window began', () => {
  assert.equal(split(room(6, 6), [...room(6, 6), ...lean('excitedPositive', 6)]), 0);
  assert.equal(split([...lean('excitedPositive', 10), ...lean('excitedNegative', 2)], room(10, 6)), 8 * settings.vote);
  assert.equal(split(room(6, 6), [...lean('excitedPositive', 7), ...lean('excitedNegative', 5)]), -2 * settings.vote);
});
test('Tweener\'s heat vote moving to hype takes its part back', () => {
  assert.equal(split(room(5, 5), room(6, 4)), -2 * settings.vote);
});
test('Tweener shrugged off: calm-positive and bored-negative votes cost half a vote, excited costs nothing', () => {
  assert.equal(total(tweener, input({ received: [got('calmPositive', 2), got('boredNegative', 1)] })), -1.5 * settings.vote);
  assert.equal(total(tweener, input({ received: [got('excitedPositive', 3), got('excitedNegative', 3)] })), 0);
});
test('Tweener stirred the pot on another\'s post, not its own, and not with nobody drawn', () => {
  const drawn = { at: 8, now: room(3, 3) };
  const stir = (c: Partial<PlayedCard>) => total(tweener, input({ cardsPlayed: [card({ drawnAfter: drawn, ...c })] }), 'tweener.stirredThePot');
  assert.equal(stir({}), 6 * settings.vote);
  assert.equal(stir({ onOthers: false }), 0);
  assert.equal(stir({ drawnAfter: null }), 0);
});
test('Tweener\'s lines scale with the vote', () => {
  const i = input({ standings: [standing([], room(6, 6))], received: [got('calmPositive')], cardsPlayed: [card({ drawnAfter: { at: 8, now: room(3, 3) } })] });
  const at = (vote: number) => tweener.earn(i, { ...settings, vote }).map((e) => e.amount);
  assert.deepEqual(at(20), at(10).map((a) => a * 2));
  assert.equal(at(10).length, 3);
});

const twWorld = (): Pick<SettlementInput, 'characters'> => ({
  characters: [
    { id: 'tw', player: 'pt', classes: [{ class: 'tweener', from: -1 }] },
    { id: 'tw2', player: 'pt', classes: [{ class: 'face', from: -1 }] },
    ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, player: `p-${id}`, classes: [{ class: 'heel', from: -1 }] })),
  ],
});
const twPaid = (r: ReturnType<typeof settle>, reason: string) => r.entries.filter((e) => e.character === 'tw' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
const twBy = (who: string, kind: string, at: number, act: string) => ({ act, player: `p-${who}`, character: who, kind, at });
test('settled whole: a Tweener\'s post drawing hype and heat pays twice the smaller side, then only the difference when it grows; a hedger counts nothing', () => {
  const acts = [{ id: 'tp', character: 'tw', kind: 'post' as const, at: 1 * H, thread: 't' }];
  const w1 = settle({
    window: { id: 'w1', from: 0, to: 24 * H }, ...twWorld(), acts,
    reactions: [twBy('a', 'fire', 2 * H, 'tp'), twBy('b', 'tomato', 3 * H, 'tp'), twBy('c', 'fire', 4 * H, 'tp'), twBy('c', 'tomato', 4 * H, 'tp')],
  }, world);
  assert.equal(twPaid(w1, 'tweener.splitTheRoom'), 2 * settings.vote, 'one of each side is 1, and the player hedging both ways adds nothing to either');
  const w2 = settle({
    window: D2, ...twWorld(), acts, paid: upTo(w1),
    reactions: [twBy('a', 'fire', 2 * H, 'tp'), twBy('b', 'tomato', 3 * H, 'tp'), twBy('c', 'fire', 4 * H, 'tp'), twBy('c', 'tomato', 4 * H, 'tp'), twBy('d', 'fire', 25 * H, 'tp'), twBy('e', 'tomato', 26 * H, 'tp')],
  }, world);
  assert.equal(twPaid(w2, 'tweener.splitTheRoom'), 2 * settings.vote, 'the smaller side grew from 1 to 2: only the difference is paid');
});
test('settled whole: a Tweener\'s card pays twice the smaller side of the players who arrived after it, never its own player\'s or the author\'s', () => {
  const r = settle({
    window: { id: 'w', from: 0, to: 24 * H }, ...twWorld(),
    acts: [
      { id: 'p1', character: 'a', kind: 'post', at: 1 * H, thread: 't' },
      { id: 'k1', character: 'tw', kind: 'card', at: 2 * H, thread: 't', target: 'p1', card: 'whoops' },
    ],
    reactions: [
      twBy('b', 'fire', 3 * H, 'p1'), twBy('c', 'tomato', 4 * H, 'p1'),
      { act: 'p1', player: 'pt', character: 'tw2', kind: 'tomato', at: 5 * H },
      { act: 'p1', player: 'p-a', character: 'a', kind: 'fire', at: 5 * H },
    ],
  }, world);
  assert.equal(twPaid(r, 'tweener.stirredThePot'), 2 * settings.vote);
});

/* ---- Tweener: lit the fuse, and outvoted (docs/plans/2026-11-18-tweener-catalyst-plan.md, Task 3) ---- */
const spark = (voices: readonly number[], over: Partial<SparkedDebate> = {}): SparkedDebate => ({
  act: 's1', at: 0, posts: voices.map((voice, i) => ({ at: (i + 1) * H, voice })), inOwnDebate: false,
  standing: { before: [], now: [] }, cushioned: 0, paid: {}, placed: true, ...over,
});
const calm = (n: number, weight = 1): Standing[] => Array.from({ length: n }, () => ({ ...none, calmPositive: weight }));
const fuse = (debates: readonly SparkedDebate[], over: Partial<ClassInput> = {}, s = settings) =>
  tweener.earn(input({ from: 0, to: 100 * H, debates, ...over }), s).filter((e) => e.reason === 'tweener.litTheFuse');
const outvoted = (debates: readonly SparkedDebate[], over: Partial<ClassInput> = {}, s = settings) =>
  tweener.earn(input({ from: 0, to: 100 * H, debates, ...over }), s).filter((e) => e.reason === 'tweener.outvoted');
const sumOf = (es: readonly { amount: number }[]) => es.reduce((t, e) => t + e.amount, 0);
/** A spark in a later window than its crossing, as the store hands it: what the earlier windows tallied on it is the refund standing at the stretch's start. */
const afterPaying = (voices: readonly number[], before: Standing[], now: Standing[], over: Partial<SparkedDebate> = {}): SparkedDebate => {
  const d = spark(voices, { standing: { before, now }, ...over });
  return { ...d, paid: { 'tweener.litTheFuse': 20, 'tweener.outvoted': refundAt(d, 24 * H, before, settings) } };
};

test('a spark pays when it holds three other players, two of them back, at the time that happened', () => {
  const [e, ...more] = fuse([spark([1, 2, 1, 2, 3])]);
  assert.equal(more.length, 0);
  assert.equal(e?.amount, 20);
  assert.equal(e?.at, 5 * H);
  assert.equal(e?.act, 's1');
  assert.deepEqual(e?.params, { 'tweener.catalystVoices': 3, 'tweener.catalystReturned': 2, debateDays: 3 });
  assert.equal(crossedAt(spark([1, 2, 1, 2, 3]), 3, 2), 5 * H);
  assert.equal(crossedAt(spark([1, 2, 3]), 3, 2), null);
});
test('three players and nobody back, or two back and no third player, pays nothing', () => {
  assert.equal(sumOf(fuse([spark([1, 2, 3])])), 0);
  assert.equal(sumOf(fuse([spark([1, 2, 1, 2])])), 0);
});
test('the author\'s player posting in the debate before it crossed voids the spark for good; after it, nothing is taken back', () => {
  assert.equal(sumOf(fuse([spark([1, 2, 1, 0, 2, 3])])), 0);
  assert.equal(sumOf(fuse([spark([1, 2, 1, 2, 3, 0])])), 20);
  assert.equal(sumOf(fuse([spark([0, 1, 2, 1, 2, 3])])), 0);
});
test('a spark crossing three days and a second after it was posted pays nothing; a second before, it pays', () => {
  const at = (late: number) => spark([1, 2, 1, 2, 3], { posts: [1, 2, 1, 2, 3].map((voice, i) => ({ at: i < 4 ? (i + 1) * H : 3 * DAY + late, voice })) });
  assert.equal(sumOf(fuse([at(1000)])), 0);
  assert.equal(sumOf(fuse([at(-1000)])), 20);
});
test('a spark that crossed before the stretch pays nothing in it: it paid in its own window', () => {
  assert.equal(sumOf(fuse([spark([1, 2, 1, 2, 3, 3])], { from: 5.5 * H })), 0);
  assert.equal(sumOf(fuse([spark([1, 2, 1, 2, 3, 3])], { from: 5 * H })), 20, 'a stretch is open at its start');
  assert.equal(sumOf(fuse([spark([1, 2, 1, 2, 3, 3])], { to: 5 * H })), 0, 'and closed at its end');
});
test('a post inside the debate of an earlier post of its own player is never a spark', () => {
  assert.equal(sumOf(fuse([spark([1, 2, 1, 2, 3], { inOwnDebate: true })])), 0);
});
test('a character\'s sparks crossing in one window pay 20, 10, 5, in the order they crossed', () => {
  const late = spark([1, 2, 1, 2, 3], { act: 'c' });
  const early = spark([1, 2, 1, 2, 3], { act: 'a', posts: [1, 2, 1, 2, 3].map((voice, i) => ({ at: (i + 1) * 0.5 * H, voice })) });
  const tie = spark([1, 2, 1, 2, 3], { act: 'b' });
  const paid = fuse([late, tie, early]);
  assert.deepEqual(paid.map((e) => [e.act, e.amount]), [['a', 20], ['b', 10], ['c', 5]]);
  assert.equal(sumOf(fuse([late, tie, early], {}, { ...settings, halving: 0.25 })), 20 + 5 + 1.25);
});
test('Lit the fuse reads its numbers from the settings and says the ones it used', () => {
  const tuned = withOverrides({ ...settings, debateDays: 1 }, { economy: { 'tweener.catalyst': 30, 'tweener.catalystVoices': 2, 'tweener.catalystReturned': 1 } });
  const [e] = fuse([spark([1, 2, 1])], {}, tuned);
  assert.equal(e?.amount, 30);
  assert.equal(e?.at, 3 * H);
  assert.deepEqual(e?.params, { 'tweener.catalystVoices': 2, 'tweener.catalystReturned': 1, debateDays: 1 });
  assert.equal(sumOf(fuse([spark([1, 2, 1], { posts: [{ at: DAY, voice: 1 }, { at: DAY, voice: 2 }, { at: DAY, voice: 1 }] })], {}, tuned)), 0, 'a day is debateDays: too late');
  assert.equal(tweener.reads?.length, 3);
});

test('Outvoted: in the window the spark pays, the players arguing give back the nods, one for one', () => {
  const four = outvoted([spark([1, 2, 1, 2, 3], { standing: { before: [], now: calm(4) } })]);
  assert.equal(sumOf(four), 15, 'four calm votes cost 20, three voices allow 15');
  assert.equal(four[0]?.reason, 'tweener.outvoted');
  assert.equal(four[0]?.act, 's1');
  assert.equal('votes' in four[0]!, false, 'it carries no votes, so no cushion reads it');
  assert.equal(sumOf(outvoted([spark([1, 2, 1, 2, 3, 4], { standing: { before: [], now: calm(2) } })])), 10, 'two calm cost 10, four voices allow 20');
  assert.equal(sumOf(outvoted([spark([1, 2, 1, 2], { standing: { before: [], now: calm(4) } })])), 0, 'a spark that never paid');
  assert.equal(sumOf(outvoted([spark([1, 2, 1, 0, 2, 3], { standing: { before: [], now: calm(4) } })])), 0, 'voided');
  assert.equal(sumOf(outvoted([spark([1, 2, 1, 2, 3], { inOwnDebate: true, standing: { before: [], now: calm(4) } })])), 0);
});
test('Outvoted is paid only in the stretch the debate is placed in; an unplaced stretch still pays the crossing inside it', () => {
  const d = spark([1, 2, 1, 2, 3, 4], { placed: false, standing: { before: [], now: calm(2) } });
  assert.deepEqual(outvoted([d]), [], 'unplaced: no refund, so a Turn inside the window never pays it twice');
  assert.equal(sumOf(fuse([d])), 20, 'unplaced: the crossing inside it still pays');
  assert.equal(sumOf(outvoted([{ ...d, placed: true }])), 10);
});
test('Outvoted moves with the debate and the nods in a later window, and takes back what a nod that moved away had given', () => {
  const later = (voices: number[], before: Standing[], now: Standing[], over: Partial<SparkedDebate> = {}) =>
    sumOf(outvoted([afterPaying(voices, before, now, over)], { from: 24 * H }));
  const withFourth = [1, 2, 1, 2, 3, 4].map((v, i) => ({ at: i < 5 ? (i + 1) * H : 30 * H, voice: v }));
  assert.equal(later([], calm(4), calm(4), { posts: withFourth }), 5, 'a fourth voice with four nods standing');
  assert.equal(later([1, 2, 1, 2, 3, 4], calm(2), calm(3)), 5, 'a third nod with four voices');
  assert.equal(later([1, 2, 1, 2, 3, 4], calm(4), [...calm(3), { ...none, excitedPositive: 1 }]), -5, 'a nod that moved to hype');
  assert.equal(outvoted([afterPaying([1, 2, 1, 2, 3, 4], calm(4), calm(4))], { from: 24 * H }).length, 0, 'nothing changing gives nothing');
});
test('a voice whose only post is after debateDays adds no allowance', () => {
  const d = spark([1, 2, 1, 2, 3, 4], { posts: [1, 2, 1, 2, 3, 4].map((voice, i) => ({ at: i < 5 ? (i + 1) * H : 3 * DAY + H, voice })) });
  assert.equal(refundAt(d, 100 * H, calm(4), settings), 15);
  assert.equal(refundAt(spark([1, 2, 1, 2, 3, 4]), 100 * H, calm(4), settings), 20);
});
test('refundAt is the refund standing, and the shrugs on a halved vote cost, and give back, half as much', () => {
  const d = spark([1, 2, 1, 2, 3, 4]);
  assert.equal(refundAt(d, 4 * H, calm(4), settings), 10, 'two voices by 4H; whether the spark has paid is for the stretch to say');
  assert.equal(refundAt(d, 6 * H, calm(4), settings), 20);
  assert.equal(refundAt(d, 100 * H, calm(4, 0.5), settings), 10);
  assert.equal(refundAt(d, 100 * H, [{ ...none, boredNegative: 1 }, { ...none, excitedPositive: 1 }], settings), 5);
});
test('Outvoted is stamped at the latest member inside the stretch, never after its end', () => {
  const d = spark([1, 2, 1, 2, 3, 4], { standing: { before: [], now: calm(4) } });
  assert.equal(outvoted([d], { from: 0, to: 5.5 * H })[0]?.at, 5 * H, 'the sixth post is at 6H, after the stretch closed at 5.5H');
  const paid = { ...d, paid: { 'tweener.litTheFuse': 20 } };
  assert.equal(outvoted([paid], { from: 5.5 * H, to: 5.75 * H })[0]?.at, 5.75 * H, 'no member in the stretch: its end');
});
test('Outvoted reads the vote and debateDays from the settings', () => {
  const d = spark([1, 2, 1, 2, 3, 4], { standing: { before: [], now: calm(4) } });
  assert.equal(sumOf(outvoted([d], {}, { ...settings, vote: 20 })), 40, 'four calm votes of 20 cost 40, four voices allow 40');
  const late = spark([1, 2, 1, 2, 3, 4], { standing: { before: [], now: calm(4) }, posts: [1, 2, 1, 2, 3, 4].map((voice, i) => ({ at: i < 5 ? (i + 1) * H : 1.5 * DAY, voice })) });
  assert.equal(sumOf(outvoted([late], {}, settings)), 20, 'the fourth voice is inside the three days');
  assert.equal(sumOf(outvoted([late], {}, { ...settings, debateDays: 1 })), 15, 'and outside one day: three voices');
});
test('a cushion halves each refund', () => {
  const half = (over: Partial<SparkedDebate>) => ({ ...over, cushioned: 0.5 });
  assert.equal(sumOf(outvoted([spark([1, 2, 1, 2, 3], half({ standing: { before: [], now: calm(4) } }))])), 7, 'standing 7.5, floored');
  assert.equal(sumOf(outvoted([afterPaying([1, 2, 1, 2, 3, 4], calm(2), calm(3), { cushioned: 0.5 })], { from: 24 * H })), 2, 'standing 5, then 7.5 floored to 7');
  assert.equal(sumOf(outvoted([afterPaying([1, 2, 1, 2, 3, 4], calm(4), [...calm(3), { ...none, excitedPositive: 1 }], { cushioned: 0.5 })], { from: 24 * H })), -3, 'standing 10, then 7.5 floored to 7');
});

const cushionCard = { key: 'half', name: 'Half', alignment: 'sweet' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }), gimmick: { kind: 'cushion' as const, share: 0.5 } };
const fuseWorld = { ...instance, cards: [...instance.cards, cushionCard] };
const fuseCharacters = [
  { id: 'tw', player: 'pt', classes: [{ class: 'tweener', from: -1 }] },
  { id: 'k', player: 'pk', classes: [{ class: 'face', from: -1 }] },
  ...['a', 'b', 'c', 'd'].map((id) => ({ id, player: `p-${id}`, classes: [{ class: 'face', from: -1 }] })),
];
const fuseActs = [
  { id: 'sp', character: 'tw', kind: 'post' as const, at: 1 * H, thread: 't' },
  ...['a', 'b', 'c'].flatMap((id, i) => [0, 1].map((n) => ({ id: `${id}${n}`, character: id, kind: 'post' as const, at: (3 + i * 2 + n) * H, thread: 't' }))),
];
const fuseQuotes = fuseActs.slice(1).map((a) => ({ act: a.id, quoted: 'sp' }));
const fuseNods = ['a', 'b', 'c', 'd'].map((id) => ({ act: 'sp', player: `p-${id}`, character: id, kind: 'folded-hands', at: 2 * H }));
test('settled whole, with a half cushion up when the nods landed: the spark\'s shrugs, cushion and outvoted sum to no more than nothing in one window (#860 for several)', () => {
  const r = settle({
    window: { id: 'w1', from: 0, to: 24 * H }, characters: fuseCharacters, quotes: fuseQuotes, reactions: fuseNods,
    acts: [...fuseActs, { id: 'g1', character: 'k', kind: 'card', at: 0.5 * H, thread: 't', target: 'sp', card: 'half', ends: 100 * H }],
  }, fuseWorld);
  const of = (reason: string) => r.entries.filter((e) => e.character === 'tw' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
  assert.equal(of('tweener.litTheFuse'), 20);
  assert.equal(of('tweener.shrugged'), -20);
  assert.equal(of('card.cushion'), 10);
  assert.equal(of('tweener.outvoted'), 7, 'the refund standing is floored to a whole unit: 7.5 gives 7, so the cushion\'s 8 and this 7 do not pass the 15 lost');
  assert.ok(of('tweener.shrugged') + of('card.cushion') + of('tweener.outvoted') <= 0);
});
const cushioned = (share: number, nods: number) => {
  const r = settle({
    window: { id: 'w1', from: 0, to: 24 * H }, characters: fuseCharacters, quotes: fuseQuotes, reactions: fuseNods.slice(0, nods),
    acts: [...fuseActs, { id: 'g1', character: 'k', kind: 'card', at: 0.5 * H, thread: 't', target: 'sp', card: 'half', ends: 100 * H }],
  }, { ...instance, cards: [...instance.cards, { ...cushionCard, gimmick: { kind: 'cushion' as const, share } }] });
  return (reason: string) => r.entries.filter((e) => e.character === 'tw' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
};
for (const nods of [1, 3]) for (const share of [0.3, 0.5, 0.7]) {
  test(`settled whole: ${nods} nod${nods > 1 ? 's' : ''} under a ${share} cushion, the spark's shrugs, cushion and outvoted never sum above nothing in one window (#860 for several)`, () => {
    const of = cushioned(share, nods);
    const sum = of('tweener.shrugged') + of('card.cushion') + of('tweener.outvoted');
    assert.ok(sum <= 0, `shrugged ${of('tweener.shrugged')}, cushion ${of('card.cushion')}, outvoted ${of('tweener.outvoted')} sum to ${sum}`);
  });
}
/* ---- The debates fixes (docs/plans/2026-11-21-debates-fixes-plan.md, Task 2): a refund starts from what was paid, and a crossing pays the class that held it ---- */
const dbIds = ['a', 'b', 'c', 'd', 'e'];
const dbCast = (twClasses: { class: string; from: number }[]) => [
  { id: 'tw', player: 'pt', classes: twClasses },
  { id: 'k', player: 'pk', classes: [{ class: 'face', from: -1 }] },
  ...dbIds.map((id) => ({ id, player: `p-${id}`, classes: [{ class: 'face', from: -1 }] })),
];
/** The spark `sp` at 1H and the posts that quote it: three other players each back once and a fourth who posts once at 10H, so it crosses at 7H and its latest member is at 10H. */
const dbActs = [
  { id: 'sp', character: 'tw', kind: 'post' as const, at: 1 * H, thread: 't' },
  ...[['a0', 'a', 3], ['a1', 'a', 4], ['b0', 'b', 5], ['b1', 'b', 6], ['c0', 'c', 7], ['c1', 'c', 8], ['d0', 'd', 10]].map(([id, character, at]) => ({ id: id as string, character: character as string, kind: 'post' as const, at: (at as number) * H, thread: 't' })),
];
const dbQuotes = dbActs.slice(1).map((a) => ({ act: a.id, quoted: 'sp' }));
const dbNod = (who: string, kind: string, at: number) => ({ act: 'sp', player: `p-${who}`, character: who, kind, at });
type Stage = { readonly window: { id: string; from: number; to: number }; readonly reactions: SettlementInput['reactions']; readonly acts?: SettlementInput['acts']; readonly classes?: { class: string; from: number }[] };
/** Settles the windows in order, carrying what the store carries: each vote's latest payment (`paid`) and the sums of the tallied lines (`tallied`). */
function chain(stages: readonly Stage[], twClasses: { class: string; from: number }[], w: typeof fuseWorld = fuseWorld) {
  const results: ReturnType<typeof settle>[] = [];
  const sums = new Map<string, { act: string; reason: string; amount: number }>();
  for (const st of stages) {
    const r = settle({
      window: st.window, characters: dbCast(st.classes ?? twClasses), acts: (st.acts ?? dbActs).filter((a) => a.at < st.window.to), quotes: dbQuotes,
      reactions: st.reactions.filter((x) => x.at < st.window.to), paid: upTo(...results), tallied: [...sums.values()],
    }, w);
    results.push(r);
    for (const t of r.tallied) {
      const key = `${t.act} ${t.reason}`;
      sums.set(key, { act: t.act, reason: t.reason, amount: (sums.get(key)?.amount ?? 0) + t.amount });
    }
  }
  return results;
}
const dbOf = (r: ReturnType<typeof settle>, reason: string) => r.entries.filter((e) => e.character === 'tw' && e.reason === reason);
const dbSum = (rs: readonly ReturnType<typeof settle>[], reason: string) => rs.reduce((t, r) => t + sumOf(dbOf(r, reason)), 0);
const W1 = { id: 'w1', from: 0, to: 24 * H };
const W5 = { id: 'w5', from: 96 * H, to: 120 * H };
const TW = [{ class: 'tweener', from: -1 }];

test('F1 (#893): four nods that move to fire once the debate is no longer followed take the refund back, and shrugs and refund never sum above nothing', () => {
  const nods = ['a', 'b', 'c', 'd'].map((id) => dbNod(id, 'folded-hands', 2 * H));
  const moves = ['a', 'b', 'c', 'd'].map((id) => dbNod(id, 'fire', 100 * H));
  const rs = chain([{ window: W1, reactions: nods }, { window: W5, reactions: [...nods, ...moves] }], TW);
  assert.deepEqual([dbSum(rs.slice(0, 1), 'tweener.litTheFuse'), dbSum(rs.slice(0, 1), 'tweener.outvoted'), dbSum(rs.slice(0, 1), 'tweener.shrugged')], [20, 20, -20], 'the first window: four voices, four nods');
  assert.ok(dbSum(rs, 'tweener.shrugged') + dbSum(rs, 'tweener.outvoted') <= 0, `shrugged ${dbSum(rs, 'tweener.shrugged')} and outvoted ${dbSum(rs, 'tweener.outvoted')}`);
  assert.ok(dbSum(rs.slice(1), 'tweener.outvoted') < 0, 'a refund is taken back');
  assert.equal(dbSum(rs.slice(1), 'tweener.outvoted'), -dbSum(rs.slice(1), 'tweener.shrugged'), 'as much as the shrugs given back');
});
test('F1 (#893): a cushion played after the refund paid does not leave the refund standing when the nods move away', () => {
  const nods = ['a', 'b', 'c', 'd'].map((id) => dbNod(id, 'folded-hands', 2 * H));
  const moves = ['a', 'b', 'c', 'd'].map((id) => dbNod(id, 'fire', 100 * H));
  const card = { id: 'g1', character: 'k', kind: 'card' as const, at: 30 * H, thread: 't', target: 'sp', card: 'half', ends: 200 * H };
  const W2 = { id: 'w2', from: 24 * H, to: 48 * H };
  const rs = chain([{ window: W1, reactions: nods }, { window: W2, reactions: nods, acts: [...dbActs, card] }, { window: W5, reactions: [...nods, ...moves], acts: [...dbActs, card] }], TW);
  const sum = dbSum(rs, 'tweener.shrugged') + dbSum(rs, 'card.cushion') + dbSum(rs, 'tweener.outvoted');
  assert.ok(sum <= rs.length, `shrugged ${dbSum(rs, 'tweener.shrugged')}, cushion ${dbSum(rs, 'card.cushion')}, outvoted ${dbSum(rs, 'tweener.outvoted')} sum to ${sum}`);
  assert.ok(dbSum(rs, 'tweener.outvoted') >= 0);
});
test('F2 (#893): a spark that crossed while the character was a Face, which then Turned to Tweener, pays and takes back no refund', () => {
  const nods = ['a', 'b', 'c', 'd'].map((id) => dbNod(id, 'folded-hands', 2 * H));
  const moves = ['a', 'b', 'c', 'd'].map((id) => dbNod(id, 'fire', 40 * H));
  const W2 = { id: 'w2', from: 24 * H, to: 48 * H };
  const rs = chain([{ window: W1, reactions: nods }, { window: W2, reactions: [...nods, ...moves] }], [{ class: 'face', from: -1 }, { class: 'tweener', from: 30 * H }]);
  assert.deepEqual(rs.flatMap((r) => dbOf(r, 'tweener.outvoted')), [], 'no outvoted line at all');
  assert.deepEqual(rs.flatMap((r) => dbOf(r, 'tweener.litTheFuse')), [], 'and no fuse either: the crossing was a Face\'s');
});
test('F3 (#894): a crossing is paid to the class held at the crossing, though the latest member falls after a Turn away in the same window', () => {
  const [w] = chain([{ window: W1, reactions: [] }], [{ class: 'tweener', from: -1 }, { class: 'face', from: 8 * H }]);
  assert.equal(sumOf(dbOf(w!, 'tweener.litTheFuse')), 20, 'a Tweener until 8H, crossing at 7H, latest member at 10H');
  const [control] = chain([{ window: W1, reactions: [] }], [{ class: 'tweener', from: -1 }, { class: 'face', from: 12 * H }]);
  assert.equal(sumOf(dbOf(control!, 'tweener.litTheFuse')), 20, 'the control, a Turn at 12H');
});
test('the clamp: after debateDays a new nod on a paid spark raises no refund', () => {
  const three = ['a', 'b', 'c'].map((id) => dbNod(id, 'folded-hands', 2 * H));
  const fourth = dbNod('d', 'folded-hands', 100 * H);
  const rs = chain([{ window: W1, reactions: three }, { window: W5, reactions: [...three, fourth] }], TW);
  assert.equal(dbSum(rs.slice(0, 1), 'tweener.outvoted'), 15);
  assert.equal(dbSum(rs.slice(1), 'tweener.outvoted'), 0, 'the fourth nod is charged as a shrug and not given back');
  assert.equal(dbSum(rs.slice(1), 'tweener.shrugged'), -5);
});
test('one spark settled over many windows, with nods landing and moving, cushions and Turns, never nets a gain past #860\'s rounding, and its refund never totals below nothing', () => {
  let seed = 0x5eed;
  const rand = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const kinds = ['folded-hands', 'fire', 'tomato', 'yawn'];
  for (let run = 0; run < 80; run++) {
    const windows = 2 + rand(5);
    const stages: Stage[] = [];
    const history: ReturnType<typeof dbNod>[] = [];
    const card = rand(3) === 0 ? { id: 'g1', character: 'k', kind: 'card' as const, at: (24 * rand(windows) + 1 + rand(20)) * H, thread: 't', target: 'sp', card: 'half', ends: 400 * H } : null;
    /* A Turn at a window's start. One inside a window leaves the window's end standing (`standing.now`) to the stretch the debate is placed in, so a nod
       landing after a Turn away is refunded there with no shrug charged to match: a gap in the plan, reported with this change and not swept here. */
    const turn = rand(3);
    const classes = turn === 0 ? [{ class: 'tweener', from: -1 }] : turn === 1 ? [{ class: 'tweener', from: -1 }, { class: 'face', from: 24 * rand(windows + 1) * H }] : [{ class: 'face', from: -1 }, { class: 'tweener', from: 24 * rand(windows + 1) * H }];
    for (let w = 0; w < windows; w++) {
      for (const id of ['a', 'b', 'c', 'd']) if (rand(3) === 0) history.push(dbNod(id, kinds[rand(kinds.length)]!, (24 * w + 1 + rand(22)) * H));
      stages.push({ window: { id: `w${w}`, from: 24 * w * H, to: 24 * (w + 1) * H }, reactions: [...history], acts: card ? [...dbActs, card] : dbActs });
    }
    const rs = chain(stages, classes);
    const label = `run ${run}: ${JSON.stringify({ classes, card: card?.at, reactions: history })}`;
    let running = 0;
    rs.forEach((r, i) => { running += sumOf(dbOf(r, 'tweener.outvoted')); assert.ok(running >= 0, `${label}: outvoted ${running} after window ${i}`); });
    /* The Face's shrug (bored-negative) is a loss a cushion refunds as well, while a Face holds the character. */
    const net = dbSum(rs, 'tweener.shrugged') + dbSum(rs, 'face.boredTheRoom') + dbSum(rs, 'card.cushion') + dbSum(rs, 'tweener.outvoted');
    assert.ok(net <= rs.length, `${label}: shrugged, cushion and outvoted net ${net}`);
  }
});

test('settled whole: two masks of one player and one other player, each back twice, are two voices and pay nothing; estimated by character they are three', () => {
  const characters = [
    { id: 'tw', player: 'pt', classes: [{ class: 'tweener', from: -1 }] },
    { id: 'a1', player: 'pa', classes: [{ class: 'face', from: -1 }] }, { id: 'a2', player: 'pa', classes: [{ class: 'face', from: -1 }] },
    { id: 'b', player: 'pb', classes: [{ class: 'face', from: -1 }] },
  ];
  const acts = [
    { id: 'sp', character: 'tw', kind: 'post' as const, at: 1 * H, thread: 't' },
    ...['a1', 'a2', 'b'].flatMap((id, i) => [0, 1].map((n) => ({ id: `${id}-${n}`, character: id, kind: 'post' as const, at: (3 + i * 2 + n) * H, thread: 't' }))),
  ];
  const b: SettlementInput = { window: { id: 'w1', from: 0, to: 24 * H }, characters, acts, quotes: acts.slice(1).map((a) => ({ act: a.id, quoted: 'sp' })), reactions: [] };
  const fuseOf = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.reason === 'tweener.litTheFuse').reduce((t, e) => t + e.amount, 0);
  assert.equal(fuseOf(settle(b, world)), 0);
  assert.equal(fuseOf(settle(b, world, { sharedVote: false, halving: false })), 20);
});

test('every earning a class builds from a single reaction names that reaction\'s kind, for an Earn Gimmick that names reactions', () => {
  const one = (quadrant: Quadrant, over: Partial<ReceivedReaction> = {}) => input({ received: [{ ...got(quadrant, 1, 'post', 'a1', 0, 'laughing'), at: 4 * 86_400_000, ...over }] });
  const kinds = (rules: ClassRules, i: ClassInput) => rules.earn(i, settings).filter((e) => e.quadrant !== undefined).map((e) => e.kind);
  assert.deepEqual(kinds(face, one('excitedPositive')), ['laughing']);
  assert.deepEqual(kinds(technician, one('calmPositive')), ['laughing', 'laughing'], 'Respected and Evergreen');
  assert.deepEqual(kinds(tweener, one('calmPositive')), ['laughing']);
  assert.deepEqual(kinds(lurker, input({ received: [got('excitedPositive', 1, 'card', 'k1', 0, 'laughing')] })), ['laughing']);
});

/* ---- the votes an earning paid per vote multiplied (a cushion reads them) ---- */
test('every earning paid per vote carries the votes it multiplied, and the Lurker posting cost, which no reaction causes, carries none', () => {
  const received = [got('excitedPositive', 2), got('excitedNegative', 1.5), got('calmPositive', 0.5), got('boredNegative', 3), calmAged(5 * DAY, 0.25)];
  const perVoteReasons = new Map<string, string[]>([
    ['face', ['face.cheered', 'face.boredTheRoom']], ['heel', ['heel.drewHeat', 'heel.shrugged']], ['jabroni', ['jabroni.drewTheGroan', 'jabroni.takenSincerely']],
    ['technician', ['technician.respected', 'technician.evergreen', 'technician.draggedIn']], ['tweener', ['tweener.shrugged']], ['lurker', ['lurker.cardDrew']],
  ]);
  for (const c of classes) {
    const lines = c.earn(input({ received: c.key === 'lurker' ? received.map((r) => ({ ...r, actKind: 'card' as const })) : received }), settings);
    for (const reason of perVoteReasons.get(c.key)!) {
      const paid = lines.filter((e) => e.reason === reason);
      assert.ok(paid.length > 0, reason);
      for (const e of paid) assert.equal(typeof e.votes, 'number', `${reason} carries votes`);
    }
  }
  const aged = technician.earn(input({ received: [calmAged(5 * DAY, 0.25)] }), settings).find((e) => e.reason === 'technician.evergreen')!;
  assert.equal(aged.votes, 0.25);
  const posts = Array.from({ length: 5 }, (_, i) => ({ act: `p${i}`, at: i }));
  const over = lurker.earn(input({ posts }), settings).filter((e) => e.reason === 'lurker.postedTooMuch');
  assert.ok(over.length > 0);
  for (const e of over) assert.equal('votes' in e, false);
});
test('an earning carries its reaction\'s votes signed, so a vote that moved away reads as a loss of that many and never as a gain', () => {
  const received = [got('excitedPositive', -2, 'post', 'n1'), got('excitedNegative', -1.5, 'post', 'n2'), got('calmPositive', -0.5, 'post', 'n3'), got('boredNegative', -3, 'post', 'n4'), got('calmPositive', -0.25, 'post', 'n5', 10 - 5 * DAY)];
  const votesOf = new Map(received.map((r) => [r.act, r.votes]));
  const perVoteReasons = new Map<string, string[]>([
    ['face', ['face.cheered', 'face.boredTheRoom']], ['heel', ['heel.drewHeat', 'heel.shrugged']], ['jabroni', ['jabroni.drewTheGroan', 'jabroni.takenSincerely']],
    ['technician', ['technician.respected', 'technician.evergreen', 'technician.draggedIn']], ['tweener', ['tweener.shrugged']], ['lurker', ['lurker.cardDrew']],
  ]);
  for (const c of classes) {
    const lines = c.earn(input({ received: c.key === 'lurker' ? received.map((r) => ({ ...r, actKind: 'card' as const })) : received }), settings);
    for (const reason of perVoteReasons.get(c.key)!) {
      const paid = lines.filter((e) => e.reason === reason);
      assert.ok(paid.length > 0, reason);
      for (const e of paid) assert.equal(e.votes, votesOf.get(e.act!), `${reason} on ${e.act} carries the reaction's signed votes`);
    }
  }
});

test('a Face\'s lifts in a window halve in the order played: 2v, v, v/2; a dud Fab between them does not halve the next', () => {
  const v = settings.vote;
  const fab = (act: string, at: number, hype: number) => card({ act, at, alignment: 'sweet', targetAfter: { ...none, excitedPositive: hype } });
  const lifts = (cards: PlayedCard[]) => face.earn(input({ cardsPlayed: cards }), settings).filter((e) => e.reason === 'face.liftedAPost').map((e) => [e.act, e.amount]);
  assert.deepEqual(lifts([fab('k3', 30, 2), fab('k1', 10, 2), fab('k2', 20, 2)]), [['k1', 2 * v], ['k2', v], ['k3', v / 2]]);
  assert.deepEqual(lifts([fab('k1', 10, 2), fab('k2', 20, 0), fab('k3', 30, 2)]), [['k1', 2 * v], ['k3', v]]);
  assert.equal(total(face, input({ cardsPlayed: [fab('k1', 10, 2)], from: 0, to: 50 }), 'face.liftedAPost'), 2 * v);
  assert.equal(total(face, input({ cardsPlayed: [fab('k2', 60, 2)], from: 50, to: 100 }), 'face.liftedAPost'), 2 * v);
});
test('a Tweener\'s stirs in a window halve in the order played; a stir that draws nothing does not halve the next; one stir per window pays in full', () => {
  const v = settings.vote;
  const stir = (act: string, at: number, hype: number, heat: number) => card({ act, at, drawnAfter: { at: at + 1, now: room(hype, heat) } });
  const stirs = (cards: PlayedCard[]) => tweener.earn(input({ cardsPlayed: cards }), settings).filter((e) => e.reason === 'tweener.stirredThePot').map((e) => [e.act, e.amount]);
  assert.deepEqual(stirs([stir('k3', 30, 2, 2), stir('k1', 10, 2, 2), stir('k2', 20, 2, 2)]), [['k1', 4 * v], ['k2', 2 * v], ['k3', v]]);
  assert.deepEqual(stirs([stir('k1', 10, 2, 2), stir('k2', 20, 3, 0), stir('k3', 30, 2, 2)]), [['k1', 4 * v], ['k3', 2 * v]]);
  assert.equal(total(tweener, input({ cardsPlayed: [stir('k1', 10, 2, 2)], from: 0, to: 50 }), 'tweener.stirredThePot'), 4 * v);
  assert.equal(total(tweener, input({ cardsPlayed: [stir('k2', 60, 2, 2)], from: 50, to: 100 }), 'tweener.stirredThePot'), 4 * v);
});

/* ---- Which earnings the reveal perk reads (class balance design, section 2; plan Task 7) ---- */
/*
 * The perk is a fifth more on what reactions earned. An earning carries `fromReactions` when a reaction to the character's own Acts,
 * or its own early call, caused it. This list is the design's section 2: a new reason is a decision, so a reason a class emits that
 * is not here fails the test until someone chooses whether it is read.
 */
const PERK_READS: Readonly<Record<string, boolean>> = {
  'face.cheered': true, 'face.liftedAPost': false, 'face.boredTheRoom': false, 'face.stoleThunder': false,
  'heel.drewHeat': true, 'heel.stoleThunder': false, 'heel.shrugged': false,
  'jabroni.drewTheGroan': true, 'jabroni.soldTheL': false, 'jabroni.takenSincerely': false,
  'technician.respected': true, 'technician.evergreen': true, 'technician.draggedIn': false,
  'tweener.splitTheRoom': true, 'tweener.stirredThePot': false, 'tweener.shrugged': false, 'tweener.litTheFuse': false, 'tweener.outvoted': false,
  'lurker.calledIt': true, 'lurker.misread': false, 'lurker.spunAThread': false, 'lurker.cardDrew': true, 'lurker.postedTooMuch': false,
};
test('the earnings the reveal perk reads are exactly the design\'s list, and every reason a class has is in the fixture', () => {
  const sweetCard = card({ act: 'k1', alignment: 'sweet', votes: 3, targetVotes: 2, targetLean: 1, targetAfter: { ...none, excitedPositive: 2 }, drawnAfter: { at: 8, now: room(3, 3) } });
  const saltyCard = card({ act: 'k2', alignment: 'salty', votes: 3, targetVotes: 1, drawnAfter: { at: 9, now: room(3, 3) } });
  const everything = input({
    from: 0, to: 100 * H,
    posts: [1, 2, 3, 4].map((n) => ({ act: `post${n}`, at: n })),
    received: [
      got('excitedPositive'), got('excitedNegative'), got('boredNegative'), got('calmPositive'),
      got('calmPositive', 1, 'post', 'old', 0, 'reaction'), { ...got('calmPositive', 1, 'post', 'old'), at: 4 * DAY },
      got('excitedPositive', 1, 'card', 'k1'),
    ],
    cardsPlayed: [sweetCard, saltyCard],
    cardsLanded: [landed('salty')],
    held: [held({ act: 'h1' }), held({ act: 'h2', endsUp: 'excitedNegative' })],
    threadsSpun: [spin({})],
    standings: [standing([], room(6, 6))],
    debates: [spark([1, 2, 1, 2, 3], { standing: { before: [], now: calm(4) } })],
  });
  const seen: Record<string, boolean> = {};
  for (const rules of classes) {
    for (const e of rules.earn(everything, settings)) {
      const flag = e.fromReactions === true;
      assert.ok(seen[e.reason] === undefined || seen[e.reason] === flag, `${e.reason} is flagged on some lines and not others`);
      seen[e.reason] = flag;
    }
  }
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(PERK_READS).sort(), 'the fixture makes every reason, and the list names every one');
  assert.deepEqual(seen, PERK_READS);
  const negatives = classes.flatMap((r) => r.earn(everything, settings)).filter((e) => e.fromReactions && e.amount < 0);
  assert.deepEqual(negatives.map((e) => e.reason), [], 'a loss is never read by the perk');
  /* Against the source: a reason a class file names that this list does not is a decision nobody made. */
  const named = new Set<string>();
  for (const f of ['face', 'heel', 'jabroni', 'technician', 'tweener', 'lurker']) {
    const text = readFileSync(new URL(`./${f}.ts`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/reason: '([a-z]+\.[A-Za-z]+)'|perVote\([^\n]*?'([a-z]+\.[A-Za-z]+)'/g)) named.add((m[1] ?? m[2])!);
  }
  assert.deepEqual([...named].sort(), Object.keys(PERK_READS).sort());
});
