/**
 * A post's ink registry (`EffectProps.ink`), one per `PostEffects`. Two cards that hold ink on one post (a wall under a splat) share it: each
 * effect claims the places its ink is, and a press starts a stroke only for the outermost effect whose ink is under it, so a press on the
 * outer card's ink works that card and a press beside it falls through to the card beneath. Pure, so a test drives it with no screen.
 */
import type { EffectProps } from './types.ts';

type Hit = (x: number, y: number) => boolean;

/** One post's ink registry. */
export interface Claims {
  /**
   * The registry's face for the effect `key` at nesting `rank` (0 innermost, the outermost the highest): the same object for the same key, its
   * rank set to this one, so an effect that moves in the nesting (a card played outside it) is judged where it now is.
   */
  at(key: string, rank: number): EffectProps['ink'];
}

export function createClaims(): Claims {
  const ranks = new Map<string, number>();
  const hits = new Map<string, Set<Hit>>();
  const faces = new Map<string, EffectProps['ink']>();
  const holds = (key: string, x: number, y: number): boolean => { for (const hit of hits.get(key) ?? []) if (hit(x, y)) return true; return false; };
  return {
    at(key, rank) {
      ranks.set(key, rank);
      let face = faces.get(key);
      if (!face) {
        face = {
          claim(hit) {
            const own = hits.get(key) ?? new Set<Hit>();
            hits.set(key, own);
            own.add(hit);
            /* A key with no claim left is dropped from the map, so a post that has held many effects over its life keeps none it is done with. Its rank and face stay: the effect may claim again. */
            return () => { own.delete(hit); if (own.size === 0 && hits.get(key) === own) hits.delete(key); };
          },
          topAt(x, y) {
            if (!holds(key, x, y)) return false;
            const mine = ranks.get(key)!;
            for (const other of hits.keys()) if (other !== key && ranks.get(other)! > mine && holds(other, x, y)) return false;
            return true;
          },
        };
        faces.set(key, face);
      }
      return face;
    },
  };
}

/** The registry of a post where nothing else holds ink: a claim is kept by nobody and nothing is on top. For a moment, and for a test that draws one effect alone. */
export const NO_INK: EffectProps['ink'] = Object.freeze({ claim: () => () => {}, topAt: () => false });
