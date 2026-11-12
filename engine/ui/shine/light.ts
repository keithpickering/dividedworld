/**
 * The page's light: where the light seems to come from for one post's shine, from the pointer, the scroll position, the
 * device's tilt and a slow idle drift (docs/plans/2026-11-06-shine-design.md section 3). `lightAt` is pure; `light` is the
 * one store of the inputs the page shares, listening only while a host is registered.
 *
 * Units: a light is {x, y} in -1.5..1.5, as the approved bench has it (docs/research/2026-11-06-shine-bench). `px`, `py`
 * are the pointer's place in the window as -1..1 from its center; `tx`, `ty` are the tilt as -1..1 over 30 degrees.
 * `t` is milliseconds; `ease`'s `dt` is seconds.
 *
 * A host may ask to be lit from near (`near`, the loop's option): the window terms above move a light only 0.02 to 0.10 of a small host's
 * width across the whole page (a pack, 180 px wide), about what the idle drift does, so a near host's light also answers where the pointer
 * is over the host's own box. The pointer's offset from the host's center is `nx`, `ny`, in half-widths of the host for x and half-heights
 * for y (-1 at its left or top edge, 1 at its right or bottom). The relief puts its light at `light * RELIEF_LIGHT_SCALE` over pixels that
 * run -1..1, so the "pointed" light `(clamp(nx) / 1.3, clamp(ny) / 1.3)` (clamped to -1..1) stands exactly at the pointer's place on the
 * box, and the idle drift is added to it so it lives. The near light is a blend of that and the page's light (what a host that is not near
 * gets) by `d = max(|nx|, |ny|)`: all pointed for d <= 1 (the pointer is on the box), a smoothstep down to all page's at NEAR_REACH (2.5)
 * and beyond, so the light walks from the page's to the pointer's as the pointer approaches, with no jump. The pointer's client position is
 * derived from `px`, `py` and the window's width and height. A device with no fine pointer never places the pointer (`LightInput.pointed`
 * stays false), and then a near host gets no near term at all, so its light is a post's.
 *
 * Engine code: it names no card and no instance.
 */
import { motionReduced } from '../appearance.ts';
import type { Light } from './band.ts';
import { RELIEF_LIGHT_SCALE } from './relief.ts';

export type { Light };

/** The light at rest, and under reduced motion whatever the input. */
export const REST: Light = { x: -0.35, y: -0.45 };

export type LightInput = {
  readonly px: number; readonly py: number; readonly tx: number; readonly ty: number; readonly tilt: boolean;
  /** A mouse or pen has moved on a fine pointer, so `px`, `py` are a place and not the window's middle by default (absent is false). */
  readonly pointed?: boolean;
};

/** How far from the box's edge, in half-extents from its center, the pointer is still felt: past this a near host's light is the page's. */
export const NEAR_REACH = 2.5;
/** The light that stands at a place on the pack: the relief's light is `light * RELIEF_LIGHT_SCALE` (engine/ui/shine/relief.ts), so divide it out. */
const POINTED_SCALE = 1 / RELIEF_LIGHT_SCALE;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The light a host at `rect` wants at time `t`; `phase` is the host's own seed, so posts do not drift in lockstep. A `near` host also
 * needs `rect.left` and `rect.width` and the window's width, and gets the near term only when the pointer has been placed.
 */
