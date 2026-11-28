/**
 * What a reader keeps (docs/plans/2026-11-27-season-two-cards-design.md, section 1.2): a card's own memory, in the reader's browser, of how far they have
 * got in a play. JSON under `kb-reader:<play>` in `localStorage`; it sends nothing anywhere.
 *
 * What may go in it: a reader's own progress on a play, that only their own screen reads (which step of a card's walk they were on, what they had typed).
 * What never may: anything another reader's screen or the server reads, or any fact the game keeps in an Act. A card whose rules turn on a value keeps it in
 * the play's Acts; this is only the place a reader's own screen picks up where it left off.
 *
 * Storage can be absent, full or refused (a private window, blocked site data), so every read and write is in a `try`, and a throw, or a stored value
 * `parse` refuses, falls back to a `Map` in the page's memory: a value just set is still got back on this page, and is lost when the page is.
 */
import type { Id } from '../data/api.ts';

const PREFIX = 'kb-reader:';

/** The page's own memory, for when storage throws or refuses what it holds. Shared by every `readerMemory` of the page, keyed as storage is. */
const page = new Map<string, unknown>();

/** Keys whose last write (a set or a clear) storage refused: for these the page's memory is the truth, and a stale stored value is never read over it. */
const held = new Set<string>();

export interface ReaderMemory<T> {
  /** What this reader kept for the play, or null where nothing is kept or what is kept fails `parse`. */
  get(): T | null;
  set(value: T): void;
  clear(): void;
}

export function readerMemory<T>(play: Id, parse: (raw: unknown) => T | null): ReaderMemory<T> {
  const key = PREFIX + play;
  const fromPage = (): T | null => (page.has(key) ? parse(page.get(key)) : null);
  return {
    get() {
      if (held.has(key)) return fromPage();
      try {
        const text = localStorage.getItem(key);
        if (text !== null) {
          const kept = parse(JSON.parse(text));
          if (kept !== null) return kept;
        }
      } catch {
        /* storage is off, or holds something that is not JSON: the page's memory answers */
      }
      return fromPage();
    },
    set(value) {
      page.set(key, value);
      try {
        localStorage.setItem(key, JSON.stringify(value));
        held.delete(key);
      } catch {
        held.add(key);
        /* the page's memory has it */
      }
    },
    clear() {
      page.delete(key);
      try {
        localStorage.removeItem(key);
        held.delete(key);
      } catch {
        held.add(key);
        /* nothing more to remove */
      }
    },
  };
}
