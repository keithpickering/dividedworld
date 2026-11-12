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
 * account and moves the address to the moment's route (web/src/data/fixtures/boards.ts). A story
 * (`?fixture=boards&story=<id>`) is the story route's, which main.tsx takes before it asks for a
 * backend, so one that reaches here is refused. Nothing else reads those parameters: the Supabase
 * branch returns before it looks at the address. The end-to-end build also leaves the demo's fake
 * where a test can reach it (exposeFake, web/src/demo.ts), to play another player's part. In a build that
 * is not production, `?latency=<ms>` delays every promise the fake answers (withLatency), and `?fail=<rpc>` fails the first call of
 * the named rpc (withFailure).
 */
import type { Character, KayfaApi } from '../../../engine/ui/data/api.ts';
import { withStaffFace } from '../../../engine/ui/data/staff-faces.ts';
import { instance } from '../../../instances/divided-world/index.ts';
import { instanceUi } from '../../../instances/divided-world/ui/index.ts';
import { createSupabaseApi } from './supabase.ts';
import { fallbackSettings } from './settings.ts';

/**
 * `?latency=<ms>` (end-to-end and development builds only): every promise the fake returns answers that much
 * later, as a round trip would, so a test can watch a page open. Anything else the fake returns passes through.
 */
function withLatency(api: KayfaApi, params: URLSearchParams | null): KayfaApi {
  const raw = params?.get('latency') ?? null;
  if (raw === null) return api;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`The address names latency "${raw}": it is a number of milliseconds.`);
  return new Proxy(api, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!out || typeof (out as { then?: unknown }).then !== 'function') return out;
        return new Promise((resolve, reject) => {
          (out as Promise<unknown>).then(
            (x) => setTimeout(() => resolve(x), ms),
            (e) => setTimeout(() => reject(e), ms),
          );
        });
      };
    },
  });
}

/**
 * `?fail=<rpc>[,<rpc>]` (end-to-end and development builds only, gated as `?latency=` is: `timing` is null in a production build): the
 * first call of each named rpc (the api method's name in snake case, `log_page` for `logPage`) is refused as a dropped request is, and
 * every call after it is answered, so a test can watch a screen fail and then Try again.
 */
export function withFailure(api: KayfaApi, params: URLSearchParams | null): KayfaApi {
  const raw = params?.get('fail') ?? null;
  if (raw === null) return api;
  const left = new Set(raw.split(',').map((n) => n.trim()).filter(Boolean));
  if (left.size === 0) throw new Error('The address names no rpc to fail: `?fail=<rpc name>`, such as log_page.');
  return new Proxy(api, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      const rpc = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      return (...args: unknown[]) => {
        if (left.delete(rpc)) return Promise.reject(new Error(`The address asked ${rpc} to fail once.`));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** Staff characters wear the instance's pictures where they enter the screens' data (engine/ui/data/staff-faces.ts). */
const face = (c: Character) => withStaffFace(c, instanceUi, instance.developer?.avatar);

export async function createBackend(): Promise<KayfaApi> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const e2e = import.meta.env.MODE === 'e2e';
  // The functions refuse a legacy key in the same words (supabase/functions/_shared/serve.ts), and by its name, never its value.
  if (!e2e && publishableKey?.startsWith('eyJ')) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is a legacy JWT key; KayfaBB takes the publishable and secret keys (sb_publishable_…, sb_secret_…)');
  }
  if (!e2e && url && publishableKey) return createSupabaseApi({ url, publishableKey, settingsFallback: fallbackSettings, face });
  if (import.meta.env.PROD && !e2e) {
    throw new Error('This build names no Supabase project: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY when building.');
  }
  const params = e2e ? new URLSearchParams(globalThis.location?.search) : null;
  /* The latency switch alone is also read in development; the fixture parameters stay the e2e build's. */
  const timing = e2e || import.meta.env.DEV ? new URLSearchParams(globalThis.location?.search) : null;
  const named = params?.get('fixture') ?? null;
  if (named !== null && named !== 'boards') throw new Error(`There is no fixture named "${named}". The fixture is boards.`);
  // `?fixture=boards&story=<id>` is the story route's (web/src/main.tsx renders it before any backend is asked).
  if (named === 'boards' && params!.has('story')) {
    throw new Error(`The address names the story "${params!.get('story')}": a story is rendered by the story route, not on a backend.`);
  }
  if (named === 'boards') {
    const [{ assertMoment, createBoardsFake, seedBoards }, { recordAvatarUploads }] = await Promise.all([import('./fixtures/boards.ts'), import('../demo.ts')]);
    const moment = assertMoment(params!.get('moment'));
    const fake = createBoardsFake(moment);
    globalThis.history.replaceState(null, '', seedBoards(fake, moment));
    recordAvatarUploads(fake);
    return withFailure(withLatency(fake, timing), timing);
  }
  const [{ createFake }, { seedDemo, recordAvatarUploads, exposeFake }] = await Promise.all([
    import('../../../engine/ui/data/fake.ts'),
    import('../demo.ts'),
  ]);
  const fake = createFake({ instance, settings: fallbackSettings, face });
  const demo = seedDemo(fake);
  if (e2e) {
    recordAvatarUploads(fake);
    exposeFake(fake, demo);
  }
  return withFailure(withLatency(fake, timing), timing);
}
