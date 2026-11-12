/**
 * The sound mixer: the one place the engine touches Web Audio (docs/plans/2026-11-11-laugh-track-plan.md, Task 2). It is
 * written against injected parts, `makeContext` (the narrow `AudioContextLike` slice it uses) and `fetchBytes`, so it runs
 * under node with no browser, and the page hands it the real ones.
 *
 * `play` and `loop` return promises, not values: a sound is fetched and decoded before it sounds, and both are async, so the
 * plan's `{ lengthMs } | null` is a promise of it. Nothing is queued: a call before `unlock()`, or on a bus that is off,
 * resolves null at once and fetches nothing. A file is fetched and decoded once a page; a failure resolves null for that
 * play and is tried again on the next, and the mixer never throws into its caller.
 *
 * `fadeMs` on `play` is the cross-fade between sounds of one group, so it does nothing without a `group`: a sound in no group
 * overlaps whatever else sounds. No voice ever steps, though: a voice starts at 0 and ramps to its level, and ramps back to 0 when
 * it ends or is replaced, over at least `EDGE_MS`, because a level that jumps is a click in the speaker. A play may ask for a `tailMs`,
 * a fade to nothing over the last of its file, so a take ends by fading, not by stopping. A bus's volume moves to its new level over
 * a few milliseconds for the same reason. Each slot's `gain` multiplies the level its voice ramps to, so an instance levels its files
 * against each other (a gain that is not a finite number above 0 is read as 1).
 *
 * Engine code: it names no card and no instance.
 */
