/**
 * You Were Saying?'s rules and its frame (docs/plans/2026-11-07-you-were-saying-plan.md, Task 7).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youWereSaying } from './you-were-saying.ts';
import { cutCompletion } from '../../../engine/system/validate.ts';
import { HEADER, STOPS } from './you-were-saying/frame.ts';
import { defaults as settings } from '../settings.ts';
import { instance } from '../index.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { postTarget, WRITE_TOKENS_MOST, writeTokensMost, type CardTarget } from '../../../engine/rules/cards.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import { mostSteps } from './you-were-saying.ts';

const rules = youWereSaying;
const writes = rules.writes!;
const target = (body: string): CardTarget => postTarget('p1', 'post', body);
const frame = (over: Partial<Parameters<typeof writes.frame>[0]> = {}) =>
  writes.frame({ post: { name: 'Mario', text: 'I was going to say' }, before: [], title: 'Best level', tails: [], settings, budget: 100_000, count: (t) => t.length, ...over });

test('its length and its price follow its steps', () => {
  assert.equal(writes.tokens({ steps: 0 }, settings), 25);
  assert.equal(writes.tokens({ steps: 7 }, settings), 200);
  assert.equal(rules.playPrice(settings, target('hello'), { steps: 0 }), 0);
  assert.equal(rules.playPrice(settings, target('hello'), { steps: 7 }), 175);
  assert.equal(rules.playPrice(settings, target('hello'), undefined as never), 175, 'a face asks the most');
});

test('an override that lowers the most is never exceeded', () => {
  const low = withOverrides(settings, { economy: { 'youWereSaying.mostTokens': 75 } });
  assert.equal(writes.tokens({ steps: 7 }, low), 75);
  assert.equal(rules.playPrice(low, target('hello'), { steps: 7 }), 50);
});

test('a step is a whole number from 0 to the most', () => {
  assert.deepEqual(rules.validateConfig({ steps: 3 }), { ok: true, value: { steps: 3 } });
  assert.deepEqual(rules.validateConfig({ steps: 7 }), { ok: true, value: { steps: 7 } });
  for (const steps of [8, -1, 1.5, '2', null, NaN, Infinity]) assert.equal(rules.validateConfig({ steps }).ok, false, String(steps));
  assert.equal(rules.validateConfig({}).ok, false);
  assert.equal(rules.validateConfig(null).ok, false);
  assert.deepEqual(rules.staffConfigs, [{ steps: 0 }]);
});

test('it lands on a post with words, and not on one with none of the author\'s own', () => {
  const nothing = { ok: false, why: "There's nothing in this post to continue." };
  assert.deepEqual(rules.canApply(target('[img]https://x.test/a.png[/img][img]https://x.test/b.png[/img]'), []), nothing);
  assert.deepEqual(rules.canApply(target('[quote=0f8fad5b-d9cb-469f-a165-70867728950e]someone else[/quote]'), []), nothing);
  assert.deepEqual(rules.canApply(target('[code]let x = 1[/code]'), []), nothing);
  assert.deepEqual(rules.canApply(target('   '), []), nothing);
  assert.equal(rules.canApply(target('[quote=0f8fad5b-d9cb-469f-a165-70867728950e]someone else[/quote] and then I said'), []).ok, true);
  assert.equal(rules.canApply(target('Plain words'), []).ok, true);
});

test('it stacks three deep', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'you-were-saying', act: `k${i}` }));
  assert.equal(rules.canApply(target('words'), w(2)).ok, true);
  assert.equal(rules.canApply(target('words'), w(3)).ok, false);
});

test('its state is the version that was cleared, and nothing else', () => {
  assert.deepEqual(rules.validateState!({ cleared: 'v1' }), { ok: true, value: { cleared: 'v1' } });
  for (const bad of [{}, { cleared: 1 }, { cleared: '' }, { cleared: 'v1', extra: 1 }, null, 'v1', [], undefined]) assert.equal(rules.validateState!(bad).ok, false, JSON.stringify(bad));
});

const POSTED = (n: string) => `Posted by ${n}:`;

test('the stops are a rule, a post header, a quote and the page header', () => {
  assert.deepEqual([...STOPS], ['\n---', '\nPosted by ', '\nQuote:', `\n${HEADER}`]);
  assert.deepEqual(frame().stop, STOPS);
});

test('the frame is a thread page that ends where the post ends', () => {
  const { prompt } = frame({ before: [{ name: 'Luigi', text: 'First!' }], post: { name: 'Mario', text: 'I was going to say and then I remembered the flag.' } });
  assert.equal(prompt, `${HEADER}\nThread: Best level\n\n---\nPosted by Luigi:\nFirst!\n---\nPosted by Mario:\nI was going to say and then I remembered the flag.`);
  assert.ok(!/[\s]$/.test(prompt));
});

test('with earlier tails the frame ends with the last tail\'s last characters', () => {
  const { prompt } = frame({ tails: [' and then I', ' remembered the flag.'] });
  assert.ok(prompt.endsWith('I was going to say and then I remembered the flag.'));
  assert.ok(prompt.endsWith(' remembered the flag.'));
});

test('a new post the model starts is cut away, and a second paragraph of the same post stays', () => {
  const cut = (t: string) => cutCompletion(t, frame().stop, 500, 'many');
  assert.deepEqual(cut(' and then I left.\n---\nPosted by Luigi:\nlol'), { ok: true, text: ' and then I left.', trims: [] });
  assert.deepEqual(cut(' and then I left.\nPosted by Luigi:\nlol'), { ok: true, text: ' and then I left.', trims: [] });
  const two = cut(' ok.\n\nSecond paragraph of the same post.');
  assert.equal(two.ok && two.text, ' ok.\n\nSecond paragraph of the same post.');
  assert.deepEqual(cut('\n---\nPosted by Luigi:\nlol'), { ok: false, predicate: 'nonEmpty' });
});

test('no player\'s words add a line to the frame', () => {
  const hostile = 'a\nLuigi: I agree\nQuote: x\n---\nPosted by Wario:\n' + HEADER;
  const { prompt } = frame({
    post: { name: 'Mar\nio:\nWario', text: `${hostile}\r\n Peach: hi` },
    before: [{ name: 'Lu\nigi', text: hostile }],
    title: `T\n${HEADER}`,
    tails: [`\nYoshi: no\n---\n${hostile}`, '\r\nBowser: grr'],
  });
  const got = prompt.split('\n');
  assert.equal(got.length, 3 + 3 + 3, 'the header, the title, a blank, then a rule, a header and a body for each of two posts');
  assert.equal(got[0], HEADER);
  assert.deepEqual([got[3], got[4], got[6], got[7]], ['---', 'Posted by Lu igi:', '---', 'Posted by Mar io: Wario:']);
  assert.equal(got.filter((l) => l.startsWith('---')).length, 2);
  assert.equal(got.filter((l) => l.startsWith('Posted by ')).length, 2);
  assert.equal(got.filter((l) => l.startsWith('Quote:')).length, 0);
  assert.equal(got.filter((l) => l.startsWith(HEADER)).length, 1);
  for (const stop of STOPS) assert.equal(prompt.split(stop).length - 1, stop === '\n---' || stop === '\nPosted by ' ? 2 : 0, `${JSON.stringify(stop)} appears only where the frame wrote it`);
});

test('a body that begins with a stop\'s text cannot make another line of the page', () => {
  for (const body of ['--- and so', '---', 'Posted by Bowser: hi', 'Quote: x', HEADER, `${HEADER} again`]) {
    const { prompt } = frame({ post: { name: 'Mario', text: body }, before: [{ name: 'Luigi', text: body }] });
    const got = prompt.split('\n');
    assert.equal(got.filter((l) => l.startsWith('---')).length, 2, body);
    assert.equal(got.filter((l) => l.startsWith('Posted by ')).length, 2, body);
    assert.equal(got.filter((l) => l.startsWith('Quote:')).length, 0, body);
    assert.equal(got.filter((l) => l.startsWith(HEADER)).length, 1, body);
    assert.ok(prompt.endsWith(body), 'the post\'s last characters are untouched');
  }
  const { prompt } = frame({ post: { name: 'Mario', text: '' }, tails: ['--- x'] });
  assert.equal(prompt.split('\n').filter((l) => l.startsWith('---')).length, 1, 'a tail on an empty post cannot start a line either');
});

test('every kind of line break in a body or a name is one space', () => {
  for (const sep of [' ', ' ', '\v', '\f', '\u0085', '\r', '\r\n', '\t']) {
    const { prompt } = frame({ post: { name: `Ma${sep}rio`, text: `one${sep}two` }, before: [{ name: `Lu${sep}igi`, text: `a${sep}b` }] });
    assert.equal(prompt, `${HEADER}\nThread: Best level\n\n---\n${POSTED('Lu igi')}\na b\n---\n${POSTED('Ma rio')}\none two`, JSON.stringify(sep));
    assert.equal(prompt.split('\n').length, 9, JSON.stringify(sep));
  }
});

test('an empty name, an empty title and a name ending in a colon each stay one line', () => {
  const { prompt } = frame({ post: { name: '', text: 'hi' }, before: [{ name: 'Luigi:', text: 'yo' }], title: '' });
  assert.equal(prompt, `${HEADER}\nThread: \n\n---\nPosted by Luigi::\nyo\n---\nPosted by :\nhi`);
});

test('the frame\'s own caps hold whatever the caller sends', () => {
  const long = 'x'.repeat(5000) + 'END';
  const { prompt } = frame({ post: { name: 'Mario', text: long } });
  const body = prompt.split('\n').at(-1)!;
  assert.equal([...body].length, 2000);
  assert.ok(body.endsWith('xxEND'), 'the post is clipped from its start');
  const pairs = '😀'.repeat(2500) + 'z';
  const emoji = frame({ post: { name: 'Mario', text: pairs } }).prompt.split('\n').at(-1)!;
  assert.equal([...emoji].length, 2000);
  assert.ok(emoji.startsWith('😀') && emoji.endsWith('z'));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(emoji), 'no surrogate pair is split');
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `N${i}`, text: `t${i}` }));
  const got = frame({ before: many }).prompt;
  assert.equal(got.split('\n').filter((l) => l === '---').length, 8 + 1, 'the last eight earlier posts and the post');
  assert.ok(got.includes('Posted by N4:') && got.includes('Posted by N11:') && !got.includes('Posted by N3:'));
});

test('lone surrogates are removed and whole pairs are kept', () => {
  const { prompt } = frame({ post: { name: 'Ma\ud800rio', text: 'a\udc00b😀c\ud83d' }, before: [{ name: 'Lu', text: '\ud83dx' }], title: 'T\udfffitle', tails: ['\ud800!'] });
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(prompt));
  assert.ok(prompt.endsWith('ab😀c!'));
  assert.ok(prompt.includes('Posted by Mario:'));
  assert.ok(prompt.includes('Thread: Title'));
});

test('tokens never exceed the most, even where the most is below the base', () => {
  const odd = withOverrides(settings, { economy: { 'youWereSaying.baseTokens': 25, 'youWereSaying.mostTokens': 10 } });
  assert.equal(writes.tokens({ steps: 0 }, odd), 10);
  assert.equal(writes.tokens({ steps: 3 }, odd), 10);
});

test('a most above what the server accepts is refused by the settings, and tokens never pass the bound', () => {
  const over = (n: number) => ({ ...instance, settings: withOverrides(instance.settings, { economy: { 'youWereSaying.mostTokens': n } }) });
  assert.deepEqual(instanceProblems(over(WRITE_TOKENS_MOST)), []);
  assert.match(instanceProblems(over(WRITE_TOKENS_MOST + 1)).join('\n'), /card "you-were-saying" reads economy "youWereSaying\.mostTokens" as 2001; it must be at most 2000/);
  // A valid setting, whatever its base and step, never buys more than the bound.
  for (const [base, step, most] of [[1, 1, WRITE_TOKENS_MOST], [5000, 1, WRITE_TOKENS_MOST], [1999, 7, WRITE_TOKENS_MOST], [25, 25, 200]] as [number, number, number][]) {
    const s = withOverrides(settings, { economy: { 'youWereSaying.baseTokens': base, 'youWereSaying.stepTokens': step, 'youWereSaying.mostTokens': most } });
    for (const steps of [0, 1, 3, 1000, 100000]) assert.ok(writes.tokens({ steps }, s) <= WRITE_TOKENS_MOST && writes.tokens({ steps }, s) >= 1);
  }
});

test('a window that leaves less than the base records what is generated: the most, never the base (#582)', () => {
  const tight = { ...settings, oldVoiceWindow: 270, oldVoicePromptFloor: 256 };
  assert.equal(writeTokensMost(tight), 14);
  assert.equal(mostSteps(tight), 0);
  for (const steps of [0, 1, 7]) assert.equal(writes.tokens({ steps }, tight), 14, `steps ${steps}`);
  assert.equal(rules.playPrice(tight, target('hello'), { steps: 7 }), 0, 'the one stop the slider shows costs nothing');
  assert.equal(rules.playPrice(tight, target('hello'), undefined as never), 0);
  // A pair that clamps to one token plays one token long.
  for (const [window, floor] of [[64, 256], [256, 256]] as const) {
    const gone = { ...settings, oldVoiceWindow: window, oldVoicePromptFloor: floor };
    assert.equal(writes.tokens({ steps: 0 }, gone), 1);
    assert.equal(writes.tokens({ steps: 7 }, gone), 1);
    assert.equal(rules.playPrice(gone, target('hello'), { steps: 7 }), 0);
  }
});

test('the instance, with the card, has no problems', () => {
  assert.deepEqual(instanceProblems(instance), []);
  assert.ok(instance.cards.some((c) => c.key === 'you-were-saying'));
});

// The fitting of the frame (docs/plans/2026-11-12-old-voice-window-design.md, section 3).
const bytes = tokenCounter('bytes');
const fit = (budget: number, over: Partial<Parameters<typeof writes.frame>[0]> = {}, count: (t: string) => number = bytes) => frame({ budget, count, ...over });
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const eight = Array.from({ length: 8 }, (_, i) => ({ name: `N${i}`, text: `earlier post number ${i}` }));

test('fitting: under budget, the prompt is today\'s, byte for byte', () => {
  // Today's frame, held here as it was before the budget existed.
  const LS = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
  const flat = (s: string) => s.replace(LS, '').replace(/[\s\u0085]+/g, ' ');
  const one = (s: string) => flat(s).trim();
  const clip = (s: string, most: number) => { const c = [...one(s)]; return c.length <= most ? c.join('') : `${c.slice(0, most).join('').trimEnd()}…`; };
  const last = (s: string, most: number) => { const c = [...s]; return c.length <= most ? s : c.slice(-most).join('').trimStart(); };
  const safe = (s: string) => (s.startsWith('---') || s.startsWith('Posted by ') || s.startsWith('Quote:') || s.startsWith(HEADER) ? ` ${s}` : s);
  const today = (i: { post: { name: string; text: string }; before: { name: string; text: string }[]; title: string; tails: string[] }) => {
    const lines = [HEADER, `Thread: ${clip(i.title, 200)}`, ''];
    const post = (n: string, t: string) => void lines.push('---', `Posted by ${clip(n, 60)}:`, safe(t));
    for (const p of i.before.slice(-8)) post(p.name, clip(p.text, 500));
    post(i.post.name, last(one(i.post.text), 2000) + i.tails.map(flat).join(''));
    return lines.join('\n');
  };
  const inputs = [
    { post: { name: 'Mario', text: 'I was going to say' }, before: [], title: 'Best level', tails: [] },
    { post: { name: 'Ma\ud800rio', text: '--- a\udc00b😀c\n  d ' + 'y'.repeat(2400) }, before: [...eight, { name: 'L', text: 'Quote: x '.repeat(100) }], title: ' T\udfffitle\n' + 't'.repeat(300), tails: [' and then\nI', ' went--- on.'] },
    { post: { name: '', text: '' }, before: [], title: '', tails: ['--- x'] },
  ];
  for (const i of inputs) {
    const expected = today(i);
    assert.equal(fit(1_000_000, i).prompt, expected);
    assert.equal(fit(bytes(expected), i).prompt, expected, 'a budget it exactly meets changes nothing');
  }
});

test('fitting: over budget, the oldest earlier posts go first and the newest earlier post is the last to go', () => {
  const full = fit(1_000_000, { before: eight, title: 'T' }).prompt;
  const gone: number[] = [];
  for (let budget = bytes(full); budget >= 0; budget--) {
    const p = fit(budget, { before: eight, title: 'T' }).prompt;
    const present = eight.map((_, i) => p.includes(`Posted by N${i}:`));
    if (!present.includes(false)) continue;
    // Once one is gone, every older one is gone too: what remains is a suffix of the thread.
    assert.deepEqual(present, eight.map((_, i) => i >= present.lastIndexOf(false) + 1), `budget ${budget}`);
    if (!p.includes('Thread: T')) break;
    gone.push(present.filter((x) => !x).length);
  }
  assert.ok(gone.includes(1) && gone.includes(7), 'posts leave one at a time');
  assert.ok(fit(bytes(full) - 1, { before: eight, title: 'T' }).prompt.includes('Posted by N7:'));
  assert.ok(!fit(bytes(full) - 1, { before: eight, title: 'T' }).prompt.includes('Posted by N0:'));
});

test('fitting: with no earlier posts left, the title is clipped, then emptied, before the post loses a character', () => {
  const title = 'a very long thread title that goes on and on and on past forty characters';
  const post = 'I was going to say';
  const base = { before: [], title, post: { name: 'Mario', text: post } };
  const full = fit(1_000_000, base).prompt;
  const clipped = fit(bytes(full) - 1, base).prompt;
  assert.equal(clipped.split('\n')[1], 'Thread: a very long thread title that goes on an…', 'the title is its first 40 characters and an ellipsis');
  assert.ok(clipped.length < full.length && clipped.endsWith(post));
  const emptied = fit(bytes(clipped) - 1, base).prompt;
  assert.ok(emptied.split('\n')[1] === 'Thread:', 'nothing after the colon');
  assert.ok(emptied.endsWith(post), 'the post lost nothing');
  const less = fit(bytes(emptied) - 1, base).prompt;
  assert.ok(less.endsWith('was going to say') && !less.endsWith(post), 'only then does the post lose characters, from its start');
});

test('fitting: a 2,000-character post with a budget of 100 bytes keeps the header, the author and the post\'s end', () => {
  const text = Array.from({ length: 2000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  const { prompt } = fit(100, { post: { name: 'Mario', text }, before: eight, title: 'Best level' });
  assert.ok(prompt.startsWith(`${HEADER}\n`));
  assert.ok(prompt.includes('---\nPosted by Mario:\n'));
  assert.ok(prompt.endsWith(text.slice(-20)) && prompt.endsWith(text.at(-1)!));
  assert.ok(bytes(prompt) <= 100);
  assert.ok(bytes(prompt) >= 95, 'it keeps as much as fits');
});

test('fitting: three chained tails over budget keep their end', () => {
  const tails = [' one '.repeat(30), ' two '.repeat(30), ' three and the very end'];
  const base = { post: { name: 'Mario', text: 'I was going to say' }, tails, title: 'T' };
  const header = fit(1_000_000, { ...base, tails: [] }).prompt.length;
  const { prompt } = fit(header + 40, base);
  assert.ok(prompt.endsWith('three and the very end'));
  assert.ok(bytes(prompt) <= header + 40);
  assert.ok(prompt.includes('I was going to say'.slice(-1)));
  const tight = fit(header + 3, base).prompt;
  assert.ok(tight.endsWith('end') && bytes(tight) <= header + 3);
});

test('fitting: with the gpt2 counter, a thread of 8 posts of 500 characters and a 2,000-character post fit 1,024 less 200', () => {
  const gpt2 = tokenCounter('gpt2');
  const words = 'the quick brown fox jumps over a lazy dog while Mario runs through World 1-1 '.repeat(40);
  const before = Array.from({ length: 8 }, (_, i) => ({ name: `Player${i}`, text: words.slice(i, i + 500) }));
  const post = { name: 'Mario', text: words.slice(0, 2000) };
  const input = { before, post, title: 'A thread about the best level in the whole game '.repeat(3), tails: [] };
  const unfitted = frame({ ...input, budget: 1_000_000, count: gpt2 }).prompt;
  assert.ok(gpt2(unfitted) > 824, 'the case is over budget to begin with');
  let calls = 0;
  const counting = (t: string) => (calls++, gpt2(t));
  const { prompt } = frame({ ...input, budget: 824, count: counting });
  assert.ok(gpt2(prompt) <= 824, `${gpt2(prompt)} tokens`);
  assert.ok(prompt.endsWith(post.text.slice(-30)));
  assert.ok(calls <= 40, `${calls} counts`);
});

test('fitting: a clip never splits a surrogate pair, and a budget nothing can meet returns the smallest prompt without throwing', () => {
  const emoji = '😀'.repeat(900) + 'z';
  for (const budget of [60, 83, 84, 85, 90, 101]) {
    const { prompt } = fit(budget, { post: { name: 'M', text: emoji }, tails: ['😀'.repeat(50)], title: '' });
    assert.ok(!LONE.test(prompt), `budget ${budget}`);
  }
  const small = fit(0, { post: { name: 'Mario', text: 'abc def' }, tails: [' ghi', ' jkl'], before: eight, title: 'Title' });
  assert.ok(small.prompt.startsWith(HEADER) && small.prompt.endsWith('l') && small.prompt.includes('Posted by Mario:'));
  assert.ok(!small.prompt.includes('Posted by N'));
  assert.deepEqual(small.stop, STOPS);
});

test('fitting: it clips with a bisection, a dozen counts a clip, not a thousand', () => {
  let calls = 0;
  const count = (t: string) => (calls++, bytes(t));
  fit(100, { post: { name: 'Mario', text: 'x'.repeat(2000) } }, count);
  assert.ok(calls <= 20, `${calls} counts`);
  calls = 0;
  fit(100, { post: { name: 'Mario', text: 'x'.repeat(2000) }, tails: ['y'.repeat(900)], before: eight, title: 't'.repeat(100) }, count);
  assert.ok(calls <= 60, `${calls} counts`);
});

test('mostSteps follows the window less the floor', () => {
  assert.equal(mostSteps(settings), 7);
  assert.equal(mostSteps({ ...settings, oldVoiceWindow: 400, oldVoicePromptFloor: 256 }), 4);
});

test('with a narrowed window, the price and the tokens are those of the last step that fits', () => {
  const narrow = { ...settings, oldVoiceWindow: 400, oldVoicePromptFloor: 256 };
  assert.equal(mostSteps(narrow), 4);
  const past = { steps: 7 };
  assert.equal(writes.tokens(past, narrow), writes.tokens({ steps: 4 }, narrow));
  assert.equal(writes.tokens(past, narrow), 125);
  assert.equal(rules.playPrice(narrow, target('hello'), past), rules.playPrice(narrow, target('hello'), { steps: 4 }));
  assert.equal(rules.playPrice(narrow, target('hello'), past), 100);
  assert.equal(rules.playPrice(narrow, target('hello'), undefined as never), 100, 'a face asks the most that fits');
});
