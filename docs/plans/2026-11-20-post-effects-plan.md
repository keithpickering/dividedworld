# Effects on a post: the plan

Record, written 2026-11-20. Carries out `docs/plans/2026-11-20-post-effects-design.md`. Eight tasks, in order. Each goes test
first, with its red run. Migrations take the next free numbers after `0378_target_lean.sql`. A SQL test goes in
`supabase/tests/` under its migration's number, as `0378-target-lean.sql` does.

Engine or instance, by part: everything below is engine except Task 2's card declarations and Divided World's `postEffects: 8`,
which are instance. Nothing in the engine names a card.

**The words.** One refusal, from the rules and from the database alike, with the instance's number for `N`:

> this post already shows N effects, the most it takes. A slot opens when one ends, is ended by an admin, or its author clears it

It starts lowercase and has no closing period, as `landsOn`'s refusals do; `plainRefusal` (`engine/ui/cards/faces.ts`)
capitalizes it and adds the period. The engine holds it once, as `postFullWords(n)` in `engine/rules/cards.ts`, and the SQL
raises the same text with `%` for the number. A test (Task 4) asserts that the two match.

## Task 1. The rule: a setting, a declaration, a count

Model: sonnet

- **The setting.** `Settings.postEffects: number` (`engine/rules/types.ts`, beside `reactionCap`). Its bound goes in `SETTINGS`
  (`engine/rules/instance.ts`): whole, 1 to 16. Divided World sets 8 (`instances/divided-world/settings.ts`). Every test
  settings literal that builds a full `Settings` gains it; `tsc` finds them.
- **The declaration.** `CardRules.drawsEffect?: { readonly cleared?: (state: unknown) => boolean }`, with a doc comment: the
  card draws an effect on the post it lands on, and counts toward `postEffects` while its play is in force and not `cleared`.
  `instanceProblems` refuses it on a card that does not reach a post (`reachesOf`), or on a set card (`playOf(c) === 'set'`).
- **The view.** `CardEffect` gains `draws?: true` (the card declares `drawsEffect`) and `cleared?: true` (its saved state's
  `cleared` answered true).
- **The count.** In `engine/rules/cards.ts`:
  - `effectsUp(target, effects, now)`: on a post target, the number of the target's own effects (not those above it: `reach`
    unset or `'post'`) that are live (`isLive`) and either a back (`faceDown`) or `draws && !cleared`. It is 0 for any other
    reach.
  - `postFullWords(n)`, the words above.
  - `roomOnPost(rules, settings, target, effects, now)`: a Verdict. It refuses with `postFullWords(settings.postEffects)` when
    the target is a post, the play would count (the card declares `drawsEffect`, or the play is a Set), and
    `effectsUp >= settings.postEffects`. Otherwise it passes.
  - `decidePlay`, `decideUse` and `decideSet` call `roomOnPost` after the card's own landing (`canApply`), so a card's own
    refusal ("already carries that card") is still said first. A Set counts as a back whatever its card.
- **Tests first** in `engine/rules/cards.test.ts`:
  - a post at the limit refuses a drawing cast, a drawing use and any set, in the words above;
  - one below the limit takes each of them;
  - a mark-only card lands on a full post;
  - a cleared drawing play, an ended one (its `ends` passed) and an effect from above each count none;
  - a live back counts one;
  - a target that is not a post is never refused by the count;
  - a card's own stack refusal comes before the count's.
  - Red: no count, so the full post takes the play.
- **Tests first** in `engine/rules/instance.test.ts`:
  - `postEffects` at 0, 17, 2.5 and missing are each named;
  - `drawsEffect` on a character-only card, and on a set card, is named.

## Task 2. Which cards draw, held equal to the screens

Model: sonnet

