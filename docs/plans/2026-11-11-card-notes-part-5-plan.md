# Card notes, Part 5: the Happy Hearts, Take the Fall and Tattle-Tale: plan

Record, written 2026-11-11. The plan for Part 5 of `docs/plans/2026-11-11-card-notes-design.md` (its section 2 entries
"Happy Heart, Super Happy Heart, Ultra Happy Heart", "Take the Fall" and "Tattle-Tale"; section 5 holds the owner's
answers), built by one build session in one PR, from `main`. It leans on `docs/plans/2026-11-06-mod-bots-design.md`
(sections 5, 6 and 8), `docs/plans/2026-10-30-the-system-design.md` (section 10) and
`docs/plans/2026-11-11-card-types-design.md`.

Every task is test first: the test named, its red run recorded, then the code. No `tools/check-*.mjs` is added; the
one SQL check that gains a branch names its poison (Task 5). No deployed database, bucket or connector is touched;
every SQL test runs against Postgres on localhost.

**Migrations.** The highest on this date is `0149_card_writes.sql`, and the highest SQL test `0155-back-live-readers.sql`
(tests are numbered apart). This plan writes two migrations, called here **A** (`discipline_cards.sql`) and **B**
(`patrol_weights.sql`): each takes the next free number when its task is reached, and each SQL test the next free test
number. Sibling plans (Parts 2, 3, 4 and 6) are built at the same time and may take numbers first. Migration A is
written in sections, one per task (Tasks 2, 3 and 4), as `0148_card_types.sql` is. Every function a section redefines
is copied from its **latest** definition, found again at build time (a sibling may have redefined it), changing only
what the task names.

## What is built on main, and what is not

Read from the code on this date; the plan is written against it.

