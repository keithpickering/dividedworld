/**
 * The page sound (Laugh Track plan, Task 4), with the mixer's deps faked: no context before a gesture; a game sound with its bus off
 * says its caption and fetches nothing; a gesture unlocks once; a hidden tab suspends; the preference reaches the buses; an unknown key
 * throws in development.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { captions } from './captions.ts';
import { CAPTION_MS, HELD_FROM, resetSound, setSoundPreference, useGameSound, useSound } from './sound.ts';
import type { AudioContextLike, GainNodeLike, SourceLike } from './mixer.ts';
import type { SoundSlot } from './types.ts';

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
const gesture = (type = 'pointerdown') => act(async () => { document.dispatchEvent(new Event(type, { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  gains = []; sources = [];
  makeContext.mockClear(); fetchBytes.mockClear();
  resetSound({ makeContext, fetchBytes });
  captions.reset();
});
afterEach(() => { vi.restoreAllMocks(); captions.reset(); });

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
      expect(captions.current()).toMatchObject({ text: 'boo caption', ink: 'red', held: false });
      act(() => { vi.advanceTimersByTime(CAPTION_MS - 1); });
      expect(captions.current()?.text).toBe('boo caption');
      act(() => { vi.advanceTimersByTime(2); });
      expect(captions.current()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  test('an interface sound that is skipped says nothing; one that sounds says its caption for its length', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSound(), { wrapper: wrap });
      await act(async () => { await result.current.play('click'); });
      expect(captions.current()).toBeNull();
      on('interface');
      await gesture();
      await act(async () => { await result.current.play('click'); });
      expect(captions.current()?.text).toBe('click caption');
      act(() => { vi.advanceTimersByTime(1499); });
      expect(captions.current()?.text).toBe('click caption');
      act(() => { vi.advanceTimersByTime(2); });
      expect(captions.current()).toBeNull();
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
    expect(gains[0]!.gain.value).toBe(0);
  });

  test('a loop holds its caption while the gain is above HELD_FROM and releases it below', async () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    on('game');
    await gesture();
    let handle: Awaited<ReturnType<ReturnType<typeof useSound>['loop']>> = null;
    await act(async () => { handle = await result.current.loop('build', { id: 'meter' }); });
    expect(handle).not.toBeNull();
    act(() => handle!.setGain(HELD_FROM + 0.1));
    expect(captions.current()).toMatchObject({ text: 'build caption', held: true });
    act(() => handle!.setGain(HELD_FROM - 0.05));
    expect(captions.current()).toBeNull();
    act(() => handle!.setGain(0.9));
    act(() => handle!.stop(0));
    expect(captions.current()).toBeNull();
  });

  test('caption(key) says a slot\'s caption without playing it', () => {
    const { result } = renderHook(() => useSound(), { wrapper: wrap });
    act(() => result.current.caption('boo'));
    expect(captions.current()?.text).toBe('boo caption');
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
      expect(captions.current()).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });

  test('useGameSound reads the account\'s choice and saves a change through the settings saver', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    let latest: ReturnType<typeof useGameSound> | null = null;
    function Probe() { latest = useGameSound(); return <p>{latest.on ? 'sound on' : 'sound off'}</p>; }
    const { findByText } = renderIn(fake, <Probe />);
    await findByText('sound off');
    /* A change before the account's choices are read is ignored, so ask until the screen shows it. */
    await waitFor(() => { act(() => latest!.set(true)); expect(document.body.textContent).toBe('sound on'); });
    await findByText('sound on');
  });
});
