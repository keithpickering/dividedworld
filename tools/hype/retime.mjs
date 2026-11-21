/**
 * Node 9's plays moved to the theme's entries (docs/plans/2026-11-21-commentary-video-plan.md, Task 8: "by playing the stretches between
 * them faster or slower, never past a third either way; where that is not enough the edit says which play and by how much").
 * Pure arithmetic on seconds; nothing here touches ffmpeg or a take.
 *
 * A LANDING is a play's second of the take; an ENTRY is a second of the node's window, from its start, where the theme enters. Each
 * entry takes the nearest landing after the one the entry before it took, and the stretch of film that ends on that entry is played at
 * the speed that brings the landing there: take seconds per film second, so 1.2 is faster. A speed is held to 1 - most to 1 + most
 * (2/3 to 4/3 for a third); a landing that needed more is reported in `unplaced` with what it needed, what it got and how far from its
 * entry it plays. A stretch whose take has drifted (from a clamp before it) starts from where the take now is, so the next landing is
 * still aimed at. The stretch after the last entry, and any stretch with no landing left to give it, plays at 1.
 *
 * It moves PICTURE only: the edit lays the voice and the music on their own tracks from the clips' and the map's times, which this file
 * never sees, so they are not retimed. The game sounds of the plays (a chair's hit) are the picture's, and follow `placed`.
 */
export const MOST = 1 / 3;

/**
 * @param {{ what: string, t: number }[]} landings the plays, in the take's seconds, in order
 * @param {number[]} entries the theme's entries, in film seconds from the window's start, ascending, inside (0, window)
 * @param {number} window the window's length in seconds
 * @param {{ most?: number, tail?: number }} [options] `tail`: the last play is to fall at least this many seconds before the window's end
 * @returns {{
 *   stretches: { out: [number, number], take: [number, number], speed: number, anchor?: { what: string, t: number, entry: number } }[],
 *   placed: { what: string, t: number, at: number }[],
 *   unplaced: { what: string, t: number, entry: number, needed: number, speed: number, late: number }[],
 * }}
 */
export function retime(landings, entries, window, { most = MOST, tail = 1 } = {}) {
  const lo = 1 - most, hi = 1 + most;
  const bounds = [0, ...entries, window];

  /** One way of giving the entries plays (`pick[j]` the index of the play entry j takes, or -1): the stretches, where every play falls, and what missed. */
  const simulate = (/** @type {number[]} */ pick) => {
    /** @type {ReturnType<typeof retime>['stretches']} */
    const stretches = [];
    /** @type {ReturnType<typeof retime>['unplaced']} */
    const unplaced = [];
    let take = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      const [a, b] = [bounds[i], bounds[i + 1]], anchor = pick[i] >= 0 ? landings[pick[i]] : undefined;
      let speed = 1;
      if (anchor) {
        const needed = (anchor.t - take) / (b - a);
        speed = Math.min(hi, Math.max(lo, needed));
        if (Math.abs(needed - speed) > 1e-9) unplaced.push({ what: anchor.what, t: anchor.t, entry: b, needed, speed, late: 0 });
      } else if (i === bounds.length - 2 && landings.length) {
        /* After the last entry: speed 1, unless the last play would then fall in the tail or past the window's end. */
        const last = landings[landings.length - 1], room = window - tail - a;
        if (last.t > take && take + room < last.t && room > 0) speed = Math.min(hi, Math.max(lo, (last.t - take) / room));
      }
      const end = take + speed * (b - a);
      stretches.push({ out: [a, b], take: [take, end], speed, ...(anchor ? { anchor: { what: anchor.what, t: anchor.t, entry: b } } : {}) });
      take = end;
    }
    /* Where each play now falls: through the stretch whose take holds it (past the last, at the last one's speed). */
    const placed = landings.map((l) => {
      const s = stretches.find((x) => l.t < x.take[1] - 1e-12) ?? stretches.at(-1);
      return { what: l.what, t: l.t, at: s.out[0] + (l.t - s.take[0]) / s.speed };
    });
    for (const u of unplaced) u.late = /** @type {{ at: number }} */ (placed.find((p) => p.what === u.what && p.t === u.t)).at - u.entry;
    return { stretches, placed, unplaced };
  };

  /* The search: each entry takes one of the four plays nearest it that come after the play the entry before took, or none. The cost is
   * how far the plays that took an entry fall from it, a little for every stretch not played at 1, a play given up, and a last play that
   * falls in the tail or past the window; the first of equal costs wins, so the plays in their order are preferred. */
  const near = entries.map((e) => landings.map((_, i) => i).sort((p, q) => Math.abs(landings[p].t - e) - Math.abs(landings[q].t - e) || p - q).slice(0, 4));
  /** @type {{ cost: number, pick: number[] }} */
  let best = { cost: Infinity, pick: entries.map(() => -1) };
  /** @param {number} j @param {number} after @param {number[]} pick */
  const search = (j, after, pick) => {
    if (j === entries.length) {
      const r = simulate(pick);
      let cost = 0;
      pick.forEach((p, i) => { cost += p < 0 ? 3 : Math.abs(r.placed[p].at - entries[i]); });
      for (const s of r.stretches) cost += 0.2 * Math.abs(s.speed - 1) * (s.out[1] - s.out[0]);
      const finale = r.placed.at(-1);
      if (finale) cost += 50 * Math.max(0, finale.at - (window - tail));
      if (cost < best.cost - 1e-9) best = { cost, pick: [...pick] };
      return;
    }
    for (const i of [...near[j].filter((x) => x > after).sort((p, q) => p - q), -1]) search(j + 1, i < 0 ? after : i, [...pick, i]);
  };
  search(0, -1, []);
  return simulate(best.pick);
}
