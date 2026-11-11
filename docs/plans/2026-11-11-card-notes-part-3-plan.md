# Card notes, Part 3: Whodunnit?, Blind Study and Overreaction: plan

Record, written 2026-11-11. The plan for Part 3 of `docs/plans/2026-11-11-card-notes-design.md` (its section 2,
"Whodunnit?", "Blind Study" and "Overreaction", and the owner's answers in its section 5), built by one build session
in one PR, from `main`. It leans on `docs/plans/2026-11-11-card-types-design.md` (a Move is a `cast`),
`docs/plans/2026-11-05-reaction-set-design.md` (what a reaction kind is) and
`docs/plans/2026-11-11-rendered-card-art-plan.md` (a card's folder).

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added. The guards
this plan adds live in SQL tests and in `instanceProblems`, and each names the poison that drives it red.

**Migrations.** Three, taking the next free numbers in `supabase/migrations/` (0156 on as this is written; the last is
`0155-back-live-readers.sql`), named `NNNN-post-veils.sql`, `NNNN-blind-totals.sql` and `NNNN-post-reactions.sql`. Their
SQL tests take the next free numbers in `supabase/tests/` (0156 on). Sibling plans of the same design are being built
at the same time and may take numbers first: take whatever is free on the day, and copy every function from its
latest definition on that day (`grep -il "function public.<name>\|function <name>\|view <name>" supabase/migrations/*.sql`,
the last file wins). As this is written they are:

| Object | Latest definition |
|---|---|
| `acts_public`, `thread_page`, `profile_page`, `record_page`, `alerts_page`, `log_page`, `card_ended`, `seed_instance`, `play_card` | 0149 (lines 133, 150, 279, 318, 373, 1339, 461, 1021, 790) |
| `place_cast`, `spring_facts`, `card_kinds_problem`, `card_target`, `settlement_input`, `estimate_input` | 0148 (153, 961, 39, 1109, 1180, 1267) |
| `lay_sprung`, `react` | 0142 (470, 864) |
| `start_visit` | 0131:341 |
| `demand_progress` | 0129:322 |
| `system_digest` | 0127:21 |
| `search_match_conds`, `search_matches_sql`, `search_matches`, `search_walk_sql`, `search_walk` | 0117 (663, 684, 726, 741, 758) |
| `open_report` | 0114:98 |
| `play_moment`, `my_cards_ended` | 0092 (975, 909) |
| `pool_signals` | 0088:122 |
| `thread_open`, `thread_list` | 0079 (34, 76) |
| `my_followed_threads` | 0076:58 |
| `act_window_counts` | 0065:35 |
| `card_target_reach` | 0055:404 |

Everything a copied function does that this plan does not name stays as written, its lock order included. No deployed
database, bucket or connector is touched; SQL is tested against Postgres on localhost.

## What the three cards are

| | Whodunnit? | Blind Study | Overreaction |
|---|---|---|---|
| Key | `whodunnit` | `blind-study` | `overreaction` |
| Type (engine play) | Move (`cast`) | Move (`cast`) | Move (`cast`) |
| Flavor | Pepperoni | Pepperoni | Pepperoni |
| Rarity | rare | uncommon | common |
| Reach | a post | a post | a post |
| Stack | 1 | 1 | 3 |
| Lasts | 3 days | 3 days | does not end |
| Play price | 0 | 0 | 0 |
| Machine slot | `hidden`, 300 (as Main Event, the other rare) | `onSale`, 150 | `onSale`, 100 |
| Engine flag | `veil: 'author'` | `veil: 'totals'` | `reaction` (a post-local kind) |
| Configuration | none | none | `{ emoji, quadrant }` |

A rare is found in a Booster's hit pull (`instances/divided-world/packs.ts`; `roll_pack` picks among every card of the
rarity), and its slot starts hidden, as Main Event's does.

Like any Move, each can be set face down on one's own post and then lands on the post that quotes it.

## What the engine gains (the layers)

All of it is engine, behind three things an instance fills. The engine names no card and no emoji, and the boundary
check (`tools/check-engine-boundary.mjs`) holds.

- **`CardRules.veil?: 'author' | 'totals'`** (`engine/rules/cards.ts`): a cast card on a post that, while it is up,
  withholds the post's author, or its reaction totals, from every read. SQL knows only the flag (`card_kinds.veil`).
- **`CardRules.reaction?: true`**: a cast card on a post whose checked configuration is a post-local reaction kind,
  `{ emoji, quadrant }`, which its play adds to that post's picker. SQL knows only the flag
  (`card_kinds.adds_reaction`) and reads the two keys.
- **`Instance.anonymous?: AnonymousPoster`** (`engine/rules/types.ts`): the character that stands in for a withheld
  author, `{ name, tagline?, avatar?, pronouns? }`, with the engine's plain default (`{ name: 'Anonymous' }`), exactly
  as `Instance.developer` and `DEFAULT_DEVELOPER` are (`engine/rules/instance.ts:293-316`, seeded at 0149:1234-1257).
- **A cast on a post may end.** Today only a use card or a play beyond a post has `lasts`
  (`engine/rules/instance.ts:453`, `card_kinds_problem` in 0148, and `place_cast` writes `ends` on a post play only
  for a use card). A veil is a cast on a post with a time up, so the engine lets any cast on a post carry `lasts`.

Divided World supplies the three cards, the anonymous poster's name, the cards' words, art and Overreaction's form.

## Task 1. The rules (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`, `engine/rules/types.ts`, `engine/rules/emoji.ts` and `engine/rules/emoji.test.ts`
(new).

**A cast on a post may end.**
- `CardRules.lasts`' comment (cards.ts:205-208) says a cast on a post with `lasts` ends at its time.
- `playProblems` (instance.ts:453) drops "only a use card or a card reaching beyond a post does".
- `landsOn` already leaves an ended effect out of the stack (`isLive`), and `drawnInMoment` already reads `lasts`.

**The flags.**
- `CardRules.veil?: 'author' | 'totals'` and `CardRules.reaction?: true`, each with a comment saying what SQL does
  with it (Tasks 2, 4 and 5).
- `playProblems` refuses, each driven red by a poisoned card in `instance.test.ts`:
  - a `veil` or a `reaction` on a card that is not a cast card;
  - a `veil` or a `reaction` on a card whose reaches are not exactly a post;
  - a `veil` with no `lasts` ("a veil ends at its time");
  - a `veil` that is neither `author` nor `totals`;
  - a card with both `veil` and `reaction`;
  - a `reaction` card that writes (`writes`), or that is `seeded`.

**The post-local reaction** (`engine/rules/emoji.ts`, pure, no import of a vendor):
- `singleEmoji(value: unknown): string | null`: the trimmed text when it is exactly one grapheme
  (`Intl.Segmenter`, granularity `grapheme`) that is one RGI emoji, else null. The test is
  `new RegExp('^\\p{RGI_Emoji}$', 'v')`, built in a `try` at module load: the repository targets ES2022, where a
  regex literal with the `v` flag does not compile, and a runtime without it (an older browser's preview) falls back
  to `/^\p{Extended_Pictographic}/u` on the one grapheme, leaving the server, which has the flag (Node 22, Deno), to
  decide.
- `emojiBase(emoji)`: the emoji with U+FE0F and the five skin-tone modifiers (U+1F3FB to U+1F3FF) removed, for
  comparing against the instance's set, so `❤` and `❤️`, and `👍🏽` and `👍`, are one emoji.
- `localKey(emoji)`: `x-` and the emoji's code points in lower-case hex joined by `-` (`💀` is `x-1f480`). It fits
  the key pattern `^[a-z][a-z0-9-]*$`, and a key can be turned back into its emoji (`emojiOfKey(key)`, null for any
  other key), so a tally row is drawn anywhere with no second read.
- `LOCAL_PREFIX = 'x-'`. `instanceProblems` refuses an instance reaction whose key starts with it
  (instance.ts:356-360): "reaction key "x-…" starts with x-, which is kept for reactions a card adds to one post".
- `localReaction(config, instanceReactions): Verdict<{ emoji: string; quadrant: Quadrant }>`, the one validator a
  `reaction` card's `validateConfig` calls. Its refusals, in this order:
  - "choose one emoji" (no emoji, or text that is not one);
  - "that is more than one emoji";
  - "this forum already has that reaction" (`emojiBase` equal to an instance emoji's);
  - "choose the quadrant it scores in" (not one of `QUADRANTS`).
- `ReactionKind` (types.ts:31) is unchanged. `InputReaction` (types.ts:386) gains `quadrant?: Quadrant`, sent only
  for a post-local reaction (Task 6).

**The anonymous poster.**
- `AnonymousPoster` in types.ts beside `DeveloperPersona`; `Instance.anonymous?`.
- `ANONYMOUS_STAFF_KEY = 'anonymous'` and `DEFAULT_ANONYMOUS = { name: 'Anonymous', tagline: '' }` in instance.ts.
- `anonymousProblems`, the developer's checks again (instance.ts:303-316) with "the anonymous poster" as the subject.
- A persona keyed `anonymous` is refused as one keyed `developer` is (instance.ts:568-569).

**Tests** in `emoji.test.ts`: `💀`, `❤️`, a flag, a keycap, a ZWJ family and a toned hand each pass and round-trip
through `localKey` and `emojiOfKey`; `ab`, `💀💀`, a lone variation selector, the empty string and a non-string are
refused with their words; `👍🏽` against a set holding `👍` is "already has that reaction". In `cards.test.ts`: a cast
with `lasts` on a post is refused a second copy while live and lands again after its end.

## Task 2. The author's veil (SQL)

Model: sonnet

**Files:** `NNNN-post-veils.sql`, `supabase/functions/_shared/seed.ts` and its test, SQL tests
`NNNN-post-veils.sql` and `NNNN-veil-sweep.sql` (new), and the existing SQL tests the changed grants break.

### The catalog and the stand-in

- `card_kinds` gains `veil text check (veil in ('author', 'totals'))` and `adds_reaction boolean not null default
  false`. `seed_instance` and `seed.ts:40-50` send `veil: c.veil` and `addsReaction: c.reaction === true`.
- `card_kinds_problem` drops its "only a Use card or a card reaching beyond a post" line and gains Task 1's five
  refusals that SQL can check. Poisons in its test: a veil on a use card, a veil with no `lasts`, a veil reaching a
  thread, `addsReaction` with a veil.
- `place_cast` and `lay_sprung` write `ends` on a post play whenever the card has `lasts`, where today `place_cast`
  does so for `play = 'use'` alone (0148:289) and `lay_sprung` never does.
- `characters_staff_kind_check` (0062:41-42) gains `anonymous`, with a unique index for the one of it, as
  `characters_one_developer` is. `seed_instance` makes the stand-in once, as it makes the developer: `insert into characters (name, staff, staff_kind, debuted_at) values (…, 'anonymous', 'anonymous',
  now())`, its profile row, and its avatar in a setting `anonymousAvatar`. A payload with no `anonymous` gets the
  engine's default from `seed.ts` (as `dev` is defaulted at seed.ts:29).
- `characters_public.office` says `'anonymous'` for it, as it says `'developer'` (0128:86).
- `stand_in() returns uuid`, stable: that character's id.

### One mechanism: `post_veils` and `acts_public`

```sql
create table post_veils (
  play uuid primary key references acts (id),
  post uuid not null references acts (id),
  veil text not null check (veil in ('author', 'totals')),
  author uuid not null references characters (id),   -- the post's own character, which never changes
  caster_account uuid references accounts (id),       -- null for a staff caster
  ends_at timestamptz not null
);
create index post_veils_post on post_veils (post, veil, ends_at);
create index post_veils_live on post_veils (veil, ends_at);
```

- Insert-only, by the append-only trigger pair `play_reach` has (0055:186). No API role reads it.
- A veil is **live** while `ends_at > now() and not card_ended(play)`.
- `land_rows(play uuid, kind_of card_kinds, post uuid, config jsonb, caster uuid)` writes what a landed post play
  needs beside its Act: a `post_veils` row for a veil card (and Task 5's row for a reaction card). `place_cast` calls
  it after its insert when the reach is a post and the cast was not caught; `lay_sprung` calls it for a Move landing
  on a quote.
- `land_refusal(kind_of card_kinds, post uuid, config jsonb) returns text`, reads only, the refusals below.
  `place_cast` raises its words (42501); `spring_facts` reads it for every back a quote meets, whatever the card, so
  a failed one returns before anything is written, as its other reads do.

**What is veiled.** An Act is veiled when a live author veil `v` has `v.post = a.id`, or `v.post = a.target_act_id
and v.author = a.character`: the post, and every Act its own author made on it (its edits, a set, a take-back, a use
card, its spring). The author's replies elsewhere are not: those are the clues the game gives.

**`acts_public`** keeps its columns, names and order (so no `begin atomic` function needs writing again for it), and
becomes two branches over a new ungranted view `acts_base` (today's `acts_public` body, true character):

1. every row of `acts_base` that is not veiled, as it is;
2. `union all` the veiled rows, found from the live author veils outward (`post_veils_live`, then `acts` by key and by
   `target_act_id`), each with `stand_in()` as `character`.

The second branch is driven from the veils, never from `acts`, so a read by `character`, by `thread` and `seq`, by
`id` or by `target_act_id` still goes down the index it goes down today, and pays one probe of `post_veils_post` per
row. There is no branch on who is asking: the projection is the same for every reader, so a broadcast built from
`act_projection` (0005:32) in the author's own session carries the stand-in too.

**The base table.** `acts` is granted to `authenticated` whole today (0001:282, policy `read using (true)`), so its
`character` can be read around any view. The migration revokes that and grants every column but `character`. A
security-invoker reader of `acts.character` then fails loudly: `my_cards_ended` (0092:909) is one, and becomes an
owner-rights view filtered by `auth.uid()` as `my_reactions` is (0018:111). The build runs the SQL suite after the
revoke and moves each reader the failures name.

### Every read that carried the author

| Read | Where | What changes |
|---|---|---|
| A thread's page, a quote's header, the ORIGIN box, History, a profile's and the record's post lists, alerts, the log's Acts, the model's digest and patrol sample | `acts_public` (through `thread_page`, `profile_page`, `record_page`, `alerts_page`, `log_page`, the client's own selects in `web/src/data/supabase.ts`, `system_digest`, `patrol_sample`) | nothing; the view answers |
| Realtime | `act_projection`, which every action returns and `supabase/functions/act/core.ts` broadcasts | nothing; the view answers |
| The board's and the index's first and last poster | `thread_open.first_character`, `last_character` (0079:36-37, joined on `acts`) | `shown_author(f.id, f.character)`; `thread_list` follows |
| Followed threads' newest poster | `my_followed_threads` (0076:71, 85) | `shown_author` |
| The caster's log of an ended play | `my_cards_ended.post_author_name` (0092:950) | `shown_author` |
| A play's moment | `play_moment` (0092:990-995 reads `acts`; 1025 reads the author's character plays) | reads the post through `acts_public` |
| Effects above a post | `card_target_reach` (0055:415) | a veiled post has no `above.character` |
| Search | `post_search.character`, a granted table (0117:433-445) | Task 3 |

`shown_author(act uuid, character uuid) returns uuid`: `stand_in()` when a live author veil is on `act`, else
`character`. Stable, security definer, granted to nobody.

**A veiled post is under no character.** While the veil is up nothing at its author's reach is drawn on it or priced
into a cast on it (the page reads `effects_above` from the page's shown characters already, 0149:191-194), because a
sparkle or a surcharge that follows the author would name them.

### The refusals and the staff

Each is a public fact and the same for every caster (`land_refusal`):

- on a post by a staff character: "a post by the staff keeps its name";
- on a post any Mod Bot visit names (`acts` of kind `visit` with that `target_act_id`): "a Mod Bot has been to this
  post, so its author is on the record".

And while an author veil is live on a post:

- `start_visit` returns null for it, as it does for a staff post (0131:360), so no rule, patrol, tail, report or
  backfire opens a visit there. `patrol_sample` already leaves it out (its join keeps `c.staff is null`, 0127:299).
- `open_report` refuses before anything is paid, beside its staff refusal (0114:128): "this post's author is hidden
  until %; report it after", 55000, with `refusal_time`.
- `place_cast` at character reach refuses the stand-in as a target: "no card is played on a stand-in", 22023.

### The author's own screens

- `my_veiled_posts`: `post, character, play, ends_at` for live author veils whose `author` the caller owns, filtered
  by `auth.uid()` as `my_face_down` is. Granted to `authenticated`.
- `thread_page` gains `'veiled'`: the caller's rows of it for the page's posts, beside `'faces'` (0149:257).

### Tests first

`NNNN-post-veils.sql`:
- a cast veil lands, ends at three days, and a second is refused while it is up and lands after;
- `acts_public` shows the stand-in for the post, its edit, a set and a use card by its author on it, and the true
  character for a reply by the author and for another character's card on it;
- after `ends_at`, and after an admin's `reverse_card`, every one of those shows the author again;
- the two refusals; `start_visit` null; `open_report` refused with nothing spent; a character card refused on the
  stand-in;
- a face-down veil lands on the quoting post and veils its author; one set on a post that quotes into a visited post
  does not land;
- `select character from acts` as `authenticated` is refused; `my_cards_ended` still lists the caller's own;
- `my_veiled_posts` holds the author's row and nobody else's;
- bounded reads, in the manner of `supabase/tests/0036-bounded-reads.sql`: with a live veil in the table, a profile's
  read by character, a page's read by thread and seq, and a read by id each stay on their index.

`NNNN-veil-sweep.sql`, the guard that the list above is whole:
- A fixture: author A's post P opens a thread, with an edit, a use card of A's on it, another character's quote of
  it, a spin from it, a follower, and an alert about it to a third player R.
- **The detector's poison:** before the cast, the sweep run as R must find A's id or name in the reads below, or the
  test fails; a detector that cannot go red proves nothing.
- After the cast, as R, none of these may hold A's id or A's name: `thread_page`, `acts_public` (by id, by thread,
  by character A and by the stand-in), `thread_open`, `thread_list`, `board_page`, `index_page`, `profile_page(A)`
  (P absent) and `profile_page(stand-in)` (P present), `record_page`, `alerts_page`, `log_page`, `my_followed_threads`,
  `my_cards_ended`, `play_moment`, `effects_above`, `post_tails`, `boot`, and Task 3's `search_posts`,
  `search_threads` and `search_suggest`.
- **Completeness:** the test holds one list of every view and function `authenticated` may read or run (from
  `information_schema.role_table_grants` and `has_function_privilege`), each marked `swept` or `no author` with its
  reason, and fails on a name the catalog holds and the list does not. Its poison: the test creates a granted view
  `select id, character from acts`, asserts the check names it, and drops it.

## Task 3. Search (SQL)

Model: sonnet

**Files:** `NNNN-post-veils.sql`, `supabase/tests/NNNN-veil-sweep.sql`, the search SQL test (0116).

`post_search` keeps the true `character`: its indexes and the plans 0117 was tuned on are untouched.

- `post_search` loses its whole-table grant and is granted every column but `character`.
- `search_matches` and `search_walk`, the two functions that run the built text, become security definer. Their text
  is built from typed literals alone (0117:662), and `search_match_conds`, `search_matches_sql` and
  `search_walk_sql` stay invoker.
- `search_match_conds`' author condition (0117:675): for an author that is not the stand-in,
  `character = author and not author_veiled(al.act)`; for the stand-in, `author_veiled(al.act)`.
- `search_matches_sql`'s two select lists (0117:711, 720) give `shown_author(p.act, p."character")` as `character`.
- `author_veiled(act)` is one probe of `post_veils_post`.

**Tests:** a search by A does not find P and a search by the stand-in does; a word in P finds it under the stand-in;
`select character from post_search` as `authenticated` is refused; the bounds 0116 holds (BOUND-1, BOUND-2, the
author walk) hold with a live veil in the table.

## Task 4. Blind totals (SQL)

Model: sonnet

**Files:** `NNNN-blind-totals.sql`, SQL test `NNNN-blind-totals.sql`.

- `totals_withheld(act uuid, account uuid) returns boolean`, stable, security definer: a live totals veil is on
  `act`, and `account` neither owns the veil's `author` nor is the `caster_account` of a live totals veil there.
- **`reaction_tallies`' policy** (0002:45, `using (true)`) becomes `using (not totals_withheld(act, auth.uid()))`.
  Every player's read of a total is as the caller: `thread_page`, `board_page` and `updates_page` are security
  invoker, and the client reads the table itself (`web/src/data/supabase.ts:1074`, `:1372`).
- **`react`** (0142:864) answers `'tally', null` for an Act with a live totals veil, to everyone, and
  `supabase/functions/act/core.ts:105` sends no `tally` event for a null tally. A broadcast is the same for the
  whole channel, so the author and the caster see the totals on a load, not live.
- **The machine's reads.** `reaction_tallies_open`, a view of the tallies less every Act with a live totals veil, for
  the three definer readers whose answers reach a screen or a model: `demand_progress` (0129:322), `pool_signals`
  (0088:122) and `system_digest` (0127:21).
- **The live estimate.** `estimate_input` (0148:1267) leaves out every other player's reaction to an Act where
  `totals_withheld(act, account)` holds, so an early call's direction or a card's lift on a blind post is not shown
  live. `settlement_input` is unchanged: the Lurker is paid at settlement by where the post leaned.
- `act_window_counts` (0065:35) is unchanged: a hint goes to the Act's own player.

**Tests:** as a third player the post's tally rows are absent from the table and from `thread_page`, and present for
the author and for the caster; `react`'s answer has no tally for anyone; `demand_progress` does not move with a
reaction to the blind post; `estimate_input` for a third player holds none of the others' reactions there and for the
author holds them all; `settlement_input` is the same with and without the veil; all of it returns at `ends_at` and
at an admin's end.

## Task 5. A post-local reaction (SQL)

Model: sonnet

**Files:** `NNNN-post-reactions.sql`, SQL test `NNNN-post-reactions.sql`.

```sql
create table post_reaction_kinds (
  post uuid not null references acts (id),
  key text not null check (key ~ '^x-[0-9a-f]+(-[0-9a-f]+)*$'),
  emoji text not null check (char_length(emoji) between 1 and 16 and emoji !~ '\s'),
  quadrant text not null check (quadrant in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative')),
  play uuid not null unique references acts (id),
  primary key (post, key)
);
```

- Insert-only. Readable by `authenticated` (it is the play's public configuration again).
- `reaction_kinds.key` gains `check (key !~ '^x-')`.
- `reactions.kind` and `reaction_tallies.kind` lose their foreign keys to `reaction_kinds` (0002:25, 36). A trigger on
  insert into each holds what they held: the kind is one of `reaction_kinds`, or one of `post_reaction_kinds` for
  that Act. `seed_instance`'s own test of a kind in use (0149:1044-1052) is unchanged.
- `land_rows` (Task 2) writes the row for a card with `adds_reaction`: the key is built in SQL from the emoji's code
  points, the way `localKey` builds it.
- `land_refusal` refuses, for such a card:
  - a configuration with no `emoji` or no `quadrant`, or a quadrant that is none: the engine's words from Task 1;
  - an emoji whose base is an instance kind's: "this forum already has that reaction";
  - a key the post already holds, live or ended: "this post already has that reaction" (23505).
- `reaction_quadrant(act uuid, kind text) returns text`: the instance kind's quadrant, else the post-local kind's on
  that Act.
- **`react`** accepts a kind that is one of the Act's post-local kinds whose play is not ended
  (`not card_ended(play)`); for an ended one it refuses "that reaction is no longer offered on this post" (22023).
  Reactions already given stay, with their tally and their scoring.
- **By quadrant.** `settlement_input` and `estimate_input` send `quadrant` on a reaction whose kind starts with `x-`.
  `act_window_counts`, `demand_progress` and `system_digest` read `reaction_quadrant` where they join `reaction_kinds`.

**Tests:** three land on one post and a fourth is refused by the stack; the same emoji twice is refused, and so is
an instance emoji with and without U+FE0F; a reaction of the local kind is taken, counted in `reaction_tallies` and
sent to settlement with its quadrant; the same kind on another post is "there is no reaction"; after an admin's end
a new reaction is refused and the old ones still settle; an instance kind keyed `x-ray` is refused by the check; a
face-down one lands on the quoting post with its configuration.

## Task 6. Settlement and the functions (engine, functions)

Model: sonnet

**Files:** `engine/rules/settle.ts`, `engine/rules/settle.test.ts`, `supabase/functions/act/core.ts` and its test,
`supabase/functions/estimate/` and `supabase/functions/settle/` only where a test names a reaction's shape.

- `settle.ts:195` and `:687` read a reaction's quadrant as `quadrantOf.get(r.kind) ?? r.quadrant`, and a reaction
  with neither is dropped as an unknown kind is today.
- `act/core.ts:105`: no `tally` broadcast when the answer's tally is null.
- `act/core.ts:157-191` needs no change: `decidePlay` runs the card's `validateConfig`, and `play_card` holds the
  rest.

**Tests** in `settle.test.ts`: a `x-1f480` reaction sent with `excitedPositive` pays a Face as a `fire` does and
costs a Jabroni the same; one sent with `boredNegative` pays the Jabroni; an earn Gimmick naming `laughing` leaves it
alone; one with no quadrant moves nothing. In `core.test.ts`: a reaction to a blind post broadcasts nothing.

## Task 7. The API, the fake backend and the web client (engine, web)

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`,
`web/src/data/supabase.ts` and its test.

- `Office` (api.ts:481) gains `'anonymous'`.
- The thread page's answer gains `veiled: readonly { post: Id; character: Id; play: Id; endsAt: string }[]`, carried
  as `faces` is (api.ts:1695), read from `thread_page`'s new key.
- `fake.ts` mirrors Tasks 2, 4 and 5: the stand-in in its characters; a veiled Act's character in every read it
  answers (the page, a profile's list, search, alerts, the thread list's first and last poster); the two refusals and
  the report's; a blind post's tallies for the author and the caster alone and no tally in a reaction's answer; a
  post-local kind taken by `react`, refused when repeated, and refused once its play is ended.

**Tests** in `fake.test.tsx`, one for each of those, each red first.

## Task 8. The screens (engine)

Model: sonnet

**Files:** `engine/ui/thread/Post.tsx`, `engine/ui/thread/feed.ts`, `engine/ui/thread/context.ts`,
`engine/ui/cards/Effects.tsx`, `engine/ui/cards/plays.ts`, `engine/ui/postbit/Postbit.tsx`,
`engine/ui/profile/Profile.tsx`, `engine/ui/reactions/Reactions.tsx`, `Picker.tsx`, `engine/ui/board/MoveNotice.tsx`,
`engine/ui/types.ts`, and their tests and stories.

**The world.** The postbit, the reaction row and the line under a post are the board's
(`docs/plans/2026-10-29-two-worlds-design.md`): Verdana, the board's ink, no color but on the game's own pieces. The
picker and the Lens are the glass's, plain and never in character.

**The stand-in.**
- A character whose office is `anonymous` is drawn as any character is, with no staff badge, no warn meter, no
  group bar and no ghost for a character card (`useReachShown`, Post.tsx:201).
- Its profile is the plain profile with one glass line under its name: "This is a stand-in. It is shown in place of
  a post's author while a card hides them."

**The author's own post.**
- The thread's context holds `veiled` (Task 7). `ownerOf(act)`, one helper, answers the reader's own character for a
  post in it, else `act.character`.
- The three places that ask whether a post is the reader's read it: the Edit button (Post.tsx:125), the reaction
  row's `theirs` (Post.tsx:58, 96, into Reactions.tsx:75), and `EffectReader.author` (Effects.tsx:162).

**When a veil lands or ends.**
- `plays.ts:85-90` keeps a post play whose time has passed, as it keeps a Use's, so its card's effect is still
  mounted and reads `play.ends`.
- `feed.ts`: when a play of a card whose rules have a `veil` arrives on the page's posts, and when the soonest such
  play's `ends` passes while the page is open (one timer for the page), the thread reads its page again. Nothing is
  sent.

**Reactions.**
- The row draws a chip for every kind in the Act's tally: the instance's, and any `x-` key through `emojiOfKey`
  (Reactions.tsx:73 draws the instance's alone today). `MoveNotice.tsx:88` uses the same lookup.
- In a thread, the row and the picker are given the post's local kinds from the thread's plays (`localKindsOf(plays,
  act)`: each play of a `reaction` card on the post that was not caught, with its quadrant and whether an admin
  ended it). The picker lists the live ones in their quadrant's group, after the instance's
  (Picker.tsx:155-171).
- A local kind's accessible name is the emoji itself, which a screen reader speaks by its own name, then the
  quadrant's label: `aria-label` "💀, Hype, added by a card". The engine holds no table of emoji names.
- A post with a live `totals` play, read from the plays as the row reads its local kinds: the row draws the
  reader's own reactions as pressed chips with no number, and one plain line, "Reaction totals are hidden on this
  post until {date}." Where the tally did come (the author, the caster) it is drawn as ever, with "Only you and the
  {author or caster} can see these until {date}."

**Tests:**
- `Postbit.test.tsx`: no badge, meter or bar for the stand-in.
- `Thread.test.tsx`: the author's veiled post has Edit and no React; a reader's has neither Edit nor the author's
  name anywhere in the post's markup; the page reads again on a veil play's arrival and at its end (fake timers).
- `Reactions.test.tsx`: a local chip from its key alone; a local kind in the picker under its quadrant with its
  label; an ended one drawn as a chip and absent from the picker; the blind row for a third reader, for the author
  and for the caster.
- The a11y self-test stories gain a veiled post and a blind post on both boards.

## Task 9. Divided World's cards (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/whodunnit.ts`, `blind-study.ts`, `overreaction.ts` (new),
`instances/divided-world/cards/index.ts`, `instances/divided-world/cards/cards.test.ts`,
`instances/divided-world/machine.ts`, `instances/divided-world/index.ts`.

```ts
export const whodunnit: CardRules<Record<string, never>> = {
  key: 'whodunnit', name: 'Whodunnit?', alignment: 'pepperoni', rarity: 'rare',
  lasts: { unit: 'day', count: 3 }, veil: 'author',
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(whodunnit, target, effects, now),
  validateConfig: () => ok({}),
};
```

- `blindStudy` is the same shape: key `blind-study`, name "Blind Study", uncommon, `veil: 'totals'`.
- `overreaction`: key `overreaction`, name "Overreaction", common, `stack: 3`, `reaction: true`, no `lasts`, and
  `validateConfig: (config) => localReaction(config, reactions)` with the instance's `reactions`
  (`instances/divided-world/reactions.ts`). Its `canApply` is `landsOn` alone: that the post does not already hold
  the emoji is SQL's to refuse (Task 5), since an effect carries no configuration for the rules to read.
- Each header comment says what the card does and names the design.
- `index.ts`: the three join `listed` and the header comment.
- `machine.ts`: `{ item: { card: 'overreaction' }, availability: 'onSale', price: 100 }` after Below the Fold;
  `{ item: { card: 'blind-study' }, availability: 'onSale', price: 150 }` after Good Vibes;
  `{ item: { card: 'whodunnit' }, availability: 'hidden', price: 300 }` last, after Main Event.
- `instances/divided-world/index.ts`: `anonymous: { name: 'Anonymous', tagline: 'Could be anyone.' }` beside
  `developer`, with no avatar (the default picture) until the owner gives one.

**Tests first** in `cards.test.ts`, beside Below the Fold's: each lands on a post and is refused past its stack with
`landsOn`'s words; each costs nothing; `castOnPost` holds for each (so Card Collector may name the common and the
uncommon, and not the rare); Overreaction's `validateConfig` keeps `{ emoji, quadrant }` and refuses each of Task 1's
four ways and every one of the sixteen instance emoji; the card list, the machine's slots and the Booster's odds
counts follow.

## Task 10. The art (instance)

Model: inline

**Files:** `instances/divided-world/ui/cards/whodunnit/`, `blind-study/` and `overreaction/`, each `art.webp`,
`scene.py`, `mark.svg` and `art.json` (new).

- `art.webp`: `docs/research/2026-11-11-card-renders/whodunnit.png`, `blind-study.png` and `overreaction.png`, each
  already 1080 by 1680, saved as lossy WebP at quality 90 (Pillow: `Image.open(p).save('art.webp', 'WEBP',
  quality=90)`), as Below the Fold's was.
- `scene.py`: `whodunnit.py`, `blind-study.py` and `overreaction.py` from the same folder, copied, with the two
  lines Below the Fold's copy carries: the import path is the folder above (where `rig.py` is), and
  `sys.dont_write_bytecode = True`.
- `mark.svg`, square and legible at 18 px: a postbit silhouette with a question mark (Whodunnit?); a reaction chip
  whose number is a blank bar (Blind Study); an emoji face bursting out of a chip (Overreaction).
- `art.json`: Below the Fold's, word for word.

Tests first: `node tools/check-card-art.mjs` red with a folder holding only `art.webp` (record the refusal), then
green over eighteen folders, with each file's size.

## Task 11. The cards' words, effects and form (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/cards.ts`; `instances/divided-world/ui/whodunnit/Effect.tsx`, `whodunnit.css`,
`Effect.test.tsx`, `Whodunnit.board.stories.tsx`; `instances/divided-world/ui/blind-study/Effect.tsx`,
`Effect.test.tsx`; `instances/divided-world/ui/overreaction/ConfigForm.tsx`, `form.css`, `ConfigForm.test.tsx` (all
new); `instances/divided-world/ui/index.test.tsx` (the `lands` table at line 86 gains the three, each `'the quoting
post'`); `instances/divided-world/ui/still.test.tsx` (both veils are drawn in a moment, since they have `lasts`).

Colors: each face takes the Pepperoni faces' color and ink, as Class Clown's entry does (cards.ts:216). `{span}` below
is the card's own `lasts` in words, read from its rules, never restated.

**Whodunnit?**
- `tagline`: "Who wrote this?"
- `summary`: "Hides who wrote a post from everyone, for a while."
- `status`: "Hiding this post's author"
- `hint`: "Nobody can see who wrote this post until the card ends."
- `describe`: "A Pepperoni card, rare. For {span} nobody can see who wrote the post: its name, picture and profile
  are replaced by a stand-in everywhere on the forum, in search and in alerts too. Anyone who read it before
  remembers. The author is still paid for the post and still sees that it is theirs. When the card ends the name
  comes back, and the post says so. It is refused on a staff post and on a post a Mod Bot has been to, and no Mod
  Bot visits the post while its author is hidden. One fits on a post. {setMoveWords('the quoting post')} It costs
  nothing more to play."
- `logPlay`: "It hides the post's author for {span}."
- **The effect** (`WhodunnitEffect`), around the post's words:
  - while up: it draws nothing over the words. `show`: `state` "Author hidden from everyone";
    `ends` `endsWords(play.ends)` then " The author's name comes back then."; for `reader.author`, `report` "This is
    your post. Everyone else sees the stand-in in your place, and so does this page."; no controls.
  - once `play.ends` has passed: one line under the words, in the board's small text, "Whodunnit? wore off on
    {date}. This post was {nameOf(post.character)}'s all along." `show`: `state` "The name is back".
  - an admin's end draws no line: the play is reversed and the effect is gone.
  - `still`: the line is drawn or not as the moment's time says; `met` not called; nothing bound.
  - It never reads `reader.caster`.

**Blind Study**
- `tagline`: "React in the dark."
- `summary`: "Hides a post's reaction totals from everyone but its author and you."
- `status`: "Hiding this post's reaction totals"
- `hint`: "You can still react. The totals show when the card ends."
- `describe`: "A Pepperoni card, uncommon. For {span} the post's reaction totals are shown to nobody but the post's
  author and whoever played the card. Everyone can still react, and sees their own reactions. Settlement counts
  every reaction as it always does. When the card ends the totals show. One fits on a post.
  {setMoveWords('the quoting post')} It costs nothing more to play."
- `logPlay`: "It hides the post's reaction totals for {span}."
- **The effect** draws its children and nothing else (the row's line is the engine's, Task 8). `show`: `state`
  "Totals hidden from you", or "Totals shown to you" for `reader.author` or `reader.caster`; `ends`
  `endsWords(play.ends)` then " The totals show then."; once ended, `state` "Totals are showing".

**Overreaction**
- `tagline`: "Bring your own emoji."
- `summary`: "Adds an emoji of your choosing to one post's reactions, scored the way you say."
- `status`: `(plays) => \`${plays.length} of 3 added\``
- `hint`: "This post has an extra reaction. Its label says how it scores."
- `describe`: "A Pepperoni card, common. It adds one emoji you choose to this post's reactions, and you say whether
  it scores as Hype, Heat, Calm or Groan. Anyone can then leave it, here and nowhere else; it does not react for you.
  It can be any single emoji the forum does not already use. Up to three fit on a post. It does not end.
  {setMoveWords('the quoting post')} It costs nothing more to play." The four names are read from
  `quadrantLabels`, never typed twice.
- `logPlay`: `(config) => \`It adds ${emoji} to the post's reactions, scored as ${label}.\``
- No effect: the row and the picker are the engine's.
- **The form** (`OverreactionForm`, a `ConfigFormProps` component, in the glass):
  - a text field labelled "Emoji", `inputMode="text"`, `autoComplete="off"`, with the help "One emoji. Your
    keyboard's emoji picker works here.";
  - a radio group labelled "Scores as", one radio for each quadrant in the picker's order with its label;
  - a line that says the choice back once both are set: "{emoji} will score as {label} on this post.";
  - the rules' refusal under the field as the play form shows any (`localReaction`'s words);
  - `onChange({ emoji, quadrant })` on every change; every control at least 44 px on a coarse pointer.

**Tests first:**
- `whodunnit/Effect.test.tsx`: the three views and their words; the line after the end with the name `nameOf`
  gives; no line in a reversed play; `still`; the Lens word rules (`lens-words.ts`) pass for every view.
- `blind-study/Effect.test.tsx`: the four states; the Lens word rules.
- `overreaction/ConfigForm.test.tsx`: typing an emoji and choosing a radio calls `onChange` with both; the
  say-back line; the labels come from the instance; keyboard reaches every radio.
- `index.test.tsx`: every card has art and a `CardUi` (the existing tests at lines 109-130 and 182-184).

## Task 12. The export, and the three cards in a browser

Model: sonnet

**Files:** `supabase/tests/e2e/0003-export.ts`, `e2e/veils.spec.ts` and `e2e/overreaction.spec.ts` (new),
`e2e/board-stories.test.ts`.

- The export's fixture gains a card kind with each flag, a live and an ended `post_veils` row of each veil, a
  `post_reaction_kinds` row with a reaction and a tally of its kind, and the stand-in. The round trip compares them
  as every other row.
- In a browser, on the stories: a veiled post shows the stand-in's name and none of the author's; the wore-off line
  after the end; a blind post's row for a third reader; Overreaction's form by keyboard, and the new chip in the
  picker under its quadrant; axe finds nothing on any of them, on both boards.

## Last. The full build, the pictures and the final review

- `npm run typecheck` and `npm run build:ci` are green.
- Screenshots go to the PR: the three faces at every card size; a veiled post for a reader and for its author; the
  wore-off line; a blind post for a reader, its author and its caster; Overreaction's form; the picker with a local
  kind; the stand-in's profile.
- The final reviewer reads the Review focus below.

## Ways out

- **A post whose author is hidden** shows them again by itself after three days, or at an admin's end.
- **A post whose totals are hidden** shows them again by itself after three days, or at an admin's end.
- **A post a Mod Bot will not visit, and a report that is refused,** end when the veil does; the refusal says when.
- **A post-local reaction** does not end. An admin's end takes it out of the picker and leaves the reactions given.
- **A cast refused** (a staff post, a visited post, a repeated emoji) is refused before it is written; the caster
  keeps the card.

## The masks

- **The projection is one for everybody.** `acts_public`, `thread_open` and search answer the stand-in to every
  reader, the author included, with the same reads in the same order. Nothing in them asks who owns a character.
- **The author's own fact** comes only from `my_veiled_posts`, the caller's own rows, as a setter's face-down card
  does from `my_face_down`.
- **Blind totals** differ only for the author's player and the caster's player, each reading their own characters'
  fact. A reaction's answer and its broadcast are the same for everyone: no tally.
- **The live estimate** withholds a blind post's other reactions from everyone but those two. Settlement, the one
  exception, is unchanged.
- **Every refusal** reads public Acts (a staff post, a visit, a play's emoji) and is the same for every caster.
- **Overreaction does not react for its caster,** so a play signs no reaction; the kind's quadrant is public on the
  play.
- **The stand-in** proves nothing: it is one character for every veiled post on the instance.
- **What is not hidden,** by the design: when the post was written, what it says, the author's other posts, and the
  memory of anyone who read it first.

## A busy instance

- `acts_public` pays one probe of `post_veils_post` per row read (two for a row with a target), on a table that
  holds a row per veil play ever made and is found by key. Its second branch reads the live veils, a few rows, never
  `acts`. A read by character, by thread and seq, by id and by target keeps its index (Task 2's bounded reads).
- `thread_open` pays one probe per thread row listed. Search pays one per row its walk reads for an author filter
  and one per row returned: at the relevance pool's 5,001 rows that is 5,001 probes of a small index.
- `reaction_tallies`' policy pays one probe per tally row read.
- `react` pays one probe of `post_reaction_kinds` for a kind that starts with `x-`, and none for an instance kind.
- The page reads again once when a veil lands and once when it ends, for readers with that page open.

## Decided in planning

- **A Mod Bot does not visit a post while its author is hidden, the post cannot be reported until then, and the card
  is refused on a post a Mod Bot has already been to.** A filing writes public Acts and a warn bar that name the
  author, which is a read carrying the author. The owner may prefer the visit to unmask.
- **Whodunnit? is refused on a staff post.** The staff are known to be staff, and a visit's record names its Mod.
- **Admins' screens show the true author.** Real moderation speaks plainly, and an admin can end the card.
- **The model reads the stand-in too,** since its words are posted. The System's own writes (settlement) read the
  truth.
- **A quote's header follows the read:** it names the stand-in while the veil is up and the author after, because a
  quote stores the quoted Act's id, never a name (`engine/ui/composer/text.ts:112`). Nothing is rewritten.
- **The author's profile leaves the post out while it is hidden, for the author too;** it is listed on the
  stand-in's profile. The author sees that it is theirs on the thread's page, where it is played.
- **The name's return is a line the post draws from the play's own time,** not a new Act: no job runs at the end,
  and what a post shows is computed from its Acts. It sends no alert.
- **No live tally event for a blind post,** even to its author: a broadcast is one message for the whole channel.
- **A post-local kind's key is `x-` and its code points,** and instance keys may not start with `x-`.
- **An emoji that differs from an instance emoji only by a skin tone or U+FE0F counts as already there.**
- **An emoji once added to a post cannot be added to it again,** even after an admin's end, so reactions already
  given never change quadrant.
- **A post-local kind's accessible name is the emoji itself and its quadrant's label;** the engine carries no table
  of emoji names.
- **The anonymous poster is "Anonymous", "Could be anyone.", with the default picture.** Its name and tagline are
  glass copy for the owner's review; a picture is the owner's to give.
- **Machine slots:** Whodunnit? hidden at 3.00 as Main Event is; Blind Study on sale at 1.50; Overreaction at 1.00.
- **A veiled post takes nothing from its author's character-reach effects** while the veil is up.
- **No card is played on the stand-in.**

## Review focus

- **A read the sweep does not list.** Any view, function or table column added by a sibling plan or since this was
  written that carries a post's character: the completeness check should name it, and a payload that names a
  character inside JSON (an infraction, an announcement, a card's `targetName`) is not caught by a column check.
- **Acts an instance already holds that tie an author to a post:** an appeal, a filing or a ban from before the
  cast. The visited-post refusal covers a visit; is there another public Act that points at a post and names its
  author?
- **The two branches of `acts_public`** under every plan the screens use: no row twice, none missing, at the instant
  a veil ends and at an admin's end, and for an Act whose target is veiled but whose character is not the author.
- **The author's own writes while veiled:** an edit, a use card, a take-back and a set by the author each broadcast
  the stand-in, and the author's page still works from `my_veiled_posts`.
- **A second run and a retry:** a cast retried after a timeout writes one `post_veils` row; a spring that lands a
  veil writes one; two Overreactions of the same emoji at once leave one.
- **Even work across every back.** `spring_facts` now reads `land_refusal` for every back a quote meets; a back that
  is a veil, a reaction card or any other Move does the same reads in the same order.
- **A blind post's totals by another road:** a board's demand progress, a hint, the estimate's lines, the digest a
  model reads, and the Lurker's ledger line a day later, which the design accepts.
- **The dropped foreign keys.** Nothing but `react` and the staff's reactions writes `reactions`; does every writer
  pass the trigger, and does the seed's refusal of a kind in use still hold?
- **A moderation shield.** Three days in which no Mod Bot visits a post, bought with a rare: is that the card the
  owner wants, or should the visit unmask?
- **The emoji test across runtimes:** Node 22, Deno and a browser without the `v` flag agree on the fixtures, and a
  browser's looser preview never lands what the server refuses.
- **Old devices.** A post-local emoji the reader's font lacks is an empty box with a quadrant label; the instance's
  set already accepts that for 🫡.
