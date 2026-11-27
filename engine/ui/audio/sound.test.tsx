/**
 * The page sound (Laugh Track plan, Task 4), with the mixer's deps faked: no context before a gesture; a game sound with its bus off
 * says its caption and fetches nothing; a gesture unlocks once; a hidden tab suspends; the preference reaches the buses; an unknown key
 * throws in development.
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { captions } from './captions.ts';
import { CAPTION_MS, HELD_FROM, resetSound, setSoundPreference, useSound, useWarmSounds } from './sound.ts';
import type { AudioContextLike, GainNodeLike, SourceLike } from './mixer.ts';
import type { SoundSlot } from './types.ts';

/** Every `warm` the page's mixer is asked for, so a test can tell a hook that warmed again from a mixer that merely deduped it. */
const warmed = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('./mixer.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./mixer.ts')>();
  return {
    ...real,
    createMixer: (deps: Parameters<typeof real.createMixer>[0]) => {
      const mixer = real.createMixer(deps);
      const warm = mixer.warm.bind(mixer);
      return { ...mixer, warm: (slots: Parameters<typeof warm>[0]) => { warmed.calls.push([...slots].map((s) => s.key)); warm(slots); } };
    },
  };
});

const param = () => ({ value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
let gains: GainNodeLike[];
let sources: SourceLike[];
let context: { suspend: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
const makeContext = vi.fn((): AudioContextLike => {
  const ctx = {
    currentTime: 0, destination: {},
    resume: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 1.5 })),
    createGain: () => { const g = { gain: param(), connect: vi.fn(), disconnect: vi.fn() }; gains.push(g); return g; },
    createBufferSource: () => { const s = { buffer: null, loop: false, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; },
  };
  context = ctx;
  return ctx;
});
const fetchBytes = vi.fn(async () => new ArrayBuffer(8));

const slot = (key: string, bus: 'game' | 'interface', extra: Partial<SoundSlot> = {}): SoundSlot => ({ key, src: `/${key}.mp3`, bus, caption: `${key} caption`, ...extra });
const SLOTS = [slot('boo', 'game', { ink: 'red' }), slot('click', 'interface'), slot('build', 'game', { loop: true })];
const wrap = ({ children }: { readonly children: ReactNode }) => (
  <KayfaProvider value={{ ui: { sounds: { slots: SLOTS } } } as unknown as Kayfa}>{children}</KayfaProvider>
);
const on = (bus: 'game' | 'interface', volume = 100) => setSoundPreference({
  gameSound: bus === 'game' ? 'on' : 'off', gameVolume: bus === 'game' ? volume : 100,
  interfaceSound: bus === 'interface' ? 'on' : 'off', interfaceVolume: bus === 'interface' ? volume : 100,
});
type Loop = ReturnType<ReturnType<typeof useSound>['loop']>;
/** Start a loop and let its sound load: the handle comes back at once, the mixer's answer a moment later. */
const loopLoaded = async (play: ReturnType<typeof useSound>, key: string, opts: { group?: string; id: string }): Promise<Loop> => {
  let h!: Loop;
  await act(async () => { h = play.loop(key, opts); for (let i = 0; i < 8; i++) await Promise.resolve(); });
  return h;
};
const gesture = (type = 'pointerdown') => act(async () => { document.dispatchEvent(new Event(type, { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  gains = []; sources = []; warmed.calls.length = 0;
  makeContext.mockClear(); fetchBytes.mockClear();
  resetSound({ makeContext, fetchBytes });
  captions.reset();
});
afterEach(() => { vi.restoreAllMocks(); captions.reset(); resetSound(); });

describe('the page sound', () => {
  test('makes no audio context before a gesture', async () => {
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await act(async () => { await result.current.play('boo'); });
    expect(makeContext).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  test('a game sound that is skipped says its caption for CAPTION_MS and fetches nothing', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      await act(async () => { await result.current.play('boo'); });
      expect(fetchBytes).not.toHaveBeenCalled();
      expect(captions.lines().at(-1)).toMatchObject({ text: 'boo caption', ink: 'red', held: false });
      act(() => { vi.advanceTimersByTime(CAPTION_MS - 1); });
      expect(captions.lines().at(-1)?.text).toBe('boo caption');
      act(() => { vi.advanceTimersByTime(2); });
      expect(captions.lines()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  test('a play with a caption says that text with the slot\'s ink, skipped on the game bus', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      await act(async () => { await result.current.play('boo', { caption: 'A trash can bangs' }); });
      expect(captions.lines().at(-1)).toMatchObject({ text: 'A trash can bangs', ink: 'red', held: false });
      await act(async () => { await result.current.play('boo'); });
      expect(captions.lines().at(-1)?.text, 'a play without one says the slot\'s').toBe('boo caption');
    } finally { vi.useRealTimers(); }
  });

  test('a play with a caption says that text with the slot\'s ink when it sounds', async () => {
    vi.useFakeTimers();
    try {
      on('game');
      await gesture();
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      await act(async () => { await result.current.play('boo', { caption: 'A ladder clangs' }); });
      expect(fetchBytes, 'it sounded, so it was fetched').toHaveBeenCalled();
      expect(captions.lines().at(-1)).toMatchObject({ text: 'A ladder clangs', ink: 'red' });
      await act(async () => { await result.current.play('boo'); });
      expect(captions.lines().at(-1)?.text).toBe('boo caption');
    } finally { vi.useRealTimers(); }
  });

  test('an interface sound that is skipped says nothing; one that sounds says its caption for its length', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      await act(async () => { await result.current.play('click'); });
      expect(captions.lines()).toEqual([]);
      on('interface');
      await gesture();
      await act(async () => { await result.current.play('click'); });
      expect(captions.lines().at(-1)?.text).toBe('click caption');
      act(() => { vi.advanceTimersByTime(1499); });
      expect(captions.lines().at(-1)?.text).toBe('click caption');
      act(() => { vi.advanceTimersByTime(2); });
      expect(captions.lines()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  test('the first gesture unlocks once and the listeners are gone after it', async () => {
    renderHook(() => useSound(), { wrapper: wrap });
    expect(makeContext).not.toHaveBeenCalled();
    await gesture('keydown');
    await gesture('pointerdown');
    await gesture('touchend');
    expect(makeContext).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  test('a resume that never settles does not hold the next gesture back: a pointerdown, then a click, unlocks', async () => {
    resetSound({ makeContext: () => { const c = makeContext(); c.resume = context.resume = vi.fn().mockReturnValueOnce(new Promise<void>(() => {})).mockResolvedValue(undefined); return c; }, fetchBytes });
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture('pointerdown');
    await gesture('click');
    expect(context.resume).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.play('boo'); });
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  test('a context that reads running after resume() is unlocked at once, though the promise never settles, and the listeners are gone', async () => {
    resetSound({ makeContext: () => { const c = makeContext() as AudioContextLike & { state?: string }; c.resume = context.resume = vi.fn(() => { c.state = 'running'; return new Promise<void>(() => {}); }); return c; }, fetchBytes });
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture('pointerdown');
    await gesture('click');
    expect(context.resume).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.play('boo'); });
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  test.each(['click', 'pointerup'])('a %s alone unlocks a fresh page', async (type) => {
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture(type);
    await act(async () => { await result.current.play('boo'); });
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  test('making the context sets navigator.audioSession.type to ambient where it exists, and nothing throws where it does not', async () => {
    const w = window as unknown as { AudioContext?: unknown };
    const nav = navigator as unknown as { audioSession?: { type: string } };
    const saved = w.AudioContext;
    w.AudioContext = class { currentTime = 0; destination = {}; resume = async () => {}; suspend = async () => {}; };
    try {
      resetSound();
      nav.audioSession = { type: 'auto' };
      on('game');
      renderHook(() => useSound(), { wrapper: wrap });
      await gesture('pointerdown');
      expect(nav.audioSession.type).toBe('ambient');
      delete nav.audioSession;
      resetSound();
      on('game');
      await expect(gesture('click')).resolves.not.toThrow();
    } finally {
      w.AudioContext = saved;
      delete nav.audioSession;
    }
  });

  test('a refused resume leaves the listeners, the next gesture unlocks, and the one after does nothing', async () => {
    resetSound({ makeContext: () => { const c = makeContext(); c.resume = context.resume = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined); return c; }, fetchBytes });
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture('keydown');
    await act(async () => { await result.current.play('boo'); });
    expect(fetchBytes).not.toHaveBeenCalled();
    await gesture('pointerdown');
    expect(context.resume).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.play('boo'); });
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    await gesture('touchend');
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  test('a hidden tab suspends and a shown one resumes', async () => {
    renderHook(() => useSound(), { wrapper: wrap });
    await gesture();
    context.resume.mockClear();
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(context.suspend).toHaveBeenCalledTimes(1);
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  test('the preference reaches the buses: on at a volume sounds at that level, off is silent', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game', 50);
    await gesture();
    await act(async () => { await result.current.play('boo'); });
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(gains[0]!.gain.value).toBe(0.5);
    setSoundPreference({ gameSound: 'off', gameVolume: 50, interfaceSound: 'off', interfaceVolume: 100 });
    expect((gains[0]!.gain.setTargetAtTime as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(0);
  });

  test('play(key, { group, fadeMs, tailMs }) hands the tail to the mixer: the voice holds its level until the last tailMs of the file', async () => {
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture();
    await act(async () => { await result.current.play('boo', { group: 'g', fadeMs: 100, tailMs: 500 }); });
    const voice = gains[1]!.gain;
    expect(voice.setValueAtTime).toHaveBeenCalledWith(1, 1);
    expect(voice.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 1.5);
  });

  test('play(key, { group, voices }) hands the cap to the mixer: two plays of one slot with voices 2 both sound', async () => {
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture();
    await act(async () => { await result.current.play('boo', { group: 'g', fadeMs: 100, voices: 2 }); });
    await act(async () => { await result.current.play('boo', { group: 'g', fadeMs: 100, voices: 2 }); });
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => (s.start as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(sources.map((s) => (s.stop as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([0, 0]);
  });

  test('a loop holds its caption while the gain is above HELD_FROM and releases it below', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    const handle = await loopLoaded(result.current, 'build', { id: 'meter' });
    act(() => handle.setGain(HELD_FROM + 0.1));
    expect(captions.lines().at(-1)).toMatchObject({ text: 'build caption', held: true });
    act(() => handle.setGain(HELD_FROM - 0.05));
    expect(captions.lines()).toEqual([]);
    act(() => handle.setGain(0.9));
    act(() => handle.stop(0));
    expect(captions.lines()).toEqual([]);
  });

  const interfaceLoop = slot('hum', 'interface', { loop: true });
  const withSlots = (slots: SoundSlot[]) => ({ children }: { readonly children: ReactNode }) => (
    <KayfaProvider value={{ ui: { sounds: { slots } } } as unknown as Kayfa}>{children}</KayfaProvider>
  );

  test('a sounding game loop whose bus goes off releases its caption, then is captioned by gain alone', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    const handle = await loopLoaded(result.current, 'build', { id: 'meter' });
    act(() => handle.setGain(0.9));
    expect(captions.lines().at(-1)?.held).toBe(true);
    act(() => setSoundPreference({ gameSound: 'off', gameVolume: 100, interfaceSound: 'off', interfaceVolume: 100 }));
    expect(captions.lines()).toEqual([]);
    act(() => handle.setGain(0.9));
    expect(captions.lines().at(-1)).toMatchObject({ text: 'build caption', held: true });
    act(() => handle.setGain(0));
    expect(captions.lines()).toEqual([]);
  });

  test('a sounding interface loop whose bus goes off releases its caption and holds nothing after', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: withSlots([interfaceLoop]) });
    on('interface');
    await gesture();
    const handle = await loopLoaded(result.current, 'hum', { id: 'hum' });
    act(() => handle.setGain(0.9));
    expect(captions.lines().at(-1)?.held).toBe(true);
    act(() => setSoundPreference({ gameSound: 'off', gameVolume: 100, interfaceSound: 'off', interfaceVolume: 100 }));
    expect(captions.lines()).toEqual([]);
    act(() => handle.setGain(0.9));
    expect(captions.lines()).toEqual([]);
  });

  test('a loop that was stopped, or replaced by its group, holds no caption after', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    const first = await loopLoaded(result.current, 'build', { id: 'a', group: 'g' });
    await loopLoaded(result.current, 'build', { id: 'b', group: 'g' });
    act(() => first.setGain(0.9));
    expect(captions.lines()).toEqual([]);
    const own = await loopLoaded(result.current, 'build', { id: 'c' });
    act(() => own.stop(0));
    act(() => own.setGain(0.9));
    expect(captions.lines()).toEqual([]);
  });

  test('a loop starts silent: its voice is at gain 0 until a setGain raises it', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    const handle = await loopLoaded(result.current, 'build', { id: 'meter' });
    expect(gains[1]!.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(gains[1]!.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    act(() => handle.setGain(0.6));
    expect(gains[1]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.6, 0, 0.05);
  });

  test('the handle is there at once: gains set before the sound loads apply when it does, the latest winning', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    let handle!: Loop;
    await act(async () => {
      handle = result.current.loop('build', { id: 'meter' });
      handle.setGain(0.9);
      handle.setGain(0.4);
      expect(captions.lines().at(-1)).toMatchObject({ text: 'build caption', held: true });
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(sources).toHaveLength(1);
    expect(gains[1]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 0, 0.05);
    expect(gains[1]!.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
  });

  test('a stop before the sound loads leaves no source and no held caption', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    await act(async () => {
      const handle = result.current.loop('build', { id: 'meter' });
      handle.setGain(0.9);
      expect(captions.lines().at(-1)?.held).toBe(true);
      handle.stop(0);
      expect(captions.lines()).toEqual([]);
      for (let i = 0; i < 8; i++) await Promise.resolve();
      handle.setGain(0.9);
    });
    expect(sources).toHaveLength(0);
    expect(captions.lines()).toEqual([]);
  });

  test('a stop in the gap between the mixer\'s answer and its handle arriving still ends the source', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    let handle!: Loop;
    /* The mixer asks `cancelled` once, right after the file decodes and before it starts the source; a stop that comes from another microtask after that
       (here the source's own start) is past the mixer's check and reaches the handle before the page's `.then` has run. */
    const created = makeContext.getMockImplementation()!;
    makeContext.mockImplementationOnce(() => {
      const ctx = created();
      const make = ctx.createBufferSource;
      ctx.createBufferSource = () => { const s = make(); const start = s.start; s.start = vi.fn((...a: []) => { start(...a); handle.stop(0); }); return s; };
      return ctx;
    });
    resetSound({ makeContext, fetchBytes });
    on('game');
    await gesture();
    await act(async () => { handle = result.current.loop('build', { id: 'meter' }); });
    await vi.waitFor(() => { expect(sources).toHaveLength(1); expect(sources[0]!.stop).toHaveBeenCalled(); });
    expect(captions.lines()).toEqual([]);
  });

  test('a loop skipped for a bus that is off still holds and releases its game caption by gain', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    const handle = await loopLoaded(result.current, 'build', { id: 'meter' });
    act(() => handle.setGain(0.9));
    expect(captions.lines().at(-1)).toMatchObject({ text: 'build caption', held: true });
    act(() => handle.setGain(0));
    expect(captions.lines()).toEqual([]);
    act(() => handle.setGain(0.9));
    act(() => handle.stop(0));
    expect(captions.lines()).toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  test('a skipped interface loop holds no caption', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: withSlots([interfaceLoop]) });
    const handle = await loopLoaded(result.current, 'hum', { id: 'hum' });
    act(() => handle.setGain(0.9));
    expect(captions.lines()).toEqual([]);
  });

  test('a legacy context that decodes only through callbacks still sounds', async () => {
    resetSound({ makeContext: () => { const c = makeContext(); c.decodeAudioData = ((_b: ArrayBuffer, ok?: (b: { duration: number }) => void) => { ok?.({ duration: 1.5 }); }) as never; return c; }, fetchBytes });
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    let played: { lengthMs: number } | null = null;
    await act(async () => { played = await result.current.play('boo'); });
    expect(played).toEqual({ lengthMs: 1500 });
  });

  test('useSound adds the page listeners in an effect, not while rendering', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const { result } = renderHook(() => { const r = useSound(); return r; }, { wrapper: wrap });
    expect(result.current).toBeDefined();
    expect(add.mock.calls.some(([t]) => t === 'pointerdown')).toBe(true);
  });

  test('caption(key) says a slot\'s caption without playing it', () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    act(() => result.current.caption('boo'));
    expect(captions.lines().at(-1)?.text).toBe('boo caption');
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  test('an unknown key throws in development', () => {
    expect(import.meta.env.DEV).toBe(true);
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    expect(() => result.current.play('nope')).toThrow(/nope/);
    expect(() => result.current.loop('nope', { id: 'x' })).toThrow(/nope/);
    expect(() => result.current.caption('nope')).toThrow(/nope/);
  });

  test('an unknown key does nothing in production', async () => {
    vi.stubEnv('DEV', false);
    try {
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      expect(await result.current.play('nope')).toBeNull();
      expect(captions.lines()).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe('the page warms the sounds a screen names', () => {
  const warmSlots = [slot('a', 'game'), slot('b', 'game'), slot('c', 'game')];
  const warmWrap = withWarmSlots(warmSlots);
  function withWarmSlots(slots: SoundSlot[]) {
    return ({ children }: { readonly children: ReactNode }) => (
      <KayfaProvider value={{ ui: { sounds: { slots } } } as unknown as Kayfa}>{children}</KayfaProvider>
    );
  }

  test('useWarmSounds fetches the named sounds and no others, and makes no context before a gesture', () => {
    on('game');
    renderHook(() => useWarmSounds(['a', 'b']), { wrapper: warmWrap });
    expect(fetchBytes.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(['/a.mp3', '/b.mp3']);
    expect(makeContext).not.toHaveBeenCalled();
  });

  test('an unknown key is skipped and does not throw in development', () => {
    expect(import.meta.env.DEV).toBe(true);
    on('game');
    expect(() => renderHook(() => useWarmSounds(['a', 'nope']), { wrapper: warmWrap })).not.toThrow();
    expect(fetchBytes.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/a.mp3']);
  });

  test('rendering again with an equal but new array (and a new ui.sounds) does not warm again', () => {
    on('game');
    const { rerender } = renderHook(({ keys }: { keys: string[] }) => useWarmSounds(keys), { wrapper: warmWrap, initialProps: { keys: ['a', 'b'] } });
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(warmed.calls).toHaveLength(1);
    rerender({ keys: ['a', 'b'] });
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(warmed.calls).toHaveLength(1);
  });

  test('a changed key list warms the new keys', () => {
    on('game');
    const { rerender } = renderHook(({ keys }: { keys: string[] }) => useWarmSounds(keys), { wrapper: warmWrap, initialProps: { keys: ['a'] } });
    rerender({ keys: ['a', 'c'] });
    expect(warmed.calls).toEqual([['a'], ['a', 'c']]);
    expect(fetchBytes.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(['/a.mp3', '/c.mp3']);
  });

  test('a play the mixer answers late says the game caption for CAPTION_MS', async () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      resetSound({ makeContext, fetchBytes, now: () => (t += 1000) });
      on('game');
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      await gesture();
      let played: { lengthMs: number } | null = { lengthMs: 0 };
      await act(async () => { played = await result.current.play('boo', { lateMs: 10 }); });
      expect(played).toBeNull();
      expect(captions.lines().at(-1)).toMatchObject({ text: 'boo caption', held: false });
      act(() => { vi.advanceTimersByTime(CAPTION_MS - 1); });
      expect(captions.lines().at(-1)?.text).toBe('boo caption');
      act(() => { vi.advanceTimersByTime(2); });
      expect(captions.lines()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  test('the same play with no lateMs sounds', async () => {
    let t = 0;
    resetSound({ makeContext, fetchBytes, now: () => (t += 1000) });
    on('game');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture();
    let played: { lengthMs: number } | null = null;
    await act(async () => { played = await result.current.play('boo'); });
    expect(played).not.toBeNull();
  });

  test('a late play on the interface bus says no caption', async () => {
    let t = 0;
    resetSound({ makeContext, fetchBytes, now: () => (t += 1000) });
    on('interface');
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    await gesture();
    let played: { lengthMs: number } | null = { lengthMs: 0 };
    await act(async () => { played = await result.current.play('click', { lateMs: 10 }); });
    expect(played).toBeNull();
    expect(captions.lines()).toEqual([]);
  });

  test('no keys, or an empty list, warms nothing', () => {
    on('game');
    renderHook(() => useWarmSounds(undefined), { wrapper: warmWrap });
    renderHook(() => useWarmSounds([]), { wrapper: warmWrap });
    expect(warmed.calls).toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});
