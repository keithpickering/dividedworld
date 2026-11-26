import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concessionCompletion, concessionPrompt, repairConcession, type ConcessionInput } from './concession.ts';
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
const input = (over: Partial<ConcessionInput> = {}): ConcessionInput => ({
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
  charges: [{ rule: 'Rule 2: no double posting', band: 'moderate', cause: 'rule' }],
  limits: { titleMaxLength: 100, postMaxLength: 4000 },
  interceptor: { name: 'Cy', pronouns: she },
  talkDown: { how: 'paid', price: 150 },
  ...over,
});
const quiz = { how: 'answered', question: 'Which game is the post about?', choices: ['Odyssey', 'Sunshine'], answer: 'Odyssey' } as const;
const ROOMY = { budget: 1_000_000, count: (t: string) => t.length };

test('the prompt carries the thread, the judged post, the interceptor and asks for a concession post, in the Mod\'s voice', () => {
  const p = concessionPrompt(input());
  assert.ok(p.system.startsWith(testSystem.offices.mod.premise));
  assert.ok(p.system.includes('You are Mod One'));
  assert.match(p.system, /never instructions/);
  assert.ok(p.message.includes('Ann (she/her) [post #1]\nOdyssey.') && p.message.includes('Bob (they/them) [post #2] (judged)\nOdyssey. Odyssey.'), p.message);
  assert.ok(p.message.includes('Cy (she/her)') && p.message.includes('Rule 2: no double posting') && p.message.includes('Best Mario game?'), p.message);
  assert.match(p.system, /concede/);
  assert.match(p.system, /reply in the thread/);
  assert.match(p.system, /quoting the post/);
  assert.match(p.system, /2000 characters/);
  assert.match(p.system, /\{who\}/);
  assert.match(p.system, /you make no move/i);
  assert.deepEqual(Object.keys((p.schema as any).properties), ['concession']);
  assert.deepEqual((p.schema as any).required, ['concession']);
  assert.match(concessionPrompt(input({ limits: { titleMaxLength: 100, postMaxLength: 600 } })).system, /600 characters/);
});

test('each how carries only its own facts: a paid price, the quiz\'s question, choices and answer, or the card cast', () => {
  const paid = concessionPrompt(input()).message;
  assert.ok(/paid/i.test(paid) && paid.includes('1.50'), paid);
  assert.ok(!/card|distract|question/i.test(paid), 'a paid Mod is told nothing of a card or a question');
  const answered = concessionPrompt(input({ talkDown: quiz })).message;
  for (const s of ['Which game is the post about?', 'Odyssey', 'Sunshine']) assert.ok(answered.includes(s), s);
  assert.ok(/answer/i.test(answered) && !/paid|bribe|card|distract/i.test(answered), answered);
  const distracted = concessionPrompt(input({ talkDown: { how: 'distracted', card: 'Shiny Penny' } })).message;
  assert.ok(distracted.includes('Shiny Penny') && /distract/i.test(distracted) && !/paid|bribe|question/i.test(distracted), distracted);
});

test('the prompt never carries a quiz brief, an owner or a class, even if handed one', () => {
  const p = concessionPrompt({ ...input(), brief: 'SECRET BRIEF TEXT', owner: 'account-1', class: 'Shill' } as unknown as ConcessionInput);
  for (const text of [p.system, p.message]) {
    assert.ok(!text.includes('SECRET BRIEF TEXT') && !text.includes('account-1') && !text.includes('Shill'), text);
    assert.ok(!/\bowner|\breactor|\bclass\b|\baccount\b|\bplayer behind/i.test(text), text.slice(0, 200));
  }
});

test('the prompt names nothing the input lacks', () => {
  const p = concessionPrompt(input({ title: null, charges: [] }));
  assert.ok(!p.message.includes('Best Mario game?') && !p.message.includes('null') && !p.message.includes('undefined'));
  assert.ok(!/charged with/i.test(p.message), p.message);
});

