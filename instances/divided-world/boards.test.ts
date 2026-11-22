import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instance } from './index.ts';

// The launch design, section 3: the boards the instance seeds, in the order the index shows them (each is made a microsecond after the one before it).
test('the boards are the launch design\'s seven, in its order, and only Staff Announcements is a system board', () => {
  assert.deepEqual(instance.boards.map((b) => b.slug), ['general', 'video-games', 'movies-tv', 'arts-crafts', 'help', 'pointless-post-palace', 'announcements']);
  assert.deepEqual(instance.boards.filter((b) => b.system).map((b) => b.slug), ['announcements']);
  assert.deepEqual(instance.boards.map((b) => [b.name, b.description]), [
    ['General', 'Anything and everything. The staff are watching.'],
    ['Video Games', 'Talk about the games you\'re playing.'],
    ['Movies & TV', 'What you watched, what you\'re watching, and what you wish you hadn\'t.'],
    ['Arts & Crafts', 'Show off what you made: sprites, drawings, music, writing, anything.'],
    ['Help', 'Stuck on something? Ask here.'],
    ['Pointless Post Palace', 'Post about nothing. The more pointless, the better.'],
    ['Staff Announcements', 'Where the staff post. Reply by spinning a thread.'],
  ]);
});
