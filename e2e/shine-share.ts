/**
 * What e2e/shine.spec.ts holds a shine host's cost to, shared so that e2e/origin-effects.spec.ts holds the ORIGIN box's foil to the same bound and not to a copy of it: the screen area a
 * host's draws change over what it is allowed (`redrawn`) stays under `REDRAWN_SHARE`, where a host is allowed the larger of its words' box and `BODY_FLOOR` of its painted box (the larger of the
 * words' box and a quarter of the content area, engine/ui/cards/body.ts `paintShare`, issue #304 and PR #695). The planted samples that drive `redrawn` red are in e2e/shine.spec.ts.
 */

/** The on-screen area a scroll's draws change, over what the posts in view are allowed (`redrawn`): at most this. */
export const REDRAWN_SHARE = 1.25;
/**
 * The share of its content area a post's draws may change a frame however few its words: the least share of the rate a body is
 * redrawn at (engine/ui/cards/body.ts `LEAST_SHARE`), stated here on its own, so a floor raised there is seen here.
 */
export const BODY_FLOOR = 0.25;

export interface Box1 { top: number; bottom: number; width: number }
export interface Sample { t: number; draws: number[]; top: number[]; bottom: number[]; height: number; painted?: Box1[]; own?: Box1[]; layers?: number[]; scrollY?: number }

/** A box's area inside the viewport's rows, in CSS px squared. */
export const onScreen = (b: Box1, height: number): number => Math.max(0, Math.min(b.bottom, height) - Math.max(b.top, 0)) * b.width;

/**
 * The screen the shine changed over a run: for each sample after the first, the on-screen area of each post drawn since the one before
 * (its painted box, the content area), summed; and what the posts were allowed, every post in view on every frame: the larger of its
 * words' box and `BODY_FLOOR` of its painted box, each as much as is on screen. A host drawn more than once between two samples counts
 * each draw. For the log, `words` is the words' boxes alone (the allowance before a body had its floor, as the runs before it
 * recorded it) and `view` the viewport's area over the same samples (`width` times each one's height).
 */
export function redrawn(samples: readonly Sample[], width = 0): { changed: number; allowed: number; words: number; view: number } {
  let changed = 0, allowed = 0, words = 0, view = 0;
  samples.forEach((s, k) => {
    if (k === 0) return;
    view += width * s.height;
    s.draws.forEach((d, h) => {
      const drew = d - samples[k - 1]!.draws[h]!, body = onScreen(s.painted![h]!, s.height);
      if (drew > 0) changed += drew * body;
      const own = onScreen(s.own![h]!, s.height);
      words += own;
      allowed += Math.max(own, BODY_FLOOR * body);
    });
  });
  return { changed, allowed, words, view };
}
