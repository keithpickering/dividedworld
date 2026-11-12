-- Surfaces: a play whose layer any character may add to (docs/plans/2026-11-11-graffiti-design.md, sections 1 to 4 and 11; plan docs/plans/2026-11-11-graffiti-plan.md, Task 2). The engine's word for what a card
-- such as a wall is: it names no card. A draw is an Act by any character adding strokes to a surface; a wash is an Act by the post's character taking ink off. What the surface shows now is computed from its
-- Acts and kept in a row of its own (`surfaces`), written in the same transaction as each Act under a lock on that row, so two drawers can never both squeeze under the limit.
--
--   1. the kind          card_kinds.surface, written by seed_instance
--   2. two Act kinds     `draw` and `wash`: each targets the play's Act, takes no seq, is by a character, and is written only by the functions below (the flag kayfabb.surface_writer, as card_end's flag works).
--                        acts_kind_check, acts_seq_check, acts_take_seq and acts_well_formed are each copied from their latest definition (0153); acts_check1 (0104) needs no change, since neither kind is
--                        among those that point at nothing. acts_surface_payload holds `strokes` an array, the payload (less its cells) to 64 KiB as Postgres writes it, and `cells`.
--   3. the derived row   surfaces: the covered cells (bit(10000), row-major), for each cell the live draw that last inked it, the live list. It holds only what the Acts already say: rebuild_surface computes it
--                        from them. face_down_draws is the private draft of a face-down surface card, read by no player.
--   4. the functions     surface_step (the pure step every write and every rebuild takes), surface_apply (the lock, the limits, the Act), open_surface, draw_on_surface, wash_surface, staff_draw_on_surface,
--                        play_surface_card, staff_play_surface_card, set_surface_card, surface_draft_fits, surface_acts, rebuild_surface; place_cast, lay_sprung, spring_traps and card_target are redefined, and the pool's three (pool_thread, pool_orphans, record_pool_spend: the walls on a page, and a wall draw as a persona's card for the day).
--   5. the readers       thread_page returns `surfaces: {play: {covered, live}}` (ids and counts, never strokes or owners); card_target shows a surface's `covered`; surface_acts is the Lens's read.
--   6. the log            my_draws and my_walls_drawn_on (the player's own draws and the washes that cut them; the draws and washes on the walls of their own posts), and log_page reading both (section 6, last).
--
-- Cells. The grid is 100 x 100, row-major: bit i of a cover is the cell at row i / 100, column i % 100 (engine/rules/surface.ts: GRID, toBits). The server function computes a draw's cells from its strokes and passes
-- them as a bit string; SQL does bit arithmetic only. A draw's and a wash's cells are kept in their payloads (`cells`, 10,000 characters of 0 and 1), which is what lets rebuild_surface and the live list work from the
-- Acts alone. They are not counted in the 64 KiB a drawing is held to.
--
-- The live list. A draw stays live while it owns at least one cell. A wash stays live while some cell of it is inked by a live draw before it in the list (the draw's own cells) and is not covered by the live washes after it: it is
-- needed by a renderer that draws the live Acts in order, and by nothing else. A wash that uncovers no cell is written and never enters the list. (The plan's "owns a cell under the
-- wash's cells" cannot be read of the owners as they stand after the wash: the wash has just taken them. It is read of the draws' own cells. What a
-- wash took from each draw is read of the owners before it, under the lock, and kept in the wash as `uncovered` and `cut`.) Indices in `owners` are renumbered with `live` after a prune.
--
-- Bound on the live list. Every live wash is the last live wash over at least one cell (a later live wash that covers all of its cells replaces it), so the live washes each own a cell the others do not, and at most
-- 10,000 washes are live: the case where the author washes one cell at a time and each wash cuts a drawing that is still live. Only the post's own character writes a wash, so only the author's own washes, of one
-- cell or more each, can reach that bound; draws are held to 48 live. Every live wash leaves the list once the draws it cut do. The prune is linear in the live list (two passes, each live Act's cells read once), not quadratic: one wash write on a wall with 1,000 live washes takes about 26 ms
-- under the lock, measured on a laptop-class Postgres 16 (the 10,000-wash bound is the worst case and an author's own doing).
--
-- The limits. A draw is refused past the wall's limit in cells (`most`, which the server function computes from the instance's setting), with the wall's own figures in whole percents, and past the 48th live draw
-- (surfaces.most_live), counted after the draw has painted over what it covers, so painting over a tag is the way out of a full wall. A draw that adds no cell is never refused for the limit. A wash is never refused for
-- the limit or the live count. Both are checked under the row's lock, from the row's own cells, so the refusal is the same for everyone and reads nothing of who owns a character.
--
-- Ways out. A wall never closes; its way out is the author's wash, a reader's scrub on their own screen, and an admin's End this card (card_ended refuses every later draw and wash). A face-down draft that does not
-- fit when its back springs opens the wall bare and says so in the spring (`drawn: false`); the way out of that is a tag drawn on the open wall.
--
-- Privacy ("A response never proves a private fact"). Nothing here reads who owns a character except played_by (the caller's own mask) and the wash's author check, which compares characters, a public fact. A drawer is
-- never refused for being the post's own player's other mask. The answer to a write is the Act's public projection, its covered count and its live ids. Every pass costs one lock and one walk of 10,000 cells.
--
-- Export. surfaces and face_down_draws are tables in the public schema, so the export carries them as it carries every table (tools/instance-files.mjs); an imported surface is the stored row, which rebuild_surface
-- reproduces from the Acts. Broadcasts of a draw or a wash are the act function's (Task 3): every function here answers with the Act's projection for it to send.

-- ---------------------------------------------------------------------------------------------------------- 1. the kind ----

alter table card_kinds add column surface boolean not null default false;

-- ---------------------------------------------------------------------------------------- 2. the two Act kinds, and the row ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'announce', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept',
  'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash'));

-- Strokes as an array, the payload less its cells to 64 KiB as Postgres writes it, and the cells: 10,000 characters of 0 and 1.
alter table acts add constraint acts_surface_payload check (kind not in ('draw', 'wash') or (
  jsonb_typeof(payload -> 'strokes') = 'array' and octet_length((payload - 'cells' - 'uncovered' - 'cut')::text) <= 65536
  and jsonb_typeof(payload -> 'cells') = 'string' and char_length(payload ->> 'cells') = 10000 and (payload ->> 'cells') !~ '[^01]') is true);

-- The derived row of a surface play: what the next write and the next read need.
create table surfaces (
  play uuid primary key references acts (id),
  post uuid not null references acts (id),
  cover bit(10000) not null,
  owners smallint[] not null check (cardinality(owners) = 10000),   -- owners[i] = 1-based index into live of the draw that last inked cell i, 0 for none
  live uuid[] not null,                                            -- the live draws and washes, oldest first
  most_live smallint not null default 48 check (most_live >= 1),
  updated_at timestamptz not null default now()
);
create index surfaces_post on surfaces (post);
alter table surfaces enable row level security;
revoke all on surfaces from public, anon, authenticated;
grant select on surfaces to authenticated;
create policy read on surfaces for select to authenticated using (true);

-- A face-down surface card's draft: its first draw, kept private beside the back (face_down) and written into the wall when the back springs, then deleted. No player reads it; no policy and no grant.
create table face_down_draws (
  play uuid primary key references face_down (play),
  payload jsonb not null check (jsonb_typeof(payload -> 'strokes') = 'array' and octet_length(payload::text) <= 65536),
  cells bit(10000) not null,
  most integer not null check (most >= 0),
  most_live smallint not null default 48 check (most_live >= 1)
);
alter table face_down_draws enable row level security;
revoke all on face_down_draws from public, anon, authenticated;

create type surface_state as (live uuid[], owners smallint[], cover bit(10000));

-- acts_take_seq (0153), also leaving a draw and a wash out of the thread's seq. Everything else as 0153 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- acts_well_formed (0153), refusing a draw or a wash written other than by the surface functions, one that is not of a surface card's play in the play's thread, and a wash that is not by the post's character.
-- Everything else as 0153 wrote it.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through the game''s own moves' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card_end' and coalesce(current_setting('kayfabb.card_end_writer', true), '') <> 'on' then
    raise exception 'a card ends only through reverse_card' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('draw', 'wash') and coalesce(current_setting('kayfabb.surface_writer', true), '') <> 'on' then
    raise exception 'a draw or a wash is written only through draw_on_surface and wash_surface' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) and new.kind <> 'wash' then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'announce' then
    if new.payload ->> 'what' is distinct from 'debut' and new.payload ->> 'what' is distinct from 'turn' then
      raise exception 'an announcement is a debut or a Turn' using errcode = '23514';
    end if;
    if new.payload ->> 'what' = 'debut' and new.payload ? 'was' then
      raise exception 'a debut has no class it was' using errcode = '23514';
    end if;
  end if;
  if (new.kind = 'unmask' or (new.kind = 'announce' and new.payload ? 'class'))
     and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an % names the class its character holds', new.kind using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card_end' and (t.kind <> 'card' or t.thread <> new.thread) then
    raise exception 'a card_end is of a card play, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (t.kind <> 'post' or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A take-back is of a card set face down on the post it is on, by the one who set it, in the post's thread, while the back is live as of the take-back: not sprung, not taken back before (acts_one_take_back
  -- holds that), and not past its time. The card's own account is read from face_down, never named in the Act.
  if new.kind = 'take_back' and (t.kind <> 'post' or t.thread <> new.thread or not exists (
       select 1 from acts s join face_down f on f.play = s.id
       where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character and f.ends_at > new.created_at
         and not exists (select 1 from acts p where p.kind = 'spring' and (p.payload ->> 'set') = s.id::text))) then
    raise exception 'a take-back is of a live card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A gift is on a drive's opening play, in the play's thread: a card play whose card has a drive and whose payload names the play as its own drive. Whether the drive is still open and the amounts are donate's to say.
  if new.kind = 'donation' and (t.kind <> 'card' or t.thread <> new.thread or t.payload ->> 'drive' is distinct from t.id::text
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.drive is not null)) then
    raise exception 'a gift is to a drive, the first play of a drive card' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A draw or a wash is of a surface card's play that landed, in its thread; a wash is by the character that wrote the post under it.
  if new.kind in ('draw', 'wash') and (t.kind <> 'card' or t.thread <> new.thread or t.payload ? 'caught'
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.surface) or not exists (select 1 from surfaces s where s.play = t.id)) then
    raise exception 'a % is of a surface card''s play, in its thread', new.kind using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'wash' and new.character is distinct from (select p.character from acts p where p.id = t.target_act_id) then
    raise exception 'a wash is by the post''s own character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------------------------------------- 3. the step ----

