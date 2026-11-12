/**
 * How a post's effects nest (`PostEffects`): each card's wraps the ones played before it, so the latest is outermost, except a card that
 * writes, which is innermost of all (its tail is the words' next sibling), a card with `CardUi.beneath`, which nests inside every card without
 * it, and a takeover, which is outermost. The cards are the engine's own
 * test cards, never an instance's.
 */
import { render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { PlayerProvider } from '../player.tsx';
import { buildWorld, testGlass, testInstance } from '../test-world.tsx';
import { createClaims } from './claims.ts';
import { PostEffects, VersionEffects } from './Effects.tsx';
import { PlayProvider, usePlay, type PlayTarget } from './play.tsx';
import { createPlays, playOf } from './plays.ts';
import type { CardUi, EffectProps, Written } from './types.ts';

/* Every rank a post's registry hands an effect, as `claims.at(key, rank)` is called: the rank an effect really receives. */
const handed = vi.hoisted(() => ({ ranks: new Map<string, number>() }));
vi.mock('./claims.ts', async (original) => {
  const real = await original<typeof import('./claims.ts')>();
  return { ...real, createClaims: () => { const claims = real.createClaims(); return { at: (key: string, rank: number) => { handed.ranks.set(key, rank); return claims.at(key, rank); } }; } };
});

const rules = (key: string, extra: Partial<CardRules> = {}): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'common', reaches: ['post'], playPrice: () => 0, validateConfig: (c: unknown) => ok(c),
  canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now),
  ...extra,
});
const KEYS = ['one', 'two', 'three'];
/* A card that writes: its rules have `writes`, and its effect draws a tail after the words. */
const WRITES: CardRules['writes'] = { tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) };
const WRITERS = ['scribe', 'typer'];
const instance: Instance = {
  ...testInstance,
  cards: [...KEYS.map((k) => rules(k)), ...WRITERS.map((k) => rules(k, { writes: WRITES, stack: 2 })), rules('beacon', { reaches: ['thread'] }), rules('comp')],
};
const at = '2026-10-29T12:00:00.000Z';
/** A play, its layer and time ordering it after the ones before in `played`. */
const play = (card: string, n: number): Act => ({
  id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p1', seq: null, createdAt: `2026-10-29T12:00:0${n}.000Z`,
  payload: { card, message: '', config: {}, layer: n }, currentPayload: {}, editedAt: null, shownEditedAt: null,
});
const words: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at, payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const wrap = (key: string) => ({ children }: EffectProps): ReactNode => <div data-kb-wrap={key}>{children}</div>;
const ui = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect: wrap(key), ...extra });

const tails = (key: string) => ({ children }: EffectProps): ReactNode => <>{children}<span data-kb-tail={key} /></>;
const writer = (key: string, extra: Partial<CardUi> = {}): CardUi => ui(key, { Effect: tails(key), ...extra });