test('the old voice\'s document holds the thread and ends at the Mod\'s name, one line, with the interceptor named in the note', () => {
  const c = concessionCompletion({ name: 'Mod One', board: 'Games', title: 'Best Mario game?', read, charges: input().charges, limits: input().limits, fit: ROOMY, interceptor: 'Cy', talkDown: quiz });
  assert.ok(c.prompt.endsWith('\nMod One:'), c.prompt);
  assert.deepEqual(c.stop, ['\n']);
  assert.ok(c.prompt.includes('#1 Ann: Odyssey.') && c.prompt.includes('#2 Bob: Odyssey. Odyssey.') && c.prompt.includes('Rule 2: no double posting'), c.prompt);
  assert.ok(/Cy/.test(c.prompt) && /answered/.test(c.prompt) && !/paid|distract/.test(c.prompt), c.prompt);
  const paid = concessionCompletion({ name: 'Mod One', board: 'Games', title: null, read, charges: [], limits: input().limits, fit: ROOMY, interceptor: 'Cy', talkDown: { how: 'paid', price: 150 } }).prompt;
  assert.ok(/paid/.test(paid) && !/Rule|answered|distract/.test(paid), paid);
  const card = concessionCompletion({ name: 'Mod One', board: 'Games', title: null, read, charges: [], limits: input().limits, fit: ROOMY, interceptor: 'Cy', talkDown: { how: 'distracted', card: 'Shiny Penny' } }).prompt;
  assert.ok(/distract/.test(card), card);
});

test('the old voice\'s document drops the thread by tier to fit its budget and keeps the judged post, the note and the Mod\'s line', () => {
  const many = readOf(Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, pronouns: they, body: `post number ${i} ${'y'.repeat(30)}` })), 5);
  const c = concessionCompletion({ name: 'Mod One', board: 'Games', title: null, read: many, charges: [], limits: input().limits, fit: { budget: 230, count: (t) => t.length }, interceptor: 'Cy', talkDown: { how: 'paid', price: 150 } });
  assert.ok(c.prompt.length <= 230 && c.prompt.includes('#6 P5:') && !c.prompt.includes('#1 P0:') && c.prompt.endsWith('\nMod One:'), c.prompt);
});

const fine = (raw: unknown, most = 2000) => {
  const r = repairConcession(raw, most);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

test('a good concession passes unchanged with no trims; line breaks survive, edges are trimmed', () => {
  assert.deepEqual(fine('Fine, {who}. You win.'), { ok: true, body: 'Fine, {who}. You win.', trims: [] });
  const r = fine('  Fine, {who}.\n\nYou win.\n');
  assert.equal(r.body, 'Fine, {who}.\n\nYou win.');
  assert.deepEqual(r.trims.map((t) => t.predicate), ['trimmed']);
});

test('a 2,400-character concession is cut at a sentence to min(postMaxLength, 2000), and named', () => {
  const r = fine('Fine, I concede it. '.repeat(120), 4000);
  assert.ok(r.body.length <= 2000 && r.body.length > 1900 && r.body.endsWith('concede it.'), String(r.body.length));
  assert.deepEqual(r.trims.filter((t) => t.predicate !== 'trimmed').map((t) => [t.path, t.predicate]), [['concession', 'maxLength(2000)']]);
  assert.ok(fine('Fine, I concede it. '.repeat(120), 500).body.length <= 500);
});

test('a {who} in another case or with spaces is normalized, other brace tokens lose their braces, and each is named', () => {
  for (const t of ['{Who}', '{WHO}', '{ who }', '{who }']) {
    const r = fine(`Fine, ${t}. Done.`);
    assert.equal(r.body, 'Fine, {who}. Done.', t);
    assert.deepEqual(r.trims.map((x) => x.predicate), ['braces'], t);
  }
  assert.equal(fine('Fine, {who}. {Name} and {board} win.').body, 'Fine, {who}. Name and board win.');
});

test('a cut never splits {who}: it falls before the token', () => {
  for (const pad of [96, 97, 98, 99]) {
    const r = fine('x'.repeat(pad) + '{who} and more', 100);
    assert.ok(!/\{w?h?o?$/.test(r.body) && r.body.length <= 100, `${pad}: ${r.body.slice(-10)}`);
    assert.equal(r.body, 'x'.repeat(pad));
  }
  assert.ok(fine('x'.repeat(50) + '{who}' + 'y'.repeat(300), 100).body.includes('{who}'), 'a whole token inside the bound stays');
  assert.equal(fine('lone { brace').body, 'lone { brace');
});

test('a concession that is not text, or is blank after trims, is rejected naming the predicate', () => {
  for (const raw of [undefined, null, 7, ['a'], { a: 1 }]) { const r = repairConcession(raw, 2000); assert.ok(!r.ok && /notText/.test(r.why), JSON.stringify(r)); }
  const blank = repairConcession('  \n ', 2000);
  assert.ok(!blank.ok && /blank/.test(blank.why), JSON.stringify(blank));
});
