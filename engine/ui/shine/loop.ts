/**
 * The page's shine loop (docs/plans/2026-11-06-shine-design.md section 6): one animation frame loop serves every post's
 * shine canvas, in the shape of the Whoops! suds loop (instances/divided-world/cards/whoops/suds.ts) so that loop can move
 * here later. A host registers its canvas and a `draw`; the loop eases that host's light each frame and calls `draw`
 * when the light moved, when the host has something in flight, or on the idle cadence while shimmer runs.
 *
 * The loop is started on demand, when a registered host is in view and needs a frame, and stops itself when none does,
 * so an idle page costs nothing. A frame that throws never stops the loop: the next frame is asked for before this one
 * runs, and each host's draw is wrapped on its own, so one post's canvas costs only that post its frame. A host out of
 * view is not drawn; it is told once (`hidden`) so it can drop its buffers. A host that unregisters is never drawn again,
 * even later in the same frame. The module draws nothing and never sizes a canvas: that is the host's.
 *
 * Units: `t` is the frame's timestamp in milliseconds, `dt` is seconds (at most 0.05), `light` is {x, y} in -1.5..1.5
 * (light.ts), `box` is the host's CSS px size, and `density` is canvas px per CSS px, capped at `MAX_DENSITY`.
 *
 * Engine code: it names no card and no instance.
 */
import { motionReduced, subscribeMotion } from '../appearance.ts';
import { watchInView } from './inView.ts';
import { ease, light, lightAt, type Light } from './light.ts';

export interface ShineFrame {
  readonly t: number;
  readonly dt: number;
  readonly light: Light;
  /** The light moved more than `MOVED` since the host last drew (or this is its first draw). */
  readonly moved: boolean;
  /** This draw is the idle cadence's: shimmer is running and nothing else asked for it. */
  readonly idle: boolean;
}

/** Summed |dx| + |dy| of the light since the last draw that earns a new one. */
const MOVED = 0.004;
/** Eased light closer than this to its target is settled. */
const SETTLED = 0.0005;
const MAX_DENSITY = 2;
/** Shimmer redraws every second frame, about 30 a second. */
const IDLE_EVERY = 2;
/** Golden-angle step, so unseeded posts do not drift in lockstep. */
const PHASE_STEP = 2.399963;

export interface Options {
  /** The host's own seed for its idle drift; by default one is derived from the order of registration. */
  readonly phase?: number;
  /** Called once when the host leaves view, so it can drop its buffers. It is drawn again, fresh, when it returns. */
  readonly hidden?: () => void;
}

interface Reg {
  canvas: HTMLCanvasElement; box: { w: number; h: number }; density: number;
  draw: (frame: ShineFrame) => boolean; hidden: (() => void) | undefined; phase: number;
  inView: boolean; fresh: boolean; busy: boolean; settling: boolean;
  cur: Light | null; drawn: Light | null; draws: number; stop: () => void;
}

const hosts = new Map<object, Reg>();
let handle: number | null = null;
let last = 0;
let frameCount = 0;
let made = 0;
let unsubscribeMotion: (() => void) | null = null;

const sum = (a: Light, b: Light) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Whether this host wants the next frame. */
const wants = (r: Reg, shimmer: boolean) => r.inView && (r.fresh || r.busy || r.settling || shimmer);
const anyWants = () => { const s = !motionReduced(); return [...hosts.values()].some((r) => wants(r, s)); };

