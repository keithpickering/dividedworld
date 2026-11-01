/* A `.test.tsx` file though it holds no JSX, because `test:engine` runs `engine/**\/*.test.ts` under plain node and this reads the UI's modules. */
import { describe, expect, test } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import type { Settings } from '../../rules/types.ts';
import { render } from '@testing-library/react';
import { RARITIES } from '../../rules/cards.ts';
import { alignmentTag, faceOf, facesOf, gemOf, orbs, priceOf, withCardEconomy } from './faces.ts';
import { cardLabel, Postcard } from './Postcard.tsx';
import type { CardUi } from './types.ts';

const ok = { ok: true as const, value: undefined };
const settings = { economy: { 'a.price': 100, 'b.price': 250 } } as unknown as Settings;
const plain: CardRules = { key: 'a', name: 'A card', alignment: 'sweet', rarity: 'common', priceKey: 'a.price', playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }) };
const longer: CardRules = { ...plain, key: 'b', name: 'B card', alignment: 'salty', rarity: 'common', priceKey: 'b.price', stack: 3, playPrice: (_s, t) => Math.min(200, t.reach === 'post' ? t.length : 0) };
const ui: CardUi = { key: 'b', art: { color: '#f00', ink: '#000', tagline: 'Short.' }, summary: 'One sentence.', describe: () => 'In full.' };

describe('what every screen knows of a card', () => {
  test('its price is the rules\' own, said in orbs, with a plus where playing it on a long post costs more', () => {
    expect(faceOf(plain, undefined, settings)).toMatchObject({ price: 100, extra: 0, stack: 1, tag: 'Sweet' });
    expect(faceOf(longer, ui, settings)).toMatchObject({ price: 250, extra: 200, stack: 3, tag: 'Salty' });
    expect(priceOf(faceOf(plain, undefined, settings))).toBe('1.00');
    expect(priceOf(faceOf(longer, ui, settings))).toBe('2.50+');
    expect(orbs(5)).toBe('0.05');
  });

  test('the instance\'s words and art come with it, and a card it drew nothing for still has a face and an empty line', () => {
    expect(faceOf(longer, ui, settings)).toMatchObject({ tagline: 'Short.', summary: 'One sentence.', describe: 'In full.', art: { color: '#f00' } });
    const bare = faceOf(plain, undefined, settings);
    expect(bare).toMatchObject({ tagline: '', summary: '', describe: '' });
    expect(bare.art.color).toBe('var(--kb-glass-neon)');
  });

  test('a card with a description and no summary reads its description on a large face', () => {
    expect(faceOf(plain, { key: 'a', art: { color: '#0f0', ink: '#000' }, describe: () => 'Whole.' }, settings).summary).toBe('Whole.');
  });

  test('a rule that prices nothing is not a card the machine sells: the face throws, as the rules\' price does', () => {
    expect(() => faceOf({ ...plain, priceKey: 'missing' }, undefined, settings)).toThrow(/missing/);
  });

  test('every card the instance sells, in its order, matched to its art by key', () => {
    expect(facesOf([plain, longer], [ui], settings).map((f) => [f.key, f.tagline])).toEqual([['a', ''], ['b', 'Short.']]);
    expect(alignmentTag('pepperoni')).toBe('Pepperoni');
  });
});

describe('the economy a screen prices with', () => {
  test('is the compiled one with the server\'s numbers laid over it, a key the server did not give, or gave as no number, the compiled one\'s', () => {
    expect(withCardEconomy(settings, undefined)).toBe(settings);
    expect(withCardEconomy(settings, {})).toBe(settings);
    expect(withCardEconomy(settings, { 'b.price': 300 }).economy).toEqual({ 'a.price': 100, 'b.price': 300 });
    expect(withCardEconomy(settings, { 'a.price': 'cheap', 'b.price': Number.NaN, 'c.step': 5 }).economy).toEqual({ 'a.price': 100, 'b.price': 250, 'c.step': 5 });
    expect(faceOf(longer, ui, withCardEconomy(settings, { 'b.price': 300 })).price).toBe(300);
  });
});

/* Rarity and play on a card's face (docs/plans/2026-11-01-card-plays-plan.md, Task 7): a corner gem shaped by rarity, and the play's word, neither by color alone. */
describe('a card\'s rarity and play on its face', () => {
  const sweet: CardRules = { ...plain, name: 'Sweetie' };
  test('the face carries the rarity and the play, and the postcard\'s name says both in words', () => {
    const set = { ...sweet, key: 'snare', name: 'Snare', rarity: 'uncommon' as const, play: 'set' as const };
    const face = faceOf(set, undefined, settings);
    expect([face.rarity, face.play]).toEqual(['uncommon', 'set']);
    expect(cardLabel(face, 'fan')).toBe('Snare, Sweet, Set, uncommon postcard');
    expect(cardLabel(faceOf(sweet, undefined, settings), 'fan')).toBe('Sweetie, Sweet, Cast, common postcard');
  });

  test('the gem has a text name, and a shape for each rarity', () => {
    render(<Postcard face={faceOf({ ...sweet, rarity: 'rare' }, undefined, settings)} size="sheet" />);
    const gem = document.querySelector('[data-kb-rarity]')!;
    expect(gem.getAttribute('data-kb-rarity')).toBe('rare');
    expect(gem.getAttribute('title')).toBe('Rare');
    expect(document.querySelector('.kb-postcard-play')?.textContent).toBe('Cast');
    expect(new Set(RARITIES.map((r) => gemOf(r))).size).toBe(4);
  });
});
