# The code of conduct and conduct reports: the plan

Record, written 2026-11-02. Carries out `docs/plans/2026-11-02-conduct-design.md` (cited here as "the design"), task by
task. Each task writes its tests first and shows their red run, and every task is reviewed for the spec and for quality
(`.claude/skills/build-session/SKILL.md`). Migration and SQL test numbers are written as "next": the build takes the
next free number when it reaches the task.

All copy here is plain and out of character, and is a draft the owner approves in the PR: the code's seven sections, the
emails, the suspended screen, the hidden note and the log lines. None of it is in Gabe's voice.

**Order.** Tasks 1 to 9 in order. Task 6's screens are designed with the owner first (impeccable's `shape`, in the
glass's look), and the build stops there until the boards are approved. No task touches a deployed database, bucket or
Resend: mail is tested against a fake sender.

## The layers

- **Engine** (`engine/`, `supabase/`): reports, sanctions, hidden versions, the mail interface and outbox, the admin
  screen, the report form, the suspended screen, the acceptance gate, the plain templates.
- **Edge** (`supabase/functions/`): the Resend adapter, the outbox sender, and the Auth ban.
- **Instance** (`instances/divided-world/`): the code's text and its version, the admin reply-to address's setting
  name, and any template words it overrides.
- **The interfaces:** `InstanceUi.conduct: { version: number; sections: { key, title, text }[] }` (Task 1) and
  `Settings.conduct: { openReportsMost, adminAddress }` (Task 2). `instanceProblems` checks both.

## The masks, for every task

- No answer to a player reads another account's sanctions. The reporter's mail is one template whatever the outcome.
- `report_post` accepts or refuses only on the filer's own account (signed in, under the open limit) and on the
  version itself (it exists and is a post or an edit), never on who owns the reported character; a second report on the
  same version is accepted. Its timing does not read the owner.
- A suspended account's characters change nowhere in `characters_public`, presence, Rankings or profiles. Task 4's test
  checks each relation's rows are identical before and after a suspension, apart from activity.
- The hidden note names the version, never the account.

## Task 1: the code of conduct, as content

- `engine/ui/types.ts` (`InstanceUi`, :215): `InstanceUi.conduct` with `version` and `sections`, each
  section a key, a title and plain Markdown.
- `instances/divided-world/ui/conduct.ts`: the design's seven sections, version 1.
- `engine/rules/instance.ts`: `conduct.version` is a positive whole number, keys are unique, and every section has a
  title and text.
- `engine/ui/conduct/Conduct.tsx`: the page at `/conduct`, in the glass, plain, each section with an anchor. Its
  opening says the difference between the board's Report and Report to admins. Route in `web/src/App.tsx:38-60`.
- **Tests first:** `engine/rules/instance.test.ts` covers a duplicate key and a missing title as problems. A UI test
  checks the page lists the instance's sections with anchors, and an a11y test runs as the glass's pages do. The poison
  is a section with empty text, reported.

## Task 2: reports, sanctions and hidden versions, in SQL

