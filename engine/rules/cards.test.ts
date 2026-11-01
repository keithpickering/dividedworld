import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RARITIES, atOrBelow, decidePlay, decideSet, decideUse, landsOnPost, ok, refuse, type CardEffect, type CardRules, type CardTarget } from './cards.ts';
import type { Settings } from './types.ts';

// The engine's own test cards: no instance's names (the engine/instance boundary).
const base = { alignment: 'salty' as const, priceKey: 'x.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const cast = (key: string, rarity: CardRules['rarity']): CardRules => ({ ...base, key, name: `Test ${key}`, rarity, canApply: (t, e) => landsOnPost({ key }, t, e) });
const plain = cast('plain', 'common');
const grand = cast('grand', 'legendary');
const shield: CardRules = { ...base, key: 'shield', name: 'Test Shield', rarity: 'uncommon', play: 'use', ward: true, lasts: { unit: 'day', count: 7 }, canApply: (t, e) => landsOnPost({ key: 'shield' }, t, e) };
const snare: CardRules = { ...base, key: 'snare', name: 'Test Snare', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'cast' }, outcome: { do: 'payout' } }, canApply: () => ok(undefined) };
const pick = (c: unknown) => (typeof c === 'object' && c !== null && (c as { ink?: unknown }).ink === 'red' ? ok({ ink: 'red' }) : refuse('the ink is red'));
const inky: CardRules = { ...base, key: 'inky', name: 'Test Inky', rarity: 'common', canApply: (t, e) => landsOnPost({ key: 'inky' }, t, e), validateConfig: pick };
const striker: CardRules = { ...base, key: 'striker', name: 'Test Striker', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'reply' }, outcome: { do: 'strike', card: 'inky' } }, canApply: () => ok(undefined) };
const bluff: CardRules = { ...base, key: 'bluffy', name: 'Test Bluffy', rarity: 'common', play: 'set', canApply: () => ok(undefined) };

const settings = {} as Settings;
const post: CardTarget = { act: 'p', kind: 'post', length: 10 };
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
