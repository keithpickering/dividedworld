-- Review fixes for the board stubs and closed boards (docs/plans/2026-11-06-fangame-split-plan.md, Task 3).
--
-- 1. board_page (0326) listed stubs on the last page only; page one is where readers land, so a moved thread vanished from a busy board. They are now page one's, below its threads,
--    capped at 50 and taking none of its slots or its count.
-- 2. A closed board's target may itself be closed (a merge's `into` merged again, a fallback closed since), so "start your thread there" would refuse again. board_closed_to keeps the
--    direct target (`mergedInto` or `fallback`, so the words stay true) and adds `goesTo`: the first open board, found by following merged_into and the fallback chain (at most 50
--    hops; the chain ends at first_open_board(), which is open). board_page returns it as `goesTo`, and not_closed names it. board_fallback(board) is the one step for a closed made board.
-- 3. not_closed names the board it was merged into with a fallback word, as the closed branch does, when that name cannot be read.
-- 4. move_thread_names: a waiting or held move names the board the thread is on "as of now"; it is commented so.
--
-- Cost: the chain is a handful of boards_now probes, only for a closed board's page or a refused start. Masks: boards and moves are public.
--
-- Ported onto main (merge of #449 Cosmetics, migrations 0205-0213): board_page: rebuilt on 0210's body (main's profile_cosmetics on every face kept), as in 0326.

create function board_fallback(in_board uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select x.id from boards b join acts a on a.id = b.created_by_act join boards_now x on x.id = safe_uuid(a.payload #>> '{params,fallback}')
                   where b.id = in_board and x.id <> in_board and not x.is_system), first_open_board())
$$;
revoke execute on function board_fallback(uuid) from public, anon, authenticated;
grant execute on function board_fallback(uuid) to service_role;

create or replace function board_closed_to(in_board uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n record;
  here uuid := in_board;
  hops integer := 0;
  direct jsonb;
  ref jsonb;
begin
  select * into n from boards_now where id = in_board;
  if n.id is null or not n.closed then return null; end if;
  if n.merged_into is not null then
    direct := jsonb_build_object('mergedInto', (select jsonb_build_object('id', m.id, 'slug', m.slug, 'name', m.name) from boards_now m where m.id = n.merged_into));
  else
    direct := jsonb_build_object('fallback', (select jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name) from boards_now f where f.id = board_fallback(in_board) and f.id <> in_board));
  end if;
  while hops < 50 loop
    select * into n from boards_now where id = here;
    exit when n.id is null or not n.closed;
    here := coalesce(n.merged_into, board_fallback(here));
    hops := hops + 1;
  end loop;
  select jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name) into ref from boards_now f where f.id = here and f.id <> in_board;
  return direct || jsonb_build_object('goesTo', ref);
end $$;
revoke execute on function board_closed_to(uuid) from public, anon;
grant execute on function board_closed_to(uuid) to authenticated;

create or replace function not_closed(on_board uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  went jsonb := board_closed_to(on_board);
  open_name text;
  direct text;
begin
  if went is null then return; end if;
  open_name := coalesce(went -> 'goesTo' ->> 'name', 'another board');
  if went ? 'mergedInto' then
    direct := coalesce(went -> 'mergedInto' ->> 'name', 'another board');
    if direct = open_name then
      raise exception 'this board was merged into %, and its threads are there; start your thread there instead', direct using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    raise exception 'this board was merged into %, which was closed too; its threads are in %, so start your thread there instead', direct, open_name using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  raise exception 'this board was closed, and its threads are in %; start your thread there instead', open_name using hint = 'kayfabb.refusal', errcode = '55000';
end $$;
revoke execute on function not_closed(uuid) from public, anon, authenticated;
grant execute on function not_closed(uuid) to service_role;

-- board_page (0326), with stubs on page one and `goesTo`. Everything else as 0326 wrote it.
create or replace function board_page(in_slug text, in_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with b as (
    select x.id, x.slug, x.name, x.description, x.is_system, x.move_act, x.closed from boards_now x where x.slug = in_slug or x.id::text = in_slug order by (x.slug = in_slug) desc limit 1
  ),
  p as (
    select b.id as board, c.total,
           least(greatest(coalesce(in_page, 1), 1), greatest(1, ceil(c.total / 20.0)::integer)) as page
    from b cross join lateral (select coalesce((select n.threads from board_counts n where n.board = b.id), 0) as total) c
    where not b.closed
  ),
  went as (select board_closed_to(b.id) as to_board from b where b.closed),
  listed as materialized (
    select l.* from thread_list l
    where l.board = (select board from p)
    order by l.last_at desc
    offset (select (page - 1) * 20 from p) limit 20
  ),
  pins as materialized (
    select x.thread, x.play, x.ends_at, x.act from p cross join lateral pinned_threads(p.board) x where p.page = 1
  ),
  banner as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act from p cross join lateral effects_above('{}'::uuid[], null::uuid, p.board) x
  ),
  marked as materialized (
    select (m.act ->> 'id')::uuid as id, m.act ->> 'character' as character, m.act #>> '{payload,card}' as card
    from (select act from pins union all select act from banner) m
  ),
  wanted as (select m.id from marked m where m.card = any (coalesce(effect_cards, '{}'))),
  threads as materialized (
    select l.id, l.first_character, l.last_character from listed l
    union
    select (x.thread ->> 'id')::uuid, (x.thread ->> 'first_character')::uuid, (x.thread ->> 'last_character')::uuid from pins x
  ),
  people as (
    select t.first_character as id from threads t union select t.last_character from threads t union select m.character::uuid from marked m
  )
  select jsonb_build_object(
    'board', to_jsonb(b) - 'closed',
    'closed', b.closed,
    'mergedInto', (select w.to_board -> 'mergedInto' from went w),
    'goesTo', (select w.to_board -> 'goesTo' from went w),
    'fallback', (select w.to_board -> 'fallback' from went w),
    'stubs', case when p.page = 1 then board_stubs(p.board) else '[]'::jsonb end,
    'total', coalesce(p.total, 0),
    'page', coalesce(p.page, 1),
    'threads', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from listed l),
    'pins', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.act ->> 'created_at')::timestamptz desc, x.play desc), '[]'::jsonb) from pins x),
    'banner', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from banner x),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', s.play, 'state', s.state, 'saved_at', s.saved_at)), '[]'::jsonb)
               from effect_state s where s.play in (select id from wanted)),
    'releases', (select coalesce(jsonb_agg(jsonb_build_object('play', r.play)), '[]'::jsonb)
                 from effect_releases r where r.play in (select id from wanted)),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select id from marked)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'character', r.character)), '[]'::jsonb)
             from my_reactions r where r.act in (select id from marked)),
    'reading', (select coalesce(jsonb_agg(jsonb_build_object('thread', r.thread, 'furthest_seq', r.furthest_seq)), '[]'::jsonb)
                from reading r where r.thread in (select id from threads)),
    'views', (select coalesce(jsonb_agg(jsonb_build_object('thread', v.thread, 'views', v.views)), '[]'::jsonb)
              from thread_view_counts v where v.thread in (select id from threads)),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) || profile_cosmetics(f.character) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select id from people where id is not null)),
    'presence', case when p.board is null then null else presence_box('board', p.board) end,
    'unread', my_alerts_unread())
  from b left join p on p.board = b.id;
end;


comment on function move_thread_names(jsonb) is 'The title now of each thread named and the board it left. For a landed move (act given) that is the board thread_departures recorded; for a waiting or held move (no act) it is the board the thread is on as of now, which is a statement about now: the thread may be moved before the move lands.';
