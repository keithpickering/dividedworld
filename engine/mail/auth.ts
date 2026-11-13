/**
 * The two Auth emails (sign in, finish signing up) as typed blocks. The words are plain and never
 * in character ("The fiction may lie; the log never does"). The caller supplies the code and the
 * link; for Supabase they are its own placeholders, declared as slots when the Mail is rendered.
 * Nothing here names an instance: the theme carries the name.
 */
import type { Mail, MailTheme } from './types.ts';

export interface AuthParts {
  readonly code: string;
  readonly link: string;
}

function authMail(theme: MailTheme, p: AuthParts, w: { kind: string; heading: string; end: string; button: string; note: string }): Mail {
  return {
    subject: `Your ${theme.name} ${w.kind} code`,
    preheader: `Your code is ${p.code}.`,
    blocks: [
      { type: 'heading', text: `${w.heading} ${theme.name}` },
      { type: 'paragraph', text: `Type this code where you asked for it, or use the button: it opens ${theme.name}, where one more press ${w.end}.` },
      { type: 'code', label: 'Your code', code: p.code },
      { type: 'button', label: w.button, href: p.link },
      { type: 'note', text: w.note },
    ],
  };
}

export function signIn(theme: MailTheme, p: AuthParts): Mail {
  return authMail(theme, p, {
    kind: 'sign-in',
    heading: 'Sign in to',
    end: 'signs you in',
    button: 'Sign in',
    note: 'If you did not ask to sign in, you can ignore this email: nobody can sign in without the code or the link.',
  });
}

export function signUp(theme: MailTheme, p: AuthParts): Mail {
  return authMail(theme, p, {
    kind: 'sign-up',
    heading: 'Finish signing up for',
    end: 'finishes signing you up',
    button: 'Finish signing up',
    note: 'If you did not ask to sign up, you can ignore this email: nothing is made without the code or the link.',
  });
}
