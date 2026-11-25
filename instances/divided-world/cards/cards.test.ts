/**
 * The tests about the whole pool of Divided World's cards: the ordered list of keys, flavors and prices, the staff options,
 * Card Collector's and 4D Chess's enums, and the Gimmicks tested against several casts. A card's own tests are in
 * `<key>.test.ts`, with the helpers they share in `test-kit.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickAround } from './stick-around.ts';
import { whoops } from './whoops.ts';
import { graffiti } from './graffiti.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { publicityTour } from './publicity-tour.ts';
import { atOrBelow, castOnPost, giftSplit, instant, wardTurnsAway, staffOffers, staffConfigOf, decidePlay, decideSet, type CardRules } from '../../../engine/rules/cards.ts';
import { autocorrect } from './autocorrect.ts';
import { boundedPhrase } from './phrase-bound.ts';
import { laughTrack, type Cue } from './laugh-track.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { settle } from '../../../engine/rules/settle.ts';
import type { InputAct, InputReaction, SettlementInput } from '../../../engine/rules/types.ts';
import { defaults as settings } from '../settings.ts';
import { reactions } from '../reactions.ts';
import { QUADRANTS } from '../../../engine/rules/types.ts';
import type { CardTarget } from '../../../engine/rules/cards.ts';
import type { PullPack } from '../../../engine/rules/packs.ts';
import { by, jimmy, on, post, seenOf, surf } from './test-kit.ts';

/** What the machine sells a card for: its slot's price. */
const priceOf = (key: string): number => instance.machine.find((m) => 'card' in m.item && m.item.card === key)!.price;

test('the instance sells its cards at their prices', () => {
  // One card per line, sorted by key, as `cards/index.ts`: a new card's line goes to its place in key order.
  assert.deepEqual(cards.map((c) => [c.key, c.alignment, priceOf(c.key)]), [
    ['4d-chess', 'salty', 150],
    ['autocorrect', 'pepperoni', 100],
    ['below-the-fold', 'salty', 100],
    ['blind-study', 'pepperoni', 150],
    ['buzzkill', 'salty', 300],
    ['card-collector', 'salty', 150],
    ['cheap-shot', 'salty', 150],
    ['class-clown', 'pepperoni', 150],
    ['feelin-fab', 'sweet', 20],
    ['feelin-glam', 'sweet', 300],
    ['force-field', 'sweet', 150],
    ['front-row', 'pepperoni', 150],
    ['glitter-bomb', 'pepperoni', 150],
    ['good-vibes', 'sweet', 150],
    ['graffiti', 'pepperoni', 300],
    ['hall-pass', 'sweet', 150],
    ['happy-heart', 'sweet', 150],
    ['heat-magnet', 'salty', 100],
    ['hot-box', 'salty', 100],
    ['hype-up', 'sweet', 100],
    ['jimmy-wails', 'sweet', 200],
    ['kick-me', 'pepperoni', 100],
    ['last-word', 'salty', 150],
    ['laugh-track', 'pepperoni', 150],
    ['line-cutter', 'pepperoni', 300],
    ['main-event', 'sweet', 300],
    ['mooch', 'salty', 150],
    ['off-day', 'salty', 500],
    ['overreaction', 'pepperoni', 100],
    ['pay-it-forward', 'sweet', 150],
    ['pop-steal', 'salty', 100],
    ['publicity-tour', 'sweet', 150],
    ['required-reading', 'sweet', 100],
    ['rope-break', 'sweet', 100],
    ['so-very-happy', 'salty', 300],
    ['steel-chair', 'salty', 100],
    ['stick-around', 'sweet', 100],
    ['sugar-coat', 'sweet', 300],
    ['super-happy-heart', 'sweet', 300],
    ['sweet-heat', 'pepperoni', 150],
    ['take-the-fall', 'sweet', 150],
    ['tattle-tale', 'salty', 300],
    ['thick-skin', 'sweet', 150],
    ['this', 'pepperoni', 20],
    ['time-machine', 'pepperoni', 300],
    ['toll', 'pepperoni', 150],
    ['ultra-happy-heart', 'sweet', 600],
    ['whodunnit', 'pepperoni', 300],
    ['whoopee-cushion', 'pepperoni', 100],
    ['whoops', 'salty', 100],
    ['you-were-saying', 'pepperoni', 100],
  ]);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instance.cards, cards);
});

test('the cards are listed in key order, so a new card has one place to go', () => {
  const keys = cards.map((c) => c.key);
  assert.deepEqual(keys, [...keys].sort());
});

test('what a play adds is a setting: an override reaches what it costs to play', () => {
  const tuned = withOverrides(settings, { economy: { 'whoops.perLength': 50, 'whoops.mostAdded': 300 } });
  assert.equal(whoops.playPrice(withOverrides(settings, { economy: { 'whoops.lengthStep': 250 } }), post(500), { color: 'red' }), 50, 'the step is a setting too');
  assert.equal(whoops.playPrice(withOverrides(settings, { economy: { 'whoops.mostAdded': 0 } }), post(6000), { color: 'red' }), 0, 'a cap of nothing adds nothing');
  assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'whoops.lengthStep': 0 } }) }).join('\n'), /whoops\.lengthStep/);
  assert.equal(whoops.playPrice(tuned, post(1000), { color: 'red' }), 100);
  assert.equal(whoops.playPrice(tuned, post(1_000_000), { color: 'red' }), 300);
});

test('the machine sells every card, and no card carries a price of its own', () => {
  assert.deepEqual(instance.machine.filter((m) => 'card' in m.item).map((m) => (m.item as { card: string }).card).sort(), cards.map((c) => c.key).sort());
  assert.ok(cards.every((c) => !('priceKey' in c)));
});





test('a card lands on a post up to its stack: Stick Around once, Whoops! three times, never on an edit', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'whoops', act: `k${i}` }));
  assert.equal(whoops.canApply(post(10), []).ok, true);
  assert.equal(whoops.canApply(post(10), [{ card: 'stick-around', act: 'k0' }]).ok, true, 'the two combine');
  assert.equal(whoops.canApply(post(10), w(2)).ok, true, 'a third Whoops! lands');
  assert.deepEqual(whoops.canApply(post(10), w(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.equal(whoops.canApply(post(10), [...w(2), { card: 'stick-around', act: 's' }]).ok, true, 'another card is not counted');
  assert.deepEqual(stickAround.canApply(post(10), [{ card: 'stick-around', act: 's' }]), { ok: false, why: 'this post already carries that card' });
  assert.equal(stickAround.canApply({ reach: 'post', act: 'p1', kind: 'edit', length: 10, text: '', links: [] }, []).ok, false);
  assert.equal(whoops.stack, 3);
  assert.equal(whoops.seeded, true, 'each splat is drawn from a seed the server chooses');
  assert.equal(stickAround.stack ?? 1, 1);
  assert.equal(stickAround.seeded ?? false, false);
});

test('a play carries the caster\'s message: plain text, at most 200 characters, and may be empty', () => {
  assert.deepEqual(decidePlay(whoops, settings, post(10), [], { color: 'red' }, '  A riposte.  '), { ok: true, value: { price: 0, config: { color: 'red' }, message: 'A riposte.' } });
  assert.equal((decidePlay(whoops, settings, post(10), [], { color: 'red' }, '') as { value: { message: string } }).value.message, '');
  assert.equal((decidePlay(whoops, settings, post(10), [], { color: 'red' }, undefined) as { value: { message: string } }).value.message, '', 'no message is an empty one');
  assert.equal(decidePlay(whoops, settings, post(10), [], { color: 'red' }, '🔥'.repeat(200)).ok, true, 'counted in characters');
  assert.deepEqual(decidePlay(whoops, settings, post(10), [], { color: 'red' }, 'x'.repeat(201)), { ok: false, why: 'the message is at most 200 characters' });
  assert.deepEqual(decidePlay(whoops, settings, post(10), [], { color: 'red' }, 7), { ok: false, why: 'the message is text' });
});

test('the seed is the server\'s: one in the caster\'s configuration is never kept', () => {
  assert.deepEqual(whoops.validateConfig({ color: 'red', seed: 12345 }), { ok: true, value: { color: 'red' } });
});

test('a play is decided by the card\'s own rules: its price, whether it lands, its configuration', () => {
  assert.deepEqual(decidePlay(whoops, settings, post(1200), [], { color: 'red' }, ''), { ok: true, value: { price: 50, config: { color: 'red' }, message: '' } });
  assert.match(String((decidePlay(whoops, settings, post(1200), [], { color: 'nope' }, '') as { why: string }).why), /color/);
  assert.match(String((decidePlay(whoops, settings, post(1200), [1, 2, 3].map((i) => ({ card: 'whoops', act: `k${i}` })), { color: 'red' }, '') as { why: string }).why), /already/);
});







/* The card mechanic's first cards (docs/plans/2026-11-01-card-plays-plan.md, Task 8): Card Collector and Force Field; the card types plan's Gimmicks. */
test('the instance sells Card Collector, Force Field and the new Gimmicks, each with its rarity and play, and stays whole', () => {
  const by = (key: string) => cards.find((c) => c.key === key)!;
  assert.deepEqual(['card-collector', 'force-field', 'publicity-tour', 'heat-magnet', 'class-clown', 'good-vibes', 'whoops', 'stick-around'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, priceOf(k)]), [
    ['card-collector', 'uncommon', 'set', 'salty', 150],
    ['force-field', 'uncommon', 'use', 'sweet', 150],
    ['publicity-tour', 'uncommon', 'use', 'sweet', 150],
    ['heat-magnet', 'uncommon', 'use', 'salty', 100],
    ['class-clown', 'uncommon', 'use', 'pepperoni', 150],
    ['good-vibes', 'uncommon', 'use', 'sweet', 150],
    ['whoops', 'common', 'cast', 'salty', 100],
    ['stick-around', 'common', 'cast', 'sweet', 100],
  ]);
  assert.deepEqual(by('card-collector').trap, { trigger: { on: 'cast' } });
  assert.deepEqual([by('force-field').gimmick, by('force-field').lasts], [{ kind: 'ward', upTo: 'uncommon' }, { unit: 'day', count: 7 }]);
  assert.deepEqual(settings.setLasts, { unit: 'day', count: 7 });
  assert.deepEqual(instanceProblems(instance), []);
});