-- surface_step: the one transition. A draw covers its cells and becomes the owner of each; a wash uncovers them and leaves them with no owner; the act joins the live list unless it is a wash that uncovered nothing;
-- then the list is pruned and renumbered. Pure over its arguments, but for the payload cells of the live Acts it reads (the new act's own come in as an argument, so the step can be taken before its Act is written, and
-- a refused draw writes nothing). Every write and rebuild_surface take it, so the stored row and a rebuilt one agree by construction. Called by the definer functions below alone.
create function surface_step(in_live uuid[], in_owners smallint[], in_cover bit(10000), in_kind text, in_act uuid, in_cells bit(10000)) returns surface_state
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  st surface_state;
  idx integer := coalesce(cardinality(in_live), 0) + 1;
  kept integer[];
  n integer;
  remap integer[];
  kinds text[];
  cs bit(10000)[];
  hit bit(10000)[];
  keep boolean[];
  owning integer[];
  zero constant bit(10000) := repeat('0', 10000)::bit(10000);
  seen bit(10000) := repeat('0', 10000)::bit(10000);
begin
  st.cover := case when in_kind = 'draw' then in_cover | in_cells else in_cover & ~in_cells end;
  st.owners := array(select case when get_bit(in_cells, u.i::integer - 1) = 0 then u.o when in_kind = 'draw' then idx::smallint else 0::smallint end
                     from unnest(in_owners) with ordinality u(o, i) order by u.i);
  st.live := case when in_kind = 'draw' or bit_count(in_cover & in_cells) > 0 then coalesce(in_live, '{}') || in_act else coalesce(in_live, '{}') end;
  n := cardinality(st.live);
  -- The prune, in two linear passes over the live list. The kind and cells of each live Act are read once (the new act's own come in as arguments). A draw is kept while it owns a cell. A wash is kept
  -- while some cell of it is inked by a kept draw before it and is not covered by the kept washes after it: pass one walks oldest to newest, keeping the union of the kept draws' cells, and notes for
  -- each wash which of its cells that union holds; pass two walks newest to oldest, keeping the union of the kept washes' cells, and keeps a wash that has a noted cell outside it.
  select array_agg(coalesce(a.kind, in_kind) order by u.ord), array_agg(case when u.id = in_act then in_cells else (a.payload ->> 'cells')::bit(10000) end order by u.ord)
    into kinds, cs
  from unnest(st.live) with ordinality u(id, ord) left join acts a on a.id = u.id;
  owning := array(select distinct o from unnest(st.owners) o where o <> 0);
  keep := array_fill(false, array[n]);
  hit := array_fill(zero, array[n]);
  for j in 1..n loop
    if kinds[j] = 'draw' then
      if j = any (owning) then keep[j] := true; seen := seen | cs[j]; end if;
    else
      hit[j] := seen & cs[j];
    end if;
  end loop;
  seen := zero;
  for j in reverse n..1 loop
    if kinds[j] = 'wash' and bit_count(hit[j] & ~seen) > 0 then keep[j] := true; seen := seen | cs[j]; end if;
  end loop;
  select array_agg(j order by j) into kept from generate_series(1, n) j where keep[j];
  kept := coalesce(kept, '{}');
  if cardinality(kept) <> n then
    remap := array_fill(0, array[n]);
    for j in 1..cardinality(kept) loop remap[kept[j]] := j; end loop;
    st.owners := array(select case when u.o = 0 then 0::smallint else remap[u.o]::smallint end from unnest(st.owners) with ordinality u(o, i) order by u.i);
    st.live := array(select st.live[kept[j]] from generate_series(1, cardinality(kept)) j order by j);
  end if;
  return st;
end $$;
revoke execute on function surface_step(uuid[], smallint[], bit, text, uuid, bit) from public, anon, authenticated, service_role;

-- open_surface(play, most_live): the row of an empty surface for a play of a surface card. place_cast and lay_sprung call it when the play lands, so a play and its wall land together. Nobody calls it from outside.
create function open_surface(play uuid, most_live integer default 48) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into surfaces (play, post, cover, owners, live, most_live, updated_at)
  select a.id, a.target_act_id, repeat('0', 10000)::bit(10000), array_fill(0::smallint, array[10000]), '{}', most_live, clock_timestamp()
  from acts a where a.id = open_surface.play and a.kind = 'card' and a.target_act_id is not null;
  if not found then raise exception 'a surface is opened for a card play on a post' using errcode = '23514'; end if;
end $$;
revoke execute on function open_surface(uuid, integer) from public, anon, authenticated, service_role;

-- The refusals every draw and wash share, in words true for every caller. A play that is over says so: an admin ended it, or its first generation failed and it was refunded (nothing of it is on the post).
create function surface_require_live(on_play uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from surfaces s where s.play = on_play) then
    raise exception 'there is no wall on that post' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = on_play) then
    raise exception 'an admin ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from card_write_refunds r where r.play = on_play) then
    raise exception 'That card didn''t take, so there is nothing of it on this post.' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;
revoke execute on function surface_require_live(uuid) from public, anon, authenticated, service_role;

