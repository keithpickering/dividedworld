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
  ['a card the instance no longer has', { kind: 'play', card: 'gone', on: post, from: null, at: null }, 'a card on #12 in Title', '/t/t1?page=1#post-12'],
];

for (const [name, place, words, href] of rows) {
  test(`placeWords and placeHref: ${name}`, () => {
    assert.equal(placeWords(place, cardName), words);
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
  assert.deepEqual(placeParts(glint({ at: pressed, from: castFrom }), glintName, 20), [
    { words: 'Glitter Bomb on ', href: null },
    { words: 'Wario', href: '/c/c%2Fw', character: 'c/w' },
    { words: ', at ', href: null },
    { words: '#31 in Why are my posts shiny', href: '/t/t9?page=2#post-31' },
  ]);
});

test('placeParts: a play on a character with only a cast-from post says where it was cast from', () => {
  assert.deepEqual(placeParts(glint({ at: null, from: castFrom }), glintName, 20), [
    { words: 'Glitter Bomb on ', href: null },
    { words: 'Wario', href: '/c/c%2Fw', character: 'c/w' },
    { words: ', cast from ', href: null },
    { words: '#12 in Title', href: '/t/t1?page=1#post-12' },
  ]);
});

test('placeParts: a play on a character with neither post is the card and the name alone (an older server)', () => {
  assert.deepEqual(placeParts(glint({ at: null, from: null }), glintName, 20), [
    { words: 'Glitter Bomb on ', href: null },
    { words: 'Wario', href: '/c/c%2Fw', character: 'c/w' },
  ]);
  assert.deepEqual(placeParts({ kind: 'play', card: 'glint', on: { kind: 'character', id: 'c1', name: null }, from: null, at: null }, glintName, 20)[1], { words: 'a character', href: '/c/c1', character: 'c1' });
});

for (const [name, place, words, href] of rows) {
  if (place.kind === 'play' && place.on?.kind === 'character') continue;
  test(`placeParts: ${name} is one part with today's words and address`, () => {
    assert.deepEqual(placeParts(place, cardName, 20), [{ words, href }]);
  });
}

test('placeWords and placeHref read placeParts: the whole phrase as words, and the first place it goes', () => {
  assert.equal(placeWords(glint({ at: pressed, from: castFrom }), glintName), 'Glitter Bomb on Wario, at #31 in Why are my posts shiny');
  assert.equal(placeWords(glint({ at: null, from: castFrom }), glintName), 'Glitter Bomb on Wario, cast from #12 in Title');
  assert.equal(placeHref(glint({ at: pressed, from: castFrom }), 20), '/c/c%2Fw');
});

test('placeParts: a face-down card and a key the instance lacks never name a card on a character either', () => {
  const on = (card: string | null) => placeParts({ kind: 'play', card, on: onWario, from: null, at: pressed }, glintName, 20)[0];
  assert.deepEqual(on(null), { words: 'a face-down card on ', href: null });
  assert.deepEqual(on('gone'), { words: 'a card on ', href: null });
});
