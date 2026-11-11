import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RARITIES, openDrive, giftSplit, wardTurnsAway, SET_PHRASE_MOST, atOrBelow, drawnInMoment, refusalTime, spanMs, decidePlay, decideSet, decideUse, effectsOnTarget, landsOn, ok, staffConfigOf, staffOffers, refuse, type CardEffect, type CardRules, type CardTarget } from './cards.ts';
import type { Settings } from './types.ts';

// The engine's own test cards: no instance's names (the engine/instance boundary).
const base = { alignment: 'salty' as const, playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const cast = (key: string, rarity: CardRules['rarity']): CardRules => ({ ...base, key, name: `Test ${key}`, rarity, canApply: (t, e, _config, now) => landsOn({ key }, t, e, now) });
const plain = cast('plain', 'common');
const grand = cast('grand', 'legendary');
const shield: CardRules = { ...base, key: 'shield', name: 'Test Shield', rarity: 'uncommon', play: 'use', gimmick: { kind: 'ward', upTo: 'uncommon' }, lasts: { unit: 'day', count: 7 }, canApply: (t, e, _config, now) => landsOn({ key: 'shield' }, t, e, now) };
const snare: CardRules = { ...base, key: 'snare', name: 'Test Snare', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'cast' } }, catches: (c) => (c as { card: string }).card, canApply: () => ok(undefined) };
const pick = (c: unknown) => (typeof c === 'object' && c !== null && (c as { ink?: unknown }).ink === 'red' ? ok({ ink: 'red' }) : refuse('the ink is red'));
const inky: CardRules = { ...base, key: 'inky', name: 'Test Inky', rarity: 'common', canApply: (t, e, _config, now) => landsOn({ key: 'inky' }, t, e, now), validateConfig: pick };
const hallway: CardRules = { ...base, key: 'hallway', name: 'Test Hallway', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'visit' } }, canApply: () => ok(undefined) };
const glue: CardRules = { ...base, key: 'glue', name: 'Test Glue', rarity: 'common', setPhrase: (c) => (c as { phrase: string }).phrase, canApply: (t, e, _config, now) => landsOn({ key: 'glue' }, t, e, now) };
const ground: CardRules = { ...cast('ground', 'common'), reaches: ['thread'], lasts: { unit: 'day', count: 1 } };
const watcher: CardRules = { ...base, key: 'watcher', name: 'Test Watcher', rarity: 'common', play: 'set', trap: { trigger: { on: 'visit' } }, canApply: () => ok(undefined) };

const writer: CardRules = { ...cast('writer', 'rare'), writes: { tokens: () => 40, frame: ({ post }) => ({ prompt: post.text, stop: ['\n\n'] }) } };
const settings = {} as Settings;
const post = { reach: 'post', act: 'p', kind: 'post', length: 10, text: '' } as const satisfies CardTarget;
const soon = new Date(Date.now() + 86_400_000).toISOString();
const gone = new Date(Date.now() - 1000).toISOString();
const names = (key: string) => ({ shield: 'Test Shield' } as Record<string, string>)[key] ?? key;

test('the rarities are in order, and atOrBelow reads that order', () => {
  assert.deepEqual(RARITIES, ['common', 'uncommon', 'rare', 'legendary']);
  assert.equal(atOrBelow('common', 'uncommon'), true);
  assert.equal(atOrBelow('uncommon', 'uncommon'), true);
  assert.equal(atOrBelow('rare', 'uncommon'), false);
  assert.equal(atOrBelow('legendary', 'common'), false);
  // A rarity that is not one of the four is below nothing and covers nothing.
  assert.equal(atOrBelow('mythic' as never, 'legendary'), false);
  assert.equal(atOrBelow('common', 'mythic' as never), false);
});

test('a ward that came in with a malformed end still holds, and one whose card is not named is called a ward', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'uncommon' }, ends: 'not a time' };
  assert.equal(decidePlay(plain, settings, post, [ward], {}, '').ok, false);
  assert.deepEqual(decidePlay(plain, settings, post, [{ card: null, act: 'w', gimmick: { kind: 'ward', upTo: 'uncommon' } }], {}, ''), { ok: false, why: 'this post\'s ward turns away cards up to uncommon' });
});

test('a live ward turns away a cast at or below its rarity, before the card\'s own rules, in the same words for everyone', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'uncommon' }, ends: soon };
  // canApply would refuse a second plain; the ward's words come first.
  const refused = decidePlay(plain, settings, post, [ward, { card: 'plain', act: 'q' }], {}, '', { nameOf: names });
  assert.deepEqual(refused, { ok: false, why: 'this post\'s Test Shield turns away cards up to uncommon' });
  const same = decidePlay({ ...plain, rarity: 'uncommon' }, settings, post, [ward], {}, '', { nameOf: names });
  assert.equal(same.ok, false, 'a card of the ward\'s own rarity is turned away');
  const rarer = decidePlay(grand, settings, post, [ward], {}, '', { nameOf: names });
  assert.equal(rarer.ok, true);
});

