/**
 * The shine tip (docs/plans/2026-11-06-shine-plan.md, Task 6; design section 4): the first shiny post in view, on a phone that can
 * tilt and has not been asked, shows a tip with a button that turns tilt on. The button runs `allowTilt` inside its own click (a
 * browser's permission prompt needs the tap), sets the account's preference to on, and the tip is seen.
 */
import { useRef, useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Fake } from '../data/fake.ts';
import { light } from '../shine/light.ts';
import { probe, register, unregister } from '../shine/loop.ts';
import { resetTilt, setTiltPreference, tiltState } from '../shine/tilt.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { TipsProvider, useTip } from './Tips.tsx';
import { usePreferenceSaves } from '../account/preferences.ts';
import { pagePreferences } from '../account/pagePreferences.ts';
import { usePlayer } from '../player.tsx';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });
const dialog = () => screen.queryByRole('dialog');
const root = document.documentElement;

let ask: ReturnType<typeof vi.fn>;
const hosts: object[] = [];
function shiny(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  document.body.append(c);
  const host = {};
  hosts.push(host);
  register(host, c, { w: 100, h: 50 }, 1, () => false);
  return c;
}
/* A fake IntersectionObserver the test drives by hand: nothing is in view until it says so. */
let observers: FakeObserver[] = [];
class FakeObserver {
  readonly seen = new Set<Element>();
  constructor(readonly cb: IntersectionObserverCallback) { observers.push(this); }
  observe(el: Element) { this.seen.add(el); }
  unobserve(el: Element) { this.seen.delete(el); }
  disconnect() { this.seen.clear(); }
  takeRecords() { return []; }
}
const see = (el: Element, isIntersecting: boolean) => {
  for (const o of observers) if (o.seen.has(el)) o.cb([{ target: el, isIntersecting } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
};
function phone(opts: { coarse?: boolean; permission?: boolean } = {}) {
  const { coarse = true, permission = true } = opts;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  ask = vi.fn(async () => 'granted');
  vi.stubGlobal('DeviceOrientationEvent', Object.assign(function DeviceOrientationEvent() {}, permission ? { requestPermission: ask } : {}));
}
function signedIn(): Fake {
  const fake = buildWorld();
  fake.signInAs(fake.seed.account('me'));
  return fake;
}
const open = (fake: Fake) => renderIn(fake, <TipsProvider><p>page</p></TipsProvider>);

beforeEach(() => { observers = []; Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); resetTilt(); root.setAttribute('data-kb-motion', 'full'); });
afterEach(() => {
  for (const h of hosts.splice(0)) unregister(h);
  document.querySelectorAll('canvas').forEach((c) => c.remove());
  probe.reset(); light.reset(); resetTilt(); pagePreferences.clear();
  for (const a of ['data-kb-motion', 'data-kb-text-size', 'data-kb-contrast']) root.removeAttribute(a);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('the shine tip', () => {
  test('shows once, for the first shiny post in view, with three buttons', async () => {
    phone();
    const fake = signedIn();
    open(fake);
    await settle();
    shiny(); shiny();
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(tip).getAllByRole('button').map((b) => b.textContent)).toEqual(['Skip all tips', 'Action of shine', 'Got it']);
  });

  test('a host already on the page when the provider mounts is asked about too', async () => {
    phone();
    shiny();
    open(signedIn());
    expect(await screen.findByRole('dialog', { name: 'Title of shine' })).toBeInTheDocument();
  });

  test('the action runs allowTilt inside the click, turns the preference on, and the tip is seen', async () => {
    phone();
    const fake = signedIn();
    open(fake);
    await settle();
    shiny();
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    fireEvent.click(within(tip).getByRole('button', { name: 'Action of shine' }));
    expect(ask, 'the browser is asked in the tap itself, before anything awaits').toHaveBeenCalledTimes(1);
    await waitFor(async () => expect((await fake.preferences()).tilt).toBe('on'));
    await waitFor(() => expect(dialog()).toBeNull());
    expect((await fake.preferences()).tipsSeen).toEqual(['shine']);
    expect(tiltState('on')).toBe('on');
  });

  test('Got it sees the tip and turns nothing on', async () => {
    phone();
    const fake = signedIn();
    open(fake);
    await settle();
    shiny();
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    await userEvent.click(within(tip).getByRole('button', { name: 'Got it' }));
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect((await fake.preferences()).tilt).toBe('off');
    expect((await fake.preferences()).tipsSeen).toEqual(['shine']);
  });

  test('a browser that asks for no permission is asked about tilt all the same', async () => {
    phone({ permission: false });
    open(signedIn());
    await settle();
    shiny();
    expect(await screen.findByRole('dialog', { name: 'Title of shine' })).toBeInTheDocument();
  });

  test('a browser with no permission prompt: the action still sees the tip and turns tilt on', async () => {
    phone({ permission: false });
    const fake = signedIn();
    const save = vi.spyOn(fake, 'setPreferences');
    open(fake);
    await settle();
    shiny();
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    fireEvent.click(within(tip).getByRole('button', { name: 'Action of shine' }));
    await settle();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tilt: 'on' }));
    expect((await fake.preferences()).tipsSeen).toContain('shine');
    expect(dialog()).toBeNull();
  });

  test('an action that throws is reported, and the tip is still seen', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = signedIn();
    function Boom() {
      const el = useRef<HTMLButtonElement>(null);
      useTip('shine', el, { action: { run: () => { throw new Error('boom'); } } });
      return <button type="button" ref={el}>target</button>;
    }
    renderIn(fake, <TipsProvider><Boom /></TipsProvider>);
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    expect(() => fireEvent.click(within(tip).getByRole('button', { name: 'Action of shine' }))).not.toThrow();
    await settle();
    expect(report).toHaveBeenCalled();
    expect((await fake.preferences()).tipsSeen).toContain('shine');
    expect(dialog()).toBeNull();
  });

  test('a tip with an inline action is not withdrawn by a re-render', async () => {
    const fake = signedIn();
    let bump!: () => void;
    function Inline() {
      const el = useRef<HTMLButtonElement>(null);
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      useTip('shine', el, { action: { run: () => { void n; } } });
      return <button type="button" ref={el}>target</button>;
    }
    renderIn(fake, <TipsProvider><Inline /></TipsProvider>);
    await screen.findByRole('dialog', { name: 'Title of shine' });
    act(() => bump());
    act(() => bump());
    await settle();
    expect(dialog()).not.toBeNull();
  });

  test('an open tip stays open when the host in view changes', async () => {
    phone();
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    open(signedIn());
    await settle();
    const first = shiny(), second = shiny();
    see(first, true);
    await screen.findByRole('dialog', { name: 'Title of shine' });
    act(() => { see(first, false); see(second, true); });
    await settle();
    expect(dialog()).not.toBeNull();
  });

  test('does not show on a fine pointer', async () => {
    phone({ coarse: false });
    open(signedIn());
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('does not show under reduced motion', async () => {
    phone();
    root.setAttribute('data-kb-motion', 'reduce');
    open(signedIn());
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('does not show on a device that cannot report tilt', async () => {
    phone();
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    open(signedIn());
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('does not show once the device has answered, or tilt is already on and allowed', async () => {
    phone();
    localStorage.setItem('kb-tilt-device', 'denied');
    open(signedIn());
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('does not show when tilt is already on and the device has allowed it', async () => {
    phone();
    localStorage.setItem('kb-tilt-device', 'granted');
    const fake = signedIn();
    await fake.setPreferences({ tilt: 'on' });
    open(fake);
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('points at a shiny post that is in view, not the first one registered', async () => {
    phone();
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    open(signedIn());
    await settle();
    const first = shiny(), second = shiny();
    see(second, true);
    await screen.findByRole('dialog', { name: 'Title of shine' });
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts;
    expect(scrolled, 'the spotlight points at the canvas that is in view').toContain(second);
    expect(scrolled).not.toContain(first);
  });

  test('a failed save puts the choice back as Settings does, so the device and the account agree', async () => {
    phone();
    const fake = signedIn();
    vi.spyOn(fake, 'setPreferences').mockResolvedValue({ ok: false, error: 'Nope.' });
    open(fake);
    await settle();
    shiny();
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    fireEvent.click(within(tip).getByRole('button', { name: 'Action of shine' }));
    expect(ask).toHaveBeenCalledTimes(1);
    await settle();
    expect((await fake.preferences()).tilt).toBe('off');
    expect(tiltState(), 'the page is not left on while the account says off').toBe('off');
  });

  test('a grant or a choice made elsewhere withdraws the tip', async () => {
    phone();
    open(signedIn());
    await settle();
    shiny();
    await screen.findByRole('dialog', { name: 'Title of shine' });
    localStorage.setItem('kb-tilt-device', 'granted');
    act(() => setTiltPreference('on'));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  test('does not show once seen', async () => {
    phone();
    const fake = signedIn();
    await fake.seeTip('shine');
    open(fake);
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  /* A page loaded with boot reads no preferences of its own: the account's choice the tip turns on comes from boot, and so does the tip. */
  test('on a page loaded with boot, shows from boot\'s preferences and reads none of its own', async () => {
    phone();
    const fake = signedIn();
    const boot = await fake.boot();
    const read = vi.spyOn(fake, 'preferences');
    renderIn(fake, <TipsProvider><p>page</p></TipsProvider>, { boot });
    await settle();
    shiny();
    await screen.findByRole('dialog', { name: 'Title of shine' });
    expect(read).not.toHaveBeenCalled();
  });

  /* A setting changed in Settings after the page loaded is the account's, whatever boot read: the tip's save must not apply boot's look over it. */
  test('the tip\'s action keeps a text size and contrast chosen in Settings after the page loaded', async () => {
    phone();
    const fake = signedIn();
    const boot = await fake.boot();
    function Settingsish() {
      const { session } = usePlayer();
      const { change } = usePreferenceSaves(session.account);
      return <><button onClick={() => change({ textSize: 200 })}>bigger</button><button onClick={() => change({ contrast: 'high' })}>higher</button></>;
    }
    renderIn(fake, <><Settingsish /><TipsProvider><p>page</p></TipsProvider></>, { boot });
    await settle();
    fireEvent.click(screen.getByText('bigger'));
    fireEvent.click(screen.getByText('higher'));
    await settle();
    expect(root.getAttribute('data-kb-text-size')).toBe('200');
    shiny();
    const tip = await screen.findByRole('dialog', { name: 'Title of shine' });
    fireEvent.click(within(tip).getByRole('button', { name: 'Action of shine' }));
    await waitFor(async () => expect((await fake.preferences()).tilt).toBe('on'));
    expect(root.getAttribute('data-kb-text-size'), 'the tip\'s save carried boot\'s text size over the one chosen after').toBe('200');
    expect(root.getAttribute('data-kb-contrast')).toBe('high');
    expect(pagePreferences.get(boot.account as string)?.textSize).toBe(200);
  });

  test('does not show to a visitor', async () => {
    phone();
    open(buildWorld());
    await settle();
    shiny();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('passes the accessibility check', async () => {
    phone();
    open(signedIn());
    await settle();
    shiny();
    await screen.findByRole('dialog', { name: 'Title of shine' });
    const found = await axeViolations(document.querySelector('.kb-tips')!);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