export function lightAt(
  input: LightInput,
  rect: { readonly top: number; readonly height: number; readonly left?: number; readonly width?: number },
  viewport: { readonly height: number; readonly width?: number },
  t: number,
  phase: number,
  near: boolean = false,
): Light {
  if (motionReduced()) return REST;
  let x = REST.x * 0.4;
  let y = REST.y * 0.4;
  x += input.px * 0.9;
  y += input.py * 0.55;
  const s = viewport.height > 0 ? (rect.top + rect.height / 2) / viewport.height - 0.5 : 0;
  y += s * 2.8;
  x += s * 0.9;
  if (input.tilt) {
    x += input.tx * 1.1;
    y += input.ty * 1.1;
  }
  const dx = Math.sin(t / 1700 + phase) * 0.1 + Math.sin(t / 640 + phase * 0.3) * 0.025;
  const dy = Math.cos(t / 2100) * 0.08 + Math.cos(t / 530 + phase) * 0.02;
  const { left, width } = rect;
  let w = 0;
  let pointedX = 0;
  let pointedY = 0;
  if (near && input.pointed && left !== undefined && width !== undefined && width > 0 && rect.height > 0 && viewport.width !== undefined && viewport.width > 0 && viewport.height > 0) {
    const cx = (input.px / 2 + 0.5) * viewport.width;
    const cy = (input.py / 2 + 0.5) * viewport.height;
    const nx = (cx - (left + width / 2)) / (width / 2);
    const ny = (cy - (rect.top + rect.height / 2)) / (rect.height / 2);
    const d = Math.max(Math.abs(nx), Math.abs(ny));
    const u = clamp((NEAR_REACH - d) / (NEAR_REACH - 1), 0, 1);
    w = u * u * (3 - 2 * u);
    pointedX = clamp(nx, -1, 1) * POINTED_SCALE;
    pointedY = clamp(ny, -1, 1) * POINTED_SCALE;
  }
  x += dx;
  y += dy;
  if (w > 0) {
    x = x * (1 - w) + (pointedX + dx) * w;
    y = y * (1 - w) + (pointedY + dy) * w;
  }
  return { x: clamp(x, -1.5, 1.5), y: clamp(y, -1.5, 1.5) };
}

/** One step of the ease toward `target`, with a 110ms time constant. */
export const ease = (cur: number, target: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-Math.max(0, dt) / 0.11));

let tiltGate: () => boolean = () => false;
/** Task 5's tilt state wires itself here: the device's orientation counts only while this says true. */
export const setTiltGate = (gate: () => boolean): void => { tiltGate = gate; };

const hosts = new Set<object>();
const state = { px: 0, py: 0, tx: 0, ty: 0, pointed: false };

/* The pointer query is asked once when the first host attaches and kept current by its `change` event, not per pointermove. */
let pointerQuery: MediaQueryList | undefined;
let finePointer = false;
const onPointerQuery = (e: { matches: boolean }): void => { finePointer = e.matches; };
function watchPointerQuery(): void {
  pointerQuery = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  finePointer = pointerQuery?.matches ?? false;
  pointerQuery?.addEventListener?.('change', onPointerQuery);
}
function unwatchPointerQuery(): void {
  pointerQuery?.removeEventListener?.('change', onPointerQuery);
  pointerQuery = undefined;
  finePointer = false;
}

function onPointer(e: Event): void {
  const p = e as PointerEvent;
  if (p.pointerType !== 'mouse' && p.pointerType !== 'pen') return;
  if (!finePointer) return;
  // A zero-size window (a hidden frame) has no middle to measure from: that axis rests at 0 rather than going to NaN.
  state.px = window.innerWidth > 0 ? (p.clientX / window.innerWidth - 0.5) * 2 : 0;
  state.py = window.innerHeight > 0 ? (p.clientY / window.innerHeight - 0.5) * 2 : 0;
  state.pointed = true;
}

function onOrientation(e: Event): void {
  if (!tiltGate()) return;
  const o = e as DeviceOrientationEvent;
  const axis = (v: number | null | undefined) => (Number.isFinite(v) ? clamp((v as number) / 30, -1, 1) : 0);
  state.tx = axis(o.gamma);
  state.ty = axis(o.beta);
}

const LISTEN = { passive: true } as const;

export const light = {
  get px() { return state.px; },
  get py() { return state.py; },
  get tx() { return state.tx; },
  get ty() { return state.ty; },
  /** The inputs now; tilt is on only while the gate says so. */
  input(): LightInput { return { ...state, tilt: tiltGate() }; },
  /** Register a host (by object); the first one attaches the page's listeners. */
  attach(host: object): void {
    if (hosts.has(host)) return;
    hosts.add(host);
    if (hosts.size === 1) {
      watchPointerQuery();
      window.addEventListener('pointermove', onPointer, LISTEN);
      window.addEventListener('deviceorientation', onOrientation, LISTEN);
    }
  },
  /** Unregister a host; the last one detaches the listeners. */
  detach(host: object): void {
    if (!hosts.delete(host) || hosts.size > 0) return;
    unwatchPointerQuery();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
  },
  /** For tests: forget every host, drop the listeners and zero the inputs. */
  reset(): void {
    hosts.clear();
    unwatchPointerQuery();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
    state.px = state.py = state.tx = state.ty = 0;
    state.pointed = false;
  },
};
