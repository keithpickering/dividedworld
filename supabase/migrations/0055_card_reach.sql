-- Cards beyond a post: a card lands on a character, a thread or a board when it lists that reach, and every such play ends on its
-- timer. docs/plans/2026-11-01-card-reach-plan.md, Tasks 2, 5 and 6; docs/plans/2026-11-01-card-mechanic-design.md, sections 7, 8
-- and 11.
--
-- A play beyond a post is a card Act like any other, with its reach and its target in its payload (`reach`, and `character`,
-- `thread` or `board`) and its end (`ends`), and a play_reach row written with it that holds the same target and end by index:
--   a character play  sits in the thread it was played in, with target_act_id the post whose postbit took it, so "Go to post" and
--                     a spin's ORIGIN box still have a post; the post's author is the character it lands on
--   a thread play     sits in that thread, with target_act_id its first post
--   a board play      sits in The System's announcements thread (systemAnnouncements, 0048), with target_act_id null, which the
--                     target check allows for a card whose payload's reach is board, and for no other Act
-- A play on a post names no reach (a post's unless it says), as every play written before 0055 does, so nothing already written
-- changes and every existing play reads as a post's. A play beyond a post is never an effect on the post it sits on: card_target,
-- play_card's stack and ward, and the settlement read only plays whose reach is a post's.
--
-- Ways out: every play beyond a post ends at its play_reach row's ends_at, which is now() + least(the card's lasts, its reach's
-- reachLasts) when it lands, a fact of the play, never edited (play_reach refuses UPDATE). A board carries one board card at a
-- time, so a board is held by a card for at most reachLasts.board. A pin (Task 5) ends with its play.
--
-- The masks (design, section 11): a character play falls on the mask alone. Nothing here reads characters.owner: not play_card's
-- target checks, not play_reach, not effects_above, not card_target_reach. A refusal reads only public facts: the card's reaches
-- and rarity, the target's live plays, a board's live board card.
--
-- Locks, in one order: the caster's account, then the target's row (the post, the character, the thread or the board). Two board
-- cards on one board both wait on the board's row, so the second counts the first.

-- ------------------------------------------------------------------------------ card kinds ----

-- A card's reaches: one to four of the four, each once.
create function reaches_hold(reaches text[]) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select cardinality(reaches) between 1 and 4 and reaches <@ array['post', 'character', 'thread', 'board']
    and cardinality(reaches) = (select count(distinct r) from unnest(reaches) r)
$$;

-- Where a card lands, a post unless it says, and whether a thread play of it pins its thread (Main Event's kind; pinned_threads
-- below reads it, added here so the column and its seed land once). A card
-- beyond a post ends at its time (lasts), which is now a Use's or a card's that reaches beyond a post; a Set lands on a post alone.
alter table card_kinds
  add column reaches text[] not null default '{post}',
  add column pins boolean not null default false,
  add constraint card_kinds_reaches check (reaches_hold(reaches)),
  add constraint card_kinds_set_on_post check (play <> 'set' or reaches = '{post}'),
  add constraint card_kinds_beyond_lasts check (reaches = '{post}' or lasts is not null),
  add constraint card_kinds_pins_thread check (not pins or 'thread' = any (reaches)),
  drop constraint card_kinds_lasts_use,
  add constraint card_kinds_lasts_use check (lasts is null or play = 'use' or reaches <> '{post}');

-- How a refusal lists a card's reaches: "a post", "a character or a thread", as landsOn says it (engine/rules/cards.ts).
create function reach_list(reaches text[]) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when cardinality(said) < 2 then array_to_string(said, '')
              else array_to_string(said[1:cardinality(said) - 1], ', ') || ' or ' || said[cardinality(said)] end
  from (select array_agg('a ' || r order by n) as said from unnest(reaches) with ordinality u(r, n)) s
$$;

