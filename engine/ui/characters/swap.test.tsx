/**
 * The roster's panel swaps when another character is chosen (Characters.tsx, motion.ts `swap`). Apart from Characters.test.tsx, whose clock is
 * the fake's: Motion's frames need the real one.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Characters } from './Characters.tsx';

afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); });

function seeded() {
  const fake = buildWorld({ charactersPerPlayer: 4 });
  const me = fake.seed.account('me');
  fake.seed.character(me, 'Pipewrench', 'face', { at: Date.parse('2026-10-01T12:00:00Z') });
  fake.seed.character(me, 'Mrs. Hooligan', 'heel', { at: Date.parse('2026-10-02T12:00:00Z') });
  fake.signInAs(me);
  return fake;
}
const roster = () => screen.getByRole('tablist', { name: /^Roster, /u });

describe('the roster\'s panel swap', () => {
  test('at full motion the old panel is held, inert and out of the reading order, while the new one is the tabpanel; then it goes', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    renderIn(seeded(), <Characters />, { path: '/characters', settings: { charactersPerPlayer: 4 } });
    await within(await screen.findByRole('tablist', { name: /^Roster, /u })).findByText('Pipewrench');
    const first = screen.getByRole('tabpanel');
    const other = within(roster()).getAllByRole('tab').find((t) => t.getAttribute('aria-selected') !== 'true')!;
    fireEvent.click(other);
    const now = screen.getByRole('tabpanel');
    /* Keyed by the character: another element for another character. */
    expect(now).not.toBe(first);
    expect(now.getAttribute('data-kb-character')).not.toBe(first.getAttribute('data-kb-character'));
    expect(first.isConnected).toBe(true);
    expect(first).toHaveAttribute('inert');
    expect(first).toHaveAttribute('aria-hidden', 'true');
    expect(first).toHaveAttribute('data-kb-exiting');
    /* The id the tabs control belongs to the panel that is arriving alone. */
    expect(first).not.toHaveAttribute('id');
    expect(document.querySelectorAll(`[id="${now.id}"]`)).toHaveLength(1);
    await waitFor(() => expect(first.isConnected).toBe(false), { timeout: 3000 });
  });
  test('under Off the panel is replaced at once', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    renderIn(seeded(), <Characters />, { path: '/characters', settings: { charactersPerPlayer: 4 } });
    await within(await screen.findByRole('tablist', { name: /^Roster, /u })).findByText('Pipewrench');
    const first = screen.getByRole('tabpanel');
    fireEvent.click(within(roster()).getAllByRole('tab').find((t) => t.getAttribute('aria-selected') !== 'true')!);
    expect(first.isConnected).toBe(false);
    expect(document.querySelector('[data-kb-exiting]')).toBeNull();
  });
});
