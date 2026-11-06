/**
 * The shine tip (docs/plans/2026-11-06-shine-plan.md, Task 6; design section 4): the first shiny post in view, on a phone that can
 * tilt and has not been asked, shows a tip with a button that turns tilt on. The button runs `allowTilt` inside its own click (a
 * browser's permission prompt needs the tap), sets the account's preference to on, and the tip is seen.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Fake } from '../data/fake.ts';
import { light } from '../shine/light.ts';
import { probe, register, unregister } from '../shine/loop.ts';
import { resetTilt, tiltState } from '../shine/tilt.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { TipsProvider } from './Tips.tsx';

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

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); resetTilt(); root.setAttribute('data-kb-motion', 'full'); });
afterEach(() => {
  for (const h of hosts.splice(0)) unregister(h);
  document.querySelectorAll('canvas').forEach((c) => c.remove());
  probe.reset(); light.reset(); resetTilt();
  root.removeAttribute('data-kb-motion');
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
