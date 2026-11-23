/**
 * A play's moment, drawn (docs/plans/2026-11-03-effect-history-plan.md, Task 4): the moment's version of the post, wrapped in the
 * effects of its layers whose cards play in a moment (playsInMoment), each run from what it had saved then, in
 * the order PostEffects wraps them; every other play on the post then, and every play above it, named in words. The cards are the
 * engine's own test cards, never an instance's.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { LensProvider, useLensStore } from './Lens.tsx';
import { fakeSound } from '../audio/test-sound.ts';
import { resetSound, setSoundPreference } from '../audio/sound.ts';
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
import { MomentEffects, momentParts, playsInMoment } from './Effects.tsx';
import { createPlays } from './plays.ts';
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
const scribey = rule('scribey', 'Scribey', { stack: 2, writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] }) } });
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

function draw(m: PlayMoment, onView = vi.fn()) {
  const api = buildWorld({}, instance);
  const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const spies = { api, meets: vi.spyOn(api, 'meetCard'), save: vi.spyOn(api, 'saveEffect'), release: vi.spyOn(api, 'releaseEffect'), give: vi.spyOn(api, 'donate'), faces: vi.spyOn(api, 'myFaceDown') };
  const view = render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><MomentEffects moment={m} place="thread" nameOf={(c) => (c === 'c-spritey' ? 'Spritey' : 'someone')} onView={onView}><span data-kb-words>then</span></MomentEffects></CalloutProvider></KayfaProvider>);
  return { ...view, spies, onView };
}
const chain = () => {
  const out: string[] = [];
  for (let el: HTMLElement | null = document.querySelector('[data-kb-words]'); el; el = el.parentElement) if (el.dataset.kbWrap) out.push(el.dataset.kbWrap);
  return out;
};
const named = (m: PlayMoment) => momentParts(m, instance.cards, cards, (c) => (c === 'c-spritey' ? 'Spritey' : 'someone')).named;

afterEach(() => { seen.length = 0; vi.restoreAllMocks(); });

describe('a moment hands a play its count of casts that named it (the refund outcome)', () => {
  test('the sign\'s play is given handedOut: 2 in a moment with two casts naming it', () => {
    const got = new Map<string, number | undefined>();
    const Spy = ({ plays, children }: EffectProps) => { for (const p of plays) got.set(p.id, p.handedOut); return <>{children}</>; };
    const handed = (id: string, minutes: number) => card(id, 'ripple', minutes, { handedBack: { by: 'sign', card: 'smear' } });
    const m = moment([{ act: card('sign', 'smear', 1), state: null }, { act: handed('cast-a', 2), state: null }, { act: handed('cast-b', 3), state: null }], [], at(4));
    const api = buildWorld({}, instance);
    const kayfa = { api, instance, ui: { cards: [ui('smear', { Effect: Spy }), ui('ripple', { Effect: Spy })], glass: {} }, settings: {} } as unknown as Kayfa;
    render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><MomentEffects moment={m} place="thread" nameOf={() => ''} onView={() => {}}><span>then</span></MomentEffects></CalloutProvider></KayfaProvider>);
    expect(got.get('sign')).toBe(2);
    expect(got.get('cast-a')).toBeUndefined();
  });
});

describe('a card with a surface or a drive in a moment', () => {
  test('a surface card is named and never drawn, and so is a card with a drive (issue #774 gives them the read of the past)', () => {
    const drivey = rule('drivey', 'Drivey', { drive: { lasts: { unit: 'day', count: 1 }, gifts: [], overhead: '' } });
    const uis = [...cards, ui('drivey')];
    const m = moment([{ act: card('k2', 'drivey', 5), state: null }, { act: card('k1', 'slabby', 1), state: null }]);
    const parts = momentParts(m, [...instance.cards, drivey], uis, () => '');
    expect(parts.drawn).toEqual([]);
    expect(parts.named).toEqual(['Slabby']);
    expect(playsInMoment(slabby, cards[7])).toBe(false);
    expect(playsInMoment(drivey, ui('drivey'))).toBe(false);
    draw(m);
    expect(seen).toEqual([]);
    expect(named(m)).toEqual(['Slabby']);
  });
});

describe('a moment draws still', () => {
  test('each drawn card is given still false, moment.at, its state as saved then, a reader who is nobody, and a save, a release and a give that refuse', async () => {
    const calls: unknown[] = [];
    const strokes = vi.fn();
    let got: EffectProps | null = null;
    /* A card that saves, releases, gives and meets whenever it is drawn. */
    const Busy = (props: EffectProps) => {
      const { children, still, save, release, give, met } = props;
      got = props;
      useEffect(() => { met(); void save('k1', { washed: 1 }).then((a) => calls.push(a)); void release('k1').then((a) => calls.push(a)); void give('d1', 5).then((a) => calls.push(a)); }, [met, save, release, give]);
      return <div data-kb-wrap="busy" data-kb-still={String(still)} onPointerDown={strokes}>{children}</div>;
    };
    cards[0] = ui('smear', { Effect: Busy, hint: 'Smear smears.' });
    try {
      const saved = { state: { washed: 0.4 }, savedAt: at(3) };
      const m = moment([{ act: card('k1', 'smear', 5), state: saved }]);
      const { spies } = draw(m);
      await vi.waitFor(() => expect(calls).toHaveLength(3));
      expect(got!.still).toBe(false);
      expect(got!.moment).toEqual({ at: Date.parse(m.at) });
      expect(got!.states).toEqual({ k1: saved });
      expect(got!.reader).toEqual({ author: false, caster: false });
      expect(got!.marks).toBeNull();
      expect(got!.wallet).toBeNull();
      expect(got!.kept).toBeUndefined();
      expect(got!.fold).toBeUndefined();
      expect(got!.drives).toBeUndefined();
      expect(document.querySelector('[data-kb-wrap="busy"]')!.getAttribute('data-kb-still')).toBe('false');
      expect(spies.meets).not.toHaveBeenCalled();
      expect(calls.every((a) => (a as { ok: boolean }).ok === false)).toBe(true);
      expect(calls[0]).toMatchObject({ error: 'nothing in a moment is saved' });
      expect(spies.save).not.toHaveBeenCalled();
      expect(spies.release).not.toHaveBeenCalled();
      expect(spies.give).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
    } finally {
      cards[0] = ui('smear');
    }
  });

  test('a card whose rules save nothing, stack one and never end is drawn', () => {
    const m = moment([{ act: card('k1', 'tagger', 1), state: null }]);
    expect(momentParts(m, instance.cards, cards, () => '').drawn.map((p) => p.id)).toEqual(['k1']);
    draw(m);
    expect(chain()).toEqual(['tagger']);
    expect(named(m)).toEqual([]);
  });

  test('a takeover is named and never drawn, whatever its rules say', () => {
    const m = moment([{ act: card('k2', 'smear', 5), state: null }, { act: card('k1', 'lifty', 1), state: null }]);
    draw(m);
    expect(chain()).toEqual(['smear']);
    expect(seen.map((s) => s.card)).not.toContain('lifty');
    expect(named(m)).toEqual(['Lifty']);
    expect(playsInMoment(lifty, cards[6])).toBe(false);
  });

  test('playsInMoment: an effect, no takeover, no surface, no drive', () => {
    expect(playsInMoment(tagger, cards[3])).toBe(true);
    expect(playsInMoment(tagger, undefined)).toBe(false);
    expect(playsInMoment(tagger, { ...cards[3]!, Effect: undefined })).toBe(false);
    expect(playsInMoment(undefined, cards[3])).toBe(true);
  });

  test('two drawn ink cards share one registry: the upper one is on top where it has claimed', async () => {
    const inks: Record<string, EffectProps['ink']> = {};
    const Claimer = (key: string) => function Effect({ children, ink }: EffectProps) {
      inks[key] = ink;
      useEffect(() => ink.claim(() => true), [ink]);
      return <div data-kb-wrap={key}>{children}</div>;
    };
    cards[0] = ui('smear', { Effect: Claimer('smear') });
    cards[1] = ui('ripple', { Effect: Claimer('ripple') });
    try {
      draw(moment([{ act: card('k1', 'smear', 1), state: null }, { act: card('k2', 'ripple', 4), state: null }]));
      await vi.waitFor(() => expect(inks['ripple']).toBeDefined());
      expect(inks['ripple']!.topAt(1, 1)).toBe(true);
      expect(inks['smear']!.topAt(1, 1)).toBe(false);
    } finally {
      cards[0] = ui('smear');
      cards[1] = ui('ripple');
    }
  });

  test('a drawn effect\'s show reaches onView with the whole view, controls included, and null when it unmounts', async () => {
    const whole = { progress: null, state: 'seen', yours: false, controls: [{ label: 'Wash' }], notes: { k1: 'x' } } as unknown as Parameters<EffectProps['show']>[0];
    cards[0] = ui('smear', { Effect: ({ children, show }: EffectProps) => { useEffect(() => { show(whole); }, [show]); return <div data-kb-wrap="smear">{children}</div>; } });
    try {
      const { onView, unmount } = draw(moment([{ act: card('k1', 'smear', 1), state: null }]));
      await vi.waitFor(() => expect(onView).toHaveBeenCalledWith('smear', whole));
      unmount();
      expect(onView).toHaveBeenLastCalledWith('smear', null);
    } finally {
      cards[0] = ui('smear');
    }
  });

  test('an effect that builds a fresh view whenever its show or plays change settles: a bounded number of views, and the store holds it', async () => {
    const built: unknown[] = [];
    cards[0] = ui('smear', {
      Effect: ({ children, show, plays }: EffectProps) => {
        useEffect(() => { const view = { progress: null, state: `fresh (${plays.length})`, yours: false, controls: [{ kind: 'press' as const, label: 'Go', run: () => {} }], notes: {} }; built.push(view); show(view); }, [show, plays]);
        return <div data-kb-wrap="smear">{children}</div>;
      },
    });
    try {
      const plays = createPlays();
      const set = vi.spyOn(plays, 'setView');
      let heard = 0;
      /* A caller that re-renders for every view it hears, as a frame holding the views would; the cap keeps a loop from hanging the run. */
      function Caller({ m }: { readonly m: PlayMoment }) {
        const [, wake] = useState(0);
        return <MomentEffects moment={m} place="thread" nameOf={() => ''} onView={(c, v) => { heard += 1; if (heard < 40) wake((n) => n + 1); plays.setView('p1', c, v); }}><span>then</span></MomentEffects>;
      }
      const api = buildWorld({}, instance);
      const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
      render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><Caller m={moment([{ act: card('k1', 'smear', 1), state: null }])} /></CalloutProvider></KayfaProvider>);
      await vi.waitFor(() => expect(plays.view('p1', 'smear')?.state).toBe('fresh (1)'));
      await new Promise((r) => setTimeout(r, 30));
      expect(built.length).toBeLessThanOrEqual(2);
      expect(heard).toBeLessThanOrEqual(2);
      expect(set.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      cards[0] = ui('smear');
    }
  });

  test('MomentEffect warms the card\'s sounds', () => {
    const { fetched } = fakeSound();
    setSoundPreference({ gameSound: 'on', gameVolume: 100, interfaceSound: 'off', interfaceVolume: 100 });
    cards[0] = ui('smear', { sounds: ['x.one'] });
    try {
      const api = buildWorld({}, instance);
      const kayfa = { api, instance, ui: { cards, glass: {}, sounds: { slots: [{ key: 'x.one', src: '/x.one.mp3', bus: 'game', caption: 'one' }, { key: 'x.two', src: '/x.two.mp3', bus: 'game', caption: 'two' }] } }, settings: {} } as unknown as Kayfa;
      render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><MomentEffects moment={moment([{ act: card('k1', 'smear', 1), state: null }])} place="thread" nameOf={() => ''} onView={() => {}}><span>then</span></MomentEffects></CalloutProvider></KayfaProvider>);
      expect(fetched.mock.calls.map((c) => c[0])).toEqual(['/x.one.mp3']);
    } finally {
      cards[0] = ui('smear');
      resetSound();
    }
  });

  test('a layer is drawn from what it had saved then, and its view goes to the frame by card', async () => {
    const saved = { state: { washed: 0.4 }, savedAt: at(3) };
    const { onView } = draw(moment([{ act: card('k2', 'smear', 5, { layer: 2 }), state: null }, { act: card('k1', 'smear', 1), state: saved }]));
    expect(seen.at(-1)).toMatchObject({ card: 'smear', still: false, states: { k1: saved } });
    await vi.waitFor(() => expect(onView).toHaveBeenCalledWith('smear', expect.objectContaining({ state: 'smear as it stood (2)' })));
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

test('a play that never took (untaken) is neither drawn nor named, as a live post leaves it out', () => {
  const m = moment([{ act: { ...card('k1', 'smear', 1), untaken: true }, state: null }, { act: card('k2', 'ripple', 2), state: null }]);
  const parts = momentParts(m, instance.cards, cards, () => '');
  expect(parts.drawn.map((p) => p.id)).toEqual(['k2']);
  expect(parts.named).toEqual([]);
});

test('a takeover in a moment is named, so the drawn cards wrap as they were first played', () => {
  draw(moment([{ act: card('k2', 'smear', 5), state: null }, { act: card('k1', 'lifty', 1), state: null }, { act: card('k3', 'ripple', 7), state: null }]));
  expect(chain()).toEqual(['smear', 'ripple']);
});

describe('a moment nests as a post does', () => {
  test('a card that writes is innermost whatever the play order: its tail is next to the words', () => {
    draw(moment([{ act: card('k2', 'scribey', 9), state: null }, { act: card('k1', 'smear', 1), state: null }]));
    const words = document.querySelector('[data-kb-words]')!;
    expect(words.nextElementSibling?.getAttribute('data-kb-tail')).toBe('scribey');
    expect(chain()).toEqual(['smear']);
  });

  test("the words box holds the words and the writing card's tail, and every other card's wrap holds the box", () => {
    draw(moment([{ act: card('k2', 'scribey', 9), state: null }, { act: card('k1', 'smear', 1), state: null }]));
    const words = document.querySelector('[data-kb-words]')!;
    const box = words.closest('[data-kb-words-box]')!;
    expect(box).not.toBeNull();
    expect(words.nextElementSibling?.getAttribute('data-kb-tail')).toBe('scribey');
    expect(box.contains(words.nextElementSibling)).toBe(true);
    expect(box.closest('[data-kb-wrap="smear"]')).not.toBeNull();
    expect(box.querySelector('[data-kb-wrap]')).toBeNull();
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

describe('Reset over a post', () => {
  const play: CardPlay = { id: 'k1', card: 'smear', layer: 1, caster: 'c-caster', message: '', config: {}, playedAt: at(1), post: 'p1' };
  const saved = { state: { washed: 0.4 }, savedAt: at(0) };
  const mounted: { states: Readonly<Record<string, EffectState>>; n: number }[] = [];
  const Counted = ({ children, states }: EffectProps) => {
    useEffect(() => { mounted.push({ states, n: mounted.length + 1 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-kb-wrap="smear">{children}</div>;
  };
  function over(api: ReturnType<typeof buildWorld>, back: () => void = () => {}) {
    cards[0] = ui('smear', { Effect: Counted });
    const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
    return render(
      <KayfaProvider value={kayfa}><LensProvider><CalloutProvider met={[]}>
        <article><button type="button" className="kb-mark" data-kb-card="smear">mark</button>
          <MomentView play={play} place="thread" onView={() => {}} nameOf={() => ''} bodyOf={() => <span>then</span>} back={back} now={<span>now</span>} /></article>
      </CalloutProvider></LensProvider></KayfaProvider>,
    );
  }
  afterEach(() => { mounted.length = 0; cards[0] = ui('smear'); });

  test('Reset remounts the moment\'s effect from the same states, keeps the moment shown, keeps focus on Reset, and says the status', async () => {
    const api = buildWorld({}, instance);
    vi.spyOn(api, 'playMoment').mockResolvedValue(moment([{ act: card('k1', 'smear', 1), state: saved }]));
    over(api);
    const reset = await screen.findByRole('button', { name: 'Reset' });
    expect(document.querySelector('.kb-moment-tag')!.textContent).toBe('As it landed · Reset · Back to now');
    expect(mounted).toHaveLength(1);
    expect(screen.queryByRole('status')?.textContent ?? '').toBe('');
    await userEvent.click(reset);
    await waitFor(() => expect(mounted).toHaveLength(2));
    expect(mounted[1]!.states).toEqual(mounted[0]!.states);
    expect(mounted[1]!.states).toEqual({ k1: saved });
    expect(screen.getByText('then')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('status').textContent).toBe('As it landed again.');
    /* A second Reset is said again (a no-break space is appended, which is not collapsed), and a third is the first form again. */
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(mounted).toHaveLength(3));
    expect(screen.getByRole('status').textContent).toBe('As it landed again. ');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(mounted).toHaveLength(4));
    expect(screen.getByRole('status').textContent).toBe('As it landed again.');
  });

  test('a Reset pressed before this view mounted is not said: the status is empty until one is pressed while it is shown', async () => {
    const api = buildWorld({}, instance);
    vi.spyOn(api, 'playMoment').mockResolvedValue(moment([{ act: card('k1', 'smear', 1), state: saved }]));
    cards[0] = ui('smear', { Effect: Counted });
    const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
    /* The moment's view comes and goes (Back to now, then As it landed again) over one Lens store. */
    function Host() {
      const [on, setOn] = useState(true);
      return (
        <article>
          <button type="button" onClick={() => setOn((v) => !v)}>toggle</button>
          {on && <MomentView play={play} place="thread" onView={() => {}} nameOf={() => ''} bodyOf={() => <span>then</span>} back={() => {}} now={<span>now</span>} />}
        </article>
      );
    }
    render(<KayfaProvider value={kayfa}><LensProvider><CalloutProvider met={[]}><Host /></CalloutProvider></LensProvider></KayfaProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('As it landed again.'));
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.queryByRole('status')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await screen.findByRole('button', { name: 'Reset' });
    expect(screen.getByRole('status').textContent).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('As it landed again.'));
  });

  test("a view whose key changes to a moment with more runs behind it does not say 'As it landed again.' until a Reset is pressed on it", async () => {
    const api = buildWorld({}, instance);
    vi.spyOn(api, 'playMoment').mockResolvedValue(moment([{ act: card('k1', 'smear', 1), state: saved }]));
    cards[0] = ui('smear', { Effect: Counted });
    const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
    const other: CardPlay = { ...play, id: 'k9' };
    function Host() {
      const lens = useLensStore();
      const [shown, setShown] = useState(play);
      return (
        <article>
          <button type="button" onClick={() => lens.reset('k9')}>reset the other</button>
          <button type="button" onClick={() => setShown(other)}>show the other</button>
          <MomentView play={shown} place="thread" onView={() => {}} nameOf={() => ''} bodyOf={() => <span>then</span>} back={() => {}} now={<span>now</span>} />
        </article>
      );
    }
    render(<KayfaProvider value={kayfa}><LensProvider><CalloutProvider met={[]}><Host /></CalloutProvider></LensProvider></KayfaProvider>);
    await screen.findByRole('button', { name: 'Reset' });
    await userEvent.click(screen.getByRole('button', { name: 'reset the other' }));
    await userEvent.click(screen.getByRole('button', { name: 'show the other' }));
    await screen.findByRole('button', { name: 'Reset' });
    await waitFor(() => expect(mounted.length).toBeGreaterThan(1));
    expect(screen.getByRole('status').textContent, "the other moment's earlier Reset is not said as this view's").toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('As it landed again.'));
  });

  test('a read moment\'s list has no line for a drawn card and ends "Nothing you do to this post is saved."', async () => {
    const api = buildWorld({}, instance);
    vi.spyOn(api, 'playMoment').mockResolvedValue(moment([{ act: card('k1', 'smear', 1), state: saved }, { act: card('k2', 'ripple', 2), state: null }, { act: card('k3', 'slabby', 3), state: null }]));
    over(api);
    await screen.findByRole('button', { name: 'Reset' });
    const list = document.querySelector('.kb-moment-list')!;
    const lines = [...list.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines).toEqual(['Also on the post then: Slabby', 'Nothing you do to this post is saved.']);
    expect(list.textContent).not.toMatch(/Smear|Ripple/u);
  });

  test('a moment that is loading, failed or null does not say nothing is saved', async () => {
    const loading = buildWorld({}, instance);
    vi.spyOn(loading, 'playMoment').mockReturnValue(new Promise(() => {}));
    const first = over(loading);
    expect(document.body.textContent).not.toContain('Nothing you do to this post is saved.');
    first.unmount();
    const failed = buildWorld({}, instance);
    vi.spyOn(failed, 'playMoment').mockRejectedValue(new Error('no'));
    const second = over(failed);
    await screen.findByText('The moment did not load.');
    expect(document.body.textContent).not.toContain('Nothing you do to this post is saved.');
    second.unmount();
    const none = buildWorld({}, instance);
    vi.spyOn(none, 'playMoment').mockResolvedValue(null);
    over(none);
    await screen.findByText(/no moment to show/u);
    expect(document.body.textContent).not.toContain('Nothing you do to this post is saved.');
  });

  test('Back to now still returns focus to the play\'s mark', async () => {
    const api = buildWorld({}, instance);
    vi.spyOn(api, 'playMoment').mockResolvedValue(moment([{ act: card('k1', 'smear', 1), state: null }]));
    const back = vi.fn();
    over(api, back);
    await userEvent.click(await screen.findByRole('button', { name: 'Back to now' }));
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.kb-mark')));
  });

  test('the moment is read once across two Resets', async () => {
    const api = buildWorld({}, instance);
    const read = vi.spyOn(api, 'playMoment').mockResolvedValue(moment([{ act: card('k1', 'smear', 1), state: null }]));
    over(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(mounted).toHaveLength(3));
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('a moment names what it does not draw', () => {
  test('a takeover is named and never mounted, and a card with an effect is drawn', () => {
    const m = moment([{ act: card('k2', 'smear', 5), state: null }, { act: card('k1', 'holdy', 1), state: null }, { act: card('k0', 'tagger', 0), state: null }]);
    draw(m);
    expect(chain()).toEqual(['tagger', 'smear']);
    expect(seen.map((s) => s.card)).not.toContain('holdy');
    expect(named(m)).toEqual(['Holdy']);
  });

  test('the play whose moment it is is never named as also on the post: its mark, its Lens row and the ORIGIN head name it', () => {
    const m = moment([{ act: card('k2', 'holdy', 5), state: null }, { act: card('k1', 'tagger', 1), state: null }]);
    expect(named(m)).toEqual([]);
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
      expect(el.getAttribute('data-kb-still')).toBe('false');
      expect(el.getAttribute('data-kb-reach')).toBe('character');
      expect(plays.at(-1)).toEqual(['k1']);
      expect(screen.queryByText(/Sparkly/)).toBeNull();
    } finally {
      cards[5] = ui('sparkly');
    }
  });

  test("a play above the post says no view: onView is not called on mount, on show or on unmount, while a post card's is", () => {
    const say = vi.fn();
    cards[5] = ui('sparkly', { Effect: ({ children, show }: EffectProps) => { useEffect(() => { show({ progress: null, state: 'above', yours: false, controls: [], notes: {} }); say(); }, [show]); return <>{children}</>; } });
    try {
      const onView = vi.fn();
      const view = draw(moment([{ act: onAuthor('k1', 5, 60), state: null }, { act: card('k2', 'smear', 1), state: null }]), onView);
      expect(say).toHaveBeenCalled();
      expect(onView.mock.calls.map((c) => c[0])).toEqual(['smear']);
      view.unmount();
      expect(onView.mock.calls.map((c) => `${c[0]}:${c[1] === null}`)).toEqual(['smear:false', 'smear:true']);
    } finally {
      cards[5] = ui('sparkly');
    }
  });

  test("the same card above the post and on it: the post card's view survives the above effect unmounting", async () => {
    cards[5] = ui('sparkly', { Effect: ({ children, show, reach }: EffectProps) => { useEffect(() => { show({ progress: null, state: `${reach} view`, yours: false, controls: [], notes: {} }); }, [show, reach]); return <>{children}</>; } });
    try {
      const last = new Map<string, string | null>();
      const onView = (card: string, view: { state: string } | null) => { last.set(card, view === null ? null : view.state); };
      const both = moment([{ act: onAuthor('k1', 5, 60), state: null }, { act: card('k2', 'sparkly', 1), state: null }]);
      const post = moment([{ act: card('k2', 'sparkly', 1), state: null }]);
      const api = buildWorld({}, instance);
      const kayfa = { api, instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
      function Host() {
        const [m, setM] = useState(both);
        return <><button type="button" onClick={() => setM(post)}>drop the above</button><MomentEffects moment={m} place="thread" nameOf={() => ''} onView={onView}><span>then</span></MomentEffects></>;
      }
      render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><Host /></CalloutProvider></KayfaProvider>);
      await waitFor(() => expect(last.get('sparkly')).toBe('post view'));
      await userEvent.click(screen.getByRole('button', { name: 'drop the above' }));
      await waitFor(() => expect(last.get('sparkly')).toBe('post view'));
      expect(last.get('sparkly'), 'the above effect leaving cleared the post card view').not.toBeNull();
    } finally {
      cards[5] = ui('sparkly');
    }
  });

  test('it wraps as PostEffects wraps an author\'s play: inside the post\'s own layers', () => {
    draw(moment([{ act: onAuthor('k1', 5, 60), state: null }, { act: card('k2', 'smear', 1), state: null }, { act: card('k3', 'ripple', 2), state: null }]));
    expect(chain()).toEqual(['sparkly', 'smear', 'ripple']);
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
    return render(<KayfaProvider value={kayfa}><CalloutProvider met={[]}><MomentView play={play} place={back ? 'thread' : 'origin'} onView={() => {}} source={{ spin }} nameOf={() => ''} bodyOf={() => <span>then</span>} back={back} now={<span>now</span>} /></CalloutProvider></KayfaProvider>);
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
