/**
 * Supabase Auth, as the account function uses it (supabase/functions/account/core.ts): its own
 * passwordless endpoints, called with the project's public key, as a browser would call them.
 * Auth emails the code and its link itself (supabase/templates/).
 *
 * A code request runs after the account function has answered, so nothing it meets can reach
 * that answer: a transport failure (no answer, a 5xx) is retried once, and any refusal, an
 * address with no login asked for without making one or a 429 from Auth's hourly email limit
 * among them, is logged by its status alone and dropped. A code check runs before the answer and
 * is retried once on a transport failure too; a wrong or expired code is the one refusal told
 * apart, and anything else is thrown, for the account function's plain retry-later. The email's
 * link is checked the same way, by its token hash, and the hash is never logged. A code request names
 * the page the link opens as Auth's `redirect_to`, which carries the caller's `next`; its log lines name
 * the endpoint alone, so neither reaches a log.
 */
import type { Auth, Session } from '../account/core.ts';

export function gotrue(options: { url: string; key: string; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> }): Auth {
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const call = (path: string, body: unknown, query = '') => send(`${options.url}/auth/v1/${path}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: options.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const afterward = async (path: string, body: unknown, query = '') => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await sleep(500);
      try {
        const response = await call(path, body, query);
        await response.body?.cancel();
        if (response.ok) return;
        if (response.status < 500) { console.error(`auth ${path} refused`, response.status); return; }
      } catch { /* no answer: once more */ }
    }
    console.error(`auth ${path} did not answer`);
  };
  /** A check of a code or a link: one retry on a transport failure, one refusal told apart, the rest thrown. */
  async function check<R extends 'code' | 'link'>(body: Record<string, string>, refusal: R): Promise<{ session: Session } | { refused: R | 'barred' }> {
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await sleep(250);
      try {
        response = await call('verify', body);
        if (response.status < 500) break;
        await response.body?.cancel();
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    if (!response || response.status >= 500) throw new Error(`auth ${refusal} check answered ${response?.status ?? 'nothing'}`);
    const answer = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { session: answer as never };
    // Older Auth answers a ban in the OAuth style (invalid_grant, described as banned): it is the ban, so it is checked before invalid_grant is taken for a wrong code.
    if ((response.status === 400 || response.status === 403) && answer.error === 'invalid_grant' && /banned/i.test(String(answer.error_description ?? answer.msg ?? ''))) return { refused: 'barred' };
    // A suspended or banned login carries Auth's ban (mail/core.ts); Auth refuses it after a correct code, which proves nothing to anyone who does not hold the address.
    if ((response.status === 400 || response.status === 403) && answer.error_code === 'user_banned') return { refused: 'barred' };
    // A wrong token and one for an address with no login are one refusal to Auth too.
    if ((response.status === 400 || response.status === 403)
        && (answer.error_code === 'otp_expired' || answer.error_code === 'otp_invalid' || answer.error === 'invalid_grant')) return { refused: refusal };
    throw new Error(`auth ${refusal} check answered ${response.status} ${String(answer.error_code ?? answer.error ?? '')}`);
  }
  return {
    requestCode: (email, o) => afterward('otp', { email, create_user: o.create, data: { invite: o.invite, ...(o.conduct === undefined ? {} : { conduct: o.conduct }) } }, `?redirect_to=${encodeURIComponent(o.redirect)}`),
    verifyCode: (email, code) => check({ type: 'email', email, token: code }, 'code'),
    verifyLink: (tokenHash) => check({ type: 'email', token_hash: tokenHash }, 'link'),
  };
}
