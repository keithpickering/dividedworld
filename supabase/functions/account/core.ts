/**
 * Signing up, signing in and resetting a password, as a pure module, so that none of them
 * answers differently for an address with an account than for one without ("A response never
 * varies with a private fact").
 *
 * Two things could tell an address apart, and each is closed here:
 *   - What is said. A sign-up and a reset say the same for every address and do their work
 *     with Supabase Auth only after the answer (`later`), so nothing Auth says about the address
 *     can reach it. A sign-in's refusal is one sentence for a wrong password and for an address
 *     nobody holds. Only the right password learns more, and it already knows.
 *   - How long it takes. Every answer, refusals included, is held to a whole number of
 *     ANSWER_FLOOR_MS from when the request came in, so a password compared for a known address
 *     and none compared for an unknown one take the same time to answer.
 *
 * A sign-up's invite is checked before the answer, since whether a code opens anything is a fact
 * about the code, not the address; it is spent only when the login opens its account at its
 * first sign-in (supabase/migrations/0009_registration.sql), with the code it signed up with.
 * Where that fails (the invite was spent meanwhile), the sign-in still succeeds and says the way
 * out: the openAccount action, with another invite.
 */
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { REFUSAL_HINT } from '../act/core.ts';

/** Long enough to cover a sign-in's password check and its round trips, so the floor is what shows. */
export const ANSWER_FLOOR_MS = 1_000;

export interface Session {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly user: { readonly id: string; readonly user_metadata?: Record<string, unknown> };
}

/** The little of Supabase Auth this needs (supabase/functions/_shared/gotrue.ts). */
export interface Auth {
  signUp(email: string, password: string, data: { invite: string | null }): Promise<void>;
  signIn(email: string, password: string): Promise<{ session: Session } | { refused: 'credentials' | 'unconfirmed' }>;
  recover(email: string): Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface AccountAnswer {
  readonly status: number;
  readonly body: unknown;
  /** Work for after the answer has gone: Auth asked to sign up or to send a reset. */
  readonly later?: () => Promise<void>;
}

const SENT_SIGN_UP = 'If this address can sign up, a link to finish is on its way to it.';
const SENT_RESET = 'If this address has an account, a link to reset its password is on its way to it.';
const NO_MATCH = 'that email and password do not match';

const refused = (field: string, error: string): AccountAnswer => ({ status: 400, body: { field, error } });

type Fields = Record<string, unknown>;
const email = (r: Fields): string | AccountAnswer => {
  const v = typeof r.email === 'string' ? r.email.trim() : '';
  return v.length >= 3 && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v) ? v : refused('email', 'is not an email address');
};
/** Supabase Auth hashes at most 72 bytes of a password; a longer one would be cut without a word. */
const password = (r: Fields, least: number): string | AccountAnswer => {
  const v = r.password;
  if (typeof v !== 'string' || v.length < least) return refused('password', least > 1 ? `is shorter than ${least} characters` : 'is missing');
  if (new TextEncoder().encode(v).length > 72) return refused('password', 'is longer than 72 bytes');
  return v;
};

async function answer(deps: { auth: Auth; service: Db; player: (token: string) => Db }, request: unknown): Promise<AccountAnswer> {
  if (typeof request !== 'object' || request === null) return refused('action', 'a request is an object naming its action');
  const r = request as Fields;
  switch (r.action) {
    case 'signUp': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      const secret = password(r, 8);
      if (typeof secret !== 'string') return secret;
      const code = typeof r.invite === 'string' && r.invite.length <= 64 ? r.invite : null;
      const opens = await deps.service.rpc<'opens' | 'closed' | 'nothing'>('invite_open', { code });
      if (opens === 'closed') return { status: 403, body: { error: 'registration is closed' } };
      if (opens !== 'opens') return refused('invite', 'that invite opens nothing');
      return { status: 202, body: { message: SENT_SIGN_UP }, later: () => deps.auth.signUp(address, secret, { invite: code }) };
    }
    case 'reset': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      return { status: 202, body: { message: SENT_RESET }, later: () => deps.auth.recover(address) };
    }
    case 'signIn': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      const secret = password(r, 1);
      if (typeof secret !== 'string') return secret;
      const out = await deps.auth.signIn(address, secret);
      if ('refused' in out) {
        // Only the right password reaches "unconfirmed", so saying it tells nobody anything new.
        return out.refused === 'unconfirmed'
          ? { status: 403, body: { error: 'confirm your email first: the link is in the email sent when you signed up' } }
          : refused('password', NO_MATCH);
      }
      const invite = out.session.user.user_metadata?.invite;
      try {
        await deps.player(out.session.access_token).rpc('open_account', { code: typeof invite === 'string' ? invite : null });
        return { status: 200, body: { session: out.session, account: true } };
      } catch (e) {
        if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) {
          // The way out, said plainly: another invite, or, while registration is closed, an
          // admin opening it, after which the next sign-in opens the account.
          const way = /closed/.test(e.reason) ? 'it opens when an admin opens registration again, and your next sign-in opens the account' : 'open the account with another invite';
          return { status: 200, body: { session: out.session, account: false, why: `${e.reason}; ${way}` } };
        }
        throw e;
      }
    }
    default:
      return refused('action', 'the actions are signUp, signIn, reset');
  }
}

export async function runAccount(deps: { auth: Auth; service: Db; player: (token: string) => Db; clock: Clock }, request: unknown): Promise<AccountAnswer> {
  const start = deps.clock.now();
  let out: AccountAnswer;
  try {
    out = await answer(deps, request);
  } catch (e) {
    console.error('account failed', e);
    out = { status: 503, body: { error: (request as Fields | null)?.action === 'signIn' ? 'signing in is not working right now; try again' : 'that could not be done right now; try again' } };
  }
  const took = deps.clock.now() - start;
  await deps.clock.sleep(Math.max(1, Math.ceil(took / ANSWER_FLOOR_MS)) * ANSWER_FLOOR_MS - took);
  return out;
}
