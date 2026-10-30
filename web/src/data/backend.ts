/**
 * Which backend the app runs on: the instance's Supabase project when the build names one, or the
 * in-memory backend with a demo world for development and the end-to-end flows. A production build
 * with no project is refused rather than silently run on a demo, whatever the build's mode is
 * called; the end-to-end build (mode "e2e") is the one production build that runs on the fake. The
 * fake and the demo are loaded only in that branch, so a bundle that uses Supabase does not carry
 * them.
 *
 * In the end-to-end build the address can name the boards' fixture instead of the demo world:
 * `?fixture=boards&moment=<name>` seeds the season as it stood at that moment, signs in the moment's
 * account and moves the address to the moment's route (web/src/data/fixtures/boards.ts). Nothing
 * else reads those parameters: the Supabase branch returns before it looks at the address.
 */
import type { KayfaApi } from '../../../engine/ui/data/api.ts';
import { createSupabaseApi } from './supabase.ts';
import { fallbackSettings } from './settings.ts';

export async function createBackend(): Promise<KayfaApi> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const e2e = import.meta.env.MODE === 'e2e';
  if (!e2e && url && anonKey) return createSupabaseApi({ url, anonKey, settingsFallback: fallbackSettings });
  if (import.meta.env.PROD && !e2e) {
    throw new Error('This build names no Supabase project: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY when building.');
  }
  const params = e2e ? new URLSearchParams(globalThis.location?.search) : null;
  const named = params?.get('fixture') ?? null;
  if (named !== null && named !== 'boards') throw new Error(`There is no fixture named "${named}". The fixture is boards.`);
  // `?fixture=boards&story=<id>` is a story's own seed (the board match's stories): that is not built here, and until it is the demo world loads.
  const boards = named === 'boards' && !(params!.has('story') && !params!.has('moment'));
  if (boards) {
    const [{ assertMoment, createBoardsFake, seedBoards }, { recordAvatarUploads }] = await Promise.all([import('./fixtures/boards.ts'), import('../demo.ts')]);
    const moment = assertMoment(params!.get('moment'));
    const fake = createBoardsFake(moment);
    globalThis.history.replaceState(null, '', seedBoards(fake, moment));
    recordAvatarUploads(fake);
    return fake;
  }
  const [{ createFake }, { instance }, { seedDemo, recordAvatarUploads }] = await Promise.all([
    import('../../../engine/ui/data/fake.ts'),
    import('../../../instances/divided-world/index.ts'),
    import('../demo.ts'),
  ]);
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  if (e2e) recordAvatarUploads(fake);
  return fake;
}
