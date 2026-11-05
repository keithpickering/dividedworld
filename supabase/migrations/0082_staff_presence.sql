-- Staff in the presence boxes (the staff roster design, section 10; its plan, Task 4).
-- A staff character is listed in a thread's box, and in its board's, for presenceWindow after its own post there, "as a player is after
-- reading". It has no presence row and nobody polls for it: the row is read from its public posts (acts_public), which anyone can read,
-- so the listing is computed from nothing private and says nothing about which player characters read. The developer is not listed
-- (its posts are on the Updates page); a staff character not yet debuted or retired is listed nowhere, as a player's is not.
-- The index's box ("Who is online") never lists staff: they are not online, they posted. Each name carries `staff`, a public fact
-- (characters_public shows a staff key to a visitor), so the box can show the group beside it.
--
-- The cost: the staff rows are one aggregate over a persona's posts in the window, by acts_character (character, created_at), and a
-- roster is a handful of characters; a busy instance adds a handful of rows to a thread's read and a board's, never a read that grows
-- with players. A board's box counts a staff character once, however many of its threads it posted in.
--
-- Ways out: a staff character leaves a box presenceWindow after its last post there; no state is added.

create or replace view presence_listed as
  select c.id, c.name, p.place_kind, p.place, p.board, p.place_since, p.online_since, p.seen_at, false as staff
  from presence p join characters c on c.id = p.character
  where c.debuted_at is not null and c.retired_at is null
    and not exists (select 1 from presence_hidden h where h.character = p.character)
  union all
  select c.id, c.name, 'thread'::text, a.thread, t.board, a.last_at, a.last_at, a.last_at, true
  from characters c
  cross join lateral (
    select x.thread, max(x.created_at) as last_at
    from acts_public x
    where x.character = c.id and x.kind = 'post'
      and x.created_at >= now() - coalesce(span_interval((select s.value from settings s where s.key = 'presenceWindow')), interval '0')
    group by x.thread
  ) a
  join threads t on t.id = a.thread
  where c.staff is not null and c.staff_kind is distinct from 'developer' and c.debuted_at is not null and c.retired_at is null;
revoke all on presence_listed from anon, authenticated;

create or replace function here(in_kind text, in_place uuid, through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  win interval := span_interval(setting('presenceWindow'));
  cap integer := (setting('presenceNames') #>> '{}')::integer;
  at_place uuid := case when in_kind = 'index' then null else in_place end;
  at_board uuid;
  shown jsonb;
  total integer;
begin
  if in_kind = 'thread' then
    select t.board into at_board from threads t where t.id = in_place;
    if at_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind = 'board' then
    select b.id into at_board from boards b where b.id = in_place;
    if at_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind is distinct from 'index' then
    raise exception 'there is no such place to browse' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;

  -- This mask's row, and no other: a swap leaves the old mask to age out by its own seen_at.
  if through is not null and not presence_mask(through, caller)
     and not exists (select 1 from presence_hidden h where h.character = through) then
    insert into presence as p (character, place_kind, place, board, place_since, online_since, seen_at)
    values (through, in_kind, at_place, at_board, now(), now(), now())
    on conflict (character) do update set
      online_since = case when p.seen_at < now() - win then now() else p.online_since end,
      place_since = case when p.seen_at < now() - win or p.place_kind <> excluded.place_kind or p.place is distinct from excluded.place
                         then now() else p.place_since end,
      place_kind = excluded.place_kind, place = excluded.place, board = excluded.board, seen_at = now();
  end if;

  -- The box, read by one statement per kind of place (0041). A board's box reads a staff character's rows (one per thread it posted in)
  -- as one name; the index never lists a staff character.
  if in_kind = 'thread' then
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff) order by f.place_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.staff, l.place_since from presence_listed l
                  where l.place = in_place and l.seen_at >= now() - win order by l.place_since, l.id limit cap) f),
           (select count(*) from presence_listed l where l.place = in_place and l.seen_at >= now() - win)
      into shown, total;
  elsif in_kind = 'board' then
    with b as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', false) order by f.online_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.online_since from presence_listed l
                  where not l.staff and l.seen_at >= now() - win order by l.online_since, l.id limit cap) f),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;

revoke execute on function here(text, uuid, uuid) from public, anon;
grant execute on function here(text, uuid, uuid) to authenticated;

-- screen_settings (0073), with the group's name: the screens draw it beside every staff name. A setting, public.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select k.price_setting from card_kinds k union select unnest(k.reads) from card_kinds k))) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'staffGroup');
