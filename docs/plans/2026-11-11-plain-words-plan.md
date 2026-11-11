# Plain words that are true: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-plain-words-design.md`. Every task goes test first:
write the failing test, show its red run, then write the code. During a task, run only the tests for the changed
code; run `npm run build` once after the last task. UI tests are `npx vitest run <file>`; SQL tests are
`npm run test:sql` against the Postgres on localhost the session-start hook starts.

Build sessions touch no deployed database (CLAUDE.md, "A standing permission is written down"). No task makes a model
call.

**Numbers.** Line numbers below were read on main at 303e2058 and say where to look; the names beside them are what
to trust. The newest migration then was `0149_card_writes.sql` and the newest SQL test `0155-back-live-readers.sql`.
Open PRs add migrations too, so each task that writes a migration or an SQL test takes the next free number when it
starts, and names a test file with a number no other file has. A function redefined here is copied whole from its
latest definition (grep every migration, case-insensitively: 0142 writes `CREATE OR REPLACE FUNCTION public.react` in
capitals) and changed only where the task says.

**Words.** Every string in quotes below is the owner's approved copy, or is marked as a draft the owner reads in the
build's PR. A task changes no other player-facing word.

## Task 1. A failed read says which kind it was

Model: sonnet.

Files: `engine/ui/data/api.ts`; `web/src/data/supabase.ts` and `web/src/data/supabase.test.tsx`;
`engine/ui/screen-docs.ts`; `engine/ui/data/fake.ts` and `engine/ui/data/fake.test.tsx`.

