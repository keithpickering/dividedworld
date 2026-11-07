import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Invites } from './Invites.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function world(admin = false) {
  const fake = buildWorld();
  const me = fake.seed.account('me', { admin });
  fake.signInAs(me);
  return { fake, me };
}
/** An invite's row in the list, by what it says. */
const rowOf = async (words: RegExp) => {
  const list = await screen.findByRole('list', { name: 'Your invites' });
  const row = within(list).getAllByRole('listitem').find((li) => words.test(li.textContent ?? ''));
  if (!row) throw new Error(`no invite row says ${String(words)}`);
  return row;
};
const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <Invites />, { path: '/settings?section=account' });

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
    const row = await rowOf(/Open/u);
    expect(within(row).getByText(/expires/u)).toBeInTheDocument();
    const first = (screen.getByLabelText('Invite link') as HTMLInputElement).value;
    await userEvent.click(within(row).getByRole('button', { name: /Reissue/u }));
    await screen.findByText(/new code/iu);
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).not.toBe(first);
  });

  test('lists a row per invite, with its number, its state and when, and Reissue only on one that is unused, and Make an invite follows the list', async () => {
    const w = world();
    w.fake.seed.invite(w.me, { at: Date.UTC(2026, 9, 28, 12), used: true });
    w.fake.seed.invite(w.me, { at: Date.UTC(2026, 9, 29, 12) });
    open(w);
    const used = await rowOf(/Used/u);
    const unused = await rowOf(/Open/u);
    expect(used).toHaveTextContent('Invite 1');
    expect(used).toHaveTextContent('Used · made Oct 28');
    expect(within(used).queryByRole('button')).toBeNull();
    expect(unused).toHaveTextContent('Invite 2');
    expect(unused).toHaveTextContent('Open · expires Nov 5');
    expect(within(unused).getByRole('button', { name: 'Reissue invite 2' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Your invites' });
    const make = screen.getByRole('button', { name: 'Make an invite' });
    expect(list.compareDocumentPosition(make) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('numbers a player\'s invites by their own count, never by the global id, which other players\' invites leave gaps in', async () => {
    const w = world();
    w.fake.invites = async () => [
      { id: 42, createdAt: '2026-10-29T12:00:00.000Z', used: false, expiresAt: '2026-11-05T12:00:00.000Z', expired: false },
      { id: 17, createdAt: '2026-10-28T12:00:00.000Z', used: true, expiresAt: null, expired: false },
    ];
    open(w);
    const later = await rowOf(/Open/u);
    const earlier = await rowOf(/Used/u);
    expect(earlier).toHaveTextContent('Invite 1');
    expect(later).toHaveTextContent('Invite 2');
    expect(within(later).getByRole('button', { name: 'Reissue invite 2' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(17|42)\b/u);
  });

  test('a new link shows at once, though the list is read again slowly, and its head names its number once it lands', async () => {
    const w = world();
    const read = w.fake.invites.bind(w.fake);
    let calls = 0;
    let land: () => void = () => undefined;
    w.fake.invites = async () => { calls += 1; if (calls > 1) await new Promise<void>((r) => { land = r; }); return read(); };
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    await screen.findByLabelText('Invite link');
    const head = screen.getByRole('region', { name: 'Your new invite' });
    expect(within(head).queryByText(/^Invite\s*$/u)).toBeNull();
    land();
    expect(await within(head).findByText(/^Invite 1$/u)).toBeInTheDocument();
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

  test('Make an invite is a busy button while the make is out: aria-busy, its name kept, and a second press makes one invite', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.createInvite.bind(w.fake);
    const spy = vi.spyOn(w.fake, 'createInvite').mockImplementation(() => new Promise((resolve) => { release = () => resolve(real()); }));
    open(w);
    const make = await screen.findByRole('button', { name: 'Make an invite' });
    await userEvent.click(make);
    expect(make).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Make an invite' })).toBe(make);
    await userEvent.click(make);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    await screen.findByText(/You hold 1 of 2 open invites/u);
    expect(make).not.toHaveAttribute('aria-busy');
  });

  test('a make that gets no answer ends the wait and says so', async () => {
    const w = world();
    w.fake.createInvite = () => Promise.reject(new Error('offline'));
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Make an invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no answer came back/iu);
    expect(screen.getByRole('button', { name: 'Make an invite' })).toBeEnabled();
  });

  test('an expired invite says Expired once in its row', async () => {
    const w = world();
    await w.fake.createInvite();
    w.fake.clock.advance(8 * 86_400_000);
    open(w);
    const row = await rowOf(/Expired/u);
    expect((row.textContent ?? '').match(/Expired/gu)).toHaveLength(1);
    expect(within(row).getByRole('button', { name: /Reissue/u })).toBeInTheDocument();
  });

  test('an admin holds any number, and the page says so instead of a cap', async () => {
    open(world(true));
    expect(await screen.findByText(/any number of invites/u)).toBeInTheDocument();
    expect(screen.queryByText(/of 2 open/u)).toBeNull();
  });
});