- **The check.** In `engine/ui/tips/problems.ts`, `instanceUiProblems` gains `drawsEffectProblems`, beside `drawnByProblems`. For
  each card that reaches a post (rules' `reachesOf`), it holds both directions:
  - the card has an `Effect`, or is the `drawnBy` of one, exactly when its rules declare `drawsEffect`;
  - a mismatch is named either way ("card "x" draws an Effect but its rules do not declare drawsEffect", and the reverse).
- **Tests first** in `engine/ui/tips/problems.test.ts`: both poisons (an `Effect` with no declaration, a declaration with no
  `Effect`), and a card that reaches a post with neither. Red on both poisons before the check exists.
- **The instance.** These declare `drawsEffect: {}`, each in `instances/divided-world/cards/<key>.ts`: below-the-fold,
  blind-study, feelin-fab, graffiti, hot-box, jimmy-wails, laugh-track, steel-chair, stick-around, this, whodunnit and
  you-were-saying. Glitter Bomb and Feelin' Glam reach no post and declare none. The check is what proves the list: the
  instance's `instanceUiProblems` test must pass with it.
- **Cleared.** Whoops! (`whoops.ts`) and Autocorrect (`autocorrect.ts`) declare
  `drawsEffect: { cleared: (state) => <state is an object whose clean === true> }`. Tests in `whoops.test.ts` and
  `autocorrect.test.ts`: `{ clean: true }` is cleared; `{ clean: false }`, `{}`, `null` and a string are not.

## Task 3. The database knows what draws and what is cleared

Model: sonnet

One migration.

- **`card_kinds.draws_effect boolean not null default false`**, modeled on `adds_reaction` (`0357_post_veils.sql:50`).
  - `card_kinds_problem` (latest `0376_cushion_kind.sql:22`) checks `drawsEffect` is a boolean where given.
  - `seed_instance` (latest `0377_sealed_packs.sql:130`) writes it in the insert (:197) and in the upsert's set list (:211).
  - `instanceSeed` (`supabase/functions/_shared/seed.ts:80-101`) maps `drawsEffect: c.drawsEffect !== undefined`.
- **`effect_state.cleared boolean not null default false`.**
  - `save_effect_state` (latest `0149_card_writes.sql:502`) gains `cleared boolean` as its last argument and writes it in both
    the insert and the conflict update. The old signature is dropped, and the grants are given again to the new one.
  - The act function (`supabase/functions/act/core.ts:235-254`) sets `args.cleared` to
    `rules.drawsEffect?.cleared?.(validated) === true`, after `validateState` and the hold.
- **`postEffects` in SQL.** `settings_held()` (latest `0377_sealed_packs.sql:513`) bounds it: whole, 1 to 16, beside
  `reactionCap`.
- **`card_target`** (latest `0368_client_reads_plan_once.sql:392`) gives each live play `draws: true` where its kind's
  `draws_effect` is set and `cleared: true` where its `effect_state.cleared` is. `card_target_reach` passes them through. The act
  function then hands them to the rules unchanged, through `effectsOnTarget`.
- **Tests first:**
  - `supabase/tests/0079-settings-held.sql`: `postEffects` rows at 0, 17 and 2.5 are poisons, and 8 is good, as the
    `reactionCap` rows are. `engine/rules/settings-held.test.ts` cross-checks them.
  - A new SQL test for this migration:
    - a seeded drawing card's kind has `draws_effect`;
    - `save_effect_state(..., true)` stores `cleared`, and a later save with false clears it;
    - `card_target` shows `draws` and `cleared` on a play.
    - Red: the columns are missing.
  - `supabase/functions/act/core.test.ts`: a Whoops! save of `{ strokes: [], clean: true }` calls `save_effect_state` with
    `cleared: true`, and one without `clean` calls it with false.
  - `supabase/functions/_shared/seed.test.ts`: the seeded payload carries `drawsEffect` for a declaring card.

## Task 4. `play_post`, the count in SQL, and the spring

Model: sonnet

One migration.

- **The table.** `play_post (play uuid primary key references acts, post uuid not null references acts, card text, created_at
  timestamptz not null, ends_at timestamptz)`.
  - `card` is null for a back (`set`). `ends_at` null means no end.
  - Indexes: `(post, ends_at)` and `(post, ends_at desc, created_at desc, play)`.
  - Row-level security is on, and nothing is granted to `anon` or `authenticated`. It is read only through the functions
    below, as `play_reach` is.
- **The triggers** (`after insert`, in the style of `acts_veil_cover`, `0371_veil_cover.sql:95`):
  - On `acts`, for a `card` or `set` with a `target_act_id`: insert the row.
    - `ends_at` is the payload's `ends`, or for a set its `face_down.ends_at`.
    - For a card whose payload has `caught` or `instant`, it is `created_at`.
    - A beyond-a-post play carried on the post it was played from is written too, since `thread_page` carries it today. Its
      `ends_at` is its `ends`.
  - On `acts`, for `card_end`, `spring` and `take_back`: set the ended play's `ends_at` to `least(coalesce(ends_at, infinity),
    created_at)`. The ended play is `target_act_id` for `card_end`, and `payload ->> 'set'` for `spring` and `take_back`.
  - On `card_write_refunds`, the same for the refunded play (an untaken play).
  - These are the only writes to `play_post`.
- **The backfill.** The same rules, over every `card` and `set` Act with a target, and every ending Act and refund already
  held, in the migration.
- **The count.** `post_effects_up(post uuid) returns integer`, `stable`, `security definer`, `search_path` set. It counts the
  post's `play_post` rows with `ends_at is null or ends_at > now()` where either:
  - `card is null` and the back is live: not sprung, not taken back, `face_down.ends_at > now()`; or
  - the card's kind has `draws_effect`, and its play's `effect_state.cleared` is not true.
  It reads the probe on `(post, ends_at)`.
- **`place_cast`** (latest `0374_cards_on_a_spun_thread.sql:163`), in the post branch, after the stack refusals (:313-317),
  under the lock taken at :241: where `kind_of.draws_effect` and `post_effects_up(target) >= setting('postEffects')::integer`,
  raise the words above with `hint = 'kayfabb.refusal'` and `errcode = '23505'`.
- **`place_set`** (same file, :491): the same check after the live-back refusal (:591-595), under its lock (:581), for every
  set.
- **The surface card's play** (`play_surface_card`, `0317_surfaces.sql`): if it writes its card Act without `place_cast`, it
  makes the same check under its post lock. The task reads it and says which in its report.
- **The spring.** `spring_facts` (latest `0374:717`) gains `room boolean`: true unless the sprung card's kind draws and
  `post_effects_up(by_post) >= setting('postEffects')`. `spring_traps` (latest `0357_post_veils.sql:962`) adds `and f.room` to
  the post reach's `lands` (:994). A Move that cannot land leaves its back set, as for a full stack.
- **Tests first,** in a new SQL test:
  - At `postEffects` 2, two drawing casts land, and a third is refused in the words above.
  - A mark-only cast lands on the full post.
  - Saving `cleared` true on one frees a slot, and the third lands. Saving false again leaves three in force and refuses a
    fourth: it draws over and is never refused itself.
  - A set on a full post is refused, and a live back counts one.
  - A back taken back frees its slot, through the `take_back` trigger.
  - An admin's `card_end` frees a slot.
  - A play whose `ends` has passed frees one.
  - A Move whose quoting post is full does not spring, and its back stays set.
  - Every `play_post` row the backfill writes matches the trigger's row for an Act inserted afresh.
  - Red: no table, no count.
- **The words' test.** `engine/rules/cards.test.ts` reads this migration's file and asserts that the raised text, with `%`
  replaced by a number, equals `postFullWords` of that number.

## Task 5. One read of a post's plays

Model: sonnet

One migration.

- **`post_plays(posts uuid[])`**, `stable`, `security definer`, granted as `drive_gifts_page` (`0368:458`) is. For each post,
  its `play_post` rows:
  - **in force:** `ends_at is null or ends_at > now()`, all of them;
  - **ended:** the newest 8 by `ends_at desc, created_at desc, play` (`ENDED_PER_POST`).
  It returns:
  - each of those rows' Acts from `acts_public` (never `acts`), in the shape `thread_page`'s `on_posts` gives today;
  - the `card_end` of each, and the `spring` of each back, as `ends_on_posts` gives today;
  - `more`: the posts that have a ninth ended play. This is a `limit 9` probe, never a count.
- **`earlier_plays(post uuid, before_ends timestamptz, before_play uuid)`**: the next 20 ended plays on one post before that
  place in the same order, with their ends and springs, and `more`. The Lens pages with it.
- **`thread_page`** (latest `0375_spun_thread_reads.sql:40`):
  - `on_posts` and `ends_on_posts` (:219-283) read from `post_plays`, over the page's posts and their nested posts.
  - The ORIGIN box's `o_plays`, `o_shown` and `o_ends` (:390-403) read from `post_plays` for the origin Act. Its `more` is
    `post_plays`'s.
  - The page carries `'more'` (post ids) beside `'plays'`.
  - Whatever else reads `on_posts` (`spent`, `surfaces`, about :571-576) reads the same rows.
- **Tests first** in a new SQL test:
  - a post with 3 plays in force, the oldest of them a cast with no end, followed by 30 ended plays: `post_plays` returns the 3
    and the newest 8 ended, and names the post in `more`;
  - `earlier_plays` from the eighth returns the next 20 and says more, and from the 28th returns 2 and says none;
  - a back and its spring come together;
  - a back's hidden card is in no row;
  - `thread_page`'s plays for that post equal `post_plays`'s.
  - Red: the oldest 8 by creation drop the cast in force.
- **The plan check.** An `explain` assertion, as the suite's existing plan checks do, on a post holding 2,000 ended plays and
  3 in force: `post_plays` uses `play_post`'s indexes and reads no more than about 20 `play_post` rows for it. Seed the 2,000
  in the test, so the check is not made on a toy fixture (#580).

## Task 6. The client reads the same shape

Model: sonnet

- **`KayfaApi`** (`engine/ui/data/api.ts`):
  - `cardsOn(act)` and `cardsOnMany(acts)` take no limit and return `{ acts: readonly Act[]; more: readonly Id[] }`.
  - The new `earlierPlays(post, before: { ends: string; play: Id })` returns `{ acts, more: boolean }`.
  - `ThreadPage` gains `more: readonly Id[]`.
  - The doc comments say what each holds: every play in force, the newest 8 ended, and `more`.
- **`web/src/data/supabase.ts`:**
  - `cardsOn` and `cardsOnMany` (:1511-1523) call `post_plays`; `earlierPlays` calls `earlier_plays`;
  - `threadPage` (:1848-1891) maps `more`;
  - `LAYER_KINDS`, `endsOf` and `merged` go where nothing else uses them.
- **`engine/ui/data/fake.ts`:**
  - `cardsOnMany` (:3749) and `cardsOn` (:3950) answer by the same rule: in force, the newest 8 ended by end then creation,
    and `more`;
  - `earlierPlays` likewise;
  - the thread page (:4204) and the ORIGIN box (:4220-4230) use them.
- **Callers.** `PLAYS_PER_POST` is deleted from `engine/ui/cards/plays.ts:24`. Its callers take the new shape:
  - `readPlays` (plays.ts:630, which has no caller: delete it if it still has none);
  - `Effects.tsx:107`;
  - `PlayForm.tsx:274`;
  - `thread/lines.tsx:93`;
  - `fake.ts`.
  The plays store (`createPlays`) keeps `more` per post: `Plays.more(post)`, and `Plays.setMore(posts)` from `hydrate` and from
  each read.
- **Tests first:**
  - `engine/ui/data/fake.test.tsx` (:1156-1166 now tests a page-wide limit): the new rule, with the cast-in-force-behind-30-ended
    case and `more`;
  - `earlierPlays` paging;
  - a store test that `hydrate` keeps `more`.
  - Red: today's limit drops the old cast.

## Task 7. The screens: the form, the marks and the Lens

Model: sonnet

- **`engine/ui/cards/land.ts`:**
  - `effectsOf` gains the store's saved states. It gives `draws` from the card's rules (`drawsEffect`) and `cleared` from
    `drawsEffect.cleared(state)`, so the screen counts as `card_target` does.
  - `LandingContext` gains `postEffects: number`. `landingOn` passes `{ postEffects: context.postEffects }` as the settings it
    gives `decidePlay`, `decideUse` and `decideSet` (today `{} as never`, :98-100), so `roomOnPost` reads the instance's
    number. `waysOn` takes it too.
  - The callers (`PlayForm.tsx:145-168`, `PlayActions.tsx:63` and `:160`) pass `instance.settings.postEffects` and the store's
    states.
- **The form.** A drawing card on a full post shows `plainRefusal(lands.why)` where a refusal shows today (`PlayForm.tsx:405`
  for a set, `:419` for a cast). No new element.
- **The ghost mark.** Its refusal already hides it (`PlayActions.tsx:64`). Nothing new: a full post draws no drawing card's
  ghost mark, and still draws a mark-only card's.
- **The Lens** (`engine/ui/cards/Lens.tsx`): where `Plays.more(post)` is true, the Lens ends, under its tabs, with a button,
  "Show earlier plays".
  - It reads `earlierPlays` from the oldest ended play the store holds for the post, and adds what comes back to the store.
    New kinds' tabs then appear as any play's do.
  - It is disabled while reading. On failure it says "Those didn't load." with "Try again", as the trophy lineage does
    (`engine/ui/profile/TrophyCase.tsx:105-163`).
  - It goes away when `more` is false.
  - Focus stays on the button through a load, and moves to the first new row when a load adds rows to the open tab.
- **Tests first:**
  - `engine/ui/cards/land` tests (`reach.test.tsx` or a new `room.test.tsx`): a full post refuses a drawing card, in the words,
    and takes a mark-only card. A cleared Whoops! frees the slot on the screen as on the server.
  - `engine/ui/cards/lens.test.tsx`: the button shows only with `more`. A press loads and adds a tab. A failure says so and
    retries. Keyboard focus is held.
  - A board story (`engine/ui/cards/Marks.board.stories.tsx` or `Lens`'s) of a full post: the form's words, and a Lens with
    earlier plays.
  - Red: no room check on the screen, so the form offers the card.

## Task 8. The Mod Bots offer only what can land

Model: sonnet

- **`supabase/functions/chatter/core.ts`:** where `offered` is built (:311-314), when a cast would quote a post, read
  `post_effects_up` for it once, with `postEffects` from the settings already in hand. If the post is full, leave out every
  drawing cast from `offered`.
  - A Set lands on the persona's own new post, so it is offered as today.
  - `decideOptions` (:501-523) is unchanged: it still decides with `decidePlay`, which holds the limit if the post fills
    between the offer and the play.
- **Tests first** in `supabase/functions/chatter/core.test.ts`:
  - with the quoted post full, no drawing card is offered and a mark-only card is;
  - with room, both are offered.
  - Red: the drawing card is offered.

## Review focus

- **Plays already held.** `play_post`'s backfill against plays that ended in every way (time, `card_end`, spring, take back,
  caught, untaken, instant), and against beyond-a-post plays carried on a post. A row whose `ends_at` is wrong is a play drawn
  forever, or one dropped from the page.
- **The triggers.** Is any writer of a `card` or `set` Act, or of an end, missed (`lay_sprung`, the surface card's play,
  `staff_play_card`, `staff_play_surface_card`, an admin's reversal)? Can a trigger's ordering inside one statement (a cast
  that springs a back) leave a row unended?
- **A busy instance.** Is `post_plays` two bounded probes per post on a page of 20 to 50 posts? Is `post_effects_up` an index
  probe and not a scan? Does the extra lock in `place_set` widen a contention window?
- **A second run or a race.** Two casts for the last slot, a cast against a set, and a spring against a cast, each under the
  post's lock. An un-clear on a full post is never refused after the fact.
- **The masks.** The count, the refusal and its timing must not differ with what a back hides, beyond what the stack's own
  room test already shows at a spring. `play_post.card` must be null for a back. `post_plays` must read only `acts_public`.
- **The screen and the server agree.** `effectsOf` and `card_target` must give the same `draws` and `cleared` for the same
  post, so the form never offers what the server refuses.
- **Settings tuned down.** A post above a lowered `postEffects` draws everything it holds, refuses new drawing plays, and is
  never touched.
