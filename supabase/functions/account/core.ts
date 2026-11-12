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
 * No path here takes a password, and no login holds one (supabase/migrations/0012_passwordless.sql).
 * This guards the client that uses it, not Supabase Auth's own endpoints, which answer the public
 * key directly: whether those can tell an address apart (its /otp asked to make no login, its
 * password sign-in's timing) is the owner's to measure on a test project, on #3.
 *
 * A code asked for with an invite may make a login; the invite is checked before the answer,
 * since whether a code opens anything is a fact about the code, not the address, and goes with
 * the login as its metadata. It is spent only when the login opens its account, at its first
 * sign-in (supabase/migrations/0009_registration.sql). Where that fails (the invite was spent
 * meanwhile), the sign-in still succeeds and says the way out: another invite, opened with the
 * act function's openAccount action (engine/rules/actions.ts). The email's link does not go to Auth: it opens the
 * instance's own page with the token's hash in the fragment, and that page calls verifyLink, which checks the hash
 * with Auth and then opens the account exactly as a code does, with the same answers held to the same floor.
 *
 * The page the link opens, and the `next` it carries back to the thread the player came from, are built
 * from the caller's `next` and the invite alone, never the address: `next` is kept only where the one rule
 * for it (engine/rules/next.ts) passes it for the instance's own site, and one that fails, or is the index,
 * is dropped without a word, so the answer, its status and its floor are the same for every address and
 * every `next`. It is never logged.
 */
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { REFUSAL_HINT } from '../act/core.ts';
import { sameSitePath } from '../../../engine/rules/next.ts';

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
  requestCode(email: string, options: { create: boolean; invite: string | null; redirect: string; conduct?: number }): Promise<void>;
  verifyCode(email: string, code: string): Promise<{ session: Session } | { refused: 'code' | 'barred' }>;
  /** The same token as the code, by the hash the email's link carries. */
  verifyLink(tokenHash: string): Promise<{ session: Session } | { refused: 'link' | 'barred' }>;
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

const SENT_CODE = 'If this address can sign in here, a code and a link to sign in are on their way to it. A new login needs an invite where this instance asks for one. If nothing comes in a few minutes, ask again.';
const BARRED = 'this account is locked, so it cannot sign in; reach an admin through Contact to appeal';
const NO_MATCH = 'that code does not match, or it has expired: ask for a new one';
const NO_LINK = 'that link does not work, or it has expired: ask for a new code';

const refused = (field: string, error: string): AccountAnswer => ({ status: 400, body: { field, error } });

type Fields = Record<string, unknown>;
const email = (r: Fields): string | AccountAnswer => {
  const v = typeof r.email === 'string' ? r.email.trim() : '';
  return v.length >= 3 && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v) ? v : refused('email', 'is not an email address');
};
/** Auth's codes are its digits only, six by default (supabase/config.toml's otp_length). */
const code = (r: Fields): string | AccountAnswer => {
  const v = typeof r.code === 'string' ? r.code.replace(/\s+/g, '') : '';
  return /^\d{6,10}$/.test(v) ? v : refused('code', 'is the digits from the email');
};

/** A token hash is URL-safe text; one that is not is refused as a spent one is, so the two read alike. */
const tokenHash = (r: Fields): string | AccountAnswer => {
  const v = typeof r.tokenHash === 'string' ? r.tokenHash.trim() : '';
  return /^[A-Za-z0-9_-]{16,256}$/.test(v) ? v : refused('link', NO_LINK);
};

/** What follows a successful check, of a code or a link alike: the login's account opens, or its way out is said. */
async function opened(deps: { player: (token: string) => Db }, session: Session): Promise<AccountAnswer> {
  const invite = session.user.user_metadata?.invite;
  try {
    const agreed = session.user.user_metadata?.conduct;
    // open_account records the acceptance only when this is the current version.
    await deps.player(session.access_token).rpc('open_account', { code: typeof invite === 'string' ? invite : null, ...(typeof agreed === 'number' && Number.isSafeInteger(agreed) ? { conduct_version: agreed } : {}) });
    return { status: 200, body: { session, account: true } };
  } catch (e) {
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) {
      // The way out, said plainly: another invite, or, while registration is closed, an
      // admin opening it, after which the next sign-in opens the account.
      const way = /closed/.test(e.reason) ? 'when an admin opens it again, your next sign-in opens your account' : 'open the account with another invite';
      return { status: 200, body: { session, account: false, why: `${e.reason}; ${way}` } };
    }
    throw e;
  }
}

