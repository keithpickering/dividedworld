import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubHit, scrubbedComplete } from './scrub.ts';
import { AnswerRejected, type CompletionRequest, type ModelResult, type Models } from './model.ts';

const WORDS = ['badword', 'florp', 'two words'];

test('word: a whole-word, case-folded match hits', () => {
  assert.equal(scrubHit('you badword', WORDS), 'word');
  assert.equal(scrubHit('BADWORD!', WORDS), 'word');
  assert.equal(scrubHit('Florp, florp.', WORDS), 'word');
  assert.equal(scrubHit('so Two   words here', WORDS), 'word', 'a run of spaces matches the space in an entry');
  assert.equal(scrubHit('so two words here', WORDS), 'word', 'a multi-word entry hits');
});

test('word: letter-for-digit and symbol swaps are folded', () => {
  for (const t of ['b4dw0rd', 'B4DW0RD', 'b@dword', 'badw0rd', 'fl0rp']) assert.equal(scrubHit(t, WORDS), 'word', t);
  assert.equal(scrubHit('ba$dword', ['basdword']), 'word');
  assert.equal(scrubHit('7est', ['test']), 'word');
  assert.equal(scrubHit('b3dword', ['bedword']), 'word');
  assert.equal(scrubHit('b1dword', ['bidword']), 'word');
});

test('word: only at word boundaries', () => {
  assert.equal(scrubHit('Superman flew by', ['man', 'super']), null);
  assert.equal(scrubHit('a badwords list', WORDS), null);
  assert.equal(scrubHit('unflorp', WORDS), null);
  assert.equal(scrubHit('a man', ['man']), 'word');
  assert.equal(scrubHit('some-florp-thing', WORDS), 'word');
});

test('word: regex metacharacters in an entry are literal, and an empty list never hits', () => {
  assert.equal(scrubHit('a.b', ['a.b']), 'word');
  assert.equal(scrubHit('axb', ['a.b']), null);
  assert.equal(scrubHit('c++ (really)', ['c++', '(really)']), 'word');
  assert.equal(scrubHit('anything at all', []), null);
});

test('word: a 4,000-character text against a few hundred words is quick', () => {
  const words = Array.from({ length: 400 }, (_, i) => `entry${i}x`);
  const text = 'a quiet sentence about nothing '.repeat(130);
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) assert.equal(scrubHit(text, words), null);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

test('email: an address hits, and the raw text is read', () => {
  assert.equal(scrubHit('write me at someone@example.com please', []), 'email');
  assert.equal(scrubHit('a.b+c@mail.example.org', []), 'email');
  assert.equal(scrubHit('meet me @ noon', []), null);
});

test('url: a scheme, www. or a dotted host with a known TLD hits', () => {
  assert.equal(scrubHit('go to https://x.y/z', []), 'url');
  assert.equal(scrubHit('see http://localhost', []), 'url');
  assert.equal(scrubHit('www.thing', []), 'url');
  assert.equal(scrubHit('try example.com now', []), 'url');
  assert.equal(scrubHit('try dw.gripe', ['x']), null, 'gripe is not on the known list');
  assert.equal(scrubHit('join discord.gg/abc', []), 'url');
  assert.equal(scrubHit('a.example.co.uk', []), 'url');
});

test('url: near misses do not hit', () => {
  for (const t of ['version 1.2.3', 'e.g. a thing', 'etc. and more', 'end.Next sentence', 'Mr. Smith', 'game.com' + 'puter', 'a.b']) assert.equal(scrubHit(t, []), null, t);
});

test('phone: seven or more digits in a run with the usual separators hits', () => {
  for (const t of ['call 555-1234', 'call (555) 123-4567', 'call +1 555 123 4567', 'call 555.123.4567', 'call 5551234', '12345678']) assert.equal(scrubHit(t, []), 'phone', t);
});

test('phone: near misses do not hit', () => {
  for (const t of ['in 2021', '1,000,000 points', '123456', '12 34 56']) assert.equal(scrubHit(t, []), null, t);
});

test('predicate order: word, email, url, phone', () => {
  assert.equal(scrubHit('badword a@b.com www.x.com 5551234', WORDS), 'word');
  assert.equal(scrubHit('a@b.com www.x.com 5551234', WORDS), 'email');
  assert.equal(scrubHit('www.x.com 5551234', WORDS), 'url');
  assert.equal(scrubHit('5551234', WORDS), 'phone');
  assert.equal(scrubHit('a clean sentence.', WORDS), null);
});

const result = (value: string): ModelResult<string> => ({ value, usage: {}, provider: 'fake', model: 'fake', trims: [], retries: 0, costMicrodollars: 0 });
const REQUEST: CompletionRequest = { duty: 'chatter', prompt: 'p', temperature: 1, topP: 1, stop: [], maxTokens: 10 };
function fake(answers: (string | Error)[]) {
  const calls: CompletionRequest[] = [];
  const models: Models = {
    async chat() { throw new Error('no chat'); },
    async complete(r) { calls.push(r); const a = answers[calls.length - 1]!; if (a instanceof Error) throw a; return result(a); },
  };
  return { models, calls };
}

test('scrubbedComplete: a clean first answer is one call', async () => {
  const f = fake(['fine words']);
  assert.equal((await scrubbedComplete(f.models, REQUEST, WORDS)).value, 'fine words');
  assert.equal(f.calls.length, 1);
});

test('scrubbedComplete: a hit then a clean answer returns the clean one after two calls', async () => {
  const f = fake(['you badword', 'nicer words']);
  assert.equal((await scrubbedComplete(f.models, REQUEST, WORDS)).value, 'nicer words');
  assert.equal(f.calls.length, 2);
});

test('scrubbedComplete: two hits throw AnswerRejected naming the predicate', async () => {
  const f = fake(['you badword', 'florp again']);
  await assert.rejects(scrubbedComplete(f.models, REQUEST, WORDS), (e: unknown) => e instanceof AnswerRejected && e.predicate === 'scrub:word' && /scrubber/.test(e.message));
  assert.equal(f.calls.length, 2);
  const u = fake(['see www.x.com', 'see https://x.y']);
  await assert.rejects(scrubbedComplete(u.models, REQUEST, WORDS), (e: unknown) => e instanceof AnswerRejected && e.predicate === 'scrub:url');
});

test('scrubbedComplete: a rejection or error from the model passes through untouched, with no second call', async () => {
  const rejected = new AnswerRejected('empty', 'nonEmpty');
  const f = fake([rejected]);
  await assert.rejects(scrubbedComplete(f.models, REQUEST, WORDS), (e: unknown) => e === rejected);
  assert.equal(f.calls.length, 1);
  const boom = new Error('boom');
  const g = fake([boom]);
  await assert.rejects(scrubbedComplete(g.models, REQUEST, WORDS), (e: unknown) => e === boom);
  assert.equal(g.calls.length, 1);
});
