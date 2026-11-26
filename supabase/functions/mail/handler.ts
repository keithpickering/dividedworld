/**
 * The mail sender's handler (index.ts serves it): pg_cron calls the Edge Function every minute (the job `kayfabb-mail`) with the
 * jobs key (the secret key named kayfabb_jobs, in apikey). The work is core.ts; this is the edge:
 * the environment, the Resend mailer (RESEND_API_KEY and MAIL_FROM, read through `deps.mailer(deps.env)`
 * and never logged), Supabase Auth's admin API, and an answer that says what happened. It reads nothing of Deno's: what it needs comes in as `deps` (_shared/handler.ts).
 *
 * The database side is the SQL functions `mail_due(most)` (outbox rows with no sent or refused attempt and no failed one
 * still backing off, each with the account's current bar, if it has a bar template) and `record_mail_attempt(outbox, kind, provider_id, error)`; an
 * account's address is read from Auth's admin API, never from a table this function can name.
 */
import { runMail } from './core.ts';
import type { MailDb, MailRow } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { renderOutboxRow } from '../_shared/mail/conduct.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { asJob } from '../_shared/job.ts';
import type { JobDeps } from '../_shared/handler.ts';

/** The most rows one run sends; the rest wait a minute. */
const MOST = 20;

export const handle = asJob('kayfabb-mail', async (request: Request, deps: JobDeps): Promise<Response> => {
  const env = environment(deps.env);
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the mail is sent by the service');
  try {
    const db = deps.db(env);
    const admin = deps.authAdmin({ url: env.url, key: env.secret });
    const mailDb: MailDb = {
      due: (most) => db.rpc<MailRow[]>('mail_due', { most }),
      address: (account) => admin.address(account),
      attempt: async (a) => { await db.rpc('record_mail_attempt', { outbox: a.outbox, kind: a.kind, provider_id: a.providerId ?? null, error: a.error ?? null }); },
    };
    const settings = (await withDatabaseSettings(chooseInstance(deps.env('KAYFABB_PROFILE')), db)).settings;
    const replyTo = settings.conduct.adminAddress;
    // Nothing is built, and no key is needed, while there is no address to reply to.
    if (replyTo === null) return json(200, await runMail({ db: mailDb, mailer: { send: () => Promise.reject(new Error('unreachable')) }, auth: admin, render: renderOutboxRow, replyTo, most: MOST }));
    return json(200, await runMail({ db: mailDb, mailer: deps.mailer(deps.env), auth: admin, render: renderOutboxRow, replyTo, most: MOST }));
  } catch (e) {
    // The details go to the function's log (no key is ever in an error); the answer says only that it failed. Rows stay due for the next run.
    console.error('mail failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the mail run failed; due mail stays due for the next run' });
  }
});
