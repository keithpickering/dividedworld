/**
 * Divided World's two cards (design, sections 7 and 10): Stick Around and Whoops!. Plan Task 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickAround } from './stick-around.ts';
import { STROKES, whoops } from './whoops.ts';
import { encodePoints } from './whoops/points.ts';
import type { Pt } from './whoops/scrub.ts';
import { CANS, CAPS, graffiti } from './graffiti.ts';
import { STENCILS } from './graffiti/stencils.ts';
import { GRID, cellsOf, count, type Cells } from '../../../engine/rules/surface.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { publicityTour } from './publicity-tour.ts';
import { atOrBelow, castOnPost, giftSplit, openDrive, staffOffers, staffConfigOf, decidePlay, decideSet, decideUse, postTarget, type CardRules } from '../../../engine/rules/cards.ts';
import { PEELS, autocorrect } from './autocorrect.ts';
import { CUES, PLACES, laughTrack, placesOf, type Cue } from './laugh-track.ts';
import { decide } from '../../../engine/rules/actions.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { QUADRANTS } from '../../../engine/rules/types.ts';
import type { CardTarget } from '../../../engine/rules/cards.ts';

/** What the machine sells a card for: its slot's price. */
const priceOf = (key: string): number => instance.machine.find((m) => 'card' in m.item && m.item.card === key)!.price;

const post = (length: number): CardTarget => ({ reach: 'post', act: 'p1', kind: 'post', length, text: '', links: [] });

test('the instance sells its cards at their prices', () => {
  assert.deepEqual(cards.map((c) => [c.key, c.alignment, priceOf(c.key)]), [['stick-around', 'sweet', 100], ['whoops', 'salty', 100], ['card-collector', 'salty', 150], ['hall-pass', 'sweet', 150], ['force-field', 'sweet', 150], ['publicity-tour', 'sweet', 150], ['heat-magnet', 'salty', 150], ['class-clown', 'pepperoni', 150], ['good-vibes', 'sweet', 150], ['glitter-bomb', 'pepperoni', 150], ['main-event', 'sweet', 300], ['feelin-fab', 'sweet', 20], ['autocorrect', 'pepperoni', 100], ['you-were-saying', 'pepperoni', 100], ['below-the-fold', 'salty', 100], ['mooch', 'salty', 150], ['toll', 'pepperoni', 150], ['4d-chess', 'salty', 150], ['off-day', 'salty', 500], ['jimmy-wails', 'sweet', 200], ['sugar-coat', 'sweet', 300], ['hype-up', 'sweet', 150], ['last-word', 'salty', 150], ['laugh-track', 'pepperoni', 150], ['graffiti', 'pepperoni', 300], ['line-cutter', 'pepperoni', 300], ['feelin-glam', 'sweet', 300]]);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instance.cards, cards);
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

test('Whoops! costs 0.25 more per 500 characters of its target, at most 2.00 added', () => {
  const config = { color: '#ff00aa' };
  assert.equal(whoops.playPrice(settings, post(499), config), 0);
  assert.equal(whoops.playPrice(settings, post(500), config), 25);
  assert.equal(whoops.playPrice(settings, post(999), config), 25);
  assert.equal(whoops.playPrice(settings, post(1000), config), 50);
  assert.equal(whoops.playPrice(settings, post(6000), config), 200, 'twelve steps would be 3.00 on top; 2.00 is the most a play adds');
  assert.equal(whoops.playPrice(settings, post(1_000_000), config), 200);
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

const pack = (points: Pt[]) => encodePoints(points);

test('Whoops! strokes wash or ink, in shares of the post body\'s box: across 0 to 1, down 0 to 1', () => {
  const ink = { tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: pack([[0.1, 0.2], [0.3, 0.4]]) };
  const wash = { tool: 'wash', width: 0.3, aspect: 2.99, points: pack([[0.5, 0.5]]) };
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
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: pack([[1, 1]]) }] }).ok, true, 'down to 1');
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
  assert.equal(whoops.validateState!({ strokes: Array(201).fill(ink) }).ok, false, 'too many strokes');
  assert.equal(whoops.validateState!({ strokes: 'all of them' }).ok, false);
});