test('an ended ward refuses nothing', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'legendary' }, ends: gone };
  assert.equal(decidePlay(plain, settings, post, [ward], {}, '').ok, true);
});

test('decidePlay casts a Cast and nothing else', () => {
  assert.match((decidePlay(shield, settings, post, [], {}, '') as { why: string }).why, /used on your own post/);
  assert.match((decidePlay(snare, settings, post, [], {}, '') as { why: string }).why, /set face down on your own post/);
});

test('decideUse uses a Use and nothing else, and a ward does not stop a Use', () => {
  assert.match((decideUse(plain, settings, post, [], {}, '') as { why: string }).why, /cast/);
  const ward: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'legendary' }, ends: soon };
  // A second Shield is the Shield's own canApply to refuse; the ward does not speak for it.
  assert.deepEqual(decideUse(shield, settings, post, [ward], {}, ''), { ok: false, why: 'this post already carries that card' });
  assert.equal(decideUse(shield, settings, post, [], {}, '').ok, true);
});

test('decideSet sets a card, one face-down card to a post', () => {
  const back: CardEffect = { card: null, act: 's', faceDown: true, ends: soon };
  assert.deepEqual(decideSet(snare, settings, post, [back], { card: 'inky' }, [inky]), { ok: false, why: 'this post already holds a card face down' });
  assert.equal(decideSet(snare, settings, post, [{ ...back, ends: gone }], { card: 'inky' }, [inky]).ok, true);
  assert.equal(decideSet(watcher, settings, post, [], {}, []).ok, true);
  // A ward never blocks a Set.
  assert.equal(decideSet(snare, settings, post, [{ card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'legendary' }, ends: soon }], { card: 'inky' }, [inky]).ok, true);
  assert.match((decideSet(snare, settings, { ...post, kind: 'spin' }, [], { card: 'inky' }, [inky]) as { why: string }).why, /post/);
});

test('decideSet sets a Move that lands on a character, since the quote decides where it lands', () => {
  const beyond: CardRules = { ...inky, key: 'beyond', reaches: ['character'], lasts: { unit: 'day', count: 7 }, canApply: (t, e, _c, now) => landsOn({ key: 'beyond', reaches: ['character'] }, t, e, now) };
  assert.equal(decideSet(beyond, settings, post, [], { ink: 'red' }, [inky]).ok, true);
})

test('decideSet sets a Move, and returns the phrase its landing needs', () => {
  assert.deepEqual(decideSet(inky, settings, post, [], { ink: 'red' }, [inky]), { ok: true, value: { price: 0, config: { ink: 'red' } } });
  assert.deepEqual(decideSet(inky, settings, post, [], { ink: 'blue' }, [inky]), { ok: false, why: 'the ink is red' });
  assert.deepEqual(decideSet(glue, settings, post, [], { phrase: 'soon' }, [glue]), { ok: true, value: { price: 0, config: { phrase: 'soon' }, phrase: 'soon' } });
  const back: CardEffect = { card: null, act: 's', faceDown: true, ends: soon };
  assert.deepEqual(decideSet(glue, settings, post, [back], { phrase: 'soon' }, [glue]), { ok: false, why: 'this post already holds a card face down' });
  assert.match((decideSet(glue, settings, { ...post, kind: 'spin' }, [], { phrase: 'soon' }, [glue]) as { why: string }).why, /post/);
  // An empty phrase is in no post, so the back could never land: it is refused before it is set.
  assert.deepEqual(decideSet(glue, settings, post, [], { phrase: '' }, [glue]), { ok: false, why: 'Test Glue needs a phrase to wait for' });
  assert.deepEqual(decideSet(glue, settings, post, [], { phrase: '  ' }, [glue]), { ok: false, why: 'Test Glue needs a phrase to wait for' });
  // The engine's bound on a set phrase, which the server holds too, so every back's pattern is one length (0142's phrase_pattern).
  assert.equal(decideSet(glue, settings, post, [], { phrase: 'é'.repeat(SET_PHRASE_MOST) }, [glue]).ok, true);
  assert.deepEqual(decideSet(glue, settings, post, [], { phrase: 'x'.repeat(SET_PHRASE_MOST + 1) }, [glue]), { ok: false, why: `Test Glue waits for a phrase of at most ${SET_PHRASE_MOST} characters` });
});

