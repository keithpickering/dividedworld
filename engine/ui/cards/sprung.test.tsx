/**
 * The Lens's sprung line (sprung.ts): a spring's `for` is a character id, kept as the quoter's fallback; the line shows the quoter's name and
 * never the id.
 */
import { describe, expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { readSprungWords } from './sprung.ts';

const act = (id: string, over: Partial<Act>): Act => ({ id, character: null, kind: 'post', thread: 't', targetActId: null, seq: null, createdAt: '2026-11-05T12:00:00.000Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });

describe('the Lens line for a spring', () => {
  test('shows the quoter\'s name where `for` is the fallback, and never the id', async () => {
    const FOR = 'cFOR-ID-7';
    const spring = act('sp', { kind: 'spring', character: 'cSet', payload: { trigger: 'quote', set: 'set1', by: 'gone', for: FOR, when: { passage: 'p', says: 's' } } });
    const api = {
      actsById: async (ids: readonly string[]) => [spring, act('set1', { kind: 'set', character: 'cSet' })].filter((a) => ids.includes(a.id)),
      characters: async (ids: readonly string[]) => ids.map((id) => ({ id, name: id === FOR ? 'Spritey' : 'Pipewrench' })),
    };
    const said = await readSprungWords(api as never, 'sp');
    expect(said).toBe('Set face down by Pipewrench on November 5; sprang when Spritey quoted “p” saying “s”.');
    expect(said).not.toContain(FOR);
  });
});
