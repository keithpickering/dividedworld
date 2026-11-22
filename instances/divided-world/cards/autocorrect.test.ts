/**
 * Autocorrect's own rules: its configuration, where it lands, its price and its saved state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PEELS, autocorrect, heldUntil } from './autocorrect.ts';
import { decidePlay, postTarget, type CardRules } from '../../../engine/rules/cards.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { on } from './test-kit.ts';
import { instance } from '../index.ts';

/* ---- Autocorrect (docs/plans/2026-11-03-autocorrect-plan.md, Task 5) ---- */
const config = (phrase: unknown, replacement: unknown = 'Luigi') => autocorrect.validateConfig({ phrase, replacement });

test('Autocorrect is a common Pepperoni Cast that stacks three deep', () => {
  assert.deepEqual([autocorrect.alignment, autocorrect.rarity, autocorrect.play ?? 'cast', autocorrect.stack], ['pepperoni', 'common', 'cast', 3]);
});

test('Autocorrect\'s phrase is 4 to 100 characters with at least 4 letters or digits, trimmed', () => {
  assert.deepEqual(config('  Mario  ', ' Luigi '), { ok: true, value: { phrase: 'Mario', replacement: 'Luigi' } });
  assert.equal(config('cats').ok, true, 'four letters');
  assert.match((config('cat') as { why: string }).why, /at least 4 letters or digits/);
  assert.match((config('a b c') as { why: string }).why, /at least 4 letters or digits/, 'three letters, however long');
  assert.equal(config('x'.repeat(100)).ok, true);
  assert.match((config('x'.repeat(101)) as { why: string }).why, /at most 100 characters/);
  assert.match((config(7) as { why: string }).why, /phrase/);
  assert.match((config('big\ncats') as { why: string }).why, /phrase is one line/, 'a phrase across a line would match across a quote\'s separator');
});

test('Autocorrect\'s replacement is one line of 1 to 100 characters of plain text, and never the phrase itself', () => {
  assert.equal(config('Mario', 'L').ok, true);
  assert.match((config('Mario', '   ') as { why: string }).why, /replacement/);
  assert.equal(config('Mario', 'y'.repeat(100)).ok, true);
  assert.match((config('Mario', 'y'.repeat(101)) as { why: string }).why, /at most 100 characters/);
  assert.match((config('Mario', 'MARIO') as { why: string }).why, /not the phrase itself/);
  assert.match((config('dont stop', "Don't stop!") as { why: string }).why, /not the phrase itself/, 'a replacement the matcher reads as the phrase is the phrase');
  assert.match((config("don't", 'dont') as { why: string }).why, /not the phrase itself/);
  assert.match((config('Mario', 'two\nlines') as { why: string }).why, /one line/);
  assert.deepEqual(config('Mario', '[b]Luigi[/b]'), { ok: true, value: { phrase: 'Mario', replacement: '[b]Luigi[/b]' } }, 'BBCode is kept as the text it is');
});

test('Autocorrect lands only where its phrase is, whole and in any case, never inside a quote', () => {
  const play = (body: string, phrase: string) => decidePlay(autocorrect as CardRules, settings, on(body), [], { phrase, replacement: 'dogs' }, '');
  assert.equal(play('I love Cats.', 'cats').ok, true);
  assert.equal(play('I love CATS', 'cats').ok, true);
  assert.deepEqual(play('concatenate', 'cats'), { ok: false, why: '“cats” is not in this post\'s own words' });
  assert.equal(play('[quote=0f8fad5b-d9cb-469f-a165-70867728950e]cats[/quote] dogs', 'cats').ok, false);
  assert.equal(play('ca[b]ts[/b]', 'cats').ok, true, 'across formatting');
  assert.equal(decidePlay(autocorrect as CardRules, settings, on('cats'), [1, 2, 3].map((i) => ({ card: 'autocorrect', act: `k${i}` })), { phrase: 'cats', replacement: 'dogs' }, '').ok, false, 'three deep already');
});

