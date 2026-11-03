-- The settle run's claim, held until its window is applied: docs/plans/2026-11-03-settle-claim-plan.md, built from
-- docs/plans/2026-11-03-settle-claim-design.md. Each function replaced here is copied from its latest definition and changed only
-- as its header says.

-- ------------------------------------------------------------------------ the settle run's claim ----

-- Task 1 (#179's second and fourth follow-ups, the design's section 1). A claim (0072) refused a reveal only while it was under five
-- minutes old, and one window's settlement_input, settle() and apply_settlement can together outlast five minutes on a busy instance:
-- a reveal after that named the class a Turn replaces, dated after the Turn took effect (#22). No clock can tell a live run from a
-- dead one, so a claim now holds until a settlement past its start is written: its own window's, or, for a stale claim made by an
-- overlapping run whose window ended differently, the other run's. A claim on a window that has not yet ended refuses nothing.
--
-- A claim is a run's clock, never an Act, and no instance is deployed, so the claims standing are dropped rather than given a start.
delete from settlement_claims;
alter table settlement_claims add column window_start timestamptz not null;
alter table settlement_claims add constraint settlement_claims_window check (window_end > window_start);

drop function claim_settlement_window(timestamptz);
create function claim_settlement_window(window_start timestamptz, window_end timestamptz) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into settlement_claims (window_start, window_end, claimed_at) values (claim_settlement_window.window_start, claim_settlement_window.window_end, now())
  on conflict on constraint settlement_claims_pkey do update set window_start = excluded.window_start, claimed_at = now()
$$;
revoke execute on function claim_settlement_window(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function claim_settlement_window(timestamptz, timestamptz) to service_role;

-- The claims a settlement voids, deleted in the transaction that writes it (apply_settlement's): every claim whose window starts
-- before the settlement's end. A claim on a later window is kept. A claim made after a settlement past its start (a late or second
-- run on a window already applied) is not deleted, since no settlement follows it; it refuses nothing (unmask's condition), and the
-- next settlement deletes it.
create function settlement_voids_claims() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from settlement_claims k where k.window_start < new.ends_at;
  return null;
end $$;
revoke execute on function settlement_voids_claims() from public, anon, authenticated;
create trigger settlement_voids_claims after insert on settlements for each row execute function settlement_voids_claims();

-- unmask() (0072), its claim held until a settlement past the claim's start is written, with no clock, and refusing only once the
-- claimed window has ended; both refusals say one sentence that names the player's way out (#177, the design's section 2). The
-- refusal turns on the caller's own character's own Turn and on the run's state, never on another player; that a settlement is due
-- or running is public, since when The System settles is the same for everyone. Its ways out: the run applies the window, by itself
-- (a dead run's claim gives way when the next firing applies it), and the player may withdraw the Turn at any time, on My characters.
-- Everything else as 0072 wrote it.
create or replace function unmask(through uuid, in_thread uuid, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  if exists (select 1 from pending_turns p where p.character = through and (
       next_settlement_at(p.asked_at) <= now()
       or exists (select 1 from settlement_claims k
                  where k.window_end > p.asked_at and k.window_end <= now()
                    and not exists (select 1 from settlements s where s.ends_at > k.window_start)))) then
    raise exception 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return write_unmask(through, in_thread, 'act', now(), said);
end $$;

-- --------------------------------------------------------------------------- the backstop ----

-- Task 2 (the design's sections 3 and 4). When a waiting Turn was first passed over because its character revealed after the window's
-- end, and so when it was due: the settlement's end it waited past. Null on every row before this change, which no settlement passed
-- over. Neither is an Act: a Turn is private. Both are read only through my_characters, bounded by the caller's own characters.
alter table pending_turns add column due_at timestamptz;
alter table class_history add column due_at timestamptz;

-- masks_change (0072), passing over a Turn whose character revealed at or after the window's end, and recording when it was due.
-- Everything else as 0072 wrote it.
create or replace function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most constant integer := 100;
  in_season bigint;
  first_tally uuid;
  posted jsonb;
  unmasked jsonb;
  parts integer;
  r record;
begin
  if to_regclass('pg_temp.masks_named') is null then
    create temp table masks_named (n bigint, kind text, entry jsonb, unmasks boolean) on commit drop;
    create temp table masks_turns (character uuid, class_key text, loudness text, show_from boolean, show_to boolean, name text, was text, due_at timestamptz) on commit drop;
  end if;
  truncate masks_named, masks_turns;
  -- The characters made before the window's end, and still waiting, debut at it; the announced
  -- ones are named. One made in a transaction this one could not see yet waits for the next
  -- settlement. A drop locks its character's row first, so one dropped while this runs is either
  -- debuted here (and its drop refused, "it has debuted") or by its drop (and not here).
  -- A retired character makes no Act: one owed its announcement across a gap and retired since is
  -- named, as it was due to be, and never unmasked, or no settlement could write its tally.
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name, debut_loudness, retired_at
  ), owed as (
    update characters set debut_announcement_due = false where debut_announcement_due and debuted_at < window_end returning id, name, debut_loudness, retired_at
  ) insert into masks_named (n, kind, entry, unmasks)
    select row_number() over (order by name, id), 'debut', jsonb_build_object('character', id, 'name', name), debut_loudness = 'with_class' and retired_at is null
    from (select id, name, debut_loudness, retired_at from d where debut_loudness <> 'silent' union all select id, name, debut_loudness, retired_at from owed) named;
  -- The Turns asked before the window's end take effect at it; their characters' rows are locked
  -- first, in one order, so a turn() racing this one waits and then reads what took effect. What
  -- a loud Turn says is read before the Turn is written.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  -- The backstop (the design's section 3): a Turn whose character revealed at or after the window's end does not take effect behind
  -- that reveal, which would make it false on its own date (#22). The claim (unmask) refuses such a reveal from the moment the run
  -- claims its window, but the run claims it only after it has asked for it: pg_cron's call, the function's start and
  -- next_settlement_window fall between the window's end and the claim. The Turn waits for the next window instead, by itself, and
  -- its player can change or withdraw it meanwhile. unmask() locks the character's row before it checks and writes, and the lock
  -- above is taken first, so a reveal goes wholly before this statement, which then sees it (a statement's snapshot is taken after
  -- the lock it waited on, under read committed), or wholly after it, naming the new class. The reveals this function writes come
  -- after this statement, so a debut's or a Turn's own reveal at this window's end holds back no Turn here.
  insert into masks_turns
    select p.character, p.class_key, p.loudness, p.show_from, p.show_to, c.name, n.class_key, p.due_at
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end
      and not exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and a.created_at >= window_end);
  -- A Turn passed over is due at the first window it was passed over at; its record, never an Act, since a Turn is private.
  update pending_turns set due_at = coalesce(due_at, window_end) where asked_at < window_end and character not in (select character from masks_turns);
  insert into class_history (character, class_key, started_at, due_at) select character, class_key, window_end, due_at from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry, unmasks)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when show_from then jsonb_build_object('was', was) else '{}'::jsonb end
      || case when show_to then jsonb_build_object('class', class_key) else '{}'::jsonb end,
      show_to
    from masks_turns where loudness <> 'silent';
  update masks_named m set entry = m.entry || jsonb_build_object('class', (select class_key from class_now((m.entry ->> 'character')::uuid, window_end)))
  where m.kind = 'debut' and m.unmasks;
  if not exists (select 1 from masks_named) then return null; end if;

  select id into in_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1;
  parts := ((select count(*) from masks_named) + most - 1) / most;
  for part in 1..parts loop
    posted := post_tally(in_season,
      (select coalesce(jsonb_agg(entry order by n) filter (where kind = 'debut'), '[]') from masks_named where (n - 1) / most = part - 1),
      (select coalesce(jsonb_agg(entry order by n) filter (where kind = 'turn'), '[]') from masks_named where (n - 1) / most = part - 1),
      window_end, part, parts);
    if posted -> 'thread' <> 'null'::jsonb then
      perform broadcast_later('board:' || (posted -> 'thread' ->> 'board'), 'thread', posted -> 'thread');
    end if;
    first_tally := coalesce(first_tally, (posted -> 'act' ->> 'id')::uuid);
    perform broadcast_later('thread:' || (posted -> 'act' ->> 'thread'), 'act', posted -> 'act');
    -- The part's reveals, in its order, right after it: the character's own Acts, by The System's hand.
    for r in select kind, entry from masks_named where (n - 1) / most = part - 1 and unmasks order by n loop
      unmasked := write_unmask((r.entry ->> 'character')::uuid, (posted -> 'act' ->> 'thread')::uuid, r.kind, window_end);
      perform broadcast_later('thread:' || (unmasked ->> 'thread'), 'act', unmasked);
    end loop;
  end loop;
  return first_tally;
end $$;

-- turn() (0028), a changed Turn clearing due_at: asked again, it is a new ask, due at its own window. Everything else as 0028 wrote
-- it.
create or replace function turn(through uuid, to_class text, loudness text, show_from boolean, show_to boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text;
  last_turn timestamptz;
  next_allowed timestamptz;
begin
  perform acting(through);
  if loudness is null or loudness not in ('silent', 'announced') then
    raise exception 'a Turn is silent or announced' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if show_from is null or show_to is null then
    raise exception 'a Turn names its classes or does not' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if loudness = 'silent' and (show_from or show_to) then
    raise exception 'a silent Turn names no class' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = to_class) then
    raise exception 'there is no class "%"', to_class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One Turn of a character's at a time, and none while a settlement makes one take effect
  -- (masks_change locks the same row), so the cooldown is read from what took effect.
  perform 1 from characters where id = through for no key update;
  select class_key into was from class_now(through, 'infinity');
  if was = to_class then
    if exists (select 1 from pending_turns where character = through) then
      raise exception 'this character already is one: withdraw its waiting Turn to keep it' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    raise exception 'this character already is one' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The cooldown runs from the last Turn's taking effect; a character's first class is not a Turn.
  select max(started_at) into last_turn from class_history h
  where h.character = through and h.started_at > (select min(started_at) from class_history where character = through);
  next_allowed := last_turn + span_interval(setting('turnCooldown'));
  if next_allowed > now() then
    raise exception 'this character can Turn again at %', to_char(next_allowed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  -- Asked again before the settlement, it is the same Turn, changed.
  insert into pending_turns (character, class_key, loudness, show_from, show_to) values (through, to_class, loudness, show_from, show_to)
  on conflict (character) do update set class_key = excluded.class_key, loudness = excluded.loudness, show_from = excluded.show_from, show_to = excluded.show_to,
    asked_at = clock_timestamp(), due_at = null;
  -- Read at the moment it was asked, as masks_change() reads asked_at.
  return jsonb_build_object('pending', true, 'class', to_class, 'loudness', loudness, 'show_from', show_from, 'show_to', show_to,
    'takes_effect_at', next_settlement_at(clock_timestamp()));
end $$;

-- my_characters (0041), with when the class's Turn was due, where a reveal made it wait, last, since a view can only gain columns at
-- its end; the grants are as 0030 left them.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();
