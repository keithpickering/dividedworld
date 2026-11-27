-- Surfaces count each tag's own paint, in coats (docs/plans/2026-11-27-graffiti-everywhere-design.md, sections 5, 6, 7 and 8; plan docs/plans/2026-11-27-graffiti-everywhere-plan.md, Task 4). Before, a wall was one grid of
-- covered cells, and a cell inked by two draws cost once. Now each live draw has a grid of its own, because a drawing is attached to the words or the image it was drawn on and the server can no longer know how two drawings from
-- different screens overlap: ink over another tag's ink is paid for again, and the sponge takes paint a coat at a pass. What a surface shows is still computed from its Acts and kept in rows of its own, written in the same
-- transaction as each Act under the lock on the surface row (0317), so two drawers can never both squeeze under the limit.
--
--   1. the derived rows   surfaces gains `covered` (the sum of each live draw's painted cells) and `washes` (for each live wash, the live draws it changed); `cover` and `owners` go once every reader is off them (section 8).
--                         surface_coats (play, draw, coats smallint[10000], painted): one row for each live draw, RLS on and no grant, as surface_marks. surface_places (draw, grp, version, place): where each group of a draw is
--                         attached for each version of the post, the attachment or JSON null for its box spot; the same grants as `surfaces` (authenticated select).
--   2. coats              tenths of a coat, 0 to 40 for each cell, in a coat string of 10,000 characters over `0123456789abcdefghijklmnopqrstuvwxyzABCDE` (the index of a character is its tenths; engine/rules/surface.ts).
--                         A cell is painted while it holds 2 tenths or more; at 1 or less it is clean and is kept at 0, a draw's own grid included (surface_lay). coat_cells decodes a string (immutable), surface_lay lays a draw's grid, surface_take subtracts, surface_painted counts.
--   3. the payload check  acts_surface_payload: a draw holds `groups` and `coats`, or the old `strokes` and `cells`; a wash holds `cuts` and `takes` ([{draw, takes}]), or the old `strokes` and `cells`; the payload less `cells`,
--                         `coats`, `takes`, `uncovered` and `cut` is at most 64 KiB, so the coat strings the server keeps are not the drawer's to spend.
--   4. the count          surface_apply(play, character, kind, payload, coats, takes, places, most) replaces 0423's, under the same lock and with the same refusals in the same words. A draw is refused on covered + its painted cells
--                         against `most` (the wall's own figures in whole percents) and on the 48th live draw, counted as surface_coats rows. A wash is never refused: for each draw it names that is live the cells become
--                         greatest(0, c - t); `uncovered` is the cells that went from painted to clean and `cut` is [{draw, took}] with took > 0, kept in the payload and written to surface_marks and surface_cuts as before. A draw with
--                         nothing painted leaves surface_coats and `live`, and a wash stays live while a draw it changed does. The Act keeps the takes that changed something, so replaying it gives the same wall.
--   5. the writers        draw_on_surface, wash_surface, staff_draw_on_surface, play_surface_card and staff_play_surface_card take the new arguments (`coats text`, `places jsonb`, `takes jsonb`; `first_coats` and
--                         `first_places` for a play's first draw); the old overloads are dropped. edit_post gains `surface_places jsonb default '[]'`, written against the edit's own id. set_surface_card went in 0343, so there is no writer
--                         of a back's draft to change (face_down_never_writes keeps refusing a new back). lay_sprung lays a draft set before 0343 as an old-shaped draw, by the legacy rule, with no places.
--   6. legacy             A draw stored with `cells` and no `coats` is laid at 20 tenths (2 coats) on each set cell; a wash stored with `cells` and no `takes` takes every coat of each draw older than it on its set cells. Their Acts
--                         are never changed (CLAUDE.md, "Append-only"); surface_replay reads both shapes in `created_at, id` order. rebuild_surface returns the row (covered, live, washes), rebuild_surface_coats the grids.
--   7. readers            redefined from their latest definitions, `bit_count(sf.cover)` becoming `sf.covered` and nothing else: card_target (0413), thread_page (0451), digest_plays (0433), extras_ids (0426).
--                         surface_acts (0368) gives each draw its `share` (its own painted cells) and its `places` for the post's current version (its latest edit by created_at, id, or the post), and no grid; `older` counts the draws no
--                         longer live. surface_marks_of counts a draw's painted cells. surface_shares (service and authenticated) is the one fact of surface_coats the Lens reads.
--   8. two reads for the server function (service role only)
--                         surface_groups_on(post) gives an edit the post's current version, its body and verdict and every live group's place for it; surface_version_pair(post, version) gives a draw the current version beside the one it
--                         was drawn on (null when that is not a version of the post).
--
-- Why a column of `washes`. A wash is live while a draw it changed is. A draw is cleared only by washes, so the draws a wash changed are a fact the write knows when it takes the paint off; keeping them beside `live` means a write
-- that clears a draw prunes by reading the row it already holds, never the payloads of the live washes (each carries a coat string for every draw it cut).
--
-- Where the old rule and the new part ways, for the walls already stored. A draw of the old shape is laid at 2 coats where it inked, so it shows as before, and a wash of the old shape takes the coats of every draw older than
-- it on its cells, so it shows as before; but `covered` is now a sum over draws, so a legacy wall whose draws overlapped counts the overlap, and a wall near its limit may sit over it until a wash. Nothing refuses it
-- retroactively: only a new draw meets the limit. A legacy wash's `cut` (the draws that owned the cells it uncovered) is as it was stored; the replay may touch other draws under the same cells, and keeps them live.
--
-- What the rebuild preserves of a legacy wall. 0317 kept a draw live only while it owned a cell: each cell belonged to the last draw that inked it, a wash left its cells with no owner, and a draw that owned none was pruned.
-- surface_replay applies that rule to the Acts of the old shape (a draw with `cells` and no `coats`, a wash with `cells` and no `takes`) up to the first Act of the new shape: a legacy draw that owns no cell after a legacy
-- step leaves the live list, its grid is cleared, and the washes that only changed it go with it, so a draw 0317 had pruned does not come back. A draw that still owns a cell keeps the whole grid it inked, at 2 coats,
-- less what legacy washes took: 0317's screens drew every live draw's strokes in full, so that is the paint the wall showed, and ownership decides only whether a draw is live. The cells it shares with a later draw are
-- then counted twice in `covered`, as above. From the first new-shape Act on (or from a draw laid by lay_sprung, which is first on its wall) only the coats rules apply.
--
-- Privacy ("A response never proves a private fact"). Nothing here reads who owns a character except played_by (the caller's own mask) and the wash's author check, as before. A draw's places and a wash's takes are computed
-- from the drawing, the post's words and the author's wash alone. surface_groups_on and surface_version_pair read Acts and the post's versions: no owner, no class, no reaction.
--
-- At a busy instance's scale. A write takes one lock and touches the grids of the draws it changes, at most 48 of 10,000 cells, the same on a wall of ten Acts or ten thousand: a draw decodes one coat string and writes one row;
-- a wash decodes and subtracts one grid for each draw it names. Measured on local Postgres 16 (a laptop-class machine, the migration's own functions, 48 live draws on one wall): a wash cutting all 48 holds the row's lock for
-- 225 to 350 ms (eight runs, a realistic pass and a worst-case random one alike, since the cost is the 48 grids and not their content). The Act it writes is small, because a pass is mostly zeros and Postgres compresses
-- them: the whole payload of a 48-draw wash (48 takes of 10,000 characters, 483,024 in all) is 9,823 to 9,824 bytes as stored (pg_column_size of the Act's payload), and a grid of one draw is about 320 bytes. A takes string of
-- random characters, which no sponge makes, does not compress: 487,184 bytes stored, still one row. The 64 KiB bound leaves the server's keys out. An edit writes at most one surface_places row for each live group (at most 48 draws of at
-- most 120 groups), against the edit's id, and the dead draws' rows are not read again.
--
-- The one-time rebuild at the end of this migration (section 8) replays every wall from its Acts: the cost is paid once, on the migrating transaction, and grows with the legacy walls' washes and live draws, not with players. Measured on
-- local Postgres 16, one legacy wall of 48 draws (1,000 cells each) and 200 washes (300 cells each), replayed by surface_store (two runs each): before this migration's replay was tightened (a legacy wash's takes decoded once for each
-- live draw, each draw found by a scan of the rows, each take a visit to all 10,000 cells) 7.5 and 8.3 s; after (a legacy wash's takes decoded once for the wash, the draw found by array_position over a parallel list of ids, and the
-- take visiting only the cells the pass touched, surface_take_at) 1.3 s, to the same row (9,850 covered, 19 live). A wall's replay at a later repair or import is the same figure; nothing at play time replays a wall.
--
-- What a client may send. edit_post is granted to signed-in players, and the Edge Function calls it with the player's own session, so its `surface_places` is a client's input and is bounded, not restricted: at most 5,760 entries
-- (48 draws of 120 groups), each place an attachment of a kind engine/rules/anchor.ts defines (text, image, box) or JSON null and at most 2 KiB as Postgres writes it, and a `grp` the draw has (below its payload's `groups`). An entry
-- for a draw that is not live on the post is left out, as before. A direct call can misplace tags on the caller's own post only within those bounds, and a misplaced tag has its way out in the sponge and a new tag. A draw's places
-- (surface_apply) take the same bounds, and must be for the post's current version, so an edit that lands between the Edge Function's read and the call refuses the draw ("That post's words aren't the ones you drew on. Reload it and
-- tag again.") rather than leaving tags with no place for the version a reader sees.
--
-- Ways out. A wall never closes; its way out is the author's wash (a coat a pass, and Hold to scrub on a reader's screen), a reader's scrub on their own screen, and an admin's End this card (card_ended refuses every later draw
-- and wash). A group an edit took its words from falls to its box spot; the way out of a misplaced tag is the sponge, and a new tag. Tougher paint makes washing slower and never impossible: every pass takes paint.
--
-- Export. surface_coats and surface_places are tables in the public schema, so the export carries them as it carries every table (tools/instance-files.mjs reads the catalog; there is no list to add them to). An imported
-- surface is the stored row, which rebuild_surface reproduces from the Acts, and its grids are the rows rebuild_surface_coats reproduces; the places are the server's own and travel as rows.

-- ---------------------------------------------------------------------------------------------------- 1. the derived rows ----

-- A surface's `covered` is the sum of its live draws' painted cells (paint is paid for tag by tag, so a tag over another's costs again), and `washes` says which live draws each live wash changed: the wash stays live while
-- one of them does. Both are derived from the Acts, as `live` is, and rebuilt from them. `cover` and `owners` go at the end of this file, once every reader is off them.
alter table surfaces add column covered integer not null default 0 check (covered >= 0);
alter table surfaces add column washes jsonb not null default '{}' check (jsonb_typeof(washes) = 'object');

-- One row for each live draw: its own grid of coats in tenths (0 to 40), 10,000 cells row-major as `toBits`, and how many of them are painted (2 tenths or more). Nobody reads it directly: RLS on and no grant, as
-- surface_marks; surface_shares gives the Lens each draw's painted count and nothing else.
create table surface_coats (
  play uuid not null references acts (id),
  draw uuid not null references acts (id),
  coats smallint[] not null check (cardinality(coats) = 10000),
  painted integer not null check (painted between 1 and 10000),
  primary key (play, draw)
);
alter table surface_coats enable row level security;
revoke all on surface_coats from public, anon, authenticated;

-- Where each of a draw's groups is attached for each version of the post it was placed for: the attachment as a JSON object, or JSON null for the box spot (a group whose words an edit took away). The draw writes its rows for
-- the post's version at the time, and an edit writes one for each live group against the edit's own id. A reader takes the rows of the post's current version and finds none for a version it was not placed for: that group
-- is at its box spot. Public facts of public Acts, readable as `surfaces` is.
create table surface_places (
  draw uuid not null references acts (id),
  grp smallint not null check (grp >= 0),
  version uuid not null references acts (id),
  place jsonb not null check (jsonb_typeof(place) in ('object', 'null')),
  primary key (draw, grp, version)
);
alter table surface_places enable row level security;
revoke all on surface_places from public, anon, authenticated;
grant select on surface_places to authenticated;
create policy read on surface_places for select to authenticated using (true);

-- ------------------------------------------------------------------------------------------------------------ 2. coats ----

-- surface_coat_string_ok and surface_takes_ok are called by acts_surface_payload, a CHECK, which runs as the writer, so they stay executable by PUBLIC (0082); they are pure and read no table.
-- A coat string is 10,000 characters, one for each cell, over the alphabet `0123456789abcdefghijklmnopqrstuvwxyzABCDE`: the index of a character is its tenths of a coat (engine/rules/surface.ts: COAT_ALPHABET).
create function surface_coat_string_ok(s text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select s is not null and char_length(s) = 10000 and s !~ '[^0-9a-zA-E]'
$$;

-- coat_cells(s): the coat string as the tenths of each cell, row-major. Refuses a string that is not 10,000 characters of the alphabet.
create function coat_cells(s text) returns smallint[]
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
begin
  if not surface_coat_string_ok(s) then
    raise exception 'a coat string is 10,000 characters of the coat alphabet' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return array(select (position(ch in '0123456789abcdefghijklmnopqrstuvwxyzABCDE') - 1)::smallint from unnest(string_to_array(s, null)) ch);
end $$;
revoke execute on function coat_cells(text) from public, anon, authenticated, service_role;

-- A cell is painted while it holds 2 tenths or more; at 1 or less it is clean (and is kept at 0).
create function surface_painted(c smallint[]) returns integer
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select count(*)::integer from unnest(c) x where x >= 2
$$;
revoke execute on function surface_painted(smallint[]) from public, anon, authenticated, service_role;

-- surface_take(coats, takes): each cell becomes greatest(0, coats - takes), and a cell left at 1 or less is clean.
create function surface_take(c smallint[], t smallint[]) returns smallint[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select array(select (case when u.c - u.t <= 1 then 0 else u.c - u.t end)::smallint from unnest(c, t) with ordinality as u(c, t, i) order by u.i)
$$;
revoke execute on function surface_take(smallint[], smallint[]) from public, anon, authenticated, service_role;

-- surface_take_at(coats, takes, at): surface_take for takes that touch few cells, which is what a wash of the old shape is (a sponge's pass): `at` lists the positions (1-based) where `takes` is above 0, and only those cells are
-- visited. Same answer as surface_take on a grid already laid (no cell at 1 tenth), which every stored grid is; 20 times faster for the 300 cells of a pass, and no slower at all 10,000.
create function surface_take_at(c smallint[], t smallint[], at integer[]) returns smallint[]
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  i integer;
  v integer;
  out smallint[] := c;
begin
  foreach i in array at loop
    v := out[i] - t[i];
    out[i] := case when v <= 1 then 0 else v end;
  end loop;
  return out;
end $$;
revoke execute on function surface_take_at(smallint[], smallint[], integer[]) from public, anon, authenticated, service_role;

-- surface_lay(s): the grid a draw's coat string lays: coat_cells with a cell held at 1 tenth kept at 0, as the wash path keeps one. Without it a draw's grid would differ from what a wash of it leaves, and a later wash that names
-- the draw would count as changing it and stay live for nothing.
create function surface_lay(s text) returns smallint[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select array(select (case when u.c <= 1 then 0 else u.c end)::smallint from unnest(coat_cells(s)) with ordinality as u(c, i) order by u.i)
$$;
revoke execute on function surface_lay(text) from public, anon, authenticated, service_role;

-- A drawing stored before this migration says which cells it inked (`cells`, 10,000 characters of 0 and 1); it is laid at 20 tenths, 2 coats, on each. A wash stored before it takes every coat (40 tenths) of each draw
-- older than it on its set cells. 'k' and 'E' are the coat alphabet's 20th and 40th characters.
create function surface_legacy_coats(cells text) returns smallint[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coat_cells(translate(cells, '1', 'k'))
$$;
revoke execute on function surface_legacy_coats(text) from public, anon, authenticated, service_role;
create function surface_legacy_takes(cells text) returns smallint[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coat_cells(translate(cells, '1', 'E'))
$$;
revoke execute on function surface_legacy_takes(text) from public, anon, authenticated, service_role;

-- surface_takes_ok(takes): a wash's takes are a list of {draw, takes}, each takes a coat string.
create function surface_takes_ok(t jsonb) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select jsonb_typeof(t) = 'array' and not exists (
    select 1 from jsonb_array_elements(t) e
    where not (jsonb_typeof(e) = 'object' and (e ->> 'draw') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and jsonb_typeof(e -> 'takes') = 'string' and surface_coat_string_ok(e ->> 'takes')))
$$;

-- --------------------------------------------------------------------------------------------------- 3. the payload check ----

-- acts_surface_payload: a draw holds `groups` (an array) and `coats` (a coat string), or the old `strokes` and `cells`; a wash holds `cuts` (an array) and `takes` (an array of {draw, takes}), or the old `strokes` and
-- `cells`; and the payload less the server's keys (`cells`, `coats`, `takes`, `uncovered`, `cut`) is at most 64 KiB as Postgres writes it.
alter table acts drop constraint acts_surface_payload;
-- Added not valid and then validated, as 0361 does for acts_infraction_payload. The migration is one transaction, so the ACCESS EXCLUSIVE lock the add takes is held until commit and the validating scan still runs under it; the split only helps where the two steps are applied apart.
alter table acts add constraint acts_surface_payload check (kind not in ('draw', 'wash') or (
  octet_length((payload - 'cells' - 'coats' - 'takes' - 'uncovered' - 'cut')::text) <= 65536 and (
    (kind = 'draw' and jsonb_typeof(payload -> 'groups') = 'array' and surface_coat_string_ok(payload ->> 'coats'))
    or (kind = 'wash' and jsonb_typeof(payload -> 'cuts') = 'array' and surface_takes_ok(payload -> 'takes'))
    or (jsonb_typeof(payload -> 'strokes') = 'array' and jsonb_typeof(payload -> 'cells') = 'string' and char_length(payload ->> 'cells') = 10000 and (payload ->> 'cells') !~ '[^01]'))) is true) not valid;
alter table acts validate constraint acts_surface_payload;

-- surface_check_payload(payload, kind): the writers' check. A drawing holds its groups and a wash its cuts, as lists, and at most 64 KiB less the server's keys. The old shape (`strokes`) is never accepted by a writer
-- again; only lay_sprung, laying a back set before 0343, writes one, through surface_apply.
drop function surface_check_payload(jsonb);
create function surface_check_payload(in_payload jsonb, in_kind text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(in_payload) is distinct from 'object' or jsonb_typeof(in_payload -> case in_kind when 'wash' then 'cuts' else 'groups' end) is distinct from 'array' then
    raise exception '%', case in_kind when 'wash' then 'a wash holds its cuts as a list' else 'a drawing holds its groups as a list' end using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if octet_length((in_payload - 'cells' - 'coats' - 'takes' - 'uncovered' - 'cut')::text) > 65536 then raise exception 'a drawing is at most 64 KiB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
end $$;
revoke execute on function surface_check_payload(jsonb, text) from public, anon, authenticated, service_role;
-- ------------------------------------------------------------------------------------------------------ 4. the step and the count ----

-- The old step, its state and its writers go: the signatures below replace them, and no stale one stays callable.
drop function surface_step(uuid[], smallint[], bit, text, uuid, bit);
drop type surface_state;
drop function surface_apply(uuid, uuid, text, jsonb, bit, integer);
drop function draw_on_surface(uuid, uuid, uuid, jsonb, bit, integer);
drop function wash_surface(uuid, uuid, uuid, jsonb, bit);
drop function staff_draw_on_surface(text, uuid, jsonb, bit, integer);
drop function play_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, jsonb, bit, integer, integer);
drop function staff_play_surface_card(text, text, uuid, jsonb, text, date, integer, jsonb, bit, integer, integer);

create type surface_live as (live uuid[], washes jsonb);
create type surface_coat_row as (draw uuid, coats smallint[], painted integer);
create type surface_replayed as (live uuid[], washes jsonb, rows surface_coat_row[], covered integer, updated_at timestamptz);

-- surface_prune(live, washes, alive): the live list once the draws not in `alive` have gone. A draw stays while it is alive; a wash stays while a draw it changed (washes[wash]) is alive. Order is kept. Pure; the one prune
-- every write and every rebuild takes, so the stored row and a rebuilt one agree by construction.
create function surface_prune(in_live uuid[], in_washes jsonb, in_alive uuid[]) returns surface_live
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  out surface_live;
begin
  out.live := coalesce(array(
    select u.id from unnest(in_live) with ordinality u(id, ord)
    where u.id = any (in_alive)
       or (in_washes ? u.id::text and exists (select 1 from jsonb_array_elements_text(in_washes -> u.id::text) w where w::uuid = any (in_alive)))
    order by u.ord), '{}');
  out.washes := coalesce((select jsonb_object_agg(w.key, w.value) from jsonb_each(in_washes) w where w.key::uuid = any (out.live)), '{}'::jsonb);
  return out;
end $$;
revoke execute on function surface_prune(uuid[], jsonb, uuid[]) from public, anon, authenticated, service_role;

-- surface_place_ok(place): a place is the attachment of one group for one version, or JSON null for its box spot. An attachment is an object of at most 2 KiB as Postgres writes it, whose `kind` is one of the three
-- engine/rules/anchor.ts defines (text, image, box). Pure; the bound every writer of surface_places takes (a draw's places and an edit's), so a client's input is never stored unbounded.
create function surface_place_ok(p jsonb) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select jsonb_typeof(p) = 'null' or (jsonb_typeof(p) = 'object' and octet_length(p::text) <= 2048 and p ->> 'kind' in ('text', 'image', 'box'))
$$;
revoke execute on function surface_place_ok(jsonb) from public, anon, authenticated, service_role;

-- surface_apply(play, character, kind, payload, coats, takes, places, most): the lock, the limits and the Act. The row is locked first, so the limit and the live count are read under it and two draws cannot both pass; a
-- refused draw writes nothing.
--   A draw (`coats`, its coat string): the refusal is computed on covered + the draw's painted cells against `most` (the wall's limit in cells, from the instance's setting), with the wall's own figures in whole percents,
--   and on the live count: surface_coats rows + 1 against the 48 (surfaces.most_live). A draw that paints nothing is never refused for either, is written and never goes live. `places` ([{grp, version, place}]) are written to
--   surface_places against the draw. A payload of the old shape (`strokes`, written only by lay_sprung for a back set before 0343) takes its cells from `coats`, laid by the legacy rule, and keeps them as `cells`.
--   A wash (`takes`, [{draw, takes}]): for each live draw named, the cells become greatest(0, c - t), 1 or less set to 0. A draw named that is not live is left out, as is one the wash changes nothing of; the Act keeps the
--   entries that changed something, so replaying it gives the same wall. `uncovered` is the cells that went from painted to clean, `cut` is [{draw, took}] of each draw whose cells it cleared (took > 0), both the server's, written to the
--   payload and to surface_marks and surface_cuts. A draw left with nothing painted goes from surface_coats and `live`. A wash that changed nothing is written and never goes live; one that did stays live while a draw it
--   changed does.
-- The answer is the Act's projection with `covered` (cells) and `live` (ids).
create function surface_apply(on_play uuid, by_character uuid, in_kind text, in_payload jsonb, in_coats text, in_takes jsonb, in_places jsonb, most integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s surfaces%rowtype;
  written uuid := gen_random_uuid();
  in_thread uuid;
  at timestamptz;
  flag text;
  by_author uuid;
  grid smallint[];
  nxt smallint[];
  painted_new integer := 0;
  live_draws integer;
  new_covered integer;
  new_live uuid[];
  new_washes jsonb;
  pruned surface_live;
  stored jsonb := '{}';
  wash_cut jsonb := '[]';
  wash_kept jsonb := '[]';
  wash_cells integer := 0;
  touched text[] := '{}';
  died boolean := false;
  e record;
  was integer;
  now_painted integer;
  legacy boolean;
begin
  select * into s from surfaces x where x.play = on_play for update;
  if not found then raise exception 'there is no wall on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- Every writer that places groups on a post (the four draw writers, first draws included) and every edit of that post serialize on one transaction-level advisory lock, keyed as the repository's other advisory locks
  -- are, hashtextextended('kayfabb.<thing>.' || id, 0): 'kayfabb.surface_post.' || the post. A row lock on the post's surfaces cannot see a surface an uncommitted first draw is creating; this one can. Taken after the
  -- surfaces row and before the post's current version is read, so a draw either commits before the edit or reads the edit's version and is refused as stale. Lock order: a draw takes the surfaces row, then this lock;
  -- an edit takes only this lock, and no one takes a surfaces row while holding it, so there is no cycle.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.surface_post.' || s.post::text, 0));
  -- An admin's End this card can commit between the caller's early check and the lock: the card is read again here, under the lock, and a draw or a wash that waited for it is refused.
  if exists (select 1 from acts x where x.kind = 'card_end' and x.target_act_id = on_play) then
    raise exception 'an admin ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Read after the lock, so the Acts' created_at order is the order the lock was taken in, which is the order rebuild_surface replays them in.
  at := clock_timestamp();
  new_live := s.live;
  new_washes := s.washes;
  if in_kind = 'draw' then
    legacy := jsonb_typeof(in_payload -> 'groups') is distinct from 'array';
    grid := surface_lay(in_coats);
    painted_new := surface_painted(grid);
    select count(*)::integer into live_draws from surface_coats c where c.play = on_play;
    if painted_new > 0 and s.covered + painted_new > most then
      raise exception '%', format('this wall is %s%% covered, and its limit is %s%%; this tag would take it to %s%%', floor(s.covered / 100.0)::integer, floor(most / 100.0)::integer, ceil((s.covered + painted_new) / 100.0)::integer)
        using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if painted_new > 0 and live_draws + 1 > s.most_live then
      raise exception 'This wall is full: it holds % tags. It has room again when its author washes one off.', s.most_live using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if jsonb_typeof(in_places) = 'array' and exists (
         select 1 from jsonb_array_elements(in_places) p
         where not (jsonb_typeof(p) = 'object' and (p ->> 'grp') ~ '^[0-9]{1,4}$' and (p ->> 'version') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    and jsonb_typeof(coalesce(p -> 'place', 'null'::jsonb)) in ('object', 'null')
                    and ((p ->> 'version')::uuid = s.post or exists (select 1 from acts v where v.id = (p ->> 'version')::uuid and v.kind = 'edit' and v.target_act_id = s.post)))) then
      raise exception 'a place is of the post''s own words or one of its edits' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    -- The bounds of a place, whoever sends it: at most 48 draws of 120 groups' worth of entries, a group the drawing has, an attachment of a known kind at most 2 KiB, and the post's words as they now stand. The last is the
    -- Edge Function's read racing an edit: the tags are refused rather than kept with no place for the current version (surface_groups_on reads the current version's rows alone).
    if jsonb_typeof(in_places) = 'array' then
      if jsonb_array_length(in_places) > 5760 then
        raise exception 'a drawing places at most 5,760 groups' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(in_places) p where (p ->> 'grp')::integer >= jsonb_array_length(case when jsonb_typeof(in_payload -> 'groups') = 'array' then in_payload -> 'groups' else '[]'::jsonb end)) then
        raise exception 'a place names a group the drawing does not have' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(in_places) p where not surface_place_ok(coalesce(p -> 'place', 'null'::jsonb))) then
        raise exception 'a place is a text, an image or a box attachment of at most 2 KiB' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(in_places) p
                 where (p ->> 'version')::uuid is distinct from post_version(s.post)) then
        raise exception 'That post''s words aren''t the ones you drew on. Reload it and tag again.' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
    end if;
  else
    if not surface_takes_ok(coalesce(in_takes, '[]'::jsonb)) then
      raise exception 'a wash''s takes are a list of draws and coat strings' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if (select count(*) <> count(distinct x ->> 'draw') from jsonb_array_elements(coalesce(in_takes, '[]'::jsonb)) x) then
      raise exception 'a wash cuts each draw once' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end if;
  select a.thread into in_thread from acts a where a.id = on_play;
  -- A wash takes its paint off under the lock: each draw it names that is live, its cells and the cells that went from painted to clean, from the draws' own grids (10,000 cells each; at most 48 draws).
  if in_kind = 'wash' then
    for e in select (x ->> 'draw')::uuid as draw, x ->> 'takes' as takes from jsonb_array_elements(coalesce(in_takes, '[]'::jsonb)) with ordinality t(x, ord) order by t.ord loop
      select c.coats, c.painted into grid, was from surface_coats c where c.play = on_play and c.draw = e.draw;
      if not found then continue; end if;
      nxt := surface_take(grid, coat_cells(e.takes));
      if nxt = grid then continue; end if;
      now_painted := surface_painted(nxt);
      touched := touched || e.draw::text;
      wash_kept := wash_kept || jsonb_build_object('draw', e.draw, 'takes', e.takes);
      if was - now_painted > 0 then
        wash_cut := wash_cut || jsonb_build_object('draw', e.draw, 'took', was - now_painted);
        wash_cells := wash_cells + (was - now_painted);
      end if;
      if now_painted = 0 then
        delete from surface_coats c where c.play = on_play and c.draw = e.draw;
        died := true;
      else
        update surface_coats c set coats = nxt, painted = now_painted where c.play = on_play and c.draw = e.draw;
      end if;
    end loop;
  end if;
  flag := coalesce(current_setting('kayfabb.surface_writer', true), '');
  perform set_config('kayfabb.surface_writer', 'on', true);
  -- The server's keys are its own: a payload that arrives carrying them loses them, and the 64 KiB bound leaves them out.
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at)
  values (written, by_character, in_kind, in_thread, on_play, (in_payload - 'cells' - 'coats' - 'takes' - 'uncovered' - 'cut')
    || case when in_kind = 'wash' then jsonb_build_object('takes', wash_kept, 'uncovered', wash_cells, 'cut', wash_cut)
            when legacy then jsonb_build_object('cells', translate(in_coats, '23456789abcdefghijklmnopqrstuvwxyzABCDE', repeat('1', 39)))
            else jsonb_build_object('coats', in_coats) end, at);
  perform set_config('kayfabb.surface_writer', flag, true);
  -- The log's narrow rows, in the Act's own transaction (what surface_marks_of and surface_cuts_of recompute from the Acts).
  select a.character into by_author from acts a where a.id = s.post;
  -- A draw tells the wall post's author (section 6): the acting account is the drawing character's owner (null for staff, so the author is told); one player's two masks tell nobody. A wash tells nobody.
  if in_kind = 'draw' then
    perform write_alert(by_author, 'cardOnYours', 'drew', written, (select c.owner from characters c where c.id = by_character));
  end if;
  insert into surface_marks (act, play, post, author, character, kind, cells, at)
  values (written, on_play, s.post, by_author, by_character, in_kind, case when in_kind = 'draw' then painted_new else wash_cells end, at);
  if in_kind = 'draw' then
    if painted_new > 0 then
      insert into surface_coats (play, draw, coats, painted) values (on_play, written, grid, painted_new);
      new_live := new_live || written;
    end if;
    if jsonb_typeof(in_places) = 'array' then
      insert into surface_places (draw, grp, version, place)
      select written, (p ->> 'grp')::smallint, (p ->> 'version')::uuid, coalesce(p -> 'place', 'null'::jsonb) from jsonb_array_elements(in_places) p
      on conflict (draw, grp, version) do nothing;
    end if;
  else
    insert into surface_cuts (wash, draw, took, play, post, washer, drawer, at)
    select written, (x ->> 'draw')::uuid, (x ->> 'took')::integer, on_play, s.post, by_character, d.character, at
    from jsonb_array_elements(wash_cut) x join acts d on d.id = (x ->> 'draw')::uuid;
    if cardinality(touched) > 0 then
      new_live := new_live || written;
      new_washes := new_washes || jsonb_build_object(written::text, to_jsonb(touched));
    end if;
    if died then
      pruned := surface_prune(new_live, new_washes, array(select c.draw from surface_coats c where c.play = on_play));
      new_live := pruned.live;
      new_washes := pruned.washes;
    end if;
  end if;
  select coalesce(sum(c.painted), 0)::integer into new_covered from surface_coats c where c.play = on_play;
  update surfaces set covered = new_covered, live = new_live, washes = new_washes, updated_at = at where play = on_play;
  return (act_projection(written) #- '{payload,cells}' #- '{current_payload,cells}' #- '{payload,coats}' #- '{current_payload,coats}' #- '{payload,takes}' #- '{current_payload,takes}')
    || jsonb_build_object('covered', new_covered, 'live', to_jsonb(new_live));
end $$;
revoke execute on function surface_apply(uuid, uuid, text, jsonb, text, jsonb, jsonb, integer) from public, anon, authenticated, service_role;
-- open_surface (0317), without the cover and the owners. Everything else as 0317 wrote it.
create or replace function open_surface(play uuid, most_live integer default 48) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into surfaces (play, post, covered, washes, live, most_live, updated_at)
  select a.id, a.target_act_id, 0, '{}', '{}', most_live, clock_timestamp()
  from acts a where a.id = open_surface.play and a.kind = 'card' and a.target_act_id is not null;
  if not found then raise exception 'a surface is opened for a card play on a post' using errcode = '23514'; end if;
end $$;

-- --------------------------------------------------------------------------------------------------- 5. draws and washes ----

-- draw_on_surface(who, through, play, payload, coats, places, most): the account `who`, through its character `through`, adds a drawing to a surface. In order: the player plays that character; it is not banned; not barred from
-- the post's board; the play is a live surface (not ended); then the lock, the limit (`most`, in cells, from the instance's setting, with the wall's own figures) and the 48th live draw. `coats` is the drawing's coat string
-- (the engine's decideDraw gives it) and `places` the [{grp, version, place}] of its groups for the post's version. None of these reads who owns the post or any other character. Called by the Edge Function with the
-- service key; no API role executes it.
create function draw_on_surface(who uuid, through uuid, play uuid, payload jsonb, coats text, places jsonb, most integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
begin
  perform played_by(through, who);
  perform not_banned(through);
  select t.board into on_board from surfaces s join acts k on k.id = s.play join threads t on t.id = k.thread where s.play = draw_on_surface.play;
  if on_board is null then raise exception 'there is no wall on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_barred(through, on_board);
  perform surface_require_live(play);
  perform surface_check_payload(payload, 'draw');
  return surface_apply(play, through, 'draw', payload, coats, null, places, most);
end $$;
revoke execute on function draw_on_surface(uuid, uuid, uuid, jsonb, text, jsonb, integer) from public, anon, authenticated;
grant execute on function draw_on_surface(uuid, uuid, uuid, jsonb, text, jsonb, integer) to service_role;

-- wash_surface(who, through, play, payload, takes): the post's own character takes paint off. `through` is the post's character, owned by `who`; a retired author may still wash, as save_effect_state lets a retired
-- author save (0038, 0149). Then not_banned, the live play, the lock and the takes (`takes` is [{draw, takes}], one coat string for each draw it cuts). A wash is never refused for the limit or the live count.
create function wash_surface(who uuid, through uuid, play uuid, payload jsonb, takes jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  author uuid;
begin
  select t.character into author from acts k join acts t on t.id = k.target_act_id where k.id = wash_surface.play and k.kind = 'card';
  -- The post's own player answers for the mask that wrote it, retired or not.
  if not (author is not distinct from through
          and exists (select 1 from characters c where c.id = through and c.owner = who and c.debuted_at is not null)) then
    perform played_by(through, who);
  end if;
  if author is null then raise exception 'there is no wall on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if author <> through then raise exception 'only the post''s author washes what is on it' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  perform not_banned(through);
  perform surface_require_live(play);
  perform surface_check_payload(payload, 'wash');
  return surface_apply(play, through, 'wash', payload, null, takes, null, 0);
end $$;
revoke execute on function wash_surface(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function wash_surface(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- staff_draw_on_surface(staff_key, play, payload, coats, places, most): a persona's drawing on an open wall, with the persona checks staff_play_card makes: a persona, and not waiting or benched.
create function staff_draw_on_surface(staff_key text, play uuid, payload jsonb, coats text, places jsonb, most integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  held text;
  flag text;
  answered jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if whose is distinct from 'persona' then raise exception 'only a persona draws on a wall' using errcode = '42501'; end if;
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then raise exception 'a % persona writes nothing', held using errcode = '55000'; end if;
  perform surface_require_live(play);
  perform surface_check_payload(payload, 'draw');
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  answered := surface_apply(play, who, 'draw', payload, coats, null, places, most);
  perform set_config('kayfabb.staff_writer', flag, true);
  return answered;
end $$;
revoke execute on function staff_draw_on_surface(text, uuid, jsonb, text, jsonb, integer) from public, anon, authenticated;
grant execute on function staff_draw_on_surface(text, uuid, jsonb, text, jsonb, integer) to service_role;

-- play_surface_card: play_card's arguments, plus the caster's first drawing (`first`, its coat string and places, the wall's limit in cells and the most live draws it holds). It calls play_card, then draw_on_surface as the caster,
-- in one transaction: a refused draw undoes the play, its price and its card. A play a back caught never landed and has no wall, so it draws nothing and answers as play_card does.
create function play_surface_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text, reach text, from_post uuid, version uuid, tokens integer,
                                  first jsonb, first_coats text, first_places jsonb, most integer, most_live integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  played jsonb;
  written uuid;
begin
  if not coalesce((select k.surface from card_kinds k where k.key = play_surface_card.card), false) then
    raise exception 'that card has no surface to draw on' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  played := play_card(who, card, through, target, config, price, message, reach, from_post, version, tokens);
  written := (played ->> 'id')::uuid;
  if not exists (select 1 from surfaces s where s.play = written) then return played; end if;
  update surfaces s set most_live = coalesce(play_surface_card.most_live, 48) where s.play = written;
  return played || jsonb_build_object('draw', draw_on_surface(who, through, written, first, first_coats, first_places, most));
end $$;
revoke execute on function play_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, jsonb, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function play_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, jsonb, text, jsonb, integer, integer) to service_role;

-- staff_play_surface_card: staff_play_card's arguments, plus the persona's first drawing; one transaction around staff_play_card and staff_draw_on_surface.
create function staff_play_surface_card(staff_key text, card text, target uuid, config jsonb, message text, pool_day date, tokens integer,
                                        first jsonb, first_coats text, first_places jsonb, most integer, most_live integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  played jsonb;
  written uuid;
begin
  if not coalesce((select k.surface from card_kinds k where k.key = staff_play_surface_card.card), false) then
    raise exception 'that card has no surface to draw on' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  played := staff_play_card(staff_key, card, target, config, message, pool_day, tokens);
  written := (played ->> 'id')::uuid;
  if not exists (select 1 from surfaces s where s.play = written) then return played; end if;
  update surfaces s set most_live = coalesce(staff_play_surface_card.most_live, 48) where s.play = written;
  return played || jsonb_build_object('draw', staff_draw_on_surface(staff_key, written, first, first_coats, first_places, most));
end $$;
revoke execute on function staff_play_surface_card(text, text, uuid, jsonb, text, date, integer, jsonb, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function staff_play_surface_card(text, text, uuid, jsonb, text, date, integer, jsonb, text, jsonb, integer, integer) to service_role;

-- ---------------------------------------------------------------------------------------------------------- 6. the rebuild ----

-- surface_replay(play): the surface's rows computed from the play's Acts alone, in `created_at, id` order, by the rules the writer takes. A draw with `coats` is laid as stored; a draw with `cells` (stored before this
-- migration) is laid at 20 tenths on each set cell. A wash with `takes` takes them off the draws it names that are live; a wash with `cells` takes every coat of each draw older than it on its set cells. A draw with nothing
-- painted never goes live, and a draw whose last painted cell is washed leaves with the washes that only changed it. Pure over the Acts (stable); the limit on live draws is the stored row's, or the default.
create function surface_replay(in_play uuid) returns surface_replayed
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  out surface_replayed;
  r record;
  e record;
  rows surface_coat_row[] := '{}';
  grid smallint[];
  nxt smallint[];
  painted_new integer;
  at integer;
  touched text[];
  died boolean;
  pruned surface_live;
  lt smallint[];
  lat integer[];
  ids uuid[] := '{}';
  legacy boolean := true;
  lids uuid[] := '{}';
  lown bit(10000)[] := '{}';
  lcells bit(10000);
  gone uuid[];
  lkept uuid[];
begin
  out.live := '{}';
  out.washes := '{}';
  for r in select a.id, a.kind, a.payload, a.created_at from acts a where a.target_act_id = in_play and a.kind in ('draw', 'wash') order by a.created_at, a.id loop
    out.updated_at := r.created_at;
    -- The legacy phase is the Acts before the first of the new shape (a draw with `coats`, a wash with `takes`). In it 0317's ownership holds: a legacy draw owns the cells it inked until a later legacy draw inks
    -- them or a legacy wash clears them, and it leaves the wall (grid and all) when it owns none. From the first new-shape Act on, the coats rules alone apply.
    if legacy and (r.payload ? 'coats' or r.payload ? 'takes') then legacy := false; end if;
    lcells := case when legacy then (r.payload ->> 'cells')::bit(10000) end;
    if r.kind = 'draw' then
      grid := case when r.payload ? 'coats' then surface_lay(r.payload ->> 'coats') else surface_legacy_coats(r.payload ->> 'cells') end;
      painted_new := surface_painted(grid);
      if painted_new > 0 then
        rows := rows || row(r.id, grid, painted_new)::surface_coat_row;
        ids := ids || r.id;
        out.live := out.live || r.id;
      end if;
      if legacy then
        lown := array(select u.o & ~lcells from unnest(lown) with ordinality u(o, i) order by u.i) || lcells;
        lids := lids || r.id;
      end if;
    else
      touched := '{}';
      died := false;
      -- A wash of the old shape takes the same coats of every draw older than it that is still live: that grid is computed once for the wash, not once for each draw. A wash of the new shape names its draws.
      lt := case when r.payload ? 'takes' then null else surface_legacy_takes(r.payload ->> 'cells') end;
      lat := case when lt is null then null else coalesce((select array_agg(u.i::integer) from unnest(lt) with ordinality u(v, i) where u.v > 0), '{}') end;
      for e in select x.draw, case when lt is null then coat_cells(x.takes) end as t
               from (select (v ->> 'draw')::uuid as draw, v ->> 'takes' as takes, i from jsonb_array_elements(case when lt is null then r.payload -> 'takes' else '[]'::jsonb end) with ordinality x(v, i)
                     union all select u.id, null, u.ord from unnest(case when lt is null then '{}'::uuid[] else ids end) with ordinality u(id, ord)) x
               order by x.i loop
        at := array_position(ids, e.draw);
        if at is null then continue; end if;
        nxt := case when lt is null then surface_take(rows[at].coats, e.t) else surface_take_at(rows[at].coats, lt, lat) end;
        if nxt = rows[at].coats then continue; end if;
        touched := touched || e.draw::text;
        painted_new := surface_painted(nxt);
        if painted_new = 0 then
          rows := rows[1:at - 1] || rows[at + 1:coalesce(cardinality(rows), 0)];
          ids := ids[1:at - 1] || ids[at + 1:coalesce(cardinality(ids), 0)];
          died := true;
        else
          rows[at] := row(e.draw, nxt, painted_new)::surface_coat_row;
        end if;
      end loop;
      if cardinality(touched) > 0 then
        out.live := out.live || r.id;
        out.washes := out.washes || jsonb_build_object(r.id::text, to_jsonb(touched));
      end if;
      if died then
        pruned := surface_prune(out.live, out.washes, ids);
        out.live := pruned.live;
        out.washes := pruned.washes;
      end if;
      if legacy then
        lown := array(select u.o & ~lcells from unnest(lown) with ordinality u(o, i) order by u.i);
      end if;
    end if;
    if legacy then
      -- A legacy draw that owns no cell has left the wall, its grid cleared, and the washes that only changed it go with it.
      gone := coalesce(array(select l.id from unnest(lids, lown) l(id, o) where l.id = any (ids) and bit_count(l.o) = 0), '{}');
      lkept := array(select l.id from unnest(lids, lown) with ordinality l(id, o, i) where bit_count(l.o) > 0 and l.id = any (ids) and not l.id = any (gone) order by l.i);
      lown := array(select l.o from unnest(lids, lown) with ordinality l(id, o, i) where bit_count(l.o) > 0 and l.id = any (ids) and not l.id = any (gone) order by l.i);
      lids := lkept;
      if cardinality(gone) > 0 then
        rows := coalesce(array(select row(x.draw, x.coats, x.painted)::surface_coat_row from unnest(rows) with ordinality x(draw, coats, painted, i) where not x.draw = any (gone) order by x.i), '{}');
        ids := array(select u.id from unnest(ids) with ordinality u(id, i) where not u.id = any (gone) order by u.i);
        pruned := surface_prune(out.live, out.washes, ids);
        out.live := pruned.live;
        out.washes := pruned.washes;
      end if;
    end if;
  end loop;
  out.rows := rows;
  out.covered := coalesce((select sum(x.painted) from unnest(rows) x), 0)::integer;
  return out;
end $$;
revoke execute on function surface_replay(uuid) from public, anon, authenticated, service_role;
-- rebuild_surface(play): the surface's row computed from the play's Acts alone, in the order they were written, by the same prune every write takes. For the tests, and for a repair or an import that wants the row from the
-- Acts. It writes nothing and answers the row (`covered` is the sum of the live draws' painted cells; the old cover and owners are gone); the limit on live draws is the stored row's, or the default.
drop function rebuild_surface(uuid);
create function rebuild_surface(play uuid) returns surfaces
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s surfaces%rowtype;
  stored surfaces%rowtype;
  rp surface_replayed;
begin
  select * into stored from surfaces x where x.play = rebuild_surface.play;
  s.play := rebuild_surface.play;
  s.post := coalesce(stored.post, (select a.target_act_id from acts a where a.id = rebuild_surface.play and a.kind = 'card'));
  if s.post is null then raise exception 'a surface is a card play on a post' using errcode = 'P0002'; end if;
  s.most_live := coalesce(stored.most_live, 48);
  rp := surface_replay(rebuild_surface.play);
  s.updated_at := coalesce(rp.updated_at, stored.updated_at, now());
  s.live := rp.live;
  s.washes := rp.washes;
  s.covered := rp.covered;
  return s;
end $$;
revoke execute on function rebuild_surface(uuid) from public, anon, authenticated;

-- rebuild_surface_coats(play): the rows of surface_coats the play's Acts give, one for each live draw, in the order of the live list.
create function rebuild_surface_coats(play uuid) returns setof surface_coats
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  rp surface_replayed;
begin
  rp := surface_replay(rebuild_surface_coats.play);
  return query select rebuild_surface_coats.play, x.draw, x.coats, x.painted from unnest(rp.rows) x;
end $$;
revoke execute on function rebuild_surface_coats(uuid) from public, anon, authenticated;

-- surface_store(play): the rebuilt rows written over the stored ones, for the migration's own rebuild and for a repair. Nobody calls it from outside.
create function surface_store(in_play uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rp surface_replayed;
begin
  perform 1 from surfaces s where s.play = in_play for update;
  rp := surface_replay(in_play);
  delete from surface_coats c where c.play = in_play;
  insert into surface_coats (play, draw, coats, painted) select in_play, x.draw, x.coats, x.painted from unnest(rp.rows) x;
  update surfaces set covered = rp.covered, live = rp.live, washes = rp.washes where play = in_play;
end $$;
revoke execute on function surface_store(uuid) from public, anon, authenticated, service_role;

-- surface_shares(play): each live draw's painted cells, the one fact of surface_coats the Lens shows. A draw's share of the wall is a public fact of a public Act; the grids are not read.
create function surface_shares(play uuid) returns table (draw uuid, painted integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.draw, c.painted from surface_coats c where c.play = surface_shares.play
$$;
revoke execute on function surface_shares(uuid) from public, anon;
grant execute on function surface_shares(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------ 7. readers ----

-- post_current_version(post): post_version (0070), the one rule for a post's current version (its latest edit by created_at, then id, else the post itself, as acts_public's current_payload reads it), callable by the players
-- thread_page serves, who cannot call post_version. A thin definer over it, so there is one rule and no copy of it; it says which Act is the post's current words, which the page shows in current_payload and `version` already.
create function post_current_version(post uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select post_version(post_current_version.post)
$$;
revoke execute on function post_current_version(uuid) from public, anon;
grant execute on function post_current_version(uuid) to authenticated, service_role;

-- surface_places_now(draw, post): a draw's places for the post's current version, [{grp, place}] by group, [] where none were written. The version is post_version's (the one rule: the latest edit by created_at, then id, else the post), which the
-- Lens, as an invoker, cannot call itself (post_version is not granted to players), so this is the one definer that holds it for them. It reads what the Lens read before, a draw's places, and gives no id.
create function surface_places_now(draw uuid, post uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_agg(jsonb_build_object('grp', p.grp, 'place', p.place) order by p.grp) from surface_places p
                   where p.draw = surface_places_now.draw and p.version = post_version(surface_places_now.post)), '[]'::jsonb)
$$;
revoke execute on function surface_places_now(uuid, uuid) from public, anon;
grant execute on function surface_places_now(uuid, uuid) to authenticated, service_role;

-- surface_acts (0368): the live Acts of a surface, oldest first, each as acts_public shows it. A draw carries its `share` (its own painted cells, which is what it costs the wall) and its `places`: for the post's current version (its
-- latest edit by created_at, id, or the post), [{grp, place}] from surface_places, a group with no row for it at its box spot. The coats grid and a wash's takes are the server's and are not sent (nor the old cells); `older`
-- counts the draws no longer live. Public Acts and the row's counts: a security invoker read, as thread_page is.
create or replace function surface_acts(play uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
#variable_conflict use_column
begin
  return (
  select case when s.play is null then null else jsonb_build_object(
    'covered', s.covered,
    'acts', coalesce((select jsonb_agg((to_jsonb(a) #- '{payload,cells}' #- '{current_payload,cells}' #- '{payload,coats}' #- '{current_payload,coats}' #- '{payload,takes}' #- '{current_payload,takes}')
                                       || case when a.kind = 'draw' then jsonb_build_object('share', coalesce(sh.painted, 0),
                                            'places', surface_places_now(a.id, s.post))
                                           else '{}'::jsonb end order by u.ord)
                      from unnest(s.live) with ordinality u(id, ord) join acts_public a on a.id = u.id
                      left join surface_shares(s.play) sh on sh.draw = a.id), '[]'::jsonb),
    'older', (select count(*) from acts_public d where d.target_act_id = s.play and d.kind = 'draw' and d.id <> all (s.live))) end
  from (select 1) x left join surfaces s on s.play = surface_acts.play
  );
end
$$;

-- surface_marks_of (0317): a draw's cells are what it painted (the cells of its coats at 2 tenths or more, or the cells a drawing of the old shape inked); a wash's are the cells it uncovered. Everything else as 0317 wrote it.
create or replace function surface_marks_of(play uuid) returns setof surface_marks
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.target_act_id, k.target_act_id, p.character, a.character, a.kind,
         case when a.kind = 'draw' then (case when a.payload ? 'coats' then char_length(replace(replace(a.payload ->> 'coats', '0', ''), '1', '')) else bit_count((a.payload ->> 'cells')::bit(10000)) end)
              else coalesce((a.payload ->> 'uncovered')::integer, 0) end, a.created_at
  from acts a join acts k on k.id = a.target_act_id join acts p on p.id = k.target_act_id
  where a.target_act_id = surface_marks_of.play and a.kind in ('draw', 'wash')
$$;

-- surface_groups_on(post): a post's walls as an edit needs them. `version` is the post's current version (its latest edit by created_at, id, or the post's own Act), `body` and `forged` that version's words and verdict, and
-- `groups` each group of each live draw on each surface on the post that has a surface_places row for that version ({draw, grp, place}, place JSON null once the group has fallen to its box spot): a draw with no places (a box-only
-- drawing) is left out. Service role only; the Edge Function reads it before an edit and maps each group against the new words. The words are read through acts_public, so a version an admin hid has no body here (conduct plan: a
-- hidden version is given to no one): every text group on it then falls to its box spot, which is the place the post's own words would not have given it either.
create function surface_groups_on(p_post uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('version', v.id, 'body', coalesce(v.payload ->> 'body', ''), 'forged', coalesce(v.payload -> 'forged', '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('draw', p.draw, 'grp', p.grp, 'place', p.place) order by d.created_at, d.id, p.grp)
                        from surfaces s join surface_coats c on c.play = s.play join acts_public d on d.id = c.draw join surface_places p on p.draw = c.draw and p.version = v.id
                        where s.post = p_post), '[]'::jsonb))
  from (select a.id, a.payload from acts_public a
        where a.id = post_version(p_post)
          and exists (select 1 from acts_public q where q.id = p_post and q.kind = 'post')) v
$$;
revoke execute on function surface_groups_on(uuid) from public, anon, authenticated;
grant execute on function surface_groups_on(uuid) to service_role;

-- surface_version_pair(post, version): for a draw. `current` is the post's current version ({version, body, forged}, as surface_groups_on names it), `drawn` the version the draw says it was drawn on, or null when that is not one of
-- the post's versions (its own Act or one of its edits). Service role only; the words are read through acts_public, as above.
create function surface_version_pair(p_post uuid, p_version uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'current', (select jsonb_build_object('version', a.id, 'body', coalesce(a.payload ->> 'body', ''), 'forged', coalesce(a.payload -> 'forged', '[]'::jsonb))
                from acts_public a where a.id = post_version(p_post)),
    'drawn', (select jsonb_build_object('version', a.id, 'body', coalesce(a.payload ->> 'body', ''), 'forged', coalesce(a.payload -> 'forged', '[]'::jsonb))
              from acts_public a where a.id = p_version and (a.id = p_post or (a.kind = 'edit' and a.target_act_id = p_post))))
  where exists (select 1 from acts_public q where q.id = p_post and q.kind = 'post')
$$;
revoke execute on function surface_version_pair(uuid, uuid) from public, anon, authenticated;
grant execute on function surface_version_pair(uuid, uuid) to service_role;

-- surface_post_of(play): the post a wall is on, for a draw's Edge Function, which has the play and needs the post's versions (surface_version_pair). Null for a play that holds no wall. Service role only; it names no owner.
create function surface_post_of(p_play uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.post from surfaces s where s.play = p_play
$$;
revoke execute on function surface_post_of(uuid) from public, anon, authenticated;
grant execute on function surface_post_of(uuid) to service_role;
-- card_target (0413), from its latest definition, changing only what is said.
CREATE OR REPLACE FUNCTION public.card_target(target uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind, 'author', a.character,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'forged', coalesce(a.current_payload -> 'forged', '[]'::jsonb),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'gimmick', ck.gimmick,
          -- The effect this play draws and counts toward the post's limit, and whether its author has cleared it for this version of the post (post_effects_up's test, effect_cleared).
          'drawing', case when ck.draws_effect then true end, 'cleared', case when ck.draws_effect and effect_cleared(k.id, post_version(a.id)) then true end,
          'ends', k.payload ->> 'ends', 'drive', dp.drive,
          'covered', case when ck.surface then (select sf.covered from surfaces sf where sf.play = k.id) end, 'closes', to_jsonb(dp.closes),
          'quadrant', case when ck.skim is not null then k.payload #>> '{config,quadrant}' end,
          -- A live rewind's rarity: the effect carries what the freeze turns away, the same for every caster (the engine's CardEffect.rewind).
          'rewind', case when ck.rewind is not null then jsonb_build_object('upTo', ck.rewind) end,
          -- And when it was played, so the engine's freeze names the latest-played of two live rewinds as live_rewind does (CardEffect.at).
          'at', case when ck.rewind is not null then k.created_at end)) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        -- One grouped read of the post's drive plays: each play's drive, and that drive's close (its latest play plus the card's `lasts`).
        left join (select d.id, d.drive, max(d.created_at) over (partition by d.card, d.drive) + span_interval(dk.drive -> 'lasts') as closes
                   from drive_plays(a.id) d join card_kinds dk on dk.key = d.card) dp on dp.id = k.id
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught') and not card_ended(k.id) and coalesce(k.payload ->> 'reach', 'post') = 'post'
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, tb.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        left join acts tb on tb.kind = 'take_back' and (tb.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
    -- Where the target is a reply a play in force draws under its parent (post_under): the parent, and no key for any other post.
    || coalesce((select jsonb_build_object('under', u.parent) from post_under u where u.reply = a.id and not card_ended(u.play)), '{}'::jsonb)
  from acts_public a where a.id = target
  );
end
$function$;

-- thread_page (0451), from its latest definition, changing what is said and giving each post of the page a `version`: the post's current version, the id of its latest edit through acts_public (by created_at, id: the order surface_groups_on
-- reads), or the Act's own id where it has none. Edits are public Acts and every reader sees the same id, so it is no private fact; a hidden edit still has its row, so it is still the version, and its words are what acts_public gives.
CREATE OR REPLACE FUNCTION public.thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) IS NULL) OR ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) < 1) OR (COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) > 100))) THEN screen_refusal('a page holds 1 to 100 posts'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH pp AS MATERIALIZED (
          SELECT COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1)) AS n
         ), s AS MATERIALIZED (
          SELECT o.id,
             o.board,
             o.title,
             o.origin_act_id,
             o.created_at,
             o.last_at,
             o.last_seq,
             o.replies,
             o.first_act,
             o.first_character,
             o.last_act,
             o.last_character,
             o.replies_this_week,
             o.origin_thread,
             o.origin_place,
             (GREATEST((1)::numeric, ceil(((o.last_seq)::numeric / (( SELECT pp.n
                    FROM pp))::numeric))))::integer AS last_page
            FROM thread_open o
           WHERE (o.id = thread_page.in_thread)
         ), pg AS MATERIALIZED (
          SELECT s.id,
             s.board,
             s.title,
             s.origin_act_id,
             s.created_at,
             s.last_at,
             s.last_seq,
             s.replies,
             s.first_act,
             s.first_character,
             s.last_act,
             s.last_character,
             s.replies_this_week,
             s.origin_thread,
             s.origin_place,
             s.last_page,
             LEAST(s.last_page, GREATEST(1, COALESCE(
                 CASE
                     WHEN (thread_page.in_seq IS NOT NULL) THEN (GREATEST((1)::numeric, ceil(((thread_page.in_seq)::numeric / (( SELECT pp.n
                        FROM pp))::numeric))))::integer
                     ELSE NULL::integer
                 END, thread_page.in_page, 1))) AS page
            FROM s
         ), rng AS MATERIALIZED (
          SELECT pg.id,
             pg.board,
             pg.title,
             pg.origin_act_id,
             pg.created_at,
             pg.last_at,
             pg.last_seq,
             pg.replies,
             pg.first_act,
             pg.first_character,
             pg.last_act,
             pg.last_character,
             pg.replies_this_week,
             pg.origin_thread,
             pg.origin_place,
             pg.last_page,
             pg.page,
             (((pg.page - 1) * ( SELECT pp.n
                    FROM pp)) + 1) AS first_seq,
             (pg.page * ( SELECT pp.n
                    FROM pp)) AS end_seq
            FROM pg
         ), range_acts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a,
             rng
           WHERE ((a.thread = rng.id) AND ((a.seq >= rng.first_seq) AND (a.seq <= rng.end_seq)) AND (a.kind <> ALL (ARRAY['edit'::text, 'card'::text])))
         ), drawn AS MATERIALIZED (
          SELECT r.id,
             r.seq,
             r.kind,
             u.play,
             u.parent
            FROM (range_acts r
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.parent
                    FROM post_under x
                   WHERE (x.reply = r.id)) u)
           WHERE (NOT card_ended(u.play))
         ), page_acts AS MATERIALIZED (
          SELECT r.id,
             r."character",
             r.kind,
             r.thread,
             r.target_act_id,
             r.seq,
             r.created_at,
             r.payload,
             r.current_payload,
             r.edited_at,
             r.shown_edited_at,
             r.untaken,
             r.ends_at,
             r.hidden,
             r.any_hidden,
             r.concealing,
             r.payload_hidden,
             r.payload_concealing
            FROM range_acts r
           WHERE (NOT (EXISTS ( SELECT 1
                    FROM drawn d
                   WHERE (d.id = r.id))))
         ), page_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.created_at
            FROM page_acts a
           WHERE post_kind(a.kind)
         ), nested AS MATERIALIZED (
          SELECT u.play,
             p.id AS parent,
             a.id,
             a."character",
             a.created_at,
             to_jsonb(a.*) AS act
            FROM ((page_posts p
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.reply
                    FROM post_under x
                   WHERE ((x.parent = p.id) AND (NOT card_ended(x.play)))) u)
              JOIN acts_public a ON ((a.id = u.reply)))
         ), posts AS MATERIALIZED (
          SELECT p.id,
             p."character",
             p.created_at
            FROM page_posts p
         UNION ALL
          SELECT n.id,
             n."character",
             n.created_at
            FROM nested n
         ), on_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM post_play_ids(ARRAY( SELECT p.id
                    FROM posts p)) x
         ), on_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM on_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM on_ids i)) r(r)
         UNION ALL
          -- The board cards written in this thread, which sit on no post (target_act_id is null): from this page's first Act up to the next page's first (page 1 from the start, the last page to the end), at most 100.
          -- Read as the page reads every play, through acts_public, by id, in on_posts below; the page's `plays` leave them out and `boardCards` is made of them.
          SELECT b.b AS id
            FROM rng,
             board_card_ids(rng.id, rng.page, rng.first_seq, rng.end_seq) b(b)
         ), on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM on_all o)))
         ), ends_on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE ((a.kind = 'card_end'::text) AND (a.target_act_id IN ( SELECT o.id
                    FROM on_posts o
                   WHERE (o.target_act_id IS NOT NULL))))
         ), above AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM effects_above(ARRAY( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)), ( SELECT rng.id
                    FROM rng), ( SELECT rng.board
                    FROM rng)) x(play, reach, target, ends_at, act)
         ), kept_span AS MATERIALIZED (
          SELECT min(p.created_at) AS lo,
             max(p.created_at) AS hi
            FROM posts p
         ), kept_reach AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             COALESCE(x."character", x.thread, x.board) AS target,
             x.ends_at
            FROM play_reach x,
             kept_span s
           WHERE ((s.lo IS NOT NULL) AND (x.thread = ( SELECT rng.id
                    FROM rng)) AND (tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (x.ends_at <= now()))
         UNION ALL
          SELECT x.play,
             x.reach,
             x."character" AS target,
             x.ends_at
            FROM ((( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)) au
              CROSS JOIN kept_span s)
              CROSS JOIN LATERAL ( SELECT r.play,
                     r.reach,
                     r."character",
                     r.ends_at
                    FROM play_reach r
                   WHERE ((r."character" = au."character") AND (tstzrange(r.started_at, r.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (r.ends_at <= now()))) x)
         ), kept_window AS MATERIALIZED (
          SELECT r.play,
             r.reach,
             r.target,
             r.ends_at,
             a.created_at AS started,
             to_jsonb(a.*) AS act,
             (a.payload ->> 'card'::text) AS card
            FROM (kept_reach r
              JOIN acts_public a ON ((a.id = r.play))),
             kept_span s
           WHERE ((a.created_at <= s.hi) AND (EXISTS ( SELECT 1
                    FROM posts p
                   WHERE ((a.created_at <= p.created_at) AND (p.created_at < r.ends_at) AND ((r.reach <> 'character'::text) OR (p."character" = r.target))))))
         ), kept AS MATERIALIZED (
          SELECT w.play,
             w.reach,
             w.target,
             w.ends_at,
             w.act
            FROM (kept_window w
              JOIN card_kinds ck ON (((ck.key = w.card) AND ck.keeps)))
           WHERE (NOT card_ended(w.play))
           ORDER BY w.started, w.play
          LIMIT 100
         ), played AS MATERIALIZED (
          SELECT o.id,
             o.kind,
             o."character",
             (o.payload ->> 'card'::text) AS card
            FROM on_posts o
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM above x
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM kept x
         ), answers_on AS MATERIALIZED (
          SELECT o.visit_act,
             o.post_act,
             o.at
            FROM outcome_page_rows(ARRAY(( SELECT p.id
                    FROM posts p))) o
         ), vis AS MATERIALIZED (
          SELECT DISTINCT ON (u.id) u.id,
             u.post,
             u."character",
             u.created_at,
             u.payload
            FROM (( SELECT DISTINCT ON (v.target_act_id) v.id,
                     v.target_act_id AS post,
                     v."character",
                     v.created_at,
                     v.payload
                    FROM acts_public v
                   WHERE ((v.kind = 'visit'::text) AND (v.target_act_id IN ( SELECT a.id
                            FROM page_acts a
                           WHERE (a.kind = ANY (ARRAY['post'::text, 'spin'::text]))
                         UNION ALL
                          SELECT n.id
                            FROM nested n)))
                   ORDER BY v.target_act_id, v.created_at DESC, v.id DESC)
                 UNION ALL
                  SELECT v.id,
                     v.target_act_id,
                     v."character",
                     v.created_at,
                     v.payload
                    FROM acts_public v
                   WHERE ((v.kind = 'visit'::text) AND (v.id IN ( SELECT x.visit_act
                            FROM answers_on x)))) u
           ORDER BY u.id
         ), o_on AS MATERIALIZED (
          SELECT r.origin_act_id AS id
            FROM rng r
           WHERE ((r.origin_act_id IS NOT NULL) AND (EXISTS ( SELECT 1
                    FROM page_acts a
                   WHERE (a.id = r.first_act))))
         ), o_act AS MATERIALIZED (
          SELECT a.*
            FROM (o_on o
              JOIN acts_public a ON ((a.id = o.id)))
         ), o_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM (o_on o
              CROSS JOIN LATERAL post_play_ids(ARRAY[o.id]) x)
         ), o_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM o_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM o_ids i)) r(r)
         ), o_plays AS MATERIALIZED (
          SELECT a.*
            FROM acts_public a
           WHERE (EXISTS ( SELECT 1
                    FROM o_ids x)) AND (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM o_all o)))
         ), o_shown AS MATERIALIZED (
          SELECT s.*
            FROM o_plays s
         ), o_ends AS MATERIALIZED (
          SELECT e.*
            FROM acts_public e
           WHERE ((e.kind = 'card_end'::text) AND (e.target_act_id IN ( SELECT s.id
                    FROM o_shown s)))
         ), o_cast AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM o_act a
                 UNION
                  SELECT s."character"
                    FROM o_shown s
                 UNION
                  SELECT
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND ((a.payload ->> 'reach'::text) = 'character'::text)) THEN ((a.payload ->> 'character'::text))::uuid
                             ELSE NULL::uuid
                         END AS "character"
                    FROM o_act a) w
           WHERE (w.c IS NOT NULL)
         ), o_post AS MATERIALIZED (
          SELECT x.id
            FROM ( SELECT
                         CASE
                             WHEN post_kind(a.kind) THEN a.id
                             WHEN (a.kind = 'poll'::text) THEN a.target_act_id
                             WHEN (a.kind = 'ballot'::text) THEN ( SELECT q.target_act_id
                                FROM acts_public q
                               WHERE (q.id = a.target_act_id))
                             ELSE NULL::uuid
                         END AS id
                    FROM o_act a) x
           WHERE (x.id IS NOT NULL)
         ), pl_post AS MATERIALIZED (
          SELECT p.id
            FROM posts p
         UNION
          SELECT o.id
            FROM o_post o
         ), pl_cur AS MATERIALIZED (
          SELECT x.id AS post,
             l.id AS poll,
             l.created_at,
             ((l.payload ->> 'secret'::text))::boolean AS secret,
             to_jsonb(l.*) AS act
            FROM (pl_post x
              CROSS JOIN LATERAL ( SELECT a.*
                    FROM acts_public a
                   WHERE ((a.kind = 'poll'::text) AND (a.target_act_id = x.id))
                   ORDER BY a.created_at DESC, a.id DESC
                  LIMIT 1) l)
           WHERE (NOT (l.payload ? 'removed'::text))
         ), pl_polls AS MATERIALIZED (
          SELECT c.post,
             c.poll,
             c.created_at,
             c.secret,
             c.act,
             k.counts,
             k.voters,
             k.ends_at,
             k.closed,
             cl.j AS close,
             EXISTS (SELECT 1 FROM acts b WHERE b.kind = 'ballot'::text AND b.target_act_id = c.poll) AS balloted
            FROM ((pl_cur c
              CROSS JOIN LATERAL ( SELECT n.counts,
                     n.voters,
                     n.ends_at,
                     n.closed
                    FROM poll_counts n
                   WHERE (n.poll = c.poll)) k)
              LEFT JOIN LATERAL ( SELECT to_jsonb(e.*) AS j
                    FROM acts_public e
                   WHERE ((e.kind = 'poll_close'::text) AND (e.target_act_id = c.poll))
                  LIMIT 1) cl ON (true))
         ), pl_voters AS MATERIALIZED (
          SELECT p.post,
             p.poll,
             b.id AS act,
             b."character",
             (b.payload -> 'picks'::text) AS picks,
             b.created_at
            FROM ((pl_polls p
              CROSS JOIN LATERAL poll_voter_acts(p.poll, p.ends_at, 50) v(act))
              CROSS JOIN LATERAL ( SELECT x.id,
                     x."character",
                     x.payload,
                     x.created_at
                    FROM acts_public x
                   WHERE (x.id = v.act)) b)
           WHERE (NOT p.secret)
         ), pl_cast AS MATERIALIZED (
          SELECT DISTINCT v."character" AS c
            FROM pl_voters v
           WHERE (v."character" IS NOT NULL)
         ), pl_mine AS MATERIALIZED (
          SELECT m.act,
             m.poll,
             p.post,
             m."character",
             m.picks,
             m.created_at
            FROM (my_latest_ballots m
              JOIN pl_polls p ON ((p.poll = m.poll)))
           WHERE (m.created_at < p.ends_at)
         UNION ALL
          SELECT b.act,
             l.poll,
             p.post,
             l."character",
             b.picks,
             b.created_at
            FROM ((my_latest_ballots l
              JOIN pl_polls p ON ((p.poll = l.poll)))
              CROSS JOIN LATERAL ( SELECT m.act,
                     m.picks,
                     m.created_at
                    FROM my_ballots m
                   WHERE ((m.poll = l.poll) AND (m."character" = l."character") AND (m.created_at < p.ends_at))
                   ORDER BY m.created_at DESC, m.act DESC
                  LIMIT 1) b)
           WHERE (l.created_at >= p.ends_at)
         ), ids AS MATERIALIZED (
          SELECT a.id
            FROM page_acts a
         UNION
          SELECT n.id
            FROM nested n
         UNION
          SELECT p.id
            FROM played p
         UNION
          SELECT a.id
            FROM o_act a
         UNION
          SELECT s.id
            FROM o_shown s
         UNION
          SELECT p.poll
            FROM pl_polls p
         ), who AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM page_acts a
                 UNION
                  SELECT n."character"
                    FROM nested n
                 UNION
                  SELECT p."character"
                    FROM played p
                 UNION
                  SELECT v."character"
                    FROM vis v) w
           WHERE (w.c IS NOT NULL)
         ), wanted_plays AS MATERIALIZED (
          SELECT p.id
            FROM played p
           WHERE (p.card = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         UNION
          SELECT s.id
            FROM o_shown s
           WHERE ((s.payload ->> 'card'::text) = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         ), heads AS MATERIALIZED (
          SELECT c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'locked_until', locked_out_until(c.id, thread_page.in_thread), 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                    FROM character_profiles p
                   WHERE (p."character" = c.id))) AS head
            FROM (( SELECT w.c
                    FROM who w
                 UNION
                  SELECT o.c
                    FROM o_cast o
                 UNION
                  SELECT v.c
                    FROM pl_cast v) k(id)
              CROSS JOIN LATERAL ( SELECT x.*
                    FROM characters_public x
                   WHERE (x.id = k.id)
                  OFFSET 0) c)
         ), spun AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place,
             l.n
            FROM ( SELECT t.id,
                     t.board,
                     t.title,
                     t.origin_act_id,
                     t.created_at,
                     t.last_at,
                     t.last_seq,
                     t.replies,
                     t.first_act,
                     t.first_character,
                     t.last_act,
                     t.last_character,
                     t.replies_this_week,
                     t.origin_thread,
                     t.origin_place,
                     row_number() OVER (PARTITION BY t.origin_act_id ORDER BY t.created_at, t.id) AS n
                    FROM thread_list t
                   WHERE (t.origin_act_id IN ( SELECT i.id
                            FROM ids i))) l
           WHERE (l.n <= 200)
         ), rw AS MATERIALIZED (
          -- The live rewind plays of the page's posts (and the replies drawn under them) and of the ORIGIN post, from one set-based read (post_rewind_plays), as `on_ids` reads post_play_ids.
          SELECT r.post,
             r.play,
             r.played_at,
             rewind_view(r.play) AS view
            FROM post_rewind_plays(ARRAY( SELECT x.id
                    FROM ( SELECT p.id
                            FROM posts p
                         UNION
                          SELECT o.id
                            FROM o_on o) x)) r
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM rng))) THEN NULL::jsonb
             ELSE jsonb_build_object('summary', ( SELECT (to_jsonb(s.*) - 'last_page'::text)
                FROM s), 'page', ( SELECT rng.page
                FROM rng), 'boardCards', ( SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM on_posts o
               WHERE (o.target_act_id IS NULL)), 'acts', ( SELECT COALESCE(jsonb_agg((CASE WHEN post_kind(a.kind) THEN to_jsonb(a.*) || jsonb_build_object('version', post_current_version(a.id)) ELSE to_jsonb(a.*) END) ORDER BY a.seq), '[]'::jsonb) AS "coalesce"
                FROM page_acts a), 'people', ( SELECT COALESCE(jsonb_agg((c.head || jsonb_build_object('posts', COALESCE(( SELECT n.posts
                        FROM character_post_counts n
                       WHERE (n."character" = c.id)), 0), 'standing', COALESCE(( SELECT st.standing
                        FROM current_standings st
                       WHERE (st."character" = c.id)), 0), 'reveals', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'character', r."character", 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread) ORDER BY r.at, r.act), '[]'::jsonb) AS "coalesce"
                        FROM class_reveals r
                       WHERE (r."character" = c.id)), 'turns', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', u.act, 'character', u."character", 'at', u.at, 'was', u.was) ORDER BY u.at, u.act), '[]'::jsonb) AS "coalesce"
                        FROM turns_announced u
                       WHERE (u."character" = c.id)))) ORDER BY c.id), '[]'::jsonb) AS "coalesce"
                FROM heads c
               WHERE (c.id IN ( SELECT w.c
                        FROM who w))), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                FROM ( SELECT to_jsonb(o.*) AS j,
                         o.created_at,
                         o.id
                        FROM on_posts o
                       WHERE (o.target_act_id IS NOT NULL)
                     UNION ALL
                      SELECT to_jsonb(e.*) AS to_jsonb,
                         e.created_at,
                         e.id
                        FROM ends_on_posts e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                FROM post_kind_counts(ARRAY( SELECT p.id
                        FROM posts p)) k), 'above', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM above x), 'kept', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM kept x), 'under', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) ORDER BY ((n.act ->> 'seq'::text))::integer, n.id), '[]'::jsonb) AS "coalesce"
                FROM nested n), 'cut', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', ( SELECT pa.seq
                        FROM acts_public pa
                       WHERE (pa.id = d.parent))) ORDER BY d.seq), '[]'::jsonb) AS "coalesce"
                FROM drawn d
               WHERE (d.kind = 'post'::text)), 'visits', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('visit', v.id, 'post', v.post, 'mod', v."character", 'at', v.created_at, 'ends_at', (v.payload -> 'ends_at'::text), 'line', (v.payload -> 'line'::text), 'charges', ((v.payload -> 'charges'::text) || COALESCE(( SELECT jsonb_agg((j.payload -> 'charge'::text) ORDER BY j.created_at, j.id) AS jsonb_agg
                        FROM acts_public j
                       WHERE ((j.kind = 'visit_join'::text) AND (j.target_act_id = v.id))), '[]'::jsonb)), 'challenge', (jsonb_strip_nulls(jsonb_build_object('kind', (v.payload #>> '{challenge,kind}'::text[]), 'question_index', (v.payload #> '{challenge,question_index}'::text[]), 'price', (v.payload #> '{challenge,price}'::text[]))) || COALESCE(visit_quiz(v.id), '{}'::jsonb)), 'end', ( SELECT jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', (e.payload ->> 'outcome'::text), 'by_act', (e.payload -> 'by_act'::text), 'line', (e.payload -> 'line'::text)) AS jsonb_build_object
                        FROM acts_public e
                       WHERE ((e.kind = 'visit_end'::text) AND (e.target_act_id = v.id))
                      LIMIT 1), 'ruling', ( SELECT (r.payload ->> 'verdict'::text)
                        FROM ((acts_public i
                          JOIN acts_public ap ON (((ap.kind = 'appeal'::text) AND (ap.target_act_id = i.id))))
                          JOIN acts_public r ON (((r.kind = 'appeal_ruling'::text) AND (r.target_act_id = ap.id))))
                       WHERE ((i.kind = 'infraction'::text) AND ((i.payload ->> 'visit_act'::text) = (v.id)::text))
                      LIMIT 1), 'answers', COALESCE(( SELECT jsonb_agg(x.post_act ORDER BY x.at, x.post_act) AS jsonb_agg
                        FROM answers_on x
                       WHERE (x.visit_act = v.id)), '[]'::jsonb)) ORDER BY v.created_at, v.id), '[]'::jsonb) AS "coalesce"
                FROM vis v), 'faces', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb) AS "coalesce"
                FROM my_face_down f
               WHERE (f.play IN ( SELECT p.id
                        FROM played p
                       WHERE (p.kind = 'set'::text)))), 'veiled', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', v.post, 'character', v."character", 'play', v.play, 'ends_at', v.ends_at) ORDER BY v.post), '[]'::jsonb) AS "coalesce"
                FROM my_veiled_posts v
               WHERE (v.post IN ( SELECT p.id
                        FROM posts p))), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb) AS "coalesce"
                FROM effect_state e
               WHERE (e.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'releases', ( SELECT COALESCE(jsonb_agg(r.play), '[]'::jsonb) AS "coalesce"
                FROM effect_releases r
               WHERE (r.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'spent', ( SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM (on_posts o
                  JOIN card_kinds ck ON (((ck.key = (o.payload ->> 'card'::text)) AND ((ck.discipline ->> 'kind'::text) = 'fall'::text))))
               WHERE ((o.kind = 'card'::text) AND fall_spent(o.id))), 'surfaces', ( SELECT COALESCE(jsonb_object_agg((sf.play)::text, jsonb_build_object('covered', sf.covered, 'live', to_jsonb(sf.live))), '{}'::jsonb) AS "coalesce"
                FROM surfaces sf
               WHERE (sf.play IN ( SELECT o.id
                        FROM on_posts o
                       WHERE (o.kind = 'card'::text)))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
                FROM reaction_tallies t
               WHERE (t.act IN ( SELECT i.id
                        FROM ids i))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")), '[]'::jsonb) AS "coalesce"
                FROM my_reactions m
               WHERE (m.act IN ( SELECT i.id
                        FROM ids i))), 'polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                FROM pl_voters v), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p
               WHERE ((NOT p.secret) AND (p.voters > 50))), 'voterCast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                FROM heads h
               WHERE (h.id IN ( SELECT v.c
                        FROM pl_cast v))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                FROM pl_mine m), 'spun', ( SELECT COALESCE(jsonb_agg((to_jsonb(l.*) - 'n'::text) ORDER BY l.created_at, l.id), '[]'::jsonb) AS "coalesce"
                FROM spun l), 'reading', ( SELECT r.furthest_seq
                FROM reading r
               WHERE (r.thread = thread_page.in_thread)
              LIMIT 1), 'board', ( SELECT jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act) AS jsonb_build_object
                FROM boards_now b
               WHERE (b.id = ( SELECT rng.board
                        FROM rng))), 'following', following_thread(in_thread), 'presence', presence_box('thread'::text, in_thread), 'unread', my_alerts_unread(), 'rewinds', ( SELECT COALESCE(jsonb_agg(w.view ORDER BY w.played_at DESC, w.play DESC), '[]'::jsonb) AS "coalesce"
                FROM rw w
               WHERE (w.view IS NOT NULL))) ||
             CASE
                 WHEN (EXISTS ( SELECT 1
                    FROM o_on)) THEN jsonb_build_object('origin', jsonb_build_object('act', ( SELECT to_jsonb(a.*) AS to_jsonb
                        FROM o_act a), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.grp, x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                        FROM ( SELECT to_jsonb(s.*) AS j,
                                 0 AS grp,
                                 s.created_at,
                                 s.id
                                FROM o_shown s
                             UNION ALL
                              SELECT to_jsonb(e.*) AS to_jsonb,
                                 1,
                                 e.created_at,
                                 e.id
                                FROM o_ends e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                        FROM post_kind_counts(ARRAY( SELECT o.id
                                FROM o_on o)) k), 'moment', origin_moment(in_thread), 'at', ( SELECT jsonb_build_object('thread', (z.q ->> 'thread'::text), 'seq', ((z.q ->> 'seq'::text))::integer) AS jsonb_build_object
                        FROM ( SELECT
                                 CASE
                                     WHEN ((r.origin_place ->> 'kind'::text) = 'play'::text) THEN COALESCE(NULLIF((r.origin_place -> 'at'::text), 'null'::jsonb),
                                     CASE
                                         WHEN ((r.origin_place #>> '{on,kind}'::text[]) = 'post'::text) THEN (r.origin_place -> 'on'::text)
                                         ELSE NULLIF((r.origin_place -> 'from'::text), 'null'::jsonb)
                                     END)
                                     WHEN ((r.origin_place ->> 'kind'::text) = ANY (ARRAY['poll'::text, 'ballot'::text])) THEN (r.origin_place -> 'on'::text)
                                     ELSE NULL::jsonb
                                 END AS q
                                FROM rng r) z
                       WHERE (jsonb_typeof(z.q) = 'object'::text)), 'cast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                        FROM heads h
                       WHERE (h.id IN ( SELECT o.c
                                FROM o_cast o
                             UNION
                              SELECT v."character"
                                FROM pl_voters v
                               WHERE ((v.post IN ( SELECT op.id
                                        FROM o_post op)) AND (EXISTS ( SELECT 1
                                        FROM o_act a
                                       WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text]))))))))) ||
                     CASE
                         WHEN (EXISTS ( SELECT 1
                            FROM o_act a
                           WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text])))) THEN jsonb_build_object('polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE (p.post IN ( SELECT op.id
                                    FROM o_post op))), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                            FROM pl_voters v
                           WHERE (v.post IN ( SELECT op.id
                                    FROM o_post op))), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE ((NOT p.secret) AND (p.voters > 50) AND (p.post IN ( SELECT op.id
                                    FROM o_post op)))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                            FROM pl_mine m
                           WHERE (m.post IN ( SELECT op.id
                                    FROM o_post op))))
                         ELSE '{}'::jsonb
                     END)
                 ELSE '{}'::jsonb
             END
         END AS jsonb_build_object
  );
