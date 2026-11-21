Record, written 2026-11-21.

# Time Machine, and rewinding and freezing a post: plan

Carries out `docs/plans/2026-11-21-time-machine-design.md` (the design; its section numbers are cited as "design,
4.2"). A build session (`.claude/skills/build-session/SKILL.md`) builds it from this file alone.

**When it may start.** After SoVeryHappy (#936, `docs/plans/2026-11-21-so-very-happy-plan.md`) and Buzzkill
(`docs/plans/2026-11-21-buzzkill-plan.md`) have both merged: each redefines objects this plan redefines (design,
section 8). It may not start while any other build redefines an object in the table below; it checks open PRs for a
migration that does.

**The shared SQL this build redefines.** Each is copied whole from its latest migration on `main` **at the time this
build starts**, with only the change named. Find each one's latest with
`grep -l -E "function (public\.)?<name>\(" supabase/migrations/*.sql | tail -1`. The column below is `main` at
`d39e456`; the builds named will have moved most of them.

| Object | Latest at `d39e456` | Also redefined by | Change |
|---|---|---|---|
| `card_kinds_problem(cards jsonb)` | `0400_pierce.sql` | #936, Buzzkill | the rewind's checks (Task 2, item 2) |
| `seed_instance` | `0397_refund_outcome.sql` | Buzzkill | seeds `rewind` |
| `place_cast` | `0400_pierce.sql` | #936, Buzzkill | the point, the freeze, no spring under a rewind |
| `place_set` | `0397_refund_outcome.sql` | #936 | the freeze; a rewind card is never set |
| `card_target(target uuid)` | `0393_forged_quotes.sql` | none known | a post's effect carries `rewind` |
| `thread_page` | `0396_poll_reads.sql` | #936 | a `rewinds` list |

New objects, which no other build defines: the column `card_kinds.rewind` and its check constraint
`card_kinds_rewind_rarity`; the functions `rewind_point_at`, `rewind_point_problem`, `live_rewind`,
`rewind_refusal` and `rewind_view`. Not touched: `spring_traps`, `reverse_card`, `edit_post`, `acts_public`, settlement.

**The migration** is `supabase/migrations/NNNN_rewind.sql`, with its test `supabase/tests/NNNN-rewind.sql`. `NNNN` is
one above the highest number in `supabase/migrations/` on `main` **at the time this build merges** (0400 at
`d39e456`; #936 takes 0401). If main moves past it before merging, the build renames both files and says so in the PR.

**Copy.** In every word a player reads, the verb is "play" and never "cast", and a Move is a "Move". Code identifiers
(`place_cast`, `decidePlay`, `play: 'cast'`) are unchanged.

**The layers.** Tasks 1 to 5 are engine and name no card or class. Task 6 is Divided World's alone.

## Task 1. The rewind in the engine's rules

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts`, a new `engine/rules/rewind.ts`, and their tests
(`cards.test.ts`, `instance.test.ts`, a new `rewind.test.ts`).

1. `CardRules.rewind?: { readonly upTo: Rarity }`, with a doc comment from design section 3.
2. `CardEffect.rewind?: { readonly upTo: Rarity }`: what `card_target` will send for a live rewind play's effect.
3. `faceUpOnly` takes `rewind` (a rewind card is never set face down), and its Pick gains `'rewind'`.
4. `staffOffers` returns false for a card with a `rewind`, with a comment: a persona's play has no point to pick.
5. `rewindWords(name, upTo, ends)`: `this post's ${name} turns away cards up to ${upTo} until ${refusalTime(ends)}`.
6. The freeze, in `decidePlay`, `decideUse` and `decideSet`: on a post target, a live effect (`isLive`) with a
   `rewind` whose `upTo` the incoming card is at or below (`atOrBelow`) refuses with `rewindWords`. In `decidePlay` a
   pierce passes it as it passes a ward: when the rewind's card is no rarer than `context.pierce` (`pierced`). It is
   checked after the ward and before `disciplineRefusal`.
7. `instance.ts`: `rewindProblems(c, who, play)`, called beside `veilProblems` in `playProblems`. Sentences, each a
   problem when broken: only a cast card has a rewind; a rewind reaches a post alone; a rewind has a `lasts`; its
   `upTo` is one of `RARITIES`; a card with a rewind has no `gimmick`, `veil`, `reaction`, `writes`, `replies`,
   `draws`, `drive` or `surface`. Each as `${who} has a rewind, and ...`.
8. `engine/rules/rewind.ts`, pure and vendor-free:
   - `type Version = { readonly id: Id; readonly at: string }` (the post's own Act or an `edit` Act).
   - `pointAt(post: Version, version: Version, grace: Span): string | null`: the post itself gives its time plus the
     grace; an edit after the grace window gives its own time; an edit inside it gives null (design, 4.1).
   - `rewindPoints(post, edits, plays, grace, now)`: the offered points, oldest first, as
     `{ version: Id, at: string, first: boolean }`. A point is offered when some version's time is later than its
     `at`, or some play in `plays` played later than its `at` still shows (`shownPlays`' rule, given as a predicate
     so this file imports no UI).
   - `rewindConfig(value)`: the `validateConfig` a rewind card uses: `{ to }`, a non-empty string; refused words "pick
     a point from this post's History".

**Tests first** (each run red before the code):
- `rewind.test.ts`: `pointAt` for the post, for an edit one second inside the grace (null), one second past it, and
  for a grace of zero. `rewindPoints` on: a post never edited with no plays (none); edited once inside the grace only
  (none); edited past the grace (the first point); a Whoops! played after the last edit and still showing (the last
  edit's point and the first); the same play ended (none from it).
- `cards.test.ts`: a Move up to rare refused on a post with a live rewind (`upTo: 'rare'`), with `rewindWords`'
  exact words; a legendary Move passes; a Use and a Set refused likewise; an ended rewind (past `ends`) refuses
  nothing; a pierce `upTo: 'rare'` passes and `upTo: 'uncommon'` does not; `faceUpOnly` true for a rewind card;
  `staffOffers` false.
- `instance.test.ts`: each sentence of item 7 driven red by a poisoned card (a Use with a rewind; a rewind reaching
  `['post', 'thread']`; no `lasts`; `upTo: 'mythic'`; a rewind with a `gimmick`), and a well-formed rewind card with
  no problem.

## Task 2. SQL: the column, the checks, the point, the freeze and the reads

Model: sonnet

**Files:** `supabase/migrations/NNNN_rewind.sql`, `supabase/tests/NNNN-rewind.sql`,
`supabase/functions/_shared/seed.ts`.

The migration opens with a header comment naming this plan and the design, and listing each object with its change
and the migration it was copied from.

1. `alter table card_kinds add column rewind text`, with `constraint card_kinds_rewind_rarity check (rewind is null or
   rewind in (<the rarity list rarity_rank reads>))`.
2. `card_kinds_problem`, copied whole: Task 1 item 7's sentences, as `card "%s" has a rewind, and ...`, reading
   `c.e -> 'rewind' ->> 'upTo'`.
3. `seed_instance`, copied whole: the insert's column list and `select` gain `rewind`
   (`e #>> '{rewind,upTo}'`). `seed.ts` maps `CardRules.rewind` into the seeded JSON beside `veil`.
4. `rewind_point_at(post uuid, version uuid) returns timestamptz`, stable: the post's `created_at` plus `editGrace`
   (read as `acts_public` reads it, `0395_polls.sql` near line 777) when `version = post`; an `edit` Act of that post
   saved after that time gives its own `created_at`; anything else gives null.
5. `rewind_point_problem(post uuid, version uuid) returns text`: null when the point is offered (design, 4.1),
   reading versions from `acts` and plays through `card_ended`, the play's `ends`, `caught` and taken-back backs,
   the same rule the client's `shownPlays` holds. Else, in this order: "pick a point from this post's History" (not
   this post's version); "that version was saved in the edit grace window, so it is part of the post as first
   posted"; "this post shows the same at that point as it does now".
6. `live_rewind(post uuid) returns table(play uuid, up_to text, card text, at timestamptz, ends timestamptz)`: the
   post's `card` Acts whose kind has a `rewind`, not `card_ended`, `ends > now()`, with `at` read from the play's
   `payload ->> 'rewind_at'`; latest played first.
7. `rewind_refusal(post uuid, incoming card_kinds, passing text default null) returns text`: for the first
   `live_rewind` row whose `up_to` the incoming rarity is at or below (`rarity_rank`) and which `passing` does not
   pass (as `ward_refusal`, `0400_pierce.sql` line 318), the words of Task 1 item 5, with the card's name from
   `card_kinds` and the time in the format `refusalTime` mirrors (copy the one `place_cast` already uses for a
   no-quote's "until").
8. `rewind_view(play uuid) returns jsonb`, granted to `authenticated` and `anon` as `play_moment` is:
   `{ play, post, at, version }`, where `version` is built exactly as `play_moment`'s `version`
   (`0375_spun_thread_reads.sql`, near line 635) for the latest version saved at or before `at`, through
   `shown_payload`. Null for a play that is not a rewind.
9. `place_cast`, copied whole:
   - For a card with `rewind` (cast branch, post reach): `perform` the problem check: if
     `rewind_point_problem(target, (config ->> 'to')::uuid)` is not null, raise it with `hint = 'kayfabb.refusal'`
     and the errcode the other configuration refusals use. Write `rewind_at` =
     `rewind_point_at(target, (config ->> 'to')::uuid)` into the card Act's payload beside `ends`.
   - The freeze, in the cast and the use branches, for a post target, right after the Ward check
     (`ward_refusal`, near line 550) with the same `shot_up_to` passing: `rewind_refusal(target, kind_of, shot_up_to)`
     raised as a refusal.
   - Where `spring_traps` is called for a post: skipped when `live_rewind(target)` has a row, including for the play
     that is itself the rewind (it lands frozen).
10. `place_set`, copied whole: a card whose kind has a `rewind` is refused ("{name} is played face up and never set
    face down"); and `rewind_refusal(target, kind_of)` is asked before anything is written.
11. `card_target`, copied whole: a post's effect object gains `'rewind', case when ck.rewind is not null then
    jsonb_build_object('upTo', ck.rewind) end` inside its `jsonb_strip_nulls`.
12. `thread_page`, copied whole: a top-level `rewinds` key, a list of `rewind_view(r.play)` for the `live_rewind`
    of each post on the page and of the ORIGIN post, gathered in one CTE over the page's post ids (design, 7).

**Tests first**, in `NNNN-rewind.sql`, each red before the migration exists. Use the fixtures the latest card tests
use (`0400-pierce.sql`).
- A seeded rewind card passes `card_kinds_problem`. Poisons, each naming its sentence: a Use with a rewind; a rewind
  with `upTo` 'mythic'; no `lasts`; a rewind and a `gimmick`; reaching a thread.
- `rewind_point_at`: the post, an edit inside the grace (null), an edit past it, another post's edit (null).
- `rewind_point_problem`: each of item 5's words, and null for an offered point.
- `place_cast` of the rewind card: refused on a post never edited past the grace with no plays; lands with a
  `rewind_at` naming the point; a second rewind card (rare) on the post refused with the freeze's words.
- The freeze: a common Move, an uncommon Use on the author's own post, and a rare Set are refused while it is up; a
  legendary Move lands and springs no back already face down there (the back is still face down after); after an
  admin's `reverse_card` of the rewind, the common Move lands; after `ends` passes (set the play's `ends` in the
  past through the test's own setup, as the other time tests do), it lands.
- `edit_post` by the author during the rewind lands and `acts_public.current_payload` is the new body, while
  `rewind_view` still gives the old.
- `rewind_view` of a point whose version an admin has hidden gives the hidden placeholder, as `history` does.
- `thread_page` carries the rewind in `rewinds` for its post, and for the ORIGIN post of a spun thread; nothing once
  it is ended.
- `card_target` of the post carries `rewind: { upTo: 'rare' }` on the rewind's effect.
- `explain` of `thread_page`'s rewind CTE on a page of 25 posts uses the index `card_target` uses for card plays by
  target, not a sequential scan of `acts`.

## Task 3. The data layer and the fake

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, and their tests.

1. `api.ts`: `interface Rewind { readonly play: Id; readonly post: Id; readonly at: string; readonly version: Act }`;
   `ThreadPage.rewinds: readonly Rewind[]`; `rewindView(play: Id): Promise<Rewind | null>` beside `playMoment`.
2. `supabase.ts`: `threadPage` passes `rewinds` through (empty when absent); `rewindView` calls `rewind_view`.
3. `fake.ts`: `playCard` (near line 2322) does what Task 2's `place_cast` does: the point check with the same words,
   `rewind_at` on the play, the freeze, no spring under a live rewind. `setCard` (near line 2734) the freeze and the
   face-up refusal. The fake's card effects carry `rewind`. Its thread page carries `rewinds`; its `rewindView`
   builds the version as its `momentOf` does (near line 1818). Its edits during a rewind behave as Task 2's test says.

**Tests first:** the fake's own tests (`engine/ui/data/fake.test.ts` or the file its `playCard` tests live in) for
each refusal and for `rewinds` on the page, mirroring Task 2's list; `supabase.test.tsx` for `rewinds` and
`rewindView`'s mapping.

## Task 4. Drawing a rewound post

Model: sonnet

**Files:** `engine/ui/cards/plays.ts`, `engine/ui/cards/Effects.tsx`, `engine/ui/cards/Marks.tsx`,
`engine/ui/thread/Post.tsx`, `engine/ui/thread/lines.tsx`, `engine/ui/spin/Origin.tsx`, `engine/ui/thread/Thread.tsx`,
and their tests.

1. `plays.ts`: the store keeps rewinds by post, filled by `hydrate` from `ThreadPage.rewinds`.
   `rewoundPlays(plays, rewind, rewindPlayAt)`: keeps a play played at or before `rewind.at`, or at or after the
   rewind play itself; drops the rest (design, 4.2). A pure function with its own tests.
2. A live rewind play that arrives on the page without a view (a play landing while the reader is there) is read once
   with `api.rewindView`, kept by play id, and drawn when it is in, never flashing the present first after it is in
   (the post shows as it was until the view arrives, then rewinds once).
3. `Post.tsx` and `Origin.tsx` (the live ORIGIN box only; a moment box is unchanged): where the post has a live
   rewind (its play not over by `playOver`), the words are `bodyOf(rewind.version)`, the plays given to
   `PostEffects` and to the marks are `rewoundPlays`' result, and `LastEdited` reads the rewound version.
4. `Thread.tsx`'s quote (near line 893) and the last post's quick quote (near line 937) take the words the post shows:
   the rewound version's body while a rewind is live.
5. History, previews, search and the profile are not changed (design, 4.4).

**Tests first:** `plays.test.ts` for `rewoundPlays` (a play before the point, after it, the rewind itself, a
legendary after the rewind); `Effects.test.tsx` or `Post` tests: a post with a live rewind draws the old words and
not the new, hides a Whoops! played after the point and keeps one before it, and draws everything again once the
rewind's `ends` passes; the ORIGIN box's live view likewise; the quote takes the rewound words.

## Task 5. The Lens, the play form and the log

Model: sonnet

**Files:** `engine/ui/cards/Lens.tsx`, `engine/ui/cards/lens-words.ts`, `engine/ui/cards/PlayForm.tsx`, a new
`engine/ui/cards/RewindPoints.tsx`, `engine/ui/cards/types.ts`, the log's play line where `logPlay` is called, and
their tests.

1. **Return to present** (design, 4.5): on the Lens of a live play whose card has a `rewind`, a tile beside "As it
   landed", labelled "Return to present", `aria-pressed`. Pressed, the post's body shows the newest version with every
   shown play and without the rewind play's own effect, inside `MomentFrame` tagged "The present"; pressed again, or
   when "As it landed" is pressed, it goes back. It uses the Lens store's one shown view, as `AsItLanded` does
   (`showMoment`), with a marker that names the present for that play.
2. **The hidden count**: on that Lens, when `rewoundPlays` drops any, the line "1 later card hidden until it ends" or
   "{n} later cards hidden until it ends", from the plays on the page.
3. **The point picker**: `PlayForm` draws `RewindPoints` in place of a card's `ConfigForm` when the card's rules have a
   `rewind`. It reads `api.history(post)`, offers `rewindPoints`' points as a radio group with the legend "Rewind to",
   each labelled "As first posted, {date}" or "Edit of {date}" in the reader's time zone, with the version's first 80
   characters beneath, and sets `{ to }`. With no point offered it says "Nothing to rewind on this post" and the play
   button stays off. Keyboard and labels as every form in `Forms.tsx`.
4. **The log**: `CardUi.logPlay`'s `recorded` gains `rewindsTo?: string`, filled from the play's `rewind_at`, so a card
   can name the point's date.
5. The words of items 1 to 3 go in `lens-words.ts` (or the engine's word list the form's other words use), each
   checked by `lens-words.test.ts` as the others are.

**Tests first:** the Lens test shows the tile only for a rewind play, toggles the body between rewound and present,
and the count's two forms; the form test offers the right points for a post with one edit past the grace and a later
play, says "Nothing to rewind" for a post with none, and submits `{ to }`; the log test passes `rewindsTo`.

## Task 6. Time Machine

Model: sonnet

**Files:** `instances/divided-world/cards/time-machine.ts` and `time-machine.test.ts`;
`instances/divided-world/ui/cards/time-machine/ui.ts`, `ui.test.tsx` and its stylesheet beside it (as
`steel-chair` keeps its own); one line each in `instances/divided-world/cards/index.ts`,
`instances/divided-world/ui/cards.ts` and `instances/divided-world/cards/cards.test.ts`'s key and price list, sorted
between `this` and `toll`. The art in the folder is already there.

1. The rules: key `time-machine`, name "Time Machine", alignment `pepperoni`, rarity `rare`, play `cast`, reaches
   `['post']`, `lasts: { unit: 'day', count: 3 }`, `rewind: { upTo: 'rare' }`, `playPrice: () => 0`,
   `validateConfig: rewindConfig`, `canApply` by `landsOn`. Price 300.
2. The words (design, section 1): tagline "Go back to better days."; summary "Played on a post. For 3 days it shows
   as it was at an earlier point you pick, and no card up to rare can be played on it."; `describe` the same with the
   numbers read from the rules (3 days, rare) and never restated; status "Showing an earlier version"; hint "This post
   is showing an earlier version. Its History has the rest."; `logPlay` "That post shows as it was on {date} until it
   ends." with `{date}` from `recorded.rewindsTo`, or undefined without it.
3. The `Effect` (design, 4.6): it wraps `children` (the engine has already swapped in the rewound words) in a box that
   fills the post's content area border to border, in a thread and in the ORIGIN box, with:
   - scanlines: `repeating-linear-gradient(0deg, rgba(0,0,0,.05) 0 1px, transparent 1px 3px)`;
   - the tracking line: a 7px soft band (`linear-gradient(90deg, transparent, rgba(0,0,0,.12), rgba(255,255,255,.7),
     rgba(0,0,0,.12), transparent)`, blurred 1px) drifting top to bottom over 9s, wrapping;
   - the read-out: "◀◀ PLAY" and the point's date, `NOV 14 9:02PM` (month, day, 12-hour time, uppercase, reader's
     time zone), top right, bold 13px Courier, color `#0b7a5e` (at least 4.5:1 on white; the test checks the ratio
     with the engine's contrast helper if one exists, else a literal assertion of the value), `aria-hidden`, with a
     visually hidden "Showing this post as it was on {date}";
   - on first draw per play per page load, a 600ms rewind: horizontal streaks moving right to left across the area;
   - under reduced motion: no rewind streak, the tracking line held still;
   - every layer `pointer-events: none`.
   The date comes from the play's `rewind_at` as the effect's play carries it; the build reads how a card's `Effect`
   receives its play's payload and uses that.
4. Registration: the three list lines; `cards.test.ts`'s row `['time-machine', 'pepperoni', 300]`.

**Tests first:** `time-machine.test.ts`: the rules pass `instanceProblems`; `validateConfig` takes `{ to }` and
refuses `{}`; `faceUpOnly` and not `staffOffers`. `ui.test.tsx`: the effect draws its children, the read-out's date,
the hidden label, no streak under reduced motion, and fills the content area (the box is the effect's outermost
element with no margin and the post's padding, as Whoops!'s test checks its fill).

## Task 7. The build

Model: inline

Run `npm run typecheck`, `npm run build` and `npm run test:sql`, and put the tails in the PR. Confirm the migration's
number is one above `main`'s highest. Take two screenshots for the PR at deviceScaleFactor 2: a rewound post in a
thread, and the same post's Lens with "Return to present" pressed. File any dead end found as an issue the same day.

## Review focus

- **The copied SQL.** `card_kinds_problem`, `seed_instance`, `place_cast`, `place_set`, `card_target` and
  `thread_page` must be copied from their latest after SoVeryHappy and Buzzkill merged, keeping the lockout, the cut
  and the pierce whole; diff each against its source migration.
- **Every path to a spring on a post.** `place_cast` skips `spring_traps` under a live rewind; check no other caller
  (a staff play, a thread or character reach landing on the post, a reply) springs a back on a rewound post.
- **Acts an instance already holds.** A post edited before this ships has versions whose grace is read from today's
  `editGrace`; check that a changed grace setting cannot make `rewind_point_at` disagree with the History the post
  already shows.
- **The present never flashes.** A rewound post's first paint, on a page load and in the ORIGIN box, must be the
  rewound version; check the hydrate order.
- **A mask.** The freeze's refusal and the point's refusals must read nothing about who owns the post or the
  character playing; check that `rewind_view` goes through `shown_payload` so an admin-hidden version never shows.
- **A busy instance.** `thread_page`'s rewind CTE runs once per page over the page's posts; check the `explain`.
- **Hidden plays still score.** Nothing in settlement or `card_ended` may read a rewind as ending the plays it hides.
