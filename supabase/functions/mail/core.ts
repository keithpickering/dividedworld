/**
 * The mail sender, as a pure module: read the outbox rows that are due, apply a decision's Auth ban,
 * render each mail, send it, and write the attempt. supabase/functions/mail/index.ts is the thin Edge
 * Function around it; this file is what Node tests (core.test.ts) and Deno both run.
 *
 * An attempt is `sent`, `refused` or `failed`. A refusal is final: the provider (or the account's
 * lack of an address) said no about this mail, so it is recorded as `refused` and the row is never due again. A
 * transport failure that outlasted the mailer's own retries, or an Auth failure, is `failed`, and
 * the database lists the row again after a backoff of 2^n minutes for n failures, at most a day
 * (mail_due). Delivery is at-least-once,
 * guarded by the Idempotency-Key `kayfabb-mail-<id>` on every send. Resend dedupes a key for 24 hours, so a
 * send whose answer was lost is never two emails within that window; a database outage longer than 24 hours
 * between Resend's answer and the `sent` attempt row could send the mail twice. One row failing never stops the rest.
 *
 * A suspension or ban sets the login's ban through Supabase Auth's admin API, a lift clears it,
 * before the mail is sent, so the ban holds even where the mail fails. Task 2's SQL bar holds
 * whatever Auth does. An Auth failure is a `failed` attempt, and the mail waits for it. The `bar` a
 * row carries is the account's current bar (mail_due reads it, never the row's own decision), so an
 * old failed suspension applied after a lift clears the login instead of banning it again.
 *
 * With no admin address set (`replyTo` null) nothing is sent or recorded: an appeal email with
 * nowhere to reply is worse than a late one, and the rows stay due.
 *
 * No vendor client is imported ("Portable by construction"): the database, the mailer and Auth are
 * interfaces the edge supplies.
 */
import type { ConductTemplate } from '../../../engine/mail/conduct.ts';
import type { Mailer } from '../../../engine/system/mail.ts';
import { ProviderRefusal } from '../_shared/models/transport.ts';

export type { ConductTemplate };

/** How an attempt ended: the mail went, the provider refused it for good, or something failed that may pass. */
export type AttemptKind = 'sent' | 'refused' | 'failed';

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
  /** At most `most` rows with no sent or refused attempt and no failed one still backing off, oldest first. */
  due(most: number): Promise<readonly MailRow[]>;
  /** The account's address from auth.users, or null. */
  address(account: string): Promise<string | null>;
  attempt(a: { outbox: number; kind: AttemptKind; providerId?: string | null; error?: string | null }): Promise<void>;
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
  | { readonly status: 'done'; readonly due: number; readonly sent: number; readonly refused: number; readonly failed: number };

const words = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runMail(deps: MailDeps): Promise<MailOutcome> {
  if (deps.replyTo === null) return { status: 'waiting for the admin address', reason: 'Settings.conduct.adminAddress is not set, so mail waits for it' };
  const now = deps.now ?? Date.now;
  const rows = await deps.db.due(deps.most);
  let sent = 0;
  let refused = 0;
  let failed = 0;
  for (const row of rows) {
    const fail = async (kind: 'refused' | 'failed', error: string) => {
      if (kind === 'refused') refused++; else failed++;
      await deps.db.attempt({ outbox: row.id, kind, providerId: null, error });
    };
    if (row.bar !== undefined) {
      try {
        if (row.bar.outcome === 'lift') await deps.auth.clearBan(row.account);
        else if (row.bar.outcome === 'ban' || row.bar.until === null) await deps.auth.setBan(row.account, null);
        else if (Date.parse(row.bar.until) > now()) await deps.auth.setBan(row.account, row.bar.until);
      } catch (e) {
        await fail('failed', `auth: ${words(e)}`);
        continue;
      }
    }
    const to = await deps.db.address(row.account);
    if (to === null) { await fail('refused', 'no address'); continue; }
    let mail: { subject: string; text: string; html: string };
    try {
      mail = deps.render(row);
    } catch (e) {
      // A render error is about this row's facts and the same every time: final, not retried.
      await fail('refused', `render: ${words(e)}`);
      continue;
    }
    let id: string;
    try {
      ({ id } = await deps.mailer.send({ to, replyTo: deps.replyTo, ...mail, idempotencyKey: `kayfabb-mail-${row.id}` }));
    } catch (e) {
      // A 401 or a 403 is the key, which the owner can fix: it fails and is retried, where any other refusal is about this mail and final.
      await fail(e instanceof ProviderRefusal && e.status !== 401 && e.status !== 403 ? 'refused' : 'failed', words(e));
      continue;
    }
    // A database error here is thrown: the send is repeated next run under the same key, which the provider dedupes.
    sent++;
    await deps.db.attempt({ outbox: row.id, kind: 'sent', providerId: id, error: null });
  }
  return { status: 'done', due: rows.length, sent, refused, failed };
}
