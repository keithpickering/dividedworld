/**
 * The post's limit on drawn effects, as the screens hold it (post-plays design, section 4): a full post is offered no card that draws
 * and is still offered a card that only marks, and a play its card says is cleared frees its slot, as `card_target` gives it on the server.
 */
import { describe, expect, test } from 'vitest';
import { landsOn, postFullWords, type CardRules } from '../../rules/cards.ts';
import type { Act, EffectState } from '../data/api.ts';
import { plainRefusal } from './faces.ts';
import { effectsOf, landing, targetOf, waysOn } from './land.ts';
import type { CardPlay } from './types.ts';

const base = (key: string, extra: Partial<CardRules> = {}): CardRules => {
  const own = { key, stack: 9 };
  return { key, name: key, alignment: 'salty', rarity: 'common', stack: 9, playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e, _c, now) => landsOn(own, t, e, now), ...extra };
};
const clean = (state: unknown) => typeof state === 'object' && state !== null && (state as { clean?: unknown }).clean === true;
const whoops = base('whoops', { drawsEffect: { cleared: clean } });
const saying = base('saying', { drawsEffect: { cleared: (s) => { const v = (s as { cleared?: unknown } | null)?.cleared; return typeof v === 'string' ? { version: v } : false; } } });
const filler = base('filler', { drawsEffect: {} });
const mark = base('mark');
const cards = [whoops, saying, filler, mark];

const post: Act = {
  id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T21:00:00Z',
  payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null,
};
const play = (card: string, n: number): CardPlay => ({ id: `${card}-${n}`, card, layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-10-29T21:16:00Z', post: 'p1' });
const state = (state: unknown): EffectState => ({ state, savedAt: '2026-10-29T22:00:00Z' });
const now = Date.parse('2026-11-01T00:00:00Z');
const FULL = 3;
const ctx = (extra = {}) => ({ cards, now, postEffects: FULL, ...extra });
/** Three drawing plays: the post holds all it takes. */
const full = [play('filler', 1), play('filler', 2), play('whoops', 3)];

describe('a full post, as the form asks it', () => {
  test('refuses a card that draws, in the words, and takes a card that only marks', () => {
    const lands = landing(filler, post, full, ctx());
    expect(lands.ok).toBe(false);
    expect(!lands.ok && plainRefusal(lands.why)).toBe(`T${postFullWords(FULL).slice(1)}.`);
    expect(landing(mark, post, full, ctx()).ok).toBe(true);
  });
  test('refuses the set of a card as well: a face-down card takes a slot', () => {
    expect(landing(mark, post, full, ctx({ faceDown: true })).ok).toBe(false);
  });
  test('a post with room takes the card that draws, and the ghost mark reads the same answer', () => {
    expect(landing(filler, post, full.slice(1), ctx()).ok).toBe(true);
    expect(waysOn(filler, post, full, { cards, own: false, now, postEffects: FULL })).toEqual({ cast: false, set: false });
    expect(waysOn(mark, post, full, { cards, own: false, now, postEffects: FULL }).cast).toBe(true);
  });
});

describe('a cleared play, as the server gives it', () => {
  test('a Whoops! whose saved state is clean frees its slot', () => {
    expect(landing(filler, post, full, ctx({ states: { 'whoops-3': state({ strokes: [], clean: true }) } })).ok).toBe(true);
    expect(landing(filler, post, full, ctx({ states: { 'whoops-3': state({ strokes: [1], clean: false }) } })).ok).toBe(false);
  });
  test('a You Were Saying cleared for the post\'s version frees it, and one cleared for an earlier version does not', () => {
    const held = [play('filler', 1), play('filler', 2), play('saying', 3)];
    const states = { 'saying-3': state({ cleared: 'v2' }) };
    expect(landing(filler, post, held, ctx({ states, version: 'v2' })).ok).toBe(true);
    expect(landing(filler, post, held, ctx({ states, version: 'v3' })).ok).toBe(false);
    expect(landing(filler, post, held, ctx({ states, version: null })).ok).toBe(false);
  });
  test('effectsOf gives drawing from the card and cleared from its answer', () => {
    const effects = effectsOf([play('mark', 1), play('whoops', 2), play('saying', 3)], cards, { states: { 'whoops-2': state({ clean: true }), 'saying-3': state({ cleared: 'v1' }) }, version: 'v2' });
    expect(effects.map((e) => [e.drawing === true, e.cleared === true])).toEqual([[false, false], [true, true], [true, false]]);
    expect(targetOf(post).reach).toBe('post');
  });
});
