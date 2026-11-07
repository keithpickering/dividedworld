import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';
import { Contact, ContactScreen, ReachAPerson } from './Contact.tsx';
import { LoadedContact } from '../loaded.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const LEAD = 'The admins run this instance. Write to them if something looks broken, if you\'re stuck with no way out, or about anything that isn\'t part of the game.';

describe('Reach a person, at /contact', () => {
  test('signed out, it says who the admins are for, and shows each way as a row: its label, and a button or the address as the link', async () => {
    const fake = buildWorld();
    fake.seed.contact([{ label: 'Discord', href: 'https://discord.example/u/admin' }, { label: 'Email', href: 'admin@example.test' }]);
    renderIn(fake, <LoadedContact />, { path: '/contact' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Reach a person' })).toBeInTheDocument();
    expect(screen.getByText(LEAD)).toBeInTheDocument();
    const discord = screen.getByRole('link', { name: 'Open the Discord' });
    expect(discord).toHaveAttribute('href', 'https://discord.example/u/admin');
    expect(discord).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: 'admin@example.test' })).toHaveAttribute('href', 'mailto:admin@example.test');
    expect(screen.queryByText(/haven't added a way/u)).toBeNull();
  });

  test('each way is a row in the Settings idiom: the label in the label column, a secondary button or the address itself as the link in the other', async () => {
    const fake = buildWorld();
    fake.seed.contact([{ label: 'Discord', href: 'https://discord.example/u/admin' }, { label: 'Email', href: 'mailto:admin@example.test' }]);
    renderIn(fake, <LoadedContact />, { path: '/contact' });
    const discord = await screen.findByRole('link', { name: 'Open the Discord' });
    expect(discord).toHaveAttribute('data-kb-kind', 'secondary');
    expect(discord.closest('.kb-acct-row')).toContainElement(screen.getByRole('heading', { level: 2, name: 'Discord' }));
    /* The address is the link itself, as text a device with no mail client can still copy; an https link shows no address. */
    const mail = screen.getByRole('link', { name: 'admin@example.test' });
    expect(mail).not.toHaveAttribute('data-kb-kind');
    expect(mail.closest('.kb-acct-row')).toContainElement(screen.getByRole('heading', { level: 2, name: 'Email' }));
    expect(screen.queryByText(/discord\.example/u)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Email' })).toBeNull();
  });

  test('unset, it says so plainly, and it still says what the page is for', async () => {
    const fake = buildWorld();
    renderIn(fake, <LoadedContact />, { path: '/contact' });
    expect(await screen.findByText('This instance\'s admins haven\'t added a way to reach them yet.')).toBeInTheDocument();
    expect(screen.getByText(LEAD)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  test('is the same for a signed-out visitor, a player and an admin', async () => {
    const make = () => { const f = buildWorld(); f.seed.contact([{ label: 'Chat', href: 'https://chat.example/admin' }]); return f; };
    const visitor = renderIn(make(), <LoadedContact />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Open the Chat' });
    const out = visitor.container.innerHTML;
    cleanup();
    const f = make();
    const ann = f.seed.account('ann');
    f.seed.character(ann, 'Annie', 'face');
    f.signInAs(ann);
    const player = renderIn(f, <LoadedContact />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Open the Chat' });
    expect(player.container.innerHTML).toBe(out);
    cleanup();
    const g = make();
    const root = g.seed.account('root', { admin: true });
    g.signInAs(root);
    const admin = renderIn(g, <LoadedContact />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Open the Chat' });
    expect(admin.container.innerHTML).toBe(out);
  });

  test('a contact that could not be read is the router\'s failure, and never a stale list; Try again reads it', async () => {
    const fake = buildWorld();
    fake.seed.contact([{ label: 'Chat', href: 'https://chat.example/admin' }]);
    vi.spyOn(fake, 'adminContact').mockRejectedValueOnce(new Error('not read'));
    renderIn(fake, <LoadedContact />, { path: '/contact' });
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    expect(screen.queryByText(/haven't added a way/u)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Open the Chat' })).toBeInTheDocument();
  });

  test('signed out it is one adminContact call, and the page is whole in the first render of its document', async () => {
    const fake = buildWorld();
    fake.seed.contact([{ label: 'Chat', href: 'https://chat.example/admin' }]);
    const read = vi.spyOn(fake, 'adminContact');
    renderIn(fake, <LoadedContact />, { path: '/contact' });
    expect(await screen.findByRole('link', { name: 'Open the Chat' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    cleanup();
    const doc = await fake.adminContact();
    const held = holdReads(fake, ['session']);
    renderIn(fake, <ContactScreen doc={doc} />, { path: '/contact' });
    expect(screen.getByRole('link', { name: 'Open the Chat' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(held).toEqual([]);
  });

  test('draws only https: and mailto: addresses as links, whatever it was handed', () => {
    renderIn(buildWorld(), <Contact links={[{ label: 'Sneaky', href: 'javascript:alert(1)' }, { label: 'Fine', href: 'https://ok.example' }]} />, { path: '/contact' });
    expect(screen.queryByRole('link', { name: 'Sneaky' })).toBeNull();
    expect(screen.queryByText('Sneaky')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the Fine' })).toBeInTheDocument();
  });

  test('re-applies the server\'s shape: a mailto: with a query or a second address, an https with no host, or an address with a space is no link', () => {
    const bad = ['mailto:a@b?bcc=x@y', 'mailto:a@b@c', 'mailto:@b', 'https://', 'https:///x', 'https://u@h.example', 'https://a.example/ b', 'https://a.example/\u00a0b'];
    renderIn(buildWorld(), <Contact links={bad.map((href, i) => ({ label: `Bad ${i}`, href }))} />, { path: '/contact' });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    /* A way that is no link is not a row: no label and nothing to press, so no empty row. */
    for (let i = 0; i < bad.length; i += 1) expect(screen.queryByText(`Bad ${i}`)).toBeNull();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });
});

describe('the link to it', () => {
  test('is named "Reach a person" and goes to /contact', () => {
    renderIn(buildWorld(), <ReachAPerson />, { path: '/' });
    expect(screen.getByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
  });
});