-- A drawing is an object whose `strokes` are an array, at most 64 KiB as Postgres writes it (its cells, which the server computed, are not counted).
create function surface_check_payload(in_payload jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(in_payload) is distinct from 'object' or jsonb_typeof(in_payload -> 'strokes') is distinct from 'array' then
    raise exception 'a drawing holds its strokes as a list' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if octet_length((in_payload - 'cells' - 'uncovered' - 'cut')::text) > 65536 then raise exception 'a drawing is at most 64 KiB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
end $$;
revoke execute on function surface_check_payload(jsonb) from public, anon, authenticated, service_role;

-- surface_apply(play, character, kind, payload, cells, most): the lock, the limits and the Act. `most` is the wall's limit in cells (a draw's). The row is locked first, so the limit and the live count are read under it
-- and two draws cannot both pass; the step is taken before the Act is written, so a refused draw writes nothing. The answer is the Act's projection with `covered` (cells) and `live` (ids).
create function surface_apply(on_play uuid, by_character uuid, in_kind text, in_payload jsonb, in_cells bit(10000), most integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s surfaces%rowtype;
  st surface_state;
  written uuid := gen_random_uuid();
  in_thread uuid;
  at timestamptz;
  flag text;
  before_cells integer;
  after_cells integer;
  wash_cut jsonb;
  wash_cells integer;
begin
  select * into s from surfaces x where x.play = on_play for update;
  if not found then raise exception 'there is no wall on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- An admin's End this card can commit between the caller's early check and the lock: the card is read again here, under the lock, and a draw or a wash that waited for it is refused.
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = on_play) then
    raise exception 'an admin ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Read after the lock, so the Acts' created_at order is the order the lock was taken in, which is the order rebuild_surface replays them in.
  at := clock_timestamp();
  st := surface_step(s.live, s.owners, s.cover, in_kind, written, in_cells);
  if in_kind = 'draw' then
    before_cells := bit_count(s.cover);
    after_cells := bit_count(st.cover);
    if after_cells > most and after_cells > before_cells then
      raise exception '%', format('this wall is %s%% covered, and its limit is %s%%; this tag would take it to %s%%', floor(before_cells / 100.0)::integer, floor(most / 100.0)::integer, ceil(after_cells / 100.0)::integer)
        using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select count(distinct o) from unnest(st.owners) o where o <> 0) > s.most_live then
      raise exception 'this wall holds % tags; paint over one or wait for a wash', s.most_live using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  select a.thread into in_thread from acts a where a.id = on_play;
  flag := coalesce(current_setting('kayfabb.surface_writer', true), '');
  perform set_config('kayfabb.surface_writer', 'on', true);
  -- A wash records what it uncovered and which draws it cut, with the cells of each it took, read from the owners the lock holds: the figures the log says it in (my_draws, my_walls_drawn_on) without replaying the wall.
  -- They are the server's: a payload that arrives carrying the keys loses them, and the drawer's 64 KiB bound leaves them out as it leaves out `cells`.
  if in_kind = 'wash' then
    select coalesce(jsonb_agg(jsonb_build_object('draw', x.draw, 'took', x.n) order by x.first), '[]'::jsonb), coalesce(sum(x.n), 0)::integer into wash_cut, wash_cells
    from (select s.live[s.owners[g.i]] as draw, count(*) as n, min(g.i) as first
          from generate_series(1, 10000) g(i) where get_bit(in_cells, g.i - 1) = 1 and s.owners[g.i] <> 0 group by 1) x;
  end if;
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at)
  values (written, by_character, in_kind, in_thread, on_play, (in_payload - 'cells' - 'uncovered' - 'cut') || jsonb_build_object('cells', in_cells::text)
    || case when in_kind = 'wash' then jsonb_build_object('uncovered', wash_cells, 'cut', wash_cut) else '{}'::jsonb end, at);
  perform set_config('kayfabb.surface_writer', flag, true);
  update surfaces set cover = st.cover, owners = st.owners, live = st.live, updated_at = at where play = on_play;
  return (act_projection(written) #- '{payload,cells}' #- '{current_payload,cells}') || jsonb_build_object('covered', bit_count(st.cover), 'live', to_jsonb(st.live));
end $$;
revoke execute on function surface_apply(uuid, uuid, text, jsonb, bit, integer) from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------------------------------- 4. draws and washes ----

-- draw_on_surface(who, through, play, payload, cells, most): the account `who`, through its character `through`, adds a drawing to a surface. In order: the player plays that character; it is not banned; not barred from
-- the post's board; the play is a live surface (not ended); then the lock, the limit (`most`, in cells, from the instance's setting, with the wall's own figures) and the 48th live draw. None of these reads who owns the
-- post or any other character. Called by the Edge Function with the service key; no API role executes it.
create function draw_on_surface(who uuid, through uuid, play uuid, payload jsonb, cells bit(10000), most integer) returns jsonb
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
  perform surface_check_payload(payload);
  return surface_apply(play, through, 'draw', payload, cells, most);
end $$;
revoke execute on function draw_on_surface(uuid, uuid, uuid, jsonb, bit, integer) from public, anon, authenticated;
grant execute on function draw_on_surface(uuid, uuid, uuid, jsonb, bit, integer) to service_role;

-- wash_surface(who, through, play, payload, cells): the post's own character takes ink off. `through` is the post's character, owned by `who`; a retired author may still wash, as save_effect_state lets a retired
-- author save (0038, 0149). Then not_banned, the live play, the lock, the uncovering and the prune. A wash is never refused for the limit or the live count.
create function wash_surface(who uuid, through uuid, play uuid, payload jsonb, cells bit(10000)) returns jsonb
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
  perform surface_check_payload(payload);
  return surface_apply(play, through, 'wash', payload, cells, 0);
end $$;
revoke execute on function wash_surface(uuid, uuid, uuid, jsonb, bit) from public, anon, authenticated;
grant execute on function wash_surface(uuid, uuid, uuid, jsonb, bit) to service_role;

-- staff_draw_on_surface(staff_key, play, payload, cells, most): a persona's drawing on an open wall, with the persona checks staff_play_card makes: a persona, and not waiting or benched.
create function staff_draw_on_surface(staff_key text, play uuid, payload jsonb, cells bit(10000), most integer) returns jsonb
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
  perform surface_check_payload(payload);
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  answered := surface_apply(play, who, 'draw', payload, cells, most);
  perform set_config('kayfabb.staff_writer', flag, true);
  return answered;
end $$;
revoke execute on function staff_draw_on_surface(text, uuid, jsonb, bit, integer) from public, anon, authenticated;
grant execute on function staff_draw_on_surface(text, uuid, jsonb, bit, integer) to service_role;

-- play_surface_card: play_card's arguments, plus the caster's first drawing (`first`, its cells, the wall's limit in cells and the most live draws it holds). It calls play_card, then draw_on_surface as the caster,
-- in one transaction: a refused draw undoes the play, its price and its card. A play a back caught never landed and has no wall, so it draws nothing and answers as play_card does.
create function play_surface_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text, reach text, from_post uuid, version uuid, tokens integer,
                                  first jsonb, first_cells bit(10000), most integer, most_live integer) returns jsonb
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
  return played || jsonb_build_object('draw', draw_on_surface(who, through, written, first, first_cells, most));
end $$;
revoke execute on function play_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, jsonb, bit, integer, integer) from public, anon, authenticated;
grant execute on function play_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, jsonb, bit, integer, integer) to service_role;

-- staff_play_surface_card: staff_play_card's arguments, plus the persona's first drawing; one transaction around staff_play_card and staff_draw_on_surface.
create function staff_play_surface_card(staff_key text, card text, target uuid, config jsonb, message text, pool_day date, tokens integer,
                                        first jsonb, first_cells bit(10000), most integer, most_live integer) returns jsonb
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
  return played || jsonb_build_object('draw', staff_draw_on_surface(staff_key, written, first, first_cells, most));
end $$;
revoke execute on function staff_play_surface_card(text, text, uuid, jsonb, text, date, integer, jsonb, bit, integer, integer) from public, anon, authenticated;
grant execute on function staff_play_surface_card(text, text, uuid, jsonb, text, date, integer, jsonb, bit, integer, integer) to service_role;

-- set_surface_card: set_card's arguments, plus the draft (the setter's first drawing, its cells, the wall's limit in cells and the most live draws), kept in face_down_draws beside the back. A face-down card's
-- configuration is private and held to 4 KB, and a drawing can be far larger, so the draft is a row of its own that no player reads; lay_sprung writes it into the wall as the first draw when the back springs.
create function set_surface_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, catches text, phrase text, passage text, named uuid[], who_except boolean,
                                 draft jsonb, draft_cells bit(10000), most integer, most_live integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  set_made jsonb;
begin
  if not coalesce((select k.surface from card_kinds k where k.key = set_surface_card.card), false) then
    raise exception 'that card has no surface to draw on' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform surface_check_payload(draft);
  -- A back that ran out writes no Act, so nothing ends its draft; each surface card set sweeps the drafts of backs over for at least a minute, which nobody can read or spring (a back that ran out a moment ago may still be read by a spring in flight, so it keeps its draft that long).
  delete from face_down_draws d using face_down f where f.play = d.play and f.ends_at <= now() - interval '1 minute';
  set_made := set_card(who, card, through, target, config, price, catches, phrase, passage, named, who_except);
  insert into face_down_draws (play, payload, cells, most, most_live)
  values ((set_made ->> 'id')::uuid, draft - 'cells', draft_cells, most, coalesce(set_surface_card.most_live, 48));
  return set_made;
end $$;
revoke execute on function set_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, text, uuid[], boolean, jsonb, bit, integer, integer) from public, anon, authenticated;
grant execute on function set_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, text, uuid[], boolean, jsonb, bit, integer, integer) to service_role;

-- take_back (0148), also deleting the back's draft, if it holds one. Everything else as 0148 wrote it.
create or replace function take_back(who uuid, through uuid, set_act uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_post uuid;
  fd face_down%rowtype;
  author uuid;
  written uuid;
  nothing constant text := 'there is no face-down card to take back there';
begin
  perform played_by(through, take_back.who);
  perform not_banned(through);
  -- 1. The account's row, as set_card takes it.
  perform 1 from accounts a0 where a0.id = take_back.who for no key update;
  -- The caller's own back, found without a lock; anything else is no back to them, and takes no more.
  select f.post into on_post from face_down f where f.play = take_back.set_act and f.account = take_back.who;
  if on_post is not null then
    -- 2. The post's row, as set_card takes it, then 3. the back's, as a spring does; read again under the lock, so a spring or a take-back that landed while this waited is seen.
    perform 1 from acts a where a.id = on_post for no key update;
    select f.* into fd from face_down f where f.play = take_back.set_act for update;
    select a.character into author from acts a where a.id = take_back.set_act;
  end if;
  -- A set Act that is not the caller's own back, by the character the caller acts through.
  if on_post is null or author is distinct from through then
    raise exception '%', nothing using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  -- A back already sprung, taken back or past its time.
  if fd.ends_at <= now()
     or exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text)
     or exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = fd.play::text) then
    raise exception '%', nothing using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (author, 'take_back', fd.thread, fd.post, jsonb_build_object('set', fd.play::text)) returning id into written;
  insert into card_ledger (account, card, kind, act, price) values (take_back.who, fd.card, 'returned', written, 0);
  -- A surface card's draft goes with the back: nothing can spring it now.
  delete from face_down_draws d where d.play = fd.play;
  return act_projection(written);