-- A span as a refusal says it: "7 days", "1 week" (instance.ts's spanWords).
create function span_words(span jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select format('%s %s%s', span ->> 'count', span ->> 'unit', case when (span ->> 'count') = '1' then '' else 's' end)
$$;

-- A refusal's time, to the minute in UTC, as engine/rules/cards.ts's refusalTime says it.
create function refusal_time(at timestamptz) returns text
language sql immutable set search_path = public, pg_temp as $$
  select to_char(at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
$$;

-- A value as JSON.stringify writes it, with no space after a comma or a colon, so a refusal reads the same from the seed as from
-- instanceProblems. (A string holding ", " is shown without its space; a refusal's quote of a seed is all this is for.)
create function compact_json(v jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(v::text, '([,:]) ', '\1', 'g')
$$;

-- Whether a value is a span as span_interval reads one: a unit of day, week or month and a whole count from 1 to 1000.
create function span_holds(v jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(v) = 'object' and v ->> 'unit' in ('day', 'week', 'month')
    and case when jsonb_typeof(v -> 'count') = 'number'
             then (v ->> 'count')::numeric between 1 and 1000 and (v ->> 'count')::numeric = trunc((v ->> 'count')::numeric) else false end, false)
$$;

-- What is wrong with a seed's cards' reaches, as instanceProblems (engine/rules/instance.ts's reachProblems) says it, or null: a
-- list of the four reaches, each once; a Set on a post alone; a time up beyond a post; no reach beyond its rarity's (reachRarity);
-- no time up past its reach's bound (reachLasts). The settings are read as the seed has just written them.
create function card_reach_problem(cards jsonb) returns text
language sql stable set search_path = public, pg_temp as $$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, e -> 'reaches' as reaches, e -> 'lasts' as lasts
    from jsonb_array_elements(coalesce(cards, '[]')) e where e ? 'reaches'
  ), shaped as (
    select c.*, jsonb_typeof(c.reaches) = 'array' and jsonb_array_length(c.reaches) between 1 and 4
      and not exists (select 1 from jsonb_array_elements(c.reaches) r where jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('post', 'character', 'thread', 'board'))
      and (select count(distinct r) from jsonb_array_elements(c.reaches) r) = jsonb_array_length(c.reaches) as ok
    from c
  ), beyond as (
    select s.key, r.reach, r.n from shaped s, unnest(array['character', 'thread', 'board']) with ordinality r(reach, n)
    where s.ok and s.reaches ? r.reach
  )
  select string_agg(why, '; ' order by key, n) from (
    select s.key, 0 as n, format('card "%s" reaches %s; a card reaches a list of post, character, thread or board, each once', s.key, compact_json(s.reaches)) as why
    from shaped s where not s.ok
    union all
    select s.key, 1, format('card "%s" is set face down, and a Set lands only on a post', s.key)
    from shaped s where s.ok and s.play = 'set' and exists (select 1 from beyond b where b.key = s.key)
    union all
    select s.key, 2, format('card "%s" reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time', s.key)
    from shaped s where s.ok and s.lasts is null and exists (select 1 from beyond b where b.key = s.key)
    union all
    select b.key, 10 + 2 * b.n, format('card "%s" reaches a %s, which takes a card of %s or rarer; it is %s', b.key, b.reach, floor.rarity, s.rarity)
    from beyond b join shaped s on s.key = b.key
    cross join lateral (select setting('reachRarity') ->> b.reach as rarity) floor
    where rarity_rank(s.rarity) < rarity_rank(floor.rarity)
    union all
    select b.key, 11 + 2 * b.n, format('card "%s" lasts %s, longer than a %s effect may (reachLasts.%s, %s)', b.key, span_words(s.lasts), b.reach, b.reach, span_words(bound.span))
    from beyond b join shaped s on s.key = b.key
    cross join lateral (select setting('reachLasts') -> b.reach as span) bound
    -- A time up that is no span is card_kinds_problem's to name; it is read as an interval only once it is one.
    where s.lasts is not null and case when span_holds(s.lasts) and span_holds(bound.span) then span_interval(s.lasts) > span_interval(bound.span) else false end
  ) p where why is not null
$$;

-- ------------------------------------------------------------------------------ the settings ----

-- reachRarity gives each reach beyond a post its least rarity, and reachLasts its longest time up, each naming the three reaches
-- and nothing else, held when written as setLasts is (0054), since play_card and the seed read them.
create function settings_reach_hold() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key = 'reachRarity' and not coalesce(jsonb_typeof(new.value) = 'object'
       and (select array_agg(k order by k) from jsonb_object_keys(new.value) k) = array['board', 'character', 'thread']
       and (select bool_and(rarity_rank(v #>> '{}') is not null and jsonb_typeof(v) = 'string') from jsonb_each(new.value) e(k, v)), false) then
    raise exception 'reachRarity gives character, thread and board each a rarity (common, uncommon, rare or legendary)' using errcode = '23514';
  end if;
  if new.key = 'reachLasts' and not coalesce(jsonb_typeof(new.value) = 'object'
       and (select array_agg(k order by k) from jsonb_object_keys(new.value) k) = array['board', 'character', 'thread']
       and (select bool_and(jsonb_typeof(v) = 'object' and v ->> 'unit' in ('day', 'week', 'month')
              and case when jsonb_typeof(v -> 'count') = 'number'
                       then (v ->> 'count')::numeric between 1 and 1000 and (v ->> 'count')::numeric = trunc((v ->> 'count')::numeric) else false end)
            from jsonb_each(new.value) e(k, v)), false) then
    raise exception 'reachLasts gives character, thread and board each a span: a unit of day, week or month and a whole count from 1 to 1000' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_reach_hold before insert or update on settings for each row execute function settings_reach_hold();

-- ---------------------------------------------------------------------------- the card Acts ----

-- A board play points at no post; it is the one card that may, and only a card whose payload says its reach is a board.
alter table acts drop constraint acts_check1;
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask', 'move') or target_act_id is not null
  or (kind = 'card' and payload ->> 'reach' = 'board'));
-- A card's reach, where it names one, is one of the four, and a board play points at no post.
alter table acts add constraint acts_card_reach check (kind <> 'card' or (
  coalesce(payload ->> 'reach', 'post') in ('post', 'character', 'thread', 'board')
  and ((coalesce(payload ->> 'reach', 'post') = 'board') = (target_act_id is null))) is true);

-- ------------------------------------------------------------------------------- play_reach ----

-- Each play beyond a post, by its target and its end: exactly one target column, the one its reach names, written with the play's
-- Act and never edited. The indexes make a page's read of the live plays above it one probe per character asked, one for its
-- thread and one for its board (effects_above), and a board's live thread plays one probe (pinned_threads, Task 5).
create table play_reach (
  play uuid primary key references acts (id),
  reach text not null check (reach in ('character', 'thread', 'board')),
  character uuid references characters (id),
  thread uuid references threads (id),
  board uuid references boards (id),
  ends_at timestamptz not null,
  -- A thread play whose card pins (Main Event's kind): the thread's board, so the board's live pins are one index probe
  -- (pinned_threads). Not a target: the play's target is its thread.
  pins_board uuid references boards (id),
  check (pins_board is null or reach = 'thread'),
  check ((character is not null)::integer + (thread is not null)::integer + (board is not null)::integer = 1),
  check ((reach = 'character') = (character is not null) and (reach = 'thread') = (thread is not null) and (reach = 'board') = (board is not null))
);
create index play_reach_character on play_reach (character, ends_at) where character is not null;
create index play_reach_thread on play_reach (thread, ends_at) where thread is not null;
create index play_reach_board on play_reach (board, ends_at) where board is not null;
create index play_reach_pins on play_reach (pins_board, ends_at) where pins_board is not null;

create function play_reach_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a play beyond a post is never edited; it ends at its time' using errcode = '55000';
end $$;
create trigger play_reach_no_update before update or delete on play_reach for each row execute function play_reach_append_only();
create trigger play_reach_no_truncate before truncate on play_reach for each statement execute function play_reach_append_only();

-- Read as the Acts are, by a signed-in player (acts, 0001): a play's reach, its target and its end are on its Act already. Written only
-- by play_card. Its truncate guard fires on a restore too, as the ledgers' do.
alter table play_reach enable row level security;
revoke all on play_reach from public, anon, authenticated;
grant select on play_reach to authenticated;
create policy read on play_reach for select to authenticated using (true);
alter table play_reach enable always trigger play_reach_no_update;
alter table play_reach enable always trigger play_reach_no_truncate;

-- ------------------------------------------------------------------------------ play_card ----

-- play_card (0054), with a reach. On a post (`reach` 'post', the default) everything is as 0054 wrote it, but that a play beyond a
-- post sitting on the post is neither a layer nor a ward there. Beyond a post, `target` is the character, the thread or the board,
-- and a character play names the post whose postbit took it (`from_post`), which must be that character's: the card must list the
-- reach, the target's row is locked, its stack is counted against its live plays (a board's against every live board card), and
-- the play_reach row is written with the Act, ending at now() + least(the card's lasts, reachLasts). Ward and trap checks run on a
-- post target only, since a ward and a card back sit on posts. A Use beyond a post goes on the caller's own character, or any
-- thread. The answer is the play's projection, with the spring's (`sprung`) where a post's trap sprang.
drop function play_card(uuid, text, uuid, uuid, jsonb, integer, text);
create function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text default '',
                          reach text default 'post', from_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  target_kind text;
  author uuid;
  in_thread uuid;
  on_post uuid := target;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded record;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
begin
  perform played_by(through, who);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = play_card.card;
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  select * into kind_of from card_kinds k where k.key = play_card.card;
  if kind_of.play = 'set' then raise exception '% is set face down on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if kind_of.play not in ('cast', 'use') then raise exception '% is not played on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not (reach = any (kind_of.reaches)) then
    raise exception 'this card lands on %', reach_list(kind_of.reaches) using hint = 'kayfabb.refusal', errcode = '22023';
  end if;

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from through then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- A live ward on the post turns away a cast at or below its rarity, in the same words for everyone (cards.ts's wardWords).
    if kind_of.play = 'cast' then
      select wk.name, wk.rarity into warded from acts w join card_kinds wk on wk.key = w.payload ->> 'card'
      where w.kind = 'card' and w.target_act_id = target and wk.ward and not (w.payload ? 'caught') and coalesce(w.payload ->> 'reach', 'post') = 'post'
        and (w.payload ->> 'ends' is null or (w.payload ->> 'ends')::timestamptz > now())
        and rarity_rank(kind_of.rarity) <= rarity_rank(wk.rarity)
      order by rarity_rank(wk.rarity) desc limit 1;
      if warded.name is not null then
        raise exception 'this post''s % turns away cards up to %', warded.name, warded.rarity using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    select count(*) filter (where k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post';
    if up >= kind_of.stack then
      if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    if kind_of.play = 'cast' then sprung := spring_traps('cast', target, written, null, kind_of.rarity, who, price); end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select a.thread into in_thread from acts_public a where a.id = from_post and a.kind = 'post' and a.character = target;
      if in_thread is null then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from through then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      in_thread := target;
      select a.id into on_post from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
    else
      perform 1 from boards b where b.id = target for no key update;
      if not found then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.id into in_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
      if in_thread is null then
        raise exception 'there is no announcements thread to play a board card in yet' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
      on_post := null;
      -- One board card at a time, of any card.
      select max(r.ends_at) into live_board from play_reach r where r.board = target and r.ends_at > now();
      if live_board is not null then
        raise exception 'this board already carries a board card until %', refusal_time(live_board) using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    select count(*) into up from play_reach r join acts k on k.id = r.play
    where r.ends_at > now() and k.payload ->> 'card' = card
      and case play_card.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
    if up >= kind_of.stack then
      where_words := 'this ' || reach;
      if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
  end if;

  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, through, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends)
              when sprung is not null then jsonb_build_object('caught', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when reach = 'post' and kind_of.play = 'use' and kind_of.lasts is not null then jsonb_build_object('ends', now() + kind_of.lasts) else '{}'::jsonb end);
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;
revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid) to service_role;

-- -------------------------------------------------------------------------- pinned_threads ----

-- A board's threads with a live thread play whose card pins (Main Event's kind, Task 5), each with the play's Act and its end,
-- newest pin first: what the board's list draws above page 1's threads. One probe of play_reach_pins, reading only live rows, so its
-- cost is the board's live pins, never its threads. Read by a signed-in player, as the Acts are. A pin ends with its play.
create function pinned_threads(board uuid) returns table (thread jsonb, play uuid, ends_at timestamptz, act jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(t), r.play, r.ends_at, to_jsonb(a)
  from play_reach r join thread_list t on t.id = r.thread join acts_public a on a.id = r.play
  where r.pins_board = pinned_threads.board and r.ends_at > now()
  order by a.created_at desc, a.id desc
$$;
revoke execute on function pinned_threads(uuid) from public, anon, authenticated;
grant execute on function pinned_threads(uuid) to authenticated;

-- ---------------------------------------------------------------------------- card_target ----

-- card_target (0054), saying its reach, with a play beyond a post that sits on the post left off it: it is the character's, the
-- thread's or the board's, never the post's. Everything else as 0054 wrote it.
create or replace function card_target(target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'ward', case when ck.ward then ck.rarity end, 'ends', k.payload ->> 'ends')) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught') and coalesce(k.payload ->> 'reach', 'post') = 'post'
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
  from acts_public a where a.id = target
$$;

-- The live plays on one target beyond a post, as effects (`{card, act, reach, ends, ward?}`), oldest first: what landsOn counts.
create function reach_effects(of_reach text, of_target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id, 'reach', r.reach,
      'ends', to_jsonb(r.ends_at), 'ward', case when ck.ward then ck.rarity end)) order by k.created_at, k.id), '[]')
  from play_reach r join acts k on k.id = r.play left join card_kinds ck on ck.key = k.payload ->> 'card'
  where r.ends_at > now() and case of_reach when 'character' then r.character = of_target when 'thread' then r.thread = of_target
                                            when 'board' then r.board = of_target else false end
$$;

-- What a card's rules see on a target of any reach (engine/rules/cards.ts's CardTarget, with the target's own `effects` and the
-- live ones `above` it, for effectsOnTarget): a post as card_target reads it, with its author's, its thread's and its board's; a
-- character with the thread and board of the post it is played from (`from_post`), where one is given; a thread with its board; a
-- board alone. Null for a reach that is none or a target that is not there.
create function card_target_reach(reach text, target uuid, from_post uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  got jsonb;
  t_thread uuid;
  t_board uuid;
  t_character uuid;
begin
  if reach = 'post' then
    got := card_target(target);
    if got is null then return null; end if;
    select a.character, a.thread, th.board into t_character, t_thread, t_board from acts a join threads th on th.id = a.thread where a.id = target;
    return got || jsonb_build_object('above', jsonb_strip_nulls(jsonb_build_object(
      'character', case when t_character is not null then reach_effects('character', t_character) end,
      'thread', reach_effects('thread', t_thread), 'board', reach_effects('board', t_board))));
  elsif reach = 'character' then
    if not exists (select 1 from characters c where c.id = target) then return null; end if;
    select a.thread, th.board into t_thread, t_board from acts_public a join threads th on th.id = a.thread
    where a.id = from_post and a.kind = 'post' and a.character = target;
    return jsonb_build_object('reach', 'character', 'character', target, 'effects', reach_effects('character', target),
      'above', jsonb_strip_nulls(jsonb_build_object('thread', case when t_thread is not null then reach_effects('thread', t_thread) end,
                                                    'board', case when t_board is not null then reach_effects('board', t_board) end)));
  elsif reach = 'thread' then
    select th.board into t_board from threads th where th.id = target;
    if t_board is null then return null; end if;
    return jsonb_build_object('reach', 'thread', 'thread', target, 'effects', reach_effects('thread', target),
      'above', jsonb_build_object('board', reach_effects('board', t_board)));
  elsif reach = 'board' then
    if not exists (select 1 from boards b where b.id = target) then return null; end if;
    return jsonb_build_object('reach', 'board', 'board', target, 'effects', reach_effects('board', target), 'above', '{}'::jsonb);
  end if;
  return null;
end $$;
revoke execute on function reach_effects(text, uuid), card_target_reach(text, uuid, uuid) from public, anon, authenticated;
grant execute on function card_target_reach(text, uuid, uuid) to authenticated;

-- --------------------------------------------------------------------------- effects_above ----

-- The live plays above a page's posts: on its distinct authors, its thread and its board, each with its Act as acts_public shows it,
-- in one query, to a signed-in player, as the Acts are read (acts_public, 0001). At most 200 characters at once (the client asks in chunks, as cardsOnMany does), so its cost is one probe of
-- play_reach_character per character asked, one of play_reach_thread and one of play_reach_board, each reading only live rows.
create function effects_above(characters uuid[], thread uuid, board uuid)
returns table (play uuid, reach text, target uuid, ends_at timestamptz, act jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if cardinality(characters) > 200 then
    raise exception 'effects_above reads at most 200 characters at once' using hint = 'kayfabb.refusal', errcode = '54000';
  end if;
  return query
    select r.play, r.reach, coalesce(r.character, r.thread, r.board), r.ends_at, to_jsonb(a)
    from (
      select x.* from play_reach x where x.character = any (coalesce(effects_above.characters, '{}')) and x.ends_at > now()
      union all
      select x.* from play_reach x where x.thread = effects_above.thread and x.ends_at > now()
      union all
      select x.* from play_reach x where x.board = effects_above.board and x.ends_at > now()
    ) r join acts_public a on a.id = r.play
    order by a.created_at, a.id;
end $$;
revoke execute on function effects_above(uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function effects_above(uuid[], uuid, uuid) to authenticated;

-- ------------------------------------------------------------- the readers of a post's plays ----

-- A play beyond a post that sits on a post is not that post's play. spring_traps (0054), with a strike's stack counted from the
-- struck post's own plays alone; everything else as 0054 wrote it.
create or replace function spring_traps(trigger text, post uuid, by_act uuid, quadrant text default null, incoming_rarity text default null,
                             caster uuid default null, price integer default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  kind_of card_kinds%rowtype;
  struck card_kinds%rowtype;
  setter_character uuid;
  springs boolean;
  outcome text;
  sprung uuid;
  struck_play uuid;
  layer integer;
  up integer;
begin
  select f.* into fd from face_down f
  where f.post = spring_traps.post and f.ends_at > now()
  order by f.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  select * into kind_of from card_kinds k where k.key = fd.card;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  springs := kind_of.trap #>> '{trigger,on}' is not distinct from trigger
    and (trigger <> 'reaction' or kind_of.trap #>> '{trigger,quadrant}' is not distinct from quadrant)
    and (trigger <> 'cast' or coalesce(rarity_rank(incoming_rarity) <= rarity_rank(kind_of.rarity), false));
  if not springs then return null; end if;
  outcome := kind_of.trap #>> '{outcome,do}';
  select a.character into setter_character from acts a where a.id = fd.play;
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its trap stays set until its
  -- time, and the write that met it lands as if no trap were there (acts_well_formed would refuse the spring, and with it the write).
  if exists (select 1 from characters c where c.id = setter_character and (c.retired_at is not null or c.debuted_at is null)) then return null; end if;
  if outcome = 'strike' then
    select * into struck from card_kinds k where k.key = kind_of.trap #>> '{outcome,card}';
    -- A strike that cannot land leaves the trap set: its target already carries its stack of the card, counted as play_card counts
    -- it (the plays still up), with the layer going on from the last one taken.
    select count(*) filter (where k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = by_act and k.payload ->> 'card' = struck.key and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post';
    if struck.key is null or by_act is null or up >= struck.stack
       or (select a.kind from acts a where a.id = by_act) is distinct from 'post' then return null; end if;
  end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'outcome', kind_of.trap -> 'outcome', 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and outcome in ('nullify', 'payout') then by_act::text end))) returning id into sprung;
  if outcome = 'payout' and coalesce(price, 0) > 0 and caster is not null then
    -- Both wallets, in account order, so two players' casts on each other's traps cannot wait on each other.
    insert into wallets (account) values (caster), (fd.account) on conflict (account) do nothing;
    perform 1 from wallets w where w.account in (caster, fd.account) order by w.account for update;
    perform wallet_move(fd.account, price, 'trap', null, sprung);
  elsif outcome = 'strike' then
    insert into acts (character, kind, thread, target_act_id, payload)
    select setter_character, 'card', a.thread, by_act, jsonb_build_object('card', struck.key, 'layer', layer, 'message', '', 'spring', sprung::text,
      'config', case when struck.seeded then fd.config - 'seed' else fd.config end)
      || case when struck.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
    from acts a where a.id = by_act returning id into struck_play;
    -- The struck card's play goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(struck_play));
  end if;
  return act_projection(sprung);
end $$;

-- save_effect_state (0038), for a play on a post alone: a play beyond a post has no post author to save its state, and the post it
-- sits on is not its target. Everything else as 0038 wrote it.
create or replace function save_effect_state(who uuid, through uuid, on_play uuid, state jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare author uuid;
begin
  select t.character into author from acts k join acts t on t.id = k.target_act_id where k.id = on_play and k.kind = 'card'
    and coalesce(k.payload ->> 'reach', 'post') = 'post';
  -- The post's own player answers for the mask that wrote it, retired or not.
  if not (author is not distinct from through
          and exists (select 1 from characters c where c.id = through and c.owner = who and c.debuted_at is not null)) then
    perform played_by(through, who);
  end if;
  if author is null then raise exception 'there is no such card on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if author <> through then raise exception 'only the post''s author saves what is on it' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Timed when written, after any save it waited on, so the newest saved_at is the state kept.
  insert into effect_state as e (play, state, saved_by, saved_at) values (on_play, state, through, clock_timestamp())
  on conflict on constraint effect_state_pkey do update set state = excluded.state, saved_by = excluded.saved_by, saved_at = clock_timestamp();
  return (select jsonb_build_object('play', e.play, 'thread', (select thread from acts where id = on_play), 'state', e.state, 'saved_at', e.saved_at)
          from effect_state e where e.play = on_play);
end $$;

-- my_posts_played_on (0043), with a play beyond a post left out: a character or thread play sits on a post, and the post's author's
-- log would otherwise say it was played on their post ("The fiction may lie; the log never does"). Everything else, and the grants,
-- as 0043 wrote them.
create or replace view my_posts_played_on as
  select k.id as play, k.target_act_id as post, k.created_at as at, e.saved_at
  from acts k
  join acts p on p.id = k.target_act_id
  join characters c on c.id = p.character
  join characters by_whom on by_whom.id = k.character
  left join effect_state e on e.play = k.id
  where k.kind = 'card' and c.owner = auth.uid() and by_whom.owner is distinct from auth.uid() and coalesce(k.payload ->> 'reach', 'post') = 'post';

revoke all on my_posts_played_on from anon, public;
grant select on my_posts_played_on to authenticated;

-- ----------------------------------------------------------------------- the settlement ----

-- A play beyond a post has no target post to outdraw (design, section 7, the session's default): settlement_input and estimate_input
-- name it with its `reach` and no `target`, so its own reactions pay its caster by class as any Act's do and settle.ts passes it over
-- in every class rule that reads a card's target post; it is no card on the post it sits on (no earlier card a reaction there reaches,
-- no staff post it lands on, no card landed on that post's author). settlement_input (0054), with that; everything else as 0054 wrote it.
create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0043): staff earn nothing, and a card on a staff Act is nobody's to score.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end),
  reacted as (select distinct act from win_reactions),
  earlier_reactions as (select r.* from reactions r join reacted x on x.act = r.act where r.created_at < window_start),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select target_act_id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind in ('card', 'spring') and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union select id from first_posts
  ),
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  -- A staff post a window's card landed on (0054): named with its reactions, so the card is judged against it, and paid nobody.
  unscored as (select a.* from acts a join characters c on c.id = a.character
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character) order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- What earlier windows paid for each vote this window's reactions touch.
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', p.account, 'act', p.act, 'weight', p.weight, 'shares', p.shares) order by p.account, p.act)
      from paid_votes p join (select distinct act, reactor_account from win_reactions) w on w.act = p.act and w.reactor_account = p.account), '[]'))
$$;

-- estimate_input (0054), the same.
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
  mine as (select id from characters where owner = account),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end),
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
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from acts a join characters c on c.id = a.character join touched t on t.id = a.id
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but a player's to their own character's, and none
  -- on The System's own Acts: the settlement pays nobody for those (Task 3), and the tally every
  -- player reacts to would hand each caller who reacted to it every other player's reaction.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and r.reactor_account is distinct from c.owner
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
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end)) order by a.created_at, a.id)
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

