/**
 * A play's moment, drawn (docs/plans/2026-11-03-effect-history-plan.md, Task 4): the moment's version of the post, wrapped in the
 * effects of its layers whose cards can change after they land (drawnInMoment), each drawn still from what it had saved then, in
 * the order PostEffects wraps them; every other play on the post then, and every play above it, named in words. The cards are the
 * engine's own test cards, never an instance's.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act, EffectState, PlayMoment } from '../data/api.ts';
import { buildWorld, testInstance } from '../test-world.tsx';
import { CalloutProvider } from './Callout.tsx';
import { MomentEffects, momentParts } from './Effects.tsx';
import type { CardUi, EffectProps } from './types.ts';

const base = { alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'test.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const rule = (key: string, name: string, extra: Partial<CardRules> = {}): CardRules => ({ ...base, key, name, canApply: (t, e, _config, now) => landsOn({ key }, t, e, now), ...extra });
/* Smear saves state and stacks (as a wash does); Ripple stacks; Holdy is a takeover that does neither; Tagger saves nothing and stacks one. */
const smear = rule('smear', 'Smear', { stack: 3, validateState: (s) => ok(s) });
const ripple = rule('ripple', 'Ripple', { stack: 2 });
const holdy = rule('holdy', 'Holdy');
const tagger = rule('tagger', 'Tagger');
const shieldy = rule('shieldy', 'Shieldy', { play: 'use', ward: true, lasts: { unit: 'day', count: 7 } });
const trappy = rule('trappy', 'Trappy', { play: 'set', trap: { trigger: { on: 'cast' }, outcome: { do: 'nullify' } } });
const sparkly = rule('sparkly', 'Sparkly', { rarity: 'uncommon', reaches: ['character'], lasts: { unit: 'day', count: 7 } });
/* Lifty is a takeover that stacks: drawn in a moment, and outermost there as it is live. */
const lifty = rule('lifty', 'Lifty', { stack: 2 });
const instance: Instance = { ...testInstance, cards: [smear, ripple, holdy, tagger, shieldy, trappy, sparkly, lifty], settings: { ...testInstance.settings, setLasts: { unit: 'day', count: 7 } } };

/* Each drawn card wraps the words in a box naming it, saying whether it was drawn still and what it was given. */
const seen: { card: string; still: boolean; states: Readonly<Record<string, EffectState>> }[] = [];
const Wrap = (key: string) => function Effect({ children, still, states, show, plays }: EffectProps) {
  seen.push({ card: key, still, states });
  useEffect(() => { show({ progress: null, state: `${key} as it stood (${plays.length})`, yours: false, controls: [], notes: {} }); }, [show, plays.length]);
  return <div data-kb-wrap={key}>{children}</div>;
};
const ui = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300' }, describe: () => `${key}.`, Effect: Wrap(key), ...extra });
const cards: CardUi[] = [ui('smear'), ui('ripple'), ui('holdy', { takeover: true }), ui('tagger'), ui('shieldy'), ui('sparkly'), ui('lifty', { takeover: true })];

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 3, 12, minutes)).toISOString();
const act = (id: string, kind: Act['kind'], payload: Record<string, unknown>, minutes: number, extra: Partial<Act> = {}): Act => ({
  id, character: 'c-caster', kind, thread: 't1', targetActId: 'p1', seq: null, createdAt: at(minutes), payload, currentPayload: payload, editedAt: null, shownEditedAt: null, ...extra,
});
const card = (id: string, key: string, minutes: number, payload: Record<string, unknown> = {}) => act(id, 'card', { card: key, message: '', config: {}, layer: 1, ...payload }, minutes);
const version: Act = { id: 'p1', character: 'c-author', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at(0), payload: { body: 'then' }, currentPayload: { body: 'then' }, editedAt: null, shownEditedAt: null };
const moment = (layers: PlayMoment['layers'], above: PlayMoment['above'] = []): PlayMoment => ({ version, layers, above, recorded: true });

function draw(m: PlayMoment, onWords = vi.fn()) {
  const api = buildWorld({}, instance);
  const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const spies = { api, meets: vi.spyOn(api, 'meetCard'), save: vi.spyOn(api, 'saveEffect'), release: vi.spyOn(api, 'releaseEffect'), faces: vi.spyOn(api, 'myFaceDown') };
  const view = render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><MomentEffects moment={m} place="thread" nameOf={(c) => (c === 'c-spritey' ? 'Spritey' : 'someone')} onWords={onWords}><span data-kb-words>then</span></MomentEffects></CalloutProvider></KayfaProvider>);
  return { ...view, spies, onWords };
}
const chain = () => {
  const out: string[] = [];
  for (let el: HTMLElement | null = document.querySelector('[data-kb-words]'); el; el = el.parentElement) if (el.dataset.kbWrap) out.push(el.dataset.kbWrap);
  return out;
};
const named = (m: PlayMoment) => momentParts(m, instance.cards, cards, (c) => (c === 'c-spritey' ? 'Spritey' : 'someone'), instance.settings.setLasts).named;

afterEach(() => { seen.length = 0; vi.restoreAllMocks(); });