end
$function$;

-- digest_plays (0433), from its latest definition, changing only what is said.
CREATE OR REPLACE FUNCTION public.digest_plays(since timestamp with time zone, until timestamp with time zone, most integer)
 RETURNS TABLE(play uuid, post uuid, drawn integer, played_at timestamp with time zone, card text, made_at timestamp with time zone, caster text, config jsonb, state jsonb, words text, covered double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET jit TO 'off'
 SET enable_seqscan TO 'off'
 SET enable_bitmapscan TO 'off'
AS $function$
  select c.play, c.post, c.drawn, c.played_at,
         case when a.kind = 'card' then a.payload ->> 'card'
              else (select s.payload ->> 'card' from acts s where s.kind = 'spring' and s.target_act_id = c.post and s.payload ->> 'set' = c.play::text limit 1) end,
         a.created_at, cn.name, a.payload -> 'config', es.state, t.text, sf.covered
  from (select p.play, p.post, p.drawn, p.played_at from play_post p
        where p.played_at >= digest_plays.since and p.played_at < digest_plays.until and (p.kind <> '' or p.sprung)
        order by p.drawn desc, p.played_at desc, p.play desc) c
  cross join lateral (select v.id, v.kind, v.created_at, v.payload, v."character" from acts_public v where v.id = c.play and v.kind in ('card', 'set') and not (v.payload ? 'caught') and v.untaken is not true offset 0) a
  cross join lateral (select pv.thread from acts_public pv where pv.id = c.post and pv.hidden is not true and pv.kind in ('post', 'spin') offset 0) pk
  left join lateral (select cp.name from characters_public cp where cp.id = a."character") cn on true
  left join lateral (select e.state from effect_state e where e.play = c.play offset 0) es on true
  -- the words a writing play made, as the page's tails (post_tails) show them to any reader: the text for the post's current version, else the latest text it has
  left join lateral (select ct.text from card_texts ct where ct.play = c.play and ct.text is not null order by (ct.version = post_version(c.post)) desc, ct.created_at desc, ct.id desc limit 1) t on true
  -- the share of a surface a play covers: its `covered` (the live draws' painted cells) over the grid's 100 x 100 cells (0317), a row for a surface card alone
  left join lateral (select x.covered::double precision / 10000 as covered from surfaces x where x.play = c.play) sf on true
  where not exists (select 1 from unlisted_threads u where u.thread = pk.thread)
  limit digest_plays.most
$function$;

-- extras_ids (0426), from its latest definition, changing only what is said.
CREATE OR REPLACE FUNCTION public.extras_ids(posts uuid[])
 RETURNS TABLE(post uuid, part text, act uuid, at timestamp with time zone, state jsonb, ver uuid, text text, covered double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET jit TO 'off'
 SET enable_seqscan TO 'off'
 SET enable_bitmapscan TO 'off'
 SET enable_sort TO 'off'
 SET enable_incremental_sort TO 'off'
AS $function$
begin
  if cardinality(extras_ids.posts) > 200 then raise exception 'ask for at most 200 posts at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return query
  with polls as materialized (
    select p.id as post, l.id as poll, l.created_at
    from unnest(extras_ids.posts) p(id)
    cross join lateral (select a.id, a.created_at from acts a where a.kind = 'poll' and a.target_act_id = p.id order by a.created_at desc, a.id desc limit 1) l
  ), closes as materialized (
    select pl.post, c.id
    from polls pl cross join lateral (select x.id from acts x where x.kind = 'poll_close' and x.target_act_id = pl.poll limit 1) c
  ), rw as materialized (
    select distinct on (r.post) r.post, r.play from post_rewind_plays(extras_ids.posts) r order by r.post, r.played_at desc, r.play desc
  )
  select pl.post, 'poll'::text, pl.poll, pl.created_at, null::jsonb, null::uuid, null::text, null::double precision from polls pl
  union all
  select c.post, 'close', c.id, null::timestamptz, null::jsonb, null::uuid, null::text, null::double precision from closes c
  union all
  select x.post, 'play', x.play, p.played_at, e.state, null::uuid, t.text, s.covered
  from post_play_ids(extras_ids.posts) x
  join play_post p on p.play = x.play
  left join effect_state e on e.play = x.play
  -- the words a writing play made, as the page's tails (post_tails) show them to any reader: the text for the post's current version, else the latest text it has; a play that writes has a row for each version of its post, any other none
  left join lateral (select ct.text from card_texts ct where ct.play = x.play and ct.text is not null order by (ct.version = post_version(x.post)) desc, ct.created_at desc, ct.id desc limit 1) t on true
  -- the share of a surface a play covers: the page's `covered` (the live draws' painted cells) over the grid's 100 x 100 cells (0317), a row for a surface card alone
  left join lateral (select sf.covered::double precision / 10000 as covered from surfaces sf where sf.play = x.play) s on true
  -- the plays the board draws as live layers (post_play_ids' first three arms: in force, or a sprung back whose lockout is live), not the stand-ins it also returns for the Lens; and never a back that has not sprung
  where ((p.over_at is null and (p.ends_at is null or p.ends_at > now())) or p.lock_until > now()) and (p.kind <> '' or p.sprung)
  union all
  select rw.post, 'rewind', rw.play, pt.point, null::jsonb, v.id, null::text, null::double precision
  from rw
  cross join lateral (select (k.payload ->> 'rewind_at')::timestamptz as point from acts k where k.id = rw.play) pt
  cross join lateral (select coalesce((select e.id from acts e where e.kind = 'edit' and e.target_act_id = rw.post and e.created_at <= pt.point order by e.created_at desc, e.id desc limit 1), rw.post) as id) v
  where pt.point is not null and exists (select 1 from acts o where o.id = rw.post and o.kind in ('post', 'spin'));
end $function$;

-- lay_sprung (0357), from its latest definition, changing only what is said.
CREATE OR REPLACE FUNCTION public.lay_sprung(setter uuid, card text, config jsonb, target uuid, reach text, spring uuid, from_post uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  kind_of card_kinds%rowtype;
  staff_setter boolean;
  in_thread uuid;
  on_post uuid;
  layer integer;
  ends timestamptz;
  target_name text;
  written uuid := gen_random_uuid();
  flag text;
  w_opens timestamptz;
  w_closes timestamptz;
  draft face_down_draws%rowtype;
  set_thread uuid;
begin
  select * into kind_of from card_kinds k where k.key = lay_sprung.card;
  select c.staff is not null into staff_setter from characters c where c.id = setter;
  if reach = 'post' then
    select a.thread into in_thread from acts a where a.id = target;
    on_post := target;
    select greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1 into layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught') and coalesce(k.payload ->> 'reach', 'post') = 'post';
  elsif reach = 'character' then
    select c.name into target_name from characters c where c.id = target;
    select a.thread into in_thread from acts a where a.id = from_post;
    on_post := from_post;
  elsif reach = 'thread' then
    select t.title into target_name from threads t where t.id = target;
    in_thread := target;
    select a.id into on_post from acts a where a.thread = target and a.seq = 1;
  else
    select b.name into target_name from boards_now b where b.id = target;
    -- The thread its set was laid in, when that thread is on the target board; else the board's most recently active thread (thread_list's order). A board with no thread takes none; spring_traps asks for one that has the
    -- quoted post's thread, so a spring never meets this refusal.
    select s.thread into set_thread from acts s where s.id = (select (sp.payload ->> 'set')::uuid from acts sp where sp.id = lay_sprung.spring);
    if set_thread is not null then
      select t.id into in_thread from threads t where t.id = set_thread and t.board = target;
    end if;
    if in_thread is null then
      select t.id into in_thread from threads t where t.board = target order by t.last_at desc limit 1;
    end if;
    if in_thread is null then
      raise exception 'start a thread on % first', target_name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    on_post := null;
  end if;
  if reach <> 'post' then
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
    if kind_of.scores_as then
      select w.opens, w.closes into w_opens, w_closes from scored_as_window(now()) w;
      ends := w_closes;
    end if;
  elsif kind_of.lasts is not null then
    -- A card with a time up lands on a post with its `ends`, as place_cast writes it (a skim, a veil).
    ends := now() + kind_of.lasts;
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if staff_setter then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (id, character, kind, thread, target_act_id, payload)
  values (written, setter, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', '',
    'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end, 'spring', spring::text)
    || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name) else jsonb_build_object('layer', layer) end
    || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) when reach = 'post' and kind_of.lasts is not null then jsonb_build_object('ends', ends) else '{}'::jsonb end
    || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end);
  if staff_setter then perform set_config('kayfabb.staff_writer', flag, true); end if;
  -- The card carries its setter, and its payload names the spring, which targets the post the back was set on: while an author veil is live on that post, the card is shown under the stand-in as the spring is (post_veil_cards,
  -- read by acts_public and the counts), and the true name returns with the veil. Written here, in the transaction of the card it describes, from the live veils of the spring's post.
  insert into post_veil_cards (card, post, author)
  select distinct written, v.post, v.author
  from acts s join post_veils_live v on v.veil = 'author' and v.post = s.target_act_id and v.author = lay_sprung.setter
  where s.id = lay_sprung.spring
  on conflict on constraint post_veil_cards_pkey do nothing;
  -- What a landed play on a post needs beside its Act (a veil's row): the same writer place_cast calls.
  if reach = 'post' then perform land_rows(written, kind_of, target, coalesce(config, '{}'), setter); end if;
  if kind_of.surface and reach = 'post' then
    select d.* into draft from face_down_draws d where d.play = (select (s.payload ->> 'set')::uuid from acts s where s.id = lay_sprung.spring);
    perform open_surface(written, coalesce(draft.most_live, 48));
    if draft.play is not null then
      if bit_count(draft.cells) <= draft.most then perform surface_apply(written, setter, 'draw', draft.payload, translate(draft.cells::text, '1', 'k'), null, null, draft.most); end if;
      delete from face_down_draws d where d.play = draft.play;
    end if;
  end if;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  return written;
end $function$;
-- edit_post (0395), also taking `surface_places`: the places of the post's live groups for the edit's own version, written in the edit's transaction ([{draw, grp, place}], place an attachment or JSON null). The four-argument
-- function is dropped, so no stale signature stays callable. Everything else as 0395 wrote it. Any caller may send places, and the Edge Function sends them with the player's own session, so the list is bounded, not
-- restricted (see the header, section 5): refused above 5,760 entries, for a place that is not an attachment of a known kind at most 2 KiB, and for a group number the draw does not have. An entry for a draw that is not live
-- on this post is left out, though a malformed one is refused whether or not its draw is live. A direct call can misplace tags on the caller's own post only within those bounds.
drop function edit_post(uuid, uuid, text, jsonb);
CREATE FUNCTION public.edit_post(target uuid, through uuid, body text, poll jsonb DEFAULT NULL::jsonb, surface_places jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  in_thread uuid;
  on_board uuid;
  current_poll uuid;
  edit_act uuid;
begin
  if poll is not null then perform 1 from acts a where a.id = target and a.kind = 'post' and a.character = through for no key update; end if;
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = target and a.kind = 'post' and a.character = through;
  if in_thread is null then raise exception 'that is not a post of this character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  perform not_barred(through, on_board);
  if poll is not null then
    current_poll := latest_poll(target);
    if current_poll is not null and exists (select 1 from acts b where b.kind = 'ballot' and b.target_act_id = current_poll) then
      raise exception 'a poll cannot change once a ballot is cast; you can still close it' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    -- A closed poll is final, with ballots or none: its time has passed or it was closed, and it can no longer be replaced or removed (a post whose poll was removed, or never had one, takes a new poll as before).
    if current_poll is not null and exists (
         select 1 from acts p where p.id = current_poll and not (p.payload ? 'removed')
           and now() >= least((p.payload ->> 'closes_at')::timestamptz, coalesce((select min(x.created_at) from acts x where x.kind = 'poll_close' and x.target_act_id = p.id), 'infinity'))) then
      raise exception 'a closed poll cannot change' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  -- A draw applies under its post's advisory lock and reads the post's current version there (surface_apply). The edit takes the same lock before it is inserted, so a draw either commits before the edit or waits for the
  -- edit and is refused as stale, a first draw included. A draw that commits before the edit, after the Edge Function read the groups it sends, has no place in the edit's insert below (it writes only the places it was
  -- sent), so that draw's groups have no row for the edit's version and fall to their box spots for it; the way out is the sponge and a new tag. No one takes a surfaces row while holding this lock, so the draws' order (row, then lock) cannot cycle with it.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.surface_post.' || target::text, 0));
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'edit', in_thread, target, jsonb_build_object('body', body)) returning id into edit_act;
  -- Where each live group of the walls on this post sits in the new words, for the edit's own version: the Edge Function maps them (surface_groups_on gives it the groups). A malformed entry, a place that is not an
  -- attachment or JSON null, and a group the draw does not have are refused below, even for a draw that is not live; an entry that is well formed but names a draw that is not live on this post is left out, and a group
  -- with no entry is at its box spot.
  if jsonb_typeof(surface_places) = 'array' then
    -- The list comes from the client's call, so it is bounded as a draw's is: at most 48 draws of 120 groups, each place an attachment of a known kind at most 2 KiB, and a group the draw has.
    if jsonb_array_length(surface_places) > 5760 then
      raise exception 'an edit places at most 5,760 groups' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(surface_places) x where jsonb_typeof(x) = 'object' and not surface_place_ok(coalesce(x -> 'place', 'null'::jsonb))) then
      raise exception 'a place is a text, an image or a box attachment of at most 2 KiB' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(surface_places) x
               join acts d on jsonb_typeof(x) = 'object' and (x ->> 'draw') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (x ->> 'grp') ~ '^[0-9]{1,4}$' and d.id = (x ->> 'draw')::uuid and d.kind = 'draw'
               where (x ->> 'grp')::integer >= jsonb_array_length(case when jsonb_typeof(d.payload -> 'groups') = 'array' then d.payload -> 'groups' else '[]'::jsonb end)
                 and exists (select 1 from surfaces s join surface_coats c on c.play = s.play where s.post = target and c.draw = d.id)) then
      raise exception 'a place names a group the drawing does not have' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    insert into surface_places (draw, grp, version, place)
    select (x ->> 'draw')::uuid, (x ->> 'grp')::smallint, edit_act, coalesce(x -> 'place', 'null'::jsonb)
    from jsonb_array_elements(surface_places) x
    where jsonb_typeof(x) = 'object' and (x ->> 'draw') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (x ->> 'grp') ~ '^[0-9]{1,4}$'
      and exists (select 1 from surfaces s join surface_coats c on c.play = s.play where s.post = target and c.draw = (x ->> 'draw')::uuid)
    on conflict (draw, grp, version) do nothing;
  end if;
  if poll = '{"removed": true}'::jsonb then
    if current_poll is not null and not exists (select 1 from acts p where p.id = current_poll and p.payload ? 'removed') then
      insert into acts (character, kind, thread, target_act_id, payload) values (through, 'poll', in_thread, target, '{"removed": true}');
    end if;
  elsif poll is not null then
    perform poll_written(target, through, poll);
  end if;
  return act_projection(target);
end $function$;
revoke execute on function edit_post(uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function edit_post(uuid, uuid, text, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------------------------------------------------ 8. the rebuild, and the old row ----

-- Every surface is rebuilt from its Acts into the new rows, by the same step every write takes: a drawing of the old shape is laid at 20 tenths on each cell it inked, a wash of the old shape takes every coat of each older
-- draw on its cells (surface_replay). Then the derived columns the readers above no longer read go.
select surface_store(s.play) from surfaces s order by s.play;

alter table surfaces drop column cover;
alter table surfaces drop column owners;
