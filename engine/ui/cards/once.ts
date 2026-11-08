/**
 * What the Lens reads once for a spring (sprung.ts), kept for the api it was read from: a spring never changes, so its line and its caught card's fate are
 * each asked of the api once, in one place keyed by the spring. An answer of null (nothing could be read) is not kept, so the next row asks again.
 */
export type SpringRead = 'words' | 'fate';

const kept = new WeakMap<object, Map<string, Map<SpringRead, Promise<unknown>>>>();

export function onceFor<T>(api: object, spring: string, what: SpringRead, read: () => Promise<T | null>): Promise<T | null> {
  const bySpring = kept.get(api) ?? new Map<string, Map<SpringRead, Promise<unknown>>>();
  kept.set(api, bySpring);
  const reads = bySpring.get(spring) ?? new Map<SpringRead, Promise<unknown>>();
  bySpring.set(spring, reads);
  const held = reads.get(what) as Promise<T | null> | undefined;
  if (held) return held;
  const asked = read().then((answer) => { if (answer === null) reads.delete(what); return answer; }, (e: unknown) => { reads.delete(what); throw e; });
  reads.set(what, asked);
  return asked;
}
