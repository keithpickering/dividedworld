import { useEffect } from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { EffectProps, CardUi } from '../cards/types.ts';
import { buildWorld, renderIn, renderInWorld } from '../test-world.tsx';
import { FrontDoor } from './FrontDoor.tsx';

/* A card of the test's own with an effect: it wraps the words, says one control, and reports what save and release answer. */
let seen: EffectProps | null = null;
const test_card: CardUi = {
  key: 'whoops',
  Effect: (props) => {
    seen = props;
    const { show } = props;
    useEffect(() => { show({ progress: 0, state: 'inked', yours: true, controls: [{ kind: 'hold', label: 'Hold to scrub', start: () => {}, stop: () => {} }], notes: {} }); }, [show]);
    return <div data-testid="effect">{props.children}</div>;
  },
  describe: () => 'A test card.',
  art: { color: 'currentColor', ink: 'currentColor' },
};
const draw = () => renderInWorld(<FrontDoor />, { cards: [test_card] });

describe('the front door', () => {
  test('the title is the h1, the label is visible, and the whole is a region named by the label', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.getAllByText('Sample thread, made up').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Sample thread, made up' })).toBeInTheDocument();
  });

  test('each post shows its author as text, not a link', () => {
    draw();
    expect(screen.getAllByText('Ann').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bo').length).toBeGreaterThan(0);
    const bits = screen.getAllByRole('group', { name: /^About / });
    expect(bits).toHaveLength(2);
    for (const bit of bits) expect(within(bit).queryByRole('link')).toBeNull();
    expect(screen.getByText('Test Talent')).toBeInTheDocument();
  });

  test('the reactions are chips with readable names, never buttons', () => {
    draw();
    expect(screen.queryByRole('button', { name: /react/i })).toBeNull();
    const chips = screen.getAllByRole('listitem').filter((li) => li.classList.contains('kb-chip'));
    expect(chips).toHaveLength(3);
    expect(screen.getByText('Tomato, 3')).toBeInTheDocument();
    expect(screen.getByText('Fire, 2')).toBeInTheDocument();
  });

  test('a post with a play of a card draws that card\'s effect around its words, once, and not on the other post', () => {
    draw();
    const effect = screen.getByTestId('effect');
    expect(effect).toHaveTextContent('It plays up to 3 characters.');
    expect(screen.getAllByTestId('effect')).toHaveLength(1);
    expect(seen!.plays).toHaveLength(1);
    expect(seen!.plays[0]).toMatchObject({ card: 'whoops', layer: 1, config: { seed: 7 }, message: '' });
    expect(seen!.reader).toEqual({ author: false, caster: false });
    expect(seen!.place).toBe('thread');
    expect(seen!.still).toBe(false);
    expect(seen!.nameOf(seen!.plays[0]!.caster)).toBe('Ann');
  });

  test('the card\'s controls from show appear under the post', () => {
    draw();
    expect(screen.getByRole('button', { name: 'Hold to scrub' })).toBeInTheDocument();
  });

  test('save and release refuse without asking anyone', async () => {
    draw();
    const saved = await seen!.save(seen!.plays[0]!.id, {});
    const released = await seen!.release(seen!.plays[0]!.id);
    expect(saved).toMatchObject({ ok: false, error: 'this is a sample post' });
    expect(released).toMatchObject({ ok: false, error: 'this is a sample post' });
  });

  test('a card with no effect draws the words alone', () => {
    renderInWorld(<FrontDoor />);
    expect(screen.queryByTestId('effect')).toBeNull();
    expect(screen.getByText('It plays up to 3 characters.')).toBeInTheDocument();
  });

  test('a setting marker in a post is filled from the settings', () => {
    draw();
    expect(screen.queryByText(/\{\{setting/)).toBeNull();
    expect(screen.getByText(/plays up to 3 characters/)).toBeInTheDocument();
  });

  test('the persona\'s note is a glass post with a hidden heading, and shows its filled text', () => {
    draw();
    expect(screen.getByRole('heading', { level: 2, name: /^A note from / })).toBeInTheDocument();
    expect(screen.getByText('A note. It is by invite.')).toBeInTheDocument();
  });

  test('the screen calls no API method of its own', async () => {
    const called = (element: React.ReactElement) => {
      const fake = buildWorld();
      const names = new Set<string>();
      for (const [key, value] of Object.entries(fake)) {
        if (typeof value === 'function') (fake as unknown as Record<string, unknown>)[key] = (...a: unknown[]) => { names.add(key); return (value as (...x: unknown[]) => unknown)(...a); };
      }
      renderIn(fake, element, { cards: [test_card] });
      return names;
    };
    const baseline = called(<p>nothing</p>);
    const withDoor = called(<FrontDoor />);
    await Promise.resolve();
    expect([...withDoor].filter((n) => !baseline.has(n))).toEqual([]);
    vi.restoreAllMocks();
  });
});
