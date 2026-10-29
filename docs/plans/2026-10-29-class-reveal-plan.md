# A class revealed by choice: plan

Record, written 2026-10-29. Carries out `docs/plans/2026-10-29-class-reveal-design.md` (#14). A build session carries
it out task by task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`).

**It starts after the clues plan (`docs/plans/2026-10-29-clues-plan.md`) is built and merged**, since it extends that
plan's debut options (`0024_debuts.sql`, `post_tally()`). Every file below that is not marked new is main's after that
build; a builder who finds a name changed reads the merged version and lists the difference under `Plan gaps`.
Migrations take the next free numbers after the clues build's last (planned as `0026`), so from `0027`. The rule's new
sentence (CLAUDE.md), its record, and the amendments to the screens design and web plan are in this plan's own PR and
need no build.

## The layers

Engine: SQL, `engine/rules/actions.ts`, `supabase/functions/act/`. Instance: `instances/divided-world/` names the
words a player reads, through `Copy` and the web plan, and each class's badge look. The engine names no class.

## Tasks

### Task 1. The reveal Act

- New `supabase/migrations/0027_unmask.sql`:
  - `acts.kind` gains `unmask`; `acts_well_formed()` and the kind checks of `0001_core.sql` admit it as a character's
    Act in a thread, with no target. Its payload: `{ class, message }`.
  - `unmask(through, in_thread, message)`, as the character's player (`played_by`, so a waiting or retired character
    is refused as everywhere): reads the character's class now (`class_now`, 0007), writes the Act, broadcasts it like
    a post. Refused on The System's board, as a post is. A message is plain text, at most 200 characters, may be empty.
  - `class_reveals` (view, public read): every `unmask` Act, with its character, class, date and how it was made
    (`act`, `debut`, `turn`). Every reveal is an `unmask` Act (Task 2 writes the debut's and the Turn's), so this reads
    one kind of Act. And
    `turns_announced` (view, public read): every announced Turn from the tallies, with its date and, where named, its
    old class. Both read only Acts, never `class_history`.
- `engine/rules/actions.ts` (`unmask`) and `supabase/functions/act/core.ts`: the action, its message checked before the
  database is asked.
- `engine/rules/settle.ts`: an `unmask` Act is an Act of its character like a card: reactions to it are scored, it
  counts in the halving, and it is not a post (`ClassInput.posts` takes `post` alone, as now). The settlement input
  (`settlement_input()`) carries it; the estimate input (`estimate_input()`) too.
- **Tests first** (new `supabase/tests/0032-unmask.sql`, after the clues build's `0031-debuts.sql`; `engine/rules/actions.test.ts`;
  `engine/rules/settle.test.ts`): a reveal names the class held at that moment; another player's character, a waiting
  one and a retired one are refused; a reveal on The System's board is refused; a message of 201 characters is refused;
  a reveal made while a Turn is pending names the class held, and after the tally `class_reveals` still dates it to
  its moment; a Face's reveal drawing a cheer pays the Face's cheer; a Lurker's reveal is not a post toward its limit;
  `class_reveals` holds no row for a character whose player made nothing public, and no column of `class_history`.
- **Poisons:** `unmask` reading the class from the payload a client sent → "a reveal names the class held at that
  moment"; `class_reveals` reading `class_history` → "no row for a character whose player made nothing public";
  `ClassInput.posts` taking `unmask` → the Lurker's.

### Task 2. Creation and Turns, announced with a class

- New `supabase/migrations/0028_loud_classes.sql`:
  - `characters.debut_loudness` (0024) admits `'with_class'`; `create_character()` and `set_debut()` take it; the
    tally entry of such a debut, and the drop's announcement (`post_tally()`), carry `class`.
  - Each debut announced with its class, and each Turn with `show_to`, writes the character's `unmask` Act when it
    takes effect, `{ class, message: '', via: 'debut' | 'turn' }`, in the season's Turns thread right after the tally
    Act (or the drop's announcement) that names it: one shared `write_unmask(character, in_thread, via, at)` that
    `unmask()` (Task 1), `masks_change()` and `post_tally()` all call, so they cannot drift. It is the one Act a
    character has on The System's board, written by The System for it; `post()` and `unmask()` still refuse players
    there. Between seasons, a drop's reveal Act waits with its announcement for the next tally.
  - `pending_turns.loudness` becomes two flags, `show_from` and `show_to`, beside `silent | announced`: `turn(through,
    to_class, loudness, show_from default false, show_to default false)`. Today's `'revealed'` rows become `announced`
    with `show_from`. `masks_change()` names `was`/`since` for `show_from` (as now) and `class` for `show_to`.
  - `turn()`'s old three-argument form is kept as a wrapper, so an older client's `'revealed'` still works.
- `engine/rules/actions.ts` (`turn`, `createCharacter`, `setDebut`): the new options.
- **Tests first** (`0021-pending-turns.sql`, `0031-debuts.sql`, new blocks): a debut announced with its class names it
  in the tally and writes the character's `unmask` Act after it, in the Turns thread, dated at the debut (a drop's at
  once), which can be reacted to (the reaction scored for the character) and spun; a silent or plain announced one
  writes none; a Turn with `show_to` names the new
  class and writes an `unmask` Act dated at the tally; with `show_from` alone it names the old class and writes none; a
  pending `'revealed'` Turn from before the migration takes effect with its old class named, as asked.
- **Poisons:** `masks_change()` naming `class` for every announced Turn → "a plain announced Turn names no class";
  `masks_change()` naming the class in the tally without writing the Act → "a debut announced with its class writes
  the character's unmask Act";
  the migration dropping `'revealed'` rows' meaning → the pending-Turn test.

### Task 3. The season's reveal keeps the secrets

- New `supabase/migrations/0029_reveal_rolls_over.sql`: `reveal_season()` (0007) replaced: each character's Act, in
  order of final standing, carries its place and standing and, in place of `classes`, `shown`: the season's rows of
  `class_reveals` and `turns_announced` for it, in order. Nothing is read from `class_history`.
- Earlier seasons' reveal Acts are left as written.
- **Tests first** (`0013-seasons.sql`, where it asserts the timeline, rewritten): a character whose player made nothing
  public is revealed with its place and standing and no class; a silent Turn appears nowhere; a reveal and an announced
  Turn with its old class appear, dated; characters are in order of final standing; a season revealed before the
  migration keeps its Acts.
- **Poison:** `reveal_season()` reading `class_history` again → "a silent Turn appears nowhere".

### Task 4. Export and live updates

- e2e/0003's round trip seeds an `unmask` Act and a Turn with `show_to` (its rule makes it fail until it does).
- `supabase/tests/0014-realtime.sql`: no new table is published; `class_reveals` and `turns_announced` are views.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A revealed class | None needed: it holds nobody. A player who wants the secret back Turns (silently, if they like), and the badge stays a dated fact; or starts a new character |

## What could be computed from a private fact, and how it is not

- `unmask` reads the character's class only at its own player's request, and states only that class as of that
  moment (CLAUDE.md, "A response never proves a private fact", its sentence on making one's own fact public).
- `class_reveals`, `turns_announced` and the season's reveal read only Acts that were public when written, never
  `class_history`.
- A refusal of `unmask` is seen only by the player who asked, about their own character.

## Review focus

- What the migration of `pending_turns.loudness` does to a Turn waiting across it, and to an older client.
- `class_reveals` at a busy instance: a view over every `unmask` Act, read for every postbit.
- A reveal racing the tally that applies a pending Turn: the class it names, and its date against the Turn's.
- The season's reveal: that no path still reads `class_history` for a character's public row.
