import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testSystem } from '../rules/test-system.ts';
import { chatterCompletion, chatterPrompt, chatterSchema, repairChatter, CHATTER_RULE, type OfferedCard, type RepairFacts } from './chatter.ts';
import { personaPrompt } from './prompt.ts';
import { noteMost } from './memory.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';
import { repair } from './validate.ts';
import { schemaProblems } from './schema.ts';

const persona = testSystem.roster[0]!;
const she = PRONOUN_PRESETS.she;
const they = PRONOUN_PRESETS.they;
const CAST: OfferedCard = { key: 'whoops', name: 'Whoops!', play: 'cast' };
const SET: OfferedCard = { key: 'dud', name: 'Dud', play: 'set' };
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
  const r = ok({ words: 'Hi.', card: { key: 'dud', on: 'reply' } });
  assert.equal(r.answer.card, undefined);
  assert.equal(r.trims[0]!.predicate, 'setOnOwn');
  assert.deepEqual(ok({ words: 'Hi.', card: { key: 'dud', on: 'own' } }).answer.card, { key: 'dud', on: 'own' });
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
  assert.deepEqual(full.properties.card.properties.key.enum, ['whoops', 'dud']);
  assert.deepEqual(full.properties.card.properties.on.enum, ['reply', 'own']);
  assert.equal(full.additionalProperties, false);
});

const base = {
  premise: 'You are posting on your own today. Nobody asked you to.',
  persona,
  office: 'boss' as const,
  offices: testSystem.offices,
  pronouns: PRONOUN_PRESETS.he,
  career: { led: [], offices: [] },
  memory: null,
  notes: [] as string[],
  thread: { title: 'Pineapple', posts: [{ name: 'Ann', pronouns: she, body: 'Pineapple is fine.' }, { name: 'Bob', pronouns: they, body: 'It is not.' }] },
  quoting: { name: 'Bob', pronouns: they, body: 'It is not.' },
  trigger: 'quoted' as const,
  offeredCards: [CAST, SET],
  startThread: false,
  limits: { threadPosts: 8, excerptChars: 20, postMaxLength: 200, titleMaxLength: 40 },
};

test('the prompt carries the persona, the premise, the thread cut to excerptChars and the newest posts only, the quoted post, the notes and the offer', () => {
  const p = chatterPrompt({
    ...base,
    notes: ['Ann is up to something.'],
    thread: { title: 'Pineapple', posts: Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, pronouns: she, body: `post number ${i} ${'y'.repeat(60)}` })) },
  });
  assert.ok(p.system.includes(personaPrompt(testSystem, persona, 'boss')));
  assert.ok(p.system.includes(base.premise));
  assert.ok(p.system.includes('Ann is up to something.'), 'the notes');
  assert.ok(p.system.includes('Whoops!') && p.system.includes('whoops'), 'the offer');
  assert.ok(p.system.includes(`${base.limits.postMaxLength}`), 'the length');
  assert.ok(p.message.includes('Pineapple'));
  assert.ok(p.message.includes('P11') && p.message.includes('P4') && !p.message.includes('P3:') && !p.message.includes('P0'), 'the newest eight');
  assert.ok(!p.message.includes('y'.repeat(30)), 'each post cut to 20 characters');
  assert.ok(p.system.includes('replied to or quoted'), 'the reason');
  assert.ok(p.message.includes('You are replying to Bob (they/them)'), 'the post it replies to, with its pronouns');
});

test('the prompt tells the persona its own pronouns after its persona, and tags each thread post and the quoted post with its author\'s', () => {
  const p = chatterPrompt({ ...base, names: (id) => (id === 'x' ? 'Cy (she/her)' : id) });
  assert.ok(p.system.includes(`${personaPrompt(testSystem, persona, 'boss')}\n\nYour pronouns are he/him (he, him, his, his, himself).`), 'the self line follows the persona');
  assert.ok(p.message.includes('Ann (she/her): Pineapple is fine.') && p.message.includes('Bob (they/them): It is not.'), 'the thread posts');
});

test('a member\'s prompt is its member frame and line, never the Boss\'s', () => {
  const p = chatterPrompt({ ...base, office: 'member' });
  assert.ok(p.system.startsWith(testSystem.offices.member.premise), 'opens with the member premise');
  assert.ok(p.system.includes(persona.officeLines!.member!), 'the member line');
  assert.ok(!p.system.includes(testSystem.offices.boss.premise) && !p.system.includes(persona.officeLines!.boss!), 'not the Boss premise or line');
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
  const c = chatterCompletion({ name: 'Old Timer', thread: base.thread, limits: base.limits, fit: ROOMY });
  assert.ok(c.prompt.endsWith('Old Timer:'));
  assert.ok(c.prompt.includes('Ann: Pineapple is fine.'), 'the frame carries no pronoun tag');
  assert.ok(!/\(she\/her\)|\(they\/them\)/.test(c.prompt));
  assert.ok(c.stop.includes('\n'));
});