test('Autocorrect lands on a phrase inside a doctored quote (the Act\'s verdict makes it the poster\'s own words), and not inside an honest one', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const body = `[quote=${id}]cats[/quote] dogs`;
  const play = (forged?: readonly string[]) => decidePlay(autocorrect as CardRules, settings, postTarget('p1', 'post', body, undefined, undefined, undefined, forged), [], { phrase: 'cats', replacement: 'dogs' }, '');
  assert.equal(play().ok, false, 'an honest quote is another post\'s words');
  assert.equal(play([id]).ok, true, 'a forged one is the poster\'s own');
  assert.equal(play(['1f8fad5b-d9cb-469f-a165-70867728950e']).ok, false, 'a verdict on another post changes nothing');
});

test('Autocorrect lands on a post when asked with a config that holds no phrase, as a screen asks before one is typed', () => {
  for (const held of [{}, { color: 'red' }, { phrase: 7 }]) {
    assert.equal(autocorrect.canApply(on('I love cats'), [], held as never, new Date()).ok, true, JSON.stringify(held));
  }
});

test('Autocorrect costs its base price, plus 0.25 per 50 characters it covers, at most 2.00 added', () => {
  const price = (body: string, phrase: string) => autocorrect.playPrice(settings, on(body), { phrase, replacement: 'x' });
  assert.equal(price('cats', 'cats'), 0, '4 characters covered');
  assert.equal(price(Array(12).fill('cats').join(' '), 'cats'), 0, '48 characters covered');
  assert.equal(price(Array(13).fill('cats').join(' '), 'cats'), 25, '52 characters: one step');
  assert.equal(price(Array(50).fill('cats').join(' '), 'cats'), 100, '200 characters: four steps');
  assert.equal(price(Array(1000).fill('cats').join(' '), 'cats'), 200, 'capped: 3.00 in all, less the 1.00 paid at the machine');
  assert.equal(price('Mario Mario', 'mario'), 0);
  assert.equal(autocorrect.playPrice(settings, { reach: 'character', character: 'c' }, { phrase: 'cats', replacement: 'x' }), 0);
  const tuned = withOverrides(settings, { economy: { 'autocorrect.perVolume': 10, 'autocorrect.volumeStep': 4 } });
  assert.equal(autocorrect.playPrice(tuned, on('cats cats cats'), { phrase: 'cats', replacement: 'x' }), 30, 'its numbers are the settings\'');
});

test('Autocorrect\'s saved state is the author\'s peels by occurrence, and the largest fits the database\'s bound', () => {
  assert.deepEqual(autocorrect.validateState!({ peeled: [3, 0, 3, 1] }), { ok: true, value: { peeled: [0, 1, 3] } });
  assert.deepEqual(autocorrect.validateState!({ peeled: [], clean: true }), { ok: true, value: { peeled: [], clean: true } });
  assert.equal(autocorrect.validateState!({ peeled: [-1] }).ok, false);
  assert.equal(autocorrect.validateState!({ peeled: [1.5] }).ok, false);
  assert.equal(autocorrect.validateState!({ peeled: [PEELS.most] }).ok, false);
  assert.equal(autocorrect.validateState!({ peeled: 'all' }).ok, false);
  assert.equal(autocorrect.validateState!({ peeled: [], clean: 'yes' }).ok, false);
  const most = autocorrect.validateState!({ peeled: Array.from({ length: PEELS.most }, (_, i) => i), clean: false });
  assert.equal(most.ok, true);
  const asPostgres = JSON.stringify(most.ok && most.value).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144, `${Buffer.byteLength(asPostgres)} bytes`);
});

