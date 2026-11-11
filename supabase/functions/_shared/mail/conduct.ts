/**
 * The composition root's moderation email: one outbox row, rendered for the deployed instance. The
 * engine's template (engine/mail/conduct.ts, with the instance's word overrides from its code of
 * conduct) becomes a `Mail`, which the shell draws as HTML with the instance's theme and as text.
 */
import { renderMail } from '../../../../engine/mail/conduct.ts';
import type { ConductTemplate } from '../../../../engine/mail/conduct.ts';
import { renderHtml, renderText } from '../../../../engine/mail/render.ts';
import { conduct, mailTheme } from '../instance.ts';

export function renderOutboxRow(row: { readonly template: ConductTemplate; readonly facts: Readonly<Record<string, unknown>> }): { subject: string; text: string; html: string } {
  const mail = renderMail(row.template, row.facts, { override: conduct.mail });
  return { subject: mail.subject, text: renderText(mail), html: renderHtml(mailTheme, mail) };
}
