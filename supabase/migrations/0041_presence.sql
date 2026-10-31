-- Presence: who is browsing a thread, a board and the index (the staff design, section 2,
-- docs/plans/2026-10-31-the-staff-design.md; its plan, docs/plans/2026-10-31-presence-plan.md).
-- phpBB's three boxes in the board's world: "Users browsing this thread", "Users browsing this board"
-- (its page and every thread on it) and "Who is online". Each lists the debuted, unretired characters
-- active there within presenceWindow, names only, longest present first, at most presenceNames of
-- them and then a count of the rest.
--
-- Why a poll and not Realtime presence: a poll is the server's heartbeat from each viewer, one small
-- indexed call per viewer every presencePollSeconds, with no fan-out of a message to every listener
-- (which a busy instance would pay for per delivery), and the server, not the client, says which mask
-- is present, so no client can announce a mask it does not play.
--
-- A mask arrives on its first poll and leaves only by aging out ("instant entry, delayed exit"). A
-- poll writes the one row of the mask it came through and touches no other: above all, it never
-- removes or changes another mask of the same player's. A swap from A to B is therefore never shown
-- as "A left, B arrived" together, a pair that would be computed from one account holding both masks,
-- which "A response never proves a private fact" forbids. B appearing as A goes quiet is built from
-- each mask's own activity, as post times are: a clue, which the game keeps.
--
-- A row is one character's, never an account's, and is overwritten by that character's own polls; it
-- is not an Act and holds nothing of one. No client reads either table: here() answers names and a
-- count of characters, never an account and never which names are the caller's.
--
-- A hidden mask (presence_hidden) is never written and never listed; its own player sees it in the box
-- from their own session's state, never from the server. There is no count of hidden masks. A mask
-- waiting to debut, or retired, is listed nowhere.
--
-- Ways out: a listed mask ages out presenceWindow after its last poll, or its player hides it at once;
-- a hidden mask's switch is its player's, in My characters, any time.

create table presence (
  character uuid primary key references characters (id),
  place_kind text not null check (place_kind in ('thread', 'board', 'index')),
  place uuid,
  -- The board for a board or one of its threads, so a board's box counts its threads; null for the index.
  board uuid,
  place_since timestamptz not null,
  online_since timestamptz not null,
  seen_at timestamptz not null,
  check ((place is null) = (place_kind = 'index')),
  check ((board is null) = (place_kind = 'index'))
);
create index presence_place on presence (place, seen_at);
create index presence_board on presence (board, seen_at);
create index presence_seen on presence (seen_at);
alter table presence enable row level security;
revoke all on presence from anon, authenticated;

create table presence_hidden (
  character uuid primary key references characters (id),
  hidden_at timestamptz not null default now()
);
alter table presence_hidden enable row level security;
revoke all on presence_hidden from anon, authenticated;

-- presenceWindow is a span that may count minutes, as editGrace is (0022's trigger, now for both keys).
create or replace function settings_grace_holds() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key in ('editGrace', 'presenceWindow') and not (
       jsonb_typeof(new.value) = 'object' and new.value ->> 'unit' in ('minute', 'day', 'week', 'month')
       and jsonb_typeof(new.value -> 'count') = 'number' and (new.value ->> 'count')::numeric >= 1
       and (new.value ->> 'count')::numeric <= 1000
       and (new.value ->> 'count')::numeric = trunc((new.value ->> 'count')::numeric)) then
    raise exception '% is a span: a unit of minute, day, week or month and a whole count from 1 to 1000', new.key using errcode = '23514';
  end if;
  return new;
end $$;

-- Whether the caller may present (or hide) a mask: its player only, and only once it has debuted, as
-- played_by (0021) holds. A retired mask is not refused here, as played_by refuses it: its poll writes
-- nothing and still answers the box, and its switch may still be turned. Answers whether it is retired.
create function presence_mask(through uuid, who uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  waiting boolean;
  retired boolean;
begin
  select c.debuted_at is null, c.retired_at is not null into waiting, retired from characters c where c.id = through and c.owner = who;
  if waiting is null then
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if waiting then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return retired;
end $$;

-- One poll: mark the mask the caller came through present at the place (unless it is hidden or
-- retired), then answer the place's box. `through` is null for a player reading with no mask, who is
-- listed nowhere and still sees the box.
create function here(in_kind text, in_place uuid, through uuid) returns jsonb
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

  -- The box. A mask hidden since its last poll drops at once, whatever its row says.
  with listed as (
    select c.id, c.name, case when in_kind = 'index' then p.online_since else p.place_since end as since
    from presence p join characters c on c.id = p.character
    where p.seen_at >= now() - win
      and c.debuted_at is not null and c.retired_at is null and c.owner is not null
      and not exists (select 1 from presence_hidden h where h.character = p.character)
      and case in_kind when 'thread' then p.place = in_place when 'board' then p.board = in_place else true end
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.since, f.id), '[]'::jsonb)
          from (select l.id, l.name, l.since from listed l order by l.since, l.id limit cap) f),
         (select count(*) from listed)
    into shown, total;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;

-- The hide switch: a hidden mask is written nowhere and listed nowhere until its player shows it again.
-- Hiding removes the mask's own row at once, and no other.
create function set_presence_hidden(in_character uuid, hidden boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
begin
  perform presence_mask(in_character, caller);
  if hidden then
    insert into presence_hidden (character) values (in_character) on conflict do nothing;
    delete from presence where character = in_character;
  else
    delete from presence_hidden where character = in_character;
  end if;
  return jsonb_build_object('character', in_character, 'hidden', hidden);
end $$;

-- my_characters (0030), with whether each is hidden from the online lists last, so every column before
-- it is as it was.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden
  from characters c
  cross join lateral (select x.class_key, x.started_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();

-- screen_settings (0039), with how often a page polls and the window "Who is online" counts.
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
                  'presencePollSeconds', 'presenceWindow');

revoke execute on function presence_mask(uuid, uuid) from public, anon, authenticated;
revoke execute on function here(text, uuid, uuid), set_presence_hidden(uuid, boolean) from public, anon;
grant execute on function here(text, uuid, uuid), set_presence_hidden(uuid, boolean) to authenticated;
