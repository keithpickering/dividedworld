/**
 * The Mailer over Resend (engine/system/mail.ts): one `fetch` to its send endpoint, no vendor
 * client ("Portable by construction").
 *
 * "Three unrelated timeouts are not a poison pill": a 5xx, a 429 or no answer is a
 * `TransportFailure` and is retried on the request itself, waiting longer each time, at most
 * three times, as models/index.ts does; any other refusal is a `ProviderRefusal` carrying its
 * status and Resend's message, thrown at once for the caller to record. A retry repeats the same
 * Idempotency-Key, so a send whose answer was lost is never two emails.
 *
 * The key (RESEND_API_KEY) and the from address (MAIL_FROM) come through `env`, an accessor
 * passed in. The key rides in a header only: it is never put in an error or a log line, and a
 * missing one names the variable, never a value.
 */
import type { Mailer } from '../../../../engine/system/mail.ts';
import { postJson, TransportFailure } from '../models/transport.ts';

export const RESEND_URL = 'https://api.resend.com/emails';
/** At most this many retries after the first attempt. */
export const MAX_RETRIES = 3;

export interface ResendOptions {
  readonly env: (name: string) => string | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}

export function resendMailer(options: ResendOptions): Mailer {
  const key = options.env('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY is not set: mail cannot be sent');
  const from = options.env('MAIL_FROM');
  if (!from) throw new Error('MAIL_FROM is not set: mail has no from address');
  const wire = { fetch: options.fetch ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 15_000, now: () => Date.now() };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async send(m) {
      const body = { from, to: m.to, ...(m.replyTo === null ? {} : { reply_to: m.replyTo }), subject: m.subject, text: m.text, html: m.html };
      const headers = { Authorization: `Bearer ${key}`, 'Idempotency-Key': m.idempotencyKey };
      for (let attempt = 0; ; attempt++) {
        try {
          const answer = await postJson(RESEND_URL, headers, body, wire);
          const id = (answer as { id?: unknown } | null)?.id;
          if (typeof id !== 'string' || id === '') throw new TransportFailure('an answer with no id');
          return { id };
        } catch (e) {
          if (!(e instanceof TransportFailure) || attempt >= MAX_RETRIES) throw e;
          await sleep(500 * 2 ** attempt);
        }
      }
    },
  };
}
