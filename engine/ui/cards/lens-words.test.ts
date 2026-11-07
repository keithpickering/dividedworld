/**
 * The checks on the Lens's words (backfill-boards plan, Task 9; design section 6), each driven red on the defect it exists to
 * catch: Stick Around's old state (a sentence that describes the card and its way out), a status of eight words, and a view
 * that covers the post or holds the reader with no way out.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { viewProblems, wordsProblems, STATUS_MAX_WORDS } from './lens-words.ts';
import type { CardView } from './types.ts';

const view = (over: Partial<CardView> = {}): CardView => ({ progress: null, state: 'Holding you on this post', yours: false, controls: [], notes: {}, ...over });

describe('a state or status is a short status, never a sentence', () => {
  test("Stick Around's old state, a sentence that describes the card and how it ends, is refused by name", () => {
    const old = "Holds you on this post until you check the caster's sentence, or break free for this visit";
    assert.match(wordsProblems('state', old).join('\n'), /state .* is 17 words, over the 6/u);
    assert.match(wordsProblems('state', 'It never holds you: you wrote this post').join('\n'), /state .* is a sentence/u);
  });
  test('a status of eight words is refused for its length, and names the predicate', () => {
    const eight = 'Turning away every card up to the rarity';
    assert.equal(eight.split(' ').length, 8);
    assert.deepEqual(wordsProblems('status', eight), [`the status "${eight}" is 8 words, over the ${STATUS_MAX_WORDS} a status may run`]);
  });
  test('a stop followed by more words, or a colon, is a sentence', () => {
    assert.equal(wordsProblems('status', 'Done. Moving on').length, 1);
    assert.equal(wordsProblems('status', 'Wow! Look').length, 1);
    assert.equal(wordsProblems('status', 'Why? Now').length, 1);
    assert.equal(wordsProblems('status', 'Top: yellow').length, 1);
  });
  test('the drafted words pass', () => {
    for (const ok of ['Holding you on this post', 'Not holding you · you wrote it', 'Not holding you · you played it', 'Done holding you', 'Broke free this visit', '41% washed for you', '3 strips, 1 peeled', 'Turning away cards up to uncommon', 'Sparkling every post by that character', "Pinned to its board's top", '2 of 3 stacked', 'Set, face down to everyone else', 'Face down on this post', 'Washed clean', 'Ended by an admin']) {
      assert.deepEqual(wordsProblems('state', ok), [], ok);
    }
    assert.deepEqual(wordsProblems('state', 'Washed clean.'), []);
  });
  test('nothing at all is refused', () => {
    assert.deepEqual(wordsProblems('state', '  '), ['the state is empty']);
  });
});

describe('a view that holds the reader or covers the post names its way out', () => {
  test('a covering view with no ends is refused by name', () => {
    assert.deepEqual(viewProblems(view(), { holds: false, covers: true }), ['the view "Holding you on this post" covers the post and has no ends, its way out']);
  });
  test('a holding view with no ends is refused by name', () => {
    assert.deepEqual(viewProblems(view(), { holds: true, covers: false }), ['the view "Holding you on this post" holds the reader and has no ends, its way out']);
  });
  test('an empty ends is no way out', () => {
    assert.equal(viewProblems(view({ ends: ' ' }), { holds: true, covers: false }).length, 1);
  });
  test('with an ends it passes; a view that neither holds nor covers needs none', () => {
    assert.deepEqual(viewProblems(view({ ends: 'Ends when you press Break free.' }), { holds: true, covers: true }), []);
    assert.deepEqual(viewProblems(view({ state: 'Done holding you' }), { holds: false, covers: false }), []);
  });
  test("the view's own state is checked too", () => {
    assert.equal(viewProblems(view({ state: 'Top: yellow', ends: 'x' }), { holds: true, covers: false }).length, 1);
  });
});