test('Publicity Tour, Heat Magnet, Class Clown and Good Vibes are Gimmicks with the effects the design names', () => {
  const days3 = { unit: 'day', count: 3 };
  assert.deepEqual([by('publicity-tour').reaches, by('publicity-tour').lasts, by('publicity-tour').gimmick], [['character'], days3, { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], flat: 0.5 }]);
  assert.deepEqual([by('hype-up').reaches, by('hype-up').lasts, by('hype-up').gimmick], [['post'], days3, { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], flat: 1 }]);
  assert.deepEqual([by('heat-magnet').reaches, by('heat-magnet').lasts, by('heat-magnet').gimmick], [['character'], days3, { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 0.75 }]);
  assert.deepEqual([by('class-clown').reaches, by('class-clown').lasts, by('class-clown').gimmick], [['character'], days3, { kind: 'earn', reactions: ['laughing', 'eye-roll'], flat: 1 }]);
  assert.deepEqual([by('good-vibes').reaches, by('good-vibes').lasts, by('good-vibes').gimmick], [['thread'], { unit: 'day', count: 3 }, { kind: 'price', flavors: ['salty'], add: 25 }]);
  for (const key of ['laughing', 'eye-roll']) assert.ok(instance.reactions.some((r) => r.key === key), key);
});

test('Card Collector names only cards cast on a post at or below its own rarity, and Hall Pass springs on a visit', () => {
  const collector = by('card-collector');
  const target = { reach: 'post' as const, act: 'p', kind: 'post' as const, length: 10, text: '', links: [] };
  assert.equal(decideSet(collector, settings, target, [], { card: 'whoops' }, cards).ok, true);
  assert.equal(decideSet(collector, settings, target, [], { card: 'glitter-bomb' }, cards).ok, false, 'a card beyond a post cannot be named');
  assert.deepEqual(by('hall-pass').trap, { trigger: { on: 'visit' } });
});


/* Cards beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 7). */
test('Glitter Bomb is an uncommon Pepperoni Cast on a character, for a week; Main Event a rare Sweet Cast on a thread, for a day, that pins', async () => {
  const { glitterBomb } = await import('./glitter-bomb.ts');
  const { mainEvent } = await import('./main-event.ts');
  assert.deepEqual([glitterBomb.rarity, glitterBomb.alignment, glitterBomb.play ?? 'cast', glitterBomb.reaches, glitterBomb.lasts], ['uncommon', 'pepperoni', 'cast', ['character'], { unit: 'day', count: 7 }]);
  assert.deepEqual([mainEvent.rarity, mainEvent.alignment, mainEvent.play ?? 'cast', mainEvent.reaches, mainEvent.lasts, mainEvent.pins], ['rare', 'sweet', 'cast', ['thread'], { unit: 'day', count: 1 }, true]);
  assert.equal(priceOf('glitter-bomb'), 150);
  assert.equal(priceOf('main-event'), 300);
  const character = { reach: 'character' as const, character: 'c1' };
  assert.equal(glitterBomb.canApply(character, []).ok, true);
  assert.deepEqual(glitterBomb.canApply(post(10), []), { ok: false, why: 'this card lands on a character' });
  assert.deepEqual(glitterBomb.canApply(character, [{ card: 'glitter-bomb', act: 'g', reach: 'character', ends: new Date(Date.now() + 1e6).toISOString() }]), { ok: false, why: 'this character already carries that card' });
  assert.equal(mainEvent.canApply({ reach: 'thread', thread: 't1' }, []).ok, true);
  assert.deepEqual(mainEvent.canApply(post(10), []), { ok: false, why: 'this card lands on a thread' });
  assert.equal(glitterBomb.playPrice(settings, character, {}), 0);
  /* The posts written in its week keep it (docs/plans/2026-11-12-glitter-keeps-design.md); the whole instance still passes the rules' checks. */
  assert.equal(glitterBomb.keeps, true);
  assert.deepEqual(instanceProblems(instance), []);
  assert.equal(mainEvent.playPrice(settings, { reach: 'thread', thread: 't1' }, {}), 0);
  assert.ok(cards.some((c) => c.key === 'glitter-bomb') && cards.some((c) => c.key === 'main-event'));
});

test('the instance, with its cards beyond a post, has no problems, and its reach settings are the design\'s', () => {
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(settings.reachRarity, { character: 'uncommon', thread: 'uncommon', board: 'legendary' });
  assert.deepEqual(settings.reachLasts, { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 7 }, board: { unit: 'day', count: 1 } });
});

/* Feelin' Fab (docs/plans/2026-11-02-onboarding-plan.md, Task 10). */
test("Feelin' Fab is a common Sweet Cast on a post, three to a post, that lasts until the post goes; it costs 0.20 and nothing more to play", async () => {
  const { feelinFab } = await import('./feelin-fab.ts');
  assert.deepEqual([feelinFab.key, feelinFab.name, feelinFab.alignment, feelinFab.rarity, feelinFab.play ?? 'cast', feelinFab.reaches, feelinFab.stack, feelinFab.lasts], ['feelin-fab', "Feelin' Fab", 'sweet', 'common', 'cast', ['post'], 3, undefined]);
  assert.equal(priceOf('feelin-fab'), 20);
  assert.ok(priceOf('feelin-fab') < priceOf('whoops'), 'below a common Move');
  assert.equal(feelinFab.playPrice(settings, post(6000), {}), 0);
  assert.equal(feelinFab.playPrice(settings, post(10), {}), 0);
  assert.equal(feelinFab.validateConfig({ anything: 1 }).ok, true);
  assert.ok(cards.some((c) => c.key === 'feelin-fab'));
});


/* Below the Fold (docs/plans/2026-11-11-below-the-fold-plan.md, Task 1). */
test('Below the Fold is a common Salty Cast on a post, one to a post, that costs 1.00 and nothing more to play', async () => {
  const { belowTheFold } = await import('./below-the-fold.ts');
  assert.deepEqual([belowTheFold.key, belowTheFold.name, belowTheFold.alignment, belowTheFold.rarity, belowTheFold.play ?? 'cast', belowTheFold.reaches, belowTheFold.stack, belowTheFold.lasts], ['below-the-fold', 'Below the Fold', 'salty', 'common', 'cast', undefined, undefined, undefined]);
  assert.equal(priceOf('below-the-fold'), 100);
  assert.equal(belowTheFold.playPrice(settings, post(6000), {}), 0);
  assert.equal(belowTheFold.playPrice(settings, post(10), {}), 0);
  assert.deepEqual(belowTheFold.validateConfig({ anything: 1 }), { ok: true, value: {} });
  assert.deepEqual(belowTheFold.validateConfig(undefined), { ok: true, value: {} });
  const listed = cards.find((c) => c.key === 'below-the-fold');
  assert.ok(listed, 'it is in the instance\'s cards');
  assert.ok(castOnPost(listed), 'a Cast on a post, so Card Collector can name it');
});