- **Migration** (next, `_conduct.sql`). Every table is append-only with the guards 0043 uses, and has no client
  access except through the functions below.
  - **`conduct_acceptances`** (`account`, `version`, `at`), unique `(account, version)`. `accept_conduct(version)` is for
    the signed-in account. `conduct_accepted()` returns whether the caller accepted the setting `conductVersion`, which
    the seed writes from `InstanceUi.conduct.version`.
  - **`conduct_reports`** (`id`, `reporter` account, `version_act` uuid references acts, `section` text, `note` text null
    ≤ 1000, `at`). `report_post(version_act, section, note)`:
    - It uses `signed_in_account()` (0009:44).
    - It refuses when the caller has `openReportsMost` (setting, 3) open reports, naming the limit.
    - It refuses an Act that is not a `post` or `edit` version, or a section the setting `conductSections` does not hold.
    - It accepts a report on one's own post, which is harmless.
  - **`conduct_decisions`** (`id`, `report` null, `version_act` null, `account` null, `admin`, `outcome`, `until`
    null, `note` text, `at`):
    - `outcome` is one of `none`, `nudge`, `hide`, `hideUntilEdited`, `suspend`, `ban`, `unhide`, `lift`, `approve`
      and `close`.
    - A report is open until a decision names it.
    - `decide_report(report, outcomes jsonb)` is admin only (`only_admins`, 0021). It writes one row per outcome in one
      transaction (a hide with a suspension is two rows). `suspend` needs `until` in the future; `ban` has none. It
      enqueues the mail (Task 3).
    - `decide(account | version_act, outcome, until, note)` is admin only, for an admin acting with no report: a lift, an
      unhide, an approval, acting against a reporter.
  - **`hidden_versions`** view: a version is hidden when its latest `hide`, `hideUntilEdited`, `unhide` or `approve`
    decision is a hide. `hideUntilEdited` ends, for the first time on that post, when its author's next `edit` Act
    exists (computed, so the edit itself is the way out). A second `hideUntilEdited` on the same post ends only at an
    `approve`. `reviews_due` lists versions brought back by an edit with no later decision, for the re-review list.
  - **`account_bar(who)`** returns the current suspension (`until`) or ban for an account, or null: the latest `suspend`
    or `ban` not followed by a `lift`, with a suspension past its `until` ending by itself.
  - **The writers:**
    - `played_by` (current form 0021:46) and `signed_in_account` refuse a barred account with errcode `28000` and the
      hint `kayfabb.barred`, so every player writer and every sign-in-only writer refuses alike.
    - `my_bar()` returns the caller's own bar for the gate, and nobody else's.
  - **`acts_public`** (current form `0022_edit_grace.sql`):
    - Its body is null for a hidden version, with `hidden boolean` true.
    - A body containing `[quote=<id>]` for a hidden id has that quote's contents replaced with the empty string, and the
      quote keeps its act id so the renderer shows the note. This uses `conceal_quotes(body)`, which runs only on bodies
      that contain `[quote=`.
    - Admins read words through `admin_version(act)`.
  - **The log:** a hide of the player's own version and its end are lines in their log (`engine/ui/log/lines.ts`), read
    from `conduct_decisions` for the caller's own characters only.
- **Tests first** (next SQL test, `-conduct.sql`):
  - `report_post` takes three, refuses the fourth, and takes one again after a decision closes a report.
  - A non-admin cannot decide.
  - `hide` makes `acts_public`'s body null and the History's version hidden. A quote of it is emptied and keeps its id.
  - `hideUntilEdited` ends on the author's edit the first time, and waits for `approve` the second.
  - `suspend` until a past date bars nothing. A current one makes `played_by` and `signed_in_account` refuse with
    `kayfabb.barred`. `lift` ends it.
  - `ban` bars until a `lift`.
  - `my_bar` reads only the caller's bar.
  - Every table refuses update and delete.
  - The poison is a decision whose `admin` is not an admin, inserted directly and refused, plus an `acts_public` read of
    a hidden version as an ordinary player, which must give no words.

## Task 3: mail, an outbox and Resend

- `engine/system/mail.ts` (the provider-neutral interface, beside `model.ts`):
  - `Mailer { send(m: { to, replyTo, subject, text }): Promise<{ id: string }> }`.
  - `TEMPLATES`: `reportRead`, `nudge`, `hidden`, `hiddenUntilEdited`, `suspended`, `banned` and `lifted`. Each is plain
    text with `{post}`, `{thread}`, `{section}`, `{note}`, `{until}` and `{conduct}` slots, and an instance may override
    the words through `InstanceUi.conduct.mail`.
  - `renderMail(template, facts)` throws on a missing slot.