test('a set card that catches a cast names the card it catches, which must be cast on a post', () => {
  const set = decideSet(snare, settings, post, [], { card: 'inky' }, [inky, snare]);
  assert.deepEqual(set, { ok: true, value: { price: 0, config: { card: 'inky' }, catches: 'inky' } });
  for (const named of ['shield', 'snare', 'nothing', 'ground']) {
    assert.deepEqual(decideSet(snare, settings, post, [], { card: named }, [inky, shield, snare, ground]), { ok: false, why: 'Test Snare names a card that is cast on a post' }, named);
  }
  assert.deepEqual(decideSet(hallway, settings, post, [], {}, []), { ok: true, value: { price: 0, config: {} } });
});

test('decideSet refuses a Use, as it always did', () => {
  assert.deepEqual(decideSet(shield, settings, post, [], {}, []), { ok: false, why: 'Test Shield is used on your own post' });
});

test('a post\'s stack counts the plays still up: an ended Use holds no place', () => {
  const ended: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'uncommon' }, ends: gone };
  assert.equal(decideUse(shield, settings, post, [ended], {}, '').ok, true);
  assert.equal(decideUse(shield, settings, post, [{ ...ended, ends: soon }], {}, '').ok, false);
});

test('a decision reads its effects on the clock it is given, and hands that clock to the card\'s landing', () => {
  // One play that ends at noon on a fixed day, decided an hour before and an hour after, whatever the real time is.
  const noon = Date.UTC(2020, 0, 1, 12);
  const before = new Date(noon - 3_600_000);
  const after = new Date(noon + 3_600_000);
  const up: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'uncommon' }, ends: new Date(noon).toISOString() };
  assert.equal(decideUse(shield, settings, post, [up], {}, '', { now: before }).ok, false);
  assert.equal(decideUse(shield, settings, post, [up], {}, '', { now: after }).ok, true);
  assert.equal(decidePlay(plain, settings, post, [up], {}, '', { now: before }).ok, false);
  assert.equal(decidePlay(plain, settings, post, [up], {}, '', { now: after }).ok, true);
  const mine: CardEffect = { card: 'plain', act: 'p1', ends: new Date(noon).toISOString() };
  assert.equal(decidePlay(plain, settings, post, [mine], {}, '', { now: before }).ok, false);
  assert.equal(decidePlay(plain, settings, post, [mine], {}, '', { now: after }).ok, true);
  const seen: (Date | undefined)[] = [];
  const watcher: CardRules = { ...snare, key: 'watcher', canApply: (_t, _e, _config, now) => { seen.push(now); return ok(undefined); } };
  decideSet(watcher, settings, post, [], { card: 'inky' }, [inky], {}, before);
  assert.deepEqual(seen, [before]);
});

// Reach (the card mechanic's design, section 7): a card lands only where its reaches say, its stack counts the effects on that
// same target, and a board carries one board card at a time.
const character: CardTarget = { reach: 'character', character: 'c1' };
const thread: CardTarget = { reach: 'thread', thread: 't1' };
const board: CardTarget = { reach: 'board', board: 'b1' };
const reaching = (key: string, reaches: CardRules['reaches'], stack?: number): CardRules => ({
  ...base, key, name: `Test ${key}`, rarity: 'legendary', reaches, lasts: { unit: 'day', count: 1 }, ...(stack ? { stack } : {}),
  canApply: (t, e, _config, now) => landsOn({ key, reaches, stack }, t, e, now),
});

test('a card lands only on a reach it lists, a post unless it says', () => {
  assert.equal(landsOn({ key: 'plain' }, post, []).ok, true);
  assert.deepEqual(landsOn({ key: 'plain' }, character, []), { ok: false, why: 'this card lands on a post' });
  const sparkle = { key: 'sparkle', reaches: ['character'] as const };
  assert.equal(landsOn(sparkle, character, []).ok, true);
  assert.deepEqual(landsOn(sparkle, post, []), { ok: false, why: 'this card lands on a character' });
  assert.deepEqual(landsOn({ key: 'both', reaches: ['character', 'thread'] }, board, []), { ok: false, why: 'this card lands on a character or a thread' });
  // An Act that is no post is still no post, whatever the card reaches.
  assert.deepEqual(landsOn({ key: 'plain' }, { ...post, kind: 'spin' } as CardTarget, []), { ok: false, why: 'a card lands on a post' });
});