end $$;
revoke execute on function take_back(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function take_back(uuid, uuid, uuid) to service_role;

-- Whether a back's draft fits the wall it will land on, which opens bare: its cells within its limit. Null for a back with no draft. spring_traps writes it into the spring before lay_sprung lays the card.
create function surface_draft_fits(set_play uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select bit_count(d.cells) <= d.most from face_down_draws d where d.play = set_play
$$;
revoke execute on function surface_draft_fits(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------ the pool's reads ----

-- The pool's persona reads the live walls on the page it reads, and a wall it draws on is its card for the day. The digest role (0045) reads the public play of a surface and nothing of an owner: the play and
-- the post it is on (never the cover, the owners or the live list), and the end of a play that did not take.
grant select (play, post) on surfaces to kayfabb_digest;
create policy digest_reads on surfaces for select to kayfabb_digest using (true);
grant select (play) on card_write_refunds to kayfabb_digest;
create policy digest_reads on card_write_refunds for select to kayfabb_digest using (true);

-- pool_thread (0127), also carrying `walls`: the live surface plays on the posts the read returns (an ended play, or one that did not take, is left out), each {play, card, about}, oldest first. `about` is plain
-- words about the post it is on, its author's name and its number, both public. Nothing here is computed from who owns a character or from what is drawn.
create or replace function pool_thread(in_thread uuid, most integer, chars integer, also uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with page as (
    select a.id, a.seq, a.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
           left(coalesce(a.current_payload ->> 'body', ''), greatest(chars, 1)) as body
    from acts_public a join characters_public c on c.id = a.character
    where a.thread = in_thread and a.kind = 'post'
      and (a.id = also or a.id in (select n.id from acts_public n where n.thread = in_thread and n.kind = 'post'
                                   order by n.created_at desc, n.id desc limit greatest(most, 0)))
  )
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('act', p.id, 'name', p.name, 'pronouns', p.pronouns, 'body', p.body) order by p.created_at, p.id) from page p), '[]'::jsonb),
    'walls', coalesce((select jsonb_agg(jsonb_build_object('play', k.id, 'card', k.payload ->> 'card',
                                                           'about', 'a post by ' || p.name || coalesce(' (#' || p.seq || ')', '')) order by p.created_at, p.id, k.id)
                       from page p join surfaces s on s.post = p.id join acts_public k on k.id = s.play
                       where not exists (select 1 from acts_public e where e.kind = 'card_end' and e.target_act_id = k.id)
                         and not exists (select 1 from card_write_refunds r where r.play = k.id)), '[]'::jsonb))
$$;

-- pool_orphans (0089), the tie of a card also taking a persona's wall draw: a draw by the persona that carries the day's `pool` in its payload (the Edge Function puts it there, as the card doors merge it into a
-- card Act's) is the post's card, on any wall; no spend names it. Everything else as 0089 wrote it.
create or replace function pool_orphans(through date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', o.staff, 'day', o.day, 'act', o.id, 'startedThread', o.seq = 1,
    'card', (select k.id from acts k
             where k.character = o.character
               and ((k.kind = 'set' and k.target_act_id = o.id)
                    or (k.kind = 'card' and k.payload ->> 'pool' = o.day and o.target_act_id is not null and k.target_act_id = o.target_act_id)
                    or (k.kind = 'draw' and k.payload ->> 'pool' = o.day))
               and not exists (select 1 from pool_spends s where s.card_act = k.id)
             order by k.created_at, k.id limit 1)) order by o.day, o.staff), '[]'::jsonb)
  from (select distinct on (c.staff, a.payload ->> 'pool') c.staff, a.payload ->> 'pool' as day, a.id, a.seq, a.character, a.target_act_id
        from acts a join characters c on c.id = a.character
        where c.staff is not null and a.kind = 'post' and a.payload ->> 'pool' ~ '^\d{4}-\d{2}-\d{2}$'
          and (a.payload ->> 'pool')::date between date_trunc('week', through::timestamp)::date and through
          and not exists (select 1 from pool_spends s where s.post_act = a.id)
        order by c.staff, a.payload ->> 'pool', a.created_at, a.id) o
$$;

