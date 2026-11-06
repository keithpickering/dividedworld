/**
 * Divided World's two cards (design, sections 7 and 10): Stick Around and Whoops!. Plan Task 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickAround } from './stick-around.ts';
import { STROKES, whoops } from './whoops.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { basePrice, staffConfigOf, decidePlay, decideSet, postTarget, type CardRules } from '../../../engine/rules/cards.ts';
import { PEELS, autocorrect } from './autocorrect.ts';
import { decide } from '../../../engine/rules/actions.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import type { CardTarget } from '../../../engine/rules/cards.ts';

const post = (length: number): CardTarget => ({ reach: 'post', act: 'p1', kind: 'post', length, text: '' });

test('the instance sells its cards at their prices', () => {
  assert.deepEqual(cards.map((c) => [c.key, c.alignment, basePrice(c, settings)]), [['stick-around', 'sweet', 100], ['whoops', 'salty', 100], ['trap-card', 'salty', 150], ['force-field', 'sweet', 150], ['bluff', 'pepperoni', 25], ['glitter-bomb', 'pepperoni', 150], ['main-event', 'sweet', 300], ['feelin-fab', 'sweet', 20], ['autocorrect', 'pepperoni', 100]]);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instance.cards, cards);
});

test('a card\'s prices are settings: an override reaches what it sells for and what it costs to play', () => {
  const tuned = withOverrides(settings, { economy: { 'whoops.price': 150, 'whoops.perLength': 50, 'whoops.mostInAll': 400 } });
  assert.equal(basePrice(whoops, tuned), 150);
  assert.equal(basePrice(stickAround, withOverrides(settings, { economy: { 'stickAround.price': 75 } })), 75);
  assert.equal(whoops.playPrice(withOverrides(settings, { economy: { 'whoops.lengthStep': 250 } }), post(500), { color: 'red' }), 50, 'the step is a setting too');
  assert.equal(whoops.playPrice(withOverrides(settings, { economy: { 'whoops.mostInAll': 50 } }), post(6000), { color: 'red' }), 0, 'a cap at or below the price never makes a play pay back');
  assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'whoops.lengthStep': 0 } }) }).join('\n'), /whoops\.lengthStep/);
  assert.equal(whoops.playPrice(tuned, post(1000), { color: 'red' }), 100);
  assert.equal(basePrice(whoops, tuned) + whoops.playPrice(tuned, post(1_000_000), { color: 'red' }), 400);
});

test('Whoops! costs 0.25 more per 500 characters of its target, at most 3.00 in all', () => {
  const config = { color: '#ff00aa' };
  assert.equal(whoops.playPrice(settings, post(499), config), 0);
  assert.equal(whoops.playPrice(settings, post(500), config), 25);
  assert.equal(whoops.playPrice(settings, post(999), config), 25);
  assert.equal(whoops.playPrice(settings, post(1000), config), 50);
  assert.equal(whoops.playPrice(settings, post(6000), config), 200, 'twelve steps would be 3.00 on top; with the 1.00 paid, 3.00 is all');
  assert.equal(basePrice(whoops, settings) + whoops.playPrice(settings, post(6000), config), 300);
  assert.equal(basePrice(whoops, settings) + whoops.playPrice(settings, post(1_000_000), config), 300);
});

test('Stick Around costs nothing more to play', () => {
  assert.equal(stickAround.playPrice(settings, post(6000), { sentence: 'Read it.' }), 0);
});

test('Whoops!\'s ink is a color, and only a color', () => {
  assert.deepEqual(whoops.validateConfig({ color: '#FF00AA' }), { ok: true, value: { color: '#ff00aa' } });
  assert.deepEqual(whoops.validateConfig({ color: 'Teal' }), { ok: true, value: { color: 'teal' } });
  assert.deepEqual(whoops.validateConfig({ color: 'beige' }), { ok: true, value: { color: 'beige' } }, 'the same list as a post\'s [color]');
  for (const color of ['url(javascript:alert(1))', 'red; background: x', '#ff00a', 'notacolor', '', 7, null]) {
    assert.equal(whoops.validateConfig({ color }).ok, false, String(color));
  }
  assert.equal(whoops.validateConfig(null).ok, false);
});

test('Stick Around\'s release is the caster\'s own sentence, bounded, with the design\'s default', () => {
  assert.deepEqual(stickAround.validateConfig({}), { ok: true, value: { sentence: 'I legally certify that I have read this post in full and thought about it contemplatively' } });
  assert.deepEqual(stickAround.validateConfig({ sentence: '  I read it.  ' }), { ok: true, value: { sentence: 'I read it.' } });
  assert.equal(stickAround.validateConfig({ sentence: 'x'.repeat(201) }).ok, false);
  assert.equal(stickAround.validateConfig({ sentence: '   ' }).ok, false);
  assert.equal(stickAround.validateConfig({ sentence: 7 }).ok, false);
});

test('a card lands on a post up to its stack: Stick Around once, Whoops! three times, never on an edit', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'whoops', act: `k${i}` }));
  assert.equal(whoops.canApply(post(10), []).ok, true);
  assert.equal(whoops.canApply(post(10), [{ card: 'stick-around', act: 'k0' }]).ok, true, 'the two combine');
  assert.equal(whoops.canApply(post(10), w(2)).ok, true, 'a third Whoops! lands');
  assert.deepEqual(whoops.canApply(post(10), w(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.equal(whoops.canApply(post(10), [...w(2), { card: 'stick-around', act: 's' }]).ok, true, 'another card is not counted');
  assert.deepEqual(stickAround.canApply(post(10), [{ card: 'stick-around', act: 's' }]), { ok: false, why: 'this post already carries that card' });
  assert.equal(stickAround.canApply({ reach: 'post', act: 'p1', kind: 'edit', length: 10, text: '' }, []).ok, false);
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

test('Whoops! strokes wash or ink, in shares of the post body\'s box: across 0 to 1, down 0 to 1', () => {
  const ink = { tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: [[0.1, 0.2], [0.3, 0.4]] };
  const wash = { tool: 'wash', width: 0.3, aspect: 2.99, points: [[0.5, 0.5]] };
  assert.equal(whoops.validateState!({ strokes: [ink, wash] }).ok, true);
  assert.equal(whoops.validateState!({ strokes: [] }).ok, true, 'nothing saved yet');
  assert.deepEqual(whoops.validateState!({ strokes: [wash], clean: true }), { ok: true, value: { strokes: [wash], clean: true } }, 'washed clean, said by the author\'s save');
  assert.equal(whoops.validateState!({ strokes: [], clean: 'yes' }).ok, false);
  // A state 0026 moved aside keeps its old strokes under legacy; a save never carries it back.
  assert.deepEqual(whoops.validateState!({ strokes: [wash], legacy: { strokes: [{ width: 0.05, points: [[0.1, 0.2]] }] } }), { ok: true, value: { strokes: [wash] } }, 'a save takes no legacy');
  const refused = (stroke: object, why: RegExp, label: string) => {
    const r = whoops.validateState!({ strokes: [stroke] });
    assert.equal(r.ok, false, label);
    assert.match(String(!r.ok && r.why), why, label);
  };
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: [[1, 1]] }] }).ok, true, 'down to 1');
  refused({ ...ink, points: [[0.5, 1.2]] }, /down/, 'a down of 1.2');
  refused({ ...ink, points: [[1.01, 0.5]] }, /across/, 'an across of 1.01');
  refused({ ...ink, points: [[-0.01, 0.5]] }, /across/, 'a negative across');
  refused({ ...ink, aspect: undefined }, /aspect/, 'a missing aspect');
  refused({ ...ink, aspect: 0 }, /aspect/, 'an aspect of 0');
  refused({ ...ink, aspect: 5000 }, /aspect/, 'an aspect of 5000');
  refused({ ...ink, aspect: Number.NaN }, /aspect/, 'an aspect that is not a number');
  refused({ ...ink, width: 1.5 }, /wide/, 'too wide');
  refused({ ...ink, width: 0.00004 }, /wide/, 'a width that keeps to nothing');
  refused({ ...ink, tool: 'brush' }, /washes or inks/, 'a tool is wash or ink');
  refused({ ...ink, color: undefined }, /color/, 'ink carries a color');
  refused({ ...wash, color: 'red' }, /no color/, 'a wash carries none');
  refused({ ...ink, color: 'url(x)' }, /color/, 'not a color');
  refused({ ...ink, points: Array(501).fill([0.5, 0.5]) }, /points/, 'too many points');
  refused({ ...ink, points: [[0.1, Number.NaN]] }, /point/, 'a point that is not a number');
  assert.equal(whoops.validateState!({ strokes: Array(201).fill(ink) }).ok, false, 'too many strokes');
  assert.equal(whoops.validateState!({ strokes: 'all of them' }).ok, false);
});

test('the most strokes Whoops! saves fit the database\'s bound, as Postgres writes them', () => {
  // Every stroke at its longest, every point at its longest, until the total runs out.
  const point = [0.123456789, 0.987654321];
  const strokes = [];
  let left = STROKES.totalPoints;
  while (left > 0) { const n = Math.min(STROKES.points, left); strokes.push({ tool: 'ink', color: '#abcdef', width: 0.99994321, aspect: 0.00123456, points: Array(n).fill(point) }); left -= n; }
  const saved = whoops.validateState!({ strokes, clean: false });
  assert.equal(saved.ok, true);
  // jsonb's text puts a space after every comma and colon.
  const asPostgres = JSON.stringify(saved.ok && saved.value).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144, `${Buffer.byteLength(asPostgres)} bytes`);
  assert.equal(whoops.validateState!({ strokes: [...strokes, { tool: 'wash', width: 1, aspect: 1, points: [[0, 0]] }] }).ok, false, 'one point past the total');
});

test('a stroke\'s points and width are kept to a ten-thousandth, its aspect to three significant figures', () => {
  const saved = whoops.validateState!({ strokes: [{ tool: 'ink', color: 'red', width: 0.123456, aspect: 2.34567, points: [[0.123456, 0.987654]] }] });
  assert.deepEqual(saved.ok && saved.value, { strokes: [{ tool: 'ink', color: 'red', width: 0.1235, aspect: 2.35, points: [[0.1235, 0.9877]] }] });
  const small = whoops.validateState!({ strokes: [{ tool: 'wash', width: 0.5, aspect: 0.0123456, points: [[0, 0]] }] });
  assert.deepEqual(small.ok && small.value, { strokes: [{ tool: 'wash', width: 0.5, aspect: 0.0123, points: [[0, 0]] }] });
});

test('Stick Around holds no state to save', () => {
  assert.equal(stickAround.validateState, undefined);
});

/* The card mechanic's first cards (docs/plans/2026-11-01-card-plays-plan.md, Task 8): Trap Card, Force Field and Bluff. */
test('the instance sells Trap Card, Force Field and Bluff, each with its rarity and play, and stays whole', () => {
  const by = (key: string) => cards.find((c) => c.key === key)!;
  assert.deepEqual(['trap-card', 'force-field', 'bluff', 'whoops', 'stick-around'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, basePrice(by(k), settings)]), [
    ['trap-card', 'uncommon', 'set', 'salty', 150],
    ['force-field', 'uncommon', 'use', 'sweet', 150],
    ['bluff', 'common', 'set', 'pepperoni', 25],
    ['whoops', 'common', 'cast', 'salty', 100],
    ['stick-around', 'common', 'cast', 'sweet', 100],
  ]);
  assert.deepEqual(by('trap-card').trap, { trigger: { on: 'cast' }, outcome: { do: 'payout' } });
  assert.equal(by('bluff').trap, undefined, 'a Set card with no trap is a bluff');
  assert.deepEqual([by('force-field').ward, by('force-field').lasts], [true, { unit: 'day', count: 7 }]);
  assert.deepEqual(settings.setLasts, { unit: 'day', count: 7 });
  assert.deepEqual(instanceProblems(instance), []);
});

