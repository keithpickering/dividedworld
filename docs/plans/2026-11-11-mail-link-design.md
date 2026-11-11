# The email's link signs in: design

Record, written 2026-11-11. Designed with the owner in a design session. The plan that carries it out is
`docs/plans/2026-11-11-mail-link-plan.md`.

## 1. What was wrong

The two Auth emails (`supabase/templates/sign-in.html`, `supabase/templates/sign-up.html`) carry a code and a button.
The code works. The button does not: the owner pressed it in a real email and landed on the front page, signed out.

The root cause is two halves that were never joined:

- The button's `href` is Supabase's `{{ .ConfirmationURL }}` (`supabase/functions/_shared/mail/auth.ts`). That is
  Auth's own `/auth/v1/verify` address. Auth checks the token and redirects to `site_url` with the session on the
  redirect.
- The web app never reads that redirect. Its client is made with `detectSessionInUrl: false`
  (`web/src/data/supabase.ts`), and nothing under `web/src` or `engine/ui` reads a token from an address.

The comment at the top of `supabase/functions/account/core.ts` records the first intent: "A link from the email signs in
through Auth itself, and the client then calls open_account() as this does." That was never built.

## 2. What was decided

### 2.1 The link carries the token hash, in the fragment

The button goes to the instance's own site: `<site>/sign-in#token_hash={{ .TokenHash }}` in the sign-in email and
`<site>/register#token_hash={{ .TokenHash }}` in the sign-up email, where `<site>` is the mail theme's `site`.

The `account` function gets a third action, `verifyLink`, which takes the hash, checks it with Auth and then opens the
account exactly as `verifyCode` does.

Alternatives weighed:

- **The address and the six-digit code in the fragment**, reusing `verifyCode` unchanged. Refused: the player's address
  would sit in the URL, and so in browser history and whatever syncs it.
- **Auth's own link, with the app picking the session up from the redirect** (the first intent). Refused for two
  reasons. A mail scanner that follows the link spends the token before the player presses it. And sign-in would stop
  going through the `account` function, which is what holds every answer and its timing the same for every address.

What the choice gives:

- No address in any URL.
- A fragment is never sent to a server, so the hash reaches no host's log and no referrer.
- Loading the page spends nothing. Only a call to the `account` function does.

The code and the link are one token to Auth. Using either spends both.

### 2.2 The page asks for one press

Opened with a token hash, the page shows a panel with one button, and the token is spent only on the press.

Alternatives weighed:

- **Sign in at once on load.** Refused: some scanners (Outlook's Safe Links, corporate gateways) open a link in a
  browser that runs scripts, and would spend the token, and the emailed code with it.
- **Sign in at once, and show the button only when something looks off.** Refused: the same exposure, and two paths to
  build and test.

The panel is also where an expired link and a browser that is already signed in have something to say.

### 2.3 Any browser may use the link, and the page says which address it signed in

The link adds one risk the code does not have. A person can ask for a code to their own address and send someone else
the link. Whoever presses it is signed in to the sender's account, and any character they then make there is the
sender's to see. In a game of masks among people who know each other, that is a way to unmask someone.

So after the press the page says "You are signed in as name@example.com", with "Continue" and "Not you? Sign out",
before it moves on.

Alternatives weighed:

- **Only the browser that asked for the code** (a marker left at the request, the way PKCE works). It closes the prank
  fully. Refused: it breaks the link whenever mail opens somewhere else, which is a large share of real use (Gmail's
  and Outlook's in-app browsers on a phone; a code asked for on a desktop and read on a phone).
- **Any browser, no notice.** Refused: it leaves the prank open.

The notice shows only after a sign-in by link. A player who typed the code typed their own address first.

## 3. The page's states, and each one's way out

The panel stands where the form stands on `/sign-in` and `/register`, on the glass, in the Settings board's parts like
the rest of the screen. Its words are plain and never in character. The hash is taken out of the address bar when the
page arrives and is held in memory only.

| State | What the page says | Way out |
|---|---|---|
| Ready | A lead sentence and one button: "Sign in" on `/sign-in`, "Finish signing up" on `/register` | The press; or "Use a code instead", which shows the ordinary form |
| Already signed in | "This browser is signed in as a@b. Using the link signs that account out." | "Sign in with the link", or "Stay signed in", which goes on as that account |
| Refused | "That link does not work, or it has expired: ask for a new code", with the ordinary form under it | The form: ask for a new code |
| No answer | The screen's existing lost-answer sentence | "Try again". If the token was spent by the lost request, the next try is refused and leads to the form |
| Signed in | "You are signed in as a@b." | "Continue", or "Not you? Sign out" |
| Signed in, account not open | The existing `OpenAccount` panel with its reason | As today: another invite, or an admin opening registration |

None of these is a state of a character or a post, and none outlives the page.

## 4. The masks

- `verifyLink`'s answer is computed from the token alone. It is given before the session, so the function knows no
  caller.
- A hash that fails is one sentence whatever the reason (never issued, spent, expired, malformed).
- The answer is held to the same floor as every other `account` answer (`ANSWER_FLOOR_MS`).
- The only address the page shows is the session's own, to the browser that holds that session.
- The link names no address and no account.

## 5. The layers

Everything is engine: the `account` action, the Auth adapter's method, the `KayfaApi` method, the screen and the mail's
words. The composition root (`supabase/functions/_shared/mail/auth.ts`) builds the link from the deployed instance's
mail theme, as it already builds the emails. The instance changes only through its two regenerated templates. No
interface is added.

## 6. What the owner does after the build

The dashboard holds the templates (`README.md`, step 4.4; `supabase config push` is still not to be run). After the
build's PR merges, the two regenerated files are pasted into **Authentication > Emails > Templates** again.

## 7. Open

- Whether the deployed Auth accepts a token hash of type `email` for both a first sign-up and a returning sign-in.
  Current Auth documents it so. No test here can show it; the owner's first real email of each kind does.
- Whether Auth's template engine alters `{{ .TokenHash }}` when it stands inside an `href`'s fragment. The hash is
  hexadecimal, with a `pkce_` prefix on some flows, so no escaping should change it. The same first email shows it.
