/** You Were Saying?'s screen entry, read through its own `ui`: the words its log says about a play and a save. */
import { describe, expect, test } from 'vitest';
import { ui as ywsCard } from './ui.ts';

describe('Divided World\'s InstanceUi covers its rules', () => {
  /* The card that writes, in the log (the design's section 13): the caster's length, the author's clear, and what it did to the author's post. */
  test('You Were Saying? says the length its play recorded, the author\'s clear as theirs, and what it did in its own words', () => {
    /* The line is the recorded number, whatever the configuration or the economy now say; a play with no record says nothing of a length. */
    expect(ywsCard.logPlay!({ steps: 0 }, { tokens: 100 })).toBe('It was played for 100 tokens.');
    expect(ywsCard.logPlay!({ steps: 3 }, { tokens: 1 })).toBe('It was played for 1 token.');
    expect(ywsCard.logPlay!({ steps: 99 }, { tokens: 400 })).toBe('It was played for 400 tokens.');
    expect(ywsCard.logPlay!({ steps: 1 }, {})).toBeUndefined();
    expect(ywsCard.logSave!({ cleared: 'v1' })).toEqual({ what: 'Tail erased', verb: 'erased' });
    expect(ywsCard.logSave!({})).toBeUndefined();
    expect(ywsCard.logWritten!.continued).toBe('continued it');
    expect(ywsCard.logWritten!.again('You Were Saying?')).toBe('made its You Were Saying? again');
    expect(ywsCard.logWritten!.failed).toBe('didn\'t take');
  });
});
