import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { InvitesScreen } from './Invites.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function world(admin = false) {
  const fake = buildWorld();
  const me = fake.seed.account('me', { admin });
  fake.signInAs(me);
  return { fake, me };
}
const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <InvitesScreen />, { path: '/invites' });

describe('Invites', () => {
  test('says the cap and the expiry before the cap is hit', async () => {
    open(world());
    expect(await screen.findByText(/You hold 0 of 2 open invites/u)).toBeInTheDocument();
    expect(screen.getByText(/expires 7 days after/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make an invite' })).toBeEnabled();
  });

  test('makes an invite: a link to copy, shown once, and the count moves', async () => {
    const w = world();
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    const link = await screen.findByLabelText('Invite link');
    expect((link as HTMLInputElement).value).toMatch(/\/register\?invite=\S+$/u);
    expect(screen.getByText(/will not be shown again/u)).toBeInTheDocument();
    expect(await screen.findByText(/You hold 1 of 2 open invites/u)).toBeInTheDocument();
  });

  test('copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open(world());
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy the link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/register\?invite=/u));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
  });

  test('at the cap it is said, the way out is named, and the button waits', async () => {
    const w = world();
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    expect(await screen.findByText(/You hold 2 of 2 open invites, the most there are/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make an invite' })).toBeDisabled();
    expect(screen.getByText(/used or expired frees one/iu)).toBeInTheDocument();
  });

  test('lists each invite with its expiry and whether it was used, and reissues an unused one', async () => {
    const w = world();
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    const row = await screen.findByRole('row', { name: /Open/u });
    expect(within(row).getByText(/Expires/u)).toBeInTheDocument();
    const first = (screen.getByLabelText('Invite link') as HTMLInputElement).value;
    await userEvent.click(within(row).getByRole('button', { name: /Reissue/u }));
    await screen.findByText(/new code/iu);
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).not.toBe(first);
  });

  test('moves focus to the new link after making and after reissuing', async () => {
    open(world());
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    expect(await screen.findByLabelText('Invite link')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    await userEvent.click(await screen.findByRole('button', { name: /Reissue/u }));
    await screen.findByText(/new code/iu);
    expect(screen.getByLabelText('Invite link')).toHaveFocus();
  });

  test('where copying is not available it says so, and the link is selected', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    open(world());
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy the link' }));
    expect(await screen.findByText('Copy is not available here: the link is selected; copy it by hand.')).toBeInTheDocument();
    const link = screen.getByLabelText('Invite link') as HTMLInputElement;
    expect(link).toHaveFocus();
    expect([link.selectionStart, link.selectionEnd]).toEqual([0, link.value.length]);
  });

  test('the notes "Copied." and the like are said in a region that is on the page before anything is', async () => {
    open(world());
    await screen.findByRole('button', { name: 'Make an invite' });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  test('a make that gets no answer ends the wait and says so', async () => {
    const w = world();
    w.fake.createInvite = () => Promise.reject(new Error('offline'));
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No answer came back/u);
    expect(screen.getByRole('button', { name: 'Make an invite' })).toBeEnabled();
  });

  test('an expired invite says Expired once in its row', async () => {
    const w = world();
    await w.fake.createInvite();
    w.fake.clock.advance(8 * 86_400_000);
    open(w);
    const row = await screen.findByRole('row', { name: /Expired/u });
    expect((row.textContent ?? '').match(/Expired/gu)).toHaveLength(1);
    expect(within(row).getByRole('button', { name: /Reissue/u })).toBeInTheDocument();
  });

  test('an admin holds any number, and the page says so instead of a cap', async () => {
    open(world(true));
    expect(await screen.findByText(/any number of invites/u)).toBeInTheDocument();
    expect(screen.queryByText(/of 2 open/u)).toBeNull();
  });
});
