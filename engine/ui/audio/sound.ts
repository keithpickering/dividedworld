/**
 * The page's sound (docs/plans/2026-11-11-laugh-track-plan.md, Task 4): the one mixer, the gesture that unlocks it, the tab
 * that suspends it, the account's two sound settings reaching its buses, and the hooks the screens and cards use. It follows
 * `engine/ui/shine/tilt.ts`'s module shape: the screens that hold the account's preferences tell it through
 * `setSoundPreference`, and nothing is made until something uses it.
 *
 * The listeners (`pointerdown`, `keydown`, `touchend` for the unlock, `visibilitychange` for suspend and resume) are added on
 * first use, the unlock ones removed after the first gesture, so a page that never uses sound starts nothing.
 *
 * A caption is said once a play resolves, because a play is async (a file is fetched and decoded before it sounds): for the
 * length of the sound if it sounded, and for `CAPTION_MS` if it was skipped (locked, its bus off, a failed load) and it is a
 * game sound. An interface sound's caption is said only when it sounds; the design leaves this open until the first interface
 * sound. A skipped play resolves at once (nothing is fetched), so its caption appears at once; a sound that sounds says it as
 * it starts. A loop's caption is held while its gain is above `HELD_FROM`, and a skipped game loop still holds it.
 *
 * `createSound(deps)` makes an instance with its own mixer and listeners, for tests; the module's own instance uses the real
 * `AudioContext` and `fetch`, and `resetSound(deps)` swaps it for a fresh one (a test's).
 *
 * Engine code: it names no card and no instance.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { captions } from './captions.ts';
import { createMixer, type AudioContextLike, type LoopHandle, type Mixer, type MixerDeps } from './mixer.ts';
import type { SoundSlot } from './types.ts';

/** How long a skipped game sound's caption shows, in milliseconds. */
export const CAPTION_MS = 2500;
/** A loop's caption is held while its gain is above this, and released below it. */
export const HELD_FROM = 0.15;

export interface SoundPreference {
  readonly gameSound: 'off' | 'on';
  readonly gameVolume: number;
  readonly interfaceSound: 'off' | 'on';
  readonly interfaceVolume: number;
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

export interface SoundPage {
  readonly mixer: Mixer;
  setSoundPreference(p: SoundPreference): void;
  /** Add the listeners, once; called by everything that uses the page's sound. */
  arm(): void;
  /** Remove every listener, for a test. */
  dispose(): void;
}

export function createSound(deps: MixerDeps): SoundPage {
  const mixer = createMixer(deps);
  let armed = false;
  let gesturing = false;
  const removeGestures = (): void => {
    if (!gesturing) return;
    gesturing = false;
    for (const g of GESTURES) document.removeEventListener(g, onGesture, true);
  };
  /* The listeners stay until an unlock succeeds: a browser that ignores a gesture (a modifier's keydown) is asked again by the next. */
  let unlocking = false;
  const onGesture = (): void => {
    if (unlocking) return;
    unlocking = true;
    void mixer.unlock().then((unlocked) => { unlocking = false; if (unlocked) removeGestures(); });
  };
  const onVisibility = (): void => { void (document.hidden ? mixer.suspend() : mixer.resume()); };
  const arm = (): void => {
    if (armed || typeof document === 'undefined') return;
    armed = true;
    gesturing = true;
    for (const g of GESTURES) document.addEventListener(g, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  };
  return {
    mixer,
    setSoundPreference(p) {
      mixer.setBus('game', { on: p.gameSound === 'on', volume: p.gameVolume });
      mixer.setBus('interface', { on: p.interfaceSound === 'on', volume: p.interfaceVolume });
      arm();
    },
    arm,
    dispose() {
      removeGestures();
      document.removeEventListener('visibilitychange', onVisibility);
      armed = false;
    },
  };
}

const realDeps: MixerDeps = {
  makeContext: () => {
    const w = window as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) throw new Error('this browser has no Web Audio');
    return new Ctx();
  },
  fetchBytes: async (src) => {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`the sound ${src} answered ${r.status}`);
    return r.arrayBuffer();
  },
};

let page = createSound(realDeps);

/** For tests: drop the page's sound and make a fresh one over these deps (the real ones with none). */
export function resetSound(deps: MixerDeps = realDeps): void {
  page.dispose();
  page = createSound(deps);
}

/** The screens that hold the account's preferences say it here when it is read or changed. */
export function setSoundPreference(p: SoundPreference): void {
  page.setSoundPreference(p);
}

export interface SoundPlay {
  /** Plays the slot through the mixer and says its caption. Resolves with what the mixer answered (null when nothing sounded). */
  play(key: string, opts?: { group?: string; fadeMs?: number }): Promise<{ lengthMs: number } | null>;
  /** Starts a loop; its handle's `setGain` holds the slot's caption under `id` while the gain is above `HELD_FROM`. */
  loop(key: string, opts: { group?: string; id: string }): Promise<LoopHandle | null>;
  /** Says a slot's caption without playing it. */
  caption(key: string): void;
}

/** A key the instance does not supply: it throws in development, and in production does nothing. */
function missing(key: string): void {
  if (import.meta.env.DEV) throw new Error(`the instance's ui.sounds has no sound with the key "${key}"`);
}

const wordsOf = (slot: SoundSlot) => ({ text: slot.caption, ...(slot.ink ? { ink: slot.ink } : {}) });

export function useSound(): SoundPlay {
  const sounds = useKayfa().ui.sounds;
  useEffect(() => { page.arm(); }, []);
  const slots = useMemo(() => new Map((sounds?.slots ?? []).map((s) => [s.key, s] as const)), [sounds]);
  const find = useCallback((key: string): SoundSlot | undefined => {
    const s = slots.get(key);
    if (!s) missing(key);
    return s;
  }, [slots]);
  return useMemo<SoundPlay>(() => ({
    play(key, opts) {
      const slot = find(key);
      if (!slot) return Promise.resolve(null);
      return page.mixer.play(slot, opts).then((r) => {
        if (r) captions.say({ ...wordsOf(slot), ms: r.lengthMs });
        else if (slot.bus === 'game') captions.say({ ...wordsOf(slot), ms: CAPTION_MS });
        return r;
      });
    },
    loop(key, opts) {
      const slot = find(key);
      if (!slot) return Promise.resolve(null);
      /* `live`: the caption follows the gain. A loop the mixer ended because its bus went off releases its caption; a game loop then stays
         captioned by gain alone (the captions-with-sound-off path, as a skipped one is), and an interface loop, or one that was stopped or
         replaced, is done. The caption shows iff the sound would be audible, or is captioned, at that gain. */
      let live = true;
      let inner: LoopHandle | null = null;
      return page.mixer.loop(slot, { ...(opts.group === undefined ? {} : { group: opts.group }), onStop: (why) => {
        captions.release(opts.id);
        if (why !== 'bus' || slot.bus !== 'game') live = false;
      } }).then((made) => {
        inner = made;
        /* A skipped game loop is still captioned, as a skipped game sound is; a skipped interface loop is not. */
        if (!inner && slot.bus !== 'game') return null;
        const handle: LoopHandle = {
          setGain(g) {
            inner?.setGain(g);
            if (!live) return;
            if (g > HELD_FROM) captions.hold(opts.id, wordsOf(slot));
            else captions.release(opts.id);
          },
          stop(fadeMs) {
            live = false;
            captions.release(opts.id);
            inner?.stop(fadeMs);
          },
        };
        return handle;
      });
    },
    caption(key) {
      const slot = find(key);
      if (slot) captions.say({ ...wordsOf(slot), ms: CAPTION_MS });
    },
  }), [find]);
}
