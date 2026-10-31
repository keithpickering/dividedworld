/**
 * The first-time callout (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 5): the page's first mark of an unmet
 * kind whose card gives a `hint` carries one small bubble, out of the page's flow, with "Got it". Met is the account's own
 * (`Preferences.cardsMet`), written by `meetCard` and cleared by Settings' "Show card tips again".
 */
import { readFileSync } from 'node:fs';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { createCalloutStore } from './Callout.tsx';
import { LensHost } from './Lens.tsx';
import type { CardUi, EffectProps } from './types.ts';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

const KEYS = ['k1', 'k2', 'k3'] as const;
const instance = { ...testInstance, cards: KEYS.map((key, i) => ({ ...testInstance.cards[0]!, key, name: `Card ${i + 1}` })) };
const art = { color: 'red', ink: 'white', mark: '/mark.svg' };
const cardUi = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, describe: () => 'Does a thing.', summary: 'Does a thing.', art, ...extra });

/** An effect that reports its first use when a button in its words is pressed. */
const Uses = (props: EffectProps) => {
  const { met } = props;
  return <>{props.children}<button type="button" data-testid="use" onClick={() => met()}>use</button></>;
};

function world(signedIn = true) {
  const fake = buildWorld(undefined, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const third = fake.seed.post(thread, spritey, 'post 3');
  const fourth = fake.seed.post(thread, spritey, 'post 4');
  if (signedIn) fake.signInAs(me);
  const play = (kind: string, on: Id) => { fake.clock.advance(60_000); return fake.seed.card(spritey, on, kind, { message: '' }); };
  return { fake, me, thread, second, third, fourth, play };
}
const open = (w: ReturnType<typeof world>, ui: readonly CardUi[]) => renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: ui });
const tips = () => screen.queryAllByRole('note');
const hinted = [cardUi('k1', { hint: 'Do the first thing.' }), cardUi('k2', { hint: 'Do the second thing.' }), cardUi('k3')];

