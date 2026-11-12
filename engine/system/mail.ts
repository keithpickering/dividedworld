/**
 * The provider-neutral way to send an email ("Portable by construction"): the engine and the
 * functions know this interface, and one adapter at the edge (supabase/functions/_shared/mail/resend.ts)
 * speaks to a provider. No vendor import here. The words are the engine's moderation templates
 * (engine/mail/conduct.ts), re-exported so a caller finds them beside the interface.
 */
export { CONDUCT_TEMPLATES, TEMPLATES, renderMail } from '../mail/conduct.ts';
export type { ConductTemplate, ConductMailOverride, ConductWords } from '../mail/conduct.ts';

export interface MailMessage {
  readonly to: string;
  /** Where a reply goes, so an appeal reaches a person; null sends none. */
  readonly replyTo: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The same key sent twice makes one email: the provider dedupes on it. */
  readonly idempotencyKey: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}
