/**
 * A play's moment, drawn (docs/plans/2026-11-03-effect-history-plan.md, Task 4): the moment's version of the post, wrapped in the
 * effects of its layers whose cards can change after they land (drawnInMoment), each drawn still from what it had saved then, in
 * the order PostEffects wraps them; every other play on the post then, and every play above it, named in words. The cards are the
 * engine's own test cards, never an instance's.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act, EffectState, PlayMoment } from '../data/api.ts';
import { buildWorld, testInstance } from '../test-world.tsx';
import { CalloutProvider } from './Callout.tsx';
import { MomentView } from './Moment.tsx';
import { when } from '../thread/lines.tsx';
import type { CardPlay } from './types.ts';
import { MomentEffects, momentParts } from './Effects.tsx';
import type { CardUi, EffectProps } from './types.ts';

const base = { alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const rule = (key: string, name: string, extra: Partial<CardRules> = {}): CardRules => ({ ...base, key, name, canApply: (t, e, _config, now) => landsOn({ key }, t, e, now), ...extra });
/* Smear saves state and stacks (as a wash does); Ripple stacks; Holdy is a takeover that does neither; Tagger saves nothing and stacks one. */
const smear = rule('smear', 'Smear', { stack: 3, validateState: (s) => ok(s) });
const ripple = rule('ripple', 'Ripple', { stack: 2 });
const holdy = rule('holdy', 'Holdy');
const tagger = rule('tagger', 'Tagger');
const shieldy = rule('shieldy', 'Shieldy', { play: 'use', gimmick: { kind: 'ward', upTo: 'uncommon' }, lasts: { unit: 'day', count: 7 } });
const trappy = rule('trappy', 'Trappy', { play: 'set', trap: { trigger: { on: 'visit' } } });
const sparkly = rule('sparkly', 'Sparkly', { rarity: 'uncommon', reaches: ['character'], lasts: { unit: 'day', count: 7 } });
/* Lifty is a takeover that stacks: drawn in a moment, and outermost there as it is live. */
const scribey = rule('scribey', 'Scribey', { stack: 2, writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) } });
const lifty = rule('lifty', 'Lifty', { stack: 2 });
/* Slabby is a surface card (kept in a moment by its state, as a wall's washing is). */
const strokesOk = (input: unknown) => ok({ strokes: [], payload: { input } });
const slabby = rule('slabby', 'Slabby', { validateState: (s) => ok(s), surface: { limitKey: 'slabby.limit', mostLive: 48, validateDraw: strokesOk, validateWash: strokesOk } });
const instance: Instance = { ...testInstance, cards: [smear, ripple, holdy, tagger, shieldy, trappy, sparkly, lifty, slabby, scribey], settings: { ...testInstance.settings, cardSettings: { 'slabby.limit': 40 }, setLasts: { unit: 'day', count: 7 } } };

/* Each drawn card wraps the words in a box naming it, saying whether it was drawn still and what it was given. */
const seen: { card: string; still: boolean; states: Readonly<Record<string, EffectState>> }[] = [];
const Wrap = (key: string) => function Effect({ children, still, states, show, plays }: EffectProps) {
  seen.push({ card: key, still, states });
  useEffect(() => { show({ progress: null, state: `${key} as it stood (${plays.length})`, yours: false, controls: [], notes: {} }); }, [show, plays.length]);
  return <div data-kb-wrap={key}>{children}</div>;
};
const ui = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect: Wrap(key), ...extra });
const cards: CardUi[] = [ui('smear'), ui('ripple'), ui('holdy', { takeover: true }), ui('tagger'), ui('shieldy'), ui('sparkly'), ui('lifty', { takeover: true }), ui('slabby'), ui('scribey', { Effect: ({ children }: EffectProps) => <>{children}<span data-kb-tail="scribey" /></> })];

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 3, 12, minutes)).toISOString();
const act = (id: string, kind: Act['kind'], payload: Record<string, unknown>, minutes: number, extra: Partial<Act> = {}): Act => ({
  id, character: 'c-caster', kind, thread: 't1', targetActId: 'p1', seq: null, createdAt: at(minutes), payload, currentPayload: payload, editedAt: null, shownEditedAt: null, ...extra,
});
const card = (id: string, key: string, minutes: number, payload: Record<string, unknown> = {}) => act(id, 'card', { card: key, message: '', config: {}, layer: 1, ...payload }, minutes);
const version: Act = { id: 'p1', character: 'c-author', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at(0), payload: { body: 'then' }, currentPayload: { body: 'then' }, editedAt: null, shownEditedAt: null };
/* A play's moment is at its own time (the first layer's); a spin's is the spin's, which `time` says. */
const moment = (layers: PlayMoment['layers'], above: PlayMoment['above'] = [], time: string = layers[0]!.act.createdAt): PlayMoment => ({ version, layers, above, recorded: true, at: time });

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
const named = (m: PlayMoment) => momentParts(m, instance.cards, cards, (c) => (c === 'c-spritey' ? 'Spritey' : 'someone')).named;

