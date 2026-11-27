/**
 * The sound mixer: the one place the engine touches Web Audio (docs/plans/2026-11-11-laugh-track-plan.md, Task 2). It is
 * written against injected parts, `makeContext` (the narrow `AudioContextLike` slice it uses) and `fetchBytes`, so it runs
 * under node with no browser, and the page hands it the real ones.
 *
 * `play` and `loop` return promises, not values: a sound is fetched and decoded before it sounds, and both are async, so the
 * plan's `{ lengthMs } | null` is a promise of it. Nothing is queued: a call before `unlock()`, or on a bus that is off,
 * resolves null at once and fetches nothing. A file is fetched and decoded once a page, by a play or by `warm`; a failure resolves
 * null for that play and is tried again on the next, and the mixer never throws into its caller. `warm` fetches at once and decodes
 * at the first unlock (once unlocked, at once), and a bus that is off fetches nothing until it is turned on. A play may ask for a
 * `lateMs`: if its sound cannot start within that long of the call, it is dropped and resolves null rather than sounding late. A
 * `lateMs` of 0 or less drops a play that had to wait at all (a file already decoded, with the clock unmoved, still sounds), and one that is not a finite number is ignored.
 *
 * `fadeMs` on `play` is the cross-fade between sounds of one group, so it does nothing without a `group`. A group holds up to `voices`
 * voices (1 when the play names none) and fades out its oldest to make room for a new one; a sound in no group overlaps whatever else
 * sounds. The two buses meet in a limiter before the speakers, so overlapping sounds press down instead of clipping, and a sound at or under
 * -1 dBFS passes it unchanged (where a context cannot make one, the buses go straight to the speakers). No voice ever steps, though: a voice starts at 0 and ramps to its level, and ramps back to 0 when
 * it ends or is replaced, over at least `EDGE_MS`, because a level that jumps is a click in the speaker. A play may ask for a `tailMs`,
 * a fade to nothing over the last of its file, so a take ends by fading, not by stopping. A bus's volume moves to its new level over
 * a few milliseconds for the same reason. Each slot's `gain` multiplies the level its voice ramps to, so an instance levels its files
 * against each other (a gain that is not a finite number above 0 is read as 1). A level the caller hands in that is not a finite number (a bus's volume, a loop's `setGain`) is read as 0, since a param throws on it.
 *
 * Engine code: it names no card and no instance.
 */
