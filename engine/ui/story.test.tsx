import { expect, test } from 'vitest';
import * as story from './story.tsx';

/* The module is read as a namespace, so a missing helper fails the test that asks for it. */
const helpers = story as unknown as {
  cardOf: <T extends { readonly key: string }>(cards: readonly T[], key: string) => T;
  classOf: <T extends { readonly key: string }>(classes: readonly T[], key: string) => T;
};

const rules = [{ key: 'whoops', rarity: 'common' }, { key: 'stick-around', rarity: 'rare' }];
const looks = [{ key: 'whoops', face: 'w' }, { key: 'stick-around', face: 's' }];

test('cardOf returns the entry whose key matches, from a list of rules', () => {
  expect(helpers.cardOf(rules, 'stick-around')).toBe(rules[1]);
});

test('cardOf returns the entry whose key matches, from a list of looks', () => {
  expect(helpers.cardOf(looks, 'whoops')).toBe(looks[0]);
});

test('cardOf throws, naming the key, when the list has no such card', () => {
  expect(() => helpers.cardOf(rules, 'nope')).toThrow('the instance has no card "nope", which this story names');
});

test('classOf throws, naming the key, when the list has no such class', () => {
  expect(() => helpers.classOf([{ key: 'a' }], 'nope')).toThrow('the instance has no class "nope", which this story names');
});
