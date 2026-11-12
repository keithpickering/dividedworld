/**
 * The mail sender's Edge Function: pg_cron calls it every minute (the job `kayfabb-mail`) with the
 * jobs key (the secret key named kayfabb_jobs, in apikey). The work is core.ts; this is the edge:
 * the environment, the Resend mailer (RESEND_API_KEY and MAIL_FROM, read from `Deno.env` by the
 * adapter and never logged), Supabase Auth's admin API, and an answer that says what happened.
 *
 * The database side is the SQL functions `mail_due(most)` (outbox rows with no sent or refused attempt and no failed one
 * still backing off, each with the account's current bar, if it has a bar template) and `record_mail_attempt(outbox, kind, provider_id, error)`; an
 * account's address is read from Auth's admin API, never from a table this function can name.
 */
import { runMail } from './core.ts';
import type { MailDb, MailRow } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { renderOutboxRow } from '../_shared/mail/conduct.ts';
import { authAdmin } from '../_shared/mail/auth-admin.ts';
import { resendMailer } from '../_shared/mail/resend.ts';
import { environment, fromTheService, json, notTheService, serviceDb } from '../_shared/serve.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

/** The most rows one run sends; the rest wait a minute. */
const MOST = 20;

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the mail is sent by the service');
  try {
    const db = serviceDb(env);
    const admin = authAdmin({ url: env.url, key: env.secret });
    const mailDb: MailDb = {
      due: (most) => db.rpc<MailRow[]>('mail_due', { most }),
      address: (account) => admin.address(account),
      attempt: async (a) => { await db.rpc('record_mail_attempt', { outbox: a.outbox, kind: a.kind, provider_id: a.providerId ?? null, error: a.error ?? null }); },
    };
    const settings = (await withDatabaseSettings(chooseInstance(Deno.env.get('KAYFABB_PROFILE')), db)).settings;
    const replyTo = settings.conduct.adminAddress;
    // Nothing is built, and no key is needed, while there is no address to reply to.
    if (replyTo === null) return json(200, await runMail({ db: mailDb, mailer: { send: () => Promise.reject(new Error('unreachable')) }, auth: admin, render: renderOutboxRow, replyTo, most: MOST }));
    return json(200, await runMail({ db: mailDb, mailer: resendMailer({ env: (name) => Deno.env.get(name) }), auth: admin, render: renderOutboxRow, replyTo, most: MOST }));
  } catch (e) {
    // The details go to the function's log (no key is ever in an error); the answer says only that it failed. Rows stay due for the next run.
    console.error('mail failed', e);
    return json(500, { error: 'the mail run failed; due mail stays due for the next run' });
  }
});
