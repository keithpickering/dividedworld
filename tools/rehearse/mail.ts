// The rehearsal's `mail` function: the real mail core (supabase/functions/mail/core.ts, runMail) against the rehearsal's database, with
// a Mailer that records and never sends (no network, no Resend) and an Auth admin that records the bans it is asked for. The deployed
// function (supabase/functions/mail/index.ts) is a Deno.serve file the dispatcher cannot import, so this is its Node twin: the same
// jobs-key check, the same SQL (mail_due, record_mail_attempt), the same render, the same reply-to from Settings.conduct.adminAddress
// (null means mail waits, which runMail answers). What it recorded is in the answer's body, so the run's dispatched list shows it plainly.
import { runMail, type AuthAdmin, type MailDb, type MailRow } from "../../supabase/functions/mail/core.ts";
import { chooseInstance } from "../../supabase/functions/_shared/instance.ts";
import { renderOutboxRow } from "../../supabase/functions/_shared/mail/conduct.ts";
import { environment, fromTheService, json, notTheService } from "../../supabase/functions/_shared/serve.ts";
import { withDatabaseSettings } from "../../supabase/functions/_shared/settings.ts";
import type { JobDeps } from "../../supabase/functions/_shared/handler.ts";
import type { MailMessage } from "../../engine/system/mail.ts";

/** The most rows one run sends, as in the deployed function. */
const MOST = 20;
/** The address every account has in a rehearsal; nothing is ever sent to it. */
export const standInAddress = (account: string): string => `${account}@rehearsal.invalid`;

export async function handle(request: Request, deps: JobDeps): Promise<Response> {
  const env = environment(deps.env);
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, "the mail is sent by the service");
  try {
    const db = deps.db(env);
    const sent: { to: string; replyTo: string | null; subject: string; idempotencyKey: string }[] = [];
    const bans: { account: string; action: "ban" | "clear"; until?: string | null }[] = [];
    const mailDb: MailDb = {
      due: (most) => db.rpc<MailRow[]>("mail_due", { most }),
      address: async (account) => standInAddress(account),
      attempt: async (a) => { await db.rpc("record_mail_attempt", { outbox: a.outbox, kind: a.kind, provider_id: a.providerId ?? null, error: a.error ?? null }); },
    };
    const auth: AuthAdmin = {
      setBan: async (account, until) => { bans.push({ account, action: "ban", until }); },
      clearBan: async (account) => { bans.push({ account, action: "clear" }); },
    };
    const mailer = {
      send: async (m: MailMessage) => {
        sent.push({ to: m.to, replyTo: m.replyTo, subject: m.subject, idempotencyKey: m.idempotencyKey });
        return { id: `rehearsal-${m.idempotencyKey}` };
      },
    };
    const settings = (await withDatabaseSettings(chooseInstance(deps.env("KAYFABB_PROFILE")), db)).settings;
    const outcome = await runMail({ db: mailDb, mailer, auth, render: renderOutboxRow, replyTo: settings.conduct.adminAddress, most: MOST });
    return json(200, { ...outcome, recorded: { sent, bans } });
  } catch (e) {
    console.error("mail failed", e instanceof Error ? e.message : "unknown");
    return json(500, { error: "the mail run failed; due mail stays due for the next run" });
  }
}
