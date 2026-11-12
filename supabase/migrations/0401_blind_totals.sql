-- Blind totals (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 4; supabase/tests/0168-blind-totals.sql). A cast card with `veil = 'totals'` on a post (0400's post_veils) withholds the post's reaction totals while it is up.
--
--     1. totals_withheld(act, account)    a live totals veil is on the Act and the account neither owns the veil's author nor cast it: the one fact every reader below keys on.
--     2. reaction_tallies' policy         a signed-in player reads the table as themselves, so thread_page, board_page and updates_page (security invoker) and the client's own selects follow.
--     3. reaction_tallies_open            the tallies less every Act with a live totals veil, for the definer readers whose answers reach a screen or a model.
--     4. react                            answers no tally for an Act with a live totals veil, to everyone.
--     5. the machine's reads              demand_progress, demand_contributors, pool_signals and system_digest read the view in place of the table (and the digest role loses the table).
--     6. estimate_input                   leaves out the others' reactions to an Act the account is withheld the totals of.
--
-- settlement_input is unchanged (The System's own scoring reads who reacted and settles exactly, CLAUDE.md "A response never proves a private fact"), and so is act_window_counts (a hint goes to the Act's own player).
-- What differs between readers keys on the reader's own account owning the veil's author or being its caster: never on who reacted.

-- ============================================================================================ 1. totals_withheld ====
-- A veil is live as post_veils_live says (0400). The two reads are one probe of post_veils_post each, then the owner of the veil's author (characters' key) and the veil's caster. Granted to no API role: it
-- takes the account as an argument, so a client allowed to call it could ask whether another account owns a character or cast a card. The policy below calls my_totals_withheld, which asks it of the caller's own account.
create function totals_withheld(act uuid, account uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return exists (select 1 from post_veils_live v where v.post = totals_withheld.act and v.veil = 'totals')
     and not exists (
       select 1 from post_veils_live v
       where v.post = totals_withheld.act and v.veil = 'totals'
         and (v.caster_account = totals_withheld.account or exists (select 1 from characters c where c.id = v.author and c.owner = totals_withheld.account)));
end $$;
revoke execute on function totals_withheld(uuid, uuid) from public, anon, authenticated, service_role;

-- ============================================================================================ 2. the policy ====
-- reaction_tallies' policy (0002) was `using (true)`. A policy's functions are run as the reader, who needs the right to execute them, so it calls this one: totals_withheld asked of the caller's own account and no
-- other, a definer so that it may call the one above. Both are PL/pgSQL, whose plans are kept for the session: a SQL function is planned again on every call, and a policy calls it once per tally row (a view
-- expanded and planned each time cost 80 buffers a row). The same answer a reader's page and a reader's own select get, since thread_page, board_page and updates_page are security invoker and the client reads the table
-- itself; one probe of post_veils_post per tally row read. The digest role's policy (0045) goes with its grant, below: its functions read the open view.
create function my_totals_withheld(act uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return totals_withheld(my_totals_withheld.act, auth.uid());
end $$;
revoke execute on function my_totals_withheld(uuid) from public, anon, authenticated, service_role;
grant execute on function my_totals_withheld(uuid) to authenticated;
drop policy read on reaction_tallies;
create policy read on reaction_tallies for select to authenticated using (not my_totals_withheld(act));

-- ======================================================================================= 3. reaction_tallies_open ====
-- The tallies less every Act with a live totals veil, whoever asks. It calls no function (a view's functions are run as its reader, and the digest role's list of them is a reviewed set, 0050-digest.sql), and reads the
-- table with its owner's rights, which the table's row security does not bind. Granted to the digest role alone, whose functions read it where they read the table before.
create view reaction_tallies_open as
  select t.act, t.kind, t.count
  from reaction_tallies t
  where not exists (select 1 from post_veils_live v where v.post = t.act and v.veil = 'totals');
revoke all on reaction_tallies_open from public, anon, authenticated, service_role;
grant select on reaction_tallies_open to kayfabb_digest;

-- ===================================================================================================== 4. react ====
-- react (0153_drives), answering no tally for an Act with a live totals veil, to everyone: a reply is one answer, and the act Edge Function broadcasts a `tally` event from it only when there is one (act/core.ts), so
-- no event carries the totals either. The author's player and the caster's read them on a load, not live. The tally is still written, and returned whole the moment the veil is over. Everything else as 0153_drives
-- wrote it, its lock order included.
CREATE OR REPLACE FUNCTION public.react(target uuid, through uuid, reaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller uuid := auth.uid();
  cap integer := (setting('reactionCap'))::integer;
  target_kind text;
  author_owner uuid;
  held text[];
  free_slot integer;
begin
  if caller is null then raise exception 'sign in to react' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  perform played_by(through, caller);
  perform not_banned(through);
  if not exists (select 1 from reaction_kinds k where k.key = reaction) then
    raise exception 'there is no reaction "%"', reaction using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The System's own Acts (a tally, the reveal) have no author, and no author's owner to hold the
  -- caller apart from: they are reacted to like any Act, and pay nobody (settle.ts).
  select a.kind, c.owner into target_kind, author_owner
  from acts a left join characters c on c.id = a.character where a.id = target;
  if target_kind is null then
    raise exception 'there is no such Act' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if target_kind = 'edit' then raise exception 'an edit is not reacted to; react to the post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- A gift is no one's to react to (design, section 5): it earns nothing, and settlement and the estimate leave it out.
  if target_kind = 'donation' then raise exception 'a gift cannot be reacted to' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The author's owner now: a character changing hands is not in this slice, and the session
  -- that adds it decides what becomes of reactions between its old and new owner's characters.
  if author_owner = caller then
    raise exception 'your characters cannot react to each other' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;

  select coalesce(array_agg(r.kind order by r.slot), '{}') into held
  from reactions r where r.act = target and r.reactor_account = caller;
  -- The lowest free slot, so a slot given back (a reaction removed, later) is taken again rather
  -- than colliding for ever. The slot only makes two reactions at once collide; the cap is held
  -- by the count above, so lowering reactionCap later leaves existing reactions as they are.
  select min(g) into free_slot from generate_series(1, cardinality(held) + 1) g
  where not exists (select 1 from reactions r where r.act = target and r.reactor_account = caller and r.slot = g);
  if reaction = any (held) then
    raise exception 'you have already left that reaction here' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if cardinality(held) >= cap then
    raise exception 'you have left % reactions here, the most there are', cap using hint = 'kayfabb.refusal', errcode = '23514';
  end if;

  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot)
    values (target, through, caller, reaction, free_slot);
  exception when unique_violation then
    -- Another reaction of this player's landed between the read above and this write.
    raise exception 'you reacted here twice at once; try again' using hint = 'kayfabb.refusal', errcode = '40001';
  end;
  insert into reaction_tallies (act, kind, count) values (target, reaction, 1)
  on conflict (act, kind) do update set count = reaction_tallies.count + 1;
  -- A reaction springs nothing: who reacted is a private fact, so no card lands on or by it (face-down Moves, design section 2).

  return jsonb_build_object('act', target, 'thread', (select thread from acts where id = target),
    'tally', case when exists (select 1 from post_veils_live v where v.post = target and v.veil = 'totals') then null
                  else (select coalesce(jsonb_object_agg(t.kind, t.count order by t.kind), '{}') from reaction_tallies t where t.act = target) end);
end $function$;

-- ================================================================================================ 5. the machine's reads ====
-- The four definer functions of the digest role whose answers reach a screen or a model read the tallies through reaction_tallies_open, so no live totals veil's post moves them: a board's demand progress (and who it
-- credits, which a trophy shows), the pool's signals and the digest a model reads. Each is copied from its latest definition with the one word changed: demand_progress (0129_group_moves), demand_contributors
-- (0206_trophies), pool_signals and system_digest (0400_post_veils). A replaced function keeps its owner and its grants. The staff cannot carry a veil (0400 refuses one on a staff post), so pool_signals' staff
-- reads are the same either way today; it reads the view so that no definer function of the role reads the table.
create or replace function demand_progress(move_act uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  landed timestamptz;
  demand jsonb;
  p jsonb;
  total integer;
  have integer;
begin
  select a.created_at, a.payload -> 'demand' into landed, demand from acts_public a where a.id = move_act and a.kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  if demand is null or jsonb_typeof(demand) <> 'object' then return jsonb_build_object('done', 0, 'of', 0, 'met', false); end if;
  p := demand -> 'params';
  case demand ->> 'kind'
    when 'postsOnBoard' then
      total := (p ->> 'count')::integer;
      if total is null or total < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select count(*) into have from (
        select 1 from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        limit total) s;
    when 'distinctCharactersOnBoard' then
      total := (p ->> 'count')::integer;
      if total is null or total < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select count(*) into have from (
        select distinct a.character from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        limit total) s;
    when 'quadrantOnBoard' then
      total := (p ->> 'count')::integer;
      if total is null or total < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select coalesce(sum(t.count), 0)::integer into have
      from acts_public a
      join thread_list tl on tl.id = a.thread
      join characters_public c on c.id = a.character
      join reaction_tallies_open t on t.act = a.id
      join reaction_kinds k on k.key = t.kind
      where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null and k.quadrant = p ->> 'quadrant';
    when 'characterPostsInThread' then
      total := 1;
      select count(*) into have from (
        select 1 from acts_public a
        where a.kind = 'post' and a.thread = (p ->> 'thread')::uuid and a.character = (p ->> 'character')::uuid and a.created_at > landed
        limit 1) s;
    when 'crossQuote' then
      -- Each of the two quotes the other in a reply made since the landing, and the reply draws `reactions` on its public tally.
      total := 2;
      if (p ->> 'reactions')::integer is null or (p ->> 'reactions')::integer < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select count(*) into have
      from (values ((p ->> 'a')::uuid, (p ->> 'b')::uuid), ((p ->> 'b')::uuid, (p ->> 'a')::uuid)) d (quoter, quoted)
      where exists (
        select 1 from acts_public r
        join acts_public q on q.id = r.target_act_id
        where r.kind = 'post' and r.created_at > landed and r.character = d.quoter and q.kind = 'post' and q.character = d.quoted
          and (select coalesce(sum(t.count), 0) from reaction_tallies_open t where t.act = r.id) >= (p ->> 'reactions')::integer);
    when 'apologyAccepted' then
      -- The move is its own subject: met when one of its apologies has been accepted.
      total := 1;
      select count(*) into have from (select 1 from apologies x where x.move_act = demand_progress.move_act and x.state = 'accepted' limit 1) s;
    else
      raise exception 'there is no demand kind "%"', coalesce(demand ->> 'kind', '') using errcode = '22023';
  end case;
  return jsonb_build_object('done', least(have, total), 'of', total, 'met', have >= total);
end $$;

create or replace function demand_contributors(move_act uuid) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  landed timestamptz;
  demand jsonb;
  p jsonb;
  total integer;
  who uuid[];
begin
  select a.created_at, a.payload -> 'demand' into landed, demand from acts_public a where a.id = move_act and a.kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  if demand is null or jsonb_typeof(demand) <> 'object' then return '{}'; end if;
  p := demand -> 'params';
  case demand ->> 'kind'
    when 'postsOnBoard' then
      total := (p ->> 'count')::integer;
      select coalesce(array_agg(distinct s.character), '{}') into who from (
        select a.character from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        order by a.created_at, a.id limit total) s;
    when 'distinctCharactersOnBoard' then
      total := (p ->> 'count')::integer;
      select coalesce(array_agg(f.character), '{}') into who from (
        select a.character, min(a.created_at) as first_at from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        group by a.character order by min(a.created_at), a.character limit total) f;
    when 'quadrantOnBoard' then
      select coalesce(array_agg(distinct a.character), '{}') into who
      from acts_public a
      join thread_list tl on tl.id = a.thread
      join characters_public c on c.id = a.character
      join reaction_tallies_open t on t.act = a.id
      join reaction_kinds k on k.key = t.kind
      where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null and k.quadrant = p ->> 'quadrant' and t.count > 0;
    when 'characterPostsInThread' then
      select coalesce(array_agg(distinct a.character), '{}') into who
      from acts_public a join characters_public c on c.id = a.character
      where a.kind = 'post' and a.thread = (p ->> 'thread')::uuid and a.character = (p ->> 'character')::uuid and a.created_at > landed and c.staff is null;
    when 'crossQuote' then
      select coalesce(array_agg(d.quoter), '{}') into who
      from (values ((p ->> 'a')::uuid, (p ->> 'b')::uuid), ((p ->> 'b')::uuid, (p ->> 'a')::uuid)) d (quoter, quoted)
      join characters_public c on c.id = d.quoter and c.staff is null
      where exists (
        select 1 from acts_public r
        join acts_public q on q.id = r.target_act_id
        where r.kind = 'post' and r.created_at > landed and r.character = d.quoter and q.kind = 'post' and q.character = d.quoted
          and (select coalesce(sum(t.count), 0) from reaction_tallies_open t where t.act = r.id) >= (p ->> 'reactions')::integer);
    when 'apologyAccepted' then
      select coalesce(array_agg(distinct a.character), '{}') into who
      from apologies x join acts_public a on a.id = x.apology_act join characters_public c on c.id = a.character
      where x.move_act = demand_contributors.move_act and x.state = 'accepted' and c.staff is null;
    else
      raise exception 'there is no demand kind "%"', coalesce(demand ->> 'kind', '') using errcode = '22023';
  end case;
  return who;
end $$;

create or replace function pool_signals(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  days integer := coalesce(((setting('pool') ->> 'priorityDays'))::integer, 28);
  boss text := current_boss();
  hours numeric;
  result jsonb;
begin
  if since is null or until is null or until <= since then
    raise exception 'signals cover a window that ends after it starts' using errcode = '22023';
  end if;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  -- The window's move_end and move_keep Acts, each with the move's owner when it fell: move_owner (0051) for an end, the latest keep
  -- else the writer; for a keep, the owner before it (the latest earlier keep, else the writer). Read from the public views, as the
  -- role may; supabase/tests/0090-pool-signals.sql checks an end's owner against move_owner itself.
  ev as (
    select e.id as act, e.thread, e.created_at, e.target_act_id as move,
           case when e.kind = 'move_keep' then 'kept' else e.payload ->> 'why' end as how,
           e.payload ->> 'by' as by_whom,
           coalesce(
             (select kc.staff from acts_public k join characters_public kc on kc.id = k.character
               where k.kind = 'move_keep' and k.target_act_id = e.target_act_id
                 and (e.kind = 'move_end' or (k.created_at, k.id) < (e.created_at, e.id))
               order by k.created_at desc, k.id desc limit 1),
             (select mc.staff from acts_public mv join characters_public mc on mc.id = mv.character where mv.id = e.target_act_id and mv.kind = 'move')) as owner,
           (select mc.staff from acts_public mv join characters_public mc on mc.id = mv.character where mv.id = e.target_act_id and mv.kind = 'move') as maker
    from acts_public e
    where e.kind in ('move_end', 'move_keep') and e.created_at >= since and e.created_at < until
  )
  select jsonb_build_object(
    'named', pool_named(since, until),
    'quoted', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', q.staff, 'act', q.act, 'thread', q.thread, 'n', q.n) order by q.staff, q.created_at desc, q.act desc), '[]'::jsonb)
      from (
        select tc.staff, w.id as act, w.thread, w.created_at,
               row_number() over (partition by tc.staff order by w.created_at desc, w.id desc) as rn,
               count(*) over (partition by tc.staff) as n
        from acts_public w
        join acts_public tgt on tgt.id = w.target_act_id
        join characters_public tc on tc.id = tgt.character
        where w.kind = 'post' and w.created_at >= since and w.created_at < until and w.character is not null
          and tgt.kind = 'post' and tc.staff is not null and tc.office is distinct from 'developer' and tc.office is distinct from 'anonymous' and w.character <> tgt.character
      ) q where q.rn <= 5),
    'legacy', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', l.owner, 'maker', l.maker, 'move', l.move, 'act', l.act, 'thread', l.thread, 'how', l.how, 'n', l.n) order by l.maker, l.created_at desc, l.act desc), '[]'::jsonb)
      from (
        select v.*, row_number() over (partition by v.maker order by v.created_at desc, v.act desc) as rn, count(*) over (partition by v.maker) as n
        from ev v where v.owner is not null and v.maker is not null and (v.owner is distinct from boss or v.maker is distinct from boss)
      ) l where l.rn <= 5),
    'reversals', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', v.owner, 'move', v.move, 'act', v.act, 'thread', v.thread) order by v.created_at desc, v.act desc), '[]'::jsonb)
      from ev v where v.owner is not distinct from boss and v.owner is not null and v.how = 'reversed' and v.by_whom = 'admin'),
    'handovers', (
      select coalesce(jsonb_agg(jsonb_build_object('season', h.season, 'outgoing', h.outgoing, 'boss', h.boss, 'how', h.how, 'at', h.landed_at,
                                                   'act', arr.id, 'thread', arr.thread) order by h.landed_at, h.season), '[]'::jsonb)
      from season_handovers h left join acts_public arr on arr.id = h.arrival_act where h.landed_at >= since and h.landed_at < until),
    'hot', (
      select coalesce(jsonb_agg(jsonb_build_object('thread', x.thread, 'board', x.board, 'heat', x.heat, 'starter', x.starter,
                                                   'starterStaff', x.starter_staff, 'staffStarted', x.starter_staff is not null,
                                                   'authors', x.authors, 'boardMaker', null) order by x.posts desc, x.thread), '[]'::jsonb)
      from (
        select tl.id as thread, tl.board, h.posts, round(h.posts / hours, 2) as heat, tl.first_character as starter, sc.staff as starter_staff,
               (select coalesce(jsonb_agg(jsonb_build_object('character', a.character, 'posts', a.n) order by a.n desc, a.character), '[]'::jsonb)
                from (select p.character, count(*) as n from acts_public p
                      where p.thread = tl.id and p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
                      group by p.character order by n desc, p.character limit 10) a) as authors
        from (
          select p.thread, count(*) as posts from acts_public p
          where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
          group by p.thread
        ) h
        join thread_list tl on tl.id = h.thread
        left join characters_public sc on sc.id = tl.first_character and sc.office is distinct from 'developer' and sc.office is distinct from 'anonymous'
        order by h.posts desc, tl.id
        limit threads_cap
      ) x),
    'tallies', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', t.staff, 'posts', t.posts, 'reactions', t.reactions) order by t.staff), '[]'::jsonb)
      from (
        select c.staff, count(a.id) as posts, coalesce(sum(r.n), 0)::bigint as reactions
        from characters_public c
        left join acts_public a on a.character = c.id and a.kind = 'post' and a.created_at >= until - days * interval '1 day' and a.created_at < until
        left join lateral (select sum(tt.count) as n from reaction_tallies_open tt where tt.act = a.id) r on true
        where c.staff is not null and c.office is distinct from 'developer' and c.office is distinct from 'anonymous'
        group by c.staff
      ) t)
  ) into result;
  return result;
