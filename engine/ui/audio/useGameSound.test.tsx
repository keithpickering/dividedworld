/** The Lens toggle's hook (Laugh Track plan, Task 4): the account's game-sound choice, saved as Settings saves it. */
import { act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { useGameSound } from './useGameSound.ts';

describe('useGameSound', () => {
  test('reads the account\'s choice and saves a change through the settings saver', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    let latest: ReturnType<typeof useGameSound> | null = null;
    function Probe() { latest = useGameSound(); return <p>{latest.on ? 'sound on' : 'sound off'}</p>; }
    const { findByText } = renderIn(fake, <Probe />);
    await findByText('sound off');
    /* A change before the account's choices are read is ignored, so ask until the screen shows it. */
    await waitFor(() => { act(() => latest!.set(true)); expect(document.body.textContent).toBe('sound on'); });
    await findByText('sound on');
  });

  test('set(false) saves off after on', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    let latest: ReturnType<typeof useGameSound> | null = null;
    function Probe() { latest = useGameSound(); return <p>{latest.on ? 'sound on' : 'sound off'}</p>; }
    const { findByText } = renderIn(fake, <Probe />);
    await findByText('sound off');
    await waitFor(() => { act(() => latest!.set(true)); expect(document.body.textContent).toBe('sound on'); });
    await findByText('sound on');
    act(() => latest!.set(false));
    await findByText('sound off');
  });

  test('set keeps its identity across renders', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    const seen = new Set<unknown>();
    let bump: (() => void) | null = null;
    function Probe() { const [n, setN] = useState(0); bump = () => setN((x) => x + 1); seen.add(useGameSound().set); return <p>{`tick ${n}`}</p>; }
    const { findByText } = renderIn(fake, <Probe />);
    await findByText('tick 0');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    /* The account is known by now (the set follows the account); a re-render after it keeps the same one. */
    const before = [...seen].pop();
    seen.clear();
    act(() => bump!());
    await findByText('tick 1');
    expect([...seen]).toEqual([before]);
  });
});