- **Migration** (next):
  - **`mail_outbox`** (`id`, `account`, `template`, `facts jsonb`, `decision` null, `at`). It is append-only.
  - **`mail_attempts`** (`outbox`, `at`, `ok`, `provider_id`, `error`). It is append-only. Mail is sent when an `ok`
    attempt exists.
  - `decide_report` enqueues the reporter's `reportRead` and the author's mail for each outcome; `none` sends the author
    nothing.
  - `mail_due(most)` is for the service role.
- `supabase/functions/_shared/mail/resend.ts`:
  - It uses one `fetch` to Resend's send endpoint, with no vendor client.
  - A 5xx, a 429 or no answer is a transport failure, retried on the request (as `models/transport.ts` does). Any other
    refusal is recorded and not retried.
  - The key is read from the environment and never logged ("Secrets are never printed").
- `supabase/functions/mail/index.ts` and `core.ts`:
  - A cron job `kayfabb-mail`, every minute, reads `mail_due`.
  - It resolves each account's address from `auth.users` through the service role.
  - It renders the mail with the setting `conductAdminAddress` as reply-to, sends it, and writes the attempt.
  - An outbox row is sent at most once: the attempt is written in the same call, and a row with an `ok` attempt is never
    due.
- **Auth:** when a decision suspends or bans, `mail/core.ts` also sets the login's ban through Supabase Auth's admin API,
  until the date or indefinitely, and a `lift` clears it. Task 2's SQL bar holds whatever Auth does, so a stale token is
  still refused.
- **Tests first:**
  - `engine/system/mail.test.ts` covers each template rendering, a missing slot throwing, and an instance override.
  - `supabase/functions/mail/core.test.ts`, with a fake mailer and a fake database, covers:
    - a due row is sent once;
    - a 503 is retried and then sent;
    - a 422 is recorded and not retried;
    - a second run sends nothing;
    - a suspension sets the Auth ban, and a lift clears it.
  - An SQL test checks `decide_report` enqueues `reportRead` for every outcome, the same template each time.
  - The poison is a `reportRead` facts object that carries the outcome, which the test plants and expects the template
    renderer to refuse as an unknown slot.

## Task 4: what a bar shows, and what it doesn't

- `engine/ui/account/OpenAccount.tsx` `AccountGate` (:75):
  - When `api.session()` reports a bar (from `my_bar()`), it shows `engine/ui/account/Barred.tsx` in place of every page
    but sign-out. It says: "This account is suspended until {date}. We emailed you the details; reply to that email to
    appeal." A ban says the same without the date.
  - An account that has not accepted the current code sees `engine/ui/conduct/Accept.tsx`: the code, and "I agree."
- `web/src/data/supabase.ts`'s session read gains the bar and `conduct_accepted()`. A refusal with `kayfabb.barred` from
  any action reloads the session, so the gate shows at once.
- **Tests first:**
  - UI tests: a barred session shows only Barred and sign-out; a lapsed suspension shows the board; an unaccepted code
    shows Accept, and agreeing lets the player through.
  - An SQL test reads `characters_public`, `presence_listed`, `standings` and `character_profiles` for a suspended
    account's characters before and after the suspension, and checks they are identical.
  - The poison is a fixture that marks a suspended account's character in `characters_public`, which the test must catch.

## Task 5: registration accepts the code

- `engine/ui/account/SignIn.tsx`'s 18+ checkbox gains a second checkbox, "I've read and agree to the code of conduct,"
  linking to `/conduct`. `open_account` (current form 0020) records the acceptance of the setting `conductVersion` in
  the same transaction.
- **Tests first:** `SignIn.test.tsx` covers that the account cannot open without the box and opens with it. An SQL test
  checks `open_account` writes the acceptance.

## Task 6: the report form and the hidden note: designed first

- **Design with the owner** (impeccable's `shape`, briefed on the glass's plain account-screen look, never a mark). It
  needs boards for three things:
  - Report to admins on a post's glass layer and on each version in History;
  - the form and its confirmation;
  - the hidden note on a post, in History and in a quote.
  The boards go in `docs/research/2026-11-02-conduct/`, and the confirmed brief is written into this task before the
  build goes on.
