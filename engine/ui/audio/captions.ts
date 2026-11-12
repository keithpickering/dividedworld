/**
 * The caption bar's store (the Laugh Track plan, Task 3): what the page says in words for a reader with the sound off, and for one with it on. No React.
 *
 * `say` shows a caption for `ms`, replacing whatever shows. `hold` and `release` are for a loop's caption: a held caption shows while no say is
 * showing, and the latest hold wins; a say sits over it and the hold is back when the say ends. Every caption names its way out: a say ends by
 * itself, a hold ends at its release (the sound that holds it releases it when the sound stops).
 */
export interface CaptionWords {
  readonly text: string;
  /** A CSS color for the dot that leads the words (a glass token, as `var(--kb-glass-salty)`). */
  readonly ink?: string;
}

export interface Caption extends CaptionWords {
  /** Held captions are a loop's; they are drawn, not announced. */
  readonly held: boolean;
  /** Counts up with each caption, so a repeated say of the same words is a new one to the live region. */
  readonly seq: number;
}

export interface Captions {
  say(words: CaptionWords & { readonly ms: number }): void;
  hold(id: string, words: CaptionWords): void;
  release(id: string): void;
  /** Clears every say, hold and pending timer, for a test or an instance that tears the page down; subscribers stay and are told. */
  reset(): void;
  subscribe(listener: () => void): () => void;
  current(): Caption | null;
}

export function createCaptions(): Captions {
  const listeners = new Set<() => void>();
  /* Insertion order is the order of holds; the latest hold is the last, and a hold said again moves to the end. */
  const holds = new Map<string, CaptionWords>();
  let said: Caption | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let shown: Caption | null = null;

  const compute = (): Caption | null => {
    if (said) return said;
    const last = [...holds.values()].pop();
    if (!last) return null;
    /* A hold keeps its seq while it is the one shown, so an unchanged hold is not a new caption. */
    return shown?.held && shown.text === last.text && shown.ink === last.ink ? shown : { ...last, held: true, seq: ++seq };
  };
  const refresh = () => {
    const next = compute();
    if (next === shown) return;
    shown = next;
    for (const l of [...listeners]) l();
  };

  return {
    say({ text, ink, ms }) {
      if (timer !== null) clearTimeout(timer);
      said = { text, ink, held: false, seq: ++seq };
      timer = setTimeout(() => { timer = null; said = null; refresh(); }, ms);
      refresh();
    },
    hold(id, words) {
      holds.delete(id);
      holds.set(id, words);
      refresh();
    },
    release(id) {
      if (holds.delete(id)) refresh();
    },
    reset() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      said = null;
      holds.clear();
      refresh();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    current: () => shown,
  };
}

/** The page's one caption bar. */
export const captions: Captions = createCaptions();
export const say = captions.say;
export const hold = captions.hold;
export const release = captions.release;
export const reset = captions.reset;
export const subscribe = captions.subscribe;
export const current = captions.current;
