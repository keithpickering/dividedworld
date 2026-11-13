Record, written 2026-11-13.

# A thread named by a setting is found by its key: plan

Issue #648. No design session preceded this; the plan is the build session's, and what it decided for the owner to
confirm is under "Decisions". One task. One migration and one SQL test, on placeholder numbers (0480).

## What the code is now

Two settings name a thread by its id, written as a JSON string: `systemAnnouncements` and `updatesThread`. Five
statements in four functions find that thread with `settings s join threads t on t.id::text = s.value #>> '{}'`:

| Function | Current definition | Statement |
|---|---|---|
| `spring_facts(face_down, text, uuid, text)` | `supabase/migrations/0340_conduct.sql` | `f.announce_thread`, read before every face-down back's decision |
| `place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb)` | `supabase/migrations/0317_surfaces.sql` | `in_thread` for a board card |
| `lay_sprung(uuid, text, jsonb, uuid, text, uuid, uuid)` | `supabase/migrations/0317_surfaces.sql` | `in_thread` for a sprung board card |
| `seed_instance(jsonb)` | `supabase/migrations/0332_arcs.sql` | two `not exists`, one for each setting |

A comparison on the id written as text cannot use `threads_pkey`, so each reads a whole index of `threads`. The count
of entries read moves with dead entries, which makes `supabase/tests/0135-face-down-moves.sql`'s equal-reads assertion
flaky, and it grows with every thread an instance holds ("Weigh a design at the scale of a busy instance").

Verified on main `6ec5a27c` by replaying every migration into a local database and reading `pg_proc`: these four are the
only live functions with the statement, and the migrations named above hold each one's live body.

## The form it keeps

One function, `setting_thread(in_key text) returns uuid`: the thread the setting names, or null. The four functions
call it, so the lookup is written once ("Two lists that must agree are one list").

- `language sql stable security definer set search_path = public, pg_temp`; execute revoked from `public`, `anon`,
  `authenticated` and `service_role`, as `spring_facts` and `lay_sprung` are. Its callers are security definer.
- The setting's value is read as a uuid only where it is a uuid's canonical text (lowercase, hyphenated: what
  `id::text` writes), so it finds exactly what the text comparison found, and a stray value finds no thread and never
  raises inside a quote. A regular expression, not `pg_input_is_valid`: that needs Postgres 16, and nothing else here
  does ("Portable by construction").
- The thread is then found with `t.id = <that uuid>`: one probe of `threads_pkey` whatever the instance holds.

For a back's decision the statement stays the same for every back, and now reads the same single entry, so the reads
are equal by construction. Nothing it reads is an owner, a class or a reactor.

## Task 1: the test, then the migration

Model: sonnet

**Tests first, with their red run on main's code.**

1. `supabase/tests/0135-face-down-moves.sql`, after the "reads were not counted" assertion: `threads` (the seventh
   relation in name order in `pg_temp.reads()`) is read at most 8 entries in a quote's facts and a cast's facts.
   Message: `a back's decision reads % and % entries of threads, a whole index and not a key`.
2. New `supabase/tests/0480-setting-thread.sql`:
   - `setting_thread` returns the thread for a setting that names one; null for a key with no setting, a value that is
     not a uuid (`"nope"`, a number, an uppercase uuid), and a uuid no thread has. None raises.
   - `anon` and `authenticated` cannot execute it.
   - Scale: with a few hundred more threads inserted and `analyze threads` run, each of these reads at most a small fixed
     number of `threads` entries, counted as 0135 counts them: `setting_thread` itself, `place_cast` of a board card,
     `lay_sprung` of a board card, and `seed_instance` run again on a seeded instance. Where a function reads `threads`
     for other reasons, the assertion is that the count is the same with the extra threads as without them. Each
     message names the function and the count.
   - Each of the four functions still finds the announcements thread (a board card played and one sprung land in it;
     `seed_instance` run again makes no second announcements or updates thread).

**Then** `supabase/migrations/0480_setting_thread.sql`: `setting_thread`, then the four functions written whole from the
definitions in the table, each with only its lookup statement changed. `create or replace` keeps owner and grants.

**Proof the bodies are otherwise unchanged:** `pg_get_functiondef` of each of the four before and after the migration,
diffed; the diff holds the five statements and nothing else. Its output goes in the PR.

**Poison:** with the migration applied, put the text join back in `setting_thread` alone; 0135's new assertion and
0480's scale assertions go red. Recorded in the PR.

## Decisions

1. **Scope.** This covers every thread found from a setting. Other live functions compare a key written as text with a
   payload's text (`boards b where b.id::text = …` in `acts_describe_guard`, `arc_board`, `handoff_facts`,
   `inheritance_due`, `rule_params_problem`; `acts s where s.id::text = new.payload ->> 'set'` in `acts_well_formed`).
   Those are a different lookup with different inputs to validate and are not on the path of a back's decision, so
   they get an issue of their own and not a place in this change.
2. **A regular expression and not `pg_input_is_valid`**, as above.

## Review focus

- `spring_facts` makes the same reads for every back, and `setting_thread` does not change that.
- Each recreated function is main's current body with only the lookup changed.