- Then:
  - `engine/ui/conduct/Report.tsx` (the form, the confirmation, and the limit's plain refusal);
  - `engine/ui/conduct/Hidden.tsx` (the note);
  - `engine/ui/thread/Post.tsx` (:88's reader actions gain Report to admins);
  - `engine/ui/thread/lines.tsx`'s `useHistory` (each version's report entry and hidden note);
  - the BBCode renderer's quote, which shows Hidden when the quoted act is hidden.
  - For the author of a version hidden until edited, Post shows their own words (from `admin_version`'s author-only
    sibling `my_hidden_version(act)`) under the note, with Edit.
- **Tests first:**
  - UI tests: Report to admins is on the post and on each version; the form sends `report_post`; the confirmation is
    plain; a hidden post shows the note and no words; a quote of a hidden version shows the note; the author sees their
    words and Edit.
  - a11y tests as the glass's are.
  - A test that the report entry's class carries none of the marks' tokens (`check-ui-tokens`' list).
  - The poison is a hidden post whose words reach the DOM for a non-author, caught.

## Task 7: the admin screen

- `engine/ui/admin/Reports.tsx` at `/admin/reports` (`web/src/App.tsx`, beside `/admin/queue`). It is plain and
  functional. It shows:
  - open reports, newest first, each with the version's words (`admin_version`), the section, the note, the author's
    account, and its past decisions;
  - the outcome form (any of the six, with `until` for a suspension and a note that goes into the author's mail);
  - the re-review list (`reviews_due`), each with approve or hide again;
  - mail that failed its last attempt.
- **Tests first:** `Reports.test.tsx` covers that a report lists with its version, deciding a suspension sends
  `decide_report` with `until`, re-review approve sends `decide`, and failed mail shows. A non-admin is sent away as
  `/admin/queue` does.

## Task 8: staff posts

- No new code: a staff version is reported and hidden as any. **Tests first:** an SQL test that `report_post` takes a
  staff post's version and `hide` hides it, and that no mail is enqueued for a staff author (it has no account).

## Task 9: the round trip

- `supabase/tests/e2e/0003-export.ts`: the conduct tables and the outbox round-trip (every public table does, by
  `tools/instance-files.mjs`). `supabase/tests/e2e/` (next) `-a-report.ts` runs the whole flow on the scratch database
  with the fake mailer:
  1. Report.
  2. Hide until edited.
  3. The author edits.
  4. The post is back, and re-review is listed.
  5. Hide until edited again.
  6. The edit waits.
  7. Approve.
  8. A suspension: the gate, the mail, and the Auth ban on the fake.
  9. A lift.

## Review focus

- `acts_public` changes for every read of every post: `conceal_quotes` must run only on bodies that quote, and the
  hidden check must be an index lookup. Measure the thread read with `explain` at a busy instance's shape.
- `played_by` and `signed_in_account` gain a bar check: every writer now reads it, so it must be one indexed lookup, and
  a lapsed suspension must cost the same as none.
- A hidden version's words must reach no player but its author, by any read path: `acts_public`, History, quotes,
  search, the log's excerpts, the digest's `excerpts`, alerts that quote, and the export's player-facing parts. Audit
  each relation that reads `acts.body`.
- The digest (`system_digest`, 0052) must not hand The System a hidden version's words.
- `hideUntilEdited`'s first-time rule is computed from the post's decisions; a race between the author's edit and an
  admin's second hide must leave one clear answer.
- Mail sent twice on a retry: the attempt and the send are not one transaction, so a crash between Resend's answer and
  the attempt row can resend. Name it, and choose Resend's idempotency key from the outbox id.
- The Auth ban and the SQL bar must agree. A lift that clears one and not the other leaves a player locked out with no
  stated way out.
