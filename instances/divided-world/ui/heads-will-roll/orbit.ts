/**
 * Heads Will Roll's orbit (docs/plans/2026-11-27-season-two-cards-design.md, section 2.2): pure TypeScript with no DOM. Given a post's heads (the reaction
 * kinds on it and the React head), the content area's size and the card's settings, it steps a small solar system and projects it to the area. The screen
 * draws what `project()` returns and does nothing else to it.
 *
 * - **Mass and size.** A head's mass is its count, an Overreaction (`local`) head's times `overMass`, and the React head's is none. Its size is
 *   `least + perRoot x sqrt(mass)` px, at most a share of the area's width; the React head is mid-sized.
 * - **Suns and satellites.** The `suns` heaviest heads are suns (the React head only when it is alone); every other head orbits the nearest sun in a
 *   near-circle, heavier satellites on the nearer rings, at a pace that follows the sun's mass and the ring's radius. A system wider than the box draws its
 *   rings in (`fit`), so no head ever leaves it.
 * - **Suns drift** at a steady speed, steer toward the middle (more the farther out they are) and away from each other, more the closer their masses.
 *   The wall clamp never leaves negative room: a box narrower than its system parks the sun, it never flips it between two places (the bench's flicker).
 * - **They roll** by their sideways travel over their radius, eased and capped at `mostTurns` turns a second.
 * - **Depth** is a scale and a stack rank: the camera is tilted 22 degrees and a head is laid out once at its size, never re-sized each frame.
 * - **The fit.** Every corner of the space is drawn inside the area with the largest head's half to spare, taken from the space alone so the view never
 *   zooms; with the rings fitted to the space, that alone keeps each head's shown box inside the borders (no clamp is left to hide a fault).
 *
 * The starting numbers are the bench's (docs/research/2026-11-27-heads-will-roll/01-bench.html, Space mode): drift 26, home 0.8, tilt 22 degrees, perspective
 * 0.55, orbit pace 1, ring gap 26, wobble 12 degrees, spin 0.6, least 26, per root 11, share 0.34, React head 36. They are the card's rules and the
 * physics's, not the instance's to tune; the instance's own knobs (`headsWillRoll.*`) are `OrbitSettings`.
 */

/** What the card's settings give the orbit: `headsWillRoll.overMass`, `.suns` and `.mostTurns`. */
export interface OrbitSettings { readonly overMass: number; readonly suns: number; readonly mostTurns: number }
/** The reel-in's two numbers, `headsWillRoll.reelBase` and `.reelPerSpeed`. */
export interface ReelSettings { readonly reelBase: number; readonly reelPerSpeed: number }

export const ORBIT = {
  /** The settings' defaults (as in `settings.ts`'s `cardSettings`). */
  defaults: { overMass: 2, suns: 2, mostTurns: 0.5, reelBase: 0.8, reelPerSpeed: 0.12 } as OrbitSettings & ReelSettings,
  least: 26,
  perRoot: 11,
  share: 0.34,
  reactSize: 36,
  /** A sun's drift, in px a second in the space. */
  drift: 26,
  /** How hard a sun steers home; the bench's 0.8. */
  home: 0.8,
  tiltDegrees: 22,
  perspective: 0.55,
  /** The space's height as a share of the area's, and its depth as a share of its width. */
  heightShare: 0.8,
  depthShare: 0.9,
  ringGap: 26,
  wobbleDegrees: 12,
  /** A ring's pace multiplier. */
  pace: 1,
  /** The roll's spin (turns of a rolling ball, 0.6 of them), and how fast it eases. */
  spin: 0.6,
  ease: 3,
  /** The most a satellite travels round its ring, px a second in the space; and the most a sun is pushed apart in one step, px. */
  mostRingSpeed: 80,
  mostPush: 0.8,
  /** The most a step may be, in seconds (a tab left alone for a while must not throw the heads). */
  mostStep: 0.05,
  /** How far a satellite may be from its ring, as a share of the ring, in the tests: the ring's own wobble out of its plane. */
  ringTolerance: 0.03,
} as const;

/** A head the post carries: a reaction kind's live count (an Overreaction kind is `local`), or the React head (`react`, no count). */
export interface HeadSpec { readonly id: string; readonly count: number; readonly local?: boolean; readonly react?: boolean }

/** The box the orbit lives in: the content area's size in px. */
export interface AreaBox { readonly width: number; readonly height: number }

