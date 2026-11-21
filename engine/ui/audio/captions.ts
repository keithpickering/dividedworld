/**
 * The caption stack's store (the sound stack plan, Task 2): what the page says in words for a reader with the sound off, and for one with it on.
 * No React.
 *
 * The store holds lines, oldest first, in the order each first showed. `say` shows a line for `ms`; the same words and ink said again are not a
 * second line but a count on the first (`count` goes up, the line's end moves to the later of the two, and its place does not move). At most
 * `CAPTIONS_SHOWN` lines show: a new say that would make more pushes the oldest said line out. `hold` and `release` are for a loop's caption: a
 * held line stays until it is released and is never pushed out, so holds can take the stack past the limit; two holds with the same words share
 * one line. Every line names its way out: a said line ends by itself, a hold ends at its release (the sound that holds it releases it when the
 * sound stops), and `reset` ends everything.
 *
 * The announcements are what a screen reader's live region holds. A new said line announces its text at once; a count that has grown is announced
 * as "text, N times" once the repeats go quiet for `QUIET_MS`, or as the line leaves (at its end, or pushed out), whichever is first. Each
 * announcement removes itself after `SAID_MS`. Held lines announce nothing, and `reset` is not a leave.
 */
export const CAPTIONS_SHOWN = 3;
export const QUIET_MS = 700;
export const SAID_MS = 2500;

export interface CaptionWords {
  readonly text: string;
  /** A CSS color for the dot that leads the words (a glass token, as `var(--kb-glass-salty)`). */
  readonly ink?: string;
}

export interface CaptionLine extends CaptionWords {
  /** Stable for the line's life, so the stack keys on it. */
  readonly id: number;
  readonly held: boolean;
  /** How many says this line has had; 1 for a held line. */
  readonly count: number;
}

export interface Announcement { readonly seq: number; readonly text: string }

export interface Captions {
  say(words: CaptionWords & { readonly ms: number }): void;
  hold(id: string, words: CaptionWords): void;
  release(id: string): void;
  /** Clears every line, hold, announcement and pending timer, for a test or an instance that tears the page down; subscribers stay and are told. */
  reset(): void;
  subscribe(listener: () => void): () => void;
  /** The lines showing, oldest first; the same array until something changes. */
  lines(): readonly CaptionLine[];
  /** What the live region holds now, oldest first; the same array until something changes. */
  announcements(): readonly Announcement[];
}

interface Entry {
  readonly id: number;
  readonly text: string;
  readonly ink: string | undefined;
  readonly held: boolean;
  count: number;
  /** A said line's end, as `Date.now()` time. */
  end: number;
  endTimer: ReturnType<typeof setTimeout> | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
  /** The count the live region was last told of. */
  announced: number;
  /** A held line's hold ids. */
  readonly holders: Set<string>;
}