test('a target\'s stack counts only the effects on that same target, never those above it', () => {
  const sparkle = reaching('sparkle', ['character', 'post']);
  // The author's Sparkle is above the post, not on it, so the post can still take one.
  const onAuthor: CardEffect = { card: 'sparkle', act: 'g1', reach: 'character', ends: soon };
  assert.equal(sparkle.canApply(post, [onAuthor]).ok, true);
  assert.deepEqual(sparkle.canApply(character, [onAuthor]), { ok: false, why: 'this character already carries that card' });
  assert.equal(sparkle.canApply(character, [{ ...onAuthor, ends: gone }]).ok, true, 'an ended effect holds no place');
  assert.deepEqual(sparkle.canApply(post, [{ card: 'sparkle', act: 'g2' }]), { ok: false, why: 'this post already carries that card' });
});

test('a board carries one board card at a time, refused until it ends', () => {
  const quake = reaching('quake', ['board']);
  const other = reaching('tremor', ['board']);
  const live: CardEffect = { card: 'tremor', act: 'b0', reach: 'board', ends: '2099-03-04T05:06:07.000Z' };
  assert.deepEqual(quake.canApply(board, [live]), { ok: false, why: 'this board already carries a board card until 2099-03-04 05:06 UTC' });
  assert.equal(quake.canApply(board, [{ ...live, ends: gone }]).ok, true);
  assert.equal(other.canApply(board, []).ok, true);
});

test('a target\'s effects are those above it, board then thread then character, then its own; live ones only above it', () => {
  const at = (act: string, ends?: string): CardEffect => ({ card: 'k', act, ...(ends ? { ends } : {}) });
  const above = { board: [at('b', soon)], thread: [at('t', soon), at('t-gone', gone)], character: [at('c', soon)] };
  const own = [at('p')];
  assert.deepEqual(effectsOnTarget(post, own, above).map((e) => [e.act, e.reach ?? 'post']), [['b', 'board'], ['t', 'thread'], ['c', 'character'], ['p', 'post']]);
  assert.deepEqual(effectsOnTarget(character, [at('c')], above).map((e) => e.act), ['b', 't', 'c']);
  assert.deepEqual(effectsOnTarget(thread, [at('t')], above).map((e) => e.act), ['b', 't']);
  assert.deepEqual(effectsOnTarget(board, [at('b')], above).map((e) => e.act), ['b']);
});

test('a ward turns away casts on its own target only, never one on a target beside it', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'legendary' }, ends: soon, reach: 'character' };
  // A ward on the author is above the post, not on it.
  assert.equal(decidePlay(plain, settings, post, [ward], {}, '').ok, true);
});

test('a card is set face down on a post alone', () => {
  assert.match((decideSet(snare, settings, character, [], {}, []) as { why: string }).why, /set face down on a post/);
});

test('a span is read as Postgres compares intervals: a month as 30 days', () => {
  assert.equal(spanMs({ unit: 'month', count: 1 }), spanMs({ unit: 'day', count: 30 }));
  assert.ok(spanMs({ unit: 'month', count: 1 }) < spanMs({ unit: 'day', count: 31 }));
  assert.equal(spanMs({ unit: 'week', count: 1 }), spanMs({ unit: 'day', count: 7 }));
  assert.equal(spanMs({ unit: 'minute', count: 90 }), 90 * 60_000);
});

test('a board card with a malformed end, or none, is still refused, saying it holds until it ends', () => {
  const quake = reaching('quake', ['board']);
  assert.equal(refusalTime('garbage'), 'it ends');
  assert.deepEqual(quake.canApply(board, [{ card: 'tremor', act: 'b0', reach: 'board', ends: 'garbage' }]), { ok: false, why: 'this board already carries a board card until it ends' });
  assert.deepEqual(quake.canApply(board, [{ card: 'tremor', act: 'b0', reach: 'board' }]), { ok: false, why: 'this board already carries a board card until it ends' });
});

test('a stack beyond a post is said of its own target', () => {
  const two = reaching('sparkle', ['character'], 2);
  const on = (act: string): CardEffect => ({ card: 'sparkle', act, reach: 'character', ends: soon });
  assert.equal(two.canApply(character, [on('a')]).ok, true);
  assert.deepEqual(two.canApply(character, [on('a'), on('b')]), { ok: false, why: 'this character already carries 2 of that card, the most it takes' });
});

test('a ward on a character turns away a cast on that character', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', gimmick: { kind: 'ward', upTo: 'legendary' }, ends: soon, reach: 'character' };
  const onCharacter = reaching('sparkle', ['character']);
  assert.deepEqual(decidePlay(onCharacter, settings, character, [ward], {}, '', { nameOf: names }), { ok: false, why: 'this character\'s Test Shield turns away cards up to legendary' });
});

