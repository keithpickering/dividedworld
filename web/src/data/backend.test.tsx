/**
 * Which backend a build runs on. A production build that names no project must refuse rather than
 * run on the demo world, where a player would post into a forum that vanishes with the tab; the
 * end-to-end build (mode "e2e") is the one production build that runs on the fake, even with a
 * project set in the environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackend } from './backend.ts';

const URL_ = 'https://proj.supabase.co';

afterEach(() => vi.unstubAllEnvs());

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
