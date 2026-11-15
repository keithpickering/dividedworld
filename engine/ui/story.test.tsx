import { expect, test } from 'vitest';
import { cardOf, classOf } from './story.tsx';

const rules = [{ key: 'whoops', rarity: 'common' }, { key: 'stick-around', rarity: 'rare' }];
const looks = [{ key: 'whoops', face: 'w' }, { key: 'stick-around', face: 's' }];

test('cardOf returns the entry whose key matches, from a list of rules', () => {
  expect(cardOf(rules, 'stick-around')).toBe(rules[1]);
});

test('cardOf returns the entry whose key matches, from a list of looks', () => {
  expect(cardOf(looks, 'whoops')).toBe(looks[0]);
});

test('cardOf throws, naming the key, when the list has no such card', () => {
  expect(() => cardOf(rules, 'nope')).toThrow('the instance has no card "nope", which this story names');
});

test('classOf throws, naming the key, when the list has no such class', () => {
  expect(() => classOf([{ key: 'a' }], 'nope')).toThrow('the instance has no class "nope", which this story names');
});
