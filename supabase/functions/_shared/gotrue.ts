/**
 * Supabase Auth, as the account function uses it (supabase/functions/account/core.ts): its own
 * sign-up, password sign-in and recovery endpoints, called with the project's public key, as a
 * browser would call them. Auth sends the confirmation and reset emails itself.
 *
 * A sign-up and a recovery run after the account function has answered, so nothing they meet
 * can reach that answer: a transport failure (no answer, a 5xx, a 429) is retried once, and any
 * refusal, an address already signed up among them, is logged by its status alone and dropped.
 * A sign-in runs before the answer, and only its two refusals a player can act on are told
 * apart; anything else is thrown, for the account function's plain retry-later.
 */
import type { Auth } from '../account/core.ts';

export function gotrue(options: { url: string; key: string; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> }): Auth {
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const call = (path: string, body: unknown) => send(`${options.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: options.key, Authorization: `Bearer ${options.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const afterward = async (path: string, body: unknown) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await sleep(500);
      try {
        const response = await call(path, body);
        await response.body?.cancel();
        if (response.ok) return;
        if (response.status < 500 && response.status !== 429) { console.error(`auth ${path} refused`, response.status); return; }
      } catch { /* no answer: once more */ }
    }
    console.error(`auth ${path} did not answer`);
  };
  return {
    signUp: (email, password, data) => afterward('signup', { email, password, data }),
    recover: (email) => afterward('recover', { email }),
    async signIn(email, password) {
      const response = await call('token?grant_type=password', { email, password });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) return { session: body as never };
      if (response.status === 400 && body.error_code === 'email_not_confirmed') return { refused: 'unconfirmed' };
      if (response.status === 400) return { refused: 'credentials' };
      throw new Error(`auth sign-in answered ${response.status}`);
    },
  };
}