test('Whoops! refuses a stroke whose points are not packed as the card writes them, and the old shape', () => {
  const ink = { tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: pack([[0.1, 0.2], [0.3, 0.4]]) };
  const wash = { tool: 'wash', width: 0.3, aspect: 3, points: pack([[0.3, 0.4], [0.5, 0.5]]) };
  const refused = (strokes: object[], why: RegExp, label: string) => {
    const r = whoops.validateState!({ strokes });
    assert.equal(r.ok, false, label);
    assert.match(String(!r.ok && r.why), why, label);
  };
  const packed = /points are packed as the card writes them/;
  refused([{ ...ink, points: [[0.1, 0.2]] }], packed, 'an old-shape stroke');
  refused([{ ...ink, points: 'not+base64url' }], packed, 'a string that does not decode');
  refused([{ ...ink, points: 7 }], packed, 'points that are not a string');
  refused([{ ...ink, points: '' }], packed, 'no points');
  refused([{ ...ink, points: pack(Array.from({ length: 501 }, (): Pt => [0.5, 0.5])) }], /at most 500 points in a stroke/, 'too many points in one stroke');
  refused(Array.from({ length: 81 }, () => ({ ...ink, points: pack(Array.from({ length: 500 }, (): Pt => [0.5, 0.5])) })), /at most 40000 points in all/, 'too many points in all');
  assert.equal(whoops.validateState!({ strokes: Array.from({ length: 80 }, () => ({ ...ink, points: pack(Array.from({ length: 500 }, (): Pt => [0.5, 0.5])) })) }).ok, true, 'exactly 40,000');
  // continues: true or absent, and only on a stroke that starts where the last ended.
  const cont = { ...wash, tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: pack([[0.3, 0.4], [0.6, 0.6]]) };
  assert.equal(whoops.validateState!({ strokes: [ink, { ...cont, continues: true }] }).ok, true, 'a piece that starts where the last ended');
  const started = /a continued stroke starts where the last ended/;
  refused([ink, { ...cont, continues: false }], /continues/, 'continues is true or absent');
  refused([{ ...ink, continues: true }], started, 'continues on the first stroke');
  refused([ink, { ...cont, points: pack([[0.31, 0.4], [0.6, 0.6]]), continues: true }], started, 'a first point that is not the last one');
  refused([ink, { ...cont, width: 0.05, continues: true }], started, 'a different width');
  refused([ink, { ...cont, aspect: 2, continues: true }], started, 'a different aspect');
  refused([wash, { ...cont, continues: true }], started, 'a different tool');
  refused([ink, { ...cont, color: '#ff0000', continues: true }], started, 'a different color');
  refused([{ ...ink, drops: 2 }, { ...cont, continues: true }], /only a line's last piece throws drops/, 'drops before a continued piece');
  assert.equal(whoops.validateState!({ strokes: [ink, { ...cont, continues: true, drops: 2 }] }).ok, true, 'drops on the last piece');
  // drops: a whole number 0 to 3, on an ink stroke.
  for (const d of [0, 1, 2, 3]) assert.equal(whoops.validateState!({ strokes: [{ ...ink, drops: d }] }).ok, true, `drops ${d}`);
  for (const d of [4, -1, 1.5, '1', null]) refused([{ ...ink, drops: d }], /drops are a whole number from 0 to 3/, `drops ${JSON.stringify(d)}`);
  refused([{ ...wash, drops: 1 }], /drops are a whole number from 0 to 3/, 'drops on a wash');
});

test('the most strokes Whoops! saves fit the database\'s bound, as Postgres writes them', () => {
  // The true worst case: the most strokes, each with an equal share of the total points, every key of every stroke at its longest:
  // a seven-character color, continues, drops 3 (on the last piece, the only one that may), the widest width, a three-figure aspect, and every point's difference the largest.
  const each = STROKES.totalPoints / STROKES.most;
  assert.ok(Number.isInteger(each) && each <= STROKES.points);
  // Alternating corners: each difference is 10,000 or -10,000 (each point packs to four bytes whatever its difference).
  const corners = (from: 0 | 1) => pack(Array.from({ length: each }, (_, i): Pt => ((i + from) % 2 === 0 ? [0, 0] : [1, 1])));
  const [there, back] = [corners(0), corners(1)]; // a piece ends on the corner the next one starts on
  const pieces = Array.from({ length: STROKES.most }, (_, i) => ({ tool: 'ink', color: '#abcdef', width: 0.9999, aspect: 0.00123, points: i % 2 === 0 ? there : back, ...(i > 0 ? { continues: true } : null), ...(i === STROKES.most - 1 ? { drops: 3 } : null) }));
  const saved = whoops.validateState!({ strokes: pieces, clean: false });
  assert.equal(saved.ok, true, saved.ok ? '' : saved.why);
  const plain = JSON.stringify(saved.ok && saved.value);
  // jsonb's text puts a space after every comma and colon.
  const asPostgres = JSON.stringify(saved.ok && saved.value).replace(/([,:])/g, '$1 ');
  console.log(`largest save: ${Buffer.byteLength(plain)} bytes as JSON.stringify, ${Buffer.byteLength(asPostgres)} as Postgres writes it`);
  assert.ok(Buffer.byteLength(plain) <= 262_144 * 0.95, `${Buffer.byteLength(plain)} bytes`);
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144 * 0.95, `${Buffer.byteLength(asPostgres)} bytes`);
  assert.equal(whoops.validateState!({ strokes: [...pieces, { tool: 'wash', width: 1, aspect: 1, points: pack([[0, 0]]) }] }).ok, false, 'one stroke past the most');
});

test('a stroke\'s width is kept to a ten-thousandth, its aspect to three significant figures, its points packed back', () => {
  const saved = whoops.validateState!({ strokes: [{ tool: 'ink', color: 'red', width: 0.123456, aspect: 2.34567, points: pack([[0.123456, 0.987654]]) }] });
  assert.deepEqual(saved.ok && saved.value, { strokes: [{ tool: 'ink', color: 'red', width: 0.1235, aspect: 2.35, points: pack([[0.1235, 0.9877]]) }] });
  const small = whoops.validateState!({ strokes: [{ tool: 'wash', width: 0.5, aspect: 0.0123456, points: pack([[0, 0]]) }] });
  assert.deepEqual(small.ok && small.value, { strokes: [{ tool: 'wash', width: 0.5, aspect: 0.0123, points: pack([[0, 0]]) }] });
  const pieces = whoops.validateState!({ strokes: [{ tool: 'ink', color: 'red', width: 0.1, aspect: 2, points: pack([[0.1, 0.1], [0.2, 0.2]]) }, { tool: 'ink', color: 'red', width: 0.1, aspect: 2, points: pack([[0.2, 0.2], [0.3, 0.3]]), continues: true, drops: 2 }] });
  assert.deepEqual(pieces.ok && (pieces.value as { strokes: { continues?: true; drops?: number }[] }).strokes.map((s) => [s.continues, s.drops]), [[undefined, undefined], [true, 2]], 'continues and drops are kept');
});

test('Stick Around holds no state to save', () => {
  assert.equal(stickAround.validateState, undefined);
});