/* The old voice's window (design section 3): the frame drops thread posts oldest first, then clips the title, and keeps the persona's own line. */
const ROOMY = { budget: 1_000_000, count: (t: string) => t.length };
const fitPosts = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, pronouns: they, body: `post number ${i} ${'y'.repeat(30)}` }));
const fitLimits = { threadPosts: 8, excerptChars: 25, postMaxLength: 200, titleMaxLength: 100 };
const LONG_TITLE = 'A long thread title about pineapples and more';
const fitFrame = (budget: number, over: Partial<Parameters<typeof chatterCompletion>[0]> = {}) =>
  chatterCompletion({ name: 'Old Timer', thread: { title: LONG_TITLE, posts: fitPosts }, limits: fitLimits, fit: { budget, count: (t) => t.length }, ...over });

test('the pool post frame under budget is the prompt it was before the window, byte for byte', () => {
  const whole = 'Welcome to the Message Boards - Thread View\nThread: A long thread title about pineapples and more\n\nP0: post number 0 yyyyyyyyyyy…\nP1: post number 1 yyyyyyyyyyy…\nP2: post number 2 yyyyyyyyyyy…\nP3: post number 3 yyyyyyyyyyy…\nP4: post number 4 yyyyyyyyyyy…\nP5: post number 5 yyyyyyyyyyy…\nOld Timer:';
  assert.equal(fitFrame(whole.length).prompt, whole, 'a budget that just holds it');
  assert.equal(fitFrame(1_000_000).prompt, whole);
  assert.deepEqual(fitFrame(1_000_000).stop, ['\n']);
});

test('over budget the pool post frame drops the oldest thread posts first, and still ends with the persona\'s own line', () => {
  const whole = fitFrame(1_000_000).prompt;
  const one = fitFrame(whole.length - 1).prompt;
  assert.ok(!one.includes('P0:') && one.includes('P1:') && one.includes('P5:'), one);
  assert.ok(one.includes(`Thread: ${LONG_TITLE}`), 'the title is untouched while a post can go');
  const three = fitFrame(whole.length - 3 * 'P0: post number 0 yyyyyyyyyyy…\n'.length).prompt;
  assert.ok(!three.includes('P2:') && three.includes('P3:') && three.includes('P5:'), three);
  for (const budget of [whole.length - 1, 150, 90, 1]) assert.ok(fitFrame(budget).prompt.endsWith('\nOld Timer:'));
  const bare = fitFrame(1_000_000, { thread: { title: LONG_TITLE, posts: [] } }).prompt.length;
  const last = fitFrame(bare + 'P5: post number 5 yyyyyyyyyyy…\n'.length).prompt;
  assert.ok(last.includes('P5:') && !last.includes('P4:'), 'the newest post is the last to go');
});

test('with no post left the pool post frame clips its title to 40 characters, then to none', () => {
  const bare = (title: string) => `Welcome to the Message Boards - Thread View\nThread:${title}\n\nOld Timer:`;
  const noPosts = bare('').length;
  const longTitle = { title: 'T'.repeat(80), posts: [] };
  const clipped = fitFrame(bare(` ${'T'.repeat(40)}…`).length, { thread: longTitle }).prompt;
  assert.equal(clipped, bare(` ${'T'.repeat(40)}…`), 'one character under the whole title: the 40-character clip');
  const gone = fitFrame(noPosts, { thread: longTitle }).prompt;
  assert.equal(gone, 'Welcome to the Message Boards - Thread View\nThread:\n\nOld Timer:');
  const smallest = fitFrame(1, { thread: { title: LONG_TITLE, posts: fitPosts } }).prompt;
  assert.equal(smallest, 'Welcome to the Message Boards - Thread View\nThread:\n\nOld Timer:', 'a budget nothing meets returns the smallest prompt and never throws');
});

test('a title clip does not split a surrogate pair', () => {
  const title = `${'a'.repeat(39)}😀${'b'.repeat(20)}`;
  const c = fitFrame(1_000_000, { thread: { title, posts: [] }, limits: { ...fitLimits, titleMaxLength: 100 } });
  assert.equal(c.prompt.includes(title), true);
  const tight = chatterCompletion({ name: 'Old Timer', thread: { title, posts: [] }, limits: fitLimits, fit: { budget: 'Welcome to the Message Boards - Thread View\nThread: \n\nOld Timer:'.length + 40, count: (t) => t.length } }).prompt;
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(tight), 'no lone high surrogate');
});