- `api.ts` exports `type FailureKind = 'offline' | 'silent' | 'server'` and
  `class ReadFailure extends Error { readonly kind: FailureKind }`, whose message stays
  `'that could not be read right now; try again'` (today's `NOT_READ` in `supabase.ts`), so a caller that shows the
  message shows what it showed before. Also `failureKind(e: unknown): FailureKind | 'broken'`: a `ReadFailure`'s
  kind, and `'broken'` for anything else thrown (the page's own code).
- `supabase.ts`, `read` (near :676). Before the first attempt, where `navigator.onLine === false`, throw
  `new ReadFailure('offline')` and send nothing. After its one retry: status 0 (the fetch rejected) throws
  `ReadFailure('silent')`; a status of 500 or more, or any other error object (a 4xx that is not a refusal), throws
  `ReadFailure('server')`. The page-past-the-end exemption (416 with `pastEnd`) is unchanged. `refusableRead` still
  throws the server's own words for a `kayfabb.refusal` hint. The document reads that throw `new Error(NOT_READ)`
  when the data is not an object (near :1498, :1519, :1532, :1687, :1713, :1723, :1843) throw
  `ReadFailure('server')`: the server answered, and not with what the screen can use.
- `screen-docs.ts`, `reachFailure` (near :97) reads `failureKind(e)` in place of its `TypeError`, `navigator.onLine`
  and message tests: unreached is `'offline'` or `'silent'`.
- `fake.ts`: the `Seed` gains `failNextRead(kind: FailureKind): void`, beside `loseNextAnswer`: the next read of any
  kind rejects with that `ReadFailure`, once.

Tests first, in `supabase.test.tsx`: with the adapter's `fetch` option stubbed, one read each for a fetch that
rejects twice (`silent`), a 500 twice (`server`), a 404 error object (`server`), and `navigator.onLine` false
(`offline`, and the stub was never called). In `fake.test.tsx`: `failNextRead('server')` fails one read with that kind
and the next read succeeds.

## Task 2. The load-error screens say the cause

Model: sonnet.

Files: `engine/ui/router.tsx`, `engine/ui/routes.tsx`, `engine/ui/glass/Unavailable.tsx`,
`engine/ui/frame/Unavailable.tsx`, `web/src/App.tsx`, their tests (`router.test.tsx`, `routes.test.tsx`,
`glass/Unavailable.test.tsx`, `frame/Unavailable.test.tsx`, `frame/unavailable-contrast.test.tsx`,
`web/src/App.test.tsx`), and the stories `engine/ui/frame/CannotDisplay.board.stories.tsx` and
`engine/ui/frame/Unavailable.stories.tsx`.

- `router.tsx`: `export type Failure = 'offline' | 'silent' | 'server' | 'broken' | 'find'` (today
  `'display' | 'find'`). In `startLoad` (near :276), the timer resolves `'silent'`, a rejected load resolves
  `failureKind(error)` from Task 1, and a null document is still `'find'`. `LOAD_LIMIT_MS` is exported.
- `routes.tsx`: `Failures.display` takes `{ kind, address, onRetry }` where `kind` is the four kinds that are not
  `'find'`; `Routes` passes it, to the frame's `CannotDisplay` too.
- `glass/Unavailable.tsx`, `GlassCannotDisplay({ kind, onRetry })`. Try again and Back to the board stay on each.
  The seconds come from `LOAD_LIMIT_MS / 1000`, not a typed 20.

  | kind | title | lead |
  |---|---|---|
  | `offline` | You're offline | Your device reports no connection, so nothing was sent. Reconnect, then try again. |
  | `silent` | This screen didn't load | The server didn't answer within 20 seconds, or the connection dropped on the way. Loading a screen changes nothing, so nothing was lost. |
  | `server` | This screen didn't load | The server answered with an error. Your connection is fine, and nothing was lost. Try again in a moment. If it keeps happening, tell an admin. |
  | `broken` (draft) | This screen didn't load | Something went wrong while loading it. Nothing was lost. Try again, and if it keeps happening, tell an admin. |

  "tell an admin" is a `GlassLink` to `CONTACT_PATH` (`engine/ui/contact/Contact.tsx`).
- `frame/Unavailable.tsx`, `CannotDisplay({ kind, address, onRetry })`. The heading "The page cannot be displayed",
  the glyph, the sheet and the footer line are as today. The first paragraph keeps its opening sentence "The page
  you are looking for is currently unavailable." and its second sentence is by kind:

  | kind | second sentence | list |
  |---|---|---|
  | `offline` | You are not connected, so {siteName} was never asked for this page. | Check that your connection is working. / Click Try again. / Click your browser's Back button to return to the page you were on. |
  | `silent` | {siteName} did not answer in time, or the connection dropped on the way. | today's four items, unchanged |
  | `server` | {siteName} answered, but with an error. Your connection is working. | Click Try again, or try again in a moment. / If it keeps happening, tell an admin. / Go back to the index. / Click your browser's Back button to return to the page you were on. |
  | `broken` (draft) | Something went wrong while loading it. | as `server` |

  "tell an admin" is a `Link` to `CONTACT_PATH`. Try again stays the button it is.
- `web/src/App.tsx`, `GLASS_FAILURES.display` passes `kind`.
- A story for each kind beside the existing ones, so the boards show all four.

Tests first: in `router.test.tsx`, a load that rejects with each `ReadFailure` kind lands that failure, one that
throws a plain `Error` lands `'broken'`, and one that outlasts the limit lands `'silent'`. In each `Unavailable` test,
each kind's words, that "Check that your connection is working" appears only for `offline` and `silent`, and that
`server` and `broken` link to the contact page. The contrast test covers the new link.

## Task 3. A write that was not sent says so

Model: sonnet.

Files: `engine/ui/data/api.ts`; `web/src/data/supabase.ts` and its test; `engine/ui/data/fake.ts`;
`supabase/functions/_shared/rpc.ts` and its test; `supabase/functions/act/core.ts` and `core.test.ts`.

- `api.ts`: `Refusal` gains `readonly notSent?: true` ("nothing left the device, or the server never ran it: sending
  again cannot duplicate"), and `export const NOT_SENT = "You're offline, so this was not sent."` and
  `export const NOT_RUN = 'it did not go through; try again'`.
- `supabase.ts`: `edge` (near :719) and `rpcWrite` (near :753) answer
  `{ ok: false, error: NOT_SENT, notSent: true }` without sending when `navigator.onLine === false`. In `edge`, a
  5xx whose body carries `sent: false` is `{ ok: false, error: <its words>, notSent: true }`, never `uncertain`.
- `fake.ts`: the `Seed` gains `offline(on: boolean)`: while on, every write answers the `NOT_SENT` refusal and
  changes nothing, and every read rejects with `ReadFailure('offline')`.
- `_shared/rpc.ts`: `TransportError` gains `readonly ran: 'never' | 'maybe'`. In the retry loop (near :87 to :121)
  it is `'never'` only when every attempt answered 503 (the file's `NEVER_RAN`); a fetch that threw, a 502 or a 504
  on any attempt makes it `'maybe'`. `_shared/storage.ts`'s throw (near :44) is `'maybe'`.
- `act/core.ts`: the catch near :215 answers `{ status: 503, body: { error: NOT_RUN's words, sent: false } }` when
  the write was certainly not made: the error's `ran` is `'never'`, or it was thrown before the write's own call
  began (the reads `whoami`, `instance_settings`, `card_target_reach` and `card_of_play`, near :156 to :198, come
  first; hold a flag set immediately before `dbs.service.rpc(decision.rpc, args)` near :206 and `dbs.player.rpc`
  near :151). Otherwise it answers the lost-answer words as today. The function's words are typed there, since an
  edge function does not import `engine/ui`; a test in `core.test.ts` holds them equal to `NOT_RUN`.

Tests first: `rpc.ts`, four 503s give `ran: 'never'` and a 502 gives `'maybe'`. `core.test.ts`, a `whoami` that
never answers gives `sent: false`; a write that gets four 503s gives `sent: false`; a write whose fetch throws gives
the lost-answer words and no `sent`. `supabase.test.tsx`, offline sends nothing and answers `notSent`; a 503 body
with `sent: false` is `notSent` and not `uncertain`.

## Task 4. The player's characters, and the dialogs that change them

Model: sonnet.

Files: `engine/ui/player.tsx` and `player.test.tsx`; `engine/ui/characters/reveal.ts`, `DebutDialog.tsx`,
`TurnDialog.tsx`, `Characters.tsx`, `RevealOverlay.tsx` and their tests (`Characters.test.tsx`,
`RevealOverlay.test.tsx`); `engine/ui/frame/Hud.tsx` only where it shows a done line.

- `player.tsx`: `refresh` (near :142) returns `Promise<boolean>`: true when the three reads landed, false when one
  failed (it still never throws, and still ends loading). `Held` gains `failed: boolean`, set by the catch and
  cleared by a read that lands; `Player` exposes it as `charactersFailed`.
- Every screen that draws an empty state from the provider's `characters`, `actingCharacters` or
  `writingCharacters` shows, when `charactersFailed` is true, "Your characters couldn't be loaded." and a Try again
  button that calls `refresh`, in place of its empty state. Find them by reading each of the files that call
  `usePlayer()` (42 on main) for a branch on an empty list; list the ones changed in the PR. `Characters.tsx` and
  `ProfileEdit.tsx` read their own route documents and keep their "no characters yet" lines.
- `reveal.ts`, `submit` (near :40), `DebutDialog.tsx` (near :39) and `TurnDialog.tsx` (near :69): the `try` holds
  the api call alone. A refusal is shown in its own words as today (an `uncertain` or `notSent` one included). Once
  the answer is `ok` the change is done: `const fresh = await refresh()`, and the done message is the one each has
  today, with " This page may be out of date until you reload it." added when `fresh` is false. The three "could
  not be sent. Check your connection and try again." strings go; the `catch` that held them is for the api call
  throwing, which the adapter does not do, and it says the lost-answer words (`LOST_ANSWER`).
- `Characters.tsx` near :207, `try { await player.refresh(); } catch { … }` can never catch: it reads `refresh`'s
  answer and shows its "Saved, but this page could not read it back. Reload to see it." when that is false.

Tests first: `player.test.tsx`, a failed `myCharacters` sets `charactersFailed` and `refresh` answers false, and the
next good read clears it. `Characters.test.tsx`, a Turn and a debut whose write lands and whose refresh fails close
with the done line and the added sentence, and the dialog is not left open with its button live.
`RevealOverlay.test.tsx`, the same for a reveal, and that `unmask` was called once.

## Task 5. The search box and the tilt tip

Model: sonnet.

Files: `engine/ui/search/useSearchCombobox.ts` and `useSearchCombobox.test.tsx`; `engine/ui/tips/Tips.tsx`,
`engine/ui/tips/shine.test.tsx`.

- `useSearchCombobox.ts`: the rejection branch (near :118) sets the live text to
  "Suggestions couldn't be loaded." (a named constant beside `suggestionCount`), and the view gains
  `failed: boolean`, true until the next reply lands, so a combobox can draw the same words in its list where it
  draws "no suggestions" today. Read `BoardCombobox.tsx` and `engine/ui/glass/GlassCombobox.tsx` and draw it where
  each draws an empty list.
- `Tips.tsx` (near :64 and :90): the provider reads `refusal` from `usePreferenceSaves` and, when the shine tip's
  tilt save is refused, shows the refusal's text in the tip, in a `role="alert"` line, with the choice put back as
  the hook already does.

Tests first: a source that rejects announces "Suggestions couldn't be loaded." and not "No suggestions", and a later
good reply clears it. A refused `setPreferences` from the tip's action shows the refusal's words.

## Task 6. A dropped visit, a house rule's notice and the quiz's terms

Model: sonnet.

Files: a new migration and a new SQL test; `engine/ui/data/api.ts`; `web/src/data/supabase.ts`;
`engine/ui/cards/visit.ts`, `engine/ui/cards/Visit.tsx`; `engine/ui/profile/modlog.ts` and `modlog.test.ts`;
`engine/ui/data/fake.ts`; `engine/ui/cards/notice.test.tsx`, `lens.test.tsx`; a new `engine/ui/cards/visit.test.ts`.

SQL, in one migration:
- `acts_visit_payload` (0105_visits.sql near :50) and `end_visit` (near :492, its check at :499) allow `'dropped'`
  beside the four outcomes; the check's message names all five.
- `system_tick` (latest in 0140_machine_moves.sql near :333; the branch near :530 to :545) calls
  `end_visit(late.visit_act, 'dropped', null, 'This visit could not be filed and was dropped.')`.
- `visit_charge_matches` (0105 near :342; the two tests at :347 and :353) reads
  `e.payload ->> 'outcome' in ('reversed', 'dropped')`.
- `apply_mod_move` (latest 0136) tests `is distinct from 'filed'` and needs no change; `moves_log` and `thread_page`
  pass the outcome through.

Client:
- `api.ts` near :332: `VisitOutcome` gains `'dropped'`. `supabase.ts` near :381: `OUTCOMES` gains it, and
  `toVisitEnd` (near :396) reads a `'reversed'` end whose `by_act` is null as `'dropped'`: the tick wrote those
  before this change, and no Act is edited.
- `visit.ts`: `markText` and `tabName` say "Dropped" for `dropped`; `markLabel` says
  "{mod}'s visit to this post could not be filed and was dropped". `reversed` keeps "Ended" and "was ended by an
  admin" for #315.
- `Visit.tsx`: near :118, `dropped` is "The visit could not be filed and was dropped"; near :323,
  `dropped: <>could not be filed and was dropped</>`; near :354,
  "The visit could not be filed and was dropped on {date}. Nothing landed on {author}."
- `modlog.ts` near :40: `case 'dropped': return 'dropped, never filed';`.
- `visit.ts`, `noticeWords` (near :134): the test for words that already name their rule is
  `/^(House )?Rule \d/iu`, so a house rule reads "…in violation of House Rule 1: …" and not "Rule 1: House Rule 1".
- `visit.ts`, `tryTerms` (near :120): "One try for {mask}. An answer other than {mod}'s, and {mod} visits {mask}'s
  next post within {N} hours, charging Obstruction (minor, {points}). There is no timer."
- `fake.ts` ends a visit it drops as `dropped`.

Tests first. SQL: a visit that fails to file ten times ends `dropped` with the line; `end_visit` refuses an outcome
outside the five; a charge on a dropped visit matches as one on a reversed visit did. `visit.test.ts`: each
outcome's `markText`, `tabName` and `markLabel`; `noticeWords` for "Rule 2: No double posting", "House Rule 1: Be
kind", a bare number with plain words, no number, a tail and a backfire; `tryTerms`. `supabase.test.tsx`: a
`reversed` end with a null `by_act` maps to `dropped`, and one with a `by_act` stays `reversed`.

## Task 7. What the log's read carries

Model: sonnet.

Files: a new migration and SQL tests; `engine/ui/data/api.ts`; `web/src/data/supabase.ts`; `engine/ui/data/fake.ts`;
`engine/ui/log/lines.ts` and `lines.test.tsx`; `engine/ui/log/Log.tsx` and `Log.test.tsx`.

SQL, in one migration:
- `write_staff_act` (latest 0142_face_down_moves.sql near :664; the stamp near :688) stamps `office` on an
  `appeal_ruling` as it does on a `move`: `kind in ('move', 'appeal_ruling')`.
- `my_group_moves` (0134_group_log.sql near :16) gains `ruled_office`: the latest ruling's
  `nullif(payload ->> 'office', '')`, null for a ruling with no stamp. No default stands in for it.
- `my_bans` (0111_mod_screens.sql near :230) gains `ruling` (the verdict of the `appeal_ruling` on this ban's
  appeal, null with none) and `own_until` (the ban's own `payload ->> 'until'`). Its `until` subquery gains an
  `order by r.created_at desc, r.id desc` before its `limit 1`.
- `my_caught` (0054_card_plays.sql near :285) loses `bought_price`. A view's column cannot be dropped in place:
  drop and recreate it, with its grants and `security_invoker` as they are.
- `log_page` (latest 0149_card_writes.sql near :1339; `caught` near :1382, `bans` near :1394, `gm` near :1397)
  selects the new columns and no `bought_price`.

Client:
- `api.ts`: `CaughtPlay` (near :1316) loses `boughtPrice`; `LogBan` (near :1370) gains
  `ruling: AppealVerdict | null` and `ownUntil: string`; `LogGroupMove` (near :1398) gains
  `ruledOffice: Office | null`. `supabase.ts` maps them (near :586 and :971 for the caught read); `fake.ts` follows.
- `lines.ts`, the caught branch (near :648): the details end
  "…was caught by {trap}{fate}; the cast cost {price}, and nothing came back{ to you}." The comment above it says
  why the machine's price is not quoted (the design, section 5).
- `lines.ts`, the ban row (near :468). The last two sentences are by ruling (drafts, for the owner in the PR):

  | `ruling` | words |
  |---|---|
  | null, `upheld` | The ban ends by itself {until} UTC. / The ban ended by itself {until} UTC. |
  | `overturned` | An appeal overturned the ban on {until} UTC. |
  | `reduced` | An appeal shortened the ban: it ends {until} UTC. / …it ended {until} UTC. |
  | `increased` | An appeal lengthened the ban: it ends by itself {until} UTC. / …it ended {until} UTC. |

  Then, always: "The ban is on {name} only; each character has its own warn bar." in place of "Your other
  characters are not banned."
- `lines.ts`, `groupRows` (near :397): "and barred {them} from posting on {board}" with the character's pronouns
  (the helper the ban row uses, `pronounsOf`). The ruling row (near :427): with a `ruledOffice`, the hearer is
  `officeRole(words.ui.copy, g.ruledOffice)` and the line is as today; with none,
  "{name}'s {group} was {ruling} on appeal{: result}." with the same link.
- `Log.tsx`, `NothingYet` (near :168): the When cell is `utcWhen(next)` only where `untilWords(next)` is not null,
  and a dash otherwise.

Tests first. SQL: a move made by a Mod who then leaves the staff, appealed and ruled by the Boss, reads
`ruled_office = 'boss'` while `office` is `'mod'`; a ruling written before this migration (insert one with no
stamp) reads null; a ban with an overturned, a reduced and an increased ruling reads each verdict and its
`own_until`; `log_page` answers no `bought_price`. `lines.test.tsx`: each row's words, including a caught play by a
player who bought the card at two prices (the line names neither) and a ban for a player whose other character is
also banned (the line does not say otherwise). `Log.test.tsx`: extend "a settlement that is due names no time
either" to assert the first cell is a dash.

## Task 8. A face-down card ends when the server says

Model: sonnet.

Files: `engine/ui/cards/marks.ts`, `Lens.tsx`, `Marks.tsx`, `plays.ts`, `land.ts`, `PlayActions.tsx`, `PlayForm.tsx`,
`Effects.tsx`, `Moment.tsx`; `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`; `web/src/data/supabase.ts`; a new
migration only if a read lacks the column; tests `marks.test.ts`, `backs.test.tsx`, `plays.test.tsx`,
`lens.test.tsx`.

The server stores a face-down card's end when it is set (`place_set`, latest 0148_card_types.sql near :805:
`face_down.ends_at = now() + span_interval(setting('setLasts'))`) and acts on that. The screens compute the end
again from the compiled `instance.settings.setLasts`, in about a dozen places (grep `setLasts` under `engine/ui`,
tests aside): `backWords` in `marks.ts` near :76, `Lens.tsx` near :212, :488 and :630, `shownPlays` in `plays.ts`
near :39, `land.ts` near :25 and :40, `PlayActions.tsx` near :57 and :137, `Effects.tsx` near :247, :273 and :330,
`Moment.tsx` near :219, `Marks.tsx` near :99 and :229.

- A back's row carries its end. Read first what each read of a back gives the client: `card_target` (0148 near
  :1109) answers `ends` for a face-down effect, and `my_face_down` (near :1132) answers `ends_at`. Where the
  client's `CardPlay` for a back has no end from the server, add it to the read that feeds it (`thread_page`,
  latest 0149 near :150, and any by-id read of plays the adapter makes) as the `face_down` row's `ends_at`, and to
  `CardPlay` as `endsAt: string | null` (null for a play that is not a back).
- Every place above reads the play's `endsAt`. No screen adds `setLasts` to `playedAt` for a card already set.
  `backWords` takes the play's end, not a span.
- `PlayForm.tsx` near :345, the line for a card about to be set, reads `setLasts` from the screen settings the
  server answers (the provider that carries `instance_settings` to the screens), not from the compiled instance.
  If the screen settings do not carry `setLasts`, add it to that read's projection in the migration.
- `fake.ts` (near :1595 and :3773) keeps computing the end at the moment of setting, as the server does, and
  answers it on the play.
- `instances/divided-world/ui/cards.ts` near :184 and :337 is card copy and is out of scope (the design, "Where the
  design stops").

Tests first: a fake seeded with a back whose `endsAt` differs from `playedAt + setLasts` (as after an admin changes
the setting): the Lens's "ends" words, the take-back control's liveness and `shownPlays` all follow `endsAt`.
`marks.test.ts`: `backWords` from an end. SQL, if a read was changed: it answers the row's `ends_at`.

## Task 9. Two refusals

Model: sonnet.

Files: a new migration; `supabase/tests/0077-settle-claim.sql` (extend, or a new file beside it); a wallet test.

- `unmask` (latest 0147_reveal_once.sql near :37; the raise near :60). The refusal "this character's Turn takes
  effect at the settlement now due; reveal once it has run, or withdraw the Turn" has two arms: the settlement is
  due by the clock, or a run has claimed the window. The claim arm is skipped where the character already has an
  `unmask` Act dated at or after that claim's `window_end` minus the window, that is, a reveal the settlement will
  read and that already rules the Turn out. Read `masks_change` and `write_unmask` in 0074_settle_claim.sql and
  0147 to state the condition exactly as the settlement applies it, and write it into the migration's header.
- `wallet_spend` (0006_cards.sql near :49; the raise at :57) says
  `'that costs %, and your wallet holds %', orbs(amount), orbs(was)`. `orbs(integer)` is in 0139_machine.sql near
  :174 and is not executable by the roles; `wallet_spend` runs as its owner, so no grant changes. Grep the client and
  the tests for the old words ("that costs") and update what quotes them.

Tests first. The claim: a season's first window; reveal; the run claims the window; reveal again: not refused with
those words (it is refused, if at all, by the rule that a class already public is not revealed twice, in that rule's
own words). The existing refusal still holds for a character with a pending Turn and no earlier reveal. The wallet:
a purchase of 3.00 against a wallet of 1.50 is refused as "that costs 3.00, and your wallet holds 1.50".

## Task 10. The door, the alert's sentence and the guide

Model: haiku.

Files: `engine/ui/account/SignIn.tsx` and `SignIn.test.tsx`; `engine/ui/account/Settings.tsx` and its test;
`instances/divided-world/guide/strategy-guide.md`.

- `SignIn.tsx` near :119, the "New here?" paragraph (shown when not registering), by
  `settings.registrationMode`:
  - `'invite'`: "Registering takes an invite from someone who plays. The same email code signs you in after."
  - `'open'`: "Anyone can register. The same email code signs you in after."
  - `'closed'`: "Registration is closed right now. You can still leave your email; when an admin opens
    registration, your next sign-in opens your account."
- `SignIn.tsx` near :140, the register form's lead when `registering && closed`: "No password. We email you a code
  and a link. Registration is closed, so your account opens once an admin opens it." Otherwise as today.
- `Settings.tsx` near :71, the `framed` row's sentence: "A post quotes one of your characters with words that
  aren't in the post it points to."
- `strategy-guide.md`, the section at "## Coming attractions" (near :150). Replace its heading line, its lead and
  its four bullets with exactly:

  ```
  ## Coming attractions

  Built, and not switched on here yet:

  - **Mod Bots**, The System's henchmen, who visit posts and file reports.
  - **Rules and a warn bar**: rules that never stop you posting, but fill a bar that can end in a timed ban, with the way out stated plainly.
  - **Reports and appeals.**

  Still to come, and subject to change:

  - **More cards.**
  ```

  The paragraph after the list is unchanged.

Tests first, in `SignIn.test.tsx`: one case per mode for the paragraph, and the closed lead. In the Settings test:
the new sentence.

## Task 11. Two checks

Model: sonnet.

Files: new `tools/check-visit-outcome-words.mjs` and `tools/test-visit-outcome-words.mjs`; `tools/check-guide.mjs`
and `tools/test-guide.mjs`; `tools/build.mjs`.

- **`check-visit-outcome-words.mjs`**, after Task 6. A pure
  `export function visitWordFaults({ sqlText, visitText, visitTsxText, modlogText })` and a main that reads every
  migration (concatenated in order) and the three sources from git. It refuses:
  1. an outcome in the SQL's list (the latest `end_visit` check) with no words in `markText`, `tabName`,
     `markLabel` or `modlog.ts`, or words for an outcome the SQL does not allow;
  2. words that say "admin" for an outcome no SQL writer passes a non-null `by_act` for (read each
     `end_visit(…)` call in the latest definition of every function: its outcome and whether its third argument is
     `null`);
  3. a `noticeWords` whose rule test does not accept both "Rule 1: x" and "House Rule 1: x" (import
     `engine/ui/cards/visit.ts` by Node's type stripping, as `check-guide.mjs` imports the guide's renderer, and
     call it with each shape of rule number).

  Self-test poisons, each red: the old `/^Rule \d/iu` test; a `reversed` whose only writer passes a null `by_act`
  while the words say "admin" (which is main before Task 6); an outcome added to the SQL list with no words. Then
  the real tree is clean. Models for the shape: `tools/check-name-folds.mjs` and `tools/check-phrase-sql.mjs`.

  Today nothing writes `reversed` at all, and the words for it say "admin". Refusal 2 allows words for an outcome
  with no writer (the words wait for #315), and refuses "admin" only where a writer exists and names nobody.
- **`check-guide.mjs`**: `guideFaults` (near :111) gains one refusal. A guide whose instance has
  `systemEnabled === false` holds the line "Built, and not switched on here yet:"; one whose instance has it true
  does not. `readInstance` (near :176) already answers the instance's settings. Poisons in `test-guide.mjs`, beside
  its "real tree: poisoned, then as it is" block (near :123): the real guide with that line removed fires; the real
  guide against settings with `systemEnabled: true` fires; each fires once.
- **`build.mjs`**: `'node tools/test-visit-outcome-words.mjs'` immediately before
  `'node tools/check-visit-outcome-words.mjs'` in `STEPS`, the one list (CLAUDE.md, "Two lists that must agree are
  one list").

## Task 12. The build, and the issues

Model: inline.

- `npm run typecheck`, then `npm run build`, with the output in the PR.
- The PR's body says `Closes #68` and `Closes #183`, and lists the items it built in each bundle, for the reviewer
  to tick: #316 (F2, F4, F5 and the proposed check), #371 (the hearer, the pronoun, the guide), #352 (the caught
  price, the wallet's refusal), #258 (the door's words, the log's empty row), #327 (the failed suggestion), #270
  (the tip's refused save), #373 and #271 (the load-error words), #191 (the claim refusal), #138 (the sixth
  question), #443 (the quiz's terms), #336 (the Settings sentence), #5 (the lost answer that was never sent). It
  says that #5's "reacting to a reveal Act" is already right on main and can be ticked. Their parent is #133.

## Review focus

- **Acts an instance already holds.** A `reversed` visit end with a null `by_act` reads as dropped, and a ruling
  with no office stamp names no hearer. Check each reader of both (the Lens, the mark, the visit's page, the
  moderation log, the log) handles the old shape, and that no migration here updates an Act.
- **A resend after "not sent".** `notSent` tells a screen that sending again cannot duplicate. Check each path that
  sets it truly cannot have run the write: the `act` function's flag is set immediately before the write's call,
  and `ran: 'never'` only when every attempt was a 503.
- **A dialog that closes on a write that landed.** After Task 4 a second press cannot send a second reveal. Check
  the three dialogs for a path that leaves the button live after `ok`.
- **The cost of the log's read at a busy instance.** `my_bans` and `my_group_moves` each gain a column read from
  the ruling; `log_page` is bounded by a page. Check the new columns add no read that grows with the instance's
  Acts, with the plan check the file's neighbors use.
- **A mask.** The kinds of failure must not differ with who owns what is read. Check `ReadFailure('server')` for a
  4xx is the same for a row that does not exist and one the caller may not see, as `NOT_READ` was.
- **The settings a screen trusts.** After Task 8 no screen computes a set card's end from the compiled
  `setLasts`. Grep for what is left and read each.
- **Words the owner has not approved.** The `broken` kind's lead on both screens and the ban row's appealed
  sentences are drafts; the PR shows them to the owner.
