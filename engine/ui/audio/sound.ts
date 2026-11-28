/**
 * The page's sound (docs/plans/2026-11-11-laugh-track-plan.md, Task 4): the one mixer, the gesture that unlocks it, the tab
 * that suspends it, the account's two sound settings reaching its buses, and the hooks the screens and cards use. It follows
 * `engine/ui/shine/tilt.ts`'s module shape: the screens that hold the account's preferences tell it through
 * `setSoundPreference`, and nothing is made until something uses it.
 *
 * The listeners (`pointerdown`, `pointerup`, `click`, `keydown`, `touchend` for the unlock, `visibilitychange` for suspend and resume) are added on
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
import { useCallback, useEffect, useMemo, useRef } from 'react';
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

/** What a stage holds the game bus at; the volume stays the preference's. */
export interface SoundStage {
  readonly gameSound: 'off' | 'on';
}

const GESTURES = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;

export interface SoundPage {
  readonly mixer: Mixer;
  setSoundPreference(p: SoundPreference): void;
  /** Hold the game bus at `gameSound` over the account's preference until the returned release is called (the front door's, see `stageSound`). */
  stageSound(s: SoundStage): () => void;
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
  /* Every gesture until one unlocks asks the mixer again: a browser that ignores a gesture (a modifier's keydown) or leaves its resume
     unanswered is asked again by the next, and a call made while another is out is harmless, because the mixer settles them together.
     The first success removes the listeners. */
  const onGesture = (): void => {
    void mixer.unlock().then((unlocked) => { if (unlocked) removeGestures(); });
  };
  const onVisibility = (): void => { void (document.hidden ? mixer.suspend() : mixer.resume()); };
  const arm = (): void => {
    if (armed || typeof document === 'undefined') return;
    armed = true;
    gesturing = true;
    for (const g of GESTURES) document.addEventListener(g, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  };
  /* The last preference told, and the stages held, oldest first; the newest stage's game setting wins over the preference's. */
  let preference: SoundPreference | null = null;
  const stages: SoundStage[] = [];
  const applyBuses = (): void => {
    const p = preference;
    const top = stages.at(-1);
    if (!p) {
      /* Before any preference is told, only a stage speaks: it sets whether the game bus is on, at full volume; with none held, the
         bus goes back to the mixer's default, off at full volume. */
      mixer.setBus('game', { on: top?.gameSound === 'on', volume: 100 });
      return;
    }
    mixer.setBus('game', { on: (top ? top.gameSound : p.gameSound) === 'on', volume: p.gameVolume });
    mixer.setBus('interface', { on: p.interfaceSound === 'on', volume: p.interfaceVolume });
  };
  return {
    mixer,
    setSoundPreference(p) {
      preference = p;
      applyBuses();
      arm();
    },
    stageSound(s) {
      const mine: SoundStage = { gameSound: s.gameSound };
      stages.push(mine);
      applyBuses();
      arm();
      return () => {
        const i = stages.indexOf(mine);
        if (i < 0) return;
        stages.splice(i, 1);
        applyBuses();
      };
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
    /* 'ambient' mixes with the person's music and follows the silent switch; 'playback' would sound through the switch but pause their music
       (docs/plans/2026-11-27-front-door-impact-design.md, section 1). Where there is no audioSession, or it refuses, nothing changes. */
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'ambient';
    } catch { /* the page's sound still works without it */ }
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
  now: () => performance.now(),
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

/**
 * The front door's own sound, held over the account's: it stages the game bus (the first page's sound is on, whatever a visitor's
 * preference says) and calls the release it gets when it unmounts. It is a layer, not a write, because a sign-in settles the account's
 * preference while the door is still mounted, and the door's unmount must not undo it: the release only takes the stage away, and the
 * bus goes to the last preference told, which is the account's. The newest stage held wins, a release removes only its own, and a
 * second call of it does nothing, so a StrictMode double effect leaks and over-releases nothing.
 */
export function stageSound(s: SoundStage): () => void {
  return page.stageSound(s);
}

export interface SoundPlay {
  /**
   * Plays the slot through the mixer and says its caption, or `caption` in its place when one is given (the slot's ink stays), on both the
   * sounded and the skipped path. Resolves with what the mixer answered (null when nothing sounded). A play
   * the mixer drops for being later than `lateMs` answers null like any skipped play, so it is captioned through the game-bus branch below.
   * `voices` is the group's cap: how many of its voices may sound at once (1 when it is not given), the oldest fading out to make room.
   */
  play(key: string, opts?: { group?: string; fadeMs?: number; tailMs?: number; lateMs?: number; voices?: number; caption?: string }): Promise<{ lengthMs: number } | null>;
  /**
   * Starts a loop and returns its handle at once; the handle works before the sound has loaded (a gain set meanwhile applies when it does, the
   * latest winning; a `stop` meanwhile means it never sounds). The loop starts silent, and `setGain` holds the slot's caption under `id` while
   * the gain is above `HELD_FROM`. A key the instance does not supply gives an inert handle (in production).
   */
  loop(key: string, opts: { group?: string; id: string }): LoopHandle;
  /** Says a slot's caption without playing it. */
  caption(key: string): void;
}

/** A key the instance does not supply: it throws in development, and in production does nothing. */
function missing(key: string): void {
  if (import.meta.env.DEV) throw new Error(`the instance's ui.sounds has no sound with the key "${key}"`);
}

/** What a loop of an unknown key returns: a handle that does nothing. */
const INERT: LoopHandle = { setGain() { /* nothing sounds */ }, stop() { /* nothing sounds */ } };

const wordsOf = (slot: SoundSlot, text: string = slot.caption) => ({ text, ...(slot.ink ? { ink: slot.ink } : {}) });

/**
 * Warm the sounds a screen or a card is about to use, so they are fetched (and decoded once the page unlocks) before anything plays
 * them (docs/plans/2026-11-17-sound-preload-design.md). A key the instance does not supply is skipped silently, since the instance's
 * own checks hold that there is none; this never throws, even in development. The effect depends on the keys joined, so a new array
 * of the same keys does not warm again.
 */
export function useWarmSounds(keys: readonly string[] | undefined): void {
  const sounds = useKayfa().ui.sounds;
  const joined = (keys ?? []).join('\n');
  /* The latest sounds, read when the effect runs; a new `ui.sounds` object of its own does not warm again. */
  const latest = useRef(sounds);
  latest.current = sounds;
  useEffect(() => {
    if (!joined) return;
    const wanted = new Set(joined.split('\n'));
    const slots = (latest.current?.slots ?? []).filter((s) => wanted.has(s.key));
    page.arm();
    page.mixer.warm(slots);
  }, [joined]);
}

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
        if (r) captions.say({ ...wordsOf(slot, opts?.caption), ms: r.lengthMs });
        else if (slot.bus === 'game') captions.say({ ...wordsOf(slot, opts?.caption), ms: CAPTION_MS });
        return r;
      });
    },
    loop(key, opts) {
      const slot = find(key);
      if (!slot) return INERT;
      /* The handle is made now and works before the sound has loaded: a gain set meanwhile is kept (the latest wins) and applied when the mixer
         answers, and a stop meanwhile means the source is never made (the mixer asks `cancelled` once it has decoded) and the caption is released.
         `live`: the caption follows the gain. A loop the mixer ended because its bus went off releases its caption; a game loop then stays
         captioned by gain alone (the captions-with-sound-off path, as a skipped one is), and an interface loop, or one that was stopped or
         replaced, is done. The caption shows iff the sound would be audible, or is captioned, at that gain. An interface loop is captioned only
         once it sounds, so until the mixer answers (and when it skips) its gain is kept but nothing is held. */
      let live = true;
      let stopped = false;
      let gain: number | null = null;
      let inner: LoopHandle | null = null;
      let answered = false;
      const caption = (): void => {
        if (!live || gain === null || (slot.bus !== 'game' && !inner)) return;
        if (gain > HELD_FROM) captions.hold(opts.id, wordsOf(slot));
        else captions.release(opts.id);
      };
      void page.mixer.loop(slot, {
        ...(opts.group === undefined ? {} : { group: opts.group }),
        cancelled: () => stopped,
        onStop: (why) => {
          captions.release(opts.id);
          if (why !== 'bus' || slot.bus !== 'game') live = false;
        },
      }).then((made) => {
        answered = true;
        if (stopped) { made?.stop(0); return; }
        inner = made;
        if (gain !== null) inner?.setGain(gain);
        if (!inner && slot.bus !== 'game') live = false;
        caption();
      });
      return {
        setGain(g) {
          if (stopped) return;
          gain = g;
          inner?.setGain(g);
          caption();
        },
        stop(fadeMs) {
          stopped = true;
          live = false;
          captions.release(opts.id);
          if (answered) inner?.stop(fadeMs);
        },
      };
    },
    caption(key) {
      const slot = find(key);
      if (slot) captions.say({ ...wordsOf(slot), ms: CAPTION_MS });
    },
  }), [find]);
}
