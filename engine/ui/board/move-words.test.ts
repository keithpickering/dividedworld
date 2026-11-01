import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demandNeeds, endedWords, moveLabel, moveParts, wayOut } from './move-words.ts';

const board = '11111111-1111-4111-8111-111111111111';
const demand = { kind: 'distinctCharactersOnBoard', params: { board, count: 12 } };
const local = (m: number, d: number) => new Date(2026, m, d, 12).toISOString();

test('the long label comes from the move kind\'s catalog entry, and an unknown kind is still said plainly', () => {
  assert.equal(moveLabel('renameBoard'), 'THE SYSTEM RENAMED THIS BOARD');
  assert.equal(moveLabel('shout'), 'THE SYSTEM MADE A MOVE');
});

test('the way out says the count and what is counted, in the singular for one, and never guesses at a demand it cannot read', () => {
  assert.equal(wayOut(demand, { done: 7, of: 12, met: false }, null), 'WAY OUT: 7 OF 12 POSTERS');
  assert.equal(wayOut({ kind: 'characterPostsInThread', params: {} }, { done: 0, of: 1, met: false }, null), 'WAY OUT: 0 OF 1 POST');
  assert.equal(wayOut(demand, { done: 0, of: 0, met: false, error: '22023' }, null), 'WAY OUT: DETAILS');
  assert.equal(wayOut({ kind: 'shout', params: {} }, { done: 1, of: 2, met: false }, null), 'WAY OUT: DETAILS');
  assert.equal(wayOut(null, null, local(10, 13)), 'WAY OUT: RUNS OUT NOV 13');
  assert.equal(wayOut(null, null, null), 'WAY OUT: DETAILS');
});

test('how a move ended reads in a few plain words', () => {
  assert.equal(endedWords(null, demand), 'in force');
  assert.equal(endedWords({ why: 'met', by: 'tick', at: local(9, 29) }, demand), 'undone: 12 posted');
  assert.equal(endedWords({ why: 'met', by: 'tick', at: local(9, 29) }, null), 'undone: its demand was met');
  assert.equal(endedWords({ why: 'expired', by: 'tick', at: local(9, 31) }, demand), 'ran out Oct 31');
  assert.equal(endedWords({ why: 'reversed', by: 'admin', at: local(9, 31) }, demand), 'reversed by an admin');
});

test('a move is a sentence in pieces, and a move this build has no words for is named', () => {
  assert.deepEqual(moveParts('renameBoard', { board, name: 'Toast' }, 'General', 'done'), ['Renamed ', { board, name: 'General' }, ' to ', { board, name: 'Toast' }]);
  assert.match(String(moveParts('shout', {}, null, 'plan')[0]), /no words for \(shout\)/u);
  assert.equal(demandNeeds(demand), 'Needs 12 different characters to post on this board.');
  assert.match(demandNeeds(null), /asks nothing/u);
});