test('Bluff\'s and Trap Card\'s Set requests are the same but for the card key, which never leaves the service', () => {
  const decided = (card: string) => decide({ action: 'setCard', card, character: '11111111-1111-4111-8111-111111111111', target: '22222222-2222-4222-8222-222222222222' }, instance);
  const trap = decided('trap-card');
  const bluff = decided('bluff');
  assert.ok(trap.ok && bluff.ok);
  assert.deepEqual({ ...trap, args: { ...trap.args, card: null } }, { ...bluff, args: { ...bluff.args, card: null } });
  assert.equal(trap.ok && trap.asService, true, 'written by the service, so the key reaches SQL and no client');
  const target = { reach: 'post' as const, act: 'p', kind: 'post' as const, length: 10, text: '' };
  assert.deepEqual(decideSet(by('trap-card'), settings, target, [], {}, cards), decideSet(by('bluff'), settings, target, [], {}, cards));
});
const by = (key: string) => cards.find((c) => c.key === key)!;

/* Cards beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 7). */
test('Glitter Bomb is an uncommon Pepperoni Cast on a character, for a week; Main Event a rare Sweet Cast on a thread, for a day, that pins', async () => {
  const { glitterBomb } = await import('./glitter-bomb.ts');
  const { mainEvent } = await import('./main-event.ts');
  assert.deepEqual([glitterBomb.rarity, glitterBomb.alignment, glitterBomb.play ?? 'cast', glitterBomb.reaches, glitterBomb.lasts], ['uncommon', 'pepperoni', 'cast', ['character'], { unit: 'day', count: 7 }]);
  assert.deepEqual([mainEvent.rarity, mainEvent.alignment, mainEvent.play ?? 'cast', mainEvent.reaches, mainEvent.lasts, mainEvent.pins], ['rare', 'sweet', 'cast', ['thread'], { unit: 'day', count: 1 }, true]);
  assert.equal(basePrice(glitterBomb, settings), 150);
  assert.equal(basePrice(mainEvent, settings), 300);
  const character = { reach: 'character' as const, character: 'c1' };
  assert.equal(glitterBomb.canApply(character, []).ok, true);
  assert.deepEqual(glitterBomb.canApply(post(10), []), { ok: false, why: 'this card lands on a character' });
  assert.deepEqual(glitterBomb.canApply(character, [{ card: 'glitter-bomb', act: 'g', reach: 'character', ends: new Date(Date.now() + 1e6).toISOString() }]), { ok: false, why: 'this character already carries that card' });
  assert.equal(mainEvent.canApply({ reach: 'thread', thread: 't1' }, []).ok, true);
  assert.deepEqual(mainEvent.canApply(post(10), []), { ok: false, why: 'this card lands on a thread' });
  assert.equal(glitterBomb.playPrice(settings, character, {}), 0);
  assert.equal(mainEvent.playPrice(settings, { reach: 'thread', thread: 't1' }, {}), 0);
  assert.ok(cards.some((c) => c.key === 'glitter-bomb') && cards.some((c) => c.key === 'main-event'));
});