test('Autocorrect\'s saved state keeps the stretches the author half-peeled, by the strip\'s place (the tape design, section 9)', () => {
  const check = (state: unknown) => autocorrect.validateState!(state);
  const refused = (state: unknown, predicate: RegExp) => {
    const r = check(state);
    assert.equal(r.ok, false, JSON.stringify(state));
    assert.match(r.ok ? '' : r.why, predicate, JSON.stringify(state));
  };
  assert.deepEqual(check({ peeled: [0], stuck: { '2': [[0.25, 1, 3]] } }), { ok: true, value: { peeled: [0], stuck: { '2': [[0.25, 1, 3]] } } });
  assert.equal(check({ peeled: [], stuck: { '0': [[0, 0.5, 2], [0.5, 1, 3]] } }).ok, true, 'the strip\'s own ends sit at 0 and 1');
  assert.equal(check({ peeled: [], stuck: { '1': [[0.1, 0.2, 7]] } }).ok, true, 'a tear to a peel line');
  refused({ peeled: [], stuck: { '2': [[0.25, 1, 0]] } }, /strip's own end/);
  refused({ peeled: [], stuck: { '2': [[0.5, 0.5, 4]] } }, /from before to/);
  refused({ peeled: [], stuck: { '2': [[0.6, 0.5, 4]] } }, /from before to/);
  refused({ peeled: [], stuck: { '2': [[0.1, 0.5, 4], [0.4, 0.8, 4]] } }, /in order and do not overlap/);
  refused({ peeled: [], stuck: { '2': [[0.5, 0.8, 4], [0.1, 0.2, 4]] } }, /in order and do not overlap/);
  refused({ peeled: [], stuck: { '2': [[0.1, 0.5, 3]] } }, /strip's own end/);
  refused({ peeled: [], stuck: { '2': [[0.1, 0.5, 9]] } }, /edges is a whole number from 0 to 8/);
  refused({ peeled: [], stuck: { '2': [[0.1, 0.5, 1.5]] } }, /edges is a whole number from 0 to 8/);
  refused({ peeled: [], stuck: { '2': [[0.1, 1.00001, 4]] } }, /share is from 0 to 1/);
  refused({ peeled: [], stuck: { '2': [[-0.1, 0.5, 4]] } }, /share is from 0 to 1/);
  refused({ peeled: [2], stuck: { '2': [[0.1, 0.5, 4]] } }, /in peeled or in stuck, never both/);
  refused({ peeled: [], stuck: { '2': [] } }, /at least one stretch/);
  refused({ peeled: [], stuck: { '02': [[0.1, 0.5, 4]] } }, /place/);
  refused({ peeled: [], stuck: { [String(PEELS.most)]: [[0.1, 0.5, 4]] } }, /place/);
  refused({ peeled: [], stuck: [[[0.1, 0.5, 4]]] }, /stuck is/);
  refused({ peeled: [], stuck: { '2': [[0.1, 0.5]] } }, /a stretch is/);
  const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), [[0.1, 0.5, 4]]]));
  assert.equal(check({ peeled: [], stuck: many(2000) }).ok, true);
  refused({ peeled: [], stuck: many(2001) }, /a save holds at most 2000 stretches/);
  assert.deepEqual(check({ peeled: [], stuck: { '1': [[0.123456, 0.5, 4]] } }), { ok: true, value: { peeled: [], stuck: { '1': [[0.1235, 0.5, 4]] } } });
  assert.deepEqual(check({ peeled: [0, 1, 3] }), { ok: true, value: { peeled: [0, 1, 3] } }, 'an old state is kept as it was');
  // The largest save there can be: every place peeled that no stretch sits on, and 2,000 stretches on the others, at their widest.
  const stuck = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [String(PEELS.most - 1 - i), [[0.1235, 0.9876, 4]]]));
  const peeled = Array.from({ length: PEELS.most - 2000 }, (_, i) => i);
  assert.equal(peeled.length, PEELS.most - 2000);
  const mostSaved = check({ peeled, clean: false, stuck });
  assert.equal(mostSaved.ok, true);
  const asPostgres = JSON.stringify(mostSaved.ok && mostSaved.value).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144, `${Buffer.byteLength(asPostgres)} bytes`);
  // The same bound with drops: STUCK.most split between stretches and drops, every split measured, the longest one included.
  let longest = 0;
  for (const stretches of [1, 2, 50, 500, 1000, 1500, 1999, 2000]) {
    const drops = 2000 - stretches;
    const places = Object.fromEntries(Array.from({ length: stretches }, (_, i) => [String(PEELS.most - 1 - i), [[0.5, 0.5001, 4]]]));
    const dropped = Object.fromEntries(Array.from({ length: Math.min(stretches, drops) || 1 }, (_, p) => [String(PEELS.most - 1 - p), [] as number[]]));
    const keys = Object.keys(dropped);
    for (let i = 0; i < drops; i++) dropped[keys[i % keys.length]!]!.push(0);
    for (const k of keys) dropped[k] = dropped[k]!.map((_, i) => Math.round((0.0001 * (i + 1) + (i % 2 ? 0.5001 : 0)) * 10_000) / 10_000).sort((a, b) => a - b);
    const full = check({ peeled: Array.from({ length: PEELS.most - stretches }, (_, i) => i), clean: false, stuck: places, ...(drops ? { drops: dropped } : {}) });
    assert.equal(full.ok, true, `${stretches} stretches and ${drops} drops: ${full.ok ? '' : full.why}`);
    const written = Buffer.byteLength(JSON.stringify(full.ok && full.value).replace(/([,:])/g, '$1 '));
    assert.ok(written <= 262_144, `${stretches} stretches and ${drops} drops: ${written} bytes`);
    longest = Math.max(longest, written);
  }
  assert.ok(longest > 0);
  // Places are bounded by PEELS.most for both lists, so the other extreme is every place peeled.
  const wide = check({ peeled: Array.from({ length: PEELS.most }, (_, i) => i), clean: false, stuck: {} });
  assert.deepEqual(wide, { ok: true, value: { peeled: Array.from({ length: PEELS.most }, (_, i) => i), clean: false } }, 'an empty stuck is dropped');
});