/* Card notes, Part 3 (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 9): Whodunnit?, Blind Study and Overreaction. */
test('Whodunnit? and Blind Study are Pepperoni Moves on a post for three days, that veil the author and the totals', async () => {
  const { whodunnit } = await import('./whodunnit.ts');
  const { blindStudy } = await import('./blind-study.ts');
  assert.deepEqual([whodunnit.key, whodunnit.name, whodunnit.alignment, whodunnit.rarity, whodunnit.play ?? 'cast', whodunnit.reaches, whodunnit.stack, whodunnit.lasts, whodunnit.veil], ['whodunnit', 'Whodunnit?', 'pepperoni', 'rare', 'cast', undefined, undefined, { unit: 'day', count: 3 }, 'author']);
  assert.deepEqual([blindStudy.key, blindStudy.name, blindStudy.alignment, blindStudy.rarity, blindStudy.play ?? 'cast', blindStudy.reaches, blindStudy.stack, blindStudy.lasts, blindStudy.veil], ['blind-study', 'Blind Study', 'pepperoni', 'uncommon', 'cast', undefined, undefined, { unit: 'day', count: 3 }, 'totals']);
  assert.deepEqual([priceOf('blind-study'), priceOf('overreaction')], [150, 100]);
  const whodunnitSlot = instance.machine.find((m) => 'card' in m.item && m.item.card === 'whodunnit')!;
  assert.deepEqual([whodunnitSlot.availability, whodunnitSlot.price], ['hidden', 300]);
  for (const c of [whodunnit, blindStudy]) {
    assert.equal(c.playPrice(settings, post(6000), {}), 0);
    assert.equal(c.playPrice(settings, post(10), {}), 0);
    assert.deepEqual(c.validateConfig({ anything: 1 }), { ok: true, value: {} });
    assert.equal(c.canApply(post(10), []).ok, true);
    assert.deepEqual(c.canApply(post(10), [{ card: c.key, act: 'v1', reach: 'post' as const }]), { ok: false, why: 'this post already carries that card' });
    assert.deepEqual(c.canApply({ reach: 'character', character: 'c1' }, []), { ok: false, why: 'this card lands on a post' });
    const listed = cards.find((l) => l.key === c.key);
    assert.ok(listed, 'it is in the instance\'s cards');
    assert.ok(castOnPost(listed), 'a Cast on a post');
  }
  const named = cards.find((c) => c.key === 'card-collector')!.staffOptions!.schema as { properties: { card: { enum: string[] } } };
  assert.ok(named.properties.card.enum.includes('blind-study') && !named.properties.card.enum.includes('whodunnit'), 'Card Collector may name the uncommon, not the rare');
  assert.ok(named.properties.card.enum.includes('overreaction'), 'Card Collector may name the common');
  // The machine's rule (machine.test.ts) puts the uncommon Blind Study among the hidden slots and the common Overreaction on sale.
  const availabilityOf = (k: string) => instance.machine.find((m) => 'card' in m.item && m.item.card === k)?.availability;
  assert.deepEqual([availabilityOf('blind-study'), availabilityOf('overreaction')], ['hidden', 'onSale']);
});