import type { SoundBus, SoundSlot } from './types.ts';
/** The shortest ramp any voice gets in or out, in milliseconds. */
export const EDGE_MS = 8;
export interface AudioParamLike { value: number; cancelScheduledValues(t: number): unknown; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown; setTargetAtTime(v: number, t: number, c: number): unknown }
export interface GainNodeLike { gain: AudioParamLike; connect(to: unknown): unknown; disconnect(): unknown }
export interface SourceLike { buffer: unknown; loop: boolean; onended: (() => void) | null; connect(to: unknown): unknown; disconnect(): unknown; start(when?: number): unknown; stop(when?: number): unknown }
export interface AudioContextLike {
  readonly currentTime: number; readonly destination: unknown;
  resume(): Promise<void>; suspend(): Promise<void>;
  /** The promise form, or the legacy callback form (old WebKit) that returns nothing: the mixer takes either. */
  decodeAudioData(bytes: ArrayBuffer, ok?: (b: { readonly duration: number }) => void, fail?: (e: unknown) => void): Promise<{ readonly duration: number }> | void;
  createGain(): GainNodeLike; createBufferSource(): SourceLike;
}
export interface MixerDeps { makeContext(): AudioContextLike; fetchBytes(src: string): Promise<ArrayBuffer> }
/** Why a loop ended: its own `stop`, its bus turned off, or another sound of its group replacing it. */
export type LoopStop = 'stopped' | 'bus' | 'replaced';
export interface LoopHandle { setGain(g: number): void; stop(fadeMs: number): void }
export interface Mixer {
  setBus(bus: SoundBus, s: { on: boolean; volume: number }): void;
  /** Resolves whether the mixer is now unlocked: false when the browser refused, so the next gesture may try again. */
  unlock(): Promise<boolean>; suspend(): Promise<void>; resume(): Promise<void>;
  play(slot: SoundSlot, o?: { group?: string; fadeMs?: number; tailMs?: number }): Promise<{ lengthMs: number } | null>;
  /**
   * A loop starts at gain 0, silent until its owner's `setGain` raises it. `cancelled` is asked once the sound is decoded: true resolves null
   * with no source made and no group voice replaced, for an owner that gave up while the file loaded.
   */
  loop(slot: SoundSlot, o?: { group?: string; onStop?: (why: LoopStop) => void; cancelled?: () => boolean }): Promise<LoopHandle | null>;
}
export function createMixer(deps: MixerDeps): Mixer {
  /** The context once made; `ctx` is the same context once it has resumed, and only then may anything sound. */
  let made: AudioContextLike | null = null;
  let ctx: AudioContextLike | null = null;
  const buses: Record<SoundBus, { on: boolean; volume: number; node: GainNodeLike | null }> = {
    game: { on: false, volume: 100, node: null },
    interface: { on: false, volume: 100, node: null },
  };
  const loops: Record<SoundBus, Set<(why: LoopStop) => void>> = { game: new Set(), interface: new Set() };
  /** A group's current voice, and the way to end it over `fadeMs` (a play fades out, a loop stops). */
  const groups = new Map<string, { source: SourceLike; end(fadeMs: number): void }>();
  const buffers = new Map<string, Promise<{ readonly duration: number } | null>>();

  const level = (b: SoundBus): number => (buses[b].on ? Math.min(Math.max(buses[b].volume, 0), 100) / 100 : 0);
  /** A slot's own level: its `gain`, or 1 when it has none or it is not a finite number above 0. */
  const gainOf = (slot: SoundSlot): number => (typeof slot.gain === 'number' && Number.isFinite(slot.gain) && slot.gain > 0 ? slot.gain : 1);
  function busNode(c: AudioContextLike, b: SoundBus): GainNodeLike {
    let node = buses[b].node;
    if (!node) {
      node = c.createGain();
      node.gain.value = level(b);
      node.connect(c.destination);
      buses[b].node = node;
    }
    return node;
  }
  /** Decode with either form of the API: a promise, or the callbacks an old WebKit context takes instead. */
  function decode(c: AudioContextLike, bytes: ArrayBuffer): Promise<{ readonly duration: number }> {
    return new Promise((resolve, reject) => {
      const r = c.decodeAudioData(bytes, resolve, reject);
      if (r && typeof r.then === 'function') r.then(resolve, reject);
    });
  }
  function decoded(c: AudioContextLike, src: string): Promise<{ readonly duration: number } | null> {
    let pending = buffers.get(src);
    if (!pending) {
      pending = deps.fetchBytes(src).then((bytes) => decode(c, bytes)).catch(() => {
        buffers.delete(src);
        return null;
      });
      buffers.set(src, pending);
    }
    return pending;
  }
  /** Fade a voice out over `fadeMs` and stop its source then; the source's end disconnects both. */
  function fadeOut(c: AudioContextLike, voice: GainNodeLike, source: SourceLike, fadeMs: number): void {
    const now = c.currentTime;
    const at = now + Math.max(fadeMs, EDGE_MS) / 1000;
    voice.gain.cancelScheduledValues(now);
    voice.gain.setValueAtTime(voice.gain.value, now);
    voice.gain.linearRampToValueAtTime(0, at);
    source.stop(at);
  }
  /**
   * Build a voice (source through its own gain into the bus) for a decoded buffer, started now. It always starts at 0. A play ramps to the
   * slot's level over `fadeInMs` (at least `EDGE_MS`, at most half the file) and then, over its last `tailMs` (at least `EDGE_MS`), back to 0.
   * The tail never starts inside the fade-in: it starts at the later of "`tailMs` before the end" and "the end of the ramp up", so a tail as
   * long as the file, or a file shorter than fade-in plus tail, still ramps up fully and then down, and neither is a step (a level set at the
   * start of the fade-in would be the click the ramps exist to remove). A loop gets no ramp up and no tail, and stays silent until its owner's `setGain`.
   */
  function start(c: AudioContextLike, slot: SoundSlot, buffer: { readonly duration: number }, looped: boolean, fadeInMs: number, tailMs = 0) {
    const bus = busNode(c, slot.bus);
    const source = c.createBufferSource();
    const voice = c.createGain();
    source.buffer = buffer;
    source.loop = looped;
    const now = c.currentTime;
    voice.gain.setValueAtTime(0, now);
    if (!looped) {
      const level = gainOf(slot);
      const end = now + buffer.duration;
      const fadeIn = Math.min(Math.max(fadeInMs, EDGE_MS) / 1000, buffer.duration / 2);
      const tail = Math.max(tailMs, EDGE_MS) / 1000;
      const rampedUp = now + fadeIn;
      voice.gain.linearRampToValueAtTime(level, rampedUp);
      voice.gain.setValueAtTime(level, Math.max(end - tail, rampedUp));
      voice.gain.linearRampToValueAtTime(0, end);
    }
    source.connect(voice);
    voice.connect(bus);
    source.onended = () => { source.disconnect(); voice.disconnect(); };
    source.start();
    return { source, voice };
  }
  /** Both entry points' shared gate: null where nothing may sound, else the context and the decoded buffer. */
  async function ready(slot: SoundSlot) {
    const c = ctx;
    if (!c || !buses[slot.bus].on) return null;
    const buffer = await decoded(c, slot.src);
    if (!buffer || ctx !== c || !buses[slot.bus].on) return null;
    return { c, buffer };
  }

  return {
    setBus(bus, s) {
      buses[bus].on = s.on;
      buses[bus].volume = s.volume;
      const node = buses[bus].node;
      if (node && made) {
        const now = made.currentTime;
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.setTargetAtTime(level(bus), now, 0.015);
      } else if (node) node.gain.value = level(bus);
      if (!s.on) for (const end of [...loops[bus]]) end('bus');
    },
    async unlock() {
      try {
        made ??= deps.makeContext();
        await made.resume();
        ctx = made;
        return true;
      } catch { /* a browser that refuses leaves the mixer locked; the next gesture tries again */ return false; }
    },
    async suspend() { try { await made?.suspend(); } catch { /* nothing to suspend */ } },
    async resume() { try { await made?.resume(); } catch { /* nothing to resume */ } },
    async play(slot, o = {}) {
      try {
        const r = await ready(slot);
        if (!r) return null;
        const { c, buffer } = r;
        const fadeMs = o.fadeMs ?? 0;
        const prior = o.group === undefined ? undefined : groups.get(o.group);
        if (prior) prior.end(fadeMs);
        const { source, voice } = start(c, slot, buffer, false, o.group === undefined ? 0 : fadeMs, o.tailMs);
        if (o.group !== undefined) {
          const group = o.group;
          groups.set(group, { source, end: (ms) => fadeOut(c, voice, source, ms) });
          const done = source.onended;
          source.onended = () => { done?.(); if (groups.get(group)?.source === source) groups.delete(group); };
        }
        return { lengthMs: Math.round(buffer.duration * 1000) };
      } catch { return null; }
    },
    async loop(slot, o = {}) {
      try {
        const r = await ready(slot);
        if (!r || o.cancelled?.()) return null;
        const { c, buffer } = r;
        const prior = o.group === undefined ? undefined : groups.get(o.group);
        if (prior) prior.end(0);
        const { source, voice } = start(c, slot, buffer, true, 0);
        let stopped = false;
        const end = (why: LoopStop, fadeMs: number): void => {
          if (stopped) return;
          stopped = true;
          loops[slot.bus].delete(endNow);
          if (o.group !== undefined && groups.get(o.group)?.source === source) groups.delete(o.group);
          fadeOut(c, voice, source, fadeMs);
          o.onStop?.(why);
        };
        const endNow = (why: LoopStop): void => end(why, 0);
        const handle: LoopHandle = {
          setGain(g) {
            if (stopped) return;
            const now = c.currentTime;
            voice.gain.cancelScheduledValues(now);
            voice.gain.setValueAtTime(voice.gain.value, now);
            voice.gain.setTargetAtTime(Math.min(Math.max(g, 0), 1) * gainOf(slot), now, 0.05);
          },
          stop(fadeMs) { end('stopped', fadeMs); },
        };
        loops[slot.bus].add(endNow);
        if (o.group !== undefined) groups.set(o.group, { source, end: (ms) => end('replaced', ms) });
        return handle;
      } catch { return null; }
    },
  };
}
