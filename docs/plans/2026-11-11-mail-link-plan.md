# The email's link signs in: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-mail-link-design.md` (its sections are cited as §N), task
by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches SQL
or a deployed service. Pasting the regenerated templates into the dashboard is the owner's step (§6). Each task says
its layer.

## Task 1. The `account` function's `verifyLink` (engine)

Model: sonnet

**Layer:** engine. `supabase/functions/account/core.ts` stays pure; the Auth adapter is the edge.

**`supabase/functions/account/core.ts`:**
- `Auth` gains `verifyLink(tokenHash: string): Promise<{ session: Session } | { refused: 'link' }>`.
- `answer()` gains the case `verifyLink`:
  - It reads `r.tokenHash`: a string, trimmed, 16 to 256 characters of `[A-Za-z0-9_-]`. Anything else is refused with
    the same sentence as a hash Auth refuses, so a malformed hash and a spent one read alike.
  - It calls `deps.auth.verifyLink`. On `refused`, it answers
    `refused('link', 'that link does not work, or it has expired: ask for a new code')`.
  - On a session, it does what `verifyCode` does after its check: reads `user_metadata.invite`, calls `open_account`,
    and answers `{ session, account: true }` or `{ session, account: false, why }`. Lift that tail into one function,
    `opened(deps, session)`, that both cases call, so the two cannot drift.
- The `default` refusal names all three actions.
- `runAccount`'s 503 sentence for `verifyLink` is the sign-in one (`signing in is not working right now; try again`).
- The header comment's last sentence ("A link from the email signs in through Auth itself…") is rewritten to say what
  is true: the link opens the instance's own page with the token's hash, and that page calls `verifyLink`.

**`supabase/functions/_shared/gotrue.ts`:**
- `verifyLink(tokenHash)` posts `verify` with `{ type: 'email', token_hash: tokenHash }`. It shares `verifyCode`'s
  retry, its reading of the answer and its refusal test. Lift those into one `check(body, refusal)` that both use.
- The header comment names the link's check beside the code's.

**Tests first:**
- `supabase/functions/account/core.test.ts`:
  - A hash Auth accepts answers 200 with the session and `account: true`, and `open_account` was called with the
    login's invite.
  - A hash Auth accepts for a login whose invite was spent answers 200 with `account: false` and the same `why` as
    `verifyCode` gives for it.
  - A hash Auth refuses answers 400, field `link`, with the sentence above.
  - A malformed hash (empty, a number, 300 characters, one holding a space) answers the same 400 and never calls Auth.
  - Every one of those answers lands on a whole number of `ANSWER_FLOOR_MS`, by the fake clock the file already uses.
  - Auth throwing answers 503 with the sign-in sentence.
- `supabase/functions/_shared/gotrue.test.ts`:
  - `verifyLink` posts `{ type: 'email', token_hash }` to `/auth/v1/verify` with the public key.
  - A 403 `otp_expired` is `{ refused: 'link' }`. A 500 then a 200 is the session. Two 500s throw.

## Task 2. The API method (engine UI, web)

Model: sonnet

**Layer:** engine UI for the interface and the fake; `web/src/data/supabase.ts` is the edge.

- `engine/ui/data/api.ts`: `KayfaApi` gains
  `verifyLink(tokenHash: string): Promise<Answer<{ readonly account: boolean; readonly why?: string }>>`, documented
  beside `verifyCode`.
- `web/src/data/supabase.ts`: `verifyLink` calls `edge('account', { action: 'verifyLink', tokenHash }, NOT_DONE)` and
  then does what `verifyCode` does with the answer (`setSession`, `account`, `why`). Lift that tail into one local
  function both use. `detectSessionInUrl` stays `false`.
- `engine/ui/data/fake.ts`: a `TEST_LINK` constant beside `TEST_CODE`, and `verifyLink`:
  - `TEST_LINK` signs in the address of the last `requestCode`, through the same path as `verifyCode` (known account,
    `tryOpen`, or `account: false` with its `why`).
  - Any other hash, or `TEST_LINK` with no code asked for, is refused with the server's sentence.