test('Overreaction is a common Pepperoni Move on a post, three to a post, that adds a reaction of its own and does not end', async () => {
  const { overreaction } = await import('./overreaction.ts');
  assert.deepEqual([overreaction.key, overreaction.name, overreaction.alignment, overreaction.rarity, overreaction.play ?? 'cast', overreaction.reaches, overreaction.stack, overreaction.lasts, overreaction.reaction, overreaction.veil], ['overreaction', 'Overreaction', 'pepperoni', 'common', 'cast', undefined, 3, undefined, true, undefined]);
  assert.equal(overreaction.playPrice(settings, post(6000), { emoji: '🦀', quadrant: 'calmPositive' }), 0);
  const up = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'overreaction', act: `o${i}`, reach: 'post' as const }));
  assert.equal(overreaction.canApply(post(10), up(2)).ok, true);
  assert.deepEqual(overreaction.canApply(post(10), up(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.deepEqual(overreaction.canApply({ reach: 'thread', thread: 't1' }, []), { ok: false, why: 'this card lands on a post' });
  assert.ok(castOnPost(cards.find((c) => c.key === 'overreaction')!), 'a Cast on a post');
  assert.deepEqual(overreaction.validateConfig({ emoji: '🦀', quadrant: 'calmPositive', extra: 1 }), { ok: true, value: { emoji: '🦀', quadrant: 'calmPositive' } });
  assert.deepEqual(overreaction.validateConfig({ emoji: '🦀', quadrant: 'sideways' }), { ok: false, why: 'choose the quadrant it scores in' });
  assert.deepEqual(overreaction.validateConfig({ emoji: 'crab', quadrant: 'calmPositive' }), { ok: false, why: 'choose one emoji' });
  assert.deepEqual(overreaction.validateConfig({ emoji: '🦀🐙', quadrant: 'calmPositive' }), { ok: false, why: 'that is more than one emoji' });
  assert.equal(reactions.length, 16);
  for (const r of reactions) assert.deepEqual(overreaction.validateConfig({ emoji: r.emoji, quadrant: r.quadrant }), { ok: false, why: 'this forum already has that reaction' }, r.key);
});

test('the anonymous poster stands in for a withheld author, with no picture of its own yet', () => {
  assert.deepEqual(instance.anonymous, { name: 'Anonymous', tagline: 'Could be anyone.' });
});












test('every staffConfigs entry of every card passes that card\'s own validateConfig, and the pool can play each card it offers', () => {
  let entries = 0;
  for (const card of cards) {
    for (const entry of card.staffConfigs ?? []) {
      entries += 1;
      assert.equal(card.validateConfig(entry).ok, true, `${card.key}: ${JSON.stringify(entry)}`);
    }
    for (const edge of [0, 0.9999999999]) {
      const chosen = staffConfigOf(card, () => edge);
      if (card.validateConfig({}).ok) assert.deepEqual(chosen, {}, `${card.key} is played as its default at rng ${edge}`);
      else if ((card.staffConfigs ?? []).length > 0) assert.equal(card.validateConfig(chosen).ok, true, `${card.key} at rng ${edge}: ${JSON.stringify(chosen)}`);
      else assert.equal(chosen, null, `${card.key} has neither a default nor staffConfigs`);
    }
  }
  assert.ok(entries > 0, 'at least Whoops! lists staffConfigs');
  assert.equal(staffConfigOf(whoops, () => 0.9999999999) !== null && staffConfigOf(whoops, () => 0) !== null, true);
});

/* A card's staffOptions (docs/plans/2026-11-05-bot-card-options-plan.md, Task 8): what a Mod Bot's persona may set. */
const answers: Record<string, Record<string, unknown>> = {
  whoops: { color: '#12ab9f' },
  autocorrect: { phrase: 'the same old', replacement: 'something new' },
  'stick-around': { sentence: 'I have read every word of this' },
  'card-collector': { card: 'whoops' },
  '4d-chess': { card: 'whoops', quadrant: 'calmPositive' },
  graffiti: { stencil: 'horns', can: 'red', spot: 4 },
  'laugh-track': { cues: [{ phrase: 'the same old', sound: 'laugh' }, { phrase: 'something new', sound: 'boo' }] },
  this: { phrase: 'the same old', words: 'again' },
};

test('each card that lets the model set options gives an object schema its own validateConfig accepts for a sample answer', () => {
  const keys = cards.filter((c) => c.staffOptions).map((c) => c.key).sort();
  assert.deepEqual(keys, ['4d-chess', 'autocorrect', 'card-collector', 'graffiti', 'laugh-track', 'stick-around', 'this', 'whoops']);
  for (const card of cards) {
    if (!card.staffOptions) continue;
    const { prompt, schema } = card.staffOptions;
    assert.ok(prompt.length > 0 && prompt.length < 600, `${card.key}: a short prompt`);
    assert.equal(schema.type, 'object', card.key);
    assert.equal(schema.additionalProperties, false, card.key);
    const props = schema.properties as Record<string, { type?: unknown }>;
    for (const [name, def] of Object.entries(props)) {
      for (const bound of ['maxLength', 'minLength', 'pattern', 'maxItems', 'minItems']) assert.equal(bound in def, false, `${card.key}.${name}: structured output cannot hold ${bound}`);
      assert.ok(def.type === 'string' || def.type === 'array' || 'enum' in def, `${card.key}.${name}: strings, enums and lists only`);
    }
    for (const name of (schema.required ?? []) as string[]) assert.ok(name in props, `${card.key}: required ${name} is a property`);
    const sample = answers[card.key];
    assert.ok(sample, `${card.key} has a sample answer`);
    assert.equal(card.validateConfig(sample).ok, true, `${card.key}: ${JSON.stringify(sample)}`);
    for (const name of (schema.required ?? []) as string[]) assert.ok(name in sample, `${card.key}: the sample gives ${name}`);
  }
  assert.equal(stickAround.validateConfig({}).ok, true, 'Stick Around\'s sentence is optional: leaving it out gives the default');
  assert.equal(autocorrect.validateConfig({}).ok, false);
  assert.equal(staffConfigOf(autocorrect, () => 0), null, 'Autocorrect has no fallback');
});

test('every property a staffOptions schema names survives that card\'s validateConfig, or for a surface card its validateDraw (a field it drops would be asked for and thrown away)', () => {
  for (const card of cards) {
    if (!card.staffOptions) continue;
    // A surface card's options are its first draw, not its configuration (its play's configuration is {}): a field the draw drops would be asked for and thrown away just the same.
    if (card.surface) {
      const drawn = card.surface.validateDraw(answers[card.key]);
      assert.equal(drawn.ok, true, card.key);
      if (!drawn.ok) continue;
      for (const name of Object.keys(card.staffOptions.schema.properties as object)) assert.ok(name in drawn.value.payload, `${card.key}: "${name}" is dropped by validateDraw`);
      assert.equal(card.validateConfig({}).ok, true, `${card.key}: the play itself is configured with {}`);
      continue;
    }
    const result = card.validateConfig(answers[card.key]);
    assert.equal(result.ok, true, card.key);
    if (!result.ok) continue;
    const kept = Object.keys(result.value as object);
    for (const name of Object.keys(card.staffOptions.schema.properties as object)) assert.ok(kept.includes(name), `${card.key}: "${name}" is dropped by validateConfig`);
  }
});

/* Face-down Moves (docs/plans/2026-11-07-face-down-moves-design.md, section 4), Task 2. */
test('Card Collector catches the card it names, and Hall Pass is a Reversal on a visit', () => {
  const trap = by('card-collector') as CardRules<{ card: string }>;
  assert.deepEqual(trap.trap, { trigger: { on: 'cast' } });
  assert.equal(trap.catches?.({ card: 'autocorrect' }), 'autocorrect');
  assert.deepEqual(trap.validateConfig({ card: 'whoops' }), { ok: true, value: { card: 'whoops' } });
  for (const card of ['', 'x'.repeat(65), 7, null, undefined]) assert.equal(trap.validateConfig({ card }).ok, false, String(card));
  assert.equal(trap.validateConfig(null).ok, false);
  assert.deepEqual(trap.validateConfig({ card: 'whoops', more: 1 }), { ok: true, value: { card: 'whoops' } });
  const options = trap.staffOptions as unknown as { schema: { properties: { card: { enum: string[] } } } };
  // A persona is offered only the cards Card Collector can name (cast on a post, at or below its own rarity), so no pick is one decideSet refuses.
  assert.deepEqual(options.schema.properties.card.enum, cards.filter((c) => (c.play ?? 'cast') === 'cast' && (c.reaches ?? ['post']).includes('post') && atOrBelow(c.rarity, trap.rarity)).map((c) => c.key));
  for (const card of options.schema.properties.card.enum) assert.equal(decideSet(trap, settings, on('a post'), [], { card }, cards).ok, true, card);
  const pass = by('hall-pass');
  assert.deepEqual([pass.alignment, pass.rarity, pass.play, priceOf('hall-pass')], ['sweet', 'uncommon', 'set', 150]);
  assert.deepEqual(pass.trap, { trigger: { on: 'visit' } });
  assert.equal(pass.catches, undefined, 'a visit Gimmick names no card');
  assert.equal(pass.playPrice(settings, post(10), {}), 0);
  assert.deepEqual(instanceProblems(instance), []);
});

test('Autocorrect\'s phrase is its set phrase', () => {
  assert.equal(autocorrect.setPhrase?.({ phrase: 'Mario', replacement: 'Wario' }), 'Mario');
  assert.equal(by('card-collector').setPhrase, undefined);
});

test('the Booster\'s hit pull gives uncommon 74, rare 24 and legendary 2, shared evenly within a rarity', async () => {
  const { packOdds, isFixed } = await import('../../../engine/rules/packs.ts');
  const booster = instance.packs.find((p): p is PullPack => p.key === 'booster' && !isFixed(p))!;
  assert.deepEqual(booster.pulls.at(-1)!.weights, { uncommon: 74, rare: 24, legendary: 2 });
  const hit = packOdds(booster, cards, instance.settings).at(-1)!;
  const chance = new Map(hit.flatMap((r) => r.cards.map((c) => [c.card, c.chance] as const)));
  // The Gimmicks, Part 6, Jimmy Wails, Part 4, Laugh Track, card notes Part 2 and card notes Part 3 joined the Booster by their rarity, as a new card does, with nothing listed in packs.ts (You Were Saying?, Below the Fold, Overreaction, Hype-Up and THIS are commons, and the hit pull takes none).
  // Card notes Part 5 added Happy Heart and Take the Fall (uncommon), Super Happy Heart and Tattle-Tale (rare) and Ultra Happy Heart (legendary), again with nothing listed in packs.ts.
  // Hype-Up (card notes, Hype-Up on a post) is now a common, so the hit pull leaves it out: twenty uncommons share the 74 (Front Row, Sweet Heat and Thick Skin, uncommons, joined them). Sugar Coat, Graffiti, Line Cutter, Feelin' Glam, Whodunnit?, Super Happy Heart and Tattle-Tale are the rares that share the 24 with Main Event.
  // Off Day and Ultra Happy Heart are the legendaries that share the 2: two, at 0.01 each, so Ultra Happy Heart can be pulled.
  // So Very Happy (rare, the so-very-happy plan's Task 7) joined them, so nine share the 24.
  // Buzzkill (rare, the buzzkill plan's Task 7) joined them, so ten share the 24. Time Machine (rare, the Time Machine plan's Task 6) makes eleven.
  const rares = cards.filter((c) => c.rarity === 'rare');
  assert.deepEqual(rares.map((c) => c.key).sort(), ['buzzkill', 'feelin-glam', 'graffiti', 'line-cutter', 'main-event', 'so-very-happy', 'sugar-coat', 'super-happy-heart', 'tattle-tale', 'time-machine', 'whodunnit']);
  for (const c of rares) assert.ok(Math.abs(chance.get(c.key)! - 0.24 / rares.length) < 1e-9, `${c.name} at ${chance.get(c.key)}`);
  const legendaries = cards.filter((c) => c.rarity === 'legendary');
  assert.deepEqual(legendaries.map((c) => c.key).sort(), ['off-day', 'ultra-happy-heart']);
  for (const c of legendaries) assert.ok(Math.abs(chance.get(c.key)! - 0.01) < 1e-9, `${c.name} at ${chance.get(c.key)}`);
  assert.ok(chance.get('ultra-happy-heart')! > 0, 'Ultra Happy Heart can be pulled');
  assert.ok(Math.abs([...chance.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9, 'the hit pull\'s odds sum to 1');
  const uncommons = cards.filter((c) => c.rarity === 'uncommon');
  // Pay It Forward (uncommon, Refund Outcome, Task 6) joined them, so twenty-one share the 74. Cheap Shot (uncommon, pierce, the Cheap Shot plan's Task 6) makes twenty-two.
  assert.equal(uncommons.length, 22);
  assert.equal(chance.has('hype-up'), false, 'Hype-Up is a common, so the hit pull leaves it out');
  for (const c of uncommons) assert.ok(Math.abs(chance.get(c.key)! - 0.74 / uncommons.length) < 1e-9, `${c.key} at ${chance.get(c.key)}`);
  assert.equal(chance.size, uncommons.length + rares.length + legendaries.length);
});

/* Card notes, Part 6 (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 7): Mooch, Toll, 4D Chess and Off Day. */
test('Mooch, Toll, 4D Chess and Off Day are in the instance, sold as the plan says, and the instance stays whole', () => {
  const rows = ['mooch', 'toll', '4d-chess', 'off-day'].map((k) => [k, by(k).alignment, by(k).rarity, by(k).play ?? 'cast', instance.machine.find((m) => 'card' in m.item && m.item.card === k)?.availability, instance.machine.find((m) => 'card' in m.item && m.item.card === k)?.price]);
  assert.deepEqual(rows, [
    ['mooch', 'salty', 'uncommon', 'cast', 'hidden', 150],
    ['toll', 'pepperoni', 'uncommon', 'use', 'hidden', 150],
    ['4d-chess', 'salty', 'uncommon', 'set', 'hidden', 150],
    ['off-day', 'salty', 'legendary', 'cast', 'hidden', 500],
  ]);
  assert.deepEqual(by('mooch').skim, { share: 0.1 });
  assert.deepEqual(by('toll').gimmick, { kind: 'ride', share: 0.5 });
  assert.deepEqual(by('4d-chess').trap, { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } });
  assert.equal(by('off-day').scoresAs, true);
  assert.deepEqual(by('off-day').reaches, ['character']);
  assert.deepEqual(instanceProblems(instance), []);
});




test('4D Chess names only Moves cast on a post up to uncommon, and a quadrant', () => {
  const chess = by('4d-chess');
  assert.deepEqual(chess.validateConfig({ card: 'whoops', quadrant: 'excitedNegative' }), { ok: true, value: { card: 'whoops', quadrant: 'excitedNegative' } });
  assert.equal(chess.validateConfig({ card: 'whoops' }).ok, false, 'a missing quadrant');
  assert.equal(chess.validateConfig({ card: '', quadrant: 'calmPositive' }).ok, false);
  const keyWords = 'the card is the key of the Move to wait for';
  assert.deepEqual(chess.validateConfig({ card: '', quadrant: 'calmPositive' }), { ok: false, why: keyWords });
  assert.deepEqual(chess.validateConfig({ card: 7, quadrant: 'calmPositive' }), { ok: false, why: keyWords });
  assert.deepEqual(chess.validateConfig({ card: 'x'.repeat(65), quadrant: 'calmPositive' }), { ok: false, why: keyWords }, '65 is too long');
  assert.deepEqual(chess.validateConfig({ card: 'x'.repeat(64), quadrant: 'calmPositive' }), { ok: true, value: { card: 'x'.repeat(64), quadrant: 'calmPositive' } }, '64 passes');
  assert.deepEqual(chess.validateConfig({ card: 'whoops' }), { ok: false, why: 'choose the reactions it pays on' });
  assert.deepEqual(chess.validateConfig({ card: 'whoops', quadrant: 'loud' }), { ok: false, why: 'choose the reactions it pays on' });
  assert.equal(decideSet(chess, settings, on('a post'), [], { card: 'whoops', quadrant: 'calmPositive' }, cards).ok, true);
  assert.equal(decideSet(chess, settings, on('a post'), [], { card: 'mooch', quadrant: 'calmPositive' }, cards).ok, true, 'an uncommon Move');
  const rare = decideSet(chess, settings, on('a post'), [], { card: 'main-event', quadrant: 'calmPositive' }, cards);
  assert.deepEqual(rare, { ok: false, why: '4D Chess names a card that is cast on a post' }, 'Main Event is a rare cast on a thread, so it is refused as not cast on a post');
  // The instance has no rare Move cast on a post (Main Event, its only rare, is cast on a thread), so the rarity words are reached with a rare one added to the list decideSet is given.
  const rareOnPost = { ...by('whoops'), key: 'rare-on-post', rarity: 'rare' as const };
  assert.deepEqual(decideSet(chess, settings, on('a post'), [], { card: 'rare-on-post', quadrant: 'calmPositive' }, [...cards, rareOnPost]), { ok: false, why: '4D Chess names cards up to uncommon' });
  assert.equal(decideSet(chess, settings, on('a post'), [], { card: 'off-day', quadrant: 'calmPositive' }, cards).ok, false, 'a card on a character is not cast on a post');
  assert.equal(decideSet(chess, settings, on('a post'), [], { card: 'whoops' }, cards).ok, false);
  const options = chess.staffOptions as unknown as { schema: { properties: { card: { enum: string[] }; quadrant: { enum: string[] } } } };
  for (const card of options.schema.properties.card.enum) assert.equal(decideSet(chess, settings, on('a post'), [], { card, quadrant: 'calmPositive' }, cards).ok, true, card);
  assert.deepEqual(options.schema.properties.card.enum, cards.filter((c) => castOnPost(c) && atOrBelow(c.rarity, 'uncommon')).map((c) => c.key));
  for (const key of options.schema.properties.card.enum) assert.ok(atOrBelow(by(key).rarity, 'uncommon'), `${key} is no more than uncommon`);
  assert.ok(options.schema.properties.card.enum.includes('mooch'));
  assert.ok(!options.schema.properties.card.enum.includes('main-event'));
  assert.deepEqual(options.schema.properties.quadrant.enum, [...QUADRANTS]);
});


/* Card notes, Part 4 (docs/plans/2026-11-11-card-notes-part-4-plan.md, Task 6): Sugar Coat, Hype-Up and Last Word. */
test('Sugar Coat, Hype-Up and Last Word are in the instance, sold as the plan says, and the instance stays whole', () => {
  const slot = (k: string) => instance.machine.find((m) => 'card' in m.item && m.item.card === k);
  assert.deepEqual(['sugar-coat', 'hype-up', 'last-word'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, slot(k)?.availability, slot(k)?.price]), [
    ['sugar-coat', 'rare', 'use', 'sweet', 'hidden', 300],
    ['hype-up', 'common', 'cast', 'sweet', 'onSale', 100],
    ['last-word', 'uncommon', 'use', 'salty', 'hidden', 150],
  ]);
  assert.deepEqual(by('sugar-coat').gimmick, { kind: 'ward', flavors: ['salty', 'pepperoni'] });
  assert.deepEqual(by('last-word').gimmick, { kind: 'noQuote' });
  assert.deepEqual([by('sugar-coat').lasts, by('last-word').lasts], [{ unit: 'day', count: 7 }, { unit: 'day', count: 7 }]);
  assert.deepEqual(instanceProblems(instance), []);
});

test("Hype-Up holds Publicity Tour's quadrants and span, at a whole vote, with no group", () => {
  const hype = by('hype-up').gimmick as { quadrants: unknown; flat: number; group?: unknown };
  const tour = publicityTour.gimmick as { quadrants: unknown; flat: number; group?: unknown };
  assert.deepEqual(hype.quadrants, tour.quadrants);
  assert.equal('group' in hype || 'group' in tour, false);
  assert.equal(tour.flat, 0.5);
  assert.equal(hype.flat, 1);
  assert.equal(by('hype-up').lasts, publicityTour.lasts);
});


test('Sugar Coat turns away Salty and Pepperoni cards, and passes a Sweet one', () => {
  const ward = [{ card: 'sugar-coat', act: 'k1', gimmick: by('sugar-coat').gimmick, ends: new Date(Date.now() + 86_400_000).toISOString() }];
  const context = { nameOf: (key: string) => cards.find((c) => c.key === key)!.name };
  const salty = { ...by('whoops'), rarity: 'common' as const };
  const pepperoni = { ...by('main-event'), alignment: 'pepperoni' as const, rarity: 'legendary' as const, reaches: ['post' as const] };
  assert.deepEqual(decidePlay(salty, settings, post(10), ward, { color: 'red' }, '', context), { ok: false, why: "this post's Sugar Coat turns away Salty cards" });
  assert.deepEqual(decidePlay(pepperoni, settings, post(10), ward, {}, '', context), { ok: false, why: "this post's Sugar Coat turns away Pepperoni cards" });
  const sweet = { ...by('stick-around'), rarity: 'rare' as const };
  assert.equal(decidePlay(sweet, settings, post(10), ward, { sentence: 'Read it.' }, '', context).ok, true);
});


test('Hype-Up lands on a post, is refused on a character, a second is refused while one is live, and it is cast on a post and not offered to a persona', () => {
  const hypeUp = by('hype-up');
  const now = new Date();
  const live = [{ card: 'hype-up', act: 'k1', gimmick: hypeUp.gimmick, ends: new Date(now.getTime() + 86_400_000).toISOString() }];
  const ended = [{ card: 'hype-up', act: 'k1', gimmick: hypeUp.gimmick, ends: new Date(now.getTime() - 1000).toISOString() }];
  assert.equal(hypeUp.canApply(post(10), [], {}, now).ok, true);
  assert.equal(hypeUp.canApply({ reach: 'character', character: 'c1' }, [], {}, now).ok, false);
  assert.equal(hypeUp.canApply(post(10), live, {}, now).ok, false, 'a second on a post with a live Hype-Up');
  assert.equal(hypeUp.canApply(post(10), ended, {}, now).ok, true, 'a post whose Hype-Up has ended');
  assert.equal(castOnPost(hypeUp), true, 'Card Collector can name it');
  assert.equal(staffOffers(hypeUp), false);
  for (const name of ['card-collector', '4d-chess']) {
    const named = by(name).staffOptions!.schema as { properties: { card: { enum: string[] } } };
    assert.ok(named.properties.card.enum.includes('hype-up'), `${name} can name Hype-Up`);
  }
});


test('Jimmy Wails is a Sweet uncommon Cast on a post, sold for 2.00, with a drive of a week and four gifts', () => {
  const j = jimmy();
  assert.equal(j.name, 'Jimmy Wails');
  assert.equal(j.alignment, 'sweet');
  assert.equal(j.rarity, 'uncommon');
  assert.equal(j.stack, 3);
  assert.equal(j.play ?? 'cast', 'cast');
  assert.deepEqual(j.reaches ?? ['post'], ['post']);
  assert.equal(priceOf('jimmy-wails'), 200, 'the machine slot, hidden as every uncommon is');
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'jimmy-wails')!.availability, 'hidden');
  assert.deepEqual(j.draws, ['blue-shirt', 'close-up', 'dark-logo', 'black-shirt', 'gray-jacket', 'looking-away', 'red-wall', 'full-length', 'pinstripe']);
  assert.deepEqual(j.drive, { lasts: { unit: 'day', count: 7 }, gifts: ['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4'], overhead: 'jimmyWails.overhead' });
  assert.deepEqual(['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4', 'jimmyWails.overhead'].map((k) => settings.economy[k]), [10, 25, 50, 100, 25]);
  assert.equal(giftSplit(10, settings.economy['jimmyWails.overhead']!).overhead, 3, 'a 0.10 gift keeps 0.03 of overhead');
  assert.equal(j.playPrice(settings, post(100), {}), 0, 'a play costs nothing beyond the machine\'s price');
  assert.equal(j.needsMessage, 'an appeal needs a sob story');
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual((j.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key)), ['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4', 'jimmyWails.overhead']);
});




