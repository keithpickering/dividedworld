/*
 * The page's one holder of the account's preferences (pagePreferences.ts) and the screens that save through it. A .test.tsx: the screens
 * are React. Each scenario has two screens at once or in sequence, as the app has Settings and the tips' provider.
 */
import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Preferences } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { resetTilt, tiltState } from '../shine/tilt.ts';
import { TipsProvider } from '../tips/Tips.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { pagePreferences } from './pagePreferences.ts';
import { usePreferenceSaves } from './preferences.ts';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });
const root = document.documentElement;

/* A screen of Settings' kind: it reads the account's choices itself and saves them with the hook. */
function Screen({ name, supplied }: { readonly name: string; readonly supplied?: Preferences | null }) {
  const { session } = usePlayer();
  const { prefs, change } = usePreferenceSaves(session.account, supplied);
  return (
    <div>
      <p data-testid={`${name}-theme`}>{prefs?.theme ?? 'unread'}</p>
      <p data-testid={`${name}-tilt`}>{prefs?.tilt ?? 'unread'}</p>
      <button onClick={() => change({ tilt: 'on' })}>{name} tilt on</button>
      <button onClick={() => change({ theme: 'dark' })}>{name} dark</button>
      <button onClick={() => change({ theme: 'light' })}>{name} light</button>
      <button onClick={() => change({ textSize: 200 })}>{name} bigger</button>
    </div>
  );
}
const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => { localStorage.clear(); resetTilt(); });
afterEach(() => {
  resetTilt(); pagePreferences.clear();
  for (const a of ['data-kb-mode', 'data-kb-text-size', 'data-kb-contrast']) root.removeAttribute(a);
  vi.restoreAllMocks();
});

describe('the holder', () => {
  test('it keeps one account, drops it on another\'s write or a clear, and tells its listeners', () => {
    const seen: string[] = [];
    const stop = pagePreferences.subscribe((a, p) => seen.push(`${a}:${p.theme}`));
    const a = { theme: 'dark' } as Preferences, b = { theme: 'light' } as Preferences;
    pagePreferences.set('a', a);
    expect(pagePreferences.get('a')).toBe(a);
    expect(pagePreferences.get('b')).toBeUndefined();
    pagePreferences.set('b', b);
    expect(pagePreferences.get('a'), 'another account\'s write drops the last one\'s').toBeUndefined();
    expect(pagePreferences.get('b')).toBe(b);
    pagePreferences.clear();
    expect(pagePreferences.get('b')).toBeUndefined();
    stop();
    pagePreferences.set('a', a);
    expect(seen).toEqual(['a:dark', 'b:light']);
  });
});

describe('a choice made on one screen is the account\'s for the next', () => {
  test('going from a screen of choices back to a board does not undo the tilt choice with the page-load copy', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    const boot = await fake.boot();
    function Page() {
      const [board, setBoard] = useState(true);
      return <><Screen name="settings" /><button onClick={() => setBoard((b) => !b)}>go</button>{board && <TipsProvider><p>board</p></TipsProvider>}</>;
    }
    renderIn(fake, <Page />, { boot });
    await settle();
    fireEvent.click(screen.getByText('settings tilt on'));
    await settle();
    expect(tiltState()).toBe('on');
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByText('go'));
    await settle();
    expect(tiltState(), 'the board\'s provider came back with boot\'s tilt, which was taken before the choice').toBe('on');
  });

  test('two screens at once: the second shows the first\'s choice, and saves on top of it', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <><Screen name="a" /><Screen name="b" /></>);
    await settle();
    fireEvent.click(screen.getByText('a dark'));
    expect(text('b-theme')).toBe('dark');
    fireEvent.click(screen.getByText('b tilt on'));
    await settle();
    const saved = await fake.preferences();
    expect([saved.theme, saved.tilt]).toEqual(['dark', 'on']);
    expect(text('a-tilt')).toBe('on');
  });

  test('a refusal on one screen puts back its own choice only, and never over a newer choice made on another', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <><Screen name="a" /><Screen name="b" /></>);
    await settle();
    const real = fake.setPreferences.bind(fake);
    let refuse = true;
    vi.spyOn(fake, 'setPreferences').mockImplementation(async (patch) => (refuse ? { ok: false, error: 'Nope.' } : real(patch)));
    fireEvent.click(screen.getByText('a dark'));
    refuse = false;
    fireEvent.click(screen.getByText('b light'));
    await settle();
    expect(text('a-theme'), 'the refused dark did not come back over the later light').toBe('light');
    expect(text('b-theme')).toBe('light');
  });

  test('a refusal puts back only that key: a tilt choice made meanwhile on another screen stays', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <><Screen name="a" /><Screen name="b" /></>);
    await settle();
    const real = fake.setPreferences.bind(fake);
    vi.spyOn(fake, 'setPreferences').mockImplementation(async (patch) => ('theme' in patch ? { ok: false, error: 'Nope.' } : real(patch)));
    fireEvent.click(screen.getByText('a dark'));
    fireEvent.click(screen.getByText('b tilt on'));
    await settle();
    expect([text('a-theme'), text('a-tilt'), text('b-tilt')]).toEqual(['system', 'on', 'on']);
  });

  test('another account\'s choices never stand in: a screen for another account starts from its own preferences', async () => {
    const fake = buildWorld();
    const first = fake.seed.account('me');
    fake.signInAs(first);
    const boot = await fake.boot();
    pagePreferences.set('someone-else', { ...boot.preferences, tilt: 'on' });
    renderIn(fake, <Screen name="a" supplied={boot.preferences} />, { boot });
    await settle();
    expect(text('a-tilt')).toBe('off');
    expect(tiltState()).toBe('off');
    expect(pagePreferences.get('someone-else')).toBeUndefined();
  });
});