/** The page the email's link opens: sign-in, or register where a login may be made, with `next` kept where it is a path on the site. */
function redirect(site: string, create: boolean, next: unknown): string {
  const url = new URL(create ? '/register' : '/sign-in', site);
  const kept = sameSitePath(next, url.origin);
  if (kept !== null && kept !== '/') url.searchParams.set('next', kept);
  return url.toString();
}

async function answer(deps: { auth: Auth; service: Db; player: (token: string) => Db; site: string }, request: unknown): Promise<AccountAnswer> {
  if (typeof request !== 'object' || request === null) return refused('action', 'a request is an object naming its action');
  const r = request as Fields;
  switch (r.action) {
    case 'requestCode': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      // An invite given is checked, a fact about the code and never the address. One that opens
      // may make a login; one that does not (spent, mistyped, longer than any code, not text)
      // makes none, but the code is still sent, so a returning player whose form kept an old
      // invite signs in, and the answer says what became of the invite, alike for every address.
      const given = r.invite !== undefined && r.invite !== null && r.invite !== '';
      const asked = typeof r.invite === 'string' && r.invite.trim().length > 0 && r.invite.length <= 64 ? r.invite.trim() : null;
      const opens = await deps.service.rpc<'opens' | 'closed' | 'nothing'>('invite_open', { code: given && asked === null ? '' : asked });
      const create = opens === 'opens';
      const invite = create ? asked : null;
      const note = !given || create ? {} : { invite: opens === 'closed' ? 'registration is closed, so no new login is made' : 'that invite opens nothing, so no new login is made with it' };
      // The version of the code the register form's checkbox agreed to rides with the login (Auth keeps it in the user's metadata) until the account opens; anything
      // but a positive whole number is no version, and nothing is then recorded as accepted.
      const conduct = typeof r.conduct === 'number' && Number.isSafeInteger(r.conduct) && r.conduct >= 1 ? r.conduct : undefined;
      return { status: 202, body: { message: SENT_CODE, ...note }, later: () => deps.auth.requestCode(address, { create, invite, redirect: redirect(deps.site, create, r.next), ...(conduct === undefined ? {} : { conduct }) }) };
    }
    case 'verifyCode': {
      const address = email(r);
      if (typeof address !== 'string') return address;
      const digits = code(r);
      if (typeof digits !== 'string') return digits;
      const out = await deps.auth.verifyCode(address, digits);
      /* Said only after a correct code, so it proves nothing to anyone who does not hold the address; plain, never "try again". The hint is the one the screens read as a bar. */
      if ('refused' in out && out.refused === 'barred') return { status: 403, body: { error: BARRED, hint: 'kayfabb.barred' } };
      if ('refused' in out) return refused('code', NO_MATCH);
      return opened(deps, out.session);
    }
    case 'verifyLink': {
      const hash = tokenHash(r);
      if (typeof hash !== 'string') return hash;
      const out = await deps.auth.verifyLink(hash);
      /* The same plain answer as a code's: a banned login following its emailed link lands on the bar, never "try again". */
      if ('refused' in out && out.refused === 'barred') return { status: 403, body: { error: BARRED, hint: 'kayfabb.barred' } };
      if ('refused' in out) return refused('link', NO_LINK);
      return opened(deps, out.session);
    }
    default:
      return refused('action', 'the actions are requestCode, verifyCode and verifyLink');
  }
}

export async function runAccount(deps: { auth: Auth; service: Db; player: (token: string) => Db; clock: Clock; site: string }, request: unknown): Promise<AccountAnswer> {
  const start = deps.clock.now();
  let out: AccountAnswer;
  try {
    out = await answer(deps, request);
  } catch (e) {
    console.error('account failed', e);
    out = { status: 503, body: { error: ['verifyCode', 'verifyLink'].includes((request as Fields | null)?.action as string) ? 'signing in is not working right now; try again' : 'that could not be done right now; try again' } };
  }
  const took = deps.clock.now() - start;
  await deps.clock.sleep(Math.max(1, Math.ceil(took / ANSWER_FLOOR_MS)) * ANSWER_FLOOR_MS - took);
  return out;
}