- **Built:** the warn bar, infractions and timed bans (`0104_warn_bar.sql`, redefined by `0109_appeals.sql`): `infract`,
  `warn_points`, `banned_until`, `not_banned`, the ladder; visits and filing (`0105_visits.sql`: `file_visit`,
  `end_visit`; `start_visit`'s latest is `0131_meeting_groups.sql:341`); appeals (`0109`, `0135_group_appeals.sql`);
  patrols and the targeting cap (`0110_patrols.sql`; `patrol_sample`'s latest is `0127_pronouns_for_the_model.sql:284`,
  `staff_punishments`' is `0129_group_moves.sql:497`); the `staff` Edge Function (`supabase/functions/staff/`); the
  visit's Lens (`engine/ui/cards/Visit.tsx`), the warn meter and the Mod Bots' log lines.
- **Not built:** the permaban, the Unban and Minus Balls (the staff design's Part 4). No migration, rule or screen
  holds any of them. **Ultra Happy Heart ships now for timed bans** (the owner: it is the Unban, "it ends a timed ban
  now, and takes the permaban when that is built"); see "Not planned here".
- **Three places the design's words do not match the code**, each settled in "Decided in planning":
  1. A patrol's pick has no weights. `patrol_sample` returns the newest `patrolSample` posts on the beat, and nothing
     is drawn. Tattle-Tale needs a draw to weight, so Task 5 makes the sample a weighted draw from a larger pool.
  2. An infraction must be about a post its own character wrote (`infract`, and `acts_warn_guard`, `0104:86-112`).
     Take the Fall lands one on another character, so Task 4 lets an infraction name the play that took the fall.
  3. Every play on a character must have a time up and a `play_reach` row (`reachProblems`,
     `engine/rules/instance.ts:523`; `place_cast`, `0148:153`; `playOf`, `engine/ui/cards/plays.ts:48`). A heart does
     its work at once and leaves no effect, so Tasks 1, 2 and 7 add a play that is over when it lands.

## The cards

All five are Moves (the engine's `cast`), cost nothing more to play, and are **cast face up only** (Decided in
planning 1). Prices follow `instances/divided-world/machine.ts`: an uncommon is on sale at 150; a rare has a hidden
slot at 300 and comes from the Booster's hit pull, as Main Event does; the legendary is the first.

| | Happy Heart | Super Happy Heart | Ultra Happy Heart | Take the Fall | Tattle-Tale |
|---|---|---|---|---|---|
| Key | `happy-heart` | `super-happy-heart` | `ultra-happy-heart` | `take-the-fall` | `tattle-tale` |
| Flavor, rarity | Sweet, uncommon | Sweet, rare | Sweet, legendary | Sweet, uncommon | Salty, rare |
| Reach | character | character | character | post, another character's | character |
| Engine effect | `relief`, `lightestBand` | `relief`, `all` | `unban` | `fall` | `watch`, weight 2 |
| Stack | none: over at once | none: over at once | none: over at once | 1 per post | 1 live per character |
| Lasts | nothing lasts | nothing lasts | nothing lasts | until a filing spends it | 7 days |
| Machine slot | on sale, 150 | hidden, 300 | hidden, 600 | on sale, 150 | hidden, 300 |
| Render | `happy-heart.png` | `super-happy-heart.png` | `ultra-happy-heart.png` | `take-the-fall.png` | `tattle-tale.png` |

Any character may play any of them on any player's character or post, its own player's other masks included, and a
heart on one's own mask is allowed (the design). A banned character plays nothing (`play_card` calls `not_banned`), so
an Ultra on a banned mask is played by another character: the banned player's other mask, or a friend's.

## The layers

- **Engine:** a fixed list of four **discipline effects** a cast card may pick, beside the Gimmick effects:
  `CardRules.discipline` (`engine/rules/cards.ts`), `card_kinds.discipline` (SQL), and everything they do: a play that
  is over at once, the relief and lift rows, the fall in `file_visit` and `infract`, the weighted patrol draw, the
  Lens and log words that say what each did. The engine names no card and no instance.
- **Instance:** the five cards' rules (each picks an effect and its numbers), names, flavor, rarity, art, face words
  and `describe`, the machine's slots, the Booster's weights, and `modBots.patrolPool`.
- **The interfaces:** `CardRules.discipline` through `seed_instance` into `card_kinds`; `CardUi` for the faces;
  `Settings.modBots` for the pool.

## The masks

- **Refusals.** "This character's warn bar is empty" and "this character is not banned" read `warn_points` and
  `banned_until`, which are public and already on every postbit; they are the same for every caster. "Played on
  another character's post" compares the caster **character** with the post's author character, never accounts, so
  a player's second mask may take the fall for the first (the design's burner) and nothing is refused that would
  tell. No refusal, price or timing differs with who owns the caster, the target or the post.
- **The filing** reads the live fall play on the post, which is a public Act, and never an owner.
- **The patrol's draw** reads live `watch` plays (public Acts) through a view of two columns, character and weight.
  `patrol_sample` stays owned by `kayfabb_digest`, which can read no owner, class or reactor; the sample is returned
  newest first, so its order says nothing of a weight; nobody is shown a patrol's sample.
- **The log** rows added are the caller's own characters' (`c.owner = auth.uid()` in each view), and name the other
  character by its public name.
- **Realtime.** A heart's play is broadcast as any card Act is. Nothing new is sent.

## Ways out

| State | Its way out |
|---|---|
| Points a heart took off | Nothing to leave. An admin's end of the play (`reverse_card`) puts them back, computed |
| A ban an Ultra ended | Nothing to leave. An admin's end of the play restores the ban's own end, computed |
| A post with a fall waiting | The first filing spends it; an admin's end. It holds nobody: the author and the caster post as before |
| Points or a ban on the character that took the fall | As any: each drops off by itself, the ban ends by itself, an appeal by that character, an admin |
| A character told on (Tattle-Tale) | It ends by itself after 7 days; an admin's end. The targeting cap bounds it meanwhile |
| A heart refused | Refused before anything is written: the card and the wallet are untouched |

## A busy instance

- `warn_points` gains one index probe per live infraction (`warn_reliefs` by infraction); a character has a handful
  of live infractions, since the bar holds 10 points. `banned_until` gains one probe per running ban.
- A heart's play reads the target's live infractions by `acts_infractions` (`0104:66`) and writes at most that many
  rows, once.
- `file_visit` gains one read of the post's plays by the index a post's layers are read by (`acts_layers`, 0072) and
  one probe of `acts_fall_spent`.
- The patrol's read stays flat however big the instance is: at most 50 boards, `patrolPool` threads each,
  `patrolSample` posts each, six patrols a day; the weight is one probe of `play_reach` by character per candidate.
- `thread_page` gains one probe per fall play on the page.

## The world

No screen is added. The cards' marks, Lens rows and play form are the glass's, plain and never in character
(`docs/plans/2026-10-29-two-worlds-design.md`); the warn meter and BANNED in the postbit are the board's and are not
changed, only read again. Every new sentence below is the glass's.

## Task 1. The engine's discipline effects

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`, `supabase/functions/_shared/seed.ts`, `supabase/functions/_shared/seed.test.ts`.

In `cards.ts`, after `GimmickEffect` (:78-83):

```ts
/** What a cast does to the staff's discipline of its target, one of a fixed list; each card picks one and sets its numbers. */
export type DisciplineEffect =
  | { readonly kind: 'relief'; readonly points: 'lightestBand' | 'all' }  // on a character: takes the oldest live points off its warn bar
  | { readonly kind: 'unban' }                                             // on a character: ends its running bans
  | { readonly kind: 'fall' }                                              // on another character's post: the next filing lands on the caster
  | { readonly kind: 'watch'; readonly weight: number };                   // on a character: multiplies its weight in a patrol's draw while up
export const DISCIPLINE_KINDS = Object.freeze(['relief', 'unban', 'fall', 'watch'] as const);
/** A play that is over when it lands: it leaves no effect, takes no place in a stack and has no time up. */
export const instant = (rules: Pick<CardRules, 'discipline'>): boolean => rules.discipline?.kind === 'relief' || rules.discipline?.kind === 'unban';
```

- `CardRules` (:184) gains `readonly discipline?: DisciplineEffect`.
- `CardTarget`: the character variant (:46) gains `readonly warnPoints?: number` and
  `readonly bannedUntil?: string | null`; the post variant gains `readonly author?: string` (the author character's
  id). Each is a public fact the server reads with the target (Task 2); a screen's preview may have none.
- `PlayContext` (:305) gains `readonly caster?: string` (the character the play is made through).
- `decidePlay` (:320), after the ward's refusal and before `decided`, a new `disciplineRefusal(rules, target, context)`:
  - `relief` on a character target whose `warnPoints === 0`: `"this character's warn bar is empty"`;
  - `unban` on a character target whose `bannedUntil === null`, or is a time not after `now`:
    `"this character is not banned"`;
  - `fall` on a post target whose `author` is `context.caster` (both defined):
    `` `${rules.name} is played on another character's post` ``.
  A fact left undefined refuses nothing; the server decides again.
- `landsOn` (:483): for an `instant` card, the stack count is skipped (the reach check stays).
- `decideSet` (:362), beside the `writes` refusal (:367):
  `` refuse(`${rules.name} acts the moment it lands, so it is cast face up and never set face down`) `` for any card
  with a `discipline`.
- `staffOffers` (:524) answers false for a card with a `discipline`: a staff persona does not play on its own
  office's rulings, and `infract` refuses a staff character.
- `drawnInMoment` (:474) is unchanged; say so in its comment (a discipline card draws nothing in a moment).

In `instance.ts`, beside the `writes` rules (:464-467) and in `reachProblems` (:523):

- a `discipline` is an object whose `kind` is one of `DISCIPLINE_KINDS`; only a cast card has one; a card has a
  `discipline` or `writes` or neither;
- `relief` and `unban`: `reaches` is exactly `['character']`, and **no** `lasts`, `stack` or `pins`. `reachProblems`'
  "reaches beyond a post with no time up" (:534) is not said of an `instant` card;
- `relief.points` is `'lightestBand'` or `'all'`;
- `fall`: reaches a post alone, `stack` is 1 or left out, no `lasts`;
- `watch`: `reaches` is exactly `['character']`, `lasts` is required, `weight` is a finite number above 1 and at most
  10.

`seed.ts` (:44-50) sends `discipline: c.discipline` beside `gimmick`.

**Tests first.** `cards.test.ts`: each `disciplineRefusal` and its pass with the fact undefined; `decideSet` refuses
each kind with the words above; `landsOn` lets a second instant play land where a first was; `staffOffers` false.
`instance.test.ts`: one case per rule above, each naming the card; a well-formed card of each kind is no problem.
`seed.test.ts`: the seed carries `discipline`, and none for a card without one.

## Task 2. Migration A, section 1: the catalog, a play that is over at once, relief and the lift

Model: sonnet

**Migration A, `discipline_cards.sql`** (next free number), with **SQL test `discipline-hearts.sql`** (next).

1. **The catalog.** `card_kinds` gains `discipline jsonb`, with checks: null or an object whose `kind` is one of the
   four; only where `play = 'cast'`; `lasts is null` for `relief`, `unban` and `fall`; `lasts is not null` for `watch`.
   `card_kinds_problem` (latest `0148:39`) says the same in the engine's words. `seed_instance` (latest `0149:1021`)
   writes the column, and its check that every card beyond a post has a time up lets a `relief` or `unban` card
   through.
2. **Never face down, never a staff play.** A trigger `face_down_never_disciplines` on `face_down`, the pattern of
   `face_down_never_writes` (`0149:769`), raising `'% acts the moment it lands, so it is cast face up and never set
   face down'`. `place_cast` raises (no refusal hint, `42501`) for a staff caster and a card with a `discipline`.
3. **The rows.** Two tables, each append-only (a trigger refusing update and delete, as `card_texts_append_only`,
   `0149:409`), row-level security on, no grant to an API role, written only by `place_cast`:
   - `warn_reliefs(play uuid references acts, infraction uuid references acts, points integer check (points >= 1),
     primary key (play, infraction))`, index on `(infraction)`;
   - `ban_lifts(play uuid references acts, ban uuid references acts, primary key (play, ban))`, index on `(ban)`.
   Both go into the lists `supabase/tests/0005-default-deny.sql:21` and `supabase/tests/e2e/0003-export.ts:340, :551`
   hold, so the export carries them and the round trip proves it.
4. **The reads.**
   - `card_relief(infraction uuid) returns integer`: the sum of `warn_reliefs.points` for it whose play is not
     `card_ended`. Granted as `infraction_relief` is (`0111:213`).
   - `warn_points` (`0104:247`): each infraction counts
     `greatest(0, points - infraction_relief(id) - card_relief(id))`. Nothing else changes.
   - `ban_ends(ban uuid) returns timestamptz`: the least of the ban's end as `banned_until` reads it today (an
     appeal ruling's `until` in place of the ban's own, `0109:204-214`) and the `created_at` of the earliest play in
     `ban_lifts` for it that is not `card_ended`.
   - `banned_until` (latest `0109:204`), `my_bans.until` (`0111:230`) and `punishment_running` (latest `0135:111`)
     read `ban_ends`. `infract`'s ladder count is **not** changed: a lifted ban still counts toward the next.
   - `card_target_reach` (`0055:404`), character branch: the JSON gains `'warnPoints', warn_points(target)` and
     `'bannedUntil', banned_until(target)`.
5. **`place_cast`** (latest `0148:153`), at `reach = 'character'`, after the character's row is locked (the lock
   `infract` takes, so a filing and a heart on one character are one after the other):
   - a card with a `discipline` and a staff target: `'% lands on a player''s character'` (refusal, `22023`);
   - `relief`: `total := warn_points(target)`; zero raises `'this character''s warn bar is empty'` (refusal hint,
     `55000`). `want` is `total` for `all`, else the least of the three `warnBar.bands` values; `took := least(want,
     total)`;
   - `unban`: the running bans are `acts` of kind `ban` naming the target whose `ban_ends` is after `now()`; none
     raises `'this character is not banned'` (refusal hint, `55000`);
   - for both, the ward test still runs (a ward on the character turns a heart away as it turns any cast); the stack
     count, `ends` and the `play_reach` insert are skipped; the Act's payload is
     `{card, message, config, reach: 'character', character, targetName, instant: true}` plus `took` (relief) or
     `lifted: [{ban, until}]` (unban, `until` each ban's `ban_ends` before the lift);
   - after the Act is written: for relief, walk the target's live infractions (not expired, after its last ban),
     oldest first by `created_at, id`, and insert a `warn_reliefs` row taking
     `least(what is left on it, what is still wanted)` from each until `took` is reached; for unban, one `ban_lifts`
     row per running ban.
   The refusals raise inside `play_card`'s transaction (`0149`), before `wallet_spend` and the `card_ledger` row, so a
   refused heart is not spent.
6. **`reverse_card`** (latest `0149:470`) is unchanged: an instant play has no `ends` and no `play_reach` row, so an
   admin may end it at any time, and the reads above stop counting it.

**Tests first** (`discipline-hearts.sql`, with a test catalog of its own: cards named `t-relief-one`, `t-relief-all`,
`t-unban`, never the instance's):

- relief takes the oldest points first and splits an infraction (a 4 then a 2 on the bar, `lightestBand` 2: the 4
  shows 2 left, the bar 4); a second takes the rest of the first; `all` empties a bar of three infractions;
- an infraction an appeal already reduced gives only what is left of it; the bar is never below zero;
- an empty bar refuses, and the caster's hand and wallet are as they were (`card_held`, `wallets`);
- the play writes no `play_reach` row, and a second heart on the same character lands at once;
- an expired infraction and one from before the last ban are not touched;
- a heart racing a filing on one character (`tests.race_service`, as `0112-patrols.sql:99` races claims): the bar
  afterwards is the filing's points less the heart's, whichever went first, and never negative;
- unban: `banned_until` is null at once, `post()` by the lifted character works, `my_bans.until` is the lift's time;
  two running bans are both lifted; a character not banned refuses and nothing is spent; the next full bar steps the
  ladder as if the lifted ban had run (1 day, lifted, then 3);
- `reverse_card` on a relief play puts the points back; on an unban play the ban's own end holds again;
- a heart through one mask on another mask of the same account lands, and a refusal is word for word the same for
  an owner and a stranger (the mask test);
- a banned caster is refused by `not_banned`; a staff target is refused; a staff caster is refused;
- `set_card` of each refuses with the trigger's words.

## Task 3. Migration A, section 2: the reads for the log

Model: sonnet

**Files:** Migration A; **SQL test `discipline-reads.sql`** (next).

- `my_infractions` (`0111:217`) gains, as its last columns, `card_relief integer` (`card_relief(i.id)`) and
  `fall_play uuid` (null until Task 4 writes one).
- `my_bans` (`0111:230`) gains `lifted_at timestamptz` and `lifted_card text` (the key of the card whose play lifted
  it, null where none).
- `log_page` (latest `0149:1339`; its `inf` and `bn` reads are at `:1390-1395`) carries the new columns.

**Tests first:** the columns for an infraction two hearts each took from; a ban lifted; both null where no card
acted; a second player's `log_page` holds none of the first's rows.

## Task 4. Migration A, section 3: taking the fall

Model: sonnet

**Files:** Migration A; **SQL test `discipline-fall.sql`** (next).

- **The payload.** `acts_infraction_payload` (`0104:45`) allows one more key, `fall_play` (a uuid string).
  `create index acts_fall_spent on acts ((payload ->> 'fall_play')) where kind = 'infraction' and payload ? 'fall_play'`.
- **`infract`** (latest `0109:219`) gains a last argument `fall_play uuid default null`. With it, the post
  (`about_act`) need not be `who`'s: instead the play must be a `card` Act by `who` whose `target_act_id` is the post,
  on the post's own reach, and whose card's `discipline ->> 'kind'` is `'fall'`. The infraction's payload carries
  `fall_play`. Everything else (the lock on `who`, the points, the ban and its ladder, which are `who`'s) is as it is.
  `acts_warn_guard` (`0104:86`) holds the same: an infraction is about a post of its character's, **or** names a
  `fall_play` that is such a play by that character on that post.
- **`file_visit`** (`0105:519`), after `end_visit` has ended the visit as filed: the fall is the oldest `card` Act on
  the visit's post, on the post's reach, not `caught`, not `card_ended`, whose card's discipline is `fall`, and that
  no infraction names as its `fall_play`. With one, `who` is that play's character and `infract` is given
  `fall_play`; with none, as today. The visit's end, its line and the post's notice are not changed: the post still
  shows what it was found in violation of.
- **`close_appeal`** (latest `0135:241`): its `increased` branch calls `infract` (`:315`) with the punished
  infraction's `fall_play`, so an increase on a fall's infraction lands on the same character and is not refused.
- **`place_cast`**, `reach = 'post'`, for a `fall` card: the author a staff character raises
  `'% is played on a player''s post'` (refusal, `22023`); the author the caster raises
  `'% is played on another character''s post'` (refusal, `42501`). The stack count is as for any card (one, spent or
  not, unless an admin ended it).
- **`card_target`** (latest `0148:1109`) gains `'author', a.character`.
- **`thread_page`** (latest `0149:150`) gains `'spent'`: the ids, among the page's plays on posts, that an
  infraction names as `fall_play` (beside `'releases'`).
- **`my_falls_taken`**, a view for the author's log, granted as `my_infractions` is: for each infraction with a
  `fall_play` whose `about_act` is a post by one of the caller's characters: `infraction, character` (the author),
  `at, post, post_seq, thread, rule` (`punishment_words`), `points, mod_name, taker_name` (the fall character's public
  name). `log_page` carries it as `falls`.

**Tests first** (`discipline-fall.sql`, a test card `t-fall`):

- a visit files: the points are on the caster character's bar and none on the author's; the infraction names the
  author's post, the visit and the play; the post's `visit_end` and notice are as without a fall;
- a severe filing onto a caster with 4 points bans the caster, and the author is not banned;
- the first filing spends it: a second visit to the same post files on the author; a second fall on that post is
  refused with the stack's words;
- cast while a visit is open, it takes that visit's filing; a visit talked down or trapped spends nothing;
- an admin's end before the filing: the author takes the points; after the filing: the infraction stays where it
  landed;
- the caster appeals and the author cannot (`open_appeal`); `overturned` frees the caster's bar; `increased` lands on
  the caster;
- `staff_punishments` counts a patrol-caused fall infraction against the caster character;
- own post refused, staff post refused; a fall by a second mask of the author's own account lands, and the filing
  goes to that mask (the mask test);
- `file_visit` twice files once; a fall cast racing a filing either takes it or stays unspent, never both;
- `my_falls_taken` shows the author's player the row and nobody else; `thread_page.spent` names the play after the
  filing.

## Task 5. Migration B: the patrol's weighted draw, and `patrolPool`

Model: sonnet

**Files:** Migration B, `patrol_weights.sql`; **SQL test `patrol-weights.sql`** (next);
`supabase/tests/0050-digest.sql` (:65-78); `supabase/tests/0112-patrols.sql`; `engine/rules/types.ts`
(`Settings.modBots`), `engine/rules/instance.ts` (its rule), `engine/rules/test-system.ts`,
`instances/divided-world/settings.ts` (:111), `instances/divided-world/settings.test.ts` (:101);
`supabase/functions/staff/patrol.ts` (:153), `patrol.test.ts` (:83, :124); and every fixture that writes a `modBots`
value (every file `grep -l patrolSample` finds under `supabase/tests/`, `engine/rules/` and `instances/`).

- **The setting.** `modBots.patrolPool`: a whole number from `patrolSample` to 100; Divided World's is 20.
  `setting_modbots` (find its latest; first written at `0103:113`) holds it, and so does the TypeScript rule. Every
  fixture gains `"patrolPool": 20` beside `"patrolSample": 5`: mechanical, one edit per file.
- **`watched_characters`**, a view: `character, weight` for each `play_reach` row at character reach that has not
  ended and is not `card_ended`, whose card's `discipline ->> 'kind'` is `'watch'`. Select is granted to
  `kayfabb_digest` and to nobody else; it exposes no column but those two.
- **`patrol_sample(boards uuid[], most integer, pool integer, seed bigint)`** replaces the two-argument function
  (dropped), still owned by `kayfabb_digest`:
  - the candidates are the newest `pool` eligible posts on the beat, read as today's sample is (`0127:284-304`) with
    the per-board thread limit and the outer limit at `pool` and the per-thread post limit still at `most`;
  - each candidate's weight is the largest `watched_characters.weight` of its author, else 1;
  - each draws `u`, a number in (0, 1) from `hashtextextended(seed::text || ':' || post id, 0)`, and its key is
    `-ln(u) / weight`; the sample is the `most` smallest keys (a weighted draw without replacement, the same for a
    retry of the same patrol);
  - it is returned newest first, in the shape it has today.
- `patrol.ts` passes `pool: settings.modBots.patrolPool` and `seed: p.id` (the claimed patrol's id).
- `0050-digest.sql`'s pinned list names the new signature in place of `patrol_sample(uuid[],integer)`, and its
  planted reads of an owner, a class and a reactor stay red. If that test pins the relations the role may read,
  `watched_characters` joins it with a line saying it is public plays only.
- `start_visit` and the targeting cap are not touched: a finding against a character at the cap is still dropped
  (`0131:373-384`).

**The check and its poison.** `patrol-weights.sql` asserts the draw follows the weights: with 40 candidates by 40
characters, one of them watched at weight 2, over 400 seeds the watched character's post is sampled more often than
the mean of the others by a stated margin (at least 1.5 times). Its poison, run once and recorded: the same test
against a `watched_characters` whose weight is forced to 1 must fail that assertion.

**Tests first:** the poison above; a pool no larger than the sample returns every candidate whatever the weights;
the same seed draws the same sample; an ended or admin-ended watch weighs 1; staff posts and visited posts are still
left out (`0112`'s cases, moved to the new signature); `settings_held` refuses a `patrolPool` below `patrolSample`
and one missing (`0079-settings-held.sql` gains the poisons); `patrol.test.ts`: the call carries the pool and the
patrol's id.

## Task 6. The server's decision and the data layer

Model: sonnet

**Files:** `supabase/functions/act/core.ts` (:162-195), `core.test.ts`; `engine/ui/data/api.ts`,
`web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, and their tests.

- `act/core.ts`: the character target already spreads what `card_target_reach` returns, so `warnPoints` and
  `bannedUntil` arrive with it; the post target is built by `postTarget` (:172), which gains the read's `author`;
  `decidePlay` is given `{ nameOf, caster: decision.args.through }`.
- `api.ts`: `CardPlay` gains `instant?: true`, `took?: number`, `lifted?: number` (how many bans) and `spent?: true`;
  `LogInfraction` gains `cardRelief` and `fallPlay`; `LogBan` gains `liftedAt` and `liftedCard`; `Log` gains `falls`
  (`LogFall`: the fields of `my_falls_taken`); the thread page's shape gains `spent`.
- `supabase.ts` maps each (its character reads are at :506 and :815; the log's beside its infractions).
- `fake.ts`: `warnOf` (:668) subtracts reliefs; its seeds gain `relief(play, infraction, points)`, `lift(play, ban)`
  and a fall on a filing, and its `playCard` applies the three refusals and the relief, lift and fall as the SQL
  does, so the stories and the UI tests can show each state.

**Tests first:** `core.test.ts`: a heart on an empty bar and an Ultra on a character not banned are refused with
the engine's words before any write; a fall on one's own post is refused; each lands otherwise and the RPC carries
no extra argument. `fake` tests: each refusal; the bar after a relief; `bannedUntil` gone after a lift; a filing
landing on the fall's caster.

## Task 7. The engine's screens: the marks, the Lens, the visit and the log

Model: sonnet

**Files:** `engine/ui/cards/plays.ts` (:48-102), `plays.test.tsx`; `engine/ui/cards/Lens.tsx`, `lens.test.tsx`;
`engine/ui/cards/Visit.tsx` (:276, :341-348, :361-367), `visit.ts`, its tests; `engine/ui/thread/Post.tsx`;
`engine/ui/log/lines.ts` (:448-476, :713-726), `lines.test.tsx`; `engine/ui/cards/Lens` and `Log` board stories.

- **An instant play is a mark, never a layer.** `playOf` (:48) reads a `card` Act whose payload has `instant: true`
  as a play on the post it was played from (`post: targetActId`, no `reach`, no `on`), with `instant`, `took` and
  `lifted`. `livePlays` (:89) leaves it out, as it leaves an ended play out; `markedPlays` (:99) keeps it, as it
  keeps a caught play. So it has a mark and a Lens row on that post, with React and Spin thread, and draws nothing.
- **A spent fall** is marked from the page's `spent`. It stays a mark; `livePlays` leaves it out.
- **The Lens's words for a discipline play**, the engine's, plain, under the card's `status` heading (`{target}`,
  `{caster}` and `{author}` are public character names; dates as the Lens says them):
  - relief: `Took {n} warn point(s) off {target}'s warn bar on {date}.`
  - unban: `Ended {target}'s ban on {date}.`
  - a fall waiting: `If a Mod Bot's visit to this post files, its warn points land on {caster}, not on {author}. The
    post keeps its notice.` and, as its end, `Ends when a visit to this post files, or when an admin ends it.`
  - a fall spent: `A visit to this post filed, and its warn points landed on {caster}.`
  - a watch (on the character's mark, above its posts): `Mod Bot patrols are {twice | N times} as likely to look at
    {target}'s posts until {date}. A patrol still judges each post against the rules.`
  Each passes `lens-words.ts`.
- **The visit's panel.** While a visit is open and the post carries a live, unspent fall, the sentences at :341-342
  name the fall's caster where they name the author, and add `{caster} took the fall for this post.` Once filed,
  :348 names `inf.character` (the infraction's own character, which the story already carries) and, where that is
  not the author, adds `{name} took the fall for {author}.` Appeal (:361) is offered to the HUD's mask when it is
  `inf.character`; check that the condition reads the infraction's character and not the post's author, and fix it
  if it reads the author. `Post.tsx` hands the panel the post's fall play.
- **The log**, all in `lines.ts`, plain and true:
  - the caster's `played` line and the target's `onMine` line (:713-726) gain a sentence read from the play's own
    payload, as `tokens` is read (:549): ` It took {n} warn point(s) off {target}'s warn bar, oldest first.` or
    ` It ended {target}'s ban, which was set to end {when} UTC.`
  - an infraction's line (:455-466): where `cardRelief > 0`, the tail ` Cards took {n} point(s) off.`; `left` is the
    points less both reliefs, never below zero. Where `fallPlay` is set, the line reads `{mod}'s visit to post #{n}
    filed {rule}: {points} for {name}, who took the fall for that post, dropping off {day}.` and the post is not
    called "your post".
  - a ban's line (:468-476): where `liftedAt` is set, `The ban ended {when} UTC, when {card name} was played on
    {name}.` in place of "ended by itself", and no appeal is offered.
  - a new kind `fallTaken`, from `log.falls`: what `A fall taken for your post`, details `{mod}'s visit to your post
    #{n} filed {rule}. {taker} took the fall, so the {points} landed on {taker} and none on {name}. The post keeps
    its notice.`

**Tests first:** `plays.test.tsx`: an instant play is marked and not live; a spent fall likewise; a watch is a
character play as Glitter Bomb is. `lens.test.tsx`: each sentence above, and axe on the Lens with each row open.
The visit's tests: the open and the filed sentences with a fall, and Appeal offered to the fall's caster alone.
`lines.test.tsx`: each line above, and that no line names an owner. A board story for each: "Boards/01 Lens: a
heart", "a fall waiting", "a fall taken", "told on".

## Task 8. The art

Model: inline

**Files:** for each of `happy-heart`, `super-happy-heart`, `ultra-happy-heart`, `take-the-fall`, `tattle-tale`:
`instances/divided-world/ui/cards/<key>/art.webp`, `scene.py`, `mark.svg`, `art.json`.

As commit 99441413 did for Below the Fold (`instances/divided-world/ui/cards/below-the-fold/`):

- `art.webp`: `docs/research/2026-11-11-card-renders/<key>.png` (each is 1080 by 1680) converted to lossy WebP at
  quality 90, at most 400 KB.
- `scene.py`: `docs/research/2026-11-11-card-renders/<key>.py` copied, with the two lines the shipped scenes carry:
  the import path set to the folder's parent (where `rig.py` is) and `sys.dont_write_bytecode = True`; "exploration"
  dropped from its first line. The research folder is not changed.
- `art.json`: Below the Fold's, word for word.
- `mark.svg`: viewBox `0 0 108 108`, `aria-hidden="true"`, a dark outline of 4 to 7, legible at 18 px, in the style
  of Below the Fold's: a heart with one notch beside it (Happy Heart); a heart with two small wings (Super); a
  heart wearing a three-point crown (Ultra), the hearts in Sweet's cyan `#2ee6ff` with ink `#03141a`; a gavel over a
  small figure with arms wide, cyan (Take the Fall); a pointing hand under a siren dome, in Salty's pink `#ff3d7f`
  with ink `#14030a` (Tattle-Tale).

**Tests first:** `node tools/check-card-art.mjs` run once with one folder holding only `art.webp` (its refusal
recorded), then green over all the folders, with each `art.webp`'s size shown.

## Task 9. Divided World's five cards

Model: sonnet

**Files:** `instances/divided-world/cards/happy-heart.ts`, `super-happy-heart.ts`, `ultra-happy-heart.ts`,
`take-the-fall.ts`, `tattle-tale.ts` (new); `cards/index.ts` (`listed` and its header); `cards/cards.test.ts`;
`machine.ts`; `packs.ts`; `ui/cards.ts`; `ui/index.test.tsx` (its `lands` table at :86 and any list of every card);
`ui/hint-words.ts` and `ui/still.test.tsx` where they name every card.

**The rules**, each with a header comment saying what the card does and naming the design, in the form of
`cards/glitter-bomb.ts`:

```ts
export const happyHeart: CardRules<Record<string, never>> = {
  key: 'happy-heart', name: 'Happy Heart', alignment: 'sweet', rarity: 'uncommon',
  reaches: ['character'], discipline: { kind: 'relief', points: 'lightestBand' },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(happyHeart, target, effects, now),
  validateConfig: () => ok({}),
};
```

`superHappyHeart`: `key: 'super-happy-heart'`, `name: 'Super Happy Heart'`, `rarity: 'rare'`,
`discipline: { kind: 'relief', points: 'all' }`. `ultraHappyHeart`: `key: 'ultra-happy-heart'`,
`name: 'Ultra Happy Heart'`, `rarity: 'legendary'`, `discipline: { kind: 'unban' }`. `takeTheFall`:
`key: 'take-the-fall'`, `name: 'Take the Fall'`, `rarity: 'uncommon'`, no `reaches` (a post),
`discipline: { kind: 'fall' }`. `tattleTale`: `key: 'tattle-tale'`, `name: 'Tattle-Tale'`, `alignment: 'salty'`,
`rarity: 'rare'`, `reaches: ['character']`, `lasts: { unit: 'day', count: 7 }`,
`discipline: { kind: 'watch', weight: 2 }`.

**The machine**, after the uncommons already there: `happy-heart` and `take-the-fall` `onSale` at 150; after Main
Event: `super-happy-heart` and `tattle-tale` `hidden` at 300, `ultra-happy-heart` `hidden` at 600. **The Booster's**
hit pull becomes `{ uncommon: 74, rare: 24, legendary: 2 }`.

**The faces** (`ui/cards.ts`; none has an `Effect` or a `ConfigForm`; Sweet's are `color: '#2ee6ff', ink: '#03141a'`,
Tattle-Tale's `color: '#ff3d7f', ink: '#14030a'`; `lightest` is the least of `settings.warnBar.bands`' three values
and `cap` is `settings.modBots.cap`, both read from the settings and never restated):

| Card | `tagline` | `summary` | `status` | `hint` |
|---|---|---|---|---|
| Happy Heart | `Take a notch off a warn bar.` | `Cast on a character. Takes the oldest points off that character's warn bar.` | `Took points off a warn bar` | `A Happy Heart took warn points off a character's bar.` |
| Super Happy Heart | `Empty a warn bar.` | `Cast on a character. Empties that character's warn bar.` | `Emptied a warn bar` | `A Super Happy Heart emptied a character's warn bar.` |
| Ultra Happy Heart | `End a ban on the spot.` | `Cast on a banned character. Ends the ban at once.` | `Ended a ban` | `An Ultra Happy Heart ended a character's ban.` |
| Take the Fall | `Take the blame for a post.` | `Cast on another character's post. The next Mod Bot filing on it lands on your character instead.` | `Waiting to take the fall`, or `Took the fall` once a play is spent | `Someone has offered to take the fall for this post.` |
| Tattle-Tale | `Point the Mod Bots at someone.` | `Cast on a character. Mod Bot patrols are twice as likely to look at that character's posts for a week.` | `Told on to the Mod Bots` | `A Tattle-Tale: someone told the Mod Bots to watch this character.` |

`describe`, each a template over the rules and the settings:

- **Happy Heart:** `` `A Sweet card, ${happyHeart.rarity}, cast from any post by the character it lands on. It takes the oldest ${lightest} warn points off that character's warn bar at once, as many as the lightest breach lands, or as many as are left. The filings stay on the record; the card is a new entry beside them. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.` ``
- **Super Happy Heart:** `` `A Sweet card, ${superHappyHeart.rarity}, cast from any post by the character it lands on. It takes every point off that character's warn bar at once. The filings stay on the record; the card is a new entry beside them. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.` ``
- **Ultra Happy Heart:** `` `A Sweet card, ${ultraHappyHeart.rarity}, cast from any post by a banned character. It ends that character's ban at once: the character can post, react and play cards again from that moment. The ban stays on the record and still counts toward how long that character's next ban is this season, and the warn bar stays as the ban left it, empty. If the character is not banned the play is refused and you keep the card. A banned character cannot play cards, so another character plays it: anyone's, one of your own included. It is always cast face up. It costs nothing more to play.` ``
- **Take the Fall:** `` `A Sweet card, ${takeTheFall.rarity}, cast face up on a post by another character. The next time a Mod Bot's visit to that post files, its warn points land on the character that played this card instead of the post's author, and a ban they bring is that character's too. Only the points and the ban move: the post keeps its notice. One fits on a post. It waits until a visit files, the first filing uses it up, and it can be played while a visit is open. The character that took the fall can appeal the filing. It costs nothing more to play.` ``
- **Tattle-Tale:** `` `A Salty card, ${tattleTale.rarity}, cast from any post by the character it lands on. For ${spanWords(tattleTale.lasts!)}, when a Mod Bot's patrol picks which recent posts to look at, that character's posts are twice as likely to be picked. It makes a look likelier, never a ruling: the Mod Bot still judges each post against the rules, and staff still cannot pick one character more than ${cap.punishments} times in ${cap.days} days. One fits on a character at a time, and it ends by itself. It is always cast face up. It costs nothing more to play.` `` ("twice" is said only while the rules' weight is 2; the test holds the two together.)

None carries `setMoveWords`, and none joins the `lands` table at `ui/index.test.tsx:86`.

**Tests first.** `cards.test.ts`: each card is in `cards`; its `discipline`; `decideSet` refuses each;
`staffOffers` is false for each; `instanceProblems(dividedWorld)` is empty; `castOnPost` holds for Take the Fall
alone. `ui/index.test.tsx`: each face's words pass `instanceUiProblems` and `lens-words.ts`; each `describe` reads
its numbers from the settings (retune `warnBar.bands` and `modBots.cap` and the words follow); none contains "set
it face down". The machine's and the pack's tests: the five slots; the hit pull's odds sum to 1 and give Ultra
Happy Heart a chance. Any test that counts slots or cards is updated with its red run.

## Task 10. A day of hearts, a fall and a tattle

Model: sonnet

**Files:** `supabase/tests/e2e/(next)-hearts-falls-tattles.ts`, on the pattern of `0017-a-day-of-the-mods.ts`, with
the instance's real cards seeded and the fake model; `e2e/board-stories.test.ts` and the a11y spec's list (the new
story ids).

One run: a post breaks a rule and a visit opens; a second character casts Take the Fall on it; the tick files it,
and the points are on that character; that character appeals; a third character plays Happy Heart on it, then
Super Happy Heart; a full bar bans a character and another mask of the same account plays Ultra Happy Heart on it,
after which it posts; a Tattle-Tale lands and a patrol with a seeded pool samples (the fake judge finds nothing);
the export of the instance imports again to the same forum, the two new tables included. Every refusal in the
plan is met once (empty bar, not banned, own post, a second fall, a second tattle), and after each the hand and the
wallet are unchanged.

Then `npm run typecheck` and `npm run build`, with the tail in the PR, and `npm run test:e2e`.

## Decided in planning

1. **None of the five is ever set face down.** Each acts on a target its caster chose at the moment it lands, and
   a heart must be refused before it is spent; a back landing on whoever quotes it can do neither. The engine holds
   it as it does for a card that writes.
2. **A staff persona never plays one, and none lands on a staff character or post.** `infract` refuses a staff
   character, and The System's rulings are its own; these are player moves around them.
3. **"The lightest band" is the least of the three `warnBar.bands` values** (2 today), read from the settings.
4. **A heart is refused only on an empty bar.** A bar with fewer points than the heart takes gives what it has.
5. **An admin's end of a heart or an Ultra undoes it**, computed, as an admin's end of any card does; the relief and
   lift rows stay.
6. **A lifted ban still counts on the season's ladder.** The ban happened; only an appeal's overturn unsays one.
7. **No parole on a timed ban's lift.** The System design's "back on parole with its warn bar half full" was written
   for the permaban; Part 4 decides it there. The bar stays as the ban left it.
8. **Ultra lifts every ban running on the character**, since a late filing can lay a second one.
9. **Take the Fall is one per post for good**, waiting or spent, unless an admin ended it. The design says "one per
   post"; freeing the place after a filing would need the stack to read spent plays.
10. **A fall with no time up.** The design says it stays until a filing; it holds nobody in any state.
11. **The patrol's sample becomes a weighted draw from the newest `patrolPool` posts (20)**, since nothing can be
    twice as likely in a list that is simply the newest five. With no Tattle-Tale up, every post in the pool is
    equally likely, which also changes today's "newest five" to "five of the newest twenty".
12. **The draw is seeded by the patrol's id**, so a retry samples the same posts.
13. **Tattle-Tale lands on any player's character**, the caster's own included (it harms only itself).
14. **Prices and odds:** rares hidden at 300 like Main Event; the first legendary hidden at 600; the Booster's hit
    pull gains `legendary: 2` (taken from uncommon and rare, one each), so a legendary can be found at all while
    The System, whose moves bring hidden slots out, is off. All are the season review's to replace.
15. **A heart's mark sits on the post it was played from**, so the play has a Lens row to react to and spin from,
    like every card Act.
16. **The engine's word for the four effects is "discipline"** (`CardRules.discipline`, `card_kinds.discipline`).

## Not planned here

- **Ultra Happy Heart on a permaban.** The permaban is not built. When the staff's Part 4 plans it, the permaban
  should be a `ban` Act that `ban_ends` and `ban_lifts` read, so the card takes it with no change of its own. Two
  things in the System design's section 10 no longer fit the owner's answer that Ultra Happy Heart is the Unban, and
  are Part 4's to ask the owner: **is the Unban still "bound to that character, never stored", found only by a
  banned character in a gold Minus Ball, or is it this card, held in a hand and played by any character?** and
  **does a character lifted from a permaban come back on parole with its bar half full?**

## Review focus

- **Acts an instance already holds.** `warn_points`, `banned_until`, `my_bans` and `punishment_running` are
  redefined: a database with infractions, bans and appeal rulings from before this change must read the same bar
  and the same ends after it.
- **Two writers at once.** A heart and a filing on one character; two hearts on one bar; a fall cast as its visit
  files; the tick and the filing cron on a visit with a fall. Each must act once and leave the bar a sum of whole
  Acts.
- **An appeal after a heart.** An infraction a heart emptied and an appeal then reduces or increases; a ban an
  Ultra lifted and an appeal then rules on. No bar below zero, no ended ban revived.
- **The fall's burner.** A player's spare mask taking every fall is accepted by the design; check that nothing
  shown to anyone but that player differs when the caster and the author share an account.
- **The masks in the draw.** `watched_characters` must expose two columns and no more, and `patrol_sample` must stay
  on the digest role's pinned list with its planted reads red.
- **The targeting cap under a tattle.** A watched character at the cap is still never chosen, and a fall's
  infraction counts against the character that took it.
- **A busy instance.** `warn_points` runs for every character on a page; measure it with reliefs on a page of 40
  postbits. `patrol_sample` at 50 boards and a pool of 100.
- **What a patrol looks at now.** With no tattle anywhere the sample is no longer the newest five; whether the
  Mods feel less attentive to the newest posts is the owner's to judge in the rehearsal.
- **The log and the Lens.** Every sentence about a heart, a lift or a fall must say what landed on whom; a spent
  fall's status reaches a page only on its next read, so the Lens may say "Waiting" beside a visit that says Filed
  until then.
- **The export.** `warn_reliefs` and `ban_lifts` round-trip, and an imported instance's bars and bans read the same.
