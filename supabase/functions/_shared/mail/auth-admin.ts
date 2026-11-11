/**
 * Supabase Auth's admin API, over plain fetch with the secret key (no vendor client: "Portable by
 * construction"): bar a login (`ban_duration`), lift the bar, and read an account's address.
 * `ban_duration` is a Go duration; `none` clears it. The key rides in `apikey` only and is never
 * put in an error. Task 2's SQL bar holds whatever Auth does, so a token issued before the ban is
 * still refused by the database.
 */
export interface AuthAdminOptions {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

/** Whole minutes from `now` to `until`, rounded up (so Auth never stays barred past `until` by more than a minute); indefinite is about a hundred years; an end already past is null. */
export function banDuration(until: string | null, now: number): string | null {
  if (until === null) return '876000h';
  const minutes = Math.ceil((Date.parse(until) - now) / 60_000);
  return minutes >= 1 ? `${minutes}m` : null;
}

export function authAdmin(options: AuthAdminOptions) {
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const endpoint = (account: string) => `${options.url}/auth/v1/admin/users/${encodeURIComponent(account)}`;
  const headers = { 'Content-Type': 'application/json', apikey: options.key };
  async function put(account: string, duration: string): Promise<void> {
    const response = await send(endpoint(account), { method: 'PUT', headers, body: JSON.stringify({ ban_duration: duration }), signal: AbortSignal.timeout(15_000) });
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new Error(`the Auth admin API refused the ban change: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  return {
    async setBan(account: string, until: string | null): Promise<void> {
      const duration = banDuration(until, now());
      if (duration !== null) await put(account, duration);
    },
    async clearBan(account: string): Promise<void> { await put(account, 'none'); },
    /** The account's address, or null where there is none (or no such user). */
    async address(account: string): Promise<string | null> {
      const response = await send(endpoint(account), { headers, signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`the Auth admin API refused the address read: HTTP ${response.status}`);
      const email = ((await response.json().catch(() => ({}))) as { email?: unknown }).email;
      return typeof email === 'string' && email !== '' ? email : null;
    },
  };
}
