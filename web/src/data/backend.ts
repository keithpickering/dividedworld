/**
 * Which backend the app runs on: the instance's Supabase project when the build names one, or the
 * in-memory backend with a demo world for development and the end-to-end flows. A production build
 * with no project is refused rather than silently run on a demo.
 */
import type { KayfaApi } from '../../../engine/ui/data/api.ts';
import { createFake } from '../../../engine/ui/data/fake.ts';
import { instance } from '../../../instances/divided-world/index.ts';
import { seedDemo } from '../demo.ts';
import { createSupabaseApi } from './supabase.ts';
import { fallbackSettings } from './settings.ts';

export function createBackend(): KayfaApi {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (import.meta.env.MODE !== 'e2e' && url && anonKey) return createSupabaseApi({ url, anonKey, settingsFallback: fallbackSettings });
  if (import.meta.env.MODE === 'production') {
    throw new Error('this build names no Supabase project: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  }
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  return fake;
}