test('Jimmy Wails cannot be set face down: it draws, runs a drive and needs a message, so it is cast now and face up (issue #446)', () => {
  const j = jimmy();
  assert.deepEqual(decideSet(j, settings, on('a post'), [], {}, cards), { ok: false, why: 'Jimmy Wails is played face up and never set face down' });
});

/* ---- Laugh Track (docs/plans/2026-11-11-laugh-track-plan.md, Task 9) ---- */
const cue = (phrase: string, sound: Cue['sound'] = 'laugh'): Cue => ({ phrase, sound });
test('boundedPhrase is the one phrase bound: it refuses 101 characters, three letters and two lines in those words, and trims what it keeps', () => {
  assert.deepEqual(boundedPhrase('a'.repeat(101)), { ok: false, why: 'the phrase is at most 100 characters' });
  assert.deepEqual(boundedPhrase('abc'), { ok: false, why: 'the phrase has at least 4 letters or digits' });
  assert.deepEqual(boundedPhrase('two\nlines'), { ok: false, why: 'the phrase is one line' });
  assert.deepEqual(boundedPhrase('  four  '), { ok: true, phrase: 'four' });
});









test('Laugh Track\'s set phrase is its first cue\'s, and it may be set face down', () => {
  assert.equal(laughTrack.setPhrase?.({ cues: [cue('Mario'), cue('Luigi')] }), 'Mario');
  assert.equal(decideSet(laughTrack as CardRules, settings, on('Mario is here'), [], { cues: [cue('Mario')] }, cards).ok, true);
});