- `web/src/data/fixtures/boards.ts` and `web/src/demo.ts`: wherever they list `verifyCode`, `verifyLink` beside it.

**Tests first:**
- `web/src/data/supabase.test.tsx`: `verifyLink` posts the action and the hash to the `account` function; a 200 sets
  the session and returns `account`; a 400 returns the refusal with its sentence and sets no session; a body with no
  session is `NOT_DONE`.
- The fake's own test file, beside its `verifyCode` cases: the three outcomes above.

## Task 3. The link panel on the sign-in screen (engine UI)

Model: sonnet

**Layer:** engine UI, on the glass (`docs/plans/2026-10-29-two-worlds-design.md`): the Settings board's parts, as the
rest of `engine/ui/account/SignIn.tsx`. Plain words, never in character.

**`engine/ui/account/link.ts`** (new, pure):
- `tokenHashOf(hash: string): string | null` reads `token_hash` from a fragment's text as a query
  (`new URLSearchParams(hash)`), and returns it only when it matches Task 1's shape.

**`engine/ui/account/SignIn.tsx`:**
- On mount, `tokenHashOf(useLocation().hash)` is kept in state, and the address is replaced with the same path and
  query and no fragment (`navigate(addressOf(location), { replace: true })`), so the hash is in no history entry.
- While a link is held and not set aside, `LinkPanel` renders where the form renders, and the screen's
  `useEffect` that moves on when `session.account` is set does not run. The aside ("Other ways in") stays.