function step(t: number): void {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
  last = t;
  frameCount++;
  const shimmer = !motionReduced();
  /* A snapshot, and a check against the map, so a draw that unregisters any host is safe. */
  for (const [host, r] of [...hosts]) {
    if (hosts.get(host) !== r || !r.inView) continue;
    try {
      const target = lightAt(light.input(), r.canvas.getBoundingClientRect(), { height: window.innerHeight }, t, r.phase);
      /* A host's first light is its target; after that it eases. */
      r.cur = r.cur ? { x: ease(r.cur.x, target.x, dt), y: ease(r.cur.y, target.y, dt) } : target;
      r.settling = sum(r.cur, target) > SETTLED;
      const moved = r.drawn === null || sum(r.cur, r.drawn) > MOVED;
      const idle = shimmer && !moved && !r.fresh && !r.busy && frameCount % IDLE_EVERY === 0;
      if (!(moved || r.fresh || r.busy || idle)) continue;
      r.fresh = false;
      r.drawn = r.cur;
      r.draws++;
      r.busy = r.draw({ t, dt, light: r.cur, moved, idle });
    } catch (err) {
      console.error(err);
      r.busy = false;
    }
  }
}

/** A frame that throws never stops the loop: the next one is asked for first. The loop stops itself when no host needs one. */
function frame(t: number): void {
  handle = requestAnimationFrame(frame);
  try { step(t); } catch (err) { console.error(err); }
  if (!anyWants()) { cancelAnimationFrame(handle); handle = null; }
}

/**
 * Reduced motion changed while the page was open (a setting, or the device's). Every host redraws once from a fresh light,
 * which under reduced motion is REST, and the loop then stops by itself; turned off, shimmer wakes a loop that had stopped.
 */
function onMotionChange(): void {
  for (const r of hosts.values()) { r.fresh = true; r.cur = null; }
  start();
}
const watchMotion = (): void => { unsubscribeMotion ??= subscribeMotion(onMotionChange); };
const unwatchMotion = (): void => { unsubscribeMotion?.(); unsubscribeMotion = null; };

function start(): void {
  if (handle !== null || !anyWants()) return;
  last = performance.now();
  handle = requestAnimationFrame(frame);
}

/**
 * Registers (or re-registers) a host's shine canvas, watches it with `watchInView`, and returns the density to size it
 * by (capped at 2). `draw` returns whether the host still has something in flight. The host draws once when first in view.
 */
export function register(
  host: object, canvas: HTMLCanvasElement, box: { w: number; h: number }, density: number,
  draw: (frame: ShineFrame) => boolean, options: Options = {},
): number {
  const old = hosts.get(host);
  old?.stop();
  const capped = Math.min(MAX_DENSITY, Math.max(0, density));
  const reg: Reg = {
    canvas, box, density: capped, draw, hidden: options.hidden, phase: options.phase ?? old?.phase ?? made++ * PHASE_STEP,
    inView: false, fresh: true, busy: false, settling: false, cur: old?.cur ?? null, drawn: null, draws: old?.draws ?? 0, stop: () => {},
  };
  hosts.set(host, reg);
  watchMotion();
  light.attach(host);
  reg.stop = watchInView(canvas, (inView) => {
    if (hosts.get(host) !== reg || reg.inView === inView) return;
    reg.inView = inView;
    if (inView) { reg.fresh = true; reg.drawn = null; reg.cur = null; start(); return; }
    reg.busy = false;
    try { reg.hidden?.(); } catch (err) { console.error(err); }
  });
  return capped;
}

/** Stops watching the host and never draws it again. */
export function unregister(host: object): void {
  const r = hosts.get(host);
  if (!r) return;
  hosts.delete(host);
  r.stop();
  light.detach(host);
  if (hosts.size === 0) unwatchMotion();
}

/** The host has something new in flight (a burst): make sure a frame is coming. A host out of view waits until it is seen. */
export function wake(host: object): void {
  const r = hosts.get(host);
  if (!r) return;
  r.busy = true;
  start();
}

/** For tests only: what the loop has done and whether it runs, and a way back to a fresh page. */
export const probe = {
  draws: (host: object) => hosts.get(host)?.draws ?? 0,
  frames: () => frameCount,
  running: () => handle !== null,
  reset(): void {
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
    for (const [host, r] of hosts) { r.stop(); light.detach(host); }
    hosts.clear();
    unwatchMotion();
    frameCount = 0; made = 0; last = 0;
  },
};