test('Laugh Track asks a persona for cues, and its instance has no problems', () => {
  assert.match(laughTrack.staffOptions!.prompt, /^Choose up to five cues: each a phrase copied exactly from the post you are replying to/);
  assert.deepEqual((laughTrack.staffOptions!.schema as { properties: { cues: { items: { properties: { sound: { enum: string[] } } } } } }).properties.cues.items.properties.sound.enum, ['laugh', 'cheer', 'boo']);
  assert.deepEqual(instanceProblems(instance), []);
});



test('Graffiti is a rare Pepperoni surface on a post, one a post, in the machine at 300, hidden', () => {
  assert.deepEqual([graffiti.rarity, graffiti.alignment, graffiti.stack, surf.limitKey, surf.mostLive], ['rare', 'pepperoni', 1, 'graffiti.limit', 48]);
  assert.deepEqual(instance.machine.find((m) => 'card' in m.item && m.item.card === 'graffiti'), { item: { card: 'graffiti' }, availability: 'hidden', price: 300 });
  assert.equal(instance.settings.cardSettings['graffiti.limit'], 40);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instanceProblems({ ...instance, settings: withOverrides(settings, { cardSettings: { 'graffiti.limit': 101 } }) }).filter((p) => /graffiti/.test(p)).length > 0, true);
});




/* Card notes, Part 2 (docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 8): Line Cutter and Feelin' Glam. */
test("Line Cutter and Feelin' Glam are rares in the instance, hidden at 300 after every on-sale slot, and the instance stays whole", () => {
  const at = (k: string) => instance.machine.findIndex((m) => 'card' in m.item && m.item.card === k);
  assert.deepEqual(['line-cutter', 'feelin-glam'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, by(k).reaches ?? ['post'], by(k).stack ?? 1, instance.machine[at(k)]?.availability, instance.machine[at(k)]?.price]), [
    ['line-cutter', 'rare', 'cast', 'pepperoni', ['post'], 1, 'hidden', 300],
    ['feelin-glam', 'rare', 'cast', 'sweet', ['thread'], 1, 'hidden', 300],
  ]);
  assert.deepEqual([by('line-cutter').replies, by('line-cutter').lasts, by('feelin-glam').keeps, by('feelin-glam').lasts], [true, undefined, true, { unit: 'day', count: 7 }]);
  // The boards hold slots by place: a hidden slot is never among the on-sale run, and the rares come after every on-sale slot.
  const lastOnSale = instance.machine.map((m) => m.availability).lastIndexOf('onSale');
  assert.ok(at('line-cutter') > lastOnSale && at('feelin-glam') > lastOnSale);
  assert.ok(instance.machine.slice(at('feelin-glam')).every((m) => m.availability === 'hidden'));
  assert.deepEqual(settings.reachLasts.thread, { unit: 'day', count: 7 }, "a thread's effect lasts at most a week, Feelin' Glam's");
  assert.deepEqual(instanceProblems(instance), []);
});

test('Line Cutter lands on a post, once, never under a reply that cut in, and costs nothing more', () => {
  const cutter = by('line-cutter');
  const thread = { reach: 'thread' as const, thread: 't1' };
  assert.equal(cutter.canApply(post(10), []).ok, true);
  assert.deepEqual(cutter.canApply(thread, []), { ok: false, why: 'this card lands on a post' });
  assert.deepEqual(cutter.canApply(post(10), [{ card: 'line-cutter', act: 'k1' }]), { ok: false, why: 'this post already carries that card' });
  assert.deepEqual(decidePlay(cutter, settings, { reach: 'post', act: 'p1', kind: 'post', length: 10, text: '', links: [], under: 'p0' }, [], {}, ''), { ok: false, why: 'a reply drawn under a post takes no reply under it' });
  assert.equal(cutter.playPrice(settings, post(10), {}), 0);
  assert.equal(castOnPost(cutter), true, 'Card Collector may name it');
  assert.equal(staffOffers(cutter), false, 'a persona has no reply to carry');
  assert.deepEqual(decideSet(cutter, settings, post(10), [], {}, cards), { ok: false, why: 'Line Cutter carries a reply, so it is played face up and never set face down' });
});

