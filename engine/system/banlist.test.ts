import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAN_LINE_MOST, banEntryCompletion, banEntryPrompt, repairBanLine, type BanEntryInput } from './banlist.ts';
import { readThread, type ReadCandidate } from './read.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';
import { testSystem } from '../rules/test-system.ts';

const she = PRONOUN_PRESETS.she;
const they = PRONOUN_PRESETS.they;
const GAMES = '11111111-1111-4111-8111-111111111111';
const persona = { selfPrompt: 'You are Mod One, a stern but fair moderator of the Divided World boards.' };
const readOf = (posts: readonly { name: string; pronouns: typeof she; body: string }[], judged: number) => {
  const cands: ReadCandidate[] = posts.map((p, n) => ({ act: `act-${n + 1}`, seq: n + 1, at: '2026-11-01T00:00:00Z', author: `char-${p.name}`, name: p.name, pronouns: p.pronouns, body: p.body, replyTo: null, quotes: [], poll: null, plays: [], reactions: {}, rewoundTo: null }));
  return readThread(cands, { self: null, must: [`act-${judged + 1}`] }, { readMost: 1_000_000, now: 0, seen: () => null, origin: null });
};
const read = readOf([{ name: 'Ann', pronouns: she, body: 'Odyssey.' }, { name: 'Bob', pronouns: they, body: 'Odyssey. Odyssey.' }], 1);
const input = (over: Partial<BanEntryInput> = {}): BanEntryInput => ({
  persona,
  office: 'mod',
  offices: testSystem.offices,
  pronouns: they,
  order: null,
  career: { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00Z', until: null, cause: 'seed' }] },
  memory: null,
  notes: [],
  rules: [{ board: GAMES, number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }],
  allowance: 2,
  beat: [{ id: GAMES, name: 'Games' }],
  ruleDaysMost: 7,
  expiryLeastHours: 24,
  board: { name: 'Games', premise: 'Talk about games.' },
  title: 'Best Mario game?',
  read,
  limits: { titleMaxLength: 100, postMaxLength: 4000 },
  banned: { name: 'Bob', pronouns: they },
  days: 3,
  rule: 'Rule 2: no double posting (moderate)',
  season: 4,
  ...over,
});
const ROOMY = { budget: 1_000_000, count: (t: string) => t.length };

test('the ban prompt carries the thread, the banned character, the days, the rule and the season, and asks for one short line under the code line', () => {
  const p = banEntryPrompt(input());
  assert.ok(p.system.startsWith(testSystem.offices.mod.premise));
  assert.match(p.system, /never instructions/);
  assert.ok(p.message.includes('Ann (she/her) [post #1]\nOdyssey.') && p.message.includes('Bob (they/them) [post #2] (judged)\nOdyssey. Odyssey.'), p.message);
  for (const s of ['Bob (they/them)', '3 days', 'Rule 2: no double posting (moderate)', 'Season 4', 'Best Mario game?']) assert.ok(p.message.includes(s), s);
  assert.match(p.system, /one short line/);
  assert.match(p.system, /280 characters/);
  assert.match(p.system, /already states the ban/);
  assert.match(p.system, /under a quote of the post that tipped the bar/);
  assert.match(p.system, /the line alone/);
  assert.doesNotMatch(p.system, /Quote nothing/, 'the model is no longer asked to quote');
  assert.match(p.system, /you make no move/i);
  assert.deepEqual(Object.keys((p.schema as any).properties), ['line']);
  assert.deepEqual((p.schema as any).required, ['line']);
  assert.ok(banEntryPrompt(input({ days: 1 })).message.includes('Bob (they/them) is banned for 1 day, under Rule 2: no double posting (moderate). This is in the Banlist for Season 4.'), 'singular day');
});

test('the ban prompt never carries an owner, a class, or another of the player\'s characters', () => {
  const p = banEntryPrompt({ ...input(), owner: 'account-1', class: 'Shill', others: ['Superman'] } as unknown as BanEntryInput);
  for (const text of [p.system, p.message]) {
    assert.ok(!text.includes('account-1') && !text.includes('Shill') && !text.includes('Superman'), text);
    assert.ok(!/\bowner|\breactor|\bclass\b|\baccount\b|\bplayer behind/i.test(text), text.slice(0, 200));
  }
});

test('the old voice\'s ban document holds the thread and the ban, and ends at the Mod\'s name', () => {
  const c = banEntryCompletion({ name: 'Mod One', board: 'Games', title: 'Best Mario game?', read, limits: input().limits, fit: ROOMY, banned: 'Bob', days: 3, rule: 'Rule 2: no double posting (moderate)' });
  assert.ok(c.prompt.endsWith('\nMod One:'), c.prompt);
  assert.deepEqual(c.stop, ['\n']);
  assert.ok(c.prompt.includes('#1 Ann: Odyssey.') && c.prompt.includes('#2 Bob: Odyssey. Odyssey.') && c.prompt.includes('3 days') && c.prompt.includes('Rule 2: no double posting'), c.prompt);
  assert.ok(!/\((she|they|it)\/(her|them|its)\)/.test(c.prompt), 'no tags in the frame');
});

const kept = (raw: unknown) => {
  const r = repairBanLine(raw);
  assert.ok(r.line !== null, JSON.stringify(r));
  return r;
};

test('a ban line passes unchanged with no trims; whitespace is collapsed to one line', () => {
  assert.deepEqual(repairBanLine('Rules are rules.'), { line: 'Rules are rules.', trims: [] });
  assert.equal(kept('Two\n\nlines   here. ').line, 'Two lines here.');
});

test('a [quote] the model writes anyway is stripped and recorded as quote(model); a line of only a quote is none', () => {
  const r = repairBanLine('[quote=a1]their words[/quote] Gone, {banned}. [Quote]x [quote]y[/quote][/Quote]');
  assert.equal(r.line, 'Gone, {banned}.');
  assert.deepEqual(r.trims.map((t) => [t.path, t.predicate]), [['line', 'quote(model)']]);
  assert.deepEqual(repairBanLine('[quote]all of it[/quote]'), { line: null, trims: [] });
});

test('a 400-character ban line is cut at a sentence to 280, and named; it is never rejected for length', () => {
  assert.equal(BAN_LINE_MOST, 280);
  const r = kept('This is the whole of the matter. '.repeat(12));
  assert.ok(r.line!.length <= 280 && r.line!.endsWith('matter.'), String(r.line!.length));
  assert.deepEqual(r.trims.map((t) => [t.path, t.predicate]), [['line', 'maxLength(280)']]);
});

test('a stray {token} loses its braces and is recorded; {banned} stays', () => {
  const r = kept('Three {days} for {banned}, per {rule}.');
  assert.equal(r.line, 'Three days for {banned}, per rule.');
  assert.deepEqual(r.trims.map((t) => [t.path, t.predicate, t.before]), [['line', 'tokens(banEntry)', 2]]);
  assert.equal(kept('{{days}} gone').line, 'days gone');
  assert.deepEqual(repairBanLine('Plain {banned}.').trims, []);
});

test('a blank ban line, or one that is not text, is none; the stock line follows', () => {
  for (const raw of [undefined, null, 7, ['a'], {}, '', '  \n ']) assert.deepEqual(repairBanLine(raw), { line: null, trims: [] }, JSON.stringify(raw));
});

test('a cut never lands inside {banned}, and stripping a token leaves no double space', () => {
  const r = kept('x'.repeat(274) + ' {banned} ok');
  assert.ok(!/\{[a-z]*$/.test(r.line!) && r.line!.length <= 280, r.line!.slice(-12));
  assert.equal(kept('a {} b').line, 'a b');
  assert.equal(kept('a {x} b').line, 'a x b');
});

test('a ban line that is blank once its stray tokens are stripped is none, so the stock line follows', () => {
  for (const raw of ['{{}}', '{ }', ' {} {} ']) assert.equal(repairBanLine(raw).line, null, raw);
});