/** The cards' wraps from the outside in, as the page nests them. */
function nesting(cards: CardUi[], played: string[]): string[] {
  const kayfa = { api: buildWorld({}, instance), instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const store = createPlays();
  store.add(played.map((c, i) => play(c, i + 1)));
  const { container } = render(<KayfaProvider value={kayfa}><PlayerProvider api={kayfa.api}><PostEffects plays={store} post={words} place="thread" nameOf={() => 'x'}><span data-kb-words>hi</span></PostEffects></PlayerProvider></KayfaProvider>);
  const out: string[] = [];
  for (let el = container.querySelector('[data-kb-wrap]'); el; el = el.querySelector(':scope > [data-kb-wrap]')) out.push(el.getAttribute('data-kb-wrap')!);
  return out;
}

describe('how effects nest', () => {
  test('in play order, the latest outermost, where no card is beneath', () => {
    expect(nesting([ui('one'), ui('two')], ['one', 'two'])).toEqual(['two', 'one']);
  });

  test('a beneath card nests inside a later card without it', () => {
    expect(nesting([ui('one', { beneath: true }), ui('two')], ['one', 'two'])).toEqual(['two', 'one']);
  });

  test('a beneath card played last is still innermost', () => {
    expect(nesting([ui('one'), ui('two', { beneath: true })], ['one', 'two'])).toEqual(['one', 'two']);
  });

  test('among several beneath cards, play order holds, under every card without it', () => {
    expect(nesting([ui('one', { beneath: true }), ui('two'), ui('three', { beneath: true })], ['one', 'two', 'three'])).toEqual(['two', 'three', 'one']);
  });

  test('a takeover is outermost whatever else is beneath it', () => {
    expect(nesting([ui('one', { takeover: true }), ui('two', { beneath: true }), ui('three')], ['one', 'two', 'three'])).toEqual(['one', 'three', 'two']);
  });
});

/* ---------------------------------------------------------------------------- a card that writes ---- */

const later = new Date(Date.now() + 3_600_000).toISOString();
/** A play above the post (a thread's), as reach.test.tsx lays one. */
const above = (card: string): Act => ({
  id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p0', seq: null, createdAt: at,
  payload: { card, message: '', config: {}, reach: 'thread', thread: 't1', ends: later }, currentPayload: {}, editedAt: null, shownEditedAt: null,
});
const kayfaOf = (cards: CardUi[]) => ({ api: buildWorld({}, instance), instance, ui: { cards, glass: testGlass }, settings: {} } as unknown as Kayfa);
/** The wraps from an element outward (innermost first). */
const outward = (from: Element | null): string[] => {
  const out: string[] = [];
  for (let el = from; el; el = el.parentElement) if (el.getAttribute('data-kb-wrap')) out.push(el.getAttribute('data-kb-wrap')!);
  return out;
};
/** The `data-kb-tail` keys that follow the words as siblings, in order. */
const tailsAfter = (words: Element): string[] => {
  const out: string[] = [];
  for (let el = words.nextElementSibling; el && el.hasAttribute('data-kb-tail'); el = el.nextElementSibling) out.push(el.getAttribute('data-kb-tail')!);
  return out;
};
function drawn(cards: CardUi[], played: (string | Act)[], more?: ReactNode) {
  const kayfa = kayfaOf(cards);
  const store = createPlays();
  store.add(played.map((c, i) => (typeof c === 'string' ? play(c, i + 1) : c)));
  const view = render(<KayfaProvider value={kayfa}><PlayerProvider api={kayfa.api}><PlayProvider><PostEffects plays={store} post={words} place="thread" nameOf={() => 'x'}><span data-kb-words>hi</span></PostEffects>{more}</PlayProvider></PlayerProvider></KayfaProvider>);
  return { ...view, words: view.container.querySelector('[data-kb-words]')! };
}

describe('a card that writes nests innermost', () => {
  test('played last, it is innermost: the tail is the words\' next sibling', () => {
    const { words } = drawn([ui('one'), writer('scribe')], ['one', 'scribe']);
    expect(tailsAfter(words)).toEqual(['scribe']);
    expect(outward(words)).toEqual(['one']);
  });

  test('it is inside a beneath card played before it and one played after it', () => {
    const { words } = drawn([ui('one', { beneath: true }), writer('scribe'), ui('two', { beneath: true })], ['one', 'scribe', 'two']);
    expect(tailsAfter(words)).toEqual(['scribe']);
    expect(outward(words)).toEqual(['one', 'two']);
  });

  test('a takeover is outside it', () => {
    const { words } = drawn([ui('one'), writer('scribe'), ui('three', { takeover: true })], ['one', 'scribe', 'three']);
    expect(tailsAfter(words)).toEqual(['scribe']);
    expect(outward(words)).toEqual(['one', 'three']);
    expect(words.parentElement!.closest('[data-kb-wrap="three"]')).not.toBeNull();
  });

  test('a card that writes and takes over is a takeover: outermost, around the cards without it', () => {
    const { words } = drawn([writer('scribe', { takeover: true }), ui('one')], ['scribe', 'one']);
    expect(outward(words)).toEqual(['one']);
    expect(tailsAfter(words)).toEqual([]);
    expect(words.closest('[data-kb-wrap="one"]')!.nextElementSibling?.getAttribute('data-kb-tail')).toBe('scribe');
  });

  test('two cards that write keep their play order, both inside every other card', () => {
    const { words } = drawn([writer('scribe'), ui('one'), writer('typer')], ['scribe', 'one', 'typer']);
    expect(tailsAfter(words)).toEqual(['scribe', 'typer']);
    expect(outward(words)).toEqual(['one']);
  });

  test('it is inside the effect of a play above the post (a thread\'s)', () => {
    const { words } = drawn([ui('beacon'), writer('scribe')], [above('beacon'), 'scribe']);
    expect(tailsAfter(words)).toEqual(['scribe']);
    expect(outward(words)).toEqual(['beacon']);
  });

  test('the ranks the effects are given ascend from the innermost out, in the new order', () => {
    const claimed: Record<string, EffectProps['ink']> = {};
    const Claimer = (key: string, tail: boolean) => function Claimer({ ink, children }: EffectProps): ReactNode {
      useEffect(() => ink.claim(() => true), [ink]);
      claimed[key] = ink;
      return tail ? <>{children}<span data-kb-tail={key} /></> : <div data-kb-wrap={key}>{children}</div>;
    };
    handed.ranks.clear();
    /* Played one, scribe, two, three; from the innermost out the order is scribe (it writes), two (beneath), one (plain), three (a takeover). */
    drawn([ui('one', { Effect: Claimer('one', false) }), ui('scribe', { Effect: Claimer('scribe', true) }), ui('two', { beneath: true, Effect: Claimer('two', false) }), ui('three', { takeover: true, Effect: Claimer('three', false) })], ['one', 'scribe', 'two', 'three']);
    /* The ranks each effect is given: consecutive from 0, ascending from the innermost out. */
    expect(Object.fromEntries(handed.ranks)).toEqual({ 'post:scribe': 0, 'post:two': 1, 'post:one': 2, 'post:three': 3 });
    /* An all-claiming hit test is on top only for the outermost, whose rank is the highest. */
    expect(Object.entries(claimed).filter(([, ink]) => ink.topAt(0, 0)).map(([key]) => key)).toEqual(['three']);
  });

  test('with a compose open on the post, the tail is inside the compose\'s body, next to the words, and the other cards are outside it', async () => {
    const Open = ({ target }: { readonly target: PlayTarget }) => {
      const p = usePlay();
      useEffect(() => { p?.openCompose('comp', target, 'cast'); }, []);
      return null;
    };
    const target: PlayTarget = { post: words, title: 't', author: 'a', to: '/x', plays: createPlays(), know: async () => {} };
    const comp = ui('comp', { Compose: ({ children }) => <div data-kb-compose-fake>{children}</div> });
    const { words: w, container } = drawn([ui('one'), writer('scribe'), comp], ['one', 'scribe'], <Open target={target} />);
    await vi.waitFor(() => expect(container.querySelector('.kb-compose-body')).not.toBeNull());
    const body = container.querySelector('.kb-compose-body')!;
    expect(body.contains(w)).toBe(true);
    expect(tailsAfter(w)).toEqual(['scribe']);
    expect(w.nextElementSibling!.closest('.kb-compose-body')).toBe(body);
    expect(body.closest('[data-kb-wrap="one"]')).not.toBeNull();
    expect(body.querySelector('[data-kb-wrap="one"]')).toBeNull();
  });
});

describe('a post\'s history version nests the same way', () => {
  const version = (cards: CardUi[], played: string[]) => {
    const kayfa = kayfaOf(cards);
    const plays = played.map((c, i) => playOf(play(c, i + 1))!);
    const written = new Map<string, Written>(plays.map((p) => [p.id, { text: 'x' }]));
    const view = render(<KayfaProvider value={kayfa}><VersionEffects post={words} version="v1" plays={plays} written={written}><span data-kb-words>hi</span></VersionEffects></KayfaProvider>);
    return view.container.querySelector('[data-kb-words]')!;
  };

  test('a card that writes is innermost whatever the play order', () => {
    const w = version([ui('one'), writer('scribe')], ['one', 'scribe']);
    expect(tailsAfter(w)).toEqual(['scribe']);
    expect(outward(w)).toEqual(['one']);
  });

  test('a beneath card is inside a card without it', () => {
    expect(outward(version([ui('one'), ui('two', { beneath: true })], ['one', 'two']))).toEqual(['two', 'one']);
  });
});
