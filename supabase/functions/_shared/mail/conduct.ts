/**
 * The composition root's moderation email: one outbox row, rendered for the deployed instance. The
 * engine's template (engine/mail/conduct.ts, with the instance's word overrides from its code of
 * conduct) becomes a `Mail`, which the shell draws as HTML with the instance's theme and as text.
 */
import { renderMail } from '../../../../engine/mail/conduct.ts';
import type { ConductTemplate } from '../../../../engine/mail/conduct.ts';
import { renderHtml, renderText } from '../../../../engine/mail/render.ts';
import { conduct, mailTheme } from '../instance.ts';

/**
 * The outbox's facts as the template reads them (supabase/migrations/0160_conduct_mail.sql): the database writes `post`, `thread` and `conduct` as paths
 * on the site and `section` as the section's key, since it knows neither the site's address nor the instance's words; here the paths become addresses
 * and the key becomes the section's title from the instance's code of conduct (a key the code no longer holds stays as written).
 */
function resolved(facts: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...facts };
  for (const slot of ['post', 'thread', 'conduct']) {
    const v = out[slot];
    if (typeof v === 'string' && v.startsWith('/')) out[slot] = `${mailTheme.site}${v}`;
  }
  const key = out.section;
  if (typeof key === 'string') out.section = conduct.sections.find((c) => c.key === key)?.title ?? key;
  return out;
}

/** Sent straight to the provider, never through Go's templates, so an author's `{{` is only text (`goTemplate: false`). */
export function renderOutboxRow(row: { readonly template: ConductTemplate; readonly facts: Readonly<Record<string, unknown>> }): { subject: string; text: string; html: string } {
  const mail = renderMail(row.template, resolved(row.facts), { override: conduct.mail });
  return { subject: mail.subject, text: renderText(mail), html: renderHtml(mailTheme, mail, { goTemplate: false }) };
}
