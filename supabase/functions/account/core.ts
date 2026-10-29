/**
 * Signing in, passwordless, as a pure module (the owner's answer 13, on #4): a player asks for a
 * code, which Supabase Auth emails with a link beside it, and signs in with it. Neither step
 * answers differently for an address with an account than for one without ("A response never
 * varies with a private fact").
 *
 * Two things could tell an address apart, and each is closed here:
 *   - What is said. Asking for a code says the same for every address and asks Auth only after
 *     the answer (`later`), so nothing Auth says about the address can reach it. A code that
 *     does not match is one sentence whether the address has a login or not.
 *   - How long it takes. Every answer, refusals included, is held to a whole number of
 *     ANSWER_FLOOR_MS from when the request came in.
 * No path takes a password, and no login holds one (supabase/migrations/0012_passwordless.sql).
 *
 * A code asked for with an invite may make a login; the invite is checked before the answer,
 * since whether a code opens anything is a fact about the code, not the address, and goes with
 * the login as its metadata. It is spent only when the login opens its account, at its first
 * sign-in (supabase/migrations/0009_registration.sql). Where that fails (the invite was spent
 * meanwhile), the sign-in still succeeds and says the way out: the openAccount action, with
 * another invite. A link from the email signs in through Auth itself, and the client then calls
 * open_account() as this does.
 */
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { REFUSAL_HINT } from '../act/core.ts';

/** Long enough to cover a code's check and its round trips, so the floor is what shows. */
export const ANSWER_FLOOR_MS = 1_000;

export interface Session {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly user: { readonly id: string; readonly user_metadata?: Record<string, unknown> };
}

/** The little of Supabase Auth this needs (supabase/functions/_shared/gotrue.ts). */
export interface Auth {
  /** Emails a code and a link; `create` lets it make a login for an address with none, carrying the invite. */
  requestCode(email: string, options: { create: boolean; invite: string | null }): Promise<void>;
  verifyCode(email: string, code: string): Promise<{ session: Session } | { refused: 'code' }>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface AccountAnswer {
  readonly status: number;
  readonly body: unknown;
  /** Work for after the answer has gone: Auth asked to send a code. */
  readonly later?: () => Promise<void>;
}

const SENT_CODE = 'If this address can sign in here, a code and a link to sign in are on their way to it.';
const NO_MATCH = 'that code does not match, or it has expired: ask for a new one';

const refused = (field: string, error: string): AccountAnswer => ({ status: 400, body: { field, error } });

type Fields = Record<string, unknown>;
const email = (r: Fields): string | AccountAnswer => {
  const v = typeof r.email === 'string' ? r.email.trim() : '';
  return v.length >= 3 && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v) ? v : refused('email', 'is not an email address');
};
/** Auth's codes are its digits only, six by default (supabase/config.toml's otp_length). */
const code = (r: Fields): string | AccountAnswer => {
  const v = typeof r.code === 'string' ? r.code.trim() : '';
  return /^\d{6,10}$/.test(v) ? v : refused('code', 'is the digits from the email');
};

async function answer(deps: { auth: Auth; service: Db; player: (token: string) => Db }, request: unknown): Promise<AccountAnswer> {
  if (typeof request !== 'object' || request === null) return refused('action', 'a request is an object naming its action');
  const r = request as Fields;
  switch (r.action) {
    case 'requestCode': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      const invite = typeof r.invite === 'string' && r.invite.length > 0 && r.invite.length <= 64 ? r.invite : null;
      // With no invite, the answer is whether the instance lets anyone make a login (open); an
      // invite that opens nothing is refused, for any address alike.
      const opens = await deps.service.rpc<'opens' | 'closed' | 'nothing'>('invite_open', { code: invite });
      if (invite !== null && opens === 'closed') return { status: 403, body: { error: 'registration is closed' } };
      if (invite !== null && opens !== 'opens') return refused('invite', 'that invite opens nothing');
      const create = opens === 'opens';
      return { status: 202, body: { message: SENT_CODE }, later: () => deps.auth.requestCode(address, { create, invite }) };
    }
    case 'verifyCode': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      const digits = code(r);
      if (typeof digits !== 'string') return digits;
      const out = await deps.auth.verifyCode(address, digits);
      if ('refused' in out) return refused('code', NO_MATCH);
      const invite = out.session.user.user_metadata?.invite;
      try {
        await deps.player(out.session.access_token).rpc('open_account', { code: typeof invite === 'string' ? invite : null });
        return { status: 200, body: { session: out.session, account: true } };
      } catch (e) {
        if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) {
          // The way out, said plainly: another invite, or, while registration is closed, an
          // admin opening it, after which the next sign-in opens the account.
          const way = /closed/.test(e.reason) ? 'when an admin opens it again, your next sign-in opens your account' : 'open the account with another invite';
          return { status: 200, body: { session: out.session, account: false, why: `${e.reason}; ${way}` } };
        }
        throw e;
      }
    }
    default:
      return refused('action', 'the actions are requestCode and verifyCode');
  }
}

export async function runAccount(deps: { auth: Auth; service: Db; player: (token: string) => Db; clock: Clock }, request: unknown): Promise<AccountAnswer> {
  const start = deps.clock.now();
  let out: AccountAnswer;
  try {
    out = await answer(deps, request);
  } catch (e) {
    console.error('account failed', e);
    out = { status: 503, body: { error: (request as Fields | null)?.action === 'verifyCode' ? 'signing in is not working right now; try again' : 'that could not be done right now; try again' } };
  }
  const took = deps.clock.now() - start;
  await deps.clock.sleep(Math.max(1, Math.ceil(took / ANSWER_FLOOR_MS)) * ANSWER_FLOOR_MS - took);
  return out;
}
