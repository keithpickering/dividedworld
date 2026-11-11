import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { GlassCannotDisplay, GlassCannotFind } from './Unavailable.tsx';

const ADDRESS = '/t/3f2a9c1e';

function displayed(onRetry: () => void = () => {}, kind: 'offline' | 'silent' | 'server' | 'broken' = 'silent') {
  return renderIn(buildWorld(), <main><GlassCannotDisplay kind={kind} onRetry={onRetry} /></main>, { path: ADDRESS });
}

function notFound() {
  return renderIn(buildWorld(), <main><GlassCannotFind /></main>, { path: ADDRESS });
}

describe('GlassCannotDisplay', () => {
  test.each([
    ['offline', "You're offline", 'Your device reports no connection, so nothing was sent. Reconnect, then try again.'],
    ['silent', "This screen didn't load", "The server didn't answer within 20 seconds, or the connection dropped on the way. Loading a screen changes nothing, so nothing was lost."],
  ] as const)('%s: its title, line and buttons read exactly', (kind, title, lead) => {
    displayed(() => {}, kind);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(lead)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('data-kb-kind', 'primary');
    expect(screen.getByRole('button', { name: 'Back to the board' })).toHaveAttribute('data-kb-kind', 'secondary');
    expect(screen.queryByRole('link', { name: 'tell an admin' })).toBeNull();
  });

  test.each([
    ['server', 'The server answered with an error. Your connection is fine, and nothing was lost. Try again in a moment. If it keeps happening, '],
    ['broken', 'Something went wrong while loading it. Nothing was lost. Try again, and if it keeps happening, '],
  ] as const)('%s: its words, with "tell an admin" a link to the contact page', (kind, lead) => {
    const { container } = displayed(() => {}, kind);
    expect(screen.getByRole('heading', { level: 1, name: "This screen didn't load" })).toBeInTheDocument();
    expect(container.textContent).toContain(`${lead}tell an admin.`);
    expect(screen.getByRole('link', { name: 'tell an admin' })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('button', { name: 'Back to the board' })).toBeInTheDocument();
  });

  test('Try again calls onRetry', async () => {
    const onRetry = vi.fn();
    displayed(onRetry);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('it names no address, not even the one it was given', () => {
    const { container } = displayed();
    expect(container.textContent).not.toContain('3f2a9c1e');
  });
});

describe('GlassCannotFind', () => {
  test('its title, line and button read exactly', () => {
    notFound();
    expect(screen.getByRole('heading', { level: 1, name: "There's nothing here" })).toBeInTheDocument();
    expect(screen.getByText('Nothing on this address can be shown: it may never have existed, or it has gone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the board' })).toHaveAttribute('data-kb-kind', 'primary');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  test('it names no address', () => {
    const { container } = notFound();
    expect(container.textContent).not.toContain('3f2a9c1e');
  });
});
