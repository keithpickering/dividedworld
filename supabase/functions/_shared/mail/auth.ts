/**
 * The composition root's two Auth emails: the engine's words in the deployed instance's theme,
 * with Supabase's own placeholders as the code and the link. `supabase/templates/*.html` are this
 * function's output, committed; config.toml points Auth at them.
 */
import { signIn, signUp } from '../../../../engine/mail/auth.ts';
import { renderHtml } from '../../../../engine/mail/render.ts';
import { mailTheme } from '../instance.ts';

const CODE = '{{ .Token }}';
const LINK = '{{ .ConfirmationURL }}';

export function authTemplates(): { path: string; html: string }[] {
  const parts = { code: CODE, link: LINK };
  const options = { slots: [CODE, LINK] };
  return [
    { path: 'supabase/templates/sign-in.html', html: renderHtml(mailTheme, signIn(mailTheme, parts), options) },
    { path: 'supabase/templates/sign-up.html', html: renderHtml(mailTheme, signUp(mailTheme, parts), options) },
  ];
}