describe('a moment draws still', () => {
  test('each drawn card is given still, its state as saved then, and a save, a release and a met that do nothing', async () => {
    const calls: unknown[] = [];
    const strokes = vi.fn();
    /* A card that saves, releases, meets and takes strokes whenever it is drawn, and binds its strokes only when it is live. */
    let marked: unknown = 'unset';
    const Busy = ({ children, still, save, release, met, marks }: EffectProps) => {
      marked = marks;
      useEffect(() => { met(); void save('k1', { washed: 1 }).then((a) => calls.push(a)); void release('k1').then((a) => calls.push(a)); }, [met, save, release]);
      return <div data-kb-wrap="busy" data-kb-still={String(still)} onPointerDown={still ? undefined : strokes}>{children}</div>;
    };
    cards[0] = ui('smear', { Effect: Busy, hint: 'Smear smears.' });
    try {
      const { spies } = draw(moment([{ act: card('k1', 'smear', 5), state: null }]));
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(document.querySelector('[data-kb-wrap="busy"]')!.getAttribute('data-kb-still')).toBe('true');
      fireEvent.pointerDown(document.querySelector('[data-kb-wrap="busy"]')!);
      expect(strokes).not.toHaveBeenCalled();
      expect(spies.meets).not.toHaveBeenCalled();
      expect(marked).toBeNull();
      expect(calls.every((a) => (a as { ok: boolean }).ok === false)).toBe(true);
      expect(spies.save).not.toHaveBeenCalled();
      expect(spies.release).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
    } finally {
      cards[0] = ui('smear');
    }
  });

  test('a layer is drawn from what it had saved then, and its words go to the frame by card', async () => {
    const saved = { state: { washed: 0.4 }, savedAt: at(3) };
    const { onWords } = draw(moment([{ act: card('k2', 'smear', 5, { layer: 2 }), state: null }, { act: card('k1', 'smear', 1), state: saved }]));
    expect(seen.at(-1)).toMatchObject({ card: 'smear', still: true, states: { k1: saved } });
    await vi.waitFor(() => expect(onWords).toHaveBeenCalledWith('smear', 'smear as it stood (2)'));
  });

  test('layers wrap in PostEffects\' order: the post\'s cards as first played, the first innermost, and a takeover outermost', () => {
    draw(moment([
      { act: card('k3', 'ripple', 9), state: null },
      { act: card('k1', 'smear', 1), state: null },
      { act: card('k2', 'ripple', 4), state: null },
    ]));
    expect(chain()).toEqual(['smear', 'ripple']);
    expect(screen.getByText('then')).toBeInTheDocument();
  });
});

test('a takeover drawn in a moment wraps outermost, though it was played first', () => {
  draw(moment([{ act: card('k2', 'smear', 5), state: null }, { act: card('k1', 'lifty', 1), state: null }, { act: card('k3', 'ripple', 7), state: null }]));
  expect(chain()).toEqual(['smear', 'ripple', 'lifty']);
});

describe('a moment names what it does not draw', () => {
  test('a card that cannot change after it lands is named and never mounted, a takeover included', () => {
    const m = moment([{ act: card('k2', 'smear', 5), state: null }, { act: card('k1', 'holdy', 1), state: null }, { act: card('k0', 'tagger', 0), state: null }]);
    draw(m);
    expect(chain()).toEqual(['smear']);
    expect(seen.map((s) => s.card)).not.toContain('holdy');
    expect(named(m)).toEqual(['Tagger', 'Holdy']);
  });

  test('a card back is named as a back, even once it sprang, and which card it is is never read', () => {
    const back = act('s1', 'set', {}, 1);
    const spring = act('sp1', 'spring', { card: 'trappy', trigger: 'cast', outcome: { do: 'nullify' }, set: 's1', by: 'k1', caught: 'k1' }, 2);
    const m = moment([{ act: card('k2', 'smear', 5), state: null }, { act: back, state: null }, { act: spring, state: null }]);
    const { spies } = draw(m);
    expect(named(m)).toEqual(['a card set face down']);
    expect(spies.faces).not.toHaveBeenCalled();
  });

  test('a back whose time had passed by the play\'s time, unsprung, was gone then and is not named', () => {
    const old = act('s0', 'set', {}, 0, { createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString() });
    const m = moment([{ act: card('k2', 'smear', 5), state: null }, { act: old, state: null }]);
    expect(named(m)).toEqual([]);
  });

  test('a caught play is named with its trap\'s card, read from the spring, and draws nothing', () => {
    const back = act('s1', 'set', {}, 1);
    const caught = card('k1', 'smear', 2, { caught: 's1', layer: undefined });
    const spring = act('sp1', 'spring', { card: 'trappy', trigger: 'cast', outcome: { do: 'nullify' }, set: 's1', by: 'k1', caught: 'k1' }, 2);
    const m = moment([{ act: card('k2', 'ripple', 5), state: null }, { act: back, state: null }, { act: caught, state: null }, { act: spring, state: null }]);
    draw(m);
    expect(chain()).toEqual(['ripple']);
    expect(named(m)).toEqual(['a card set face down', 'Smear, caught by Trappy']);
  });

  test('a Use that had ended by the moment is left out, and one live then is drawn', () => {
    const ended = card('u1', 'shieldy', 0, { ends: at(3) });
    const live = card('u2', 'shieldy', 0, { ends: at(60) });
    const m = moment([{ act: card('k1', 'smear', 5), state: null }, { act: ended, state: null }]);
    draw(m);
    expect(chain()).toEqual(['smear']);
    expect(named(m)).toEqual([]);
    seen.length = 0;
    document.body.innerHTML = '';
    draw(moment([{ act: card('k1', 'smear', 5), state: null }, { act: live, state: null }]));
    expect(chain()).toEqual(['shieldy', 'smear']);
  });

  test('a play above the post then is named with what it was on, and never drawn', () => {
    const glint = act('a1', 'card', { card: 'sparkly', reach: 'character', character: 'c-spritey', ends: at(600) }, 0);
    const m = moment([{ act: card('k1', 'smear', 5), state: null }], [{ play: 'a1', reach: 'character', target: 'c-spritey', endsAt: at(600), act: glint }]);
    draw(m);
    expect(chain()).toEqual(['smear']);
    expect(named(m)).toEqual(['Sparkly on Spritey']);
  });
});
