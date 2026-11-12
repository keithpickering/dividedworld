import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenCounter } from './tokens.ts';

// Golden counts for test 2 were produced once by Python's `tokenizers` (0.23.3), loading the very files
// that bpe.json was built from (openai-community/gpt2 `vocab.json` and `merges.txt`). Nothing here is derived
// from this repository's own counter. To produce them again:
//
//   python3 -m venv venv && venv/bin/pip install tokenizers
//   curl -sSLO https://huggingface.co/openai-community/gpt2/resolve/main/vocab.json
//   curl -sSLO https://huggingface.co/openai-community/gpt2/resolve/main/merges.txt
//   venv/bin/python -I -c "
//   from tokenizers import ByteLevelBPETokenizer
//   t = ByteLevelBPETokenizer('vocab.json', 'merges.txt')
//   for s in STRINGS: print(len(t.encode(s).ids))   # STRINGS: the table's strings below, in order
//   print(t.encode('hello world').ids)              # [31373, 995]
//   "
const GOLDEN: ReadonlyArray<readonly [name: string, text: string, tokens: number]> = [
  ['English', 'The quick brown fox jumps over the lazy dog.', 10],
  ['a run of spaces', 'a' + ' '.repeat(12) + 'b', 13],
  ['a URL', 'See https://example.com/a/b?c=d&e=f#frag for details.', 24],
  ['BBCode', '[quote="Ada"][b]Hello[/b] [i]there[/i][/quote][url=https://dw.gripe]link[/url]', 37],
  ['an emoji with a skin tone', 'Thumbs up \u{1F44D}\u{1F3FD} done', 9],
  ['CJK', '今日はいい天気ですね。世界を分ける', 25],
  ['Cyrillic', 'Привет, мир! Как дела?', 23],
  ['digits', 'Call 555-0199 or 1234567890 at 3.14159', 15],
  ["'s and contractions", "It's Ada's, they're sure we'll say I'd've", 14],
  ['a newline run', 'one\n\n\n\ntwo\r\n\r\nthree\n', 11],
  ['leading and trailing space', '  padded text  ', 5],
  ['punctuation and symbols', '!!! ??? ... --- ### $$$ @user #tag', 11],
  ['a 2,000-character post', 'The System decides; a post is never lost. '.repeat(50).slice(0, 2000), 476],
];

test('gpt2 counts "hello world" as 2 (ids 31373 and 995) and the empty string as 0', () => {
  const count = tokenCounter('gpt2');
  assert.equal(count('hello world'), 2);
  assert.equal(count(''), 0);
});

test('gpt2 matches the reference tokenizer on a table of golden counts', () => {
  const count = tokenCounter('gpt2');
  assert.ok(GOLDEN.length >= 12);
  for (const [name, text, tokens] of GOLDEN) assert.equal(count(text), tokens, name);
  assert.equal(GOLDEN[GOLDEN.length - 1]![1].length, 2000);
});

test('bytes is the UTF-8 length, a lone surrogate counting as the replacement character', () => {
  const count = tokenCounter('bytes');
  assert.equal(count(''), 0);
  assert.equal(count('abc'), 3);
  assert.equal(count('é'), 2);
  assert.equal(count('今'), 3);
  assert.equal(count('\u{1F44D}'), 4);
  assert.equal(count('\ud83d'), 3);
  assert.equal(count('\udc4d'), 3);
  assert.equal(count('a\ud83db'), 5);
});

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARTS = [
  'hello', ' world', ' ', '  ', '\n', "'s", '123', '.', '!', '[b]', 'https://x.test/a', '今日', 'Привет',
  'αβγ', 'שלום', '\u{1F44D}\u{1F3FD}', '\u{1F600}', 'é', '\ud83d', '\udc4d', '\u0000', '‍',
];

test('gpt2 never counts more than bytes, over 500 seeded random strings', () => {
  const gpt2 = tokenCounter('gpt2');
  const bytes = tokenCounter('bytes');
  const rand = seeded(20261112);
  for (let i = 0; i < 500; i++) {
    let text = '';
    const n = 1 + Math.floor(rand() * 40);
    for (let j = 0; j < n; j++) text += PARTS[Math.floor(rand() * PARTS.length)]!;
    assert.ok(gpt2(text) <= bytes(text), `string ${i}: ${gpt2(text)} > ${bytes(text)}`);
  }
});

test('a text of 100,000 characters is counted in under a second', () => {
  const gpt2 = tokenCounter('gpt2');
  const rand = seeded(7);
  let text = '';
  while (text.length < 100_000) {
    let word = '';
    for (let k = 1 + Math.floor(rand() * 9); k > 0; k--) word += String.fromCharCode(97 + Math.floor(rand() * 26));
    text += word + (rand() < 0.1 ? '.\n' : ' ');
  }
  text = text.slice(0, 100_000);
  const t0 = performance.now();
  const n = gpt2(text);
  const ms = performance.now() - t0;
  console.log(`100,000 characters: ${n} tokens in ${ms.toFixed(0)} ms`);
  assert.ok(n > 0);
  assert.ok(ms < 1000, `${ms} ms`);
});