afterEach(() => { seen.length = 0; vi.restoreAllMocks(); });

describe('a surface in a moment', () => {
  test('is still: its limit as the card\'s, no cells and no acts, and a draw and a wash that refuse without asking', async () => {
    let got: EffectProps['surface'];
    cards[7] = ui('slabby', { Effect: ({ surface, children }: EffectProps) => { got = surface; return <div data-kb-wrap="slabby">{children}</div>; } });
    try {
      const { spies } = draw(moment([{ act: card('k1', 'slabby', 5), state: null }]));
      await vi.waitFor(() => expect(got).toBeDefined());
      expect(got).toMatchObject({ covered: 0, most: 4000, acts: null });
      got!.near();
      const refused = [await got!.draw('k1', 'c-x', {}), await got!.wash('k1', {})];
      expect(refused.every((a) => a.ok === false)).toBe(true);
      expect(refused[0]).toMatchObject({ error: 'a moment is drawn as it was, and nothing in it is saved' });
      expect(spies.api.draw).toBeDefined();
    } finally {
      cards[7] = ui('slabby');
    }
  });
});

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

  test('a card whose still view notes each play has those notes as its words, top first, and not its heading', async () => {
    /* A heading of "As it landed" says only what the frame says already; the notes say how each layer stood. */
    const Noted = ({ children, show, plays }: EffectProps) => {
      useEffect(() => { show({ progress: null, state: 'As it landed', yours: false, controls: [], notes: Object.fromEntries(plays.map((p) => [p.id, `${p.id} at 40%`])) }); }, [show, plays]);
      return <div data-kb-wrap="noted">{children}</div>;
    };
    cards[0] = ui('smear', { Effect: Noted });
    try {
      const { onWords } = draw(moment([{ act: card('k2', 'smear', 5, { layer: 2 }), state: null }, { act: card('k1', 'smear', 1), state: null }]));
      await vi.waitFor(() => expect(onWords).toHaveBeenCalledWith('smear', 'k2 at 40%; k1 at 40%'));
      expect(onWords).not.toHaveBeenCalledWith('smear', 'As it landed');
    } finally {
      cards[0] = ui('smear');
    }
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

describe('a moment nests as a post does', () => {
  test('a card that writes is innermost whatever the play order: its tail is next to the words', () => {
    draw(moment([{ act: card('k2', 'scribey', 9), state: null }, { act: card('k1', 'smear', 1), state: null }]));
    const words = document.querySelector('[data-kb-words]')!;
    expect(words.nextElementSibling?.getAttribute('data-kb-tail')).toBe('scribey');
    expect(chain()).toEqual(['smear']);
  });

  test('a beneath card is inside a card without it, though it was played later', () => {
    const was = cards[1]!;
    cards[1] = ui('ripple', { beneath: true });
    try {
      draw(moment([{ act: card('k1', 'smear', 1), state: null }, { act: card('k2', 'ripple', 5), state: null }]));
      expect(chain()).toEqual(['ripple', 'smear']);
    } finally {
      cards[1] = was;
    }
  });
});

describe('a moment names what it does not draw', () => {
  test('a card that cannot change after it lands is named and never mounted, a takeover included', () => {
    const m = moment([{ act: card('k2', 'smear', 5), state: null }, { act: card('k1', 'holdy', 1), state: null }, { act: card('k0', 'tagger', 0), state: null }]);
    draw(m);
    expect(chain()).toEqual(['smear']);
    expect(seen.map((s) => s.card)).not.toContain('holdy');
    expect(named(m)).toEqual(['Tagger', 'Holdy']);
  });

  test('the play whose moment it is is never named as also on the post: its mark, its Lens row and the ORIGIN head name it', () => {
    const m = moment([{ act: card('k2', 'holdy', 5), state: null }, { act: card('k1', 'tagger', 1), state: null }]);
    expect(named(m)).toEqual(['Tagger']);
    expect(momentParts(m, instance.cards, cards, () => '').own).toBeNull();
  });

  test('a caught play\'s own moment says what caught it, apart from what else was on the post', () => {
    const back = act('s1', 'set', {}, 1);
    const spring = act('sp1', 'spring', { card: 'trappy', trigger: 'cast', outcome: { do: 'nullify' }, set: 's1', by: 'k2', caught: 'k2' }, 5);
    const m = moment([{ act: card('k2', 'smear', 5, { caught: 's1', layer: undefined }), state: null }, { act: back, state: null }, { act: spring, state: null }]);
    const parts = momentParts(m, instance.cards, cards, () => '');
    expect(parts.own).toBe('Caught by Trappy');
    expect(parts.named).toEqual(['a card set face down']);
    expect(parts.drawn).toEqual([]);
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
    const old = act('s0', 'set', {}, 0, { createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), endsAt: new Date(Date.UTC(2026, 9, 8)).toISOString() });
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

  test('a play an admin had ended by the moment is named so and draws nothing; one ended after it is drawn as it was', () => {
    const end = (play: string, minutes: number) => act(`end-${play}`, 'card_end', { why: 'reversed', by: 'admin' }, minutes, { character: null, targetActId: play });
    const before = card('k1', 'smear', 1);
    const after = card('k0', 'ripple', 0);
    const m = moment([{ act: card('k2', 'sparkly', 5), state: null }, { act: before, state: null }, { act: end('k1', 3), state: null }, { act: after, state: null }, { act: end('k0', 9), state: null }]);
    draw(m);
    expect(chain().sort()).toEqual(['ripple', 'sparkly']);
    expect(named(m)).toEqual(['Smear, ended by an admin']);
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

describe('a character play is the moment\'s own play when it is the first layer', () => {
  /* Sparkly reaches a character: the origin play of a spun-at post, which is not a layer on the post. */
  const onAuthor = (id: string, minutes: number, ends: number) => card(id, 'sparkly', minutes, { reach: 'character', character: 'c-author', ends: at(ends) });
  const aboveOf = (id: string, minutes: number): PlayMoment['above'][number] => {
    const a = onAuthor(id, minutes, 60);
    return { play: id, reach: 'character', target: 'c-author', endsAt: at(60), act: a };
  };

  test('it is `above`, neither drawn among the post\'s layers nor named, and its card\'s effect is drawn once, still, with its play', () => {
    const m = moment([{ act: onAuthor('k1', 5, 60), state: null }, { act: card('k2', 'smear', 1), state: null }]);
    const parts = momentParts(m, instance.cards, cards, () => '');
    expect(parts.above?.id).toBe('k1');
    expect(parts.drawn.map((p) => p.id)).toEqual(['k2']);
    expect(parts.named).toEqual([]);
    const plays: string[][] = [];
    cards[5] = ui('sparkly', { Effect: ({ children, still, plays: mine, reach }: EffectProps) => { plays.push(mine.map((p) => p.id)); return <div data-kb-wrap="sparkly" data-kb-still={String(still)} data-kb-reach={reach}>{children}</div>; } });
    try {
      draw(m);
      expect(document.querySelectorAll('[data-kb-wrap="sparkly"]')).toHaveLength(1);
      const el = document.querySelector('[data-kb-wrap="sparkly"]')!;
      expect(el.getAttribute('data-kb-still')).toBe('true');
      expect(el.getAttribute('data-kb-reach')).toBe('character');
      expect(plays.at(-1)).toEqual(['k1']);
      expect(screen.queryByText(/Sparkly/)).toBeNull();
    } finally {
      cards[5] = ui('sparkly');
    }
  });

  test('it wraps as PostEffects wraps an author\'s play: inside the post\'s own layers and inside every takeover', () => {
    draw(moment([{ act: onAuthor('k1', 5, 60), state: null }, { act: card('k2', 'smear', 1), state: null }, { act: card('k3', 'lifty', 2), state: null }]));
    expect(chain()).toEqual(['sparkly', 'smear', 'lifty']);
  });

  test('another character play in `above` is named and not drawn', () => {
    const m = moment([{ act: onAuthor('k1', 5, 60), state: null }], [aboveOf('k9', 3)]);
    expect(momentParts(m, instance.cards, cards, (c) => (c === 'c-author' ? 'Spritey' : '')).named).toEqual(['Sparkly on Spritey']);
    draw(m);
    expect(document.querySelectorAll('[data-kb-wrap="sparkly"]')).toHaveLength(1);
  });

  test('a play on a post is unchanged: no `above`', () => {
    expect(momentParts(moment([{ act: card('k2', 'smear', 5), state: null }]), instance.cards, cards, () => '').above).toBeNull();
  });

  test('a Use that ended between the play and the moment is left out, and one still running is drawn', () => {
    const use = (id: string, ends: number) => card(id, 'shieldy', 1, { ends: at(ends) });
    const layers = [{ act: onAuthor('k1', 5, 60), state: null }, { act: use('u1', 10), state: null }, { act: use('u2', 30), state: null }];
    expect(momentParts(moment(layers), instance.cards, cards, () => '').drawn.map((p) => p.id).sort()).toEqual(['u1', 'u2']);
    const spun = momentParts(moment(layers, [], at(20)), instance.cards, cards, () => '');
    expect(spun.drawn.map((p) => p.id)).toEqual(['u2']);
    expect(spun.named).toEqual([]);
    expect(spun.above?.id).toBe('k1');
  });
});

describe('MomentView with a spin as its source', () => {
  const play: CardPlay = { id: 'k1', card: 'sparkly', layer: 1, caster: 'c-caster', message: '', config: {}, playedAt: at(5), post: 'p1', reach: 'character', on: 'c-author', ends: at(60) };
  const spunMoment = moment([{ act: card('k1', 'sparkly', 5, { reach: 'character', character: 'c-author', ends: at(60) }), state: null }], [], at(30));
  const view = (spin: string, api: ReturnType<typeof buildWorld>, back?: () => void) => {
    const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
    return render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><MomentView play={play} place={back ? 'thread' : 'origin'} source={{ spin }} nameOf={() => ''} bodyOf={() => <span>then</span>} back={back} now={<span>now</span>} /></CalloutProvider></KayfaProvider>);
  };

  test('reads the spin\'s moment, not the play\'s; names no time until it lands (never the play\'s), then the moment\'s', async () => {
    const api = buildWorld({}, instance);
    let land!: (m: PlayMoment) => void;
    const spin = vi.spyOn(api, 'spinMoment').mockReturnValue(new Promise((r) => { land = r; }));
    const played = vi.spyOn(api, 'playMoment');
    view('spin-a', api);
    expect(screen.getByRole('group', { name: 'As it was spun' })).toBeInTheDocument();
    expect(spin).toHaveBeenCalledWith('spin-a');
    land(spunMoment);
    await screen.findByRole('group', { name: `As it was spun, ${when(at(30))}` });
    expect(played).not.toHaveBeenCalled();
  });

  test('the label reaches the tag over a live post', async () => {
    const api = buildWorld({}, instance);
    vi.spyOn(api, 'spinMoment').mockResolvedValue(spunMoment);
    view('spin-b', api, () => {});
    await screen.findByRole('group', { name: /^As it was spun, / });
    expect(document.querySelector('.kb-moment-tag')!.textContent).toContain('As it was spun');
    expect(document.querySelector('.kb-moment-tag')!.textContent).not.toContain('As it landed');
  });

  test('Try again after a failed spin read reads the spin again', async () => {
    const api = buildWorld({}, instance);
    const spin = vi.spyOn(api, 'spinMoment').mockRejectedValueOnce(new Error('down')).mockResolvedValue(spunMoment);
    view('spin-c', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(spin).toHaveBeenCalledTimes(2));
    await screen.findByRole('group', { name: /^As it was spun, / });
  });
});

describe('a moment whose time cannot be read', () => {
  test('is judged at the first layer\'s time: the origin play is still drawn and its ended Use is still left out', () => {
    const m = moment([{ act: act('k1', 'card', { card: 'sparkly', message: '', config: {}, layer: 1, reach: 'character', character: 'c-author', ends: at(60) }, 5), state: null }, { act: card('u1', 'shieldy', 1, { ends: at(2) }), state: null }], [], 'not a time');
    const parts = momentParts(m, instance.cards, cards, () => '');
    expect(parts.above?.id).toBe('k1');
    expect(parts.drawn.map((p) => p.id)).toEqual([]);
  });
});