import type { SoundBus, SoundSlot } from './types.ts';
/** The shortest ramp any voice gets in or out, in milliseconds. */
export const EDGE_MS = 8;
/** The limiter's settings: a sound at or under its threshold passes unchanged, and a pile of them is pressed down instead of clipping. */
export const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 } as const;
export interface AudioParamLike { value: number; cancelScheduledValues(t: number): unknown; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown; setTargetAtTime(v: number, t: number, c: number): unknown }
export interface GainNodeLike { gain: AudioParamLike; connect(to: unknown): unknown; disconnect(): unknown }
export interface CompressorLike { threshold: { value: number }; knee: { value: number }; ratio: { value: number }; attack: { value: number }; release: { value: number }; connect(to: unknown): unknown; disconnect(): unknown }
export interface SourceLike { buffer: unknown; loop: boolean; onended: (() => void) | null; connect(to: unknown): unknown; disconnect(): unknown; start(when?: number): unknown; stop(when?: number): unknown }
export interface AudioContextLike {
  readonly currentTime: number; readonly destination: unknown;
  /** The context's own state (`'running'` once it sounds); a browser may run it before the `resume()` promise settles, or never settle it. */
  readonly state?: string;
  resume(): Promise<void>; suspend(): Promise<void>;
  /** The promise form, or the legacy callback form (old WebKit) that returns nothing: the mixer takes either. */
  decodeAudioData(bytes: ArrayBuffer, ok?: (b: { readonly duration: number }) => void, fail?: (e: unknown) => void): Promise<{ readonly duration: number }> | void;
  createGain(): GainNodeLike; createBufferSource(): SourceLike;
  /** Absent on an old WebKit: the buses then connect straight to the destination. */
  createDynamicsCompressor?(): CompressorLike;
}
export interface MixerDeps { makeContext(): AudioContextLike; fetchBytes(src: string): Promise<ArrayBuffer>; now?: () => number }
/** Why a loop ended: its own `stop`, its bus turned off, or another sound of its group replacing it. */
export type LoopStop = 'stopped' | 'bus' | 'replaced';
export interface LoopHandle { setGain(g: number): void; stop(fadeMs: number): void }
export interface Mixer {
  setBus(bus: SoundBus, s: { on: boolean; volume: number }): void;
  /**
   * Resolves whether the mixer is now unlocked: false when the browser refused, so the next gesture may try again. Each call asks the context to
   * resume, synchronously, so it is inside the gesture; a context already `'running'` after that is unlocked at once, and any resume that resolves
   * unlocks the mixer and settles every call still waiting (a resume the browser never answers is then no one's problem).
   */
  unlock(): Promise<boolean>; suspend(): Promise<void>; resume(): Promise<void>;
  warm(slots: readonly SoundSlot[]): void;
  play(slot: SoundSlot, o?: { group?: string; fadeMs?: number; tailMs?: number; lateMs?: number; voices?: number }): Promise<{ lengthMs: number } | null>;
  /**
   * A loop starts at gain 0, silent until its owner's `setGain` raises it. `cancelled` is asked once the sound is decoded: true resolves null
   * with no source made and no group voice replaced, for an owner that gave up while the file loaded.
   */
  loop(slot: SoundSlot, o?: { group?: string; onStop?: (why: LoopStop) => void; cancelled?: () => boolean }): Promise<LoopHandle | null>;
}
interface Voice { source: SourceLike; end(fadeMs: number): void }
export function createMixer(deps: MixerDeps): Mixer {
  /** The context once made; `ctx` is the same context once it has resumed, and only then may anything sound. */
  let made: AudioContextLike | null = null;
  let ctx: AudioContextLike | null = null;
  /** The unlock() calls whose resume has not answered yet; the first resume that resolves (or a context seen running) settles them all as unlocked. */
  const waiting = new Set<(unlocked: boolean) => void>();
  const buses: Record<SoundBus, { on: boolean; volume: number; node: GainNodeLike | null }> = {
    game: { on: false, volume: 100, node: null },
    interface: { on: false, volume: 100, node: null },
  };
  const loops: Record<SoundBus, Set<(why: LoopStop) => void>> = { game: new Set(), interface: new Set() };
  /** A group's voices, oldest first, each with the way to end it over `fadeMs` (a play fades out, a loop stops). A voice leaves the list when its source ends. A play's fade-out ends by its file's end, but never takes less than `EDGE_MS`, so a play replaced in its last few milliseconds outlasts its file by up to that. */
  const groups = new Map<string, Voice[]>();
  /** The output both buses connect to, by context: the limiter, or the destination where there is none. */
  const outputs = new WeakMap<AudioContextLike, unknown>();
  /** A file's fetch, by src; it needs no context. `decodeAudioData` detaches the bytes it is given, so an entry goes once its decode starts. */
  const bytes = new Map<string, Promise<ArrayBuffer | null>>();
  /** A file's decode, by src; filled only once a context exists. */
  const buffers = new Map<string, Promise<{ readonly duration: number } | null>>();
  /** Every slot `warm` was asked for, by bus and src together (two slots may share a src on different buses, and keyed by src alone one would hide the other from its bus turning on), so a bus turned on or an unlock can warm them again. */
  const warmed = new Map<string, SoundSlot>();
  /** The mixer's clock in milliseconds (the context's own clock, in seconds, is always `c.currentTime`). */
  const clockMs = deps.now ?? (() => performance.now());

  /** A bus's level: 0 when it is off or its volume is not a finite number (a NaN handed to a param throws), else the volume over 100, clamped to 0..1. */
  const level = (b: SoundBus): number => (buses[b].on && Number.isFinite(buses[b].volume) ? Math.min(Math.max(buses[b].volume, 0), 100) / 100 : 0);
  /** A slot's own level: its `gain`, or 1 when it has none or it is not a finite number above 0. */
  const gainOf = (slot: SoundSlot): number => (typeof slot.gain === 'number' && Number.isFinite(slot.gain) && slot.gain > 0 ? slot.gain : 1);
  /** What the buses connect to, made once a context: a limiter into the destination, or the destination itself where the context cannot make one or it throws. */
  function output(c: AudioContextLike): unknown {
    if (outputs.has(c)) return outputs.get(c);
    let out: unknown = c.destination;
    try {
      const comp = c.createDynamicsCompressor?.();
      if (comp) {
        for (const k of Object.keys(LIMITER) as Array<keyof typeof LIMITER>) comp[k].value = LIMITER[k];
        comp.connect(c.destination);
        out = comp;
      }
    } catch { out = c.destination; }
    outputs.set(c, out);
    return out;
  }
  /** Take a voice out of its group's list, by its source, and drop the group when it is empty. */
  function leave(group: string, source: SourceLike): void {
    const list = groups.get(group);
    if (!list) return;
    const rest = list.filter((v) => v.source !== source);
    if (rest.length) groups.set(group, rest); else groups.delete(group);
  }
  function busNode(c: AudioContextLike, b: SoundBus): GainNodeLike {
    let node = buses[b].node;
    if (!node) {
      node = c.createGain();
      node.gain.value = level(b);
      node.connect(output(c));
      buses[b].node = node;
    }
    return node;
  }
  /** Decode with either form of the API: a promise, or the callbacks an old WebKit context takes instead. */
  function decode(c: AudioContextLike, data: ArrayBuffer): Promise<{ readonly duration: number }> {
    return new Promise((resolve, reject) => {
      const r = c.decodeAudioData(data, resolve, reject);
      if (r && typeof r.then === 'function') r.then(resolve, reject);
    });
  }
  /** The file's bytes: the fetch under way or done, else a new one. A failure forgets both caches for the src, so the next call fetches again. */
  function fetched(src: string): Promise<ArrayBuffer | null> {
    let pending = bytes.get(src);
    if (!pending) {
      pending = deps.fetchBytes(src).catch(() => {
        bytes.delete(src);
        buffers.delete(src);
        return null;
      });
      bytes.set(src, pending);
    }
    return pending;
  }
  function decoded(c: AudioContextLike, src: string): Promise<{ readonly duration: number } | null> {
    let pending = buffers.get(src);
    if (!pending) {
      pending = fetched(src).then((b) => {
        if (!b) return null;
        bytes.delete(src);
        return decode(c, b);
      }).catch(() => {
        bytes.delete(src);
        buffers.delete(src);
        return null;
      });
      buffers.set(src, pending);
    }
    return pending;
  }
  /** The mixer is unlocked: the context may sound, the warmed files decode, and every unlock() still waiting is answered true. */
  function open(c: AudioContextLike): void {
    if (!ctx) {
      ctx = c;
      for (const slot of warmed.values()) warmSlot(slot);
    }
    const settle = [...waiting];
    waiting.clear();
    for (const w of settle) w(true);
  }
  /** Fetch a warmed slot's bytes if nothing holds its src, and decode it if there is a context. Never throws, makes no context. */
  function warmSlot(slot: SoundSlot): void {
    try {
      if (!buses[slot.bus].on) return;
      if (ctx) void decoded(ctx, slot.src);
      else if (!bytes.has(slot.src) && !buffers.has(slot.src)) void fetched(slot.src);
    } catch { /* a warm never throws */ }
  }
  /**
   * Fade a voice out over `fadeMs` and stop its source then; the source's end disconnects both, once, whichever of the natural end or this
   * stop comes first. A played voice has a natural end (`naturalEnd`, on the context's clock) and its source stops there on its own, so
   * the ramp is shortened to finish by it: a ramp still partway down when the source ends is a click. The ramp is never shorter than
   * `EDGE_MS`, so a voice replaced in its last few milliseconds, or after its end, still ramps over a real interval. A loop has no end.
   */
  function fadeOut(c: AudioContextLike, voice: GainNodeLike, source: SourceLike, fadeMs: number, naturalEnd?: number): void {
    const now = c.currentTime;
    const edge = EDGE_MS / 1000;
    const wanted = Math.max(fadeMs, EDGE_MS) / 1000;
    const at = now + (naturalEnd === undefined ? wanted : Math.min(wanted, Math.max(naturalEnd - now, edge)));
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
   * A play also returns its natural end (a loop has none), which a later fade-out needs.
   */
  function start(c: AudioContextLike, slot: SoundSlot, buffer: { readonly duration: number }, looped: boolean, fadeInMs: number, tailMs = 0) {
    const bus = busNode(c, slot.bus);
    const source = c.createBufferSource();
    const voice = c.createGain();
    source.buffer = buffer;
    source.loop = looped;
    const now = c.currentTime;
    voice.gain.setValueAtTime(0, now);
    const naturalEnd = looped ? undefined : now + buffer.duration;
    if (naturalEnd !== undefined) {
      const level = gainOf(slot);
      const fadeIn = Math.min(Math.max(fadeInMs, EDGE_MS) / 1000, buffer.duration / 2);
      const tail = Math.max(tailMs, EDGE_MS) / 1000;
      const rampedUp = now + fadeIn;
      voice.gain.linearRampToValueAtTime(level, rampedUp);
      voice.gain.setValueAtTime(level, Math.max(naturalEnd - tail, rampedUp));
      voice.gain.linearRampToValueAtTime(0, naturalEnd);
    }
    source.connect(voice);
    voice.connect(bus);
    source.onended = () => { source.disconnect(); voice.disconnect(); };
    source.start();
    return { source, voice, naturalEnd };
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
    warm(slots) {
      for (const slot of slots) {
        try { warmed.set(`${slot.bus}\n${slot.src}`, slot); } catch { continue; }
        warmSlot(slot);
      }
    },
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
      if (s.on) { for (const slot of warmed.values()) if (slot.bus === bus) warmSlot(slot); }
      else for (const end of [...loops[bus]]) end('bus');
    },
    unlock() {
      if (ctx) return Promise.resolve(true);
      let c: AudioContextLike;
      let asked: Promise<void>;
      try {
        made ??= deps.makeContext();
        c = made;
        asked = c.resume();
      } catch { /* a browser that refuses leaves the mixer locked; the next gesture tries again */ return Promise.resolve(false); }
      if (c.state === 'running') { open(c); return Promise.resolve(true); }
      return new Promise<boolean>((resolve) => {
        const waiter = (unlocked: boolean): void => resolve(unlocked);
        waiting.add(waiter);
        asked.then(() => open(c), () => { if (waiting.delete(waiter)) resolve(false); });
      });
    },
    async suspend() { try { await made?.suspend(); } catch { /* nothing to suspend */ } },
    async resume() { try { await made?.resume(); } catch { /* nothing to resume */ } },
    async play(slot, o = {}) {
      try {
        const asked = clockMs();
        const r = await ready(slot);
        if (!r) return null;
        if (typeof o.lateMs === 'number' && Number.isFinite(o.lateMs) && clockMs() - asked > o.lateMs) return null;
        const { c, buffer } = r;
        const fadeMs = o.fadeMs ?? 0;
        const cap = typeof o.voices === 'number' && Number.isFinite(o.voices) && o.voices >= 1 ? Math.floor(o.voices) : 1;
        if (o.group !== undefined) {
          /* Read the list again each pass: a voice's end may leave the group itself (a loop does), and each voice ends once. */
          for (let list = groups.get(o.group); list && list.length >= cap; list = groups.get(o.group)) {
            const oldest = list[0]!;
            leave(o.group, oldest.source);
            oldest.end(fadeMs);
          }
        }
        const { source, voice, naturalEnd } = start(c, slot, buffer, false, o.group === undefined ? 0 : fadeMs, o.tailMs);
        if (o.group !== undefined) {
          const group = o.group;
          groups.set(group, [...(groups.get(group) ?? []), { source, end: (ms) => fadeOut(c, voice, source, ms, naturalEnd) }]);
          const done = source.onended;
          source.onended = () => { leave(group, source); done?.(); };
        }
        return { lengthMs: Math.round(buffer.duration * 1000) };
      } catch { return null; }
    },
    async loop(slot, o = {}) {
      try {
        const r = await ready(slot);
        if (!r || o.cancelled?.()) return null;
        const { c, buffer } = r;
        if (o.group !== undefined) for (const v of [...(groups.get(o.group) ?? [])]) v.end(0);
        const { source, voice } = start(c, slot, buffer, true, 0);
        let stopped = false;
        const end = (why: LoopStop, fadeMs: number): void => {
          if (stopped) return;
          stopped = true;
          loops[slot.bus].delete(endNow);
          if (o.group !== undefined) leave(o.group, source);
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
            voice.gain.setTargetAtTime((typeof g === 'number' && Number.isFinite(g) ? Math.min(Math.max(g, 0), 1) : 0) * gainOf(slot), now, 0.05);
          },
          stop(fadeMs) { end('stopped', fadeMs); },
        };
        loops[slot.bus].add(endNow);
        if (o.group !== undefined) groups.set(o.group, [{ source, end: (ms) => end('replaced', ms) }]);
        return handle;
      } catch { return null; }
    },
  };
}