test('the instance, with its cards beyond a post, has no problems, and its reach settings are the design\'s', () => {
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(settings.reachRarity, { character: 'uncommon', thread: 'rare', board: 'legendary' });
  assert.deepEqual(settings.reachLasts, { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } });
});

/* Feelin' Fab (docs/plans/2026-11-02-onboarding-plan.md, Task 10). */
test("Feelin' Fab is a common Sweet Cast on a post, three to a post, that lasts until the post goes; it costs 0.20 and nothing more to play", async () => {
  const { feelinFab } = await import('./feelin-fab.ts');
  assert.deepEqual([feelinFab.key, feelinFab.name, feelinFab.alignment, feelinFab.rarity, feelinFab.play ?? 'cast', feelinFab.reaches, feelinFab.stack, feelinFab.lasts], ['feelin-fab', "Feelin' Fab", 'sweet', 'common', 'cast', ['post'], 3, undefined]);
  assert.equal(basePrice(feelinFab, settings), 20);
  assert.ok(basePrice(feelinFab, settings) < basePrice(by('bluff'), settings), 'below Bluff');
  assert.equal(feelinFab.playPrice(settings, post(6000), {}), 0);
  assert.equal(feelinFab.playPrice(settings, post(10), {}), 0);
  assert.equal(feelinFab.validateConfig({ anything: 1 }).ok, true);
  assert.ok(cards.some((c) => c.key === 'feelin-fab'));
});