// A moment draws a card still when its effect can change after it lands (docs/plans/2026-11-03-effect-history-design.md, section 3).
test('drawnInMoment holds for a card that saves state, stacks or ends by time, and fails for a cast that does none', () => {
  const washes: Pick<CardRules, 'validateState' | 'stack' | 'lasts'> = { stack: 3, validateState: (s) => ok(s) };
  assert.equal(drawnInMoment(washes), true);
  assert.equal(drawnInMoment({ validateState: (s) => ok(s) }), true);
  assert.equal(drawnInMoment({ stack: 2 }), true);
  assert.equal(drawnInMoment(shield), true);
  assert.equal(drawnInMoment({ lasts: { unit: 'day', count: 1 } }), true);
  // A hold that never changes once cast, stacking one: named in words, never drawn.
  assert.equal(drawnInMoment(plain), false);
  assert.equal(drawnInMoment({ stack: 1 }), false);
  assert.equal(drawnInMoment(watcher), false);
});

test('a card\'s landing may read its checked configuration, and a landing refusal still comes before a configuration\'s', () => {
  const said: unknown[] = [];
  const words: CardRules<{ word: string }> = {
    key: 'words', name: 'Words', alignment: 'pepperoni', rarity: 'common', playPrice: () => 0,
    canApply: (target, _effects, config) => {
      said.push(config);
      if (target.reach !== 'post' || target.kind !== 'post') return refuse('a post');
      return config && !target.text.includes(config.word) ? refuse('that word is not in this post') : ok(undefined);
    },
    validateConfig: (c) => typeof (c as { word?: unknown })?.word === 'string' ? ok({ word: (c as { word: string }).word.trim() }) : refuse('a word'),
  };
  const on = { ...post, text: 'my cats' };
  assert.deepEqual(decidePlay(words as CardRules, settings, on, [], { word: ' cats ' }, ''), { ok: true, value: { price: 0, config: { word: 'cats' }, message: '' } });
  assert.deepEqual(said.at(-1), { word: 'cats' }, 'it is given the configuration as the card checked it');
  assert.deepEqual(decidePlay(words as CardRules, settings, on, [], { word: 'dogs' }, ''), { ok: false, why: 'that word is not in this post' });
  assert.deepEqual(decidePlay(words as CardRules, settings, { ...on, kind: 'spin' }, [], {}, ''), { ok: false, why: 'a post' }, 'landing first, as before');
  assert.deepEqual(decidePlay(words as CardRules, settings, on, [], {}, ''), { ok: false, why: 'a word' });
});

test('staffConfigOf: the default as {}, else a valid staffConfigs pick at either edge of rng, else null', () => {
  assert.deepEqual(staffConfigOf(plain, () => 0), {}, 'a card whose validateConfig({}) passes is played as {}');
  assert.equal(staffConfigOf(inky, () => 0), null, 'a card with no default and no staffConfigs is not offered');
  const stocked: CardRules = { ...inky, staffConfigs: [{ ink: 'red' }, { ink: 'blue' }] };
  for (const edge of [0, 0.9999999999]) assert.deepEqual(staffConfigOf(stocked, () => edge), { ink: 'red' }, `rng ${edge} lands on a config the card accepts (the invalid one is never picked)`);
  assert.equal(staffConfigOf({ ...inky, staffConfigs: [{ ink: 'blue' }] }, () => 0), null, 'staffConfigs the card itself refuses leave nothing to play');
});

test('staffOffers: a card with staffOptions and no default is offered, and a card with neither is not', () => {
  const options = { prompt: 'Pick an ink.', schema: { type: 'object', properties: { ink: { type: 'string' } }, required: ['ink'], additionalProperties: false } };
  assert.equal(staffOffers(inky), false, 'no default, no staffConfigs, no staffOptions');
  assert.equal(staffOffers({ ...inky, staffOptions: options }), true, 'the persona chooses, so there is something to play');
  assert.equal(staffOffers({ ...inky, staffConfigs: [{ ink: 'red' }] }), true, 'the fallback list alone still offers it');
  assert.equal(staffOffers(plain), true, 'a default alone offers it');
  assert.equal(staffOffers(hallway), false, 'a set card that springs on a visit is never offered: a Mod Bot visits only players\' posts');
  assert.equal(staffOffers({ ...snare, staffOptions: options }), true, 'a set card that springs on a cast is offered with its options');
});

// Conditions on a Move's quote trigger (quote-conditions design, sections 1, 2 and 4).
const moveable = { ...post, text: 'The punchline was funny, honestly.' } as const satisfies CardTarget;
const who = (characters: string[], except = false) => ({ except, characters });
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const refusalOf = (v: unknown) => (v as { ok: false; why: string }).why;

