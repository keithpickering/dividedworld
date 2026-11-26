/**
 * What the scheduled functions' handlers (meet, chatter, staff, settle, write: each `handler.ts` beside its `index.ts`) take from outside:
 * the environment, the database client, the model factory, `fetch`, the broadcaster, and what the mail job reaches outside the database (the mailer and Supabase Auth's admin API). The deployed set is `deployedDeps`, built
 * from `Deno.env.get` by the one line each `index.ts` holds; the rehearsal (tools/rehearse/) hands the same handlers its own set
 * and runs them in Node. A handler reads no global of Deno's: everything it reaches comes through here.
 */
import { postgrest, type Db } from './rpc.ts';
import type { Environment } from './serve.ts';
import { models } from './models/index.ts';
import { broadcaster } from './broadcast.ts';
import { authAdmin } from './mail/auth-admin.ts';
import { resendMailer } from './mail/resend.ts';
import type { Mailer } from '../../../engine/system/mail.ts';
import type { AuthAdmin } from '../mail/core.ts';

export interface JobDeps {
  readonly env: (name: string) => string | undefined;
  /** The service's database client: deployed, `postgrest` with the secret key, sending a write again only where `safeToRepeat` says. */
  readonly db: (env: Environment, o?: { safeToRepeat?: (fn: string) => boolean }) => Db;
  readonly models: typeof models;
  readonly fetch: typeof fetch;
  readonly broadcaster: typeof broadcaster;
  /** The mail job's sender, built from the environment where it is needed (the Resend key is read there and never logged). */
  readonly mailer: (env: (name: string) => string | undefined) => Mailer;
  /** Supabase Auth's admin API with the service's key: bar and unbar a login, and read an account's address (null where there is none). */
  readonly authAdmin: (o: { url: string; key: string }) => AuthAdmin & { address(account: string): Promise<string | null> };
}

/** The deployed set, from an environment accessor (`Deno.env.get`, in each `index.ts`). */
export function deployedDeps(get: (name: string) => string | undefined): JobDeps {
  return {
    env: get,
    db: (env, o) => postgrest({ url: env.url, key: env.secret, ...o }),
    models,
    fetch: (...args) => globalThis.fetch(...args),
    broadcaster,
    mailer: (env) => resendMailer({ env }),
    authAdmin: (o) => authAdmin(o),
  };
}
