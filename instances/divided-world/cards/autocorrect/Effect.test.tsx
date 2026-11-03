/**
 * Autocorrect's effect (docs/plans/2026-11-03-autocorrect-plan.md, Task 6): label tape over every occurrence of each play's phrase,
 * peeled by a drag or a held key, an author's peels saved for everyone and a reader's on their own screen, an adhesive mark where a
 * strip was, and a strip that falls away (or fades, under reduced motion).
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import { ratio } from '../../../../engine/ui/contrast.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { AutocorrectEffect, TAPE } from './Effect.tsx';
import { dropStrip, fallFrames } from './fall.ts';

const QUOTE = '[quote=0f8fad5b-d9cb-469f-a165-70867728950e]Mario in a quote[/quote]';
const postOf = (body: string) => ({ id: 'post-1', character: 'author', kind: 'post', thread: 't', payload: { body }, currentPayload: { body }, targetActId: null, seq: 3, createdAt: '2026-11-03T10:00:00.000Z', editedAt: null, shownEditedAt: null }) as unknown as Act;
const playOf = (n: number, phrase: string, replacement: string): CardPlay => ({ id: `k${n}`, card: 'autocorrect', layer: n, caster: `c${n}`, message: '', config: { phrase, replacement }, playedAt: `2026-11-03T10:0${n}:00.000Z`, post: 'post-1' });
const ok = async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-11-03T11:00:00.000Z' } });

interface Options { readonly body?: string; readonly plays?: CardPlay[]; readonly states?: Record<string, EffectState>; readonly author?: boolean; readonly save?: EffectProps['save']; readonly peelMs?: number }

function mount(o: Options = {}) {
  const save = vi.fn(o.save ?? (ok as unknown as EffectProps['save']));
  const views: (CardView | null)[] = [];
  let setBody: (b: string) => void = () => {};
  function Host() {
    const [body, set] = useState(o.body ?? 'Mario and mario, MARIO! ' + QUOTE);
    setBody = set;
    const post = postOf(body);
    return (
      <AutocorrectEffect
        post={post} plays={o.plays ?? [playOf(1, 'mario', 'Luigi')]} states={o.states ?? {}} released={new Set()} reader={{ author: o.author ?? false, caster: false }}
        place="thread" reach="post" save={save} release={async (play) => ({ ok: true, value: { play, releasedAt: '' } })} show={(v) => { views.push(v); }} met={() => {}}
        holdScreen={() => {}} marks={null} nameOf={() => 'Spritey'}
      >
        <BbCode text={body} />
      </AutocorrectEffect>
    );
  }
  const world = renderInWorld(<Host />, { settings: { cardSettings: { 'autocorrect.peelMs': o.peelMs ?? 700 } } });
  return { ...world, save, views, edit: (b: string) => act(() => setBody(b)) };
}
const strips = () => [...document.querySelectorAll<HTMLElement>('.dw-ac-strip')];
const bands = () => [...document.querySelectorAll<HTMLElement>('.dw-ac-adhesive')];
const hold = async (el: HTMLElement, ms: number) => { fireEvent.keyDown(el, { key: 'Enter' }); await act(async () => { vi.advanceTimersByTime(ms); }); };

beforeEach(() => { document.documentElement.removeAttribute('data-kb-motion'); });
afterEach(() => { vi.useRealTimers(); document.documentElement.removeAttribute('data-kb-motion'); });

describe('Autocorrect', () => {
  test('a strip covers every occurrence, in any case, and none inside a quote; it reads as the replacement', () => {
    mount();
    expect(strips()).toHaveLength(3);
    for (const s of strips()) {
      expect(s.tagName).toBe('BUTTON');
      expect(s).toHaveAccessibleName('Autocorrected text: “Luigi”. Hold Enter or Space to peel');
      expect(s.querySelector('.dw-ac-said')).toHaveTextContent('Luigi');
      expect(s.querySelector('.dw-ac-covered')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(document.querySelector('blockquote')).toHaveTextContent('Mario in a quote');
  });

  test('a held key peels at the card\'s time and not before; letting go early lets it settle back', async () => {
    vi.useFakeTimers();
    mount({ peelMs: 700 });
    await hold(strips()[0]!, 600);
    expect(strips()).toHaveLength(3);
    fireEvent.keyUp(strips()[0]!, { key: 'Enter' });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(strips()).toHaveLength(3);
    await hold(strips()[0]!, 700);
    expect(strips()).toHaveLength(2);
    expect(bands().map((b) => b.textContent)).toEqual(['Mario']);
  });

  test('a drag past the threshold peels; a short one settles back', async () => {
    mount();
    const s = strips()[1]!;
    fireEvent.pointerDown(s, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 110, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(s, { clientX: 110, clientY: 100, pointerId: 1 });
    expect(strips()).toHaveLength(3);
    fireEvent.pointerDown(s, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 160, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(s, { clientX: 160, clientY: 90, pointerId: 1 });
    expect(strips()).toHaveLength(2);
  });

  test('a reader\'s peel is theirs alone: nothing is saved, and it is back on a fresh load', async () => {
    vi.useFakeTimers();
    const first = mount();
    await hold(strips()[0]!, 700);
    expect(strips()).toHaveLength(2);
    expect(first.save).not.toHaveBeenCalled();
    first.unmount();
    mount();
    expect(strips()).toHaveLength(3);
  });

  test('the author\'s peel is saved by place, and the last one says clean', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, states: { k1: { state: { peeled: [0, 2] }, savedAt: '2026-11-03T10:30:00.000Z', savedBy: 'author' } as unknown as EffectState } });
    expect(strips()).toHaveLength(1);
    expect(bands()).toHaveLength(2);
    await hold(strips()[0]!, 700);
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0, 1, 2], clean: true });
  });

  test('where two plays overlap, the later play\'s strip is on top, and peeling it shows the one beneath', async () => {
    vi.useFakeTimers();
    mount({ body: 'a big cats day', plays: [playOf(1, 'big cats', 'tiny dogs'), playOf(2, 'cats', 'kittens')] });
    expect(strips().map((s) => s.querySelector('.dw-ac-said')!.textContent)).toEqual(['kittens']);
    await hold(strips()[0]!, 700);
    expect(strips().map((s) => s.querySelector('.dw-ac-said')!.textContent)).toEqual(['tiny dogs']);
  });

  test('strips follow the phrase through an edit: one edited away goes, one added comes', () => {
    const m = mount({ body: 'Mario and Mario' });
    expect(strips()).toHaveLength(2);
    m.edit('Mario and Luigi');
    expect(strips()).toHaveLength(1);
    m.edit('Mario, Mario and Mario');
    expect(strips()).toHaveLength(3);
  });

  test('it tells the Lens how many strips are peeled, in plain words', () => {
    const m = mount({ states: { k1: { state: { peeled: [1] }, savedAt: '', savedBy: 'author' } as unknown as EffectState } });
    const last = m.views.filter(Boolean).at(-1)!;
    expect(last.state).toBe('3 strips, 1 peeled');
    expect(last.progress).toBeCloseTo(1 / 3);
    expect(last.notes.k1).toBe('“mario” → “Luigi”, 3 places');
  });

  test('the tape\'s typing reads at 7:1 on its paper, on either board', () => {
    expect(ratio(TAPE.ink, TAPE.paper)).toBeGreaterThanOrEqual(7);
  });
});

describe('the fall', () => {
  test('a strip curls up from the corner it was pulled at, then drifts down swaying, the same on every screen for one strip', () => {
    const frames = fallFrames('k1:0', 600, 'left');
    expect(frames.length).toBeGreaterThan(4);
    expect(frames[0]).toMatchObject({ opacity: 1 });
    expect(String(frames.at(-1)!.transform)).toMatch(/translateY\(6\d\dpx\)/);
    const sways = frames.slice(2).map((f) => Number(/translateX\((-?[\d.]+)px\)/.exec(String(f.transform))?.[1] ?? 0));
    expect(sways.some((x) => x > 0) && sways.some((x) => x < 0)).toBe(true);
    expect(fallFrames('k1:0', 600, 'left')).toEqual(frames);
    expect(String(fallFrames('k1:0', 600, 'right')[1]!.transformOrigin)).toMatch(/right/);
  });

  test('under reduced motion it only fades where it was, with no drift or sway', () => {
    const calls: [Keyframe[], KeyframeAnimationOptions][] = [];
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const was = proto.animate;
    proto.animate = function (this: HTMLElement, k: Keyframe[], opts: KeyframeAnimationOptions) { calls.push([k, opts]); return { finished: Promise.resolve(), onfinish: null } as unknown as Animation; };
    try {
      const strip = document.createElement('button');
      document.body.append(strip);
      dropStrip(strip, { corner: 'left', reduced: true, seed: 'k1:0' });
      expect(calls).toHaveLength(1);
      expect(calls[0]![0].every((f) => f.transform === undefined)).toBe(true);
      expect(calls[0]![1].duration).toBeLessThanOrEqual(200);
      dropStrip(strip, { corner: 'left', reduced: false, seed: 'k1:0' });
      expect(calls[1]![0].some((f) => /translateY/.test(String(f.transform)))).toBe(true);
      expect(document.querySelectorAll('[data-kb-falling]').length).toBeGreaterThan(0);
      for (const c of document.querySelectorAll('[data-kb-falling]')) expect(c).toHaveAttribute('aria-hidden', 'true');
    } finally {
      proto.animate = was;
    }
  });
});
