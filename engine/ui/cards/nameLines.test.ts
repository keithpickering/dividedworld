/**
 * A card name's lines (nameLines.ts): a long name with a space breaks once at the balanced word boundary; anything else stays one line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_WRAP_AT, nameLines } from './nameLines.ts';

test('a long name with a space breaks once, at the balanced word boundary', () => {
  assert.deepEqual(nameLines('You Were Saying?'), { lines: ['You Were', 'Saying?'], longest: 8 });
});

test('a name up to the threshold stays one line', () => {
  assert.equal(NAME_WRAP_AT, 14);
  assert.deepEqual(nameLines('Glitter Bomb'), { lines: ['Glitter Bomb'], longest: 12 });
  const edge = `${'x'.repeat(10)} abc`;
  assert.deepEqual(nameLines(edge), { lines: [edge], longest: 14 });
});

test('a long single word has nowhere to break and stays one line', () => {
  assert.deepEqual(nameLines('Supercalifragil'), { lines: ['Supercalifragil'], longest: 15 });
});

test('three words split where the longer line is shortest', () => {
  assert.deepEqual(nameLines('Aa Bbbbbbbbb Cc Dd'), { lines: ['Aa Bbbbbbbbb', 'Cc Dd'], longest: 12 });
  assert.deepEqual(nameLines('Big Tiny Enormously'), { lines: ['Big Tiny', 'Enormously'], longest: 10 });
});

test('leading, trailing and repeated spaces never make an empty or padded line', () => {
  assert.deepEqual(nameLines('  You   Were   Saying?  '), { lines: ['You Were', 'Saying?'], longest: 8 });
});

test('the two lines read back as the name, one space between', () => {
  const { lines } = nameLines('Dramatic Exit Strategy');
  assert.equal(lines.join(' '), 'Dramatic Exit Strategy');
  assert.equal(lines.length, 2);
});