export function createCaptions(): Captions {
  const listeners = new Set<() => void>();
  let entries: Entry[] = [];
  /* Hold id -> the held entry it is on. */
  const holds = new Map<string, Entry>();
  let announcements: Announcement[] = [];
  const announcementTimers = new Set<ReturnType<typeof setTimeout>>();
  let nextId = 0;
  let nextSeq = 0;
  let linesCache: readonly CaptionLine[] = [];
  let annsCache: readonly Announcement[] = [];
  let linesDirty = false;
  let annsDirty = false;

  const commit = () => {
    if (!linesDirty && !annsDirty) return;
    if (linesDirty) linesCache = entries.map((e) => ({ id: e.id, text: e.text, ink: e.ink, held: e.held, count: e.count }));
    if (annsDirty) annsCache = announcements.slice();
    linesDirty = false;
    annsDirty = false;
    for (const l of [...listeners]) l();
  };
  const same = (e: Entry, text: string, ink: string | undefined, held: boolean) => e.held === held && e.text === text && e.ink === ink;
  const announce = (text: string) => {
    const a: Announcement = { seq: ++nextSeq, text };
    announcements.push(a);
    annsDirty = true;
    const t = setTimeout(() => {
      announcementTimers.delete(t);
      announcements = announcements.filter((x) => x !== a);
      annsDirty = true;
      commit();
    }, SAID_MS);
    announcementTimers.add(t);
  };
  const announceTotal = (e: Entry) => {
    if (e.count <= e.announced) return;
    e.announced = e.count;
    announce(`${e.text}, ${e.count} times`);
  };
  const clearTimers = (e: Entry) => {
    if (e.endTimer !== null) clearTimeout(e.endTimer);
    if (e.quietTimer !== null) clearTimeout(e.quietTimer);
    e.endTimer = null;
    e.quietTimer = null;
  };
  /* A said line leaves at its end or when a newer line pushes it out; its total is announced either way. */
  const leave = (e: Entry) => {
    clearTimers(e);
    announceTotal(e);
    entries = entries.filter((x) => x !== e);
    linesDirty = true;
  };
  const removeHeld = (e: Entry) => {
    entries = entries.filter((x) => x !== e);
    linesDirty = true;
  };
  const scheduleEnd = (e: Entry) => {
    if (e.endTimer !== null) clearTimeout(e.endTimer);
    e.endTimer = setTimeout(() => { e.endTimer = null; leave(e); commit(); }, Math.max(0, e.end - Date.now()));
  };
  const scheduleQuiet = (e: Entry) => {
    if (e.quietTimer !== null) clearTimeout(e.quietTimer);
    e.quietTimer = setTimeout(() => { e.quietTimer = null; announceTotal(e); commit(); }, QUIET_MS);
  };

  return {
    say({ text, ink, ms }) {
      const end = Date.now() + ms;
      const found = entries.find((e) => same(e, text, ink, false));
      if (found) {
        found.count += 1;
        linesDirty = true;
        if (end > found.end) { found.end = end; }
        scheduleEnd(found);
        scheduleQuiet(found);
        commit();
        return;
      }
      if (entries.length >= CAPTIONS_SHOWN) {
        const oldest = entries.find((e) => !e.held);
        if (oldest) leave(oldest);
      }
      const e: Entry = { id: nextId++, text, ink, held: false, count: 1, end, endTimer: null, quietTimer: null, announced: 1, holders: new Set() };
      entries.push(e);
      linesDirty = true;
      scheduleEnd(e);
      announce(text);
      commit();
    },
    hold(id, { text, ink }) {
      const old = holds.get(id);
      if (old && same(old, text, ink, true)) return;
      if (old) {
        old.holders.delete(id);
        if (old.holders.size === 0) removeHeld(old);
        holds.delete(id);
      }
      let target = entries.find((e) => same(e, text, ink, true));
      if (!target) {
        target = { id: nextId++, text, ink, held: true, count: 1, end: 0, endTimer: null, quietTimer: null, announced: 1, holders: new Set() };
        entries.push(target);
        linesDirty = true;
      }
      target.holders.add(id);
      holds.set(id, target);
      commit();
    },
    release(id) {
      const e = holds.get(id);
      if (!e) return;
      holds.delete(id);
      e.holders.delete(id);
      if (e.holders.size === 0) removeHeld(e);
      commit();
    },
    reset() {
      for (const e of entries) clearTimers(e);
      for (const t of announcementTimers) clearTimeout(t);
      announcementTimers.clear();
      entries = [];
      holds.clear();
      announcements = [];
      linesDirty = linesCache.length > 0;
      annsDirty = annsCache.length > 0;
      const wasQuiet = !linesDirty && !annsDirty;
      commit();
      if (wasQuiet) for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    lines: () => linesCache,
    announcements: () => annsCache,
  };
}

/** The page's one caption stack. */
export const captions: Captions = createCaptions();
export const say = captions.say;
export const hold = captions.hold;
export const release = captions.release;
export const reset = captions.reset;
export const subscribe = captions.subscribe;
