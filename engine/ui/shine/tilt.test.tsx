import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { light } from './light.ts';
import { allowTilt, resetTilt, setTiltPreference, tiltState, watchTilt } from './tilt.ts';

const KEY = 'kb-tilt-device';
const root = document.documentElement;

function stubDevice(requestPermission?: () => Promise<string>) {
  const E = function DeviceOrientationEvent() {} as unknown as { requestPermission?: () => Promise<string> };
  if (requestPermission) E.requestPermission = requestPermission;
  vi.stubGlobal('DeviceOrientationEvent', E);
  return E;
}
const orient = (gamma: number | null, beta: number | null) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { gamma, beta }));

beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); root.removeAttribute('data-kb-motion'); resetTilt(); light.reset(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); resetTilt(); light.reset(); root.removeAttribute('data-kb-motion'); });

describe('tiltState', () => {
  it('is off while the preference is off, on any device', () => {
    stubDevice();
    expect(tiltState('off')).toBe('off');
  });
  it('is unsupported where there is no DeviceOrientationEvent', () => {
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    expect(tiltState('on')).toBe('unsupported');
  });
  it('is on where the device needs no grant', () => {
    stubDevice();
    expect(tiltState('on')).toBe('on');
  });
  it('is needs-allow where a grant is asked for and not given', () => {
    stubDevice(async () => 'granted');
    expect(tiltState('on')).toBe('needs-allow');
  });
  it('is on once the device has granted, and denied once it refused', () => {
    stubDevice(async () => 'granted');
    localStorage.setItem(KEY, 'granted');
    expect(tiltState('on')).toBe('on');
    localStorage.setItem(KEY, 'denied');
    expect(tiltState('on')).toBe('denied');
  });
  it('is held while motion is reduced, but off stays off', () => {
    stubDevice();
    root.setAttribute('data-kb-motion', 'reduce');
    expect(tiltState('on')).toBe('held');
    expect(tiltState('off')).toBe('off');
  });
  it('survives a localStorage that throws', () => {
    stubDevice(async () => 'granted');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(tiltState('on')).toBe('needs-allow');
  });
  it('is unsupported once a second of listening brings no reading, and on once one comes', () => {
    vi.useFakeTimers();
    stubDevice();
    setTiltPreference('on');
    const release = watchTilt();
    expect(tiltState('on')).toBe('on');
    vi.advanceTimersByTime(999);
    expect(tiltState('on')).toBe('on');
    vi.advanceTimersByTime(2);
    expect(tiltState('on')).toBe('unsupported');
    release();
    resetTilt();
    setTiltPreference('on');
    const again = watchTilt();
    orient(null, null);
    vi.advanceTimersByTime(1100);
    expect(tiltState('on')).toBe('unsupported');
    resetTilt();
    setTiltPreference('on');
    watchTilt();
    orient(4, -3);
    vi.advanceTimersByTime(1100);
    expect(tiltState('on')).toBe('on');
    again();
  });
  it('starts no listener and no timer until something watches, or on a device that cannot report yet', () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, 'addEventListener');
    stubDevice();
    expect(tiltState('on')).toBe('on');
    expect(vi.getTimerCount()).toBe(0);
    resetTilt();
    stubDevice(async () => 'granted');
    watchTilt();
    expect(vi.getTimerCount()).toBe(0);
    expect(add.mock.calls.filter(([t]) => t === 'deviceorientation')).toHaveLength(0);
  });
  it('stops listening when the last watcher lets go', () => {
    vi.useFakeTimers();
    stubDevice();
    setTiltPreference('on');
    const a = watchTilt();
    const b = watchTilt();
    expect(vi.getTimerCount()).toBe(1);
    a();
    expect(vi.getTimerCount()).toBe(1);
    b();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the probe runs only for a watched page with the tilt on', () => {
  const listens = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => c[0] === 'deviceorientation').length;
  it('starts nothing while the preference is off, starts when it goes on, and ends in unsupported after a second of silence', () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, 'addEventListener');
    stubDevice();
    watchTilt();
    expect(listens(add)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    setTiltPreference('on');
    expect(listens(add)).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1100);
    expect(tiltState()).toBe('unsupported');
  });
  it('stops an idle probe when the preference goes off', () => {
    vi.useFakeTimers();
    stubDevice();
    watchTilt();
    setTiltPreference('on');
    expect(vi.getTimerCount()).toBe(1);
    setTiltPreference('off');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('starts nothing under reduced motion, and nothing with no watcher', () => {
    vi.useFakeTimers();
    stubDevice();
    setTiltPreference('on');
    expect(vi.getTimerCount()).toBe(0);
    resetTilt();
    root.setAttribute('data-kb-motion', 'reduce');
    watchTilt();
    setTiltPreference('on');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('allowTilt', () => {
  it('asks the browser, and keeps a grant', async () => {
    const ask = vi.fn(async () => 'granted');
    stubDevice(ask);
    setTiltPreference('on');
    expect(ask).not.toHaveBeenCalled();
    expect(await allowTilt()).toBe('on');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBe('granted');
  });
  it('keeps a refusal, and does not ask again by itself', async () => {
    const ask = vi.fn(async () => 'denied');
    stubDevice(ask);
    setTiltPreference('on');
    expect(await allowTilt()).toBe('denied');
    expect(localStorage.getItem(KEY)).toBe('denied');
    expect(tiltState('on')).toBe('denied');
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('a request that throws is no answer: nothing is stored and the next tap may ask again', async () => {
    const ask = vi.fn(async () => { throw new Error('needs a gesture'); });
    stubDevice(ask);
    setTiltPreference('on');
    expect(await allowTilt()).toBe('needs-allow');
    expect(localStorage.getItem(KEY)).toBeNull();
    await allowTilt();
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('asks nothing where no grant is needed', async () => {
    stubDevice();
    setTiltPreference('on');
    expect(await allowTilt()).toBe('on');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('the light\'s gate follows tiltState', () => {
  const tilted = () => { orient(15, -15); return light.input().tilt; };
  it('is true only while on', async () => {
    stubDevice(async () => 'granted');
    light.attach({});
    setTiltPreference('on');
    expect(light.input().tilt).toBe(false); // needs-allow
    await allowTilt();
    expect(light.input().tilt).toBe(true);
    expect(tilted()).toBe(true);
    expect(light.tx).toBeCloseTo(0.5);
    setTiltPreference('off');
    expect(light.input().tilt).toBe(false);
  });
  it('is false when denied and when held', async () => {
    stubDevice(async () => 'denied');
    setTiltPreference('on');
    await allowTilt();
    expect(light.input().tilt).toBe(false);
    localStorage.setItem(KEY, 'granted');
    expect(light.input().tilt).toBe(true);
    root.setAttribute('data-kb-motion', 'reduce');
    expect(light.input().tilt).toBe(false);
  });
});
