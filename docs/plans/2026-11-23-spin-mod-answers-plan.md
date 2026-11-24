# A Mod's answer to a report or an appeal can be spun: the plan

Record, written 2026-11-23. The design is `docs/plans/2026-11-23-spin-mod-answers-design.md`.

It builds on main as it stands and waits on nothing. Line numbers are main's on 2026-11-23; read each function named
below again where it has moved. The migration takes the next free number when the build starts (0420 on this date).

## The layers

- **Engine:** all of it. The place, the box, the plain line's words, the Spin buttons, the readers. The staff role's
  name comes from the instance as it already does (`modRole`, `engine/ui/cards/visit.ts`); a move's group name from
  the instance's groups as the log reads it (`words.instance.groups`, `engine/ui/log/lines.ts`, the appeal loop).
- **Divided World:** nothing changes.

## Words used below

- **An ask:** a `report` or an `appeal` Act.
- **An answer:** a `report_verdict` (its `target_act_id` is the report) or an `appeal_ruling` (its `target_act_id` is
  the appeal). An ask has at most one answer.
- **The punishment:** an appeal's `target_act_id`: an `infraction`, a `ban` or a `move`. An infraction names its post
  in `payload.about_act`; a ban names its infraction in `payload.infraction_act`.
- **The post:** for a report, its `target_act_id`; for an appeal of an infraction or a ban, the infraction's
  `about_act`; an appeal of a move has none.

## Task 1. The place: an ask or an answer is an origin with a place

Model: sonnet

**Files:** `supabase/migrations/0420_spin_answers.sql` (new), `supabase/tests/0420-spin-answers.sql` (new).

`thread_open` (latest in `0396_poll_reads.sql`, section 2) is recreated with one new branch in `origin_place`, before
the last `when o.seq is not null` branch, for `o.kind in ('report', 'report_verdict', 'appeal', 'appeal_ruling')`:

```
{ "kind": "answer",
  "spun": "ask" | "answer",
  "ask": "report" | "appeal",
  "asker": { "id", "name" },            -- the ask's character as acts_public shows it
  "staff": { "id", "name" } | null,     -- the answer's character; null for an ask with no answer yet
  "punishment": "infraction" | "ban" | "move" | null,   -- null for a report
  "group": "<group key>" | null,        -- a move's group, else null
  "on": PostPlace | null }              -- the post (thread, title, seq); a move's line where it has a seq; else null
```

Every other branch and column is as 0396 wrote it; copy the view whole and change only this. Read the names through
`characters_public` and the ask's character through `acts_public`, never `characters.owner`. The joins are
left joins by primary key or by `target_act_id`, met only by a thread whose origin is one of the four kinds.