test('decideSet returns the conditions a Move was set with, and none it was not', () => {
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], {}), { ok: true, value: { price: 0, config: { ink: 'red' } } });
  const all = decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { says: 'nice try', passage: 'the  punchline', who: who([A, B], true) });
  assert.deepEqual(all, { ok: true, value: { price: 0, config: { ink: 'red' }, phrase: 'nice try', passage: 'the  punchline', who: { except: true, characters: [A, B] } } });
  assert.equal(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { passage: 'punchline was funny' }).ok, true, 'the matcher is the loose one');
  assert.equal(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { who: who([A]) }).ok, true, 'naming one character, the acting one included, is accepted without a word');
});

test('decideSet refuses conditions on a set card, in plain words', () => {
  for (const c of [{ says: 'x' }, { passage: 'punchline' }, { who: who([A]) }]) {
    assert.deepEqual(decideSet(snare, settings, moveable, [], { card: 'inky' }, [inky], c), { ok: false, why: 'Test Snare takes no conditions' });
    assert.deepEqual(decideSet(watcher, settings, moveable, [], {}, [], c), { ok: false, why: 'Test Watcher takes no conditions' });
  }
  assert.equal(decideSet(snare, settings, moveable, [], { card: 'inky' }, [inky], {}).ok, true);
});

test('a Says on a card with its own phrase is refused; its phrase stays the card\'s', () => {
  assert.deepEqual(decideSet(glue, settings, moveable, [], { phrase: 'soon' }, [glue], { says: 'later' }), { ok: false, why: 'Test Glue already waits for its own phrase' });
  assert.deepEqual(decideSet(glue, settings, moveable, [], { phrase: 'soon' }, [glue], {}), { ok: true, value: { price: 0, config: { phrase: 'soon' }, phrase: 'soon' } });
  const withPassage = decideSet(glue, settings, moveable, [], { phrase: 'soon' }, [glue], { passage: 'punchline' });
  assert.deepEqual(withPassage, { ok: true, value: { price: 0, config: { phrase: 'soon' }, phrase: 'soon', passage: 'punchline' } });
});

test('a Says or a passage that is blank, has no letter or digit, or is too long is refused', () => {
  for (const bad of ['', '   ', '...', '?! -']) {
    assert.match(refusalOf(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { says: bad })), /^what they say needs a letter or a digit/, JSON.stringify(bad));
    assert.match(refusalOf(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { passage: bad })), /^the passage needs a letter or a digit/, JSON.stringify(bad));
  }
  const long = 'x'.repeat(SET_PHRASE_MOST + 1);
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { says: long }), { ok: false, why: `what they say is at most ${SET_PHRASE_MOST} characters` });
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { passage: long }), { ok: false, why: `the passage is at most ${SET_PHRASE_MOST} characters` });
  assert.equal(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { says: 'é'.repeat(SET_PHRASE_MOST) }).ok, true);
});

test('a passage that is not in the post\'s words is refused', () => {
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { passage: 'the setup' }), { ok: false, why: 'that passage is not in this post\'s words' });
  assert.deepEqual(decideSet(inky, settings, { ...moveable, text: '' }, [], { ink: 'red' }, [inky], { passage: 'punchline' }), { ok: false, why: 'that passage is not in this post\'s words' });
});

