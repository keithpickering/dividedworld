/**
 * The mail sender, as a pure module: read the outbox rows that are due, apply a decision's Auth ban,
 * render each mail, send it, and write the attempt. supabase/functions/mail/index.ts is the thin Edge
 * Function around it; this file is what Node tests (core.test.ts) and Deno both run.
 *
 * Mail is sent when an `ok` attempt exists: the database lists a row as due until one does
 * (mail_due), so a refusal or a transport failure that outlasted the mailer's own retries is
 * recorded as an attempt with `ok` false and the row is tried again next run. A send whose answer
 * was lost is never two emails: every send carries the key `kayfabb-mail-<id>`, which the provider
 * dedupes. One row failing never stops the rest.
 *
 * A suspension or ban sets the login's ban through Supabase Auth's admin API, a lift clears it,
 * before the mail is sent, so the ban holds even where the mail fails. Task 2's SQL bar holds
 * whatever Auth does. An Auth failure is an attempt with `ok` false, and the mail waits for it.
 *
 * With no admin address set (`replyTo` null) nothing is sent or recorded: an appeal email with
 * nowhere to reply is worse than a late one, and the rows stay due.
 *
 * No vendor client is imported ("Portable by construction"): the database, the mailer and Auth are
 * interfaces the edge supplies.
 */
import type { ConductTemplate } from '../../../engine/mail/conduct.ts';
import type { Mailer } from '../../../engine/system/mail.ts';

export type { ConductTemplate };

/** One outbox row that is due (what the SQL `mail_due(most)` returns). */
export interface MailRow {
  readonly id: number;
  readonly account: string;
  readonly template: ConductTemplate;
  readonly facts: Readonly<Record<string, unknown>>;
  /** The decision's effect on the login, where it has one. */
  readonly bar?: { readonly outcome: 'suspend' | 'ban' | 'lift'; readonly until: string | null };
}

export interface MailDb {
  /** At most `most` rows with no `ok` attempt, oldest first. */
  due(most: number): Promise<readonly MailRow[]>;
  /** The account's address from auth.users, or null. */
  address(account: string): Promise<string | null>;
  attempt(a: { outbox: number; ok: boolean; providerId?: string | null; error?: string | null }): Promise<void>;
}

export interface AuthAdmin {
  /** Bars the login until `until` (an ISO time), or indefinitely when null. */
  setBan(account: string, until: string | null): Promise<void>;
  clearBan(account: string): Promise<void>;
}

export interface MailDeps {
  readonly db: MailDb;
  readonly mailer: Mailer;
  readonly auth: AuthAdmin;
  readonly render: (row: MailRow) => { subject: string; text: string; html: string };
  /** The instance's admin address (Settings.conduct.adminAddress); null until the owner sets it. */
  readonly replyTo: string | null;
  readonly most: number;
  readonly now?: () => number;
}

export type MailOutcome =
  | { readonly status: 'waiting for the admin address'; readonly reason: string }
  | { readonly status: 'done'; readonly due: number; readonly sent: number; readonly failed: number };

const words = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runMail(deps: MailDeps): Promise<MailOutcome> {
  if (deps.replyTo === null) return { status: 'waiting for the admin address', reason: 'Settings.conduct.adminAddress is not set, so mail waits for it' };
  const now = deps.now ?? Date.now;
  const rows = await deps.db.due(deps.most);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const fail = async (error: string) => { failed++; await deps.db.attempt({ outbox: row.id, ok: false, providerId: null, error }); };
    if (row.bar !== undefined) {
      try {
        if (row.bar.outcome === 'lift') await deps.auth.clearBan(row.account);
        else if (row.bar.outcome === 'ban' || row.bar.until === null) await deps.auth.setBan(row.account, null);
        else if (Date.parse(row.bar.until) > now()) await deps.auth.setBan(row.account, row.bar.until);
      } catch (e) {
        await fail(`auth: ${words(e)}`);
        continue;
      }
    }
    const to = await deps.db.address(row.account);
    if (to === null) { await fail('no address'); continue; }
    let id: string;
    try {
      const mail = deps.render(row);
      ({ id } = await deps.mailer.send({ to, replyTo: deps.replyTo, ...mail, idempotencyKey: `kayfabb-mail-${row.id}` }));
    } catch (e) {
      await fail(words(e));
      continue;
    }
    // A database error here is thrown: the send is repeated next run under the same key, which the provider dedupes.
    sent++;
    await deps.db.attempt({ outbox: row.id, ok: true, providerId: id, error: null });
  }
  return { status: 'done', due: rows.length, sent, failed };
}
