/**
 * What the scheduled functions' handlers (meet, chatter, staff, settle, write: each `handler.ts` beside its `index.ts`) take from outside:
 * the environment, the database client, the model factory, `fetch` and the broadcaster. The deployed set is `deployedDeps`, built
 * from `Deno.env.get` by the one line each `index.ts` holds; the rehearsal (tools/rehearse/) hands the same handlers its own set
 * and runs them in Node. A handler reads no global of Deno's: everything it reaches comes through here.
 */
import { postgrest, type Db } from './rpc.ts';
import type { Environment } from './serve.ts';
import { models } from './models/index.ts';
import { broadcaster } from './broadcast.ts';

export interface JobDeps {
  readonly env: (name: string) => string | undefined;
  /** The service's database client: deployed, `postgrest` with the secret key, sending a write again only where `safeToRepeat` says. */
  readonly db: (env: Environment, o?: { safeToRepeat?: (fn: string) => boolean }) => Db;
  readonly models: typeof models;
  readonly fetch: typeof fetch;
  readonly broadcaster: typeof broadcaster;
}

/** The deployed set, from an environment accessor (`Deno.env.get`, in each `index.ts`). */
export function deployedDeps(get: (name: string) => string | undefined): JobDeps {
  return {
    env: get,
    db: (env, o) => postgrest({ url: env.url, key: env.secret, ...o }),
    models,
    fetch: (...args) => globalThis.fetch(...args),
    broadcaster,
  };
}