test("a Sugar Coat on the post turns a Line Cutter away, and a Force Field does not", () => {
  const live = new Date(Date.now() + 86_400_000).toISOString();
  const context = { nameOf: (key: string) => cards.find((c) => c.key === key)!.name };
  const coat = [{ card: 'sugar-coat', act: 'k1', gimmick: by('sugar-coat').gimmick, ends: live }];
  assert.deepEqual(decidePlay(by('line-cutter'), settings, post(10), coat, {}, '', context), { ok: false, why: "this post's Sugar Coat turns away Pepperoni cards" });
  const field = [{ card: 'force-field', act: 'k2', gimmick: by('force-field').gimmick, ends: live }];
  assert.equal(decidePlay(by('line-cutter'), settings, post(10), field, {}, '', context).ok, true, 'Force Field stops at uncommon, and Line Cutter is rare');
});


/* Card notes, Part 5 (docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 9): the three Happy Hearts, Take the Fall and Tattle-Tale. */
const FIVE = ['happy-heart', 'super-happy-heart', 'ultra-happy-heart', 'take-the-fall', 'tattle-tale'] as const;
const maybe = (key: string): CardRules | undefined => cards.find((c) => c.key === key);
const postBy = (author: string): CardTarget => ({ reach: 'post', act: 'p1', kind: 'post', length: 10, text: '', links: [], author });
const slotOf = (k: string) => instance.machine.findIndex((m) => 'card' in m.item && m.item.card === k);

test('the three Happy Hearts, Take the Fall and Tattle-Tale are in the instance, with the plan\'s flavor, rarity, reach, effect and lasting, and the instance stays whole', () => {
  assert.deepEqual(FIVE.map((k) => [k, maybe(k)?.alignment, maybe(k)?.rarity, maybe(k)?.play ?? 'cast', maybe(k)?.reaches ?? ['post'], maybe(k)?.discipline, maybe(k)?.lasts, maybe(k)?.stack ?? 1]), [
    ['happy-heart', 'sweet', 'uncommon', 'cast', ['character'], { kind: 'relief', points: 'lightestBand' }, undefined, 1],
    ['super-happy-heart', 'sweet', 'rare', 'cast', ['character'], { kind: 'relief', points: 'all' }, undefined, 1],
    ['ultra-happy-heart', 'sweet', 'legendary', 'cast', ['character'], { kind: 'unban' }, undefined, 1],
    ['take-the-fall', 'sweet', 'uncommon', 'cast', ['post'], { kind: 'fall' }, undefined, 1],
    ['tattle-tale', 'salty', 'rare', 'cast', ['character'], { kind: 'watch', weight: 2 }, { unit: 'day', count: 7 }, 1],
  ]);
  assert.deepEqual(FIVE.map((k) => [maybe(k)?.name, maybe(k)?.gimmick, maybe(k)?.trap, maybe(k)?.writes, maybe(k)?.replies]), [
    ['Happy Heart', undefined, undefined, undefined, undefined], ['Super Happy Heart', undefined, undefined, undefined, undefined], ['Ultra Happy Heart', undefined, undefined, undefined, undefined],
    ['Take the Fall', undefined, undefined, undefined, undefined], ['Tattle-Tale', undefined, undefined, undefined, undefined],
  ]);
  assert.deepEqual(FIVE.map((k) => maybe(k) !== undefined && instant(maybe(k)!)), [true, true, true, false, false], 'the hearts are over when they land, a fall waits and a watch lasts a week');
  assert.deepEqual(instanceProblems(instance), []);
});

test("the five are sold as the machine rule gives: every one hidden, at the plan's prices, after every on-sale slot", () => {
  const row = (k: string) => [k, instance.machine[slotOf(k)]?.availability, instance.machine[slotOf(k)]?.price];
  assert.deepEqual(FIVE.map(row), [['happy-heart', 'hidden', 150], ['super-happy-heart', 'hidden', 300], ['ultra-happy-heart', 'hidden', 600], ['take-the-fall', 'hidden', 150], ['tattle-tale', 'hidden', 300]]);
  const lastOnSale = instance.machine.map((m) => m.availability).lastIndexOf('onSale');
  assert.ok(FIVE.every((k) => slotOf(k) > lastOnSale), 'all five come after every on-sale slot');
});

test('no one of the five is ever set face down, a persona never plays one, and only Take the Fall is cast on a post', () => {
  for (const k of FIVE) {
    const card = maybe(k);
    const target: CardTarget = card?.reaches?.[0] === 'character' ? { reach: 'character', character: 'c1' } : post(10);
    assert.deepEqual(card && decideSet(card, settings, target, [], {}, cards), { ok: false, why: `${card?.name} acts the moment it lands, so it is played face up and never set face down` }, k);
    assert.equal(card !== undefined && staffOffers(card), false, `${k}: a persona does not play on its own office's rulings`);
  }
  assert.deepEqual(FIVE.map((k) => maybe(k) !== undefined && castOnPost(maybe(k)!)), [false, false, false, true, false]);
});

test('the hearts land on a character and are refused on an empty bar or a mask that is not banned; Take the Fall lands on another character\'s post, once; Tattle-Tale on a character, one at a time', () => {
  const chara = (more: { warnPoints?: number; bannedUntil?: string | null } = {}): CardTarget => ({ reach: 'character', character: 'c1', ...more });
  const context = { caster: 'mine', nameOf: (key: string) => cards.find((c) => c.key === key)!.name };
  const later = new Date(Date.now() + 86_400_000).toISOString();
  for (const k of ['happy-heart', 'super-happy-heart']) {
    assert.equal(maybe(k)?.canApply(chara(), []).ok, true, k);
    assert.deepEqual(maybe(k)?.canApply(post(10), []), { ok: false, why: 'this card lands on a character' }, k);
    assert.deepEqual(maybe(k) && decidePlay(maybe(k)!, settings, chara({ warnPoints: 0 }), [], {}, '', context), { ok: false, why: "this character's warn bar is empty" }, k);
    assert.equal(maybe(k) && decidePlay(maybe(k)!, settings, chara({ warnPoints: 3 }), [], {}, '', context).ok, true, k);
    assert.equal(maybe(k)?.playPrice(settings, chara(), {}), 0, k);
  }
  const ultra = maybe('ultra-happy-heart');
  assert.deepEqual(ultra && decidePlay(ultra, settings, chara({ bannedUntil: null }), [], {}, '', context), { ok: false, why: 'this character is not banned' });
  assert.equal(ultra && decidePlay(ultra, settings, chara({ bannedUntil: later }), [], {}, '', context).ok, true);
  const fall = maybe('take-the-fall');
  assert.equal(fall?.canApply(post(10), []).ok, true);
  assert.deepEqual(fall?.canApply(chara(), []), { ok: false, why: 'this card lands on a post' });
  assert.deepEqual(fall?.canApply(post(10), [{ card: 'take-the-fall', act: 'f1' }]), { ok: false, why: 'this post already carries that card' }, 'one per post, waiting until a filing spends it');
  assert.deepEqual(fall && decidePlay(fall, settings, postBy('mine'), [], {}, '', context), { ok: false, why: "Take the Fall is played on another character's post" });
  assert.equal(fall && decidePlay(fall, settings, postBy('theirs'), [], {}, '', context).ok, true);
  const tale = maybe('tattle-tale');
  assert.equal(tale?.canApply(chara(), []).ok, true);
  assert.deepEqual(tale?.canApply(chara(), [{ card: 'tattle-tale', act: 't1', reach: 'character', ends: later }]), { ok: false, why: 'this character already carries that card' });
  assert.equal(tale?.canApply(chara(), [{ card: 'tattle-tale', act: 't1', reach: 'character', ends: new Date(Date.now() - 1000).toISOString() }]).ok, true, 'one that has worn off is no longer in the way');
  for (const k of FIVE) assert.equal(maybe(k)?.validateConfig(null).ok, true, `${k} takes no configuration`);
});

/*
 * How the five meet the two wards (Force Field: turns away cards up to uncommon; Sugar Coat: turns away Salty and Pepperoni cards). A ward is a Gimmick used on
 * a post, so it is a ward of the post's reach, and `decidePlay` weighs a ward only against a card cast at its own reach (a character-reach card never meets a post's ward).
 * Neither real ward reaches a character. So in play: Force Field turns away Take the Fall (the one of the five cast on a post, and uncommon); Sugar Coat turns away none of
 * them, since Take the Fall is Sweet and Tattle-Tale, the one Salty card, is cast on a character. The rules alone (`wardTurnsAway`) say what each ward would do to each
 * card were it ever put at the card's own reach: Force Field would turn away both uncommons and neither rare nor the legendary, Sugar Coat Tattle-Tale alone.
 */