-- record_pool_spend (0089): the spend's card may also be a wall draw of the persona's.
create or replace function record_pool_spend(on_day date, of_staff text, by_trigger text, post uuid, card uuid, started boolean, note jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  made bigint;
begin
  select c.id into who from characters c where c.staff = of_staff and c.staff_kind = 'persona';
  if who is null then raise exception 'there is no persona "%"', of_staff using errcode = 'P0002'; end if;
  if not exists (select 1 from acts a where a.id = post and a.character = who and a.kind = 'post') then
    raise exception 'the spend''s post is not a post of %', of_staff using errcode = '22023';
  end if;
  if card is not null and not exists (select 1 from acts a where a.id = card and a.character = who and a.kind in ('card', 'set', 'draw')) then
    raise exception 'the spend''s card is not a card of %', of_staff using errcode = '22023';
  end if;
  insert into pool_spends (day, staff, trigger, post_act, card_act, started_thread, record)
  values (on_day, of_staff, by_trigger, post, card, coalesce(started, false), coalesce(note, '{}'::jsonb))
  on conflict (day, staff) do nothing returning id into made;
  if made is null then return jsonb_build_object('status', 'already'); end if;
  return jsonb_build_object('status', 'spent', 'id', made);
end $$;

-- ------------------------------------------------------------------------------------------------------------ 5. readers ----

-- surface_acts(play): the live Acts of a surface, oldest first, each as acts_public shows it, a draw with its `share` of the wall (the cells it owns now) and a wash with none, and the count of the draws that are no
-- longer live (`older`), for the Lens, which lists every drawing the log names. Public Acts and the row's counts: a security invoker read, as thread_page is.
create function surface_acts(play uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select case when s.play is null then null else jsonb_build_object(
    'covered', bit_count(s.cover),
    'acts', coalesce((select jsonb_agg((to_jsonb(a) #- '{payload,cells}' #- '{current_payload,cells}') || case when a.kind = 'draw' then jsonb_build_object('share', coalesce(sh.n, 0)) else '{}'::jsonb end order by u.ord)
                      from unnest(s.live) with ordinality u(id, ord) join acts_public a on a.id = u.id
                      left join (select o.o, count(*) as n from unnest(s.owners) o(o) where o.o <> 0 group by o.o) sh on sh.o = u.ord), '[]'::jsonb),
    'older', (select count(*) from acts_public d where d.target_act_id = s.play and d.kind = 'draw' and d.id <> all (s.live))) end
  from (select 1) x left join surfaces s on s.play = surface_acts.play
$$;
revoke execute on function surface_acts(uuid) from public, anon;
grant execute on function surface_acts(uuid) to authenticated;

-- rebuild_surface(play): the surface's row computed from the play's Acts alone, in the order they were written, by the same step every write takes. For the tests, and for a repair or an import that wants the row
-- from the Acts. It writes nothing and answers the row; the limit on live draws is the stored row's, or the default.
create function rebuild_surface(play uuid) returns surfaces
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s surfaces%rowtype;
  st surface_state;
  r record;
  stored surfaces%rowtype;
begin
  select * into stored from surfaces x where x.play = rebuild_surface.play;
  s.play := rebuild_surface.play;
  s.post := coalesce(stored.post, (select a.target_act_id from acts a where a.id = rebuild_surface.play and a.kind = 'card'));
  if s.post is null then raise exception 'a surface is a card play on a post' using errcode = 'P0002'; end if;
  s.most_live := coalesce(stored.most_live, 48);
  s.updated_at := coalesce(stored.updated_at, now());
  st.live := '{}';
  st.owners := array_fill(0::smallint, array[10000]);
  st.cover := repeat('0', 10000)::bit(10000);
  for r in select a.id, a.kind, (a.payload ->> 'cells')::bit(10000) as cells, a.created_at from acts a
           where a.target_act_id = rebuild_surface.play and a.kind in ('draw', 'wash') order by a.created_at, a.id loop
    st := surface_step(st.live, st.owners, st.cover, r.kind, r.id, r.cells);
    s.updated_at := r.created_at;
  end loop;
  s.cover := st.cover;
  s.owners := st.owners;
  s.live := st.live;
  return s;
end $$;
revoke execute on function rebuild_surface(uuid) from public, anon, authenticated;
grant execute on function rebuild_surface(uuid) to service_role;

-- --------------------------------------------------------------------------------------------- 6. the redefined functions ----

-- place_cast (0153), opening the surface of a play whose card is a surface card, with the play: the same transaction, so a play and its wall land together. A play a back caught never landed, and opens none; a ride
-- back lets the play land, and does. Everything else as 0153 wrote it.
create or replace function place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_kind text;
  author uuid;
  in_thread uuid;
  on_post uuid := target;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded text;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
  target_name text;
  staff_caster boolean;
  drive_id uuid;
  drive_up integer;
  quad text;
  w_why text;
  w_opens timestamptz;
  w_closes timestamptz;
  last_settled timestamptz;
  rode boolean := false;
begin
  select c.staff is not null into staff_caster from characters c where c.id = caster;
  if staff_caster is null then raise exception 'there is no such character' using errcode = 'P0002'; end if;
  -- Nobody pays for a staff character's card, and a player's is always paid for: the two must agree before anything is written.
  if staff_caster is distinct from (payer is null) then
    raise exception 'a staff character''s card is paid by no one, and a player''s by its player' using errcode = '22023';
  end if;
  if payer is null and coalesce(price, 0) <> 0 then raise exception 'a staff character''s card costs nothing' using errcode = '22023'; end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select * into kind_of from card_kinds k where k.key = place_cast.card;
  if kind_of.key is null then raise exception 'there is no such card' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if kind_of.play = 'set' then raise exception '% is set face down on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if kind_of.play not in ('cast', 'use') then raise exception '% is not played on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not (reach = any (kind_of.reaches)) then
    raise exception 'this card lands on %', reach_list(kind_of.reaches) using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A Gimmick never goes on a board, whatever its card lists (the catalog check refuses a card that lists one).
  if kind_of.play = 'use' and reach = 'board' then
    raise exception '% is never used on a board', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- A live ward Gimmick on the post turns away a cast its rarity, flavor or name covers, in the same words for everyone (cards.ts's wardWords).
    if kind_of.play = 'cast' then
      warded := ward_refusal('post', target, kind_of);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
    end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    -- A skim card names the reaction quadrant it skims, one of the four, in its configuration.
    quad := coalesce(config, '{}') ->> 'quadrant';
    if kind_of.skim is not null and not coalesce(quad = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
      raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post';
    -- A drive card's stack is counted in the post's open drive only: the drive whose latest play, plus the card's `lasts`, is still ahead. A play joins it, or opens a drive of its own id.
    if kind_of.drive is not null then
      select d.drive, count(*) into drive_id, drive_up from drive_plays(target, card) d
      group by d.drive having max(d.created_at) + span_interval(kind_of.drive -> 'lasts') > now()
      order by max(d.created_at) desc limit 1;
      if drive_id is null then
        drive_id := written;
        up := 0;
      else
        up := drive_up;
        if up >= kind_of.stack then raise exception 'this post''s drive already carries % appeals', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      end if;
    end if;
    if kind_of.skim is not null then
      -- A skim card's stack is one live play of it per quadrant on the post (the plays still up, as above), whatever the card's `stack` says.
      select count(*) into up from acts k
      where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
        and coalesce(k.payload ->> 'reach', 'post') = 'post' and k.payload #>> '{config,quadrant}' = quad
        and (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id);
      if up >= 1 then raise exception 'this post already carries that card for that quadrant' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    elsif up >= kind_of.stack then
      if kind_of.surface then raise exception 'This post is already a wall. Draw on it instead.' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    if kind_of.play = 'cast' then
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it; a ride back lets it land and is paid by its votes (`did` is
      -- rode). Nothing pays out here, so spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      sprung := spring_traps('cast', target, written, card, actor => payer);
      rode := sprung is not null and sprung -> 'payload' ->> 'did' = 'rode';
    end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select c.name into target_name from characters c where c.id = target;
      select a.thread into in_thread from acts_public a where a.id = from_post and a.kind = 'post' and a.character = target;
      if in_thread is null then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from caster then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.title into target_name from threads t where t.id = target;
      in_thread := target;
      select a.id, a.character into on_post, author from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      -- A Gimmick on a thread is a match stipulation, so only on a thread the caster's own character started. Who started a thread is public, and the refusal says nothing of anyone else's.
      if kind_of.play = 'use' and author is distinct from caster then
        raise exception '% is used on a thread your own character started', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    else
      perform 1 from boards b where b.id = target for no key update;
      if not found then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select b.name into target_name from boards_now b where b.id = target;
      select t.id into in_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
      if in_thread is null then
        raise exception 'there is no announcements thread to play a board card in yet' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
      on_post := null;
      -- One board card at a time, of any card.
      select max(r.ends_at) into live_board from play_reach r where r.board = target and r.ends_at > now() and not card_ended(r.play);
      if live_board is not null then
        raise exception 'this board already carries a board card until %', refusal_time(live_board) using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- A scored-as card on a character names a class the instance has and a window that can be named, once for the character in that window. The window is public (settlements, seasons, settings).
    if kind_of.scores_as then
      if not exists (select 1 from class_kinds ck where ck.key = coalesce(config, '{}') ->> 'class') then
        raise exception 'there is no such class' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      select w.opens, w.closes, w.why into w_opens, w_closes, w_why from scored_as_window(now()) w;
      if w_why is not null then raise exception '%', w_why using hint = 'kayfabb.refusal', errcode = '55000'; end if;
      select max(x.ends_at) into last_settled from settlements x;
      if exists (select 1 from play_reach r join acts k on k.id = r.play join card_kinds sk on sk.key = k.payload ->> 'card'
                 where r.character = target and sk.scores_as and k.created_at >= last_settled and not card_ended(k.id)) then
        raise exception 'this character already has a class named for the window after the next settlement' using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- A live ward Gimmick on the character, thread or board turns away a cast its rarity, flavor or name covers, on its own target only.
    if kind_of.play = 'cast' then
      warded := ward_refusal(reach, target, kind_of);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
    end if;
    select count(*) into up from play_reach r join acts k on k.id = r.play
    where r.ends_at > now() and not card_ended(r.play) and k.payload ->> 'card' = card
      and case place_cast.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
    if up >= kind_of.stack then
      where_words := 'this ' || reach;
      if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
    -- A scored-as play lasts until its window closes, not a time from now.
    if kind_of.scores_as then ends := w_closes; end if;
  end if;

  -- A card that needs words refuses a blank message in its own words, after the landing's refusals as the engine says them (decided, engine/rules/cards.ts); the message is trimmed as casterMessage trims it.
  if kind_of.needs_message is not null and btrim(said, E' \t\r\n\f\v') = '' then
    raise exception '%', kind_of.needs_message using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', (case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end) - case when kind_of.draws is not null then array['drawn'] else '{}'::text[] end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name)
              when sprung is not null and not rode then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      || case when reach = 'post' and (kind_of.play = 'use' or kind_of.skim is not null) and kind_of.lasts is not null then jsonb_build_object('ends', now() + kind_of.lasts) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  if kind_of.surface and reach = 'post' and (sprung is null or rode) then perform open_surface(written); end if;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- A card Cast at thread reach talks down the open visits on the thread whose Mod a distraction moves (0108), once for each, as this caster's attempt.
  if reach = 'thread' and not staff_caster then perform distract_visits(caster, target, written); end if;
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  -- A caught cast tells its caster, as a card landed from a back tells the struck: a trapStruck on the caught play, naming nothing but the play (the spring names the setter's
  -- character). The setter's account is the alert's actor only so that a player's cast on their own other mask's Trap Card tells nobody; the alert reads no owner into any answer.
  if sprung is not null then
    perform write_alert(caster, 'trapStruck', null, written, (select f.account from face_down f where f.play = (sprung -> 'payload' ->> 'set')::uuid));
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;

-- card_target (0153), each effect of a surface card's play carrying the surface's `covered` (cells), so the rules see it as they see a drive's `closes`. card_target_reach (0055) returns it for a post as it is.
-- Everything else as 0153 wrote it.
create or replace function card_target(target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'gimmick', ck.gimmick, 'ends', k.payload ->> 'ends', 'drive', dp.drive,
          'covered', case when ck.surface then (select bit_count(sf.cover) from surfaces sf where sf.play = k.id) end, 'closes', to_jsonb(dp.closes),
          'quadrant', case when ck.skim is not null then k.payload #>> '{config,quadrant}' end)) as effect
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
  from acts_public a where a.id = target
$$;

-- thread_page (0149), also returning `surfaces`: for each surface play among the page's plays, its covered cells (a count) and its live Acts' ids. Never a stroke, a cell or an owner. Everything else as 0149 wrote it.
create or replace function thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  -- The refusal, before anything is read.
  select case when coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) is null
                or coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) not between 1 and 100
              then screen_refusal('a page holds 1 to 100 posts') end;

  with pp as materialized (
    select coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) as n
  ),
  s as materialized (
    select o.*, greatest(1, ceil(o.last_seq::numeric / (select pp.n from pp)))::integer as last_page
    from thread_open o where o.id = thread_page.in_thread
  ),
  pg as materialized (
    select s.*,
           least(s.last_page, greatest(1, coalesce(case when thread_page.in_seq is not null then greatest(1, ceil(thread_page.in_seq::numeric / (select pp.n from pp)))::integer end,
                                                   thread_page.in_page, 1))) as page
    from s
  ),
  rng as materialized (
    select pg.*, (pg.page - 1) * (select pp.n from pp) + 1 as first_seq, pg.page * (select pp.n from pp) as end_seq from pg
  ),
  page_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
  ),
  posts as materialized (select a.id, a.character from page_acts a where a.kind = 'post'),
  -- At most PLAYS_PER_POST layers a post, oldest first.
  on_posts as materialized (
    select l.* from (
      select a.*, row_number() over (partition by a.target_act_id order by a.created_at, a.id) as n
      from acts_public a where a.kind in ('card', 'set', 'spring') and a.target_act_id in (select p.id from posts p)
    ) l where l.n <= 8
  ),
  -- An admin's end of each of those plays (0092), as cardsOnMany answers it beside them: the client marks a play reversed only from
  -- its card_end (engine/ui/cards/plays.ts), so a page without it would draw an ended effect over its post. One per play at most.
  ends_on_posts as materialized (
    select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select o.id from on_posts o)
  ),
  above as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act
    from effects_above(array(select distinct p.character from posts p where p.character is not null), (select rng.id from rng), (select rng.board from rng)) x
  ),
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
  ),
  -- Each of the page's posts' latest visit (0105), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select a.id from page_acts a where a.kind in ('post', 'spin'))
    order by v.target_act_id, v.created_at desc, v.id desc
  ),
  ids as materialized (select a.id from page_acts a union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select p.character from played p union select v.character from vis v) w where c is not null
  ),
  wanted_plays as materialized (select p.id from played p where p.card = any (coalesce(thread_page.effect_cards, '{}'))),
  spun as materialized (
    select l.* from (
      select t.*, row_number() over (partition by t.origin_act_id order by t.created_at, t.id) as n
      from thread_list t where t.origin_act_id in (select i.id from ids i)
    ) l where l.n <= 200
  )
  select case when not exists (select 1 from rng) then null else jsonb_build_object(
    'summary', (select to_jsonb(s) - 'last_page' from s),
    'page', (select rng.page from rng),
    'acts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.seq), '[]'::jsonb) from page_acts a),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
          'warn_points', c.warn_points, 'banned_until', c.banned_until, 'group', c."group"),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns)
                    from character_profiles p where p.character = c.id),
        'posts', coalesce((select n.posts from character_post_counts n where n.character = c.id), 0),
        'standing', coalesce((select st.standing from current_standings st where st.character = c.id), 0),
        'reveals', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'character', r.character, 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread)
                      order by r.at, r.act), '[]'::jsonb) from class_reveals r where r.character = c.id),
        'turns', (select coalesce(jsonb_agg(jsonb_build_object('act', u.act, 'character', u.character, 'at', u.at, 'was', u.was) order by u.at, u.act), '[]'::jsonb)
                  from turns_announced u where u.character = c.id)
      ) order by c.id), '[]'::jsonb)
      from characters_public c where c.id in (select w.c from who w)),
    'plays', (select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) from (
                select to_jsonb(o) - 'n' as j, o.created_at, o.id from on_posts o
                union all
                select to_jsonb(e), e.created_at, e.id from ends_on_posts e
              ) x),
    'above', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from above x),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object(
        'visit', v.id, 'post', v.post, 'mod', v.character, 'at', v.created_at, 'ends_at', v.payload -> 'ends_at', 'line', v.payload -> 'line',
        'charges', (v.payload -> 'charges') || coalesce((select jsonb_agg(j.payload -> 'charge' order by j.created_at, j.id) from acts_public j where j.kind = 'visit_join' and j.target_act_id = v.id), '[]'::jsonb),
        'challenge', jsonb_strip_nulls(jsonb_build_object('kind', v.payload #>> '{challenge,kind}', 'question_index', v.payload #> '{challenge,question_index}', 'price', v.payload #> '{challenge,price}'))
          || coalesce(visit_quiz(v.id), '{}'::jsonb),
        'end', (select jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', e.payload ->> 'outcome', 'by_act', e.payload -> 'by_act', 'line', e.payload -> 'line')
                from acts_public e where e.kind = 'visit_end' and e.target_act_id = v.id limit 1),
        -- Read through acts_public as the rest of the page is (e2e/0016 holds a screen to the public projections).
        'ruling', (select r.payload ->> 'verdict' from acts_public i
                   join acts_public ap on ap.kind = 'appeal' and ap.target_act_id = i.id
                   join acts_public r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                   where i.kind = 'infraction' and i.payload ->> 'visit_act' = v.id::text limit 1)
      ) order by v.created_at, v.id), '[]'::jsonb) from vis v),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
    'surfaces', (select coalesce(jsonb_object_agg(sf.play::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb)
                 from surfaces sf where sf.play in (select o.id from on_posts o where o.kind = 'card')),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select i.id from ids i)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m.character)), '[]'::jsonb)
             from my_reactions m where m.act in (select i.id from ids i)),
    'spun', (select coalesce(jsonb_agg(to_jsonb(l) - 'n' order by l.created_at, l.id), '[]'::jsonb) from spun l),
    'reading', (select r.furthest_seq from reading r where r.thread = thread_page.in_thread limit 1),
    'board', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act)
              from boards_now b where b.id = (select rng.board from rng)),
    'following', following_thread(thread_page.in_thread),
    'presence', presence_box('thread', thread_page.in_thread),
    'unread', my_alerts_unread()
  ) end;
