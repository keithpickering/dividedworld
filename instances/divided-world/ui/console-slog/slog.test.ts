/**
 * Console Slog's mash, as numbers (docs/plans/2026-11-27-season-two-cards-design.md, section 3): the units a press reveals, read from a post's parsed
 * BBCode, and the streak that makes a press worth more characters. Pure, no DOM. Each test names the defect it is for.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/console-slog/slog.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { drained, nextStreak, pressWorth, unitsOf, type SlogSettings, type Unit } from './slog.ts';

const S: SlogSettings = { rhythmMs: 450, perStep: 5, mostPerPress: 8, drain: 12, bands: 16 };
const QUOTED = '0f8fad5b-d9cb-469f-a165-70867728950e';
/** The characters the units print, in order, with each image band written as a bar (so a test reads the text and where a picture lands). */
const printed = (units: readonly Unit[]): string => units.map((u) => (u.kind === 'char' ? u.ch : '|')).join('');
const of = (body: string, bands = 16): Unit[] => unitsOf(parse(body), bands);

test('plain words are a unit each, a character at a time (an emoji is one, not two halves)', () => {
  assert.equal(printed(of('Hi there')), 'Hi there');
  assert.equal(of('a😀b').length, 3);
  assert.deepEqual(of(''), []);
});

test('bold and the like print their words and nothing of their tags', () => {
  assert.equal(printed(of('so [b]very[/b] [color=red]red[/color]')), 'so very red');
});

test('a quote prints its lines each behind "> ", and ends its last line', () => {
  assert.equal(printed(of(`[quote=${QUOTED}]first\nsecond[/quote]and then`)), '> first\n> second\nand then');
});

test('a link prints its text, then its address in brackets, as units of one link; its text and address are told apart', () => {
  const units = of('see [url=https://example.com/a]my page[/url] now');
  assert.equal(printed(units), 'see my page [https://example.com/a] now');
  const link = units.filter((u) => u.kind === 'char' && u.link !== undefined);
  assert.equal(link.map((u) => (u as { ch: string }).ch).join(''), 'my page [https://example.com/a]');
  assert.deepEqual([...new Set(link.map((u) => (u as { link: number }).link))], [0]);
  assert.deepEqual(link.every((u) => (u as { href: string }).href === 'https://example.com/a'), true);
  assert.equal(link.filter((u) => (u as { part?: string }).part === 'address').map((u) => (u as { ch: string }).ch).join(''), ' [https://example.com/a]');
  assert.equal(printed(of('go https://example.com/b ok')), 'go https://example.com/b [https://example.com/b] ok', 'a bare address is a link too');
  assert.deepEqual([...new Set(of('[url=https://a.test/]x[/url] [url=https://b.test/]y[/url]').flatMap((u) => (u.kind === 'char' && u.link !== undefined ? [u.link] : [])))], [0, 1], 'two links are two');
});

test('code prints as it is, tags and spacing kept', () => {
  assert.equal(printed(of('[code]if (a) {\n  b();\n}[/code]')), 'if (a) {\n  b();\n}\n');
});

test('an image prints "[IMG] name" on a line, then one unit for each of its bands', () => {
  const units = of('look:[img]https://x.test/pics/only_good_board.png[/img]after', 5);
  assert.equal(printed(units), 'look:\n[IMG] only_good_board.png\n|||||after');
  const bands = units.filter((u) => u.kind === 'band');
  assert.deepEqual(bands.map((u) => (u as { band: number }).band), [0, 1, 2, 3, 4]);
  assert.deepEqual(new Set(bands.map((u) => (u as { src: string }).src)), new Set(['https://x.test/pics/only_good_board.png']));
  assert.equal(bands.every((u) => (u as { bands: number }).bands === 5), true);
  assert.equal(of('[img]https://x.test/a.png[/img]', 16).filter((u) => u.kind === 'band').length, 16, 'the setting\'s bands');
});

test('a post with all of these lists its units in the order it is read', () => {
  const body = `Okay.\n[quote=${QUOTED}]hm[/quote]\nSee [url=https://e.test/x]this[/url].\n[code]x[/code][img]https://e.test/p.png[/img]`;
  assert.equal(printed(of(body, 2)), 'Okay.\n> hm\n\nSee this [https://e.test/x].\nx\n[IMG] p.png\n||');
});

test('a press is worth one character, and one more for every perStep presses of streak, to the most', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 34, 35, 36, 500].map((n) => pressWorth(n, S)), [1, 1, 1, 2, 2, 3, 7, 8, 8, 8]);
  assert.equal(pressWorth(100, { ...S, mostPerPress: 3 }), 3);
});

test('a press within the rhythm builds the streak by one; a press after a pause does not, and costs a step', () => {
  assert.equal(nextStreak(7, 450, S), 8, 'at the window\'s edge it is still in rhythm');
  assert.equal(nextStreak(7, 100, S), 8);
  assert.equal(nextStreak(20, 1450, S), 3, 'out of rhythm: drained over the pause (a second past the window), and a step off');
  assert.equal(nextStreak(3, 2000, S), 0, 'never below nothing');
});

test('a streak drains by the setting a second once the rhythm has lapsed, and not before', () => {
  assert.equal(drained(30, 300, S), 30, 'within the window nothing drains');
  assert.equal(drained(30, 450, S), 30);
  assert.equal(drained(30, 1450, S), 18, 'one second past the window: 12 presses');
  assert.equal(drained(30, 60_000, S), 0);
  assert.equal(drained(0, 5000, S), 0);
});

test('twenty presses in rhythm reveal more each as the streak builds, and never more than the most', () => {
  let streak = 0;
  const worth: number[] = [];
  for (let i = 0; i < 20; i++) { streak = nextStreak(streak, 100, S); worth.push(pressWorth(streak, S)); }
  assert.deepEqual(worth, [1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5]);
});
