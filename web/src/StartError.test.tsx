/**
 * The screen a build that cannot start shows: plain words, never a blank page. An unknown moment of
 * the boards fixture (web/src/data/backend.ts) lands here with the list of moments, so the person
 * who mistyped an address sees what to type.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBackend } from './data/backend.ts';
import { MOMENTS } from './data/fixtures/boards.ts';
import { StartError } from './StartError.tsx';

describe('StartError', () => {
  it('shows an unknown moment\'s error, with the moment names, under "This site could not start"', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'e2e');
    window.history.replaceState(null, '', '/?fixture=boards&moment=99-nope');
    const error = await createBackend().then(() => null, (e: unknown) => e);
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
    render(<StartError error={error} />);
    expect(screen.getByRole('heading', { level: 1, name: 'This site could not start' })).toBeInTheDocument();
    const shown = screen.getByRole('main').textContent ?? '';
    for (const name of ['99-nope', ...Object.keys(MOMENTS)]) expect(shown).toContain(name);
  });

  it('says an Error\'s own message, and for something that is not an Error says only what is true of any start failure', () => {
    const { rerender } = render(<StartError error={new Error('This build names no Supabase project: set it.')} />);
    expect(screen.getByRole('main')).toHaveTextContent('This build names no Supabase project: set it.');
    rerender(<StartError error="odd" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This site could not start');
    expect(screen.getByRole('main')).toHaveTextContent('The site could not start: odd');
    expect(screen.getByRole('main')).not.toHaveTextContent(/Supabase/);
  });
});