test('Autocorrect\'s saved state keeps where a roll fell, by the strip\'s place: `drops` (the autocorrect feel design, section 4)', () => {
  const check = (state: unknown) => autocorrect.validateState!(state);
  const refused = (state: unknown, predicate: RegExp) => {
    const r = check(state);
    assert.equal(r.ok, false, JSON.stringify(state));
    assert.match(r.ok ? '' : r.why, predicate, JSON.stringify(state));
  };
  const stuck = { '2': [[0.25, 0.5, 4]] };
  const state = { peeled: [0], stuck, drops: { '2': [0, 0.1, 0.25, 0.5, 0.75, 1] } };
  assert.deepEqual(check(state), { ok: true, value: state }, 'a share on a stretch\'s end is not inside it');
  assert.deepEqual(check({ peeled: [0], stuck, drops: {} }), { ok: true, value: { peeled: [0], stuck } }, 'an empty drops is dropped');
  assert.deepEqual(check({ peeled: [0], stuck }), { ok: true, value: { peeled: [0], stuck } }, 'a state without drops is unchanged');
  refused({ peeled: [], stuck, drops: [[0.1]] }, /drops is/);
  refused({ peeled: [], stuck, drops: { '3': [0.1] } }, /place in drops is in stuck/);
  // A place named like an object's own inherited key is no place in stuck, and is refused rather than thrown on.
  for (const key of ['__proto__', 'constructor', 'toString']) {
    refused({ peeled: [], stuck, drops: JSON.parse(`{"${key}":[0.1]}`) }, /place in drops is in stuck/);
  }
  refused({ peeled: [], stuck, drops: { '2': 0.1 } }, /drops holds a list of shares/);
  refused({ peeled: [], stuck, drops: { '2': [0.1, 'a'] } }, /share is from 0 to 1/);
  refused({ peeled: [], stuck, drops: { '2': [1.5] } }, /share is from 0 to 1/);
  refused({ peeled: [], stuck, drops: { '2': [-0.1] } }, /share is from 0 to 1/);
  refused({ peeled: [], stuck, drops: { '2': [0.12345] } }, /to 4 places/);
  refused({ peeled: [], stuck, drops: { '2': [0.2, 0.1] } }, /in order/);
  refused({ peeled: [], stuck, drops: { '2': [0.1, 0.1] } }, /in order/);
  refused({ peeled: [], stuck, drops: { '2': [0.3] } }, /not inside a stretch/);
  const split = (stretches: number, drops: number) => ({
    peeled: [],
    stuck: Object.fromEntries(Array.from({ length: stretches }, (_, i) => [String(i), [[0.5, 0.5001, 4]]])),
    drops: { '0': Array.from({ length: drops }, (_, i) => i / 10_000) },
  });
  assert.equal(check(split(1000, 1000)).ok, true, 'stretches and drops together fill the bound');
  refused(split(1000, 1001), /a save holds at most 2000 stretches and drops/);
});