test('a Who with no characters, more than five, or one twice is refused, and none of it reads who owns a character', () => {
  const ids = [1, 2, 3, 4, 5, 6].map((n) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`);
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { who: who([]) }), { ok: false, why: 'name at least one character, or choose anyone' });
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { who: who(ids) }), { ok: false, why: 'name at most 5 characters' });
  assert.equal(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { who: who(ids.slice(0, 5)) }).ok, true);
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { who: who([A, B, A], true) }), { ok: false, why: 'name each character once' });
  // An id is the same id in either case: the UUID check accepts both.
  assert.deepEqual(decideSet(inky, settings, moveable, [], { ink: 'red' }, [inky], { who: who(['abcdefab-1111-4111-8111-111111111111', 'ABCDEFAB-1111-4111-8111-111111111111'], true) }), { ok: false, why: 'name each character once' });
});

test('a card that writes is refused in plain words where the instance runs no old voice, and decided as any card where it does', () => {
  const sentence = "The old voice isn't running on this forum, so this card can't be played.";
  assert.deepEqual(decidePlay(writer, { oldVoice: false } as Settings, post, [], {}, ''), { ok: false, why: sentence });
  assert.equal(decidePlay(writer, { oldVoice: true } as Settings, post, [], {}, '').ok, true);
  assert.equal(decidePlay(plain, { oldVoice: false } as Settings, post, [], {}, '').ok, true, 'a card that does not write is unaffected');
  assert.equal(decidePlay(writer, {} as Settings, post, [], {}, '').ok, true, 'settings that say nothing about the old voice do not withhold');
  assert.deepEqual(decideSet(writer, { oldVoice: false } as Settings, post, [], {}, [writer]), { ok: false, why: sentence });
  // Where the old voice runs, it is still never set face down: a card that writes is cast face up.
  assert.deepEqual(decideSet(writer, { oldVoice: true } as Settings, post, [], {}, [writer]), { ok: false, why: `${writer.name} writes, so it is cast face up and never set face down` });
  const user: CardRules = { ...writer, key: 'user', play: 'use', lasts: { unit: 'day', count: 1 } };
  assert.deepEqual(decideUse(user, { oldVoice: false } as Settings, post, [], {}, ''), { ok: false, why: sentence });
});

const wardOf = (gimmick: object, over: Partial<CardEffect> = {}): CardEffect => ({ card: 'shield', act: 'w', gimmick, ends: soon, ...over } as CardEffect);
const pep: CardRules = { ...cast('pep', 'common'), alignment: 'pepperoni' };
const sweet: CardRules = { ...cast('sweet', 'common'), alignment: 'sweet' };

test('a ward turns away by rarity, by flavor and by name, each in its own words', () => {
  assert.deepEqual(decidePlay(plain, settings, post, [wardOf({ kind: 'ward', upTo: 'uncommon' })], {}, '', { nameOf: names }), { ok: false, why: "this post's Test Shield turns away cards up to uncommon" });
  assert.deepEqual(decidePlay(plain, settings, post, [wardOf({ kind: 'ward', flavors: ['salty'] })], {}, '', { nameOf: names }), { ok: false, why: "this post's Test Shield turns away Salty cards" });
  assert.equal(decidePlay(sweet, settings, post, [wardOf({ kind: 'ward', flavors: ['salty'] })], {}, '').ok, true, 'a Sweet card passes a Salty ward');
  // Pepperoni is its own flavor: a Salty ward lets it through, and a ward can name it.
  assert.equal(decidePlay(pep, settings, post, [wardOf({ kind: 'ward', flavors: ['salty'] })], {}, '').ok, true);
  assert.deepEqual(decidePlay(pep, settings, post, [wardOf({ kind: 'ward', flavors: ['pepperoni'] })], {}, '', { nameOf: names }), { ok: false, why: "this post's Test Shield turns away Pepperoni cards" });
  assert.deepEqual(decidePlay(plain, settings, post, [wardOf({ kind: 'ward', cards: ['plain'] })], {}, '', { nameOf: names }), { ok: false, why: "this post's Test Shield turns away Test plain" });
  assert.equal(decidePlay(grand, settings, post, [wardOf({ kind: 'ward', cards: ['plain'] })], {}, '').ok, true);
});

test('wardTurnsAway reads rarity, printed flavor and key', () => {
  assert.equal(wardTurnsAway({ kind: 'ward', upTo: 'common' }, plain), true);
  assert.equal(wardTurnsAway({ kind: 'ward', upTo: 'common' }, grand), false);
  assert.equal(wardTurnsAway({ kind: 'ward', flavors: ['sweet'] }, plain), false);
  assert.equal(wardTurnsAway({ kind: 'ward', cards: ['grand'] }, grand), true);
});

test('a ward on a thread does not refuse a cast on a post under it', () => {
  const onThread = wardOf({ kind: 'ward', upTo: 'legendary' }, { reach: 'thread' });
  assert.equal(decidePlay(plain, settings, post, [onThread], {}, '').ok, true);
});

const toll = (add: number, over: Partial<CardEffect> = {}): CardEffect => wardOf({ kind: 'price', flavors: ['salty'], add }, { reach: 'thread', ...over });
const priced: CardRules = { ...plain, playPrice: () => 50 };

test('a price effect on a thread raises a Salty cast on a post under it, and leaves a Sweet one alone', () => {
  const salty = decidePlay(priced, settings, post, [toll(200)], {}, '');
  assert.deepEqual(salty.ok && salty.value.price, 250);
  const calm = decidePlay({ ...priced, alignment: 'sweet' }, settings, post, [toll(200)], {}, '');
  assert.deepEqual(calm.ok && calm.value.price, 50);
  const two = decidePlay(priced, settings, post, [toll(200), toll(30, { act: 'x' })], {}, '');
  assert.deepEqual(two.ok && two.value.price, 280, 'live price effects add');
  const ended = decidePlay(priced, settings, post, [toll(200, { ends: gone })], {}, '');
  assert.deepEqual(ended.ok && ended.value.price, 50, 'an ended one adds nothing');
});

test('a price surcharges a Pepperoni cast only where a price effect names Pepperoni', () => {
  const pepPriced: CardRules = { ...priced, alignment: 'pepperoni' };
  const saltyOnly = decidePlay(pepPriced, settings, post, [toll(200)], {}, '');
  assert.deepEqual(saltyOnly.ok && saltyOnly.value.price, 50, 'a Salty price effect leaves Pepperoni alone');
  const named = decidePlay(pepPriced, settings, post, [wardOf({ kind: 'price', flavors: ['pepperoni'], add: 200 }, { reach: 'thread' })], {}, '');
  assert.deepEqual(named.ok && named.value.price, 250, 'a price effect naming Pepperoni raises it');
  const salty = decidePlay(priced, settings, post, [wardOf({ kind: 'price', flavors: ['pepperoni'], add: 200 }, { reach: 'thread' })], {}, '');
  assert.deepEqual(salty.ok && salty.value.price, 50, 'and a Salty cast is not raised by it');
});

test('a price effect on the thread above a post reaches the cast through effectsOnTarget', () => {
  const above = { board: [], thread: [toll(200)], character: [] };
  const effects = effectsOnTarget(post, [], above);
  assert.equal(effects.length, 1);
  const cast = decidePlay(priced, settings, post, effects, {}, '');
  assert.deepEqual(cast.ok && cast.value.price, 250);
});

test('a price is never below zero, and a use or a set takes no surcharge', () => {
  const cheap = decidePlay(plain, settings, post, [toll(-500)], {}, '');
  assert.deepEqual(cheap.ok && cheap.value.price, 0);
  const own: CardRules = { ...shield, alignment: 'salty', playPrice: () => 50 };
  const used = decideUse(own, settings, post, [toll(200)], {}, '');
  assert.deepEqual(used.ok && used.value.price, 50);
  const set = decideSet(inky, settings, post, [toll(200)], { ink: 'red' }, [inky]);
  assert.deepEqual(set.ok && set.value.price, 0);
});

test('a set card names, or matches, only cards at or below its own rarity', () => {
  assert.deepEqual(decideSet(snare, settings, post, [], { card: 'grand' }, [grand, snare]), { ok: false, why: 'Test Snare names cards up to uncommon' });
  assert.equal(decideSet(snare, settings, post, [], { card: 'inky' }, [inky, snare]).ok, true);
  const net = (upTo: CardRules['rarity']): CardRules => ({ ...snare, key: 'net', name: 'Test Net', catches: undefined, trap: { trigger: { on: 'cast' }, match: { upTo } } });
  assert.deepEqual(decideSet(net('rare'), settings, post, [], {}, []), { ok: false, why: 'Test Net names cards up to uncommon' });
  assert.equal(decideSet(net('uncommon'), settings, post, [], {}, []).ok, true);
  const salty: CardRules = { ...net('common'), trap: { trigger: { on: 'cast' }, match: { flavors: ['salty'] } } };
  assert.equal(decideSet(salty, settings, post, [], {}, []).ok, true);
});

test('a set card with no trap is refused', () => {
  const none: CardRules = { ...watcher, trap: undefined };
  assert.deepEqual(decideSet(none, settings, post, [], {}, []), { ok: false, why: 'Test Watcher has no trap to spring' });
});

test('a gift splits into the overhead, rounded up, and what arrives', () => {
  assert.deepEqual(giftSplit(10, 25), { overhead: 3, arrives: 7 });
  assert.deepEqual(giftSplit(25, 25), { overhead: 7, arrives: 18 });
  assert.deepEqual(giftSplit(50, 25), { overhead: 13, arrives: 37 });
  assert.deepEqual(giftSplit(100, 25), { overhead: 25, arrives: 75 });
  assert.deepEqual(giftSplit(10, 0), { overhead: 0, arrives: 10 });
  assert.deepEqual(giftSplit(10, 100), { overhead: 10, arrives: 0 });
});

test('the open drive is the one whose close is after now, with its plays', () => {
  const play = (act: string, drive: string, closes: string): CardEffect => ({ card: 'appeal', act, drive, closes });
  const a = play('a', 'a', gone);
  const b1 = play('b', 'b', soon);
  const b2 = play('c', 'b', soon);
  const open = openDrive([a, b1, b2, { card: 'other', act: 'z' }], 'appeal', new Date());
  assert.equal(open?.id, 'b');
  assert.equal(open?.closes, soon);
  assert.deepEqual(open?.plays, [b1, b2]);
  assert.equal(openDrive([a], 'appeal', new Date()), undefined, 'every drive has closed');
  assert.equal(openDrive([b1], 'other', new Date()), undefined, 'another card has none');
  assert.equal(openDrive([], 'appeal', new Date()), undefined);
});
