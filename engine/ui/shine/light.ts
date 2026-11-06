/**
 * The page's light: where the light seems to come from for one post's shine, from the pointer, the scroll position, the
 * device's tilt and a slow idle drift (docs/plans/2026-11-06-shine-design.md section 3). `lightAt` is pure; `light` is the
 * one store of the inputs the page shares, listening only while a host is registered.
 *
 * Units: a light is {x, y} in -1.5..1.5, as the approved bench has it (docs/research/2026-11-06-shine-bench). `px`, `py`
 * are the pointer's place in the window as -1..1 from its center; `tx`, `ty` are the tilt as -1..1 over 30 degrees.
 * `t` is milliseconds; `ease`'s `dt` is seconds.
 *
 * Engine code: it names no card and no instance.
 */
import { motionReduced } from '../appearance.ts';
import type { Light } from './band.ts';

export type { Light };

/** The light at rest, and under reduced motion whatever the input. */
export const REST: Light = { x: -0.35, y: -0.45 };

export type LightInput = { readonly px: number; readonly py: number; readonly tx: number; readonly ty: number; readonly tilt: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The light a host at `rect` wants at time `t`; `phase` is the host's own seed, so posts do not drift in lockstep. */
export function lightAt(
  input: LightInput,
  rect: { readonly top: number; readonly height: number },
  viewport: { readonly height: number },
  t: number,
  phase: number,
): Light {
  if (motionReduced()) return REST;
  let x = REST.x * 0.4;
  let y = REST.y * 0.4;
  x += input.px * 0.9;
  y += input.py * 0.55;
  const s = (rect.top + rect.height / 2) / viewport.height - 0.5;
  y += s * 2.8;
  x += s * 0.9;
  if (input.tilt) {
    x += input.tx * 1.1;
    y += input.ty * 1.1;
  }
  x += Math.sin(t / 1700 + phase) * 0.1 + Math.sin(t / 640 + phase * 0.3) * 0.025;
  y += Math.cos(t / 2100) * 0.08 + Math.cos(t / 530 + phase) * 0.02;
  return { x: clamp(x, -1.5, 1.5), y: clamp(y, -1.5, 1.5) };
}

/** One step of the ease toward `target`, with a 110ms time constant. */
export const ease = (cur: number, target: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-dt / 0.11));

let tiltGate: () => boolean = () => false;
/** Task 5's tilt state wires itself here: the device's orientation counts only while this says true. */
export const setTiltGate = (gate: () => boolean): void => { tiltGate = gate; };

const hosts = new Set<object>();
const state = { px: 0, py: 0, tx: 0, ty: 0 };

function onPointer(e: Event): void {
  const p = e as PointerEvent;
  if (p.pointerType !== 'mouse' && p.pointerType !== 'pen') return;
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  state.px = (p.clientX / window.innerWidth - 0.5) * 2;
  state.py = (p.clientY / window.innerHeight - 0.5) * 2;
}

function onOrientation(e: Event): void {
  if (!tiltGate()) return;
  const o = e as DeviceOrientationEvent;
  state.tx = clamp((o.gamma ?? 0) / 30, -1, 1);
  state.ty = clamp((o.beta ?? 0) / 30, -1, 1);
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
      window.addEventListener('pointermove', onPointer, LISTEN);
      window.addEventListener('deviceorientation', onOrientation, LISTEN);
    }
  },
  /** Unregister a host; the last one detaches the listeners. */
  detach(host: object): void {
    if (!hosts.delete(host) || hosts.size > 0) return;
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
  },
  /** For tests: forget every host, drop the listeners and zero the inputs. */
  reset(): void {
    hosts.clear();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
    state.px = state.py = state.tx = state.ty = 0;
  },
};
