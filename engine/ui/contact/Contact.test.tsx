import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Contact, ContactScreen, ReachAPerson } from './Contact.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const LEAD = 'The admins run this instance. Write to them if something looks broken, if you\'re stuck with no way out, or about anything that isn\'t part of the game.';

describe('Reach a person, at /contact', () => {
  test('signed out, it says who the admins are for, and shows each link as a link with its label', async () => {
    const fake = buildWorld();
    fake.seed.contact([{ label: 'Discord', href: 'https://discord.example/u/admin' }, { label: 'Email', href: 'admin@example.test' }]);
    renderIn(fake, <ContactScreen />, { path: '/contact' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Reach a person' })).toBeInTheDocument();
    expect(screen.getByText(LEAD)).toBeInTheDocument();
    const discord = screen.getByRole('link', { name: 'Discord' });
    expect(discord).toHaveAttribute('href', 'https://discord.example/u/admin');
    expect(discord).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:admin@example.test');
    expect(screen.queryByText(/haven't added a way/u)).toBeNull();
  });

  test('a mailto: link also shows its address as text, so a device with no mail client can still copy it; an https link shows none', async () => {
    const fake = buildWorld();
    fake.seed.contact([{ label: 'Email', href: 'mailto:admin@example.test' }, { label: 'Chat', href: 'https://chat.example/admin' }]);
    renderIn(fake, <ContactScreen />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Email' });
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
    expect(screen.queryByText(/chat\.example/u)).toBeNull();
  });

  test('unset, it says so plainly, and it still says what the page is for', async () => {
    const fake = buildWorld();
    renderIn(fake, <ContactScreen />, { path: '/contact' });
    expect(await screen.findByText('This instance\'s admins haven\'t added a way to reach them yet.')).toBeInTheDocument();
    expect(screen.getByText(LEAD)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  test('is the same for a signed-out visitor, a player and an admin', async () => {
    const make = () => { const f = buildWorld(); f.seed.contact([{ label: 'Chat', href: 'https://chat.example/admin' }]); return f; };
    const visitor = renderIn(make(), <ContactScreen />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Chat' });
    const out = visitor.container.innerHTML;
    cleanup();
    const f = make();
    const ann = f.seed.account('ann');
    f.seed.character(ann, 'Annie', 'face');
    f.signInAs(ann);
    const player = renderIn(f, <ContactScreen />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Chat' });
    expect(player.container.innerHTML).toBe(out);
    cleanup();
    const g = make();
    const root = g.seed.account('root', { admin: true });
    g.signInAs(root);
    const admin = renderIn(g, <ContactScreen />, { path: '/contact' });
    await screen.findByRole('link', { name: 'Chat' });
    expect(admin.container.innerHTML).toBe(out);
  });

  test('says in plain words when the contact could not be read, and never shows a stale list', async () => {
    const fake = buildWorld();
    vi.spyOn(fake, 'adminContact').mockRejectedValue(new Error('not read'));
    renderIn(fake, <ContactScreen />, { path: '/contact' });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read');
    expect(screen.queryByText(/haven't added a way/u)).toBeNull();
  });

  test('draws only https: and mailto: addresses as links, whatever it was handed', () => {
    renderIn(buildWorld(), <Contact links={[{ label: 'Sneaky', href: 'javascript:alert(1)' }, { label: 'Fine', href: 'https://ok.example' }]} />, { path: '/contact' });
    expect(screen.queryByRole('link', { name: 'Sneaky' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Fine' })).toBeInTheDocument();
  });
});

describe('the link to it', () => {
  test('is named "Reach a person" and goes to /contact', () => {
    renderIn(buildWorld(), <ReachAPerson />, { path: '/' });
    expect(screen.getByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
  });
});
