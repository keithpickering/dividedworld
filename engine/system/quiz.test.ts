import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ_CHOICE_MOST, QUIZ_QUESTION_MOST, quizPrompt, repairQuiz, type QuizInput } from './quiz.ts';

const input = (over: Partial<QuizInput> = {}): QuizInput => ({
  persona: { selfPrompt: 'You are Mod One, a stern but fair moderator.' },
  brief: 'Ask whether the post is on topic.',
  board: { name: 'Games' },
  title: 'Best Mario game?',
  author: 'Bob (they/them)',
  body: 'Odyssey. Odyssey. [redacted]',
  charges: [{ board: '11111111-1111-1111-1111-111111111111', number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }],
  ...over,
});

test('the prompt carries the post as given, its author, the title, the board, the charge and the brief, in the Mod\'s voice', () => {
  const p = quizPrompt(input());
  assert.ok(p.system.startsWith('You are Mod One, a stern but fair moderator.'));
  for (const s of ['Odyssey. Odyssey. [redacted]', 'Bob (they/them)', 'Best Mario game?', 'Games', 'Rule 2:', '(moderate)', 'Ask whether the post is on topic.']) assert.ok(p.message.includes(s), s);
  assert.deepEqual(Object.keys((p.schema as any).properties), ['question', 'choices', 'answer']);
  assert.deepEqual((p.schema as any).required, ['question', 'choices', 'answer']);
});

test('the prompt never names a field the input lacks', () => {
  const p = quizPrompt(input({ title: null, brief: null, charges: [] }));
  assert.ok(!p.message.includes('Best Mario game?') && !p.message.includes('null') && !p.message.includes('undefined'));
  assert.ok(!/thread titled|Thread:|charged with|The brief/i.test(p.message), p.message);
  assert.ok(p.message.includes('Odyssey.'));
});

const good = { question: 'Which game is the post about?', choices: ['Odyssey', 'Sunshine', 'Galaxy'], answer: 'Odyssey' };
const ok = (raw: unknown) => {
  const r = repairQuiz(raw);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const why = (raw: unknown) => {
  const r = repairQuiz(raw);
  assert.ok(!r.ok, JSON.stringify(r));
  return r.why;
};

test('a well-formed answer passes unchanged with no trims', () => {
  const r = ok(good);
  assert.deepEqual({ question: r.question, choices: r.choices, answer: r.answer, trims: r.trims }, { ...good, trims: [] });
});

test('an over-long question is cut to its bound at a word, and named', () => {
  const r = ok({ ...good, question: 'word '.repeat(60).trim() });
  assert.ok(r.question.length <= QUIZ_QUESTION_MOST && r.question.endsWith('word'));
  assert.deepEqual(r.trims.map((t) => t.path), ['question']);
});

test('an over-long choice is cut, and the answer follows it when it was that choice', () => {
  const long = 'long '.repeat(30).trim();
  const r = ok({ ...good, choices: [long, 'Sunshine'], answer: long });
  assert.ok(r.choices[0]!.length <= QUIZ_CHOICE_MOST);
  assert.equal(r.answer, r.choices[0]);
  assert.deepEqual(r.trims.map((t) => t.path), ['choices[0]']);
});

test('choices are trimmed of whitespace, the answer compared after the same trim', () => {
  const r = ok({ ...good, choices: [' Odyssey ', 'Sunshine\n'], answer: 'Odyssey ' });
  assert.deepEqual(r.choices, ['Odyssey', 'Sunshine']);
  assert.equal(r.answer, 'Odyssey');
  assert.ok(r.trims.some((t) => t.predicate === 'trimmed'));
});

test('exact duplicate choices are merged', () => {
  const r = ok({ ...good, choices: ['Odyssey', 'Sunshine', 'Odyssey'] });
  assert.deepEqual(r.choices, ['Odyssey', 'Sunshine']);
  assert.ok(r.trims.some((t) => t.predicate === 'distinct'));
});

test('a fifth and later choice is dropped when the answer is among the first four', () => {
  const r = ok({ ...good, choices: ['a', 'b', 'c', 'd', 'e', 'f'], answer: 'b' });
  assert.deepEqual(r.choices, ['a', 'b', 'c', 'd']);
  assert.ok(r.trims.some((t) => t.predicate === 'choicesMost'));
});

test('when the answer is past the fourth, the extra choices other than the answer are dropped from the end', () => {
  const r = ok({ ...good, choices: ['a', 'b', 'c', 'd', 'e', 'f'], answer: 'e' });
  assert.deepEqual(r.choices, ['a', 'b', 'c', 'e']);
  assert.equal(r.answer, 'e');
});

test('each rejection names its predicate', () => {
  assert.match(why('nope'), /shape/);
  assert.match(why({ ...good, choices: 'a' }), /shape/);
  assert.match(why({ question: 'Q?', choices: ['a', 'b'] }), /shape/);
  assert.match(why({ ...good, question: '   ' }), /question/);
  assert.match(why({ ...good, choices: ['Odyssey', ' Odyssey'], answer: 'Odyssey' }), /fewer than two/);
  assert.match(why({ ...good, choices: ['Odyssey'], answer: 'Odyssey' }), /fewer than two/);
  assert.match(why({ ...good, answer: 'Mario Party' }), /answer.*not one of the choices/);
});
