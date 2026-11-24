/**
 * The words and the link of a spun thread's origin place: one row for each line of the table in
 * docs/plans/2026-11-04-origin-place-design.md, section 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OriginPlace } from '../data/api.ts';
import { placeHref, placeParts, placeWords } from './place.ts';

const names: Record<string, string> = { whoops: 'Whoops!' };
const cardName = (key: string) => names[key];
const groupName = (key: string) => (key === 'trial' ? 'Trial Members' : undefined);
const post = { kind: 'post', thread: 't1', title: 'Title', seq: 12 } as const;
const update = { kind: 'update', act: 'a 1', title: 'Headline' } as const;

const rows: readonly (readonly [string, OriginPlace, string, string | null])[] = [
  ['an Act with a place number', post, '#12 in Title', '/t/t1?page=1#post-12'],
  ['a face-up play on a post', { kind: 'play', card: 'whoops', on: post, from: null, at: null }, 'Whoops! on #12 in Title', '/t/t1?page=1#post-12'],
  ['a face-down set on a post', { kind: 'play', card: null, on: post, from: null, at: null }, 'a face-down card on #12 in Title', '/t/t1?page=1#post-12'],
  ['an update', update, 'the update “Headline”', '/updates?update=a%201'],
  ['a play on an update', { kind: 'play', card: 'whoops', on: update, from: null, at: null }, 'Whoops! on the update “Headline”', '/updates?update=a%201'],
  ['a play on a character', { kind: 'play', card: 'whoops', on: { kind: 'character', id: 'c/1', name: 'Mario Mask' }, from: null, at: null }, 'Whoops! on Mario Mask', '/c/c%2F1'],
  ['a play on a character with no name', { kind: 'play', card: 'whoops', on: { kind: 'character', id: 'c1', name: null }, from: null, at: null }, 'Whoops! on a character', '/c/c1'],
  ['a play on a thread', { kind: 'play', card: 'whoops', on: { kind: 'thread', id: 't2', title: 'Other' }, from: null, at: null }, 'Whoops! on the thread Other', '/t/t2?page=1'],
  ['a play on a board', { kind: 'play', card: 'whoops', on: { kind: 'board', slug: 'gen eral', name: 'General' }, from: null, at: null }, 'Whoops! on the board General', '/b/gen%20eral'],
  ['a play that cannot be placed', { kind: 'play', card: 'whoops', on: null, from: null, at: null }, 'Whoops!', null],
  ['a face-down play that cannot be placed', { kind: 'play', card: null, on: null, from: null, at: null }, 'a face-down card', null],
  ['a poll', { kind: 'poll', question: 'Best kart in the series?', on: post }, 'the poll “Best kart in the series?” on #12 in Title', '/t/t1?page=1#post-12'],
  ['a poll whose question is cut at 60 characters', { kind: 'poll', question: 'Q'.repeat(70), on: post }, `the poll “${'Q'.repeat(60)}…” on #12 in Title`, '/t/t1?page=1#post-12'],
  ['a public ballot', { kind: 'ballot', character: { id: 'c1', name: 'Wario' }, question: 'Best kart?', on: post }, 'Wario\'s ballot in the poll “Best kart?” on #12 in Title', '/t/t1?page=1#post-12'],
  ['a card the instance no longer has', { kind: 'play', card: 'gone', on: post, from: null, at: null }, 'a card on #12 in Title', '/t/t1?page=1#post-12'],
];

for (const [name, place, words, href] of rows) {
  test(`placeWords and placeHref: ${name}`, () => {
    assert.equal(placeWords(place, cardName, groupName), words);
    assert.equal(placeHref(place, 20), href);
  });
}

test('a post lands on the page that holds its place number', () => {
  assert.equal(placeHref({ ...post, seq: 45 }, 20), '/t/t1?page=3#post-45');
  assert.equal(placeHref({ kind: 'play', card: 'whoops', on: { ...post, seq: 45 }, from: null, at: null }, 20), '/t/t1?page=3#post-45');
});

const pressed = { kind: 'post', thread: 't9', title: 'Why are my posts shiny', seq: 31 } as const;
const castFrom = { kind: 'post', thread: 't1', title: 'Title', seq: 12 } as const;
const onWario = { kind: 'character', id: 'c/w', name: 'Wario' } as const;
const glint = (extra: { at: typeof pressed | null; from: typeof castFrom | null }): OriginPlace => ({ kind: 'play', card: 'glint', on: onWario, ...extra });
const glintName = (key: string) => (key === 'glint' ? 'Glitter Bomb' : undefined);

test('placeParts: a play on a character with a pressed post says the card, the name, and where it was pressed', () => {
  assert.deepEqual(placeParts(glint({ at: pressed, from: castFrom }), glintName, groupName, 20), [
    { words: 'Glitter Bomb on ', href: null },
    { words: 'Wario', href: '/c/c%2Fw', character: 'c/w' },
    { words: ', at ', href: null },
    { words: '#31 in Why are my posts shiny', href: '/t/t9?page=2#post-31' },
  ]);
});

test('placeParts: a play on a character with only a cast-from post says where it was cast from', () => {
  assert.deepEqual(placeParts(glint({ at: null, from: castFrom }), glintName, groupName, 20), [
    { words: 'Glitter Bomb on ', href: null },
    { words: 'Wario', href: '/c/c%2Fw', character: 'c/w' },
    { words: ', cast from ', href: null },
    { words: '#12 in Title', href: '/t/t1?page=1#post-12' },
  ]);
});

test('placeParts: a play on a character with neither post is the card and the name alone (an older server)', () => {
  assert.deepEqual(placeParts(glint({ at: null, from: null }), glintName, groupName, 20), [
    { words: 'Glitter Bomb on ', href: null },
    { words: 'Wario', href: '/c/c%2Fw', character: 'c/w' },
  ]);
  assert.deepEqual(placeParts({ kind: 'play', card: 'glint', on: { kind: 'character', id: 'c1', name: null }, from: null, at: null }, glintName, groupName, 20)[1], { words: 'a character', href: '/c/c1', character: 'c1' });
});

for (const [name, place, words, href] of rows) {
  if (place.kind === 'play' && place.on?.kind === 'character') continue;
  test(`placeParts: ${name} is one part with today's words and address`, () => {
    assert.deepEqual(placeParts(place, cardName, groupName, 20), [{ words, href }]);
  });
}

test('placeWords and placeHref read placeParts: the whole phrase as words, and the first place it goes', () => {
  assert.equal(placeWords(glint({ at: pressed, from: castFrom }), glintName, groupName), 'Glitter Bomb on Wario, at #31 in Why are my posts shiny');
  assert.equal(placeWords(glint({ at: null, from: castFrom }), glintName, groupName), 'Glitter Bomb on Wario, cast from #12 in Title');
  assert.equal(placeHref(glint({ at: pressed, from: castFrom }), 20), '/c/c%2Fw');
});

test('placeParts: a face-down card and a key the instance lacks never name a card on a character either', () => {
  const on = (card: string | null) => placeParts({ kind: 'play', card, on: onWario, from: null, at: pressed }, glintName, groupName, 20)[0];
  assert.deepEqual(on(null), { words: 'a face-down card on ', href: null });
  assert.deepEqual(on('gone'), { words: 'a card on ', href: null });
});

test('placeParts: a poll and a ballot are one link to the poll\'s post, the words never split', () => {
  assert.deepEqual(placeParts({ kind: 'poll', question: 'Q?', on: post }, cardName, groupName, 20), [{ words: 'the poll “Q?” on #12 in Title', href: '/t/t1?page=1#post-12' }]);
  assert.equal(placeParts({ kind: 'ballot', character: { id: 'c1', name: 'Wario' }, question: 'Q?', on: post }, cardName, groupName, 20).length, 1);
});

test('the 60-character cut counts characters, never half a surrogate pair', () => {
  const words = placeWords({ kind: 'poll', question: '😀'.repeat(61), on: post }, cardName, groupName);
  assert.equal(words, `the poll “${'😀'.repeat(60)}…” on #12 in Title`);
});

const kassie = { id: 'c/k', name: 'Kassie' } as const;
const wario = { id: 'c/w', name: 'Wario' } as const;
const line = { kind: 'post', thread: 't3', title: 'Member moves', seq: 4 } as const;
const answer = (extra: Partial<Extract<OriginPlace, { kind: 'answer' }>>): OriginPlace =>
  ({ kind: 'answer', spun: 'answer', ask: 'report', asker: wario, staff: kassie, punishment: null, group: null, on: post, ...extra });
const who = (c: { id: string; name: string }, href = `/c/${encodeURIComponent(c.id)}`) => ({ words: c.name, href, character: c.id });
const plain = (words: string) => ({ words, href: null });
const postPart = { words: '#12 in Title', href: '/t/t1?page=1#post-12' };

const answerRows: readonly (readonly [string, OriginPlace, readonly object[], string, string | null])[] = [
  ['an answer to a report', answer({}), [who(kassie), plain("'s verdict on "), who(wario), plain("'s report of "), postPart],
    "Kassie's verdict on Wario's report of #12 in Title", '/c/c%2Fk'],
  ['an ask, a report', answer({ spun: 'ask', staff: null }), [who(wario), plain("'s report of "), postPart],
    "Wario's report of #12 in Title", '/c/c%2Fw'],
  ['an answer to an appeal of warn points', answer({ ask: 'appeal', punishment: 'infraction' }),
    [who(kassie), plain("'s ruling on "), who(wario), plain("'s appeal of "), plain('the warn points from '), postPart],
    "Kassie's ruling on Wario's appeal of the warn points from #12 in Title", '/c/c%2Fk'],
  ['an ask, an appeal of a ban', answer({ spun: 'ask', ask: 'appeal', punishment: 'ban', staff: null }),
    [who(wario), plain("'s appeal of "), plain('the ban from '), postPart],
    "Wario's appeal of the ban from #12 in Title", '/c/c%2Fw'],
  ['an answer to an appeal of a move, linked to its line', answer({ ask: 'appeal', punishment: 'move', group: 'trial', on: line }),
    [who(kassie), plain("'s ruling on "), who(wario), plain("'s appeal of "), plain('the move into '), { words: 'Trial Members', href: '/t/t3?page=1#post-4' }],
    "Kassie's ruling on Wario's appeal of the move into Trial Members", '/c/c%2Fk'],
  ['an appeal of a move with no line and a group the instance lacks', answer({ spun: 'ask', ask: 'appeal', punishment: 'move', group: 'gone', on: null, staff: null }),
    [who(wario), plain("'s appeal of "), plain('the move into '), plain('gone')],
    "Wario's appeal of the move into gone", '/c/c%2Fw'],
  ['a report with no post', answer({ spun: 'ask', staff: null, on: null }), [who(wario), plain("'s report of "), plain('a post')],
    "Wario's report of a post", '/c/c%2Fw'],
  ['an appeal of warn points with no post', answer({ ask: 'appeal', punishment: 'infraction', on: null }),
    [who(kassie), plain("'s ruling on "), who(wario), plain("'s appeal of "), plain('the warn points from '), plain('a post')],
    "Kassie's ruling on Wario's appeal of the warn points from a post", '/c/c%2Fk'],
  ['an answer place whose staff is null reads as its ask', answer({ staff: null }), [who(wario), plain("'s report of "), postPart],
    "Wario's report of #12 in Title", '/c/c%2Fw'],
  ['an ask reads as its ask even where it has an answer', answer({ spun: 'ask' }), [who(wario), plain("'s report of "), postPart],
    "Wario's report of #12 in Title", '/c/c%2Fw'],
  ['an appeal of a move whose group is not known', answer({ spun: 'ask', ask: 'appeal', punishment: 'move', group: null, on: null, staff: null }),
    [who(wario), plain("'s appeal of "), plain('the move into '), plain('a group')],
    "Wario's appeal of the move into a group", '/c/c%2Fw'],
];

for (const [name, place, parts, words, href] of answerRows) {
  test(`placeParts, placeWords and placeHref: ${name}`, () => {
    assert.deepEqual(placeParts(place, cardName, groupName, 20), parts);
    assert.equal(placeWords(place, cardName, groupName), words);
    assert.equal(placeHref(place, 20), href);
  });
}
