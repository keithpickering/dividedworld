# Clues, not proof: plan

Record, written 2026-10-29. Carries out `docs/plans/2026-10-29-clues-design.md`. A build session carries it out task by
task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`). Every file below that is not marked
new is main's at `5bd414d` (PR #9 merged). Migrations take the next free numbers, from `0023`; the names below say which.
The rule change itself (CLAUDE.md, "A response never proves a private fact", and its record) and the amendments to
the screens design and web plan are in this plan's own PR and need no build.

No instance has players ("Nobody is waiting on a hotfix"), but each migration still runs on an instance that already
holds PR #9's rows, and each task's tests say what it does to them.

## The layers

Engine: SQL under `supabase/migrations/`, `engine/rules/`, the `avatar` and `estimate` functions, the tools. Instance:
`instances/divided-world/classes/`, which fill the `Earning.at` and read `HeldVote.reactedAt` that Task 2 adds. The
engine still names no instance.

## Tasks

### Task 1. Thread views count characters

- New `supabase/migrations/0023_views.sql`:
  - New `thread_reads` (thread, reader, first_read_at), private, no grant: `reader` is the character read through, or
    the account where the read had no character; primary key (thread, reader); index on `first_read_at`.
    `mark_read()` (0018) inserts `(in_thread, coalesce(through, caller))` on conflict do nothing, beside its `reading`
    row, which is unchanged (`first_character` stays, for a reveal a card may one day make).
  - `thread_reads` is filled once from `reading`: each row's `first_character`, or its account where that is null.
    That is every mask PR #9 recorded; masks that read after a player's first read were not recorded and are not
    guessed.
  - `thread_view_counts.players` is renamed `views`; `count_thread_views()` counts `thread_reads` rows per thread,
    recounting only threads with a row since the last run less its ten minutes (as now).
  - `grant select on thread_view_counts to authenticated` with a read-all policy. Its header says why: a count of masks
    is the masks' doing (the design, section 2; CLAUDE.md, "A response never proves a private fact").
- `supabase/tests/0014-realtime.sql`: `thread_reads` and its `reader` named among the private tables and columns.
- `tools/instance-files.mjs` needs nothing (it reads every table); e2e/0003's round trip seeds `thread_reads` (it fails
  until it does, by its own rule).
- **Tests first** (`supabase/tests/0024-reading.sql`, rewritten where it asserts players): one player reading through
  three masks counts three; the same mask reading twice counts once; a reader with no character counts once, and again
  once they read through a mask; the count moves only when the job runs; a player reads the counts and no
  `thread_reads` row, theirs included; the migration's backfill counts each `reading` row's first character.
- **Poisons:** `mark_read` writing the account in place of the mask → "one player through three masks counts three";
  the old count of `reading` rows restored → the same; the read policy dropped → "a player reads the view counts".

### Task 2. Exact estimate lines

- `engine/rules/types.ts`: `Earning` gains `at?: number`, the time of the one reaction it comes from; its doc says an
  earning for one reaction names it, one for many alike votes names `valuing`, and one for no reaction neither.
  `HeldVote` gains `reactedAt`, the time of the reaction the vote is held through (the latest by the player's voice in
  that quadrant, `p.voice[q]` in `settle()`).
- `engine/rules/settle.ts`: `Detail` gains `at`; `settle()` passes `e.at` into each contribution and keeps it in the
  details' line key (`lines`, the key built from player, character, reason, act and quadrant), so lines with different
  times stay apart. Ledger entries are unchanged: they sum per reason. `estimateForOwner()` drops the even split: a
  detail with `at` is one line at that time, whole; one with `valuing` is split over the votes it values (each a whole
  vote alike, so exact), as now; any other is one line with no time.
- `instances/divided-world/classes/shared.ts` (`perVote`: `at: r.at`), `lurker.ts` (`calledIt`: `at: h.reactedAt`;
  `cardDrew`: `at: r.at`). `face.ts`'s lift keeps `valuing`.
- **Tests first** (`engine/rules/settle.test.ts`, `instances/divided-world/classes/classes.test.ts`): a Lurker's call on
  a post with three other reactors is one line, on the Lurker's own reaction's time, with the call's whole amount (it
  is apportioned over the three today, which is the red run); two reactions in one quadrant are two lines of a whole
  vote each, at their own times; the settlement's ledger entries are the same as before the change on every existing
  fixture; e2e/0005's scoped estimate still equals the full one filtered.
- **Poisons:** `perVote` without `at` → the two-reaction test; `estimateForOwner` splitting evenly again → the
  Lurker's.

### Task 3. Drop now, or debut at the tally

- New `supabase/migrations/0024_debuts.sql`:
  - `characters.debut_loudness text not null default 'announced' check (in ('silent', 'announced'))`.
  - `create_character(name, class, timing text default 'tally', loudness text default 'announced')` (0009): `timing`
    is `'now'` or `'tally'`. For `'now'`, `debuted_at` is set to the creation time in the same insert, and, where
    announced, The System writes a tally Act of one debut at once (below).
  - `set_debut(through, timing, loudness)`, as the character's player, for a character still waiting: changes its
    loudness, or drops it now. Refused for one that has debuted ("it has debuted").
  - The announcement: `masks_change()`'s writing of a tally Act (0007) is drawn out into `post_tally(in_season,
    debuts, turns, at)`, which `masks_change()` calls and `create_character()`/`set_debut()` call for a drop, so the
    two cannot drift; the drop's payload is a tally's (`debuts` of one, `turns` empty) and it is broadcast like one.
    It opens the season's Turns thread where it is not open yet, as the tally does.
  - `masks_change()` names a scheduled debut in the tally only when announced; a silent one debuts unnamed.
  - A drop between seasons: debuted at once like any other; the announcement waits for the next tally, since no
    season holds a Turns thread then (the builder confirms how `acting()` treats the gap and writes the test).
- `engine/rules/actions.ts` (`createCharacter`, and a new `setDebut`) and `supabase/functions/act/core.ts`: the two
  options, checked before the database is asked, and the answer's `waiting` false for a drop.
- **Tests first** (new `supabase/tests/0031-debuts.sql`; `engine/rules/actions.test.ts`): a dropped character acts at
  once and is in `characters_public` and `season_standings`; an announced drop writes one tally Act naming it, on
  The System's board, broadcast; a silent drop writes none; a silent scheduled debut is in no tally and debuts at the
  settlement; a waiting character dropped now acts at once; `set_debut` by another player is refused, and for a debuted
  character too; the season's reveal names a silently dropped character; the defaults leave `create_character(name,
  class)` as it is today.
- **Poisons:** the drop writing `debuted_at` null → "a dropped character acts at once"; `masks_change()` naming silent
  debuts → "a silent scheduled debut is in no tally".
- **Way out:** a waiting character debuts at the next settlement, or its player drops it now.

### Task 4. Avatars: two files, public, swept

- `supabase/functions/avatar/core.ts`: `LIMITS` becomes `{ square: { side: 256, bytes: 100_000 }, portrait: { width:
  [256, 512], ratio: [1, 2], bytes: 400_000 } }`: a portrait from 256 to 512 wide and from 1 to 2 times as tall as
  wide. The request is a portrait (required for an upload) and a square with its frame inside the portrait; a recrop
  sends only a new square and frame, and keeps the portrait. No source is taken; a request carrying one is refused
  ("an avatar is two crops; the original stays with you"). Its header is rewritten to say so.
- New `supabase/migrations/0025_avatars.sql`:
  - `set_avatar` (0019) without its `source`; it locks the character's row (`characters`, `for no key update`) before
    reading the profile, so a first avatar is locked too (#11); it returns the replaced keys, now including the
    original a profile held.
  - `character_profiles.avatar_source` is dropped, after its keys are written to a private `avatar_orphans` (key,
    since) for the sweep; the check constraint loses its source clause. A profile with a square and no portrait stays
    valid.
  - The `avatars` bucket is made public (`public = true`), its size limit the largest of the new `LIMITS`; no policy
    lets anyone list `storage.objects` in it.
- `tools/instance-files.mjs`: `BUCKETS`' columns lose `avatar_source`. New `tools/sweep-avatars.mjs` (an operator's
  tool, as the export is; `KAYFABB_STORAGE_KEY`, never printed): lists the bucket through Storage's REST endpoint and
  removes each file no profile names and written more than an hour ago, `avatar_orphans` first. Its pure part
  (`unnamed(objects, named, now)`) is exported from `instance-files.mjs`.
- **Tests first:** `avatar/core.test.ts`: a portrait 512 by 1024 is taken, one 513 wide or taller than twice its width
  is refused, a source is refused, a square frame outside the portrait is refused, a recrop with no portrait keeps the
  stored one; e2e/0006: the bucket is public, WebP alone, its limit the largest file `LIMITS` allows; `0025-profiles.sql`:
  two first avatars at once (dblink, as the race files do) leave one profile whose replaced keys name the other's files,
  and a profile's original key moves to `avatar_orphans`; new e2e/0007-avatar-sweep.ts against a fake Storage (as
  e2e/0003 runs one): a file no row names and older than an hour is removed, a named file and a new unnamed one are
  kept.
- **Poisons:** `set_avatar` without the character lock → the race test; the sweep without its hour → "a new unnamed
  file is kept"; the bucket left private → e2e/0006.

### Task 5. Whoops! states of 0006's shape

- New `supabase/migrations/0026_whoops_legacy.sql`: each `effect_state` row of a Whoops! play holding a stroke with no
  `tool` becomes `{"strokes": [], "legacy": <the old state>}`. `instances/divided-world/cards/whoops.ts`'s
  `validateState()` takes no `legacy` from a save, so the next save drops it.
- **Tests first** (`supabase/tests/0023-cards-screens.sql`, a new block): a seeded 0006-shape state is wrapped; a state
  of the new shape is untouched; the author's next save with new strokes is accepted.
- **Poison:** the migration's `where` widened to every row → "a state of the new shape is untouched".
- **Way out:** none needed: the post is no more held than before; a save is accepted.

### Task 6. `next_settlement_at`'s cap at the season's end

- `supabase/tests/0021-pending-turns.sql`, a new block: a season whose end falls inside the open window; `turn()`'s
  `takes_effect_at` and `next_settlement_at()` promise the season's end, checked through `pg_temp.promise_kept`
  against `next_settlement_window()`.
- **Poison:** 0014's `end_at := least(end_at, coalesce(season_end, end_at))` removed in a scratch copy → "a Turn in a
  season's last, short window is promised 2027-01-14 00:00:00+00, not the season's end 2027-01-13 12:00:00+00" (the
  sixth final review's red line on PR #9).

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A character waiting to debut, silent | The next settlement; its player drops it now |
| A Whoops! state moved under `legacy` | Its author's next save |
| A file no row names | The sweep, an hour after it was written |

## What could be computed from a private fact, and how it is not

- `thread_view_counts` counts masks and characterless readers, never players; which masks read is never shown.
- A drop's announcement and its timing are the player's choice; nothing about it depends on who else plays what.
- An avatar file's `Last-Modified` dates its upload: a clue, by the design's section 1.
- `set_debut`, `thread_reads` and `avatar_orphans` are read by their own player or by nobody.
- The estimate's lines name a reaction's time and amount, never who left it, as now.

## Review focus

- `thread_reads` at a busy instance: one row per mask per thread read, and the count's reads per run.
- The backfill of `thread_reads` from `reading`: a reading row whose first character has since been retired.
- `settle()`'s details keyed by `at`: one line per reaction, in memory only, at `settle.scale.test.ts`'s sizes.
- A drop racing the settlement that would debut it: its announcement and the tally naming it twice.
- The sweep racing an upload: a file stored, its profile not yet written, and the hour.
- The public bucket: that no policy, old or new, lets a signed-out reader list it.
- `avatar_source`'s drop on an instance whose export manifests name it: an older export imported after this migration.
