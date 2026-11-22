/**
 * An admin ends a lockout from the Lens (the so-very-happy design, section 2.4): the sprung back of a lockout back, while its lockout is live, offers "End this card"; every other face-down
 * back stays unendable. The End sends the spring's id, since the spring is what the lockout is.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lockOut, lockoutCards, lockoutInstance, lockoutWorld } from '../composer/lockout-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import { renderIn } from '../test-world.tsx';
import { endable } from './Lens.tsx';
import type { CardPlay } from './types.ts';

const now = Date.parse('2026-11-20T00:00:00.000Z');
const back = { id: 'b1', card: 'sprung', faceDown: true, revealed: { card: 'lkback', spring: 's1', at: '2026-11-19T12:00:00.000Z' } } as unknown as CardPlay;
const live = { until: '2026-11-21T12:00:00.000Z' };

describe('endable for a lockout back', () => {
  test('a sprung back whose lockout is live can be ended', () => {
    expect(endable(back, now, false, live)).toBe(true);
  });
  test('not once the lockout is past, nor once it was ended', () => {
    expect(endable(back, now, false, { until: '2026-11-19T23:59:00.000Z' })).toBe(false);
    expect(endable({ ...back, reversed: true }, now, false, live)).toBe(false);
  });
  test('not a caught back, nor a back that is not a lockout, nor one that has not sprung', () => {
    expect(endable({ ...back, caught: 'c1' }, now, false, live)).toBe(false);
    expect(endable(back, now, false, null)).toBe(false);
    expect(endable(back, now, false)).toBe(false);
    const { revealed: _r, ...unsprung } = back;
    expect(endable(unsprung as CardPlay, now, false, live)).toBe(false);
    expect(endable({ ...back, takenBack: { at: '2026-11-19T13:00:00.000Z' } }, now, false, live)).toBe(false);
  });
});

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function lens(admin: boolean, ended = false, later = 0) {
  const w = lockoutWorld(admin);
  const sprung = await lockOut(w);
  if (ended) {
    const answer = await w.fake.reverseCard(sprung.spring.id);
    if (!answer.ok) throw new Error(answer.error);
    /* No help for the page: it carries the spring's card_end as the real thread page does (the fake's `postPlaysOf` and its riders). */
  }
  /* The page opened this long after the spring (a lockout's end is the card's own span from it). */
  if (later > 0) w.fake.clock.advance(later);
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: lockoutInstance, cards: lockoutCards });
  await screen.findByRole('article', { name: /^Post 1 /u });
  const mark = await within(document.getElementById('post-1')!).findByRole('button', { name: /Lk Back/u });
  await userEvent.click(mark);
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: /^1 play · / }));
  return { w, sprung, dialog };
}

describe('the Lens on a lockout back', () => {
  test('an admin can end it, and the End sends the spring\'s id', async () => {
    const { w, sprung, dialog } = await lens(true);
    const reverse = vi.spyOn(w.fake, 'reverseCard');
    /* A sprung lockout still live is up now (the owner, #984: Set, then Up now, then Ended): a full row, End in reach, no Ended group. */
    expect(dialog.querySelector('button.kb-lens-compact')).toBeNull();
    expect(dialog).not.toHaveTextContent(/Ended · /u);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'End this card' }));
    await userEvent.click(screen.getByRole('button', { name: 'End it' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledWith(sprung.spring.id));
  });

  test('once its lockout is past, the sprung back is an ended row', async () => {
    const { dialog } = await lens(false, false, 400 * 86_400_000);
    expect(dialog).toHaveTextContent(/Ended · 1/u);
    expect(dialog.querySelector('button.kb-lens-compact')).not.toBeNull();
  });

  test('a reader who is no admin is not offered it', async () => {
    const { dialog } = await lens(false);
    expect(within(dialog).queryByRole('button', { name: 'End this card' })).toBeNull();
  });

  test('after a reload, a lockout an admin already ended is not offered again', async () => {
    const { dialog } = await lens(true, true);
    expect(within(dialog).queryByRole('button', { name: 'End this card' })).toBeNull();
  });

  test('a reader who is no admin does not read the spring at all', async () => {
    const w = lockoutWorld(false);
    const sprung = await lockOut(w);
    const asked = vi.spyOn(w.fake, 'actsById');
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: lockoutInstance, cards: lockoutCards });
    await userEvent.click(await within(await screen.findByRole('article', { name: /^Post 1 /u })).findByRole('button', { name: /Lk Back/u }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^1 play · / }));
    expect(asked.mock.calls.filter(([ids]) => ids.includes(sprung.spring.id)).length).toBe(0);
  });
});
