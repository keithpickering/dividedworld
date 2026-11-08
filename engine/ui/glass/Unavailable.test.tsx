import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { GlassCannotDisplay, GlassCannotFind } from './Unavailable.tsx';

const ADDRESS = '/t/3f2a9c1e';

function displayed(onRetry: () => void = () => {}) {
  return renderIn(buildWorld(), <main><GlassCannotDisplay onRetry={onRetry} /></main>, { path: ADDRESS });
}

function notFound() {
  return renderIn(buildWorld(), <main><GlassCannotFind /></main>, { path: ADDRESS });
}

describe('GlassCannotDisplay', () => {
  test('its title, line and buttons read exactly', () => {
    displayed();
    expect(screen.getByRole('heading', { level: 1, name: "This screen didn't load" })).toBeInTheDocument();
    expect(screen.getByText("The server didn't answer, or it took longer than 20 seconds. Loading a screen changes nothing, so nothing was lost.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('data-kb-kind', 'primary');
    expect(screen.getByRole('button', { name: 'Back to the board' })).toHaveAttribute('data-kb-kind', 'secondary');
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
