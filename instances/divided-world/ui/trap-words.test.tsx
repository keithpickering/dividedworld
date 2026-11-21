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
  test('a ride back: the setter wanted the cast, it landed as usual and its caster keeps what it earns', () => {
    expect(trapStruckWords({ how: 'rode', setter: 'Pipewrench', card: '4D Chess', laid: 'Whoops!', span: 'two days', setterStaff: false }))
      .toEqual({ line: 'Pipewrench wanted you to do that.', detail: 'Their face-down 4D Chess named your Whoops!. It landed as usual and you keep everything it earns; Pipewrench is paid for the reactions it draws.' });
    /* More than one card rides, so where the spring was not read it is only "card"; the setter is still needed. */
    expect(trapStruckWords({ how: 'rode', setter: 'Pipewrench', card: null, laid: 'Whoops!', span: null, setterStaff: false })!.detail).toContain('Their face-down card sprang on your Whoops!.');
    expect(trapStruckWords({ how: 'rode', setter: null, card: '4D Chess', laid: 'Whoops!', span: null, setterStaff: false })).toBeUndefined();
    expect(JSON.stringify(trapStruckWords({ how: 'rode', setter: 'P', card: '4D Chess', laid: 'Whoops!', span: null, setterStaff: false }))).not.toMatch(/account|owner|player|class|quadrant/iu);
  });
  test('a ride back of a card that names none: the cast landed as usual, and the detail names the card, or "card" where unread', () => {
    const f = { how: 'rode', setter: 'Pipewrench', laid: 'Whoops!', span: null, setterStaff: false } as const;
    const detail = (card: string | null) => trapStruckWords({ ...f, card })!.detail;
    expect(detail('Whoopee Cushion')).toBe('Their face-down Whoopee Cushion sprang on your Whoops!. It landed as usual and you keep everything it earns; Pipewrench is paid for every reaction it draws.');
    expect(detail('4D Chess')).toBe('Their face-down 4D Chess named your Whoops!. It landed as usual and you keep everything it earns; Pipewrench is paid for the reactions it draws.');
    expect(detail(null)).toBe('Their face-down card sprang on your Whoops!. It landed as usual and you keep everything it earns; Pipewrench is paid for the reactions it draws.');
    /* The owner's words (#902): Whoopee Cushion has a line of its own; 4D Chess's, and an unread card's, stay as they were. */
    const line = (card: string | null) => trapStruckWords({ ...f, card })!.line;
    expect(line('Whoopee Cushion')).toBe("PFFFT! You sat on Pipewrench's whoopee cushion.");
    expect(line('4D Chess')).toBe('Pipewrench wanted you to do that.');
    expect(line(null)).toBe('Pipewrench wanted you to do that.');
  });
  test('a Move that got past a face-down card: the voice gloats a little, says the card stays face down and that its setter is not told, and names no setter', () => {
    const f = { how: 'passed', setter: null, laid: 'Hype Up', span: null, setterStaff: false } as const;
    const said = trapStruckWords({ ...f, card: 'Cheap Shot' })!;
    expect(said).toEqual({ line: 'Cheap shot! It slipped right past.', detail: 'Your Cheap Shot got your Hype Up past a card set face down. That card stays face down, and the one who set it is not told.' });
    expect(trapStruckWords({ ...f, card: null })!.detail).toBe('Your card got your Hype Up past a card set face down. That card stays face down, and the one who set it is not told.');
    expect(trapStruckWords({ ...f, card: 'Cheap Shot', laid: null })!.detail).toContain('got your Move past');
    expect(JSON.stringify(said)).not.toMatch(/account|owner|player|class|cast/iu);
  });
  test('a card handed back: the cast landed as usual and the card is back in its caster\'s hand, with the card named or "card" where unread', () => {
    const f = { how: 'returned', setter: 'Pipewrench', laid: 'Hype Up', span: null, setterStaff: false } as const;
    expect(trapStruckWords({ ...f, card: 'Pay It Forward' }))
      .toEqual({ line: 'Paid forward', detail: 'Their face-down Pay It Forward sprang on your Hype Up. It landed as usual, and the card is back in your hand.' });
    expect(trapStruckWords({ ...f, card: null })!.detail).toBe('Their face-down card sprang on your Hype Up. It landed as usual, and the card is back in your hand.');
    expect(trapStruckWords({ ...f, card: 'Pay It Forward', laid: null })!.detail).toBe('Their face-down Pay It Forward sprang on your Move. It landed as usual, and the card is back in your hand.');
    expect(trapStruckWords({ ...f, card: 'Pay It Forward', setter: null })).toBeUndefined();
    expect(JSON.stringify(trapStruckWords({ ...f, card: 'Pay It Forward' }))).not.toMatch(/account|owner|player|class/iu);
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
