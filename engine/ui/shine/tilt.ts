/**
 * The device's tilt: whether the phone's orientation may move the light, and the one tap that asks the browser for it
 * (docs/plans/2026-11-06-shine-design.md section 4). `tiltState` is the answer the Appearance row and the light share:
 * importing this module wires the light's gate to it, so the light reads the device's orientation only while it says
 * `'on'`.
 *
 * Precedence, first match wins: the preference off is `'off'`; reduced motion is `'held'` (the account's choice stays on,
 * and the row says it is held); no `DeviceOrientationEvent` is `'unsupported'`; the browser's refusal is `'denied'`; a
 * grant the browser asks for and this device has not given is `'needs-allow'`; a device that was listened to for a second
 * and sent no orientation is `'unsupported'`; otherwise `'on'`.
 *
 * The device's answer lives in localStorage under `kb-tilt-device`. It is per device by nature, is never sent anywhere, and
 * is a convenience: a cleared browser asks again. The preference itself is the account's (Preferences.tilt); the screens
 * that hold it tell this module through `setTiltPreference`.
 *
 * Listening for the one-second "does this device report tilt" probe costs a listener and a timer, so it runs only while
 * something has asked to watch (`watchTilt`: the Appearance row while the preference is on, and the shine loop while any
 * host is registered) and the preference is on and motion is not reduced. A page with no use for tilt starts nothing.
 *
 * Engine code: it names no card and no instance.
 */
import { motionReduced, subscribeMotion } from '../appearance.ts';
import { setTiltGate } from './light.ts';

export type TiltPreference = 'off' | 'on';
export type TiltState = 'on' | 'off' | 'needs-allow' | 'denied' | 'unsupported' | 'held';

const KEY = 'kb-tilt-device';
const PROBE_MS = 1000;

type PermissionedEvent = { requestPermission?: () => Promise<string> };
const orientationEvent = (): (PermissionedEvent & object) | undefined => {
  const e = (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
  return typeof e === 'function' || (typeof e === 'object' && e !== null) ? (e as PermissionedEvent & object) : undefined;
};

/** Whether this browser reports device orientation at all. */
export const tiltSupported = (): boolean => orientationEvent() !== undefined;
const needsGrant = (): boolean => typeof orientationEvent()?.requestPermission === 'function';

function stored(): 'granted' | 'denied' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch { return null; }
}
function store(v: 'granted' | 'denied'): void {
  try { localStorage.setItem(KEY, v); } catch { /* A device that keeps nothing asks again next time. */ }
}

/* The probe: idle until watched, listening for up to a second, then seen or silent. */
let probe: 'idle' | 'listening' | 'seen' | 'silent' = 'idle';
let timer: ReturnType<typeof setTimeout> | undefined;
let watchers = 0;
let preference: TiltPreference = 'off';
/** The last tap's request to the browser threw, so it was no answer (the row says so). */
let askFailed = false;
const listeners = new Set<() => void>();
const notify = (): void => { for (const l of [...listeners]) l(); };

/** Desktop browsers fire one orientation event of nulls; only a reading counts as the device reporting tilt. */
function onProbe(e: Event): void {
  const o = e as DeviceOrientationEvent;
  if (!Number.isFinite(o.gamma) && !Number.isFinite(o.beta)) return;
  stopListening();
  probe = 'seen';
  notify();
}
function stopListening(): void {
  window.removeEventListener('deviceorientation', onProbe);
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
/** The device could report tilt right now: it has the API, and any grant it asks for was given. */
const ready = (): boolean => tiltSupported() && (!needsGrant() || stored() === 'granted');

function startProbe(): void {
  if (watchers === 0 || probe !== 'idle' || preference !== 'on' || motionReduced() || !ready()) return;
  probe = 'listening';
  window.addEventListener('deviceorientation', onProbe, { passive: true });
  timer = setTimeout(() => { timer = undefined; if (probe === 'listening') { window.removeEventListener('deviceorientation', onProbe); probe = 'silent'; notify(); } }, PROBE_MS);
}

/** Ask to have the probe run while this is held; returns the release. Starts nothing on a device that cannot report tilt yet. */
export function watchTilt(): () => void {
  watchers++;
  startProbe();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--watchers === 0 && probe === 'listening') { stopListening(); probe = 'idle'; }
  };
}

/** What the tilt is on this device, given the account's preference. */
export function tiltState(pref: TiltPreference = preference): TiltState {
  if (pref !== 'on') return 'off';
  if (motionReduced()) return 'held';
  if (!tiltSupported()) return 'unsupported';
  const answer = stored();
  if (answer === 'denied') return 'denied';
  if (needsGrant() && answer !== 'granted') return 'needs-allow';
  return probe === 'silent' ? 'unsupported' : 'on';
}

/** The screens that hold the account's preference say it here when it is read or changed. */
export function setTiltPreference(pref: TiltPreference): void {
  if (pref === preference) return;
  preference = pref;
  askFailed = false;
  if (pref === 'on') startProbe();
  else if (probe === 'listening') { stopListening(); probe = 'idle'; }
  notify();
}

/**
 * Ask the browser for the device's orientation. Call it only inside a tap: iOS refuses it elsewhere, and a refusal is never
 * asked again without one. A browser that asks for nothing needs no tap, and this only re-runs the probe. A request that
 * throws (outside a gesture, or the browser failing) is not an answer, so nothing is stored and the state stays as it was,
 * for the next tap to try again. Returns the state afterwards.
 */
export async function allowTilt(): Promise<TiltState> {
  const ask = orientationEvent()?.requestPermission;
  if (typeof ask === 'function') {
    askFailed = false;
    try {
      const answer = await ask.call(orientationEvent());
      store(answer === 'granted' ? 'granted' : 'denied');
    } catch { askFailed = true; /* Not an answer; the row says so. */ }
  }
  if (probe !== 'listening') probe = 'idle';
  startProbe();
  notify();
  return tiltState();
}

/** Whether the last tap's request to the browser threw, so the row can say the browser gave no answer. */
export const tiltAskFailed = (): boolean => askFailed;

/** For `useSyncExternalStore`: the device's answer, the probe, the preference and the motion setting changing. */
export function subscribeTilt(onChange: () => void): () => void {
  listeners.add(onChange);
  /* Motion turned back on is when a probe held back by reduced motion may start. */
  const off = subscribeMotion(() => { startProbe(); onChange(); });
  return () => { listeners.delete(onChange); off(); };
}

/** For tests: forget the probe, the watchers and the preference. */
export function resetTilt(): void {
  stopListening();
  probe = 'idle';
  watchers = 0;
  preference = 'off';
  askFailed = false;
  listeners.clear();
}

/* The light counts the device's orientation only while the tilt is on. */
setTiltGate(() => tiltState() === 'on');
