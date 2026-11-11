/** `kindsOf`: the card kinds of a post's plays, in the order each first appears in billing (marks-and-the-lens design, section 1). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { backWords, CAUGHT_STATE, caughtWords, endedWords, endsWords, kindsOf, MARKS_NARROW, MARKS_WIDE, utcDate, gimmickWords } from './marks.ts';
import { dayAndTime } from '../characters/format.ts';
/* The reader's zone, as the words say a date: pinned, so 02:00 UTC on Oct 30 is still Oct 29 here. */
process.env.TZ = 'America/Los_Angeles';
const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
import { wordsProblems } from './lens-words.ts';
import type { CardPlay } from './types.ts';

const play = (id: string, card: string): CardPlay => ({ id, card, layer: 1, caster: null, message: '', config: {}, playedAt: '2026-10-29T12:00:00Z', post: 'p' });

describe('kindsOf', () => {
  test('orders kinds by the first play of each in billing, one entry per kind', () => {
    assert.deepEqual(kindsOf([play('a', 'whoops'), play('b', 'stick'), play('c', 'whoops'), play('d', 'grab'), play('e', 'stick')]), ['whoops', 'stick', 'grab']);
  });
  test('is empty for no plays, and does not reorder a kind by a later play of it', () => {
    assert.deepEqual(kindsOf([]), []);
    assert.deepEqual(kindsOf([play('a', 'b'), play('b', 'a'), play('c', 'b')]), ['b', 'a']);
  });
});

test('a strip draws four marks on a desktop and three on a phone', () => {
  assert.equal(MARKS_WIDE, 4);
  assert.equal(MARKS_NARROW, 2);
});

/* The card mechanic's marks (docs/plans/2026-11-01-card-plays-plan.md, Task 7). */
describe('a card back, a ward and a caught play, in words', () => {
  const back = (over: Partial<CardPlay> = {}): CardPlay => ({ ...play('s1', 'kb:card-back'), caster: 'c', faceDown: true, playedAt: '2026-10-29T12:00:00.000Z', ...over });
  const setLasts = { unit: 'day' as const, count: 7 };
  const day = (iso: string) => utcDate(iso);

  test('a back says "Face down on this post", the engine\'s own words; who set it and when is its note, and when it ends its way out, the same for any card to any reader but the setter', () => {
    const words = backWords(back(), 'PIPEWRENCH', setLasts, () => 'Card Collector');
    assert.deepEqual(words, { name: 'A card set face down by PIPEWRENCH', state: 'Face down on this post', note: `Set face down by PIPEWRENCH on ${localDate('2026-10-29T12:00:00.000Z')}.`, ends: `${endsWords('2026-11-05T12:00:00.000Z')}, unless it springs first.` });
    assert.deepEqual(wordsProblems('state', words.state), []);
    assert.deepEqual(backWords(back(), 'PIPEWRENCH', setLasts, () => 'Hall Pass'), words, 'the card behind it changes nothing');
  });

  test('a back that sprang names its card, which is public from then', () => {
    const words = backWords(back({ revealed: { card: 'card-collector', spring: 'sp', at: '2026-10-30T02:00:00.000Z' } }), 'PIPEWRENCH', setLasts, () => 'Card Collector');
    assert.deepEqual(words, { name: 'Card Collector, set face down by PIPEWRENCH', state: `Sprang on ${localDate('2026-10-30T02:00:00.000Z')}`, note: 'A Card Collector set face down by PIPEWRENCH.', ends: 'It has sprung, and ended.' });
    assert.deepEqual(wordsProblems('state', words.state), []);
  });

  test('every Gimmick says what it does and when it ends', () => {
    const now = new Date('2026-11-01T00:00:00.000Z');
    const end = '2026-11-06T10:00:00.000Z';
    assert.deepEqual(gimmickWords({ kind: 'ward', upTo: 'uncommon' }, end, now), { state: 'Turning away cards up to uncommon', ends: `Ends ${dayAndTime(end)}` });
    assert.deepEqual(gimmickWords({ kind: 'ward', flavors: ['salty', 'sweet'] }, end, now), { state: 'Turning away Salty and Sweet cards', ends: `Ends ${dayAndTime(end)}` });
    assert.deepEqual(gimmickWords({ kind: 'price', flavors: ['salty'], add: 25 }, end, now), { state: 'Salty cards cost 0.25 more here', ends: `Ends ${dayAndTime(end)}` });
    assert.deepEqual(gimmickWords({ kind: 'earn', by: 0.1 }, end, now), { state: 'Earns 10% more from some reactions', ends: `Ends ${dayAndTime(end)}` });
    for (const effect of [{ kind: 'ward', upTo: 'uncommon' }, { kind: 'price', flavors: ['salty'], add: 25 }, { kind: 'earn', by: 0.1 }] as const) {
      assert.deepEqual(wordsProblems('state', gimmickWords(effect, undefined).state), [], effect.kind);
      assert.deepEqual(gimmickWords(effect, '2026-10-31T10:00:00.000Z', now), { state: 'Ended, changing nothing', ends: `Ended ${dayAndTime('2026-10-31T10:00:00.000Z')}` }, effect.kind);
    }
  });

  test('a back taken back says so, and names no card', () => {
    const words = backWords(back({ takenBack: { at: '2026-10-30T02:00:00.000Z' } }), 'PIPEWRENCH', setLasts, () => 'never asked');
    assert.deepEqual(words, { name: 'A card set face down by PIPEWRENCH', state: `Taken back on ${localDate('2026-10-30T02:00:00.000Z')}`, note: `Set face down by PIPEWRENCH on ${localDate(back({}).playedAt)}, and taken back.`, ends: 'It was taken back, and ended.' });
    assert.deepEqual(wordsProblems('state', words.state), []);
  });

  test('a caught play says what caught it', () => {
    assert.equal(caughtWords('Trap Card'), 'Caught by a Trap Card. It did nothing.');
    assert.equal(caughtWords('Trap Card', {}), 'Caught by a Trap Card. It did nothing, and its card is spent.');
    assert.equal(caughtWords('Trap Card', { taken: 'Pipewrench' }), 'Caught by a Trap Card. It did nothing, and its card went to Pipewrench.');
    assert.equal(caughtWords(null), 'Caught by a trap. It did nothing.');
    assert.deepEqual(wordsProblems('state', CAUGHT_STATE), []);
    assert.equal(CAUGHT_STATE, 'Caught, did nothing');
  });
});

describe('endedWords', () => {
  test('says an admin ended the play, in plain words', () => {
    assert.equal(endedWords(), 'Ended by an admin');
  });
});