describe('the first-time callout', () => {
  test('shows once on a page, on the first mark of the kind met first in reading order, and the mark keeps its name', async () => {
    const w = world();
    w.play('k2', w.second); w.play('k1', w.third); w.play('k1', w.fourth);
    open(w, hinted);
    await screen.findByRole('article', { name: /^Post 4 /u });
    await waitFor(() => expect(tips()).toHaveLength(1));
    const second = screen.getByRole('article', { name: /^Post 2 /u });
    const tip = within(second).getByRole('note');
    expect(tip).toHaveTextContent('Card 2');
    expect(tip).toHaveTextContent('Do the second thing.');
    const mark = within(second).getByRole('button', { name: /^Card 2, 1 play/u });
    const hintEl = within(tip).getByText('Do the second thing.');
    expect(mark).toHaveAttribute('aria-describedby', hintEl.id);
    expect(mark).toHaveAccessibleName(expect.not.stringContaining('Do the second thing.'));
    expect(within(tip).getByRole('button', { name: 'Got it' })).toBeInTheDocument();
    expect(tip.closest('[role="dialog"]')).toBeNull();
    expect(tip).not.toHaveAttribute('aria-live');
  });

  test('is not shown for a met kind, a card without a hint, or a visitor', async () => {
    const w = world();
    w.play('k1', w.second); w.play('k3', w.third);
    await w.fake.meetCard('k1');
    open(w, hinted);
    await screen.findByRole('article', { name: /^Post 3 /u });
    await screen.findAllByRole('button', { name: /^Card 3, 1 play/u });
    expect(tips()).toHaveLength(0);

    const v = world(false);
    v.play('k1', v.second);
    open(v, hinted);
    await screen.findAllByRole('button', { name: /^Card 1, 1 play/u });
    expect(tips()).toHaveLength(0);
  });

  test('"Got it" calls meetCard once and hides it at once; the next kind then shows', async () => {
    const w = world();
    w.play('k1', w.second); w.play('k2', w.third);
    const meet = vi.spyOn(w.fake, 'meetCard');
    open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(meet).toHaveBeenCalledTimes(1);
    expect(meet).toHaveBeenCalledWith('k1');
    expect(screen.queryByText('Do the first thing.')).toBeNull();
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Do the second thing.'));
    expect(meet).toHaveBeenCalledTimes(1);
  });

  test('the effect\'s met() calls meetCard once and hides it, however often it is called', async () => {
    const w = world();
    w.play('k1', w.second);
    const meet = vi.spyOn(w.fake, 'meetCard');
    open(w, [cardUi('k1', { hint: 'Do the first thing.', Effect: Uses }), ...hinted.slice(1)]);
    await waitFor(() => expect(tips()).toHaveLength(1));
    await userEvent.click(screen.getByTestId('use'));
    await userEvent.click(screen.getByTestId('use'));
    expect(meet).toHaveBeenCalledTimes(1);
    expect(tips()).toHaveLength(0);
  });

  test('a write that fails leaves it hidden, and the account unmet, so the next read shows it again', async () => {
    const w = world();
    w.play('k1', w.second);
    vi.spyOn(w.fake, 'meetCard').mockResolvedValue({ ok: false, error: 'no answer' });
    const first = open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(tips()).toHaveLength(0);
    await act(async () => { await Promise.resolve(); });
    expect(tips()).toHaveLength(0);
    first.unmount();
    open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
  });

  test('Settings\' "Show card tips again" clears the set, and the callout returns on the next read', async () => {
    const w = world();
    w.play('k1', w.second);
    const first = open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ cardsMet: ['k1'] }));
    first.unmount();
    const second = open(w, hinted);
    await screen.findAllByRole('button', { name: /^Card 1, 1 play/u });
    expect(tips()).toHaveLength(0);
    second.unmount();
    await w.fake.forgetCardsMet();
    open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
  });

  test('while a Lens is open on its post the callout is hidden, and it comes back when the Lens closes, unless met', async () => {
    const w = world();
    w.play('k1', w.second); w.play('k2', w.second);
    open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
    const marks = [screen.getByRole('button', { name: /^Card 1, 1 play/u }), screen.getByRole('button', { name: /^Card 2, 1 play/u })];
    const described = () => marks.filter((m) => m.hasAttribute('aria-describedby'));
    expect(described()).toHaveLength(1);
    /* The Lens opens from the kind that holds no callout: the other kind's callout is hidden all the same, since it is the post's Lens. */
    await userEvent.click(marks.find((m) => !described().includes(m))!);
    expect(screen.getByRole('dialog', { name: 'Cards on this post' })).toBeInTheDocument();
    expect(tips()).toHaveLength(0);
    expect(described()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(tips()).toHaveLength(1));
    expect(described()).toHaveLength(1);
    /* Met, a kind does not come back with the Lens: the next kind's callout stands in its place. */
    const was = described()[0]!;
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(described()).toHaveLength(1));
    expect(described()[0]).not.toBe(was);
    await userEvent.click(was);
    expect(tips()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(tips()).toHaveLength(1));
    expect(described()[0]).not.toBe(was);
  });

  test('"Got it" gives focus back to the mark', async () => {
    const w = world();
    w.play('k1', w.second);
    open(w, hinted);
    await waitFor(() => expect(tips()).toHaveLength(1));
    const mark = screen.getByRole('button', { name: /^Card 1, 1 play/u });
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(mark).toHaveFocus();
  });

  test('met() for a card with no hint does not call meetCard', async () => {
    const w = world();
    w.play('k3', w.second);
    const meet = vi.spyOn(w.fake, 'meetCard');
    open(w, [...hinted.slice(0, 2), cardUi('k3', { Effect: Uses })]);
    await userEvent.click(await screen.findByTestId('use'));
    expect(meet).not.toHaveBeenCalled();
  });

  test('"Got it" is at least 24px square in the sheet', () => {
    const css = readFileSync('engine/ui/cards/marks.css', 'utf8');
    expect(css).toMatch(/\.kb-callout-got \{[^}]*min-width: 24px;[^}]*min-height: 24px;/u);
  });

  test('while a takeover holds the post, the held mark carries the callout', async () => {
    const w = world();
    w.play('k1', w.second);
    const Holds = (props: EffectProps) => {
      const [host, setHost] = useState<HTMLElement | null>(null);
      return <>{props.children}<div data-testid="hold" ref={setHost}><LensHost host={host}>{props.marks}</LensHost></div></>;
    };
    open(w, [cardUi('k1', { hint: 'Do the first thing.', takeover: true, Effect: Holds }), ...hinted.slice(1)]);
    await waitFor(() => expect(tips()).toHaveLength(1));
    expect(screen.getByTestId('hold')).toContainElement(tips()[0]!);
  });
});

describe('the callout store', () => {
  const mark = () => { const el = document.createElement('button'); document.body.append(el); return el; };
  test('an earlier mark that mounts later takes the callout, and only the two marks concerned are woken', () => {
    const store = createCalloutStore(async () => {});
    store.setMet([]);
    const [a, b, c] = [mark(), mark(), mark()];
    const woken: string[] = [];
    for (const id of ['a', 'b', 'c']) store.subscribe(id, () => woken.push(id));
    store.register('b', 'k1', b);
    store.register('c', 'k1', c);
    expect(store.chosen('b')).toBe(true);
    woken.length = 0;
    store.register('a', 'k1', a);
    expect(store.chosen('a')).toBe(true);
    expect(store.chosen('b')).toBe(false);
    expect(woken.sort()).toEqual(['a', 'b']);
  });
});
