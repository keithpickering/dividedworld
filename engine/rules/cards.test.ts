import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RARITIES, atOrBelow, refusalTime, spanMs, decidePlay, decideSet, decideUse, effectsOnTarget, landsOn, ok, refuse, type CardEffect, type CardRules, type CardTarget } from './cards.ts';
import type { Settings } from './types.ts';

// The engine's own test cards: no instance's names (the engine/instance boundary).
const base = { alignment: 'salty' as const, priceKey: 'x.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const cast = (key: string, rarity: CardRules['rarity']): CardRules => ({ ...base, key, name: `Test ${key}`, rarity, canApply: (t, e) => landsOn({ key }, t, e) });
const plain = cast('plain', 'common');
const grand = cast('grand', 'legendary');
const shield: CardRules = { ...base, key: 'shield', name: 'Test Shield', rarity: 'uncommon', play: 'use', ward: true, lasts: { unit: 'day', count: 7 }, canApply: (t, e) => landsOn({ key: 'shield' }, t, e) };
const snare: CardRules = { ...base, key: 'snare', name: 'Test Snare', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'cast' }, outcome: { do: 'payout' } }, canApply: () => ok(undefined) };
const pick = (c: unknown) => (typeof c === 'object' && c !== null && (c as { ink?: unknown }).ink === 'red' ? ok({ ink: 'red' }) : refuse('the ink is red'));
const inky: CardRules = { ...base, key: 'inky', name: 'Test Inky', rarity: 'common', canApply: (t, e) => landsOn({ key: 'inky' }, t, e), validateConfig: pick };
const striker: CardRules = { ...base, key: 'striker', name: 'Test Striker', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'reply' }, outcome: { do: 'strike', card: 'inky' } }, canApply: () => ok(undefined) };
const bluff: CardRules = { ...base, key: 'bluffy', name: 'Test Bluffy', rarity: 'common', play: 'set', canApply: () => ok(undefined) };

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
  const ward: CardEffect = { card: 'shield', act: 'w', ward: 'uncommon', ends: 'not a time' };
  assert.equal(decidePlay(plain, settings, post, [ward], {}, '').ok, false);
  assert.deepEqual(decidePlay(plain, settings, post, [{ card: null, act: 'w', ward: 'uncommon' }], {}, ''), { ok: false, why: 'this post\'s ward turns away cards up to uncommon' });
});

test('a live ward turns away a cast at or below its rarity, before the card\'s own rules, in the same words for everyone', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', ward: 'uncommon', ends: soon };
  // canApply would refuse a second plain; the ward's words come first.
  const refused = decidePlay(plain, settings, post, [ward, { card: 'plain', act: 'q' }], {}, '', { nameOf: names });
  assert.deepEqual(refused, { ok: false, why: 'this post\'s Test Shield turns away cards up to uncommon' });
  const same = decidePlay({ ...plain, rarity: 'uncommon' }, settings, post, [ward], {}, '', { nameOf: names });
  assert.equal(same.ok, false, 'a card of the ward\'s own rarity is turned away');
  const rarer = decidePlay(grand, settings, post, [ward], {}, '', { nameOf: names });
  assert.equal(rarer.ok, true);
});

test('an ended ward refuses nothing', () => {
  const ward: CardEffect = { card: 'shield', act: 'w', ward: 'legendary', ends: gone };
  assert.equal(decidePlay(plain, settings, post, [ward], {}, '').ok, true);
});

test('decidePlay casts a Cast and nothing else', () => {
  assert.match((decidePlay(shield, settings, post, [], {}, '') as { why: string }).why, /used on your own post/);
  assert.match((decidePlay(snare, settings, post, [], {}, '') as { why: string }).why, /set face down on your own post/);
});

test('decideUse uses a Use and nothing else, and a ward does not stop a Use', () => {
  assert.match((decideUse(plain, settings, post, [], {}, '') as { why: string }).why, /cast/);
  const ward: CardEffect = { card: 'shield', act: 'w', ward: 'legendary', ends: soon };
  // A second Shield is the Shield's own canApply to refuse; the ward does not speak for it.
  assert.deepEqual(decideUse(shield, settings, post, [ward], {}, ''), { ok: false, why: 'this post already carries that card' });
  assert.equal(decideUse(shield, settings, post, [], {}, '').ok, true);
});

test('decideSet sets a Set, one face-down card to a post', () => {
  assert.match((decideSet(plain, settings, post, [], {}, []) as { why: string }).why, /cast/);
  const back: CardEffect = { card: null, act: 's', faceDown: true, ends: soon };
  assert.deepEqual(decideSet(snare, settings, post, [back], {}, []), { ok: false, why: 'this post already holds a card face down' });
  assert.equal(decideSet(snare, settings, post, [{ ...back, ends: gone }], {}, []).ok, true);
  assert.equal(decideSet(bluff, settings, post, [], {}, []).ok, true);
  // A ward never blocks a Set.
  assert.equal(decideSet(snare, settings, post, [{ card: 'shield', act: 'w', ward: 'legendary', ends: soon }], {}, []).ok, true);
  assert.match((decideSet(snare, settings, { ...post, kind: 'spin' }, [], {}, []) as { why: string }).why, /post/);
});

test('a strike\'s configuration is checked by the struck card\'s own rules', () => {
  assert.deepEqual(decideSet(striker, settings, post, [], { ink: 'blue' }, [inky]), { ok: false, why: 'the ink is red' });
  const set = decideSet(striker, settings, post, [], { ink: 'red', extra: 1 }, [inky]);
  assert.deepEqual(set, { ok: true, value: { price: 0, config: { ink: 'red' } } });
  assert.match((decideSet(striker, settings, post, [], { ink: 'red' }, []) as { why: string }).why, /no card "inky"/);
});

test('a post\'s stack counts the plays still up: an ended Use holds no place', () => {
  const ended: CardEffect = { card: 'shield', act: 'w', ward: 'uncommon', ends: gone };
  assert.equal(decideUse(shield, settings, post, [ended], {}, '').ok, true);
  assert.equal(decideUse(shield, settings, post, [{ ...ended, ends: soon }], {}, '').ok, false);
});

// Reach (the card mechanic's design, section 7): a card lands only where its reaches say, its stack counts the effects on that
// same target, and a board carries one board card at a time.
const character: CardTarget = { reach: 'character', character: 'c1' };
const thread: CardTarget = { reach: 'thread', thread: 't1' };
const board: CardTarget = { reach: 'board', board: 'b1' };
const reaching = (key: string, reaches: CardRules['reaches'], stack?: number): CardRules => ({
  ...base, key, name: `Test ${key}`, rarity: 'legendary', reaches, lasts: { unit: 'day', count: 1 }, ...(stack ? { stack } : {}),
  canApply: (t, e) => landsOn({ key, reaches, stack }, t, e),
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
  const ward: CardEffect = { card: 'shield', act: 'w', ward: 'legendary', ends: soon, reach: 'character' };
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
  const ward: CardEffect = { card: 'shield', act: 'w', ward: 'legendary', ends: soon, reach: 'character' };
  const onCharacter = reaching('sparkle', ['character']);
  assert.deepEqual(decidePlay(onCharacter, settings, character, [ward], {}, '', { nameOf: names }), { ok: false, why: 'this character\'s Test Shield turns away cards up to legendary' });
});

test('a card\'s landing may read its checked configuration, and a landing refusal still comes before a configuration\'s', () => {
  const said: unknown[] = [];
  const words: CardRules<{ word: string }> = {
    key: 'words', name: 'Words', alignment: 'pepperoni', rarity: 'common', priceKey: 'p', playPrice: () => 0,
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
