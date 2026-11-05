import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testSystem } from '../rules/test-system.ts';
import { chatterCompletion, chatterPrompt, chatterSchema, repairChatter, CHATTER_RULE, type OfferedCard, type RepairFacts } from './chatter.ts';
import { noteMost } from './memory.ts';
import { repair } from './validate.ts';

const persona = testSystem.roster[0]!;
const CAST: OfferedCard = { key: 'whoops', name: 'Whoops!', play: 'cast' };
const SET: OfferedCard = { key: 'bluffy', name: 'Bluffy', play: 'set' };
const facts = (change: Partial<RepairFacts> = {}): RepairFacts => ({ postMaxLength: 200, titleMaxLength: 40, askedTitle: false, offered: [CAST, SET], ...change });
const ok = (raw: unknown, change: Partial<RepairFacts> = {}) => {
  const r = repairChatter(raw, facts(change));
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const no = (raw: unknown, change: Partial<RepairFacts> = {}) => {
  const r = repairChatter(raw, facts(change));
  assert.ok(!r.ok, 'expected a rejection');
  return r as Extract<typeof r, { ok: false }>;
};

test('a clean answer passes through whole, its words trimmed of outer space', () => {
  const r = ok({ words: '  Hello there.  ', card: { key: 'whoops', on: 'reply' }, note: 'Keep an eye on Ann.' });
  assert.deepEqual(r.answer, { words: 'Hello there.', card: { key: 'whoops', on: 'reply' }, note: 'Keep an eye on Ann.' });
  assert.deepEqual(r.trims, []);
});

test('words over postMaxLength are cut at the last sentence that fits, and the cut is recorded', () => {
  const sentence = 'This is a sentence of exactly forty chars.'; // 42
  const words = `${sentence} ${sentence} ${sentence} ${sentence} ${sentence}`;
  const r = ok({ words }, { postMaxLength: 130 });
  assert.equal(r.answer.words, `${sentence} ${sentence} ${sentence}`);
  assert.deepEqual(r.trims, [{ path: 'words', predicate: 'maxLength(130)', before: words.length, after: r.answer.words.length }]);
});

test('words over postMaxLength with no sentence end to cut at are cut at the length, not rejected', () => {
  const r = ok({ words: 'x'.repeat(500) }, { postMaxLength: 100 });
  assert.equal(r.answer.words.length, 100);
  assert.equal(r.trims[0]!.predicate, 'maxLength(100)');
});

test('a cut never leaves half of an emoji', () => {
  const r = ok({ words: '😀'.repeat(60) }, { postMaxLength: 101 });
  assert.ok(![...r.answer.words].some((c) => c === '\ud83d'), 'no lone surrogate');
  assert.ok(r.answer.words.length <= 101);
});

test('a note over 280 is cut, and the cut is recorded', () => {
  const r = ok({ words: 'Hi.', note: 'n'.repeat(400) });
  assert.equal(noteMost, 280);
  assert.equal(r.answer.note!.length, 280);
  assert.deepEqual(r.trims, [{ path: 'note', predicate: 'maxLength(280)', before: 400, after: 280 }]);
});

test('a note that is only space is dropped', () => {
  const r = ok({ words: 'Hi.', note: '   \n ' });
  assert.equal(r.answer.note, undefined);
  assert.equal(r.trims[0]!.path, 'note');
});

test('a card the Cast was not offered is dropped, with a trim naming the predicate', () => {
  const r = ok({ words: 'Hi.', card: { key: 'grandie', on: 'reply' } });
  assert.equal(r.answer.card, undefined);
  assert.deepEqual(r.trims, [{ path: 'card.key', predicate: 'offered', before: 1, after: 0 }]);
});

test('a card with nothing offered is dropped', () => {
  const r = ok({ words: 'Hi.', card: { key: 'whoops', on: 'reply' } }, { offered: [] });
  assert.equal(r.answer.card, undefined);
  assert.equal(r.trims[0]!.predicate, 'offered');
});

test('a Cast on its own post is dropped: a Cast lands on the post replied to', () => {
  const r = ok({ words: 'Hi.', card: { key: 'whoops', on: 'own' } });
  assert.equal(r.answer.card, undefined);
  assert.deepEqual(r.trims, [{ path: 'card.on', predicate: 'castOnReply', before: 1, after: 0 }]);
});

test('a Set on the reply is dropped: a Set lands on its own post', () => {
  const r = ok({ words: 'Hi.', card: { key: 'bluffy', on: 'reply' } });
  assert.equal(r.answer.card, undefined);
  assert.equal(r.trims[0]!.predicate, 'setOnOwn');
  assert.deepEqual(ok({ words: 'Hi.', card: { key: 'bluffy', on: 'own' } }).answer.card, { key: 'bluffy', on: 'own' });
});

test('a card whose shape is wrong is dropped, not the answer', () => {
  for (const card of ['whoops', 7, [], { key: 3, on: 'reply' }, { key: 'whoops', on: 'sideways' }, { key: 'whoops' }]) {
    const r = ok({ words: 'Still good.', card });
    assert.equal(r.answer.card, undefined, JSON.stringify(card));
    assert.equal(r.answer.words, 'Still good.');
    assert.equal(r.trims.length, 1, JSON.stringify(card));
  }
});

test('a title when none was asked for is dropped, and recorded', () => {
  const r = ok({ words: 'Hi.', title: 'A title' });
  assert.equal('title' in r.answer, false);
  assert.deepEqual(r.trims, [{ path: 'title', predicate: 'notAsked', before: 1, after: 0 }]);
});

test('a title that was asked for is kept as one line, cut to titleMaxLength', () => {
  const r = ok({ words: 'Hi.', title: '  Two\nlines   here ' }, { askedTitle: true });
  assert.equal(r.answer.title, 'Two lines here');
  const long = ok({ words: 'Hi.', title: 'T'.repeat(90) }, { askedTitle: true });
  assert.equal(long.answer.title!.length, 40);
  assert.equal(long.trims[0]!.predicate, 'maxLength(40)');
});

test('a thread start with no title is rejected: a title cannot be repaired without inventing one', () => {
  for (const raw of [{ words: 'Hi.' }, { words: 'Hi.', title: '  ' }, { words: 'Hi.', title: 4 }]) {
    const r = no(raw, { askedTitle: true });
    assert.equal(r.path, 'title');
    assert.match(r.predicate, /^(required|nonEmpty|isString)$/);
  }
});

test('words that are missing, empty, blank or not text are rejected, naming the predicate and the path', () => {
  assert.deepEqual(no({}), { ok: false, path: 'words', predicate: 'required', trims: [] });
  assert.deepEqual(no({ words: '' }), { ok: false, path: 'words', predicate: 'nonEmpty', trims: [] });
  assert.deepEqual(no({ words: ' \n\t ' }), { ok: false, path: 'words', predicate: 'nonEmpty', trims: [] });
  assert.deepEqual(no({ words: 5 }), { ok: false, path: 'words', predicate: 'isString', trims: [] });
  assert.deepEqual(no('words'), { ok: false, path: '', predicate: 'isObject', trims: [] });
  assert.deepEqual(no(null), { ok: false, path: '', predicate: 'isObject', trims: [] });
});

test('a rejection carries the trims made before it', () => {
  const r = no({ words: 'x'.repeat(500) }, { postMaxLength: 100, askedTitle: true });
  assert.equal(r.predicate, 'required');
  assert.equal(r.path, 'title');
  assert.deepEqual(r.trims.map((t) => t.path), ['words']);
});

test('the model layer\'s rule passes a good answer whole and rejects missing words by name; the card and note are not tightened there', () => {
  const good = { words: 'Hi.', title: 't', card: { key: 'whoops', on: 'both' }, note: 'n'.repeat(900) };
  const r = repair(good, CHATTER_RULE);
  assert.ok(r.ok);
  assert.deepEqual(r.value, good, 'the rule cuts nothing: repairChatter owns every bound');
  const miss = repair({ title: 't' }, CHATTER_RULE);
  assert.ok(!miss.ok);
  assert.equal(miss.predicate, 'required');
});

test('the provider schema asks for a title only for a thread start, and offers only the cards it may play', () => {
  const plain = chatterSchema({ askedTitle: false, offered: [] }) as any;
  assert.deepEqual(plain.required, ['words']);
  assert.equal('title' in plain.properties, false);
  assert.equal('card' in plain.properties, false);
  const full = chatterSchema({ askedTitle: true, offered: [CAST, SET] }) as any;
  assert.deepEqual(full.required, ['words', 'title']);
  assert.deepEqual(full.properties.card.properties.key.enum, ['whoops', 'bluffy']);
  assert.deepEqual(full.properties.card.properties.on.enum, ['reply', 'own']);
  assert.equal(full.additionalProperties, false);
});

const base = {
  premise: 'You are posting on your own today. Nobody asked you to.',
  persona,
  career: { led: [], offices: [] },
  memory: null,
  notes: [] as string[],
  thread: { title: 'Pineapple', posts: [{ name: 'Ann', body: 'Pineapple is fine.' }, { name: 'Bob', body: 'It is not.' }] },
  quoting: { name: 'Bob', body: 'It is not.' },
  trigger: 'quoted' as const,
  offeredCards: [CAST, SET],
  startThread: false,
  limits: { threadPosts: 8, excerptChars: 20, postMaxLength: 200, titleMaxLength: 40 },
};

test('the prompt carries the persona, the premise, the thread cut to excerptChars and the newest posts only, the quoted post, the notes and the offer', () => {
  const p = chatterPrompt({
    ...base,
    notes: ['Ann is up to something.'],
    thread: { title: 'Pineapple', posts: Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, body: `post number ${i} ${'y'.repeat(60)}` })) },
  });
  assert.ok(p.system.includes(persona.persona));
  assert.ok(p.system.includes(base.premise));
  assert.ok(p.system.includes('Ann is up to something.'), 'the notes');
  assert.ok(p.system.includes('Whoops!') && p.system.includes('whoops'), 'the offer');
  assert.ok(p.system.includes(`${base.limits.postMaxLength}`), 'the length');
  assert.ok(p.message.includes('Pineapple'));
  assert.ok(p.message.includes('P11') && p.message.includes('P4') && !p.message.includes('P3:') && !p.message.includes('P0'), 'the newest eight');
  assert.ok(!p.message.includes('y'.repeat(30)), 'each post cut to 20 characters');
  assert.ok(p.system.includes('replied to or quoted'), 'the reason');
  assert.ok(p.message.includes('You are replying to Bob'), 'the post it replies to');
});

test('the prompt says no card is on offer when none is, and asks for a title only for a thread start', () => {
  const reply = chatterPrompt({ ...base, offeredCards: [] });
  assert.ok(/no card/i.test(reply.system));
  assert.ok(/give no title/i.test(reply.system));
  const start = chatterPrompt({ ...base, startThread: true, thread: null, quoting: null });
  assert.ok(start.system.includes('40'), 'the title bound is told');
  assert.ok(/title/i.test(start.system));
});

test('the oldVoice completion is one document that ends where the persona\'s words begin, and stops at the line end', () => {
  const c = chatterCompletion({ name: 'Old Timer', thread: base.thread, limits: base.limits });
  assert.ok(c.prompt.endsWith('Old Timer:'));
  assert.ok(c.prompt.includes('Ann: Pineapple is fine.'));
  assert.ok(c.stop.includes('\n'));
});