-- ---------------------------------------------------------------------------- the seed ----

create or replace function card_kinds_problem(cards jsonb) returns text
language sql stable set search_path = public, pg_temp as $$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, e -> 'trap' as trap,
      e #>> '{trap,trigger,on}' as trigger_on, e #>> '{trap,outcome,do}' as outcome, e #>> '{trap,outcome,card}' as struck, e
    from jsonb_array_elements(coalesce(cards, '[]')) e
  ), struck as (
    -- The struck card's rarity, from the seed, or from the table where the seed does not carry it.
    select c.key, coalesce((select s ->> 'rarity' from jsonb_array_elements(cards) s where s ->> 'key' = c.struck limit 1),
                           (select k.rarity from card_kinds k where k.key = c.struck)) as rarity
    from c where c.outcome = 'strike'
  )
  select string_agg(why, '; ' order by key, n) from (
    select c.key, w.n, w.why from c left join struck s on s.key = c.key, unnest(array[
      case when c.rarity is null then format('card "%s" has no rarity; a rarity is common, uncommon, rare or legendary', c.key)
           when rarity_rank(c.rarity) is null then format('card "%s" has the rarity "%s"; a rarity is common, uncommon, rare or legendary', c.key, c.rarity) end,
      case when c.play not in ('cast', 'use', 'set', 'keep') then format('card "%s" is played "%s"; a card is cast, used, set or kept', c.key, c.play) end,
      case when c.play = 'keep' then format('card "%s" is kept, and Keep is not built until it is designed', c.key) end,
      case when c.trap is not null and c.play <> 'set' then format('card "%s" has a trap, and only a Set card does', c.key) end,
      case when c.e ? 'ward' and jsonb_typeof(c.e -> 'ward') <> 'boolean' then format('card "%s" is a ward of %s; a ward is true or left out', c.key, c.e -> 'ward') end,
      case when coalesce((c.e ->> 'ward') = 'true', false) and c.play <> 'use' then format('card "%s" is a ward, and only a Use card is', c.key) end,
      case when coalesce((c.e ->> 'ward') = 'true', false) and c.play = 'use' and not c.e ? 'lasts' then format('card "%s" is a ward with no time up (lasts); a ward ends at its time', c.key) end,
      case when c.e ? 'lasts' and c.play <> 'use' and not coalesce(jsonb_typeof(c.e -> 'reaches') = 'array' and exists (
             select 1 from jsonb_array_elements_text(c.e -> 'reaches') r where r <> 'post'), false)
           then format('card "%s" has a time up (lasts), and only a Use card or a card reaching beyond a post does', c.key) end,
      -- The count is read as a number only once it is one: AND does not promise to read its sides in order.
      case when c.e ? 'lasts' and not coalesce(jsonb_typeof(c.e -> 'lasts') = 'object' and c.e #>> '{lasts,unit}' in ('day', 'week', 'month')
             and case when jsonb_typeof(c.e #> '{lasts,count}') = 'number'
                      then (c.e #>> '{lasts,count}')::numeric between 1 and 1000 and (c.e #>> '{lasts,count}')::numeric = trunc((c.e #>> '{lasts,count}')::numeric)
                      else false end, false)
           then format('card "%s" lasts %s; it must be a span: a unit of day, week or month and a whole count from 1 to 1000', c.key, c.e -> 'lasts') end,
      case when c.trap is not null and c.trigger_on is distinct from 'visit' and c.trigger_on not in ('cast', 'reaction', 'reply', 'quote') is not false
           then format('card "%s" springs on %s; a trap springs on cast, reaction, reply, quote, visit', c.key, coalesce(to_jsonb(c.trigger_on)::text, 'null')) end,
      case when c.trigger_on = 'visit' then format('card "%s" springs on a visit, which is not wired until the staff build adds Mod Bot visits', c.key) end,
      case when c.trigger_on = 'reaction' and c.trap #>> '{trigger,quadrant}' not in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative') is not false
           then format('card "%s" springs on a reaction of %s, which is no quadrant; it names one of excitedPositive, excitedNegative, calmPositive, boredNegative', c.key, coalesce(c.trap #> '{trigger,quadrant}', 'null'::jsonb)) end,
      case when c.trap is not null and c.outcome not in ('nullify', 'payout', 'strike') is not false
           then format('card "%s" does %s when it springs; a trap does nullify, payout, strike', c.key, coalesce(to_jsonb(c.outcome)::text, 'null')) end,
      case when c.outcome = 'payout' and c.trigger_on in ('reaction', 'reply', 'quote', 'visit') then format('card "%s" pays out on a %s; it pays out only on a cast, since only a cast is paid for', c.key, c.trigger_on) end,
      case when c.outcome = 'strike' and c.trigger_on in ('cast', 'reaction') then format('card "%s" strikes on a %s; a strike lays its card on a reply or a quote, until cards reach characters', c.key, c.trigger_on) end,
      case when c.outcome = 'strike' and c.trigger_on not in ('cast', 'reaction') and s.rarity is null then format('card "%s" strikes with "%s", which the instance does not have', c.key, c.struck) end,
      case when c.outcome = 'strike' and c.trigger_on not in ('cast', 'reaction') and rarity_rank(c.rarity) < rarity_rank(s.rarity)
           then format('card "%s" strikes with "%s", which is rarer than the trap (%s)', c.key, c.struck, c.rarity) end
    ]) with ordinality w(why, n)
  ) p where why is not null
$$;


create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
begin
  -- Two seeds at once would each find no hire row and both write one into append-only staff_changes. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's play, rarity, trap, ward and time up (0054), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are; so
  -- are its rarity, its play, its trap, whether it is a ward, how long a Use of it is up, where it reaches and whether it pins.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads, rarity, play, trap, ward, lasts, reaches, pins)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins;
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
  -- The instance's staff (0043), once each: a Boss or a Mod Bot is made when its key has no character yet, debuted at
  -- seed time, with the profile its seed gives (its title and its signature, cut to what a profile holds). What an admin
  -- wrote is never written over: a reseed finds the key and does nothing. A bot in firstStaff with no staff_changes row
  -- is hired; one with a row, a fired bot's included, is left as that row says.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, e ->> 'kind' as kind, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at) select s.name, s.staff, s.kind, now() from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'bot');
  if unknown is not null then raise exception 'firstStaff names %, which no bot in the seed''s staff is', unknown using errcode = '22023'; end if;
  insert into staff_changes (staff, on_staff)
  select k, true from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_changes x where x.staff = k);
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board) select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false) from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the Bosses of the seed's staff, in the order it lists them, so the rotation has one to follow. A seed with no
  -- Boss leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord) where e.value ->> 'kind' = 'boss'
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
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;



revoke execute on function reaches_hold(text[]), reach_list(text[]), compact_json(jsonb), span_holds(jsonb), span_words(jsonb), refusal_time(timestamptz), card_reach_problem(jsonb),
  settings_reach_hold(), play_reach_append_only() from public, anon, authenticated;