test('Autocorrect: a landing refusal is said before a configuration\'s, the face shows the most a play adds, and a phrase is priced in characters', () => {
  const stacked = [1, 2, 3].map((i) => ({ card: 'autocorrect', act: `k${i}` }));
  assert.match((decidePlay(autocorrect as CardRules, settings, on('cats'), stacked, { phrase: 'x', replacement: '' }, '') as { why: string }).why, /already carries 3/);
  assert.equal(autocorrect.playPrice(settings, on(''), {} as never), 200, 'with no phrase yet: 3.00 in all less the 1.00 at the machine');
  // Four letters outside the Basic Multilingual Plane: 4 characters, 8 of the string's units. 13 of them cover 52 characters, one step.
  assert.equal(autocorrect.playPrice(settings, on(Array(13).fill('𝒜𝒷𝒸𝒹').join(' ')), { phrase: '𝒜𝒷𝒸𝒹', replacement: 'x' }), 25);
});

test('Autocorrect: the replacement is refused as the phrase itself exactly when the matcher would read them as one', () => {
  assert.equal(config('Mario', 'mArIo').ok, false);
  assert.equal(config('straße', 'STRASSE').ok, true, 'the matcher does not fold ß to SS, so neither does this');
});

test('Autocorrect holds its author\'s saves for holdHours after the play lands; 0 holds none', () => {
  const landed = new Date('2026-11-16T10:00:00Z');
  assert.equal(autocorrect.stateHeldUntil!(settings, landed)?.toISOString(), '2026-11-17T10:00:00.000Z');
  const none = withOverrides(settings, { economy: { 'autocorrect.holdHours': 0 } });
  assert.equal(autocorrect.stateHeldUntil!(none, landed), undefined);
  assert.equal(heldUntil(settings, '2026-11-16T10:00:00Z')?.toISOString(), '2026-11-17T10:00:00.000Z');
  assert.equal(heldUntil(settings, 'not a time'), undefined);
  assert.match(autocorrect.stateHeldWords!('Nov 17, 10:00'), /^This tape is stuck on until Nov 17, 10:00\. It can be peeled after that\.$/);
});

test('autocorrect.holdHours is a whole number of hours from 0 to 168', () => {
  for (const bad of [-1, 169, 1.5]) {
    const problems = instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'autocorrect.holdHours': bad } }) }).join('\n');
    assert.match(problems, /autocorrect\.holdHours/, String(bad));
  }
  assert.deepEqual(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'autocorrect.holdHours': 168 } }) }), []);
});

test('it draws an effect, and tape washed clean (the state\'s clean is true) stops counting toward the post\'s limit', () => {
  const cleared = autocorrect.drawsEffect?.cleared;
  assert.ok(autocorrect.drawsEffect, 'it declares drawsEffect');
  assert.ok(cleared, 'and says when it is cleared');
  assert.equal(cleared({ peeled: [], clean: true }), true);
  assert.equal(cleared({ peeled: [], clean: false }), false);
  assert.equal(cleared({ peeled: [] }), false);
  for (const odd of [{}, null, 'clean', undefined, [], 1]) assert.equal(cleared(odd), false, JSON.stringify(odd));
});
