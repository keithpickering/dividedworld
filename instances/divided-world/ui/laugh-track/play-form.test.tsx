/**
 * Laugh Track's play form in the real play dialog (the owner's answer to question 4 of #629): on one's own post
 * the note "A face-down Laugh Track waits for this phrase." is not shown while "Play it now" is selected, and is shown once "Set face down" is.
 * The engine tells the form the truth (`faceDown`: 'can' or 'will'); what the card does with it is the card's.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { hudKey } from '../../../../engine/ui/player.tsx';
import { buildWorld, renderIn } from '../../../../engine/ui/test-world.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import { instance } from '../../index.ts';
import { instanceUi } from '../index.ts';

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const NOTE = /A face-down Laugh Track waits for this phrase\./u;

describe('Laugh Track\'s face-down note, on one\'s own post', () => {
  test('is absent while Play it now is selected, and present once Set face down is', async () => {
    const user = userEvent.setup();
    const fake = buildWorld({ postMaxLength: 1000 }, instance);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
    const { thread } = fake.seed.thread('general', gloomba, 'A thread', 'post 1');
    fake.seed.post(thread, gloomba, 'post 2');
    fake.seed.post(thread, pipe, 'the quick brown fox jumps over the lazy dog');
    fake.seed.cards(me, { 'laugh-track': 1 });
    fake.seed.wallet(me, 462);
    fake.signInAs(me);
    localStorage.setItem(hudKey(me), pipe);
    renderIn(fake, <Frame><LoadedThread thread={thread} /></Frame>, { path: `/t/${thread}`, instance, cards: instanceUi.cards, settings: { postMaxLength: 1000 } });
    await screen.findByRole('article', { name: /^Post 3 /u });
    await user.click(await screen.findByRole('button', { name: /^Hand, \d+ postcards?/u }));
    await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getAllByRole('button', { name: /^Laugh Track,/u })[0]!);
    await user.click(await within(document.getElementById('post-3')!).findByRole('button', { name: 'Play Laugh Track on post 3' }));
    const dialog = await screen.findByRole('dialog');
    const group = within(dialog).getByRole('group', { name: 'How to play it' });
    expect(within(group).getByRole('radio', { name: 'Play it now' })).toBeChecked();
    expect(within(dialog).queryByText(NOTE)).toBeNull();
    await user.click(within(group).getByRole('radio', { name: 'Set face down' }));
    expect(within(dialog).getByText(NOTE)).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Play it now' }));
    expect(within(dialog).queryByText(NOTE)).toBeNull();
  });
});