end;

-- lay_sprung (0151), opening a surface card's wall when the card lands from a back, and writing the back's draft as the wall's first draw, by the setter, if it fits the limit as it stands then; otherwise the wall opens
-- bare (spring_traps said `drawn: false` in the spring). The draft row is deleted once read. Everything else as 0151 wrote it.
create or replace function lay_sprung(setter uuid, card text, config jsonb, target uuid, reach text, spring uuid, from_post uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
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
    select t.id into in_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
    on_post := null;
  end if;
  if reach <> 'post' then
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
    if kind_of.scores_as then
      select w.opens, w.closes into w_opens, w_closes from scored_as_window(now()) w;
      ends := w_closes;
    end if;
  elsif kind_of.skim is not null and kind_of.lasts is not null then
    ends := now() + kind_of.lasts;
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if staff_setter then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (id, character, kind, thread, target_act_id, payload)
  values (written, setter, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', '',
    'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end, 'spring', spring::text)
    || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name) else jsonb_build_object('layer', layer) end
    || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) when kind_of.skim is not null then jsonb_build_object('ends', ends) else '{}'::jsonb end
    || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end);
  if staff_setter then perform set_config('kayfabb.staff_writer', flag, true); end if;
  if kind_of.surface and reach = 'post' then
    select d.* into draft from face_down_draws d where d.play = (select (s.payload ->> 'set')::uuid from acts s where s.id = lay_sprung.spring);
    perform open_surface(written, coalesce(draft.most_live, 48));
    if draft.play is not null then
      if bit_count(draft.cells) <= draft.most then perform surface_apply(written, setter, 'draw', draft.payload, draft.cells, draft.most); end if;
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
end $$;
revoke execute on function lay_sprung(uuid, text, jsonb, uuid, text, uuid, uuid) from public, anon, authenticated, service_role;

-- spring_traps (0151), a surface card's spring saying whether the back's draft was drawn (`drawn`, false when it did not fit the limit and the wall opened bare). Everything else as 0151 wrote it.
create or replace function spring_traps(trigger text, post uuid, by_act uuid, incoming_card text default null, held uuid[] default null, actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  f spring_facts;
  back_trigger text;
  springs boolean;
  lands boolean;
  did text;
  sprung uuid;
  laid uuid;
  flag text;
  held_when jsonb;
begin
  select x.* into fd from face_down x
  where x.post = spring_traps.post and x.ends_at > now() and (held is null or x.play = any (held))
    and not exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = x.play::text)
  order by x.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  if exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = fd.play::text) then return null; end if;
  -- The same reads for every back, before anything is decided.
  f := spring_facts(fd, trigger, by_act, incoming_card);
  -- The decision, from the locals. A Move springs on a quote that meets every condition its back holds; a Gimmick on its own trigger, or never (a Bluff).
  back_trigger := case f.kind_play when 'cast' then 'quote' else f.kind_trap #>> '{trigger,on}' end;
  springs := back_trigger is not distinct from trigger
    and case trigger when 'quote' then (fd.phrase is null or f.phrase_hit) and (fd.passage is null or f.passage_hit) and (fd.who is null or f.who_hit <> fd.who_except)
                     when 'cast' then f.caught when 'visit' then true else false end;
  -- A Move lands on what quoted it, at its first reach, if it can: its stack there has room, a board has no live card, the thread has its first post and a board card its thread.
  -- A skim card's stack is one live play per quadrant (its quadrant is a quadrant and free); a scored-as card lands only when its class is one, its window can be named and has no other.
  lands := coalesce(f.by_kind = 'post' and case f.reach
      when 'post' then case when f.kind_skim then f.quadrant_ok and f.quadrant_up = 0 else f.up < f.kind_stack end and not f.warded
      when 'character' then f.by_character is not null and f.reach_up < f.kind_stack and (not f.kind_scores or (f.class_ok and f.window_why is null and not f.class_taken))
      when 'thread' then f.first_post is not null and f.reach_up < f.kind_stack
      else f.by_board is not null and f.announce_thread is not null and f.live_board is null and f.reach_up < f.kind_stack end, false);
  if not springs then return null; end if;
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its back stays set until its time, and the write that met it lands as if no
  -- back were there (acts_well_formed would refuse the spring, and with it the write). A Move that cannot land leaves its back set for the next quote.
  if f.setter_retired is not null or f.setter_debuted is null then return null; end if;
  if back_trigger = 'quote' and not lands then return null; end if;
  did := case back_trigger when 'quote' then 'landed' when 'cast' then case when f.kind_trap #>> '{outcome,kind}' = 'ride' then 'rode' else 'caught' end else 'ended' end;
  -- What the quote met, to be shown: the Says phrase and the passage the back held (the setter chose them to be matched, and the spring says so), and the quoter only where the Who was Only these.
  -- An Anyone but list, and with it who it spared, is never written.
  held_when := case when trigger = 'quote' then jsonb_strip_nulls(jsonb_build_object('says', fd.phrase, 'passage', fd.passage)) end;
  if held_when = '{}'::jsonb then held_when := null; end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if f.setter_staff then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (f.setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'did', did, 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and did = 'caught' then by_act::text end,
    'drawn', case when back_trigger = 'quote' then surface_draft_fits(fd.play) end,
    'quadrant', case when did = 'rode' then fd.config ->> 'quadrant' end,
    'when', held_when,
    'for', case when trigger = 'quote' and fd.who is not null and not fd.who_except then f.by_character::text end))) returning id into sprung;
  if f.setter_staff then perform set_config('kayfabb.staff_writer', flag, true); end if;
  perform write_alert(f.setter_character, 'trapSprang', null, sprung, coalesce(actor, auth.uid()));
  if back_trigger = 'quote' then
    laid := lay_sprung(f.setter_character, fd.card, fd.config, f.target, f.reach, sprung, by_act);
    perform write_alert(f.by_character, 'trapStruck', null, laid, f.setter_owner);
    -- The landed card goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(laid));
  elsif back_trigger = 'cast' and fd.account is not null and did = 'caught' then
    -- The caught card is the setter's: one more row in their own ledger, beside the caster's `played` row. A staff setter has no hand and takes nothing.
    insert into card_ledger (account, card, kind, act, price) values (fd.account, incoming_card, 'caught', sprung, 0);
  end if;
  return act_projection(sprung);
