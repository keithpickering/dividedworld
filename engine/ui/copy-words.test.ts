/** `shareWords`: a share of a vote, in words, for a card's payout (Mooch's 0.1, Toll's 0.5, 4D Chess's 1). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { shareWords } from './copy-words.ts';

describe('a share of a vote, in words', () => {
  test('says the shares a card pays plainly: a vote, half a vote, a tenth of a vote', () => {
    assert.equal(shareWords(1), 'a vote');
    assert.equal(shareWords(0.5), 'half a vote');
    assert.equal(shareWords(0.1), 'a tenth of a vote');
  });
  test('says a share it has no word for as a percent, and a larger one as votes, so a retuned card is still said true', () => {
    assert.equal(shareWords(0.25), 'a quarter of a vote');
    assert.equal(shareWords(0.2), 'a fifth of a vote');
    assert.equal(shareWords(0.15), '15% of a vote');
    assert.equal(shareWords(2), '2 votes');
    assert.equal(shareWords(1.5), '1.5 votes');
  });
});