test("Feelin' Fab lands on a post alone, up to three, and a fourth is refused in plain words", async () => {
  const { feelinFab } = await import('./feelin-fab.ts');
  const up = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'feelin-fab', act: `f${i}`, reach: 'post' as const }));
  for (const n of [0, 1, 2]) assert.equal(feelinFab.canApply(post(10), up(n)).ok, true, `${n} up`);
  assert.deepEqual(feelinFab.canApply(post(10), up(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.deepEqual(feelinFab.canApply({ reach: 'character', character: 'c1' }, []), { ok: false, why: 'this card lands on a post' });
  assert.deepEqual(feelinFab.canApply({ reach: 'thread', thread: 't1' }, []), { ok: false, why: 'this card lands on a post' });
});

/* ---- Autocorrect (docs/plans/2026-11-03-autocorrect-plan.md, Task 5) ---- */
const on = (body: string): CardTarget => postTarget('p1', 'post', body);
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

test('Autocorrect costs its base price, plus 0.25 per 50 characters it covers, at most 3.00 in all', () => {
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
};

test('each card that lets the model set options gives an object schema its own validateConfig accepts for a sample answer', () => {
  const keys = cards.filter((c) => c.staffOptions).map((c) => c.key).sort();
  assert.deepEqual(keys, ['autocorrect', 'stick-around', 'whoops']);
  for (const card of cards) {
    if (!card.staffOptions) continue;
    const { prompt, schema } = card.staffOptions;
    assert.ok(prompt.length > 0 && prompt.length < 600, `${card.key}: a short prompt`);
    assert.equal(schema.type, 'object', card.key);
    assert.equal(schema.additionalProperties, false, card.key);
    const props = schema.properties as Record<string, { type?: unknown }>;
    for (const [name, def] of Object.entries(props)) {
      for (const bound of ['maxLength', 'minLength', 'pattern', 'maxItems', 'minItems']) assert.equal(bound in def, false, `${card.key}.${name}: structured output cannot hold ${bound}`);
      assert.ok(def.type === 'string' || 'enum' in def, `${card.key}.${name}: strings and enums only`);
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

test('every property a staffOptions schema names survives that card\'s validateConfig (a field it drops would be asked for and thrown away)', () => {
  for (const card of cards) {
    if (!card.staffOptions) continue;
    const result = card.validateConfig(answers[card.key]);
    assert.equal(result.ok, true, card.key);
    if (!result.ok) continue;
    const kept = Object.keys(result.value as object);
    for (const name of Object.keys(card.staffOptions.schema.properties as object)) assert.ok(kept.includes(name), `${card.key}: "${name}" is dropped by validateConfig`);
  }
});