/* The card mechanic's first cards (docs/plans/2026-11-01-card-plays-plan.md, Task 8): Card Collector and Force Field; the card types plan's Gimmicks. */
test('the instance sells Card Collector, Force Field and the new Gimmicks, each with its rarity and play, and stays whole', () => {
  const by = (key: string) => cards.find((c) => c.key === key)!;
  assert.deepEqual(['card-collector', 'force-field', 'publicity-tour', 'heat-magnet', 'class-clown', 'good-vibes', 'whoops', 'stick-around'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, priceOf(k)]), [
    ['card-collector', 'uncommon', 'set', 'salty', 150],
    ['force-field', 'uncommon', 'use', 'sweet', 150],
    ['publicity-tour', 'uncommon', 'use', 'sweet', 150],
    ['heat-magnet', 'uncommon', 'use', 'salty', 150],
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
  assert.deepEqual([by('publicity-tour').reaches, by('publicity-tour').lasts, by('publicity-tour').gimmick], [['character'], days3, { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.2, group: 'publicity' }]);
  assert.deepEqual([by('hype-up').reaches, by('hype-up').lasts, by('hype-up').gimmick], [['character'], days3, { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.2, group: 'publicity' }]);
  assert.deepEqual([by('heat-magnet').reaches, by('heat-magnet').lasts, by('heat-magnet').gimmick], [['character'], days3, { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], by: 0.2 }]);
  assert.deepEqual([by('class-clown').reaches, by('class-clown').lasts, by('class-clown').gimmick], [['character'], days3, { kind: 'earn', reactions: ['laughing', 'eye-roll'], by: 1 }]);
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

const by = (key: string) => cards.find((c) => c.key === key)!;

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

test("Feelin' Fab lands on a post alone, up to three, and a fourth is refused in plain words", async () => {
  const { feelinFab } = await import('./feelin-fab.ts');
  const up = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'feelin-fab', act: `f${i}`, reach: 'post' as const }));
  for (const n of [0, 1, 2]) assert.equal(feelinFab.canApply(post(10), up(n)).ok, true, `${n} up`);
  assert.deepEqual(feelinFab.canApply(post(10), up(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.deepEqual(feelinFab.canApply({ reach: 'character', character: 'c1' }, []), { ok: false, why: 'this card lands on a post' });
  assert.deepEqual(feelinFab.canApply({ reach: 'thread', thread: 't1' }, []), { ok: false, why: 'this card lands on a post' });
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

test('Below the Fold lands on a post with no fold, and a second is refused in plain words', async () => {
  const { belowTheFold } = await import('./below-the-fold.ts');
  assert.equal(belowTheFold.canApply(post(10), []).ok, true);
  assert.equal(belowTheFold.canApply(post(10), [{ card: 'whoops', act: 'w1', reach: 'post' as const }]).ok, true, 'another card is no fold');
  assert.deepEqual(belowTheFold.canApply(post(10), [{ card: 'below-the-fold', act: 'f1', reach: 'post' as const }]), { ok: false, why: 'this post already carries that card' });
  assert.deepEqual(belowTheFold.canApply({ reach: 'character', character: 'c1' }, []), { ok: false, why: 'this card lands on a post' });
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
  // Places are bounded by PEELS.most for both lists, so the other extreme is every place peeled.
  const wide = check({ peeled: Array.from({ length: PEELS.most }, (_, i) => i), clean: false, stuck: {} });
  assert.deepEqual(wide, { ok: true, value: { peeled: Array.from({ length: PEELS.most }, (_, i) => i), clean: false } }, 'an empty stuck is dropped');
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
  'card-collector': { card: 'whoops' },
  '4d-chess': { card: 'whoops', quadrant: 'calmPositive' },
  graffiti: { stencil: 'horns', can: 'red', spot: 4 },
  'laugh-track': { cues: [{ phrase: 'the same old', sound: 'laugh' }, { phrase: 'something new', sound: 'boo' }] },
};

test('each card that lets the model set options gives an object schema its own validateConfig accepts for a sample answer', () => {
  const keys = cards.filter((c) => c.staffOptions).map((c) => c.key).sort();
  assert.deepEqual(keys, ['4d-chess', 'autocorrect', 'card-collector', 'graffiti', 'laugh-track', 'stick-around', 'whoops']);
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
  const { packOdds } = await import('../../../engine/rules/packs.ts');
  const booster = instance.packs.find((p) => p.key === 'booster')!;
  assert.deepEqual(booster.pulls.at(-1)!.weights, { uncommon: 74, rare: 24, legendary: 2 });
  const hit = packOdds(booster, cards, instance.settings).at(-1)!;
  const chance = new Map(hit.flatMap((r) => r.cards.map((c) => [c.card, c.chance] as const)));
  // The Gimmicks, Part 6, Jimmy Wails, Part 4 and Laugh Track joined the Booster by their rarity, as a new card does, with nothing listed in packs.ts: fifteen uncommons share the 74 (You Were Saying? and Below the Fold are commons, and the hit pull takes none).
  // Sugar Coat, Graffiti, Line Cutter and Feelin' Glam are the rares that share the 24 with Main Event: five, at 0.048 each.
  assert.equal(cards.length, 27);
  assert.ok(Math.abs(chance.get('main-event')! - 0.048) < 1e-9, `Main Event at ${chance.get('main-event')}`);
  assert.ok(Math.abs(chance.get('sugar-coat')! - 0.048) < 1e-9, `Sugar Coat at ${chance.get('sugar-coat')}`);
  assert.ok(Math.abs(chance.get('graffiti')! - 0.048) < 1e-9, `Graffiti at ${chance.get('graffiti')}`);
  assert.ok(Math.abs(chance.get('line-cutter')! - 0.048) < 1e-9, `Line Cutter at ${chance.get('line-cutter')}`);
  assert.ok(Math.abs(chance.get('feelin-glam')! - 0.048) < 1e-9, `Feelin' Glam at ${chance.get('feelin-glam')}`);
  assert.ok(Math.abs(chance.get('off-day')! - 0.02) < 1e-9, `Off Day at ${chance.get('off-day')}`);
  const uncommons = cards.filter((c) => c.rarity === 'uncommon');
  assert.equal(uncommons.length, 15);
  for (const c of uncommons) assert.ok(Math.abs(chance.get(c.key)! - 0.74 / 15) < 1e-9, `${c.key} at ${chance.get(c.key)}`);
  assert.equal(chance.size, uncommons.length + 6);
});

/* Card notes, Part 6 (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 7): Mooch, Toll, 4D Chess and Off Day. */
test('Mooch, Toll, 4D Chess and Off Day are in the instance, sold as the plan says, and the instance stays whole', () => {
  const rows = ['mooch', 'toll', '4d-chess', 'off-day'].map((k) => [k, by(k).alignment, by(k).rarity, by(k).play ?? 'cast', instance.machine.find((m) => 'card' in m.item && m.item.card === k)?.availability, instance.machine.find((m) => 'card' in m.item && m.item.card === k)?.price]);
  assert.deepEqual(rows, [
    ['mooch', 'salty', 'uncommon', 'cast', 'onSale', 150],
    ['toll', 'pepperoni', 'uncommon', 'use', 'onSale', 150],
    ['4d-chess', 'salty', 'uncommon', 'set', 'onSale', 150],
    ['off-day', 'salty', 'legendary', 'cast', 'hidden', 500],
  ]);
  assert.deepEqual(by('mooch').skim, { share: 0.1 });
  assert.deepEqual(by('toll').gimmick, { kind: 'ride', share: 0.5 });
  assert.deepEqual(by('4d-chess').trap, { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } });
  assert.equal(by('off-day').scoresAs, true);
  assert.deepEqual(by('off-day').reaches, ['character']);
  assert.deepEqual(instanceProblems(instance), []);
});

test('Mooch lands with a quadrant, is refused on a quadrant already live and lands on another', () => {
  const mooch = by('mooch');
  const live = [{ card: 'mooch', act: 'k1', quadrant: 'excitedPositive' as const, ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.deepEqual(mooch.validateConfig({ quadrant: 'calmPositive' }), { ok: true, value: { quadrant: 'calmPositive' } });
  assert.equal(mooch.validateConfig({}).ok, false, 'no quadrant');
  assert.equal(mooch.validateConfig({ quadrant: 'loud' }).ok, false);
  assert.equal(mooch.canApply(post(10), [], { quadrant: 'excitedPositive' }).ok, true);
  assert.equal(decidePlay(mooch, settings, post(10), live, { quadrant: 'excitedPositive' }, '').ok, false, 'that quadrant is taken');
  assert.equal(decidePlay(mooch, settings, post(10), live, { quadrant: 'calmPositive' }, '').ok, true, 'another lands');
  assert.equal(decidePlay(mooch, settings, post(10), live, {}, '').ok, false, 'a configuration with none is refused');
  assert.deepEqual(mooch.validateConfig({}), { ok: false, why: 'choose the reactions to mooch' });
  assert.deepEqual(mooch.validateConfig({ quadrant: 'loud' }), { ok: false, why: 'choose the reactions to mooch' });
  assert.deepEqual(mooch.lasts, { unit: 'week', count: 1 });
});

test('Mooch stacks four deep, one per quadrant, and a fifth is refused', () => {
  const mooch = by('mooch');
  const up = (n: number) => QUADRANTS.slice(0, n).map((quadrant, i) => ({ card: 'mooch', act: `k${i}`, reach: 'post' as const, quadrant, ends: new Date(Date.now() + 86_400_000).toISOString() }));
  assert.equal(decidePlay(mooch, settings, post(10), up(3), { quadrant: QUADRANTS[3] }, '').ok, true, 'the fourth lands');
  assert.deepEqual(decidePlay(mooch, settings, post(10), up(4), { quadrant: QUADRANTS[0] }, ''), { ok: false, why: 'this post already carries 4 of that card, the most it takes' });
});

test('Toll lands on a post through decideUse, is refused by decidePlay, and a second live one is refused', () => {
  const toll = by('toll');
  assert.equal(decideUse(toll, settings, post(10), [], {}, '').ok, true);
  assert.equal(decidePlay(toll, settings, post(10), [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'toll', act: 'k1', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(toll, settings, post(10), live, {}, '').ok, false);
  assert.deepEqual(toll.lasts, { unit: 'week', count: 1 });
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

test('Off Day refuses a class the instance lacks and lands on a character', () => {
  const off = by('off-day');
  const character = { reach: 'character' as const, act: 'c1', kind: 'post' as const, length: 0, text: '' } as unknown as CardTarget;
  assert.deepEqual(off.validateConfig({ class: 'face' }), { ok: true, value: { class: 'face' } });
  for (const bad of ['ghost', '', 7, undefined]) assert.equal(off.validateConfig({ class: bad }).ok, false, String(bad));
  assert.equal(off.canApply(character, []).ok, true);
  assert.equal(off.canApply(post(10), []).ok, false, 'not on a post');
  assert.deepEqual(off.validateConfig({ class: 'ghost' }), { ok: false, why: 'choose the class to name' });
  assert.deepEqual(off.validateConfig(null), { ok: false, why: 'choose the class to name' });
  assert.deepEqual(off.lasts, { unit: 'day', count: 2 });
  const chara = { reach: 'character' as const, character: 'c1' };
  const up = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'off-day', act: `o${i}`, reach: 'character' as const, ends: new Date(Date.now() + 86_400_000).toISOString() }));
  assert.equal(off.canApply(chara, up(1)).ok, true, 'the next window\'s lands while this one is live');
  assert.deepEqual(off.canApply(chara, up(2)), { ok: false, why: 'this character already carries 2 of that card, the most it takes' });
});

/* Card notes, Part 4 (docs/plans/2026-11-11-card-notes-part-4-plan.md, Task 6): Sugar Coat, Hype-Up and Last Word. */
test('Sugar Coat, Hype-Up and Last Word are in the instance, sold as the plan says, and the instance stays whole', () => {
  const slot = (k: string) => instance.machine.find((m) => 'card' in m.item && m.item.card === k);
  assert.deepEqual(['sugar-coat', 'hype-up', 'last-word'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, slot(k)?.availability, slot(k)?.price]), [
    ['sugar-coat', 'rare', 'use', 'sweet', 'hidden', 300],
    ['hype-up', 'uncommon', 'cast', 'sweet', 'onSale', 150],
    ['last-word', 'uncommon', 'use', 'salty', 'onSale', 150],
  ]);
  assert.deepEqual(by('sugar-coat').gimmick, { kind: 'ward', flavors: ['salty', 'pepperoni'] });
  assert.deepEqual(by('last-word').gimmick, { kind: 'noQuote' });
  assert.deepEqual([by('sugar-coat').lasts, by('last-word').lasts], [{ unit: 'day', count: 7 }, { unit: 'day', count: 7 }]);
  assert.deepEqual(instanceProblems(instance), []);
});

test('Hype-Up holds the very numbers Publicity Tour holds', () => {
  assert.equal(by('hype-up').gimmick, publicityTour.gimmick);
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

test('Last Word is refused on a post with a live back, lands on one without, and a second is refused', () => {
  const lastWord = by('last-word');
  const live = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(decideUse(lastWord, settings, post(10), [{ card: null, act: 'b1', faceDown: true, ends: live }], {}, '').ok, false, 'a back is live');
  assert.equal(decideUse(lastWord, settings, post(10), [{ card: null, act: 'b1', faceDown: true, ends: new Date(Date.now() - 1000).toISOString() }], {}, '').ok, true, 'a back that has ended');
  assert.equal(decideUse(lastWord, settings, post(10), [], {}, '').ok, true);
  assert.equal(decideUse(lastWord, settings, post(10), [{ card: 'last-word', act: 'k1', gimmick: lastWord.gimmick, ends: live }], {}, '').ok, false, 'a second');
});

test('Hype-Up lands on a character, is refused on a post, is not cast on a post and is not offered to a persona', () => {
  const hypeUp = by('hype-up');
  assert.equal(hypeUp.canApply({ reach: 'character', character: 'c1' }, []).ok, true);
  assert.equal(hypeUp.canApply(post(10), []).ok, false);
  assert.equal(castOnPost(hypeUp), false, 'Card Collector cannot name it');
  assert.equal(staffOffers(hypeUp), false);
});

// Jimmy Wails (docs/plans/2026-11-03-jimmy-wails-plan.md, Task 6): a Sweet uncommon Cast on a post whose plays share a drive, each drawing a plate and needing a sob story.
const jimmy = () => cards.find((c) => c.key === 'jimmy-wails')!;
const hour = 3_600_000;
const play = (act: string, drive: string, closes: number): import('../../../engine/rules/cards.ts').CardEffect => ({ card: 'jimmy-wails', act, drive, closes: new Date(closes).toISOString() });

test('Jimmy Wails is a Sweet uncommon Cast on a post, sold for 2.00, with a drive of a week and four gifts', () => {
  const j = jimmy();
  assert.equal(j.name, 'Jimmy Wails');
  assert.equal(j.alignment, 'sweet');
  assert.equal(j.rarity, 'uncommon');
  assert.equal(j.stack, 3);
  assert.equal(j.play ?? 'cast', 'cast');
  assert.deepEqual(j.reaches ?? ['post'], ['post']);
  assert.equal(priceOf('jimmy-wails'), 200, 'the machine slot, onSale');
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'jimmy-wails')!.availability, 'onSale');
  assert.deepEqual(j.draws, ['blue-shirt', 'close-up', 'dark-logo', 'black-shirt', 'gray-jacket', 'looking-away', 'red-wall', 'full-length', 'pinstripe']);
  assert.deepEqual(j.drive, { lasts: { unit: 'day', count: 7 }, gifts: ['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4'], overhead: 'jimmyWails.overhead' });
  assert.deepEqual(['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4', 'jimmyWails.overhead'].map((k) => settings.economy[k]), [10, 25, 50, 100, 25]);
  assert.equal(giftSplit(10, settings.economy['jimmyWails.overhead']!).overhead, 3, 'a 0.10 gift keeps 0.03 of overhead');
  assert.equal(j.playPrice(settings, post(100), {}), 0, 'a play costs nothing beyond the machine\'s price');
  assert.equal(j.needsMessage, 'an appeal needs a sob story');
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual((j.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key)), ['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4', 'jimmyWails.overhead']);
});

test('Jimmy Wails accepts an empty configuration and nothing else', () => {
  const j = jimmy();
  assert.deepEqual(j.validateConfig({}), { ok: true, value: {} });
  assert.equal(j.validateConfig({ ink: 'red' }).ok, false);
  assert.equal(j.validateConfig(undefined).ok, false);
  assert.equal(j.validateConfig('x').ok, false);
  assert.equal(j.validateConfig(null).ok, false);
  assert.equal(staffConfigOf(j, () => 0) !== null, true, 'a Mod Bot plays it as {}');
});

test('Jimmy Wails: a fourth play on an open drive is refused, and one after the close lands as the opening of another', () => {
  const j = jimmy();
  const now = new Date();
  const open = (n: number) => Array.from({ length: n }, (_, i) => play(`a${i}`, 'a0', now.getTime() + 7 * 24 * hour));
  assert.equal(decidePlay(j, settings, post(10), open(2), {}, 'Please.', { now }).ok, true, 'a third joins');
  assert.deepEqual(decidePlay(j, settings, post(10), open(3), {}, 'Please.', { now }), { ok: false, why: 'this post\'s drive already carries 3 appeals' }, 'a fourth is refused, in the database\'s words');
  const closed = Array.from({ length: 3 }, (_, i) => play(`c${i}`, 'c0', now.getTime() - hour));
  assert.equal(decidePlay(j, settings, post(10), closed, {}, 'Please.', { now }).ok, true, 'a play after the close opens another drive');
  assert.equal(decidePlay(j, settings, post(10), [...closed, ...open(2)], {}, 'Please.', { now }).ok, true, 'earlier closed drives do not count against the open one');
  assert.equal(openDrive([...closed, ...open(3)], 'jimmy-wails', now)?.plays.length, 3);
  // The landing's other refusals are the usual ones: a post only, a post's own kind.
  assert.match((decidePlay(j, settings, { reach: 'thread', act: 't', title: 'x' } as never, [], {}, 'Please.', { now }) as { why: string }).why, /lands on a post/);
});

test('Jimmy Wails: a blank message is refused, in the card\'s words', () => {
  const j = jimmy();
  for (const blank of ['', '   ', undefined, null]) assert.deepEqual(decidePlay(j, settings, post(10), [], {}, blank), { ok: false, why: 'an appeal needs a sob story' }, String(blank));
  assert.equal(decidePlay(j, settings, post(10), [], {}, 'My cat needs a sweater.').ok, true);
});

test('Jimmy Wails cannot be set face down: it draws, runs a drive and needs a message, so it is cast now and face up (issue #446)', () => {
  const j = jimmy();
  assert.deepEqual(decideSet(j, settings, on('a post'), [], {}, cards), { ok: false, why: 'Jimmy Wails is cast face up and never set face down' });
});

/* ---- Laugh Track (docs/plans/2026-11-11-laugh-track-plan.md, Task 9) ---- */
const cue = (phrase: string, sound: Cue['sound'] = 'laugh'): Cue => ({ phrase, sound });
const ltConfig = (cues: unknown) => laughTrack.validateConfig({ cues });
const ltWhy = (v: unknown) => (v as { why: string }).why;
const ltLands = (body: string, cues: Cue[], effects: { card: string; act: string }[] = []) => laughTrack.canApply(on(body), effects, { cues } as never, new Date());

test('Laugh Track is an uncommon Pepperoni Cast, seeded, that takes one director', () => {
  assert.deepEqual([laughTrack.key, laughTrack.name, laughTrack.alignment, laughTrack.rarity, laughTrack.play ?? 'cast', laughTrack.stack ?? 1, laughTrack.seeded], ['laugh-track', 'Laugh Track', 'pepperoni', 'uncommon', 'cast', 1, true]);
  assert.equal(castOnPost(laughTrack as CardRules), true);
  assert.deepEqual([CUES.most, PLACES.most], [5, 30]);
  assert.equal(laughTrack.staffConfigs, undefined, 'a fallback cannot know the post');
});

test('Laugh Track\'s configuration is one to five cues, each a bounded phrase and a sound', () => {
  assert.deepEqual(ltConfig([{ phrase: '  Mario  ', sound: 'cheer' }]), { ok: true, value: { cues: [{ phrase: 'Mario', sound: 'cheer' }] } });
  assert.equal(ltConfig(Array.from({ length: 5 }, (_, i) => cue(`word${'abcde'[i]}x`))).ok, true, 'five');
  assert.equal(ltWhy(ltConfig([])), 'a play holds 1 to 5 cues');
  assert.equal(ltWhy(ltConfig(Array.from({ length: 6 }, (_, i) => cue(`word${'abcdef'[i]}x`)))), 'a play holds 1 to 5 cues');
  assert.equal(ltWhy(ltConfig('cats')), 'a play holds 1 to 5 cues');
  assert.equal(ltWhy(laughTrack.validateConfig({})), 'a play holds 1 to 5 cues');
  assert.equal(ltWhy(ltConfig([{ phrase: 'Mario', sound: 'gasp' }])), 'a cue is a phrase and Laugh, Cheer or Boo');
  assert.equal(ltWhy(ltConfig([{ phrase: 'Mario' }])), 'a cue is a phrase and Laugh, Cheer or Boo');
  assert.equal(ltWhy(ltConfig([{ phrase: 4, sound: 'boo' }])), 'a cue is a phrase and Laugh, Cheer or Boo');
  assert.equal(ltWhy(ltConfig([null])), 'a cue is a phrase and Laugh, Cheer or Boo');
  assert.match(ltWhy(ltConfig([cue('cat')])), /at least 4 letters or digits/);
  assert.match(ltWhy(ltConfig([cue('x'.repeat(101))])), /at most 100 characters/);
  assert.match(ltWhy(ltConfig([cue('two\nlines')])), /one line/);
  assert.equal(ltWhy(ltConfig([cue('Mario Kart'), cue('mario  kart!', 'boo')])), 'two cues have the same phrase');
});

test('Laugh Track keeps the seed the server adds and no other key', () => {
  assert.deepEqual(laughTrack.validateConfig({ cues: [cue('Mario')], seed: 12345, extra: 1 }), { ok: true, value: { cues: [cue('Mario')], seed: 12345 } });
});

test('placesOf is every occurrence of each cue in the text\'s order, with its cue\'s index', () => {
  const text = 'Mario met Luigi, then Mario hit Luigi again';
  const places = placesOf(text, [cue('Luigi'), cue('Mario', 'boo')], []);
  assert.deepEqual(places.map((p) => [text.slice(p.start, p.end), p.cue]), [['Mario', 1], ['Luigi', 0], ['Mario', 1], ['Luigi', 0]]);
  assert.deepEqual(placesOf('nothing here', [cue('Luigi')], []), []);
});

test('Laugh Track lands with one cue and with five', () => {
  assert.equal(ltLands('Mario is here', [cue('Mario')]).ok, true);
  const body = 'alpha beta gamma delta epsilon';
  assert.equal(ltLands(body, ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((p) => cue(p))).ok, true);
  assert.equal(decidePlay(laughTrack as CardRules, settings, on('Mario is here'), [], { cues: [cue('Mario')] }, '').ok, true);
});

test('Laugh Track refuses what is not in the post, what overlaps, and what is too many places', () => {
  assert.equal(ltWhy(ltLands('Mario is here', [cue('Mario'), cue('Luigi')])), '“Luigi” is not in this post\'s own words');
  assert.equal(ltWhy(ltLands('Mario Kart is here', [cue('Mario Kart'), cue('Kart is')])), 'two cues cover the same words');
  const many = Array(31).fill('word').join(' ');
  assert.equal(ltWhy(ltLands(many, [cue('word')])), 'these cues cover 31 places in this post; a play covers at most 30');
  assert.equal(ltLands(Array(30).fill('word').join(' '), [cue('word')]).ok, true, 'thirty is the most');
});

test('Laugh Track is refused where the post already has an audience, in its own words', () => {
  const live = [{ card: 'laugh-track', act: 'k1' }];
  assert.equal(ltWhy(ltLands('Mario is here', [cue('Mario')], live)), 'this post already has an audience');
  assert.equal(ltWhy(laughTrack.canApply(on('Mario'), live, undefined as never, new Date())), 'this post already has an audience', 'with no cues yet too');
  assert.equal(ltWhy(decidePlay(laughTrack as CardRules, settings, on('Mario'), live, { cues: [cue('Mario')] }, '')), 'this post already has an audience');
  assert.equal(laughTrack.canApply(on('Mario'), [{ card: 'laugh-track', act: 'k1', ends: '2000-01-01T00:00:00Z' }], { cues: [cue('Mario')] } as never, new Date()).ok, true, 'an ended one holds no place');
  assert.equal(laughTrack.canApply(on('Mario'), [{ card: 'whoops', act: 'k1' }], { cues: [cue('Mario')] } as never, new Date()).ok, true);
});

test('Laugh Track\'s price is 0.05 a place past five, at most 1.00, and a face asks the most', () => {
  const price = (places: number) => laughTrack.playPrice(settings, on(Array(places).fill('word').join(' ')), { cues: [cue('word')] });
  assert.equal(price(5), 0);
  assert.equal(price(6), 5);
  assert.equal(price(20), 75);
  assert.equal(price(40), 100, 'capped');
  assert.equal(laughTrack.playPrice(settings, on('word'), {} as never), 100, 'a face asks the most');
  assert.equal(laughTrack.playPrice(settings, { reach: 'character', character: 'c' }, { cues: [cue('word')] }), 0);
  const tuned = withOverrides(settings, { economy: { 'laughTrack.perPlace': 10, 'laughTrack.freePlaces': 1 } });
  assert.equal(laughTrack.playPrice(tuned, on('word word word'), { cues: [cue('word')] }), 20, 'its numbers are the settings\'');
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

/* Graffiti (docs/plans/2026-11-11-graffiti-plan.md, Task 7). */
const surf = graffiti.surface!;
const draw = (input: unknown) => surf.validateDraw(input);
const wash = (input: unknown) => surf.validateWash(input);
const covered = (cells: Cells, x: number, y: number) => (cells[(y * GRID + x) >> 3]! & (0x80 >> ((y * GRID + x) & 7))) !== 0;
const stroke = (over: Record<string, unknown> = {}) => ({ can: 'red', cap: 'stock', aspect: 1.5, points: [[0.1, 0.2], [0.3, 0.4]], ...over });
const strokesOf = (v: ReturnType<typeof draw>) => { assert.equal(v.ok, true, JSON.stringify(v)); return v.ok ? v.value.strokes : []; };
const STENCIL_KEYS_FOR_TEST = ['mustache', 'horns', 'crown', 'kilroy', 'x', 'smiley'] as const;
const STENCIL_KEYS = ['mustache', 'horns', 'crown', 'kilroy', 'x', 'smiley'] as const;

test('Graffiti: a draw keeps a stroke\'s can and cap and drops a sent width; the engine gets the cap\'s width', () => {
  const v = draw({ strokes: [stroke({ width: 0.9, aspect: 1.23456 })] });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.deepEqual(v.value.payload, { strokes: [{ can: 'red', cap: 'stock', aspect: 1.23, points: [[0.1, 0.2], [0.3, 0.4]] }] });
  assert.deepEqual(v.value.strokes, [{ width: CAPS.stock, aspect: 1.23, points: [[0.1, 0.2], [0.3, 0.4]] }]);
});

test('Graffiti: an unknown can or cap is refused, and the refusal lists the cans', () => {
  const v = draw({ strokes: [stroke({ can: 'chartreuse' })] });
  assert.equal(v.ok, false);
  for (const can of Object.keys(CANS)) assert.match(!v.ok ? v.why : '', new RegExp(can));
  assert.equal(draw({ strokes: [stroke({ cap: 'huge' })] }).ok, false);
});

test('Graffiti: a draw has at most 120 strokes, 300 points a stroke and 3,000 points in all', () => {
  assert.equal(draw({ strokes: Array.from({ length: 120 }, () => stroke()) }).ok, true);
  assert.equal(draw({ strokes: Array.from({ length: 121 }, () => stroke()) }).ok, false);
  assert.equal(draw({ strokes: [] }).ok, false, 'a draw with no stroke is nothing');
  assert.equal(draw({ strokes: [stroke({ points: Array(300).fill([0.5, 0.5]) })] }).ok, true);
  assert.equal(draw({ strokes: [stroke({ points: Array(301).fill([0.5, 0.5]) })] }).ok, false);
  assert.equal(draw({ strokes: Array.from({ length: 10 }, () => stroke({ points: Array(300).fill([0.5, 0.5]) })) }).ok, true);
  assert.equal(draw({ strokes: [...Array.from({ length: 10 }, () => stroke({ points: Array(300).fill([0.5, 0.5]) })), stroke()] }).ok, false);
  assert.equal(wash({ strokes: Array.from({ length: 121 }, () => ({ aspect: 1, points: [[0, 0]] })) }).ok, false, 'a wash has the same bounds');
});

test('Graffiti: a point outside 0 to 1 is refused, and points are kept to a ten-thousandth', () => {
  for (const p of [[1.0001, 0.5], [0.5, -0.0001], [0.5, 1.5], [NaN, 0.5]]) assert.equal(draw({ strokes: [stroke({ points: [p] })] }).ok, false, JSON.stringify(p));
  assert.equal(draw({ strokes: [stroke({ points: [[0.5], [0.5, 0.5]] })] }).ok, false);
  assert.equal(draw({ strokes: [stroke({ points: [] })] }).ok, false);
  assert.equal(draw({ strokes: [stroke({ aspect: 0 })] }).ok, false);
  assert.equal(draw({ strokes: [stroke({ aspect: 'wide' })] }).ok, false);
  assert.deepEqual(strokesOf(draw({ strokes: [stroke({ points: [[0.123456, 1]] })] }))[0]!.points, [[0.1235, 1]]);
});

test('Graffiti: a stencil expands to strokes inside its spot, in the can named, at aspect 1', () => {
  assert.deepEqual(Object.keys(STENCILS).sort(), [...STENCIL_KEYS].sort());
  for (const key of STENCIL_KEYS) for (let spot = 0; spot < 9; spot++) {
    const v = draw({ stencil: key, can: 'teal', spot });
    assert.equal(v.ok, true, `${key} ${spot}`);
    if (!v.ok) continue;
    const [col, row] = [spot % 3, Math.floor(spot / 3)];
    assert.ok(v.value.strokes.length >= 1 && v.value.strokes.length <= 120, `${key}: ${v.value.strokes.length} strokes`);
    for (const s of v.value.strokes) {
      assert.equal(s.aspect, 1);
      for (const [x, y] of s.points) assert.ok(x >= col / 3 - 1e-4 && x <= (col + 1) / 3 + 1e-4 && y >= row / 3 - 1e-4 && y <= (row + 1) / 3 + 1e-4, `${key} ${spot}: ${x},${y}`);
    }
    const payload = v.value.payload as { stencil: string; can: string; spot: number; strokes: { can: string; cap: string }[] };
    assert.deepEqual([payload.stencil, payload.can, payload.spot], [key, 'teal', spot]);
    assert.ok(payload.strokes.every((s) => s.can === 'teal' && s.cap in CAPS));
  }
});

test('Graffiti: stencil x at spot 4 covers the center cell, and each stencil at spot 4 covers under 12% of the grid', () => {
  const x = draw({ stencil: 'x', can: 'black', spot: 4 });
  assert.equal(covered(cellsOf(x.ok ? x.value.strokes : []), 50, 50), true);
  assert.equal(covered(cellsOf(x.ok ? x.value.strokes : []), 5, 5), false);
  for (const key of STENCIL_KEYS) {
    const v = draw({ stencil: key, can: 'black', spot: 4 });
    const n = count(cellsOf(v.ok ? v.value.strokes : []));
    assert.ok(n > 30 && n < 1200, `${key} covers ${n} cells`);
  }
});

test('Graffiti: a stencil draw is a stencil with a known key, a can and a spot 0 to 8, and not also strokes', () => {
  for (const bad of [{ stencil: 'nope', can: 'red', spot: 0 }, { stencil: 'x', can: 'nope', spot: 0 }, { stencil: 'x', can: 'red', spot: 9 }, { stencil: 'x', can: 'red', spot: -1 }, { stencil: 'x', can: 'red', spot: 1.5 }, { stencil: 'x', can: 'red' }, { stencil: 'x', can: 'red', spot: 0, strokes: [stroke()] }, { stencil: 'toString', can: 'red', spot: 0 }, {}, null])
    assert.equal(draw(bad).ok, false, JSON.stringify(bad));
});

test('Graffiti: a wash keeps {aspect, points}, drops a sent can or width, and has the sponge\'s width', () => {
  const v = wash({ strokes: [{ can: 'red', cap: 'fat', width: 0.001, aspect: 2.34567, points: [[0.123456, 0.5]] }] });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.deepEqual(v.value.payload, { strokes: [{ aspect: 2.35, points: [[0.1235, 0.5]] }] });
  assert.deepEqual(v.value.strokes, [{ width: 0.06, aspect: 2.35, points: [[0.1235, 0.5]] }]);
  assert.equal(wash({ strokes: [{ aspect: 1, points: [[2, 0]] }] }).ok, false);
});

test('Graffiti: the largest draw fits 64 KiB as Postgres writes it', () => {
  const longest = (o: object) => Object.keys(o).reduce((a, b) => (b.length > a.length ? b : a));
  const strokes = Array.from({ length: 120 }, () => ({ can: longest(CANS), cap: longest(CAPS), aspect: 0.00123456, points: Array(25).fill([0.12345678, 0.98765432]) }));
  const v = draw({ strokes });
  assert.equal(v.ok, true);
  const asPostgres = JSON.stringify(v.ok && v.value.payload).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) < 65_536, `${Buffer.byteLength(asPostgres)} bytes`);
  const washed = wash({ strokes: strokes.map(({ aspect, points }) => ({ aspect, points })) });
  assert.ok(Buffer.byteLength(JSON.stringify(washed.ok && washed.value.payload).replace(/([,:])/g, '$1 ')) < 65_536);
});

test('Graffiti is a rare Pepperoni surface on a post, one a post, in the machine at 300, hidden', () => {
  assert.deepEqual([graffiti.rarity, graffiti.alignment, graffiti.stack, surf.limitKey, surf.mostLive], ['rare', 'pepperoni', 1, 'graffiti.limit', 48]);
  assert.deepEqual(instance.machine.find((m) => 'card' in m.item && m.item.card === 'graffiti'), { item: { card: 'graffiti' }, availability: 'hidden', price: 300 });
  assert.equal(instance.settings.cardSettings['graffiti.limit'], 40);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instanceProblems({ ...instance, settings: withOverrides(settings, { cardSettings: { 'graffiti.limit': 101 } }) }).filter((p) => /graffiti/.test(p)).length > 0, true);
});

test('Graffiti: every staff config is a valid draw, and a Mod Bot\'s options are one too', () => {
  const configs = graffiti.staffConfigs!;
  assert.ok(configs.length >= 6);
  assert.deepEqual(new Set(configs.map((c) => c.stencil)), new Set(STENCIL_KEYS), 'each stencil is offered');
  for (const c of configs) { assert.equal(draw(c).ok, true, JSON.stringify(c)); assert.equal(graffiti.validateConfig(c).ok, true); }
  assert.deepEqual(graffiti.validateConfig({ stencil: 'horns', can: 'red', spot: 4, junk: 1 }), { ok: true, value: { stencil: 'horns', can: 'red', spot: 4 } });
  assert.equal(graffiti.validateConfig({ stencil: 'horns', can: 'nope', spot: 4 }).ok, false);
  const schema = graffiti.staffOptions!.schema as { properties: Record<string, { enum: unknown[] }> };
  assert.deepEqual(schema.properties.stencil!.enum, [...STENCIL_KEYS]);
  assert.deepEqual(schema.properties.can!.enum, Object.keys(CANS));
  for (const word of [...STENCIL_KEYS, ...Object.keys(CANS)]) assert.match(graffiti.staffOptions!.prompt, new RegExp(word));
});

test('Graffiti: a refusal names the stroke and the point that failed', () => {
  const v = draw({ strokes: [stroke(), stroke(), stroke({ points: [[0.5, 0.5], [0.5, 2]] })] });
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.why : '', /^stroke 3, point 2: a point is across and down from 0 to 1/);
  assert.match((draw({ strokes: [stroke({ can: 'nope' })] }) as { why: string }).why, /^stroke 1: the can is one of/);
  assert.match((draw({ strokes: [stroke(), [1, 2]] }) as { why: string }).why, /^stroke 2: a stroke is an object with/);
  assert.match((wash({ strokes: [{ aspect: 1, points: [[0, 0]] }, { aspect: 0, points: [[0, 0]] }] }) as { why: string }).why, /^stroke 2: /);
});

test('Graffiti: every stencil at the last spot fits 64 KiB as Postgres writes it, and a stencil lands in its own ninth', () => {
  for (const key of STENCIL_KEYS_FOR_TEST) {
    const v = draw({ stencil: key, can: 'orange', spot: 8 });
    assert.equal(v.ok, true, key);
    assert.ok(Buffer.byteLength(JSON.stringify(v.ok && v.value.payload).replace(/([,:])/g, '$1 ')) < 65_536, key);
  }
  const top = draw({ stencil: 'x', can: 'black', spot: 0 });
  const cells = cellsOf(top.ok ? top.value.strokes : []);
  let inTopLeft = false;
  for (let y = 0; y < 34; y++) for (let x = 0; x < 34; x++) inTopLeft ||= covered(cells, x, y);
  assert.equal(inTopLeft, true);
  assert.equal(covered(cells, 50, 50), false);
});

/* Card notes, Part 2 (docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 8): Line Cutter and Feelin' Glam. */
test("Line Cutter and Feelin' Glam are rares in the instance, hidden at 300 after every on-sale slot, and the instance stays whole", () => {
  const at = (k: string) => instance.machine.findIndex((m) => 'card' in m.item && m.item.card === k);
  assert.deepEqual(['line-cutter', 'feelin-glam'].map((k) => [k, by(k).rarity, by(k).play ?? 'cast', by(k).alignment, by(k).reaches ?? ['post'], by(k).stack ?? 1, instance.machine[at(k)]?.availability, instance.machine[at(k)]?.price]), [
    ['line-cutter', 'rare', 'cast', 'pepperoni', ['post'], 1, 'hidden', 300],
    ['feelin-glam', 'rare', 'cast', 'sweet', ['thread'], 1, 'hidden', 300],
  ]);
  assert.deepEqual([by('line-cutter').replies, by('line-cutter').lasts, by('feelin-glam').keeps, by('feelin-glam').lasts], [true, undefined, true, { unit: 'day', count: 7 }]);
  // The boards hold slots by place: a hidden slot is never among the on-sale run, and these two are the machine's last.
  assert.deepEqual([at('line-cutter'), at('feelin-glam')], [instance.machine.length - 2, instance.machine.length - 1]);
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
  assert.deepEqual(decideSet(cutter, settings, post(10), [], {}, cards), { ok: false, why: 'Line Cutter carries a reply, so it is cast face up and never set face down' });
});

test("a Sugar Coat on the post turns a Line Cutter away, and a Force Field does not", () => {
  const live = new Date(Date.now() + 86_400_000).toISOString();
  const context = { nameOf: (key: string) => cards.find((c) => c.key === key)!.name };
  const coat = [{ card: 'sugar-coat', act: 'k1', gimmick: by('sugar-coat').gimmick, ends: live }];
  assert.deepEqual(decidePlay(by('line-cutter'), settings, post(10), coat, {}, '', context), { ok: false, why: "this post's Sugar Coat turns away Pepperoni cards" });
  const field = [{ card: 'force-field', act: 'k2', gimmick: by('force-field').gimmick, ends: live }];
  assert.equal(decidePlay(by('line-cutter'), settings, post(10), field, {}, '', context).ok, true, 'Force Field stops at uncommon, and Line Cutter is rare');
});

test("Feelin' Glam lands on a thread, one at a time, and costs nothing more", () => {
  const glam = by('feelin-glam');
  const thread = { reach: 'thread' as const, thread: 't1' };
  const live = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(glam.canApply(thread, []).ok, true);
  assert.deepEqual(glam.canApply(post(10), []), { ok: false, why: 'this card lands on a thread' });
  assert.deepEqual(glam.canApply(thread, [{ card: 'feelin-glam', act: 'k1', reach: 'thread', ends: live }]), { ok: false, why: 'this thread already carries that card' });
  assert.equal(glam.canApply(thread, [{ card: 'feelin-glam', act: 'k1', reach: 'thread', ends: new Date(Date.now() - 1000).toISOString() }]).ok, true, 'one that has worn off is no longer in the way');
  assert.equal(glam.playPrice(settings, thread, {}), 0);
});