test('Force Field and Sugar Coat are post wards, and what each does to each of the five', () => {
  const field = by('force-field');
  const coat = by('sugar-coat');
  assert.deepEqual([field.reaches ?? ['post'], coat.reaches ?? ['post'], field.play, coat.play], [['post'], ['post'], 'use', 'use']);
  // What the ward's rules alone say of each card.
  const turns = (ward: CardRules) => FIVE.map((k) => maybe(k) !== undefined && wardTurnsAway(ward.gimmick as never, maybe(k)!));
  assert.deepEqual(turns(field), [true, false, false, true, false], 'Force Field: both uncommons, not the rare or the legendary');
  assert.deepEqual(turns(coat), [false, false, false, false, true], 'Sugar Coat: only Salty Tattle-Tale; the Sweet four pass');
  // What happens in play, at the reach each card is cast on.
  const live = new Date(Date.now() + 86_400_000).toISOString();
  const context = { nameOf: (key: string) => cards.find((c) => c.key === key)!.name };
  const wardOn = (key: string, reach: 'post' | 'character') => [{ card: key, act: 'w1', gimmick: by(key).gimmick, ends: live, ...(reach === 'post' ? {} : { reach }) }];
  const target = (k: string): CardTarget => (maybe(k)?.reaches?.[0] === 'character' ? { reach: 'character', character: 'c1', warnPoints: 3, bannedUntil: live } : postBy('theirs'));
  const meets = (k: string, ward: string, reach: 'post' | 'character') => {
    const verdict = maybe(k) && decidePlay(maybe(k)!, settings, target(k), wardOn(ward, reach), {}, '', { ...context, caster: 'mine' });
    return verdict?.ok === true ? 'lands' : verdict?.why;
  };
  assert.deepEqual(FIVE.map((k) => meets(k, 'force-field', 'post')), ['lands', 'lands', 'lands', "this post's Force Field turns away cards up to uncommon", 'lands'], 'a post\'s Force Field turns away only the card cast on a post');
  assert.deepEqual(FIVE.map((k) => meets(k, 'sugar-coat', 'post')), ['lands', 'lands', 'lands', 'lands', 'lands'], 'a post\'s Sugar Coat turns away none of the five: Take the Fall is Sweet, and Tattle-Tale is cast on a character');
  // The same wards put at a character's reach, which no card in the instance does: the rules alone decide.
  assert.deepEqual(FIVE.map((k) => meets(k, 'force-field', 'character')), ["this character's Force Field turns away cards up to uncommon", 'lands', 'lands', 'lands', 'lands']);
  assert.deepEqual(FIVE.map((k) => meets(k, 'sugar-coat', 'character')), ['lands', 'lands', 'lands', 'lands', "this character's Sugar Coat turns away Salty cards"]);
});



/* ---- the flat earn cards, settled with the real instance ---- */
const HR = 3_600_000;
const W_FROM = 100 * HR;
const W_TO = 124 * HR;
function flatBoard(cls: string, plays: InputAct[], reactions: InputReaction[]): SettlementInput {
  return {
    window: { id: 'w1', from: W_FROM, to: W_TO },
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: cls, from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'face', from: 0 }] },
    ],
    acts: [{ id: 'tp1', character: 'tom-1', kind: 'post', at: W_FROM + HR, thread: 't1' }, ...plays],
    reactions,
  };
}
const useOnTom = (id: string, card: string): InputAct => ({ id, character: 'tom-1', kind: 'card', at: W_FROM + 2 * HR, thread: 't1', card, reach: 'character', on: 'tom-1', ends: W_FROM + 20 * HR });
const heatFromBob: InputReaction = { act: 'tp1', player: 'bob', character: 'bob-1', kind: 'tomato', at: W_FROM + 5 * HR };
const amountFor = (r: ReturnType<typeof settle>, reason: string) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === reason).reduce((t, e) => t + e.amount, 0);

test("Heat Magnet pays three quarters of a vote on a heat vote, under any class, and a Technician's loss stays whole", () => {
  const tech = settle(flatBoard('technician', [useOnTom('g1', 'heat-magnet')], [heatFromBob]), instance);
  assert.equal(amountFor(tech, 'technician.draggedIn'), -10);
  assert.equal(amountFor(tech, 'card.boost'), 8, '7.5, rounded');
  assert.deepEqual(tech.entries.find((e) => e.reason === 'card.boost')!.params, { card: 'heat-magnet', flat: 0.75 });
  const heel = settle(flatBoard('heel', [useOnTom('g1', 'heat-magnet')], [heatFromBob]), instance);
  assert.equal(amountFor(heel, 'heel.drewHeat'), 20, 'one vote of heat pays two votes\' worth');
  assert.equal(amountFor(heel, 'card.boost'), 8);
  assert.deepEqual(heel.entries.find((e) => e.reason === 'card.boost')!.params, { card: 'heat-magnet', flat: 0.75 });
});

test("Hype-Up and Publicity Tour both up on one calm vote make one boost, Hype-Up's", () => {
  const hype: InputAct = { id: 'g2', character: 'bob-1', kind: 'card', at: W_FROM + 2 * HR, thread: 't1', card: 'hype-up', target: 'tp1', ends: W_FROM + 20 * HR };
  const calm: InputReaction = { act: 'tp1', player: 'bob', character: 'bob-1', kind: 'thumbs-up', at: W_FROM + 5 * HR };
  const r = settle(flatBoard('face', [useOnTom('g1', 'publicity-tour'), hype], [calm]), instance);
  const boosts = r.entries.filter((e) => e.reason === 'card.boost');
  assert.equal(boosts.length, 1);
  assert.equal(boosts[0]!.amount, 10);
  assert.deepEqual(boosts[0]!.params, { card: 'hype-up', flat: 1 });
});

test('Trap Card became Card Collector and Bluff was withdrawn, and the instance still has no problem', () => {
  const collector = cards.find((c) => c.key === 'card-collector');
  assert.deepEqual(collector?.formerly, [{ key: 'trap-card', name: 'Trap Card' }]);
  assert.deepEqual(instance.withdrawn, [{ key: 'bluff', name: 'Bluff', refund: 100 }]);
  assert.deepEqual(instanceProblems(instance), []);
});

test('every card that can land on a post says what a reader of the board sees of it', () => {
  // A card with no `seen` is shown on the board as "<name> was played on this post", which a model cannot reason about
  // (docs/plans/2026-11-25-reads-see-the-board-design.md, section 3).
  const onPosts = cards.filter((c) => (c.reaches ?? ['post']).includes('post'));
  assert.ok(onPosts.length > 0);
  assert.deepEqual(onPosts.filter((c) => c.seen === undefined).map((c) => c.key), [], 'cards that reach a post and have no seen');
});

test('every seen sentence reads for a bare play, a play with no caster, and a play whose data is malformed', () => {
  const onPosts = cards.filter((c) => (c.reaches ?? ['post']).includes('post'));
  for (const c of onPosts) {
    const bare = seenOf(c.key);
    assert.match(bare, /\S/, `${c.key}: a sentence`);
    assert.ok(bare.includes('2 days ago'), `${c.key} says when: ${bare}`);
    const nameless = seenOf(c.key, { by: null });
    assert.ok(!nameless.includes('Wario') && !nameless.includes('null') && !nameless.includes('undefined'), `${c.key} reads without a caster: ${nameless}`);
    assert.ok(seenOf(c.key, { by: 'Wario' }).includes('Wario'), `${c.key} names its caster where the board does`);
    // Config and state are data from outside: whatever they hold, a sentence comes back and nothing throws.
    for (const junk of [undefined, null, 7, 'text', [], [1, 2], { cues: 'x', phrase: 7, replacement: {}, color: 4, sentence: [], words: 3, strokes: 'no', peeled: 'no', stuck: 5, clean: 'yes', cleared: 1, tail: 9, covered: 'lots', emoji: 9, stencil: 1, can: 2, seed: 'x' }]) {
      const s = seenOf(c.key, { config: junk, state: junk });
      assert.match(s, /\S/, `${c.key} with ${JSON.stringify(junk)}`);
      assert.ok(!/undefined|NaN|\[object/.test(s), `${c.key}: ${s}`);
    }
  }
});
