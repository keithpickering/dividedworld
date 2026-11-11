import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demandNeeds, endedWords, moveLabel, moveParts, wayOut } from './move-words.ts';
import { moveKind } from '../../system/moves.ts';

const board = '11111111-1111-4111-8111-111111111111';
const demand = { kind: 'distinctCharactersOnBoard', params: { board, count: 12 } };
const local = (m: number, d: number) => new Date(2026, m, d, 12).toISOString();

test('the long label comes from the move kind\'s catalog entry, and an unknown kind is still said plainly', () => {
  assert.equal(moveLabel('renameBoard', 'The Boss'), 'The Boss renamed this board');
  assert.equal(moveLabel('nameSuccessor', 'The Boss'), 'The Boss named its successor');
  assert.equal(moveLabel('renameBoard', 'The Director'), 'The Director renamed this board');
  assert.equal(moveLabel('shout', 'The Boss'), 'The Boss made a move');
});

test('the way out says the count and what is counted, in the singular for one, and never guesses at a demand it cannot read', () => {
  assert.equal(wayOut(demand, { done: 7, of: 12, met: false, checkedAt: '2026-11-01T14:05:00+00:00' }, null), 'WAY OUT: 7 OF 12 POSTERS');
  assert.equal(wayOut({ kind: 'characterPostsInThread', params: {} }, { done: 0, of: 1, met: false, checkedAt: '2026-11-01T14:05:00+00:00' }, null), 'WAY OUT: 0 OF 1 POST');
  assert.equal(wayOut(demand, { done: 0, of: 0, met: false, error: '22023', checkedAt: '2026-11-01T14:05:00+00:00' }, null), 'WAY OUT: DETAILS');
  assert.equal(wayOut({ kind: 'shout', params: {} }, { done: 1, of: 2, met: false, checkedAt: '2026-11-01T14:05:00+00:00' }, null), 'WAY OUT: DETAILS');
  // A demand the tick has not counted yet shows no number.
  assert.equal(wayOut(demand, { done: 0, of: 0, met: false, checkedAt: null }, null), 'WAY OUT: DETAILS');
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

test('a handover reads plainly: a move set aside or never reviewed ended at the handover, a nomination was used up, and a kept move says who keeps it', () => {
  assert.equal(endedWords({ why: 'superseded', by: 'boss', at: local(9, 31) }, demand), 'ended at the handover');
  assert.equal(endedWords({ why: 'superseded', by: 'inheritance', at: local(9, 31) }, null), 'ended at the handover');
  assert.equal(endedWords({ why: 'spent', by: 'handover', at: local(9, 31) }, null), 'used up at the handover');
  assert.equal(endedWords(null, demand, 'The Clerk'), 'in force, kept by The Clerk');
  assert.equal(endedWords({ why: 'expired', by: 'tick', at: local(9, 31) }, demand, 'The Clerk'), 'ran out Oct 31, kept by The Clerk');
  assert.equal(endedWords(null, demand, null), 'in force');
  assert.deepEqual(moveParts('nameSuccessor', { boss: 'the-clerk' }, 'The Clerk', 'plan'), ['Name ', 'The Clerk', ' as the next Boss']);
  assert.match(demandNeeds(null, 'nameSuccessor'), /ends at the handover/u);
});

test('a move is a sentence in pieces, and a move this build has no words for is named', () => {
  assert.deepEqual(moveParts('renameBoard', { board, name: 'Toast' }, 'General', 'done'), ['Renamed ', { board, name: 'General' }, ' to ', { board, name: 'Toast' }]);
  assert.match(String(moveParts('shout', {}, null, 'plan')[0]), /no words for \(shout\)/u);
  assert.equal(demandNeeds(demand), 'Needs 12 different characters to post on this board.');
  assert.match(demandNeeds(null), /asks nothing/u);
});

test('a stripped, apologized and overturned move each say so plainly', () => {
  assert.equal(endedWords({ why: 'unmet', by: 'tick', at: local(9, 31) }, null), 'Stripped: the demand was not met by its check');
  assert.equal(endedWords({ why: 'met', by: 'tick', at: local(9, 31) }, { kind: 'apologyAccepted', params: {} }), 'Ended: an apology was accepted');
  assert.equal(endedWords({ why: 'overturned', by: 'admin', at: local(9, 31) }, null), 'Ended: overturned on appeal');
});

test('a thread move names the thread and both boards by their current names, in plain words', () => {
  const thread = '22222222-2222-4222-8222-222222222222';
  const to = '33333333-3333-4333-8333-333333333333';
  const names = { thread: 'Best bread', from: 'General', board: 'Toast Corner' };
  assert.deepEqual(moveParts('moveThread', { thread, board: to }, null, 'done', names), ['Moved Best bread from ', { board: '', name: 'General' }, ' to ', { board: to, name: 'Toast Corner' }]);
  assert.deepEqual(moveParts('moveThread', { thread, board: to }, null, 'plan', names), ['Move Best bread from ', { board: '', name: 'General' }, ' to ', { board: to, name: 'Toast Corner' }]);
  // Without the thread's or the first board's name the sentence still says what it can, plainly.
  assert.deepEqual(moveParts('moveThread', { thread, board: to }, null, 'done', { board: 'Toast Corner' }), ['Moved a thread to ', { board: to, name: 'Toast Corner' }]);
  assert.match(moveKind('moveThread')!.template({ thread, board: to }, 'The System', names), /^The System moved Best bread from General to Toast Corner\. /u);
  assert.equal(moveKind('moveThread')!.template({ thread, board: to }, 'The Boss', { board: 'Toast Corner' }), 'The Boss moved a thread to Toast Corner. Nothing in the thread was changed; the board it left lists where it went for a few days.');
});

test('a board made and a board merged read as plain sentences naming the boards', () => {
  const from = '44444444-4444-4444-8444-444444444444';
  const into = '55555555-5555-4555-8555-555555555555';
  assert.deepEqual(moveParts('createBoard', { name: 'Minus World', premise: 'p', description: 'd' }, null, 'plan'), ['Create a board named "Minus World"']);
  assert.deepEqual(moveParts('createBoard', { name: 'Minus World', premise: 'p', description: 'd' }, null, 'done'), ['Created a board named "Minus World"']);
  assert.deepEqual(moveParts('mergeBoard', { board: from, into }, 'Off Topic', 'plan', { board: 'General' }), ['Merge ', { board: from, name: 'Off Topic' }, ' into ', { board: into, name: 'General' }]);
  assert.equal(moveKind('mergeBoard')!.template({ board: from, into }, 'The System', { from: 'Off Topic', board: 'General' }), 'The System merged Off Topic into General. Its threads moved with it, and the board is closed.');
  assert.equal(moveKind('createBoard')!.template({ name: 'Minus World', premise: 'Glitches.', description: 'd' }, 'The System'), 'The System made a board named "Minus World". Its subject is: Glitches.');
});

test('a move that lasts says what it asks plainly: nothing, and no expiry', () => {
  assert.match(demandNeeds(null, 'createBoard'), /does not run out/u);
  assert.match(demandNeeds(null, 'mergeBoard'), /does not run out/u);
  assert.match(demandNeeds(null, 'moveThread'), /does not run out/u);
});
