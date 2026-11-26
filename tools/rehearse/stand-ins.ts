// What the rehearsal hands the mail job in place of what it reaches outside the database (the JobDeps `mailer` and `authAdmin`):
// a Mailer that records and never sends (no network, no Resend) and an Auth admin that records the bans it is asked for and
// answers every account a stand-in address. The real mail handler (supabase/functions/mail/handler.ts) runs against them, so
// the same jobs-key check, the same SQL (mail_due, record_mail_attempt), the same render and the same reply-to run as deployed.
// What they recorded is in `recorded`, for the tests (the report reads the dispatcher's answers, never these).
import type { AuthAdmin } from "../../supabase/functions/mail/core.ts";
import type { JobDeps } from "../../supabase/functions/_shared/handler.ts";
import type { MailMessage } from "../../engine/system/mail.ts";

/** The address every account has in a rehearsal; nothing is ever sent to it. */
export const standInAddress = (account: string): string => `${account}@rehearsal.invalid`;

export interface MailRecord {
  sent: { to: string; replyTo: string | null; subject: string; idempotencyKey: string }[];
  bans: { account: string; action: "ban" | "clear"; until?: string | null }[];
}

export function recordingMail(): { recorded: MailRecord; mailer: JobDeps["mailer"]; authAdmin: JobDeps["authAdmin"] } {
  const recorded: MailRecord = { sent: [], bans: [] };
  const admin: AuthAdmin & { address(account: string): Promise<string | null> } = {
    setBan: async (account, until) => { recorded.bans.push({ account, action: "ban", until }); },
    clearBan: async (account) => { recorded.bans.push({ account, action: "clear" }); },
    address: async (account) => standInAddress(account),
  };
  return {
    recorded,
    mailer: () => ({
      send: async (m: MailMessage) => {
        recorded.sent.push({ to: m.to, replyTo: m.replyTo, subject: m.subject, idempotencyKey: m.idempotencyKey });
        return { id: `rehearsal-${m.idempotencyKey}` };
      },
    }),
    authAdmin: () => admin,
  };
}
