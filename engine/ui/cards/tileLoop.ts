/**
 * The tile layers' one frame schedule (docs/plans/2026-11-16-effect-tiles-design.md, section 4): one `requestAnimationFrame` serves every
 * layer on the page, and it stops when no layer wants a frame, so an idle page costs nothing. A layer joins when it is made and is forgotten
 * when it stops; it asks for a frame (`want`) when it has a loop on, a stale tile, a new tile or a scroll to follow, and is told the frame's
 * time. Its answer says whether it wants the next frame too, so a looping layer keeps asking by returning true and a layer with nothing left to
 * do returns false and costs nothing. A layer that asks for a frame while a frame runs is served in the next, never the same.
 *
 * A frame that throws never stops the loop: each layer is served on its own, so one layer's painter costs only that layer its frame. The
 * loop's own time in a frame (milliseconds, two `performance.now` reads around the step) is kept for the last `WORK_KEEP` frames in a ring, as
 * engine/ui/shine/loop.ts keeps it, and read by `probe.work`. That is a duration on the page's own timer, not a time compared with any time the
 * data holds, so it is not a read tools/check-one-clock.mjs counts; the layer's frame time is the timestamp the browser hands the frame.
 *
 * The probe is for tests and the budget stories (e2e/effect-tiles.spec.ts reads it through the story that hands it over, as e2e/shine.spec.ts
 * reads the shine loop's): nothing here puts it on `window`. Engine code: it names no card and no instance.
 */

/** What the loop serves: a tile layer, or anything that paints on the page's frames. */
export interface LoopMember {
  /** Called in a frame this member asked for, with the frame's timestamp; returns whether it wants the next frame too. */
  frame(t: number): boolean;
  /** The canvas px this member holds now, for the probe. */
  pixels(): number;
}

/** Every member that has joined, in the order it joined (a Set keeps insertion order). */
const members = new Set<LoopMember>();
/** Members that asked for the coming frame. */
const asked = new Set<LoopMember>();
let handle: number | null = null;
let frameCount = 0;
/* The loop's own time in each frame (ms, around the step), for the last WORK_KEEP frames: a ring, two clock reads a frame, read only by `probe.work`. */
const WORK_KEEP = 600;
const worked = new Float64Array(WORK_KEEP);

function frame(t: number): void {
  handle = null;
  const now = [...asked];
  asked.clear();
  const began = performance.now();
  for (const m of now) {
    /* A member forgotten by an earlier one in this frame is not served. */
    if (!members.has(m)) continue;
    try { if (m.frame(t)) asked.add(m); } catch (err) { console.error(err); }
  }
  frameCount++;
  worked[frameCount % WORK_KEEP] = performance.now() - began;
  /* A member that asked during the step is already in `asked`; the next frame serves it. */
  if (asked.size > 0 && handle === null) handle = requestAnimationFrame(frame);
}

/** Registers a member, with no frame asked for: the probe counts the canvas px it holds from now. */
export function join(member: LoopMember): void {
  members.add(member);
}

/** Asks for a frame for `member`; the one frame serves every member that asked. A member that has not joined is served too, and joins. */
export function want(member: LoopMember): void {
  members.add(member);
  asked.add(member);
  if (handle === null) handle = requestAnimationFrame(frame);
}

/** The member is never served again; the last one asking is forgotten and no frame is left pending. */
export function forget(member: LoopMember): void {
  members.delete(member);
  asked.delete(member);
  if (asked.size === 0 && handle !== null) { cancelAnimationFrame(handle); handle = null; }
}

/** For tests and the budget stories only: what the loop has done, what it holds, and a way back to a fresh page. */
export const probe = {
  frames: () => frameCount,
  /** The loop's own time in each of its last `n` frames (at most 600), oldest first, in milliseconds. */
  work(n: number = WORK_KEEP): number[] {
    const count = Math.min(n, WORK_KEEP, frameCount);
    return Array.from({ length: count }, (_, i) => worked[(frameCount - count + i + 1) % WORK_KEEP]!);
  },
  /** The canvas px each joined layer holds, in the order the layers joined. */
  held: () => [...members].map((m) => m.pixels()),
  running: () => handle !== null,
  reset(): void {
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
    members.clear();
    asked.clear();
    frameCount = 0;
    worked.fill(0);
  },
};