/** A head's mass: its count, an Overreaction's times `overMass`, the React head's none, and never less than one for a kind. */
export function headMass(head: HeadSpec, settings: Pick<OrbitSettings, 'overMass'>): number {
  if (head.react === true) return 0;
  return Math.max(1, head.count) * (head.local === true ? settings.overMass : 1);
}

/** A head's size in px, before perspective: `least + perRoot x sqrt(mass)`, at most a share of the area's width; the React head is mid-sized. */
export function headSize(mass: number, react: boolean, width: number): number {
  const cap = ORBIT.share * Math.max(0, width);
  return Math.min(cap, react ? ORBIT.reactSize : ORBIT.least + ORBIT.perRoot * Math.sqrt(Math.max(0, mass)));
}

/** How long a reel-in takes: `reelBase + reelPerSpeed x speed`, the speed in the head's own widths a second (design 2.3). */
export function reelSeconds(speed: number, settings: ReelSettings): number {
  return settings.reelBase + settings.reelPerSpeed * Math.max(0, speed);
}

/** One head as the screen draws it. `x` and `y` are its center in the area's px, `size` its laid-out size and `scale` the perspective on top of it. */
export interface ProjectedHead {
  readonly id: string;
  readonly mass: number;
  readonly react: boolean;
  readonly local: boolean;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** Distance from the camera: larger is farther. */
  readonly depth: number;
  /** The stack rank, 0 the farthest and the highest the nearest: the order to write `z-index` in, only when it changes. */
  readonly rank: number;
  /** The head's roll, radians, unwrapped. */
  readonly angle: number;
  /** How fast it moves on the screen, in its own shown widths a second, smoothed over about half a second. */
  readonly speed: number;
}

/** A head in the space, for the tests and for anything that wants the orbit's own geometry. */
export interface Body {
  readonly id: string;
  readonly mass: number;
  readonly size: number;
  readonly X: number;
  readonly Y: number;
  readonly Z: number;
  /** The id of the sun it orbits, or null for a sun. */
  readonly sun: string | null;
  /** Its fitted ring's radius in the space (0 for a sun). */
  readonly ring: number;
}

export interface Orbit {
  /** The heads the post carries now. A head already here keeps its place and ring; a new one joins at random. */
  setHeads(heads: readonly HeadSpec[]): void;
  /** The content area changed size. */
  setBox(box: AreaBox): void;
  /** The card's settings changed. */
  setSettings(settings: Partial<OrbitSettings>): void;
  /** Advance the motion by `dt` seconds (at most `ORBIT.mostStep`). */
  step(dt: number): void;
  /** Every head as drawn, heaviest first with the React head last (the tab order), as of the last step or change. */
  project(): readonly ProjectedHead[];
  /** The space itself, in the same order as `project()`. */
  bodies(): readonly Body[];
}

/** A small seeded generator, so a test and a replay are the same orbit. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ring { r: number; phase: number; tiltA: number; tiltB: number }
/** How fast a satellite that has just joined a ring eases onto it, px a second in the space (radius and height together), so a change of role is never a jump. */
const EASE = 160;
interface Sim {
  id: string; react: boolean; local: boolean; count: number; mass: number; size: number;
  X: number; Y: number; Z: number; vx: number; vy: number; vz: number;
  sun: Sim | null; ring: Ring; fitR: number; dr: number; dy: number; fresh: boolean; reach: number; reachY: number;
  sx: number; sy: number; scale: number; depth: number; rank: number;
  angle: number; omega: number; speed: number;
}

const TILT = ORBIT.tiltDegrees * Math.PI / 180;
const WOBBLE = Math.sin(ORBIT.wobbleDegrees * Math.PI / 180);