end $$;

create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, k.quadrant, sum(t.count)::integer as n
    from w join reaction_tallies_open t on t.act = w.id join reaction_kinds k on k.key = t.kind
    group by w.thread, k.quadrant
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies_open t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.created_at
    from w left join reaction_tallies_open t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies_open t on t.act = a.id
    join reaction_kinds k on k.key = t.kind
    where mm.dkind = 'quadrantOnBoard' and k.quadrant = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null and cp.office is distinct from 'anonymous',
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ============================================================================================== 6. estimate_input ====
-- estimate_input (0316_card_notes_part_4), leaving out every other player's reaction to an Act the account is withheld the totals of (totals_withheld), so an early call's direction or a card's lift on a blind post is not
-- shown live, to a third player or to a reactor. The account's own reactions stay (they know them), and the author's player and the caster read them all, since for them nothing is withheld. settlement_input is
-- unchanged: the Lurker is paid at settlement by where the post leaned, and the settlement is exact. Everything else as 0316 wrote it.

create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  mine as (select id from characters where owner = account),
  -- The live Earn plays on the caller's characters and posts, played before the window and still up in it (settlement_input's earn_up, for what the caller's earnings can carry): another player's play on
  -- the caller's post is a public Act and counts as one of the caller's own.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' = 'earn'
      and k.created_at < window_end and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' = 'earn')
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)
      and case when coalesce(k.payload ->> 'reach', 'post') = 'character' then (k.payload ->> 'character')::uuid in (select id from mine)
               else exists (select 1 from acts p join mine m on m.id = p.character where p.id = k.target_act_id) end),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end and a.kind <> 'donation'
               and a.id not in (select id from ended)),
  -- (Task 5) The caller's skim plays made before the window and still up in it, by acts_card_plays (the caller's own plays), with their posts: the posts' reactions are read, as settlement_input reads them.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join mine m on m.id = k.character join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The caller's live ride gimmick plays (a Toll on a post of the caller's player's), and the casts one covers on its post that a reaction reached in the window (reactions_window, one probe each); and the caller's ride springs
  -- whose cast a reaction reached in the window (one probe each). Only the caller's own plays lead: a bystander has none, so none of this is in a bystander's input.
  my_gimmicks as (
    select g.id, g.target_act_id as post, g.created_at, (g.payload ->> 'ends')::timestamptz as ends
    from acts g join mine m on m.id = g.character join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where g.kind = 'card' and g.target_act_id is not null and coalesce(g.payload ->> 'reach', 'post') = 'post' and not (g.payload ? 'caught')
      and g.created_at < window_end and g.created_at >= window_start - (select max(r.lasts) from card_kinds r where r.gimmick ->> 'kind' = 'ride')
      and (g.payload ->> 'ends')::timestamptz > window_start and g.id not in (select id from ended)),
  rode as (
    select s.id as spring, (s.payload ->> 'by')::uuid as by_cast
    from acts s join mine m on m.id = s.character
    where s.kind = 'spring' and s.payload ->> 'did' = 'rode' and s.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = (s.payload ->> 'by')::uuid and r.created_at >= window_start and r.created_at < window_end)),
  ride_casts as (
    select c.id from my_gimmicks g join acts c on c.target_act_id = g.post and c.kind = 'card' and coalesce(c.payload ->> 'reach', 'post') = 'post'
    where c.id <> g.id and c.created_at >= g.created_at and c.created_at < g.ends and c.created_at < window_end and c.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = c.id and r.created_at >= window_start and r.created_at < window_end)
    union select by_cast from rode),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind in ('card', 'spring') and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets
            union select post from skim_up union select id from ride_casts),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
    union select id from skim_up union select id from my_gimmicks union select spring from rode
    -- The post each card, spin or spring among the voted Acts points at (Task 1, #137): a card the caller only reacted to is
    -- judged against its post, and a spin the caller only reacted to is read with its origin (settle.ts reads every spin's), as
    -- settlement_input reads every window play's target.
    union select a.target_act_id from acts a join voted v on v.id = a.id
          where a.kind in ('card', 'spin', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from acts a join characters c on c.id = a.character join touched t on t.id = a.id
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but the caller's own to the caller's own characters,
  -- and none on The System's own Acts: the tally every player reacts to would hand each caller who
  -- reacted to it every other player's reaction.
  --
  -- The settlement never pays a player's reactions to their own characters, and until 0073 this read
  -- left them out too, which made a live line computed from who reacted: a fire landing on Bob's post
  -- under Ann's card with no lift line told Ann it came from one of Bob's masks. The live estimate is not
  -- The System's scoring (CLAUDE.md, "A response never proves a private fact": "The live estimate is not
  -- that exception: it leaves out only the caller's own reactions, counts every other as anyone's, and
  -- the settlement is exact"). So ownership is read here only to tell the caller's own from the rest:
  -- the caller knows their own, and every other reaction, the author's own player's included, is
  -- counted under `keyed`'s per-mask keys, which the engine cannot tie to an author. The estimate can then
  -- say more than the settlement pays, as it says "up to"; the settled log is exact.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and not (r.reactor_account = account and c.owner = account) and r.act not in (select id from ended) and a.kind <> 'donation'
      and not (r.reactor_account <> account and totals_withheld(r.act, account))
      and (not is_staff_side(a.character, a.kind, a.target_act_id) or a.id in (select id from unscored))
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    -- The classes the caller's own characters are scored as for this window (scored_as_plays), beside the window's start: the estimate can say it.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character)
                          from scored_as_plays(window_start, window_end) s join mine m on m.id = s.character), '[]'),
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        'ends', case when a.kind = 'card' and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from (a.payload ->> 'ends')::timestamptz) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character) order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
  );
end $$;

-- ========================================================================================= the digest role's reads ====
-- Every function the digest role owns that read the tallies now reads reaction_tallies_open, so the role's right to read the table, and the policy that gave it, go: a function it owns added later that reads the
-- table would be refused here, and a reviewer sees the view in its place (0168-blind-totals.sql holds the pair).
revoke select on reaction_tallies from kayfabb_digest;
drop policy digest_reads on reaction_tallies;
