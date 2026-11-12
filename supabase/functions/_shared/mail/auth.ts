/**
 * The composition root's two Auth emails: the engine's words in the deployed instance's theme,
 * with Supabase's own placeholders as the code and the link: the request's redirect (the instance's page, with the
 * player's `next` on its query) and the token's hash in the fragment, which no server sees. `supabase/templates/*.html` are this
 * function's output, committed; config.toml points Auth at them.
 */
import { signIn, signUp } from '../../../../engine/mail/auth.ts';
import { renderHtml } from '../../../../engine/mail/render.ts';
import { mailTheme } from '../instance.ts';

const CODE = '{{ .Token }}';
const REDIRECT = '{{ .RedirectTo }}';
const HASH = '{{ .TokenHash }}';
const LINK = `${REDIRECT}#token_hash=${HASH}`;

export function authTemplates(): { path: string; html: string }[] {
  const parts = { code: CODE, link: LINK };
  const options = { slots: [CODE, REDIRECT, HASH] };
  return [
    { path: 'supabase/templates/sign-in.html', html: renderHtml(mailTheme, signIn(mailTheme, parts), options) },
    { path: 'supabase/templates/sign-up.html', html: renderHtml(mailTheme, signUp(mailTheme, parts), options) },
  ];
}