export function createOrbit(initial: AreaBox, options: { readonly seed?: number; readonly settings?: Partial<OrbitSettings> } = {}): Orbit {
  const rand = mulberry32(options.seed ?? 1);
  let box = initial;
  let settings: OrbitSettings = { ...ORBIT.defaults, ...options.settings };
  let sims: Sim[] = [];
  let fit = { fx: 1, fy: 1, F: 1 };

  /** The space: x across, y up, z deep, in px at the content area's own width. */
  const space = () => ({ w: Math.max(1, box.width), h: Math.max(80, box.height * ORBIT.heightShare), d: Math.max(1, box.width * ORBIT.depthShare) });

  /** The depth of a point (away from the camera) and its height on the screen before perspective. */
  const depthOf = (Y: number, Z: number) => Z * Math.cos(TILT) - Y * Math.sin(TILT);
  const upOf = (Y: number, Z: number) => Y * Math.cos(TILT) + Z * Math.sin(TILT);

  /** Perspective at a depth: the camera sits in front of the space, `F` away. */
  const factorAt = (depth: number) => fit.F / (fit.F + depth);

  /** Fit the whole space inside the area: from the corners alone, with the largest head's half to spare, so the view never zooms as heads move. */
  function fitView(): void {
    const B = space();
    const F = Math.max(B.w, B.d) / ORBIT.perspective;
    let fNear = 0, maxUp = 0.0001;
    for (const y of [-B.h / 2, B.h / 2]) for (const z of [-B.d / 2, B.d / 2]) {
      const f = F / (F + depthOf(y, z));
      fNear = Math.max(fNear, f);
      maxUp = Math.max(maxUp, Math.abs(upOf(y, z)) * f);
    }
    const fx = Math.min(1, 1 / fNear);
    const half = Math.max(0, ...sims.map((s) => s.size)) / 2;
    const fy = Math.max(0, Math.min(fx, (box.height / 2 - half * fNear * fx - 2) / maxUp));
    fit = { fx, fy, F };
  }

  const stateOf = (h: HeadSpec): Pick<Sim, 'mass' | 'size'> => { const mass = headMass(h, settings); return { mass, size: headSize(mass, h.react === true, box.width) }; };

  function spawn(h: HeadSpec): Sim {
    const B = space();
    const { mass, size } = stateOf(h);
    const a = rand() * Math.PI * 2;
    const dir = { x: Math.cos(a), y: (rand() - 0.5) * 0.3, z: Math.sin(a) };
    const len = Math.hypot(dir.x, dir.y, dir.z);
    return {
      id: h.id, react: h.react === true, local: h.local === true, count: h.count, mass, size,
      X: (rand() - 0.5) * Math.max(0, B.w - size) * 0.8, Y: (rand() - 0.5) * Math.max(0, B.h - size) * 0.5, Z: (rand() - 0.5) * Math.max(0, B.d - size) * 0.8,
      vx: dir.x / len, vy: dir.y / len, vz: dir.z / len,
      sun: null, ring: { r: 0, phase: rand() * Math.PI * 2, tiltA: (rand() - 0.5) * 2, tiltB: rand() * Math.PI * 2 }, fitR: 0, dr: 0, dy: 0, fresh: true, reach: size / 2, reachY: size / 2,
      sx: 0, sy: 0, scale: 1, depth: 0, rank: 0, angle: 0, omega: 0, speed: 0,
    };
  }

  const byMass = (a: Sim, b: Sim) => (a.react ? 1 : 0) - (b.react ? 1 : 0) || b.mass - a.mass || (a.id < b.id ? -1 : 1);

  /** Who is a sun and who orbits whom, the rings' radii and how far they must be drawn in to fit; then every head is put where it belongs. */
  function layout(): void {
    const B = space();
    sims.sort(byMass);
    const kinds = sims.filter((s) => !s.react);
    const sunCount = Math.min(Math.max(1, Math.round(settings.suns)), kinds.length);
    const suns = kinds.length === 0 ? sims.slice(0, 1) : kinds.slice(0, sunCount);
    const loads = new Map<Sim, Sim[]>(suns.map((s) => [s, []]));
    for (const s of sims) {
      if (suns.includes(s)) { s.sun = null; continue; }
      // The nearest sun, each already-taken ring a little farther away (a load worth one sun's area), so that on a post with a dominant sun the lighter heads
      // still spread over the suns rather than all crowding the nearest.
      let best = suns[0]!, bd = Infinity;
      for (const u of suns) {
        const d = (u.X - s.X) ** 2 + (u.Y - s.Y) ** 2 + (u.Z - s.Z) ** 2 + loads.get(u)!.length * u.size * u.size;
        if (d < bd) { bd = d; best = u; }
      }
      loads.get(best)!.push(s);
      s.sun = best;
    }
    // Rings, heavier nearer (the list is in mass order), each past the one inside it.
    const limit = Math.max(1, Math.min(B.w, B.d) / 2 - 2) / (1 + 0.5 * (suns.length - 1));
    for (const [sun, list] of loads) {
      let r = sun.size / 2;
      for (const s of list) { r += s.size / 2 + ORBIT.ringGap; s.ring.r = r; r += s.size / 2; }
      // Draw the rings in until the farthest head, its own half and its wobble out of the horizontal included, is within the system's share of the box.
      let f = 1;
      for (const s of list) {
        f = Math.min(f, (limit - s.size / 2) / s.ring.r, (B.h / 2 - s.size / 2) / (WOBBLE * s.ring.r));
      }
      f = Math.max(0, f);
      sun.reach = sun.size / 2;
      sun.reachY = sun.size / 2;
      for (const s of list) {
        s.fitR = s.ring.r * f;
        sun.reach = Math.max(sun.reach, s.fitR + s.size / 2);
        sun.reachY = Math.max(sun.reachY, s.fitR * WOBBLE + s.size / 2);
      }
      sun.reach = Math.min(sun.reach, Math.max(limit, sun.size / 2));
    }
    for (const s of suns) { s.sun = null; s.fitR = 0; }
    walls(suns);
    // A head that was somewhere stays there: a satellite joins its ring at the phase it has about its sun and eases its radius and height onto the ring over
    // the next steps (`dr`, `dy`), so a change of role or of ring order is never a jump. A head new to the post starts on its ring.
    for (const s of sims) {
      const u = s.sun;
      if (!u) { s.dr = 0; s.dy = 0; s.fresh = false; continue; }
      if (!s.fresh) {
        const ox = s.X - u.X, oz = s.Z - u.Z, rr = Math.hypot(ox, oz);
        if (rr > 1e-6) s.ring.phase = Math.atan2(oz, ox);
        s.dr = rr - s.fitR;
        s.dy = s.Y - (u.Y + Math.sin(s.ring.phase + s.ring.tiltB) * WOBBLE * s.ring.tiltA * rr);
      } else { s.dr = 0; s.dy = 0; }
      s.fresh = false;
    }
    fitView();
    place();
    refresh();
  }

  const sunsNow = () => sims.filter((s) => s.sun === null);

  /** Each wall turns a sun back toward the middle; the room is never negative, so a sun that cannot fit is parked and never flipped from side to side. */
  function walls(list: readonly Sim[]): void {
    const B = space();
    const room = (half: number, r: number) => Math.max(0, half - r);
    for (const s of list) {
      const rx = room(B.w / 2, s.reach), ry = room(B.h / 2, s.reachY), rz = room(B.d / 2, s.reach);
      if (s.X > rx) { s.X = rx; s.vx = -Math.abs(s.vx); } else if (s.X < -rx) { s.X = -rx; s.vx = Math.abs(s.vx); }
      if (s.Y > ry) { s.Y = ry; s.vy = -Math.abs(s.vy); } else if (s.Y < -ry) { s.Y = -ry; s.vy = Math.abs(s.vy); }
      if (s.Z > rz) { s.Z = rz; s.vz = -Math.abs(s.vz); } else if (s.Z < -rz) { s.Z = -rz; s.vz = Math.abs(s.vz); }
    }
  }

  /** Put every satellite on its ring about its sun's place, at its phase. */
  function place(): void {
    const B = space();
    for (const s of sims) {
      const u = s.sun;
      if (!u) continue;
      const R = Math.max(0, s.fitR + s.dr);
      const wob = WOBBLE * s.ring.tiltA;
      const yRoom = Math.max(0, B.h / 2 - s.size / 2);
      s.X = u.X + Math.cos(s.ring.phase) * R;
      s.Z = u.Z + Math.sin(s.ring.phase) * R;
      s.Y = Math.max(-yRoom, Math.min(yRoom, u.Y + Math.sin(s.ring.phase + s.ring.tiltB) * wob * R + s.dy));
    }
  }

  /** Project every head to the area, and rank them far to near. The fit is all that keeps a head inside the borders, and the tests hold it to that. */
  function refresh(): void {
    for (const s of sims) {
      const f = factorAt(depthOf(s.Y, s.Z));
      s.depth = depthOf(s.Y, s.Z);
      s.scale = f * fit.fx;
      s.sx = box.width / 2 + s.X * s.scale;
      s.sy = box.height / 2 - upOf(s.Y, s.Z) * f * fit.fy;
    }
    [...sims].sort((a, b) => b.depth - a.depth || (a.id < b.id ? -1 : 1)).forEach((s, i) => { s.rank = i; });
  }

  function step(dtIn: number): void {
    const dt = Math.max(0, Math.min(ORBIT.mostStep, dtIn));
    if (dt === 0) return;
    const B = space();
    const ss = sunsNow();
    // Suns steer toward the middle (more the farther out they are) and away from each other (more the closer their masses); their speed stays the drift.
    for (const a of ss) {
      let ax = -a.X / (B.w / 2) * ORBIT.home, ay = -a.Y / (B.h / 2) * ORBIT.home, az = -a.Z / (B.d / 2) * ORBIT.home;
      for (const b of ss) {
        if (a === b) continue;
        const similar = Math.min(a.mass, b.mass) / Math.max(1, a.mass, b.mass);
        const range = (a.reach + b.reach) * (1 + similar);
        const dx = a.X - b.X, dy = a.Y - b.Y, dz = a.Z - b.Z, d = Math.hypot(dx, dy, dz) || 0.01;
        if (d < range) { const k = (range - d) / range * 6 * (0.2 + 0.8 * similar); ax += dx / d * k; ay += dy / d * k; az += dz / d * k; }
      }
      a.vx += ax * dt; a.vy += ay * dt; a.vz += az * dt;
      const v = Math.hypot(a.vx, a.vy, a.vz) || 1;
      a.vx /= v; a.vy /= v; a.vz /= v;
      a.X += a.vx * ORBIT.drift * dt; a.Y += a.vy * ORBIT.drift * dt; a.Z += a.vz * ORBIT.drift * dt;
    }
    // Suns of a similar mass are never closer than their sizes, however they were steered, by a push that is small at each step.
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i]!, b = ss[j]!;
      const similar = Math.min(a.mass, b.mass) / Math.max(1, a.mass, b.mass);
      const least = (a.size + b.size) / 2 * (1 + similar);
      const dx = a.X - b.X, dy = a.Y - b.Y, dz = a.Z - b.Z, d = Math.hypot(dx, dy, dz) || 0.01;
      if (d >= least) continue;
      const push = Math.min(ORBIT.mostPush, (least - d) / 2);
      a.X += dx / d * push; a.Y += dy / d * push; a.Z += dz / d * push;
      b.X -= dx / d * push; b.Y -= dy / d * push; b.Z -= dz / d * push;
    }
    walls(ss);
    // Satellites go round their sun at a pace that follows its mass and the ring's radius, never past a speed the eye can follow.
    for (const s of sims) {
      const u = s.sun;
      if (!u || s.fitR <= 0) continue;
      const w = ORBIT.pace * Math.sqrt(Math.max(1, u.mass) * 4e4 / Math.pow(s.ring.r, 3));
      s.ring.phase += Math.min(w, ORBIT.mostRingSpeed / s.fitR) * dt;
      const off = Math.hypot(s.dr, s.dy);
      if (off > 0) { const k = Math.max(0, off - EASE * dt) / off; s.dr *= k; s.dy *= k; }
    }
    place();
    const before = sims.map((s) => [s.sx, s.sy] as const);
    refresh();
    // Roll: turned by the sideways travel on the screen over the radius, as a ball rolls along a floor; eased and capped, so a swing reads as a roll.
    const cap = settings.mostTurns * 2 * Math.PI;
    sims.forEach((s, i) => {
      const [px, py] = before[i]!;
      const dx = s.sx - px, dy = s.sy - py;
      const shown = s.size * s.scale;
      const want = Math.max(-cap, Math.min(cap, (dx / dt) / Math.max(6, shown / 2) * ORBIT.spin));
      s.omega += (want - s.omega) * Math.min(1, dt * ORBIT.ease);
      s.angle += s.omega * dt;
      const now = Math.hypot(dx, dy) / dt / Math.max(1, shown);
      s.speed += (now - s.speed) * Math.min(1, dt / 0.5);
    });
  }

  function setHeads(heads: readonly HeadSpec[]): void {
    const was = new Map(sims.map((s) => [s.id, s]));
    sims = heads.map((h) => {
      const old = was.get(h.id);
      if (!old) return spawn(h);
      const { mass, size } = stateOf(h);
      Object.assign(old, { mass, size, count: h.count, local: h.local === true, react: h.react === true });
      return old;
    });
    layout();
  }

  const tabOrder = () => [...sims].sort(byMass);

  return {
    setHeads,
    setBox(next) { box = next; for (const s of sims) s.size = headSize(s.mass, s.react, box.width); layout(); },
    setSettings(next) { settings = { ...settings, ...next }; for (const s of sims) { s.mass = headMass({ id: s.id, count: s.count, local: s.local, react: s.react }, settings); s.size = headSize(s.mass, s.react, box.width); } layout(); },
    step,
    project: () => tabOrder().map((s) => ({ id: s.id, mass: s.mass, react: s.react, local: s.local, size: s.size, x: s.sx, y: s.sy, scale: s.scale, depth: s.depth, rank: s.rank, angle: s.angle, speed: s.speed })),
    bodies: () => tabOrder().map((s) => ({ id: s.id, mass: s.mass, size: s.size, X: s.X, Y: s.Y, Z: s.Z, sun: s.sun?.id ?? null, ring: s.fitR })),
  };
}