end $$;
revoke execute on function spring_traps(text, uuid, uuid, text, uuid[], uuid) from public, anon, authenticated, service_role;

-- acts_spring_payload (0151), taking the optional boolean `drawn`.
alter table acts drop constraint acts_spring_payload;
alter table acts add constraint acts_spring_payload check (kind <> 'spring' or (
  jsonb_typeof(payload -> 'card') = 'string'
  and payload ->> 'trigger' in ('cast', 'reaction', 'reply', 'quote', 'visit')
  and coalesce(jsonb_typeof(payload -> 'outcome') = 'object', false) <> (payload ? 'did')
  and (not (payload ? 'did') or (payload ->> 'trigger', payload ->> 'did') in (('quote', 'landed'), ('cast', 'caught'), ('cast', 'rode'), ('visit', 'ended')))
  and jsonb_typeof(payload -> 'set') = 'string'
  and coalesce(jsonb_typeof(payload -> 'by'), 'null') in ('string', 'null')
  and coalesce(jsonb_typeof(payload -> 'caught'), 'null') in ('string', 'null')
  and coalesce(jsonb_typeof(payload -> 'when'), 'object') = 'object'
  and coalesce((payload -> 'when') - array['says', 'passage'] = '{}'::jsonb, true)
  and coalesce(jsonb_typeof(payload -> 'for'), 'string') = 'string'
  -- A rode spring names the quadrant its pay is read in; a caught one names none.
  and coalesce(payload ->> 'did' = 'rode', false) = (payload ? 'quadrant')
  and (not (payload ? 'quadrant') or payload ->> 'quadrant' in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'))
  and coalesce(jsonb_typeof(payload -> 'drawn'), 'boolean') = 'boolean'
  and payload - array['card', 'trigger', 'outcome', 'did', 'set', 'by', 'caught', 'when', 'for', 'quadrant', 'drawn'] = '{}'::jsonb) is true);


-- seed_instance (0153), also writing whether a card is a surface card (`surface`, the code's, so a re-seed that drops it clears it). Everything else as 0153 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, how long a Use of it is up, where it reaches, whether it pins, whether it writes, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, lasts, reaches, pins, writes, skim, scores_as, draws, drive, needs_message, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, surface = excluded.surface;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;


-- ------------------------------------------------------------------------------------------------------ 6. the player's log ----
-- What the log says of a surface (docs/plans/2026-11-11-graffiti-design.md, sections 3 and 11; plan Task 6), in plain words and from public Acts alone. Two views, each read by the reader's own characters, as
-- my_posts_written_on (0149) is read by the post's author; and `log_page` (0157) carries them as `draws` and `wallsDrawn`, its seventeenth and eighteenth sources.
--
--   my_draws          the drawer's: a row for each draw one of the caller's characters made (`kind` 'draw', `cells` the cells the drawing covers, public in its payload), and a row for each wash that cut one of those draws
--                     (`kind` 'cut', `character` the washer, `cells` the caller's cells it took). A wash by the caller's own other mask is not a cut row: the author's own line says it.
--   my_walls_drawn_on the post's author's: a row for each draw another character made on a wall on a post one of the caller's characters wrote, and a row for each wash (`cells` the cells it uncovered, none for a wash
--                     over bare cells). A draw by the caller's own other mask is not here: my_draws has it.
--
-- Both name the Act, the play and post, the Act's character, the caller's own character the line is for (`mine`), when, and a count of cells; nothing of an owner, a class or a reaction. "Cut" is read from the wash's own payload, where
-- surface_apply wrote it under the wall's lock from the owners it holds: `uncovered` (the cells the wash actually uncovered) and `cut` ([{draw, took}], the cells each draw owned that it took; `took` and not `cells`, which a payload keeps for its own bit string), so a cell counts for the draw
-- that last inked it and a cell already bare counts for no one. Both are the server's (a payload that arrives with them loses them) and are left out of the drawer's 64 KiB. A third player's views are empty.
--
-- The percent a line says is this count over the grid's 10,000 cells: a draw's own cells at the time it landed (what its strokes covered, whether or not it painted over something) and a wash's cells uncovered. Both are
-- facts of the Acts and never change, so a line is as true next year as the day it was written.
--
-- At a busy instance's scale: both views start from the caller's own characters (a post's author through surfaces.post, a drawer through acts_character) and read figures already in the Acts, so a row costs its own
-- payload and never a replay of the wall; a wash costs one pass over 10,000 cells, under the lock it already holds. log_page takes at most 200 rows of each, newest first, as it does of every source.
-- Ways out: reads only.

create view my_draws as
  select d.id as act, 'draw'::text as kind, d.target_act_id as play, s.post, d.character, c.id as mine, d.created_at as at,
         bit_count((d.payload ->> 'cells')::bit(10000)) as cells
  from characters c
  join acts d on d.character = c.id and d.kind = 'draw'
  join surfaces s on s.play = d.target_act_id
  where c.owner = auth.uid()
  union all
  select w.id, 'cut'::text, w.target_act_id, s.post, w.character, d.character, w.created_at, sum((e ->> 'took')::integer)::integer
  from characters c
  join acts d on d.character = c.id and d.kind = 'draw'
  join surfaces s on s.play = d.target_act_id
  join acts w on w.kind = 'wash' and w.target_act_id = d.target_act_id and (w.created_at, w.id) > (d.created_at, d.id)
             and w.payload -> 'cut' @> jsonb_build_array(jsonb_build_object('draw', d.id))
  cross join lateral jsonb_array_elements(w.payload -> 'cut') e
  where c.owner = auth.uid() and e ->> 'draw' = d.id::text
    and not exists (select 1 from characters x where x.id = w.character and x.owner = auth.uid())
  group by w.id, w.target_act_id, s.post, w.character, d.character, w.created_at;

revoke all on my_draws from anon, public;
grant select on my_draws to authenticated;

create view my_walls_drawn_on as
  select d.id as act, 'draw'::text as kind, d.target_act_id as play, s.post, d.character, c.id as mine, d.created_at as at,
         bit_count((d.payload ->> 'cells')::bit(10000)) as cells
  from characters c
  join surfaces s on true
  join acts p on p.id = s.post and p.character = c.id
  join acts d on d.target_act_id = s.play and d.kind = 'draw'
  where c.owner = auth.uid()
    and not exists (select 1 from characters x where x.id = d.character and x.owner = auth.uid())
  union all
  select w.id, 'wash'::text, w.target_act_id, s.post, w.character, c.id, w.created_at,
         coalesce((w.payload ->> 'uncovered')::integer, 0)
  from characters c
  join surfaces s on true
  join acts p on p.id = s.post and p.character = c.id
  join acts w on w.target_act_id = s.play and w.kind = 'wash'
  where c.owner = auth.uid();

revoke all on my_walls_drawn_on from anon, public;
grant select on my_walls_drawn_on to authenticated;

-- log_page (0157), also reading the two views above as `draws` and `wallsDrawn` (newest first by `at`, at most 200, the columns the adapter's log() reads). The plays and posts they name are among the Acts the page
-- names (never the draws' own Acts, which hold strokes), and the characters they name (a drawer, a washer) among its people. Everything else as 0157 wrote it.
create or replace function log_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive
  mine as (
    select m.id, m.class_since from my_characters m
  ), lg as materialized (
    select l.settlement, l.starts_at, l.ends_at, l.character, l.reason, l.amount, l.shares_kept, l.params
    from my_ledger l where in_before is null or l.ends_at <= in_before
    order by l.ends_at desc, l.settlement, l.character, l.reason limit 200
  ), wl as materialized (
    select e.settlement, e.kind, e.change, e.overflow, e.floored, e.balance_after, e.ref, e.at
    from my_wallet_events e where in_before is null or e.at <= in_before
    order by e.at desc, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after limit 200
  ), cd as materialized (
    select c.card, c.kind, c.act, c.price, c.at, c.springs, c.pack, c.repriced
    from my_card_ledger c where in_before is null or c.at <= in_before
    order by c.at desc, c.card, c.kind, c.act, c.price, c.pack limit 200
  ), pk as materialized (
    select p.id, p.pack, p.price, p.repriced, p.contents, p.bought_at
    from my_packs p where in_before is null or p.bought_at <= in_before
    order by p.bought_at desc, p.id limit 200
  ), po as materialized (
    select p.play, p.post, p.at, p.reach, p.target_name, p.target_character
    from my_posts_played_on p where in_before is null or p.at <= in_before
    order by p.at desc, p.play limit 200
  ), wr as materialized (
    select w.play, w.post, w.version, w.failed, w.opening, w.over, w.at
    from my_posts_written_on w where in_before is null or w.at <= in_before
    order by w.at desc, w.play, w.version limit 200
  ), dr as materialized (
    select r.act, r.kind, r.play, r.post, r.character, r.mine, r.at, r.cells
    from my_draws r where in_before is null or r.at <= in_before
    order by r.at desc, r.act, r.mine limit 200
  ), wd as materialized (
    select r.act, r.kind, r.play, r.post, r.character, r.mine, r.at, r.cells
    from my_walls_drawn_on r where in_before is null or r.at <= in_before
    order by r.at desc, r.act, r.mine limit 200
  ), sv as materialized (
    select p.play, p.post, p.saved_at
    from my_posts_played_on p where p.saved_at is not null and (in_before is null or p.saved_at <= in_before)
    order by p.saved_at desc, p.play limit 200
  ), se as materialized (
    select f.play, f.card, f.post, f.spring, f.ended_at, f.ended_by
    from my_face_down f where f.ended_at is not null and (in_before is null or f.ended_at <= in_before)
    order by f.ended_at desc, f.play limit 200
  ), sp as materialized (
    select f.play, f.card, f.post, f.ends_at, f.passed_at
    from my_face_down f where f.passed_at is not null and f.spring is null and (in_before is null or f.passed_at <= in_before)
    order by f.passed_at desc, f.play limit 200
  ), ca as materialized (
    select c.play, c.card, c.post, c.trap, c.spring, c.price, c.at
    from my_caught c where in_before is null or c.at <= in_before
    order by c.at desc, c.play limit 200
  ), en as materialized (
    select e.card_end, e.play, e.card, e.at, e.side, e.reach, e.target_name, e.post_author_name, e.caster_name, e.character
    from my_cards_ended e where in_before is null or e.at <= in_before
    order by e.at desc, e.card_end limit 200
  ), inf as materialized (
    select i.infraction, i.character, i.at, i.band, i.points, i.rule_number, i.rule, i.mod_name, i.post, i.post_seq, i.thread, i.expires_at, i.relief, i.emptied_at
    from my_infractions i where in_before is null or i.at <= in_before
    order by i.at desc, i.infraction limit 200
  ), bn as materialized (
    select b.ban, b.character, b.at, b.days, b.until, b.infraction, b.rule, b.thread, b.ruling, b.own_until
    from my_bans b where in_before is null or b.at <= in_before
    order by b.at desc, b.ban limit 200
  ), gm as materialized (
    select g.move, g.character, g.at, g.thread, g.seq, g."group", g.board, g.board_name, g.expires_at, g.landed_until, g.check_at, g.demand, g.office,
           g.ended_why, g.ended_by, g.ended_at, g.ruling, g.ruled_at, g.ruled_until, g.ruled_office
    from my_group_moves g where in_before is null or g.at <= in_before
    order by g.at desc, g.move limit 200
  ), rp as materialized (
    select r.report, r.character, r.at, r.post, r.post_seq, r.thread, r.verdict, r.verdict_at, r.mod_name, r.refund
    from my_reports r where in_before is null or r.at <= in_before
    order by r.at desc, r.report limit 200
  ), ap as materialized (
    select a.appeal, a.character, a.at, a.punishment, a.punishment_kind, a.post_seq, a.thread, a.verdict, a.ruled_at, a.points_delta, a.hearer_name, a.refund
    from my_appeals a where in_before is null or a.at <= in_before
    order by a.at desc, a.appeal limit 200
  ), sh as materialized (
    select s.settlement, s.character, s.reason, s.act, s.quadrant, s.amount
    from my_ledger_shares s where s.settlement in (select x.settlement from lg x)
  ), sa as materialized (
    select s.settlement, s.character, s.named_class, s.play, s.card, s.starts_at, s.ends_at
    from my_scored_as s where in_before is null or s.ends_at <= in_before
    order by s.ends_at desc, s.settlement, s.character limit 200
  ), tn as materialized (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character in (select m.id from mine m)
  ), named(id) as (
    -- actsNamed (engine/ui/log/lines.ts) over every row read; the Turns are the latest one of each character, the one announced as its class began.
    select x.act from sh x where x.act is not null
    union select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at))
    union select x.act from cd x where x.act is not null
    union select x.play from po x union select x.post from po x where x.post is not null
    union select x.play from wr x union select x.post from wr x
    union select x.play from dr x union select x.post from dr x
    union select x.play from wd x union select x.post from wd x
    union select x.play from sv x union select x.post from sv x where x.post is not null
    union select x.post from se x where x.post is not null union select x.spring from se x where x.spring is not null
    union select x.post from sp x where x.post is not null
    union select x.play from ca x union select x.post from ca x where x.post is not null
    union select x.play from en x
    union select x.ref from wl x where x.kind in ('bribe', 'gift_out', 'gift_in') and x.ref is not null
  ), walk(id, depth) as (
    -- actsFollowed, twice: what the Acts read lead to. A loop costs the two rounds as a chain does.
    select n.id, 0 from named n
    union
    select f.id, w.depth + 1
    from walk w
    join acts_public a on a.id = w.id
    cross join lateral (values
      (case when a.kind in ('card', 'spring', 'set', 'donation') then a.target_act_id end),
      (case when a.kind = 'intercept' and a.payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'visit_act')::uuid end),
      (case when a.kind in ('spring', 'card') and a.payload ->> 'spring' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'spring')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'caught' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'caught')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'by')::uuid end)
    ) f(id)
    where w.depth < 2 and f.id is not null
  ), ac as materialized (
    select a.* from acts_public a where a.id in (select w.id from walk w)
  ), reach as materialized (
    -- A play beyond a post carries its target's name (play_card, 0056); one written without reads it as it stands, so its target is named here.
    select a.payload ->> 'reach' as kind,
           case when a.payload ->> (a.payload ->> 'reach') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> (a.payload ->> 'reach'))::uuid end as target
    from ac a
    where a.kind = 'card' and jsonb_typeof(a.payload -> 'targetName') is distinct from 'string' and a.payload ->> 'reach' in ('character', 'thread', 'board')
  ), pe(id) as (
    select a.character from ac a where a.character is not null and a.character not in (select m.id from mine m)
    union select x.character from dr x where x.character not in (select m.id from mine m)
    union select x.character from wd x where x.character not in (select m.id from mine m)
    union select r.target from reach r where r.kind = 'character' and r.target is not null and r.target not in (select m.id from mine m)
  ), th(id) as (
    select a.thread from ac a where a.id in (select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at)))
    union select r.target from reach r where r.kind = 'thread' and r.target is not null
  )
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character, x.reason) from lg x), '[]'::jsonb),
      'wallet', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) from wl x), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card, x.kind, x.act, x.price, x.pack) from cd x), '[]'::jsonb),
      'packs', coalesce((select jsonb_agg(to_jsonb(x) order by x.bought_at desc, x.id) from pk x), '[]'::jsonb),
      'playsOnMine', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from po x), '[]'::jsonb),
      'writes', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play, x.version) from wr x), '[]'::jsonb),
      'draws', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.act, x.mine) from dr x), '[]'::jsonb),
      'wallsDrawn', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.act, x.mine) from wd x), '[]'::jsonb),
      'saves', coalesce((select jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.play) from sv x), '[]'::jsonb),
      'setEnds', coalesce((select jsonb_agg(to_jsonb(x) order by x.ended_at desc, x.play) from se x), '[]'::jsonb),
      'setPasses', coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc, x.play) from sp x), '[]'::jsonb),
      'caught', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from ca x), '[]'::jsonb),
      'ended', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card_end) from en x), '[]'::jsonb),
      'infractions', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from inf x), '[]'::jsonb),
      'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.ban) from bn x), '[]'::jsonb),
      'groupMoves', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.move) from gm x), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.report) from rp x), '[]'::jsonb),
      'appeals', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.appeal) from ap x), '[]'::jsonb)),
    'shares', coalesce((select jsonb_agg(to_jsonb(x) order by x.settlement desc, x.character, x.reason, x.act, x.quadrant) from sh x), '[]'::jsonb),
    'scoredAs', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character) from sa x), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(e) order by e.play::text collate "C") from (
      select s.play, s.state, s.saved_at from effect_state s where s.play in (select v.play from sv v)) e), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name, f.id) from (
        select cp.name, cp.id, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c where c.id in (select p.id from pe p)) cp) f), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id::text collate "C") from thread_open t where t.id in (select h.id from th h)), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(to_jsonb(b) order by b.id::text collate "C") from (
      select n.id, n.slug, n.name, n.description, n.is_system, n.move_act from boards_now n
      where n.id in (select r.target from reach r where r.kind = 'board' and r.target is not null)) b), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(to_jsonb(s) order by s.character::text collate "C") from (
      select c.character, c.standing from current_standings c where c.character in (select m.id from mine m)) s), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'season', (select to_jsonb(s) from current_season s limit 1)
  );
end;

revoke all on function log_page(timestamptz) from public, anon, authenticated;
grant execute on function log_page(timestamptz) to authenticated;
