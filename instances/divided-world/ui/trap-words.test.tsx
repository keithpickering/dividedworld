/**
 * Divided World's voice for a face-down card that struck: it gloats, names the setter's character, and bluffs nothing.
 */
import { describe, expect, test } from 'vitest';
import { trapStruckWords } from './trap-words.ts';

describe('the trapStruck voice', () => {
  test('a quote spring: the setter saw it coming, and the card sprang when the quote landed', () => {
    expect(trapStruckWords({ how: 'quote', setter: 'Pipewrench', card: 'Whoops!', laid: 'Whoops!', span: 'two days', setterStaff: false }))
      .toEqual({ line: 'Pipewrench saw this coming.', detail: 'Their face-down Whoops! sprang when you quoted their post, two days after they set it.' });
  });
  test('a quote that met a condition: it says what matched, and gloats only truthfully', () => {
    const said = trapStruckWords({ how: 'quote', setter: 'Pipewrench', card: 'Whoops!', laid: 'Whoops!', span: 'two days', setterStaff: false, passage: '“the punchline”', says: '“nice try”' })!;
    expect(said.line).toBe('Pipewrench was waiting for exactly that.');
    expect(said.detail).toBe('Their face-down Whoops! sprang when you quoted “the punchline” saying “nice try”, two days after they set it.');
    expect(trapStruckWords({ how: 'quote', setter: 'Pipewrench', card: 'Whoops!', laid: null, span: null, setterStaff: false, passage: null, says: '“nice try”' })!.detail)
      .toBe('Their face-down Whoops! sprang when you quoted their post saying “nice try”.');
  });
  test('a caught cast: a Reversal caught it, and it is the setter\'s now', () => {
    expect(trapStruckWords({ how: 'caught', setter: 'Pipewrench', card: 'Whoops!', laid: null, span: 'an hour', setterStaff: false }))
      .toEqual({ line: 'Pipewrench had a Reversal waiting.', detail: 'It caught your Whoops!, and it had been face down for an hour when you cast it. Whoops! is Pipewrench\'s now.' });
  });
  test('a staff setter keeps nothing: the card is spent, and the voice says so', () => {
    const said = trapStruckWords({ how: 'caught', setter: 'The Clerk', card: 'Whoops!', laid: null, span: 'an hour', setterStaff: true })!;
    expect(said.line).toBe('The Clerk had a Reversal waiting.');
    expect(said.detail).toBe('It caught your Whoops!, and it had been face down for an hour when you cast it. Whoops! is spent.');
  });
  test('without the setter or the card it says nothing, so the engine\'s plain words stand', () => {
    expect(trapStruckWords({ how: 'quote', setter: null, card: 'Whoops!', laid: null, span: null, setterStaff: false })).toBeUndefined();
    expect(trapStruckWords({ how: 'caught', setter: 'Pipewrench', card: null, laid: null, span: null, setterStaff: false })).toBeUndefined();
  });
  test('never an account, an owner or a class', () => {
    const s = JSON.stringify([trapStruckWords({ how: 'quote', setter: 'P', card: 'Whoops!', laid: null, span: null, setterStaff: false }), trapStruckWords({ how: 'caught', setter: 'P', card: 'Whoops!', laid: null, span: null, setterStaff: false })]);
    expect(s).not.toMatch(/account|owner|player|class/iu);
  });
});