/* A test card with options (the engine knows no instance's cards): one string field, as Whoops!'s ink is. */
const INKED: OfferedCard = {
  key: 'inked', name: 'Inked', play: 'cast',
  options: { prompt: 'Choose the ink.', schema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'], additionalProperties: false } },
};
const PLAIN: OfferedCard = { key: 'plain', name: 'Plain', play: 'cast' };

test('the schema carries card.config.<key> only for an offered card with options, and uses no anyOf', () => {
  const none = chatterSchema({ askedTitle: false, offered: [PLAIN] }) as any;
  assert.equal(none.properties.card.properties.config, undefined, 'no card with options, no config');
  const some = chatterSchema({ askedTitle: false, offered: [PLAIN, INKED] }) as any;
  assert.deepEqual(Object.keys(some.properties.card.properties.config.properties), ['inked'], 'by key, only the card with options');
  assert.deepEqual(some.properties.card.properties.config.properties.inked, INKED.options!.schema);
  assert.deepEqual(some.properties.card.required, ['key', 'on'], 'the config is optional');
  assert.ok(!JSON.stringify(some).includes('anyOf'));
});

test('the prompt puts a card\'s options on the line after it, and names where they go', () => {
  const { system } = chatterPrompt({
    premise: 'p', persona, office: 'boss', offices: testSystem.offices, pronouns: she, career: { led: [], offices: [] } as any, memory: null, notes: [], thread: null, quoting: { name: 'Ann', pronouns: she, body: 'Hello.' },
    trigger: 'named', offeredCards: [INKED, PLAIN], startThread: false, limits: { threadPosts: 3, excerptChars: 100, postMaxLength: 200, titleMaxLength: 40 },
  });
  const lines = system.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- inked:'));
  assert.ok(at >= 0);
  assert.match(lines[at + 1]!, /card\.config\.inked/);
  assert.match(lines[at + 1]!, /Choose the ink\./);
  assert.ok(lines[at + 2]!.startsWith('- plain:'), 'a card without options has no second line');
});

test('the model layer\'s rule passes an offered card\'s options through whole, a wrongly typed one included, so the post is not lost', () => {
  const rule = CHATTER_RULE;
  const r = repair({ words: 'Hi.', card: { key: 'inked', on: 'reply', config: { inked: { color: 'teal', seed: 4 }, other: { a: 1 } } } }, rule);
  assert.ok(r.ok);
  assert.deepEqual((r.value as any).card.config, { inked: { color: 'teal', seed: 4 }, other: { a: 1 } });
  const bad = { words: 'Hi.', card: { key: 'inked', on: 'reply', config: { inked: { color: 5 } } } };
  const w = repair(bad, rule);
  assert.ok(w.ok, 'a number where the ink color belongs does not reject the answer');
  const k = ok(w.value, { offered: [INKED] });
  assert.deepEqual(k.answer.card, { key: 'inked', on: 'reply', config: { color: 5 } }, 'the config reaches the card\'s validator, which refuses it and falls back');
});

test('whatever junk the config is, the model layer keeps the post and repairChatter trims it, never throws', () => {
  const rule = CHATTER_RULE;
  for (const junk of ['teal', 7, true, ['a'], { inked: null }, { inked: 'teal' }, { inked: ['x'] }, { inked: 3 }]) {
    const w = repair({ words: 'Hi.', card: { key: 'inked', on: 'reply', config: junk } }, rule);
    assert.ok(w.ok, JSON.stringify(junk));
    const k = ok(w.value, { offered: [INKED] });
    assert.equal(k.answer.words, 'Hi.');
    assert.equal(k.answer.card?.key, 'inked');
    if (k.answer.card?.config !== undefined) assert.ok(typeof k.answer.card.config === 'object' && !Array.isArray(k.answer.card.config), JSON.stringify(junk));
  }
  const s = ok({ words: 'Hi.', card: { key: 'inked', on: 'reply', config: 'teal' } }, { offered: [INKED] });
  assert.deepEqual(s.answer.card, { key: 'inked', on: 'reply' });
  assert.deepEqual(s.trims.map((t) => t.predicate), ['isObject']);
});

test('the chosen card\'s options become the answer\'s config, and another card\'s are dropped with a trim', () => {
  const r = ok({ words: 'Hi.', card: { key: 'inked', on: 'reply', config: { inked: { color: 'teal' }, whoops: { color: 'red' } } } }, { offered: [INKED, CAST] });
  assert.deepEqual(r.answer.card, { key: 'inked', on: 'reply', config: { color: 'teal' } });
  assert.deepEqual(r.trims, [{ path: 'card.config.whoops', predicate: 'notChosen', before: 1, after: 0 }]);
});

test('options for a card without any, or not an object, are dropped with a trim and the card stands', () => {
  const a = ok({ words: 'Hi.', card: { key: 'plain', on: 'reply', config: { plain: { x: 1 } } } }, { offered: [PLAIN] });
  assert.deepEqual(a.answer.card, { key: 'plain', on: 'reply' });
  assert.deepEqual(a.trims.map((t) => t.predicate), ['noOptions']);
  const b = ok({ words: 'Hi.', card: { key: 'inked', on: 'reply', config: { inked: 'teal' } } }, { offered: [INKED] });
  assert.deepEqual(b.answer.card, { key: 'inked', on: 'reply' });
  assert.deepEqual(b.trims.map((t) => t.predicate), ['isObject']);
});

/* A surface card's open walls (docs/plans/2026-11-11-graffiti-plan.md, Task 3): a persona may draw on one instead of playing the card anew. */
const WALL = '66666666-6666-4666-8666-666666666666';
const TAGGED: OfferedCard = { key: 'tag', name: 'Tag', play: 'cast', options: INKED.options, walls: [{ play: WALL, about: 'Ann\'s post' }] };

test('a wall pick that names an offered wall is kept beside the card, and one that names none is dropped with a trim, the card standing', () => {
  const kept = ok({ words: 'Hi.', card: { key: 'tag', on: 'reply', wall: WALL, config: { tag: { color: 'red' } } } }, { offered: [TAGGED] });
  assert.deepEqual(kept.answer.card, { key: 'tag', on: 'reply', wall: WALL, config: { color: 'red' } });
  assert.deepEqual(kept.trims, []);
  for (const wall of ['77777777-7777-4777-8777-777777777777', 'the wall', 7, {}, ['x']]) {
    const dropped = ok({ words: 'Hi.', card: { key: 'tag', on: 'reply', wall } }, { offered: [TAGGED] });
    assert.deepEqual(dropped.answer.card, { key: 'tag', on: 'reply' }, JSON.stringify(wall));
    assert.deepEqual(dropped.trims, [{ path: 'card.wall', predicate: 'offered', before: 1, after: 0 }], JSON.stringify(wall));
  }
  // A card with no wall offered takes no wall pick; a wall of another card's is not this card's.
  const none = ok({ words: 'Hi.', card: { key: 'whoops', on: 'reply', wall: WALL } }, { offered: [CAST, TAGGED] });
  assert.deepEqual(none.answer.card, { key: 'whoops', on: 'reply' });
  assert.deepEqual(none.trims.map((t) => t.path), ['card.wall']);
});

test('the schema names the offered walls as an enum, and the rule passes the pick through; with no wall on offer there is no wall property', () => {
  const some = chatterSchema({ askedTitle: false, offered: [CAST, TAGGED] }) as any;
  assert.deepEqual(some.properties.card.properties.wall, { type: 'string', enum: [WALL] });
  assert.deepEqual(some.properties.card.required, ['key', 'on']);
  assert.equal((chatterSchema({ askedTitle: false, offered: [CAST] }) as any).properties.card.properties.wall, undefined);
  const w = repair({ words: 'Hi.', card: { key: 'tag', on: 'reply', wall: WALL } }, CHATTER_RULE);
  assert.ok(w.ok);
  assert.equal((w.value as any).card.wall, WALL);
});

test('the prompt tells the persona which walls it may draw on instead, naming card.wall', () => {
  const { system } = chatterPrompt({ ...base, offeredCards: [TAGGED] });
  assert.match(system, new RegExp(`card\\.wall.*${WALL}|${WALL}.*card\\.wall`, 's'));
  assert.match(system, /Ann's post/);
});

test('every chatter schema is one the provider accepts: plain, a thread start with a title, and every card that has options on offer at once', () => {
  const MORE: OfferedCard = { key: 'more', name: 'More', play: 'set', options: { prompt: 'Choose.', schema: { type: 'object', properties: { pick: { type: 'string', enum: ['a', 'b'] }, note: { type: 'string' } }, required: ['pick'], additionalProperties: false } } };
  const cases: [string, Parameters<typeof chatterSchema>[0]][] = [
    ['plain', { askedTitle: false, offered: [] }],
    ['a thread start with a title', { askedTitle: true, offered: [] }],
    ['a thread start with cards', { askedTitle: true, offered: [CAST, SET] }],
    ['every card with options at once', { askedTitle: true, offered: [CAST, SET, PLAIN, INKED, MORE] }],
    ['a surface card with walls on offer', { askedTitle: false, offered: [CAST, TAGGED] }],
  ];
  for (const [name, c] of cases) assert.deepEqual(schemaProblems(chatterSchema(c)), [], name);
});
