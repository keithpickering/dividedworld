import { lazy, useEffect } from 'react';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
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
  art: { color: 'currentColor', ink: 'currentColor', canvas: '', mark: '', credit: 'Test' },
};
const draw = () => renderInWorld(<FrontDoor />, { cards: [test_card] });

describe('the front door', () => {
  test('each post is drawn like a thread\'s: one .kb-act-grid under the article holds the postbit, meta and main', () => {
    draw();
    const articles = [...document.querySelectorAll('article.kb-act')];
    expect(articles).toHaveLength(2);
    for (const a of articles) {
      const grids = [...a.children].filter((c) => c.classList.contains('kb-act-grid'));
      expect(grids).toHaveLength(1);
      const kids = [...grids[0]!.children];
      expect(kids.some((c) => c.classList.contains('kb-act-meta'))).toBe(true);
      expect(kids.some((c) => c.classList.contains('kb-act-main'))).toBe(true);
      expect(kids.some((c) => c.classList.contains('kb-postbit'))).toBe(true);
      expect([...a.children].filter((c) => c.classList.contains('kb-act-meta') || c.classList.contains('kb-act-main'))).toHaveLength(0);
    }
  });

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

  test('the reactions are the thread\'s meta tiles, each post with React, and nothing in the post\'s foot', () => {
    draw();
    expect(screen.queryByRole('listitem', { name: /./ })).toBeNull();
    expect(document.querySelectorAll('.kb-chip')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'React' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Tomato, 3. React' })).toHaveClass('kb-meta-tile');
    expect(screen.getByRole('button', { name: 'Fire, 2. React' })).toBeInTheDocument();
    expect(document.querySelector('.kb-act-foot')).toBeNull();
  });

  test('a reaction the visitor leaves lands on their screen: its count grows and it is theirs', async () => {
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Fire, 2. React' }));
    expect(await screen.findByRole('button', { name: 'Fire, 3, including yours' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'React' })[1]!);
    await userEvent.click(within(screen.getByRole('dialog', { name: /^React to Bo/ })).getByRole('button', { name: /^Tea, / }));
    expect(await screen.findByRole('button', { name: 'Tea, 2, including yours' })).toBeInTheDocument();
  });

  test('a post with a play has its mark on the date row, and the mark opens the Lens with the card\'s controls, no Spin and no Go to post', async () => {
    draw();
    const mark = within(document.querySelector('[data-kb-seq="2"] .kb-act-meta') as HTMLElement).getByRole('button', { name: /Whoops/ });
    expect(document.querySelectorAll('.kb-mark')).toHaveLength(1);
    await userEvent.click(mark);
    const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
    expect(within(lens).getByRole('button', { name: 'Hold to scrub' })).toBeInTheDocument();
    await userEvent.click(within(lens).getByRole('button', { name: '1 play · Ann' }));
    expect(within(lens).queryByRole('button', { name: 'Spin thread' })).toBeNull();
    expect(within(lens).queryByRole('link', { name: 'Go to post' })).toBeNull();
    expect(within(lens).queryByRole('button', { name: 'As it landed' })).toBeNull();
    expect(within(lens).getByRole('button', { name: 'Fire, 1. React' })).toBeInTheDocument();
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

  test('the card\'s controls are never drawn under the post', () => {
    draw();
    expect(screen.queryByRole('button', { name: 'Hold to scrub' })).toBeNull();
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

  test('the screen calls no API method of its own, now or later', async () => {
    /* Every method the backend has is wrapped and named when called; what the frame's providers call around a bare
       element is the baseline, and the front door may add none, even calls made after the first render settles. */
    const called = async (element: React.ReactElement, use: () => Promise<void> = async () => {}) => {
      const fake = buildWorld();
      const names = new Set<string>();
      for (const [key, value] of Object.entries(fake)) {
        if (typeof value === 'function' && key !== 'now') (fake as unknown as Record<string, unknown>)[key] = (...a: unknown[]) => { names.add(key); return (value as (...x: unknown[]) => unknown)(...a); };
      }
      const { unmount } = renderIn(fake, element, { cards: [test_card] });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      await use();
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      unmount();
      return names;
    };
    const baseline = await called(<p>nothing</p>);
    const withDoor = await called(<FrontDoor />, async () => {
      /* A reaction, a pick and an open Lens with a reaction to the play in it: none of them asks anyone. */
      await userEvent.click(screen.getByRole('button', { name: 'Fire, 2. React' }));
      await userEvent.click(screen.getAllByRole('button', { name: 'React' })[1]!);
      await userEvent.click(within(screen.getByRole('dialog', { name: /^React to Bo/ })).getByRole('button', { name: /^Tea, / }));
      await userEvent.click(screen.getByRole('button', { name: /Whoops/ }));
      const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
      await userEvent.click(within(lens).getByRole('button', { name: '1 play · Ann' }));
      await userEvent.click(within(lens).getByRole('button', { name: 'Fire, 1. React' }));
      await within(lens).findByRole('button', { name: 'Fire, 2, including yours' });
    });
    expect([...withDoor].filter((n) => !baseline.has(n))).toEqual([]);
  });

  test('a cast member the front door reveals carries the postbit\'s own revealed line, and one it does not carries none', () => {
    draw();
    expect(within(screen.getByRole('group', { name: 'About Bo' })).getByText(/^Revealed: Heel \(/u)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'About Ann' })).queryByText(/^Revealed:/u)).toBeNull();
  });

  test("each cast member's postbit shows the rank the front door gives it", () => {
    draw();
    expect(within(screen.getByRole('group', { name: 'About Ann' })).getByText('Jobber')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'About Bo' })).getByText('Main Eventer')).toBeInTheDocument();
  });
});

describe('the front door with an effect that loads on first use', () => {
  test('the post shows its words before the effect lands, and inside it after', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => { land = resolve; });
    const Effect = lazy(async () => { await gate; return { default: (props: EffectProps) => <div data-testid="effect">{props.children}</div> }; });
    renderInWorld(<FrontDoor />, { cards: [{ ...test_card, Effect }] });
    expect(screen.getByText('It plays up to 3 characters.')).toBeInTheDocument();
    expect(screen.queryByTestId('effect')).toBeNull();
    await act(async () => { land(); await gate; });
    expect(screen.getByTestId('effect')).toHaveTextContent('It plays up to 3 characters.');
  });
});