- `LinkPanel` (in the same file or `engine/ui/account/LinkPanel.tsx`) holds the states of §3:
  - **Ready** (`session.signedIn` false): lead "This link signs you in. It works once." (on `/register`: "This link
    finishes signing you up. It works once."), a primary button "Sign in" or "Finish signing up", and "Use a code
    instead", which sets the link aside and shows the form.
  - **Already signed in** (`session.signedIn` true before any press): `api.signInAddress()` is read, and the panel says
    "This browser is signed in as {address}. Using the link signs that account out." with "Sign in with the link"
    (primary) and "Stay signed in" (sets the link aside; the screen's existing effect then moves on).
  - **The press** calls `api.verifyLink(hash)`, with the buttons busy.
  - **Refused**: the link is set aside, and the form shows with the server's sentence in its `role="alert"`
    paragraph, field `null`.
  - **No answer** (a throw): `LOST_ANSWER` in the alert, and the button reads "Try again".
  - **Signed in** (`r.ok`): the address is read again with `api.signInAddress()`, and the panel says "You are signed in
    as {address}." with "Continue" (primary; sets the link aside, so the existing effect moves on to `next`) and "Not
    you? Sign out" (`api.signOut()`, then the form). Where `r.value.account` is false, `setWhy(r.value.why ?? null)` is
    called and the existing `OpenAccount` branch shows instead, as after a typed code.
- Focus moves to the panel's heading or its first sentence on each change of state, and each change is in a
  `role="status"` region, as the form's "Another code was asked for" is.
- The lead on the email step is unchanged: it already says "a code and a link".

**Tests first, `engine/ui/account/SignIn.test.tsx`**, with the fake API:
- `/sign-in#token_hash=<TEST_LINK>` shows the panel and no email field; `verifyLink` has not been called; the address
  no longer holds the fragment.
- The press signs in, and the panel names the address. "Continue" navigates to `next`.
- "Not you? Sign out" signs out and shows the form.
- A hash the fake refuses shows the form with the refusal sentence in the alert.
- Opened while signed in as another address: the panel names that address; "Stay signed in" navigates to `next` and
  `verifyLink` is never called; "Sign in with the link" replaces the session and names the new address.
- A login with no open account shows `OpenAccount` with its reason.
- `/register#token_hash=…` reads "Finish signing up".
- A fragment that is not a token hash (`#top`, `#token_hash=`) shows the ordinary form.
- `engine/ui/account/link.test.ts`: `tokenHashOf` over those shapes.

**Stories:** `engine/ui/account/SignIn.board.stories.tsx` gains the panel's Ready, Already signed in and Signed in
states, so the glass text and layout checks (`e2e/glass-text.spec.ts`, `e2e/glass-layout.spec.ts`) and
`e2e/a11y.spec.ts` cover them through `e2e/glass-screens.ts`.

## Task 4. The emails' link (engine, composition root, tooling, instance)

Model: sonnet

**Layer:** engine for the words and the check; the composition root builds the link; the instance's two templates are
regenerated output.

- `supabase/functions/_shared/mail/auth.ts`:
  - `LINK` is removed. A `HASH = '{{ .TokenHash }}'` slot stands beside `CODE`.
  - `link(path)` is `new URL(path, mailTheme.site).href + '#token_hash=' + HASH`.
  - `signIn` is given `link('/sign-in')` and `signUp` `link('/register')`; `slots` is `[CODE, HASH]`.
- `engine/mail/render.ts`: `checkHref` already takes an `https:` href and guards its braces against the declared
  slots, so no change is expected. Its comment's example of a slot is updated to `{{ .TokenHash }}`.
- `engine/mail/auth.ts`: the paragraph becomes "Type this code where you asked for it, or use the button: it opens
  {theme.name}, where one more press {signs you in | finishes signing you up}." so the email says what the button
  does (§2.2).
- `supabase/templates/sign-in.html` and `sign-up.html`: rewritten by `node tools/check-mail.mjs --write`.
- `tools/check-mail.mjs` gains one fault, with its poison in `tools/test-mail.mjs`:
  - **Fault:** a committed or rendered Auth template holds `{{ .ConfirmationURL }}`, or its button's `href` does not
    end in `#token_hash={{ .TokenHash }}`. It names the file.
  - **Poisons:** a template whose button is `{{ .ConfirmationURL }}`; a template whose link has the hash in the query
    (`?token_hash={{ .TokenHash }}`), which a server would see. Each is watched failing before the check is trusted.
  - `tools/test-mail.mjs`'s existing fixture that uses `{{ .ConfirmationURL }}` as good input moves to the new link.
- `README.md`, step 4.4: after "Both must keep `{{ .Token }}`", it says the button's link must keep
  `{{ .TokenHash }}`, and that the files are pasted again whenever they change.

**Tests first:**
- `supabase/functions/_shared/mail/auth.test.ts`: each template's button `href` is the theme's site, the right path
  and `#token_hash={{ .TokenHash }}`; neither holds `{{ .ConfirmationURL }}`; both still hold `{{ .Token }}`.
- `engine/mail/auth.test.ts`: the new paragraph, for both emails.
- `tools/test-mail.mjs`: the two poisons, red.
- `e2e/mail.spec.ts`: its screenshots are retaken for the new paragraph.

## Task 5. The link, end to end (e2e)

Model: sonnet

**Layer:** e2e, against the fixture backend.

- `e2e/account.spec.ts` gains: a code is asked for on `/sign-in`; the page is opened at
  `/sign-in#token_hash=<TEST_LINK>`; the panel shows; the press signs in and names the address; "Continue" lands on
  the board signed in. A second case opens a refused hash and ends on the form with the sentence.
- `e2e/keyboard.spec.ts` or `e2e/focus.spec.ts`, whichever holds the sign-in screen's case: the panel's button is
  reached and pressed by keyboard, and focus lands on the signed-in sentence.

## Task 6. The owner's step after the merge

Model: inline

The build session does not run this task: build sessions touch no deployed service. It writes the steps into its PR's
description for the owner:
1. Paste `supabase/templates/sign-in.html` and `supabase/templates/sign-up.html` into the dashboard's Magic Link and
   Confirm signup templates (`README.md`, step 4.4). Do not run `supabase config push`.
2. Ask for a code as a returning player, from "Sign in" on a thread's page, and press the email's button: the panel,
   the press, the address, and "Continue" landing on that thread (Task 7).
3. Register a fresh address with an invite, and press that email's button.
4. Press a link a second time: the refusal, and the form.

The owner's findings, if any, become issues.

## Task 7. The link carries `next` (issue #223)

Model: sonnet

Added 2026-11-12 by the build session, as a plan gap: the plan above builds a link that opens `/sign-in` or
`/register` bare, so a visitor who came from a thread and presses the email's button lands on the Index (#223). The
owner's decision, given to the merging session that day: "Carry `next` in the emailed link, read back through the
existing safe-redirect check. It is the only option that works when the mail is opened on another device. Add a browser
copy only if Auth can't put a per-request value in the link." Auth can (see "What was read" below), so no browser copy
is built. It is built after Task 4 and before Task 5, and it changes the link Task 4 writes, so Task 4 is built with
this task's `href` from the start.

**Layer:** engine for the rule, the action and the screen; the composition root hands the function its site.

**The link.** The button's `href` in both templates is `{{ .RedirectTo }}#token_hash={{ .TokenHash }}`: Auth's own
placeholder for the request's redirect, then the fragment of §2.1. The redirect is the instance's own page, built by
the `account` function for each request: `<site>/sign-in` or `<site>/register`, with `?next=<path>` where the caller
gave one. So `next` is a query on the instance's page, ahead of the fragment, and the page reads it as it reads a typed
address.

- `engine/rules/next.ts` (new, pure): `sameSitePath(next: unknown, origin: string): string | null`. A string that
  starts with `/`, is at most 512 characters, and resolves against `origin` to the same origin is returned as its path,
  query and fragment; anything else is `null`. `engine/ui/account/next.ts`'s `safeNext` becomes
  `sameSitePath(next, location.origin) ?? '/'`, so the browser and the server hold one rule ("Two lists that must
  agree are one list").
- `supabase/functions/account/core.ts`:
  - `runAccount`'s deps gain `site: string`, the instance's site.
  - `requestCode` reads `r.next` through `sameSitePath(r.next, new URL(site).origin)`. A `next` that fails it, or is
    `/`, is dropped without a word: the answer and its status are the same as with none.
  - `Auth.requestCode`'s options gain `redirect: string`: `new URL(create ? '/register' : '/sign-in', site)`, with
    `next` set on its query where one was kept. The page follows `create`, a fact about the invite, never the address.
  - The header comment says where `next` comes from (the caller) and why that keeps both closures whole.
- `supabase/functions/_shared/gotrue.ts`: `requestCode` posts to `otp?redirect_to=<redirect, encoded>`, as Auth's own
  client does. The log lines for a refused or unanswered request name `otp` alone, never the redirect.
- `supabase/functions/account/index.ts`: passes `site: mailTheme.site`.
- `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`: `requestCode(email, invite, next)`,
  `next` a `string | null`; the web client sends it in the action's body.
- `engine/ui/account/SignIn.tsx`: asking for a code passes `safeNext(query.get('next'))`, or `null` where that is `/`.
  The read back is Task 3's: the fragment is stripped with the query kept, and "Continue" and "Stay signed in" move on
  through `safeNext`.
- `supabase/functions/_shared/mail/auth.ts` (changing Task 4): no `link(path)`. `LINK` is
  `'{{ .RedirectTo }}#token_hash={{ .TokenHash }}'` for both emails; `slots` is `[CODE, REDIRECT, HASH]`.
- `engine/mail/render.ts`: `checkHref` takes an `href` that begins with a declared slot, as it takes one that is a
  declared slot.
- `tools/check-mail.mjs` (changing Task 4's fault): the button's `href` must be exactly
  `{{ .RedirectTo }}#token_hash={{ .TokenHash }}`. A third poison in `tools/test-mail.mjs`: a template whose link is
  the site's page written out (`https://…/sign-in#token_hash={{ .TokenHash }}`), which would drop `next`.
- `README.md`, step 4.4: the button's link must keep `{{ .RedirectTo }}` and `{{ .TokenHash }}`; and Auth's Site URL
  must be the instance's own site (scheme, host and port), since Auth takes a redirect only on its Site URL or its
  allow list and otherwise puts the Site URL in the link.

**The masks.** `next` and the page come from the caller and the invite, never from the address: `requestCode`'s answer,
its status and its floor are the same for every address, with or without `next`, kept or dropped. Auth is still asked
only after the answer.

**Tests first:**
- `engine/rules/next.test.ts`: `sameSitePath` over a plain path, a path with a query and a fragment, `//evil.example`,
  `/\evil.example`, a tab inside the slashes, an absolute URL, a path of 513 characters, a number, `null`.
  `engine/ui/account/next.test.ts` (or wherever `safeNext`'s cases are) stays green unchanged.
- `supabase/functions/account/core.test.ts`: `requestCode` with `next: '/board/general?page=2'` and no invite hands
  Auth `<site>/sign-in?next=%2Fboard%2Fgeneral%3Fpage%3D2`; with an invite that opens, `<site>/register?next=…`; with
  no `next`, `<site>/sign-in`; with `next` `//evil.example`, a number or 600 characters, `<site>/sign-in` and the
  same 202 body as with none; every answer on a whole number of `ANSWER_FLOOR_MS`.
- `supabase/functions/_shared/gotrue.test.ts`: `requestCode` posts to `/auth/v1/otp?redirect_to=` the encoded
  redirect; a refused request's log line holds no part of it.
- `web/src/data/supabase.test.tsx` and the fake's test: `next` goes in the body; the fake keeps it.
- `engine/ui/account/SignIn.test.tsx`: asking for a code on `/sign-in?next=/board/general` calls `requestCode` with
  `/board/general`, and on `/sign-in` with `null`; opened at `/sign-in?next=/board/general#token_hash=<TEST_LINK>`,
  "Continue" lands on `/board/general`; signed in as another address, "Stay signed in" lands there too; opened at
  `/sign-in?next=//evil.example#token_hash=<TEST_LINK>`, "Continue" lands on `/`.
- `supabase/functions/_shared/mail/auth.test.ts` (changing Task 4's): each button's `href` is exactly
  `{{ .RedirectTo }}#token_hash={{ .TokenHash }}`.
- `tools/test-mail.mjs`: the third poison, red.
- Task 5's first case asks for its code on `/sign-in?next=<a thread>` and opens the link with that query; "Continue"
  lands on the thread.

**What was read, and what no test here shows.** No Auth runs in a build session, so these are read from Auth's source
(`supabase/auth`, master, 2026-11-12) and from Go's own `html/template`, run on the `href` above:
- `internal/mailer/templatemailer`: both emails' data hold `RedirectTo`, the request's referrer.
- `internal/utilities/request.go`: the referrer is the `redirect_to` header or query where `IsRedirectURLValid`, which
  takes a redirect whose scheme, host and port are the Site URL's with the allow list empty; otherwise it is the Site
  URL, and the link would open the Index with a hash nothing reads.
- `html/template` leaves `https://dw.gripe/sign-in?next=%2Fboard%2Fgeneral%3Fpage%3D2` and the hash whole in the
  `href`.

The owner's first real emails (Task 6) are what show it on the deployed Auth: step 2 is done from a thread's address,
and "Continue" must land on that thread.

## Review focus

- Auth must accept `{ type: 'email', token_hash }` for a first sign-up's token as well as a returning sign-in's (§7).
  No test here reaches a real Auth; read Task 6's results before calling the link done.
- Auth's template engine must leave `{{ .TokenHash }}` whole inside an `href`'s fragment (§7).
- A mask: `verifyLink`'s answer and its timing must not differ between a hash never issued, one spent and one expired,
  nor between a login with an account and one without, beyond what `verifyCode` already says after a good code.
- A second run: the same hash pressed twice, or pressed after its code was typed, must end on the form with a way to a
  new code, never on a page with nothing to press.
- The hash must reach no server but the `account` function: not a query, not a log line in `account` or `gotrue.ts`,
  not a history entry after the page arrives.
- Task 7: `next` reaches the link from the caller alone. Read that `requestCode`'s answer, status and timing are the
  same with any `next` and any address, and that no `next` can make the link or the page leave the instance's site.
- With the link held, the screen's move-on effect is paused. Read that a signed-in player who opens `/sign-in` with no
  link is still moved on at once, as today.
