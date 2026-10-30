/**
 * Which backend a build runs on. A production build that names no project must refuse rather than
 * run on the demo world, where a player would post into a forum that vanishes with the tab; the
 * end-to-end build (mode "e2e") is the one production build that runs on the fake, even with a
 * project set in the environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackend } from './backend.ts';
import { MOMENTS } from './fixtures/boards.ts';

const URL_ = 'https://proj.supabase.co';

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

const at = (search: string) => window.history.replaceState(null, '', `/${search}`);

describe('createBackend', () => {
  it('refuses a production build that names no project, whatever its mode is called', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'staging');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    await expect(createBackend()).rejects.toThrow(/names no Supabase project/);
  });

  it('refuses a production build that names a URL and no key', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', URL_);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    await expect(createBackend()).rejects.toThrow(/names no Supabase project/);
  });

  it('gives the fake in the e2e build, whatever project is set', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'e2e');
    vi.stubEnv('VITE_SUPABASE_URL', URL_);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    const api = await createBackend();
    expect(await api.boards()).not.toHaveLength(0);
  });

  it('gives Supabase only when both the URL and the key are set', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', URL_);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    const api = await createBackend();
    await api.boards().catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(URL_);
    fetchSpy.mockRestore();
  });

  it('gives the fake in development with no project', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const api = await createBackend();
    expect(await api.boards()).not.toHaveLength(0);
  });
});

/* A bundle that talks to Supabase must not carry the demo world (its seed, its kept preferences). */
describe('createBackend and the demo', () => {
  it('loads the demo module only for the fake, never when it gives Supabase', async () => {
    vi.resetModules();
    const loaded: string[] = [];
    vi.doMock('../demo.ts', () => { loaded.push('demo'); return { seedDemo: () => ({}), recordAvatarUploads: () => undefined }; });
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', URL_);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    const { createBackend: fresh } = await import('./backend.ts');
    await fresh();
    expect(loaded).toEqual([]);
    vi.stubEnv('MODE', 'e2e');
    await fresh();
    expect(loaded).toEqual(['demo']);
    vi.doUnmock('../demo.ts');
  });
});

/* The end-to-end build's fixture: the boards' season at a moment, named by the address. */
describe('createBackend and the boards fixture', () => {
  const e2e = () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'e2e');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  };

  it('seeds the named moment in place of the demo, signs in its account and moves the address to its route', async () => {
    e2e();
    at('?fixture=boards&moment=12-log');
    const api = await createBackend();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(MOMENTS['12-log'].route(''));
    expect((await api.session()).signedIn).toBe(true);
    expect((await api.wallet()).balance).toBe(372);
    expect((await api.myCharacters()).map((c) => c.name)).toContain('Pipewrench');
    expect((await api.boards()).find((b) => b.slug === 'general')!.threadCount).toBe(1);
  });

  it('opens a thread moment on the thread, page 3, as the moment\'s account', async () => {
    e2e();
    at('?fixture=boards&moment=03-react');
    const api = await createBackend();
    expect(window.location.pathname).toMatch(/^\/t\/[^/]+$/);
    expect(window.location.search).toBe('?page=3');
    expect(window.location.hash).toBe('#post-42');
    expect((await api.myCharacters()).map((c) => c.name)).toEqual(['Gloomba']);
  });

  it('does not seed the demo when a moment is named, and still records avatar uploads', async () => {
    vi.resetModules();
    const seeded: string[] = [];
    vi.doMock('../demo.ts', () => ({ seedDemo: () => { seeded.push('demo'); return {}; }, recordAvatarUploads: () => { seeded.push('avatars'); } }));
    e2e();
    at('?fixture=boards&moment=01-main');
    const { createBackend: fresh } = await import('./backend.ts');
    await fresh();
    expect(seeded).toEqual(['avatars']);
    vi.doUnmock('../demo.ts');
  });

  it('throws on a moment it does not have, with the names of the ones it has, for the error screen', async () => {
    e2e();
    at('?fixture=boards&moment=99-nope');
    const failed = await createBackend().then(() => null, (e: unknown) => e);
    expect(failed).toBeInstanceOf(Error);
    for (const name of ['99-nope', ...Object.keys(MOMENTS)]) expect((failed as Error).message).toContain(name);
  });

  it('throws on the boards fixture with no moment, and on a fixture it does not have', async () => {
    e2e();
    at('?fixture=boards');
    await expect(createBackend()).rejects.toThrow(/01-main/);
    at('?fixture=bords&moment=01-main');
    await expect(createBackend()).rejects.toThrow(/no fixture named "bords"/);
  });

  it('leaves a story to its own task: with a story and no moment it gives the demo world', async () => {
    e2e();
    at('?fixture=boards&story=03-react');
    const api = await createBackend();
    expect((await api.boards()).find((b) => b.slug === 'general')!.threadCount).toBeGreaterThan(1);
  });

  it('ignores the fixture parameters in a build that gives the demo without being the e2e build', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    at('?fixture=boards&moment=99-nope');
    const api = await createBackend();
    expect(window.location.search).toBe('?fixture=boards&moment=99-nope');
    expect(await api.boards()).not.toHaveLength(0);
  });

  it('never reads the parameters when it gives Supabase, even in a bad one', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', URL_);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    at('?fixture=boards&moment=99-nope');
    const api = await createBackend();
    expect(window.location.search).toBe('?fixture=boards&moment=99-nope');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    await api.boards().catch(() => undefined);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(URL_);
    fetchSpy.mockRestore();
  });
});