The same migration recreates `my_reports` and `my_appeals` (`0111_mod_screens.sql`; check no later migration
replaced them) with one column added at the end of each: `verdict_act` (the `report_verdict`'s id, from the join it
already has) and `ruling_act` (the `appeal_ruling`'s id). Their grants stay as they were.

**Tests first** (`supabase/tests/0420-spin-answers.sql`, run with `npm run test:sql` against Postgres on localhost):
seed a report dismissed, a report judged a visit, a backfire, an appeal of an infraction, of a ban and of a move, and a
report with no verdict yet. Spin each ask and each answer (`spin_written`) and assert each thread's `origin_place`
equals the expected object, key for key. Assert a thread spun from a plain post still has its `post` place. Assert
`my_reports.verdict_act` and `my_appeals.ruling_act` for the seeded rows, and null for the unanswered one. Measure a
board's deep page through `thread_list` with half its threads spun from answers, as `0351`'s test measured spin-at-post,
and keep the measurement in the test's comment. Watch each assertion fail before the migration exists.

## Task 2. The types and the readers carry the answer

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`,
`supabase/functions/staff/report.ts`, `supabase/functions/staff/appeal.ts`, and their tests
(`web/src/data/supabase.test.tsx`, `engine/ui/data/fake.test.tsx`, the staff functions' `*.test.ts`).

- `OriginPlace` (api.ts, line 331) gains `| AnswerPlace`, with `AnswerPlace` exported in the shape of Task 1 (`on`
  typed `PostPlace | null`). `toPlace` (supabase.ts, line 327) reads it with every key's type checked; a malformed one
  reads as null, as for every other kind.
- `LogReport` gains `readonly answer: Id | null` (from `verdict_act`), `LogAppeal` the same (from `ruling_act`); the
  `my_reports` and `my_appeals` selects (supabase.ts, line 1267) name the new columns.
- `ReportResult` and `AppealResult` gain `readonly answer: Id | null`. `report.ts` (line 176) and `appeal.ts` (line
  186) add `answer: closed.verdict_act ?? null` and `answer: closed.ruling_act ?? null` to the 200 answer; `fileReport`
  and `fileAppeal` (supabase.ts, line 2021) read it with `str`.
- A new reader, `exchange(origin: Id): Promise<Exchange>` on the API (beside `visitStory`, api.ts line 3040):
  `Exchange = { ask: Act; answer: Act | null; punishment: Act | null }`, read from `acts_public`: the origin; its
  target if it is an answer, or its answer by `target_act_id` and kind if it is an ask; an appeal's punishment. It
  throws where the origin is none of the four kinds, so the box shows Try again.
- `fake.ts`: `originPlace` (line 933) gains the answer branch by Task 1's rules; `fileReport` and `fileAppeal` (lines
  4281, 4345) return `answer`; the log rows carry `answer`; `exchange` is implemented over the fake's Acts.

**Tests first:** `toPlace` on a well-formed and on each malformed answer place; the fake's place for each of Task 1's
seeded cases; `fileReport`/`fileAppeal` carry `answer`; the staff functions' tests assert `answer` in the 200 body;
`exchange` from an ask, from an answer, from an unanswered ask, and its refusal of a post.

## Task 3. The phrase

Model: sonnet

**Files:** `engine/ui/spin/place.ts`, `engine/ui/spin/place.test.ts`, `engine/ui/spin/OriginLink.tsx`.

`placeParts` gains the answer branch. It takes a `groupName: (key: string) => string | undefined` beside `cardName`
(`OriginLink` passes the instance's groups, as the log does). The parts, with `{asker}` and `{staff}` each a link to
`/c/<id>` carrying `character`, and the post `postWords` linked by `onHref`:

| Place | Parts |
|---|---|
| answer to a report | `{staff}` · `'s verdict on ` · `{asker}` · `'s report of ` · post |
| ask, a report | `{asker}` · `'s report of ` · post |
| answer to an appeal | `{staff}` · `'s ruling on ` · `{asker}` · `'s appeal of ` · what |
| ask, an appeal | `{asker}` · `'s appeal of ` · what |

`what` is `the warn points from ` + post, `the ban from ` + post, or `the move into ` + the group's name (linked to
the move's line where `on` is set). Where `on` is null for a report or an infraction, the post reads `a post` with no
link. An answer place with `staff` null reads as its ask. The board's row and the box use the same parts; `OriginLink`
draws avatars only where it is given `faces`, as today.

**Tests first:** a row in `place.test.ts` for each line of the table, each kind of `what`, a null `on`, and `staff`
null; `placeWords` and `placeHref` for one of each.

## Task 4. The plain line's words

Model: haiku

**Files:** `engine/ui/spin/exchange.ts` (new), `engine/ui/spin/exchange.test.ts` (new).

One pure function, `answerWords(answer: Act, punishmentKind: 'infraction' | 'ban' | 'move' | null, hearer: string,
reporter: string, now: number): string`, returning the design's section 3 table, word for word. It reads
`payload.verdict`, `payload.visit_act`, `payload.points_delta` (whole warn points, signed: negative where points came
off, positive where they landed; `close_appeal`, `0361_discipline_cards.sql`, line 1688) and `payload.until`. `{n}` is
the absolute value of `points_delta`, written with a local `plural(n, 'point', 'points')` as `lines.ts` line 603 does.
`{until}` is `utcWhen(until)` imported from `engine/ui/log/lines.ts` (line 142, exported) followed by " UTC". "it
ends" becomes "it ended" where `until` is at or before `now`. An infraction ruling with `points_delta` 0 drops the
clause after the colon ("{Hearer} reduced it.").

**Tests first:** one row for each line of the table, the singular "1 point", and an `until` on each side of `now`.

## Task 5. The ORIGIN box draws the exchange

Model: sonnet

**Files:** `engine/ui/spin/Origin.tsx`, `engine/ui/spin/Exchange.tsx` (new), `engine/ui/spin/spin.css`,
`engine/ui/spin/Spin.test.tsx`, `engine/ui/spin/Spin.stories.tsx`.

- `isPostLike` (line 183) leaves out the four kinds, and `body()`'s switch (line 313) gains a case for them that
  draws `<Exchange origin={act} … />`.
- `Exchange` reads `api.exchange(origin.id)` once when drawn (no subscription, the design's section 3), and draws: the
  ask's byline (`Byline` from `engine/ui/mini.tsx`, linked, with avatar) and the time, the reason or plea as quoted
  words; then the answer's byline with the staff role (`modRole`) and its `payload.line`; then `answerWords` in
  `kb-small`; then "Go to post #N" where the place has a post. With no answer: "Not answered yet." in place of the
  answer and the line. A failed read: the moment's failed state with Try again, as `MomentView` draws it.
- The box's byline over the area (`byline`, line 370) draws none for these kinds: the exchange carries its own two.
- The exchange fills the content area as a post's words do (CLAUDE.md, "An effect fills the post, border to border"):
  it adds no effect, and nothing in it is a rectangle of its own inside the box.

**Tests first** (`Spin.test.tsx`, on the fake): a spun thread from each of Task 1's cases shows the asker's words, the
staff's words, the plain line and the post link; a spin of an unanswered report shows "Not answered yet."; a failed
read shows Try again. Stories: one per verdict and ruling, light and dark.

## Task 6. Spin is offered on the form, the log and the moderation log

Model: sonnet

**Files:** `engine/ui/cards/Forms.tsx`, `engine/ui/cards/Lens.tsx`, `engine/ui/cards/Marks.tsx`,
`engine/ui/thread/Post.tsx`, `engine/ui/log/lines.ts`, `engine/ui/log/Log.tsx`, `engine/ui/profile/Staff.tsx`, and
their tests (`forms.test.tsx`, `Log` and `lines` tests, `Staff` test).

- **The forms.** `ReportForm` (line 115) and `AppealForm` (line 226) take an optional
  `onSpin?: (answer: Id, label: string, opener: HTMLElement) => void`. Where it is given and the result carries an
  `answer`, the result gains a "Spin thread" button (the Lens's `kb-kit-tile kb-lens-action` tile, as `HowRow` draws
  it) after the Mod's words. Every caller is found with a search for `<ReportForm` and `<AppealForm`; a caller inside a
  post (through `Marks` and `Lens`, the `ask` prop) passes the post's `setSpinOrigin`. `BanAppeal` passes its host's,
  where it has one. Label: "Kassie's verdict" / "the Boss's ruling".
- **The log.** `LogRow` (lines.ts, line 65) gains `readonly spinAnswer?: { readonly id: Id; readonly label: string }`,
  set on a report's and an appeal's row where `answer` is not null. `Log.tsx` draws it beside the row's details as a
  link-styled button, "Spin thread", as it draws `appealBan` (line 130), and hosts one `SpinForm` as `Board.tsx` does
  (line 174: `useSpinDrafts`, the origin's state, focus back to the opener on close).
- **The moderation log.** `ModActCells` (Staff.tsx, line 154) draws a "Spin thread" button in the "How it ended" cell
  for a `report` or `appeal` row, spinning `row.act` (`moves_log`'s id for these rows is the verdict's or ruling's,
  `0401_report_no_visit.sql`, line 283). `Staff.tsx` hosts one `SpinForm` the same way. A `visit` row is unchanged.

**Tests first:** the report form with `onSpin` shows Spin thread after an answer and calls it with the answer's id;
without `onSpin`, or with no answer, it shows none. A log row with an answer has the button and opens the spin form;
one without has none. A moderation log report row and appeal row have it; a visit row has none. Each button is
reachable by keyboard and labeled with what it spins ("Spin a thread from Kassie's verdict").

## Task 7. End to end

Model: sonnet

**Files:** `e2e/spin-answers.spec.ts` (new), modeled on `e2e/spin-at-post.spec.ts`.

On the fake: report a post, get a dismissed answer, press Spin thread on the form, post the thread, and see the box
with both bylines, the Mod's words and "dismissed it. No visit opened."; then from the Mod's profile, spin an appeal
ruling's row and see the ruling's plain line. Run the accessibility check the other spin e2e runs.

## Review focus

- A spin of an ask or an answer made before this change, on an instance that holds some (from a visit's rows): it
  should draw the new head and box with no migration of Acts. Check one in the test seed.
- `thread_open` is read by every board page: confirm the new branch's joins are null probes for a thread not spun from
  an ask or an answer, and that the measured deep page did not slow.
- The asker's name in the place must be read as `acts_public` shows the ask's character, never from `characters` with
  its owner: a stand-in where a veil covers it, the character otherwise.
- The plain line must never say why a visit did not open, nor any Aura: those belong to the asker's log.
- The form's Spin button opens the spin form inside the form's own host; check focus returns to the button on close
  and that closing the form does not lose a spin draft (`useSpinDrafts`).
