-- A reply passes each card back once, and every write that may spring locks in one order. The cost-at-scale design, sections 4 to 6
-- (docs/plans/2026-11-03-cost-at-scale-design.md); the plan's Task 4; #136 F2, F3 and F5.
--
-- The defect. Every post locked and probed, through spring_traps, every live face_down row in its thread for setLasts, including backs
-- that had already sprung or been passed, so a post's cost grew with the thread's card backs (the card design's section 12 says "one
-- probe"). The loop also departed from the card design's section 4, where a reply trap springs on "the first post in the thread after it
-- by another character": a post that met two reply traps sprang the newest, and the older sprang on some later post.
--
-- Each back's reply moment is spent by the first post that passes it. face_down_reply holds one row for every back, whatever the card
-- (a Bluff's too): the thread, and `passed_by` / `passed_at`, null until the first post in the thread by a character other than the
-- back's post's author passes it. A post reads the partial index of the backs still waiting in its thread, stamps each one, and
-- springs the newest reply trap among them, at most one as before. Every other back it passed has spent its moment, one that lost to
-- a quote this post sprang included. The row is the one state of a back that changes (once, null to set), so it lives in a row of its
-- own and not in an Act or in face_down, which stays append-only. A back's end is unchanged: it springs once, or it ends by itself at
-- setLasts. A card has one trigger (card_kinds.trap), so passing is the end of a reply trap's moment and nothing else: a quote, cast or
-- reaction trap springs on its own trigger whether or not a reply has passed it, and a reply trap springs on no other. Nothing on a board shows the table;
-- no API role reads it, and `passed_at` reaches only the setter, through my_face_down (the setter's log, #136 F3).
--
-- Backs set before this migration: one row each, passed by the first post in the thread after the set by a character other than the
-- back's post's author, else waiting. A reply trap that an older post's spring left waiting under the old loop, with a later post by
-- another character already in the thread, is now passed and no longer springs on a reply; it still ends at its time.
--
-- Locks, in one order everywhere a write may spring (this REPLACES the paragraph in 0054's header): the caster's account, the target
-- post, then every face_down and face_down_reply row the write may spring or pass (in `play` order), then the character_post_counts
-- rows of the writer and of every setter of those backs (in character-id order), and only then any Act insert, and last the wallets.
-- The backs a write springs are the backs it locked: a back set on the quoted or target post after the write took its locks (set_card
-- needs none of them) is not sprung by that write, since it was set after the write began; has_unlocked_back asks, after the locks,
-- and the write springs nothing on a post that now carries one. This is simpler than locking again (a second lock pass after count
-- rows are held would itself break the order) and the next write to meet that back springs it.
-- 0054 and 0058 inserted the Act of a post and of a play first and locked face_down after it, so a post that held its author's count
-- row (the Act's counter) and wanted a back's row met a play or a spring that held the back's row and wanted that count row, and
-- Postgres killed one (40P01): a quoting post and a cast by one player on a trapped post; a post by a trap's setter and another
-- character's reply that springs that trap and lays a card by the setter (supabase/tests/0059-card-plays.sql). post() and play_card
-- are reordered here; set_card never waited on a face_down row and only gains the row beside face_down. react adds no counted Act
-- before its spring (the reaction and its tally are not counted, and a reaction trap's spring is not either, nor can it strike), so
-- it already keeps this order and is not replaced.
--
-- The masks (design, section 5). face_down_reply is written for every back alike, by every post that passes it. The rows a post
-- reads, writes and locks, and the count rows it locks, are the same whatever cards are face down, a Bluff's included; only the
-- spring itself differs, and the spring is public. The count rows of every setter of a locked back are taken, trap or not.
--
-- Its way out: a passed back is no new state to be stuck in. It ends by itself at setLasts as every back does.

-- ----------------------------------------------------------------------- face_down_reply ----

create table face_down_reply (
  play uuid primary key references face_down (play),
  thread uuid not null references threads (id),
  passed_by uuid references acts (id),
  passed_at timestamptz,
  check ((passed_by is null) = (passed_at is null))
);
-- The backs still waiting for their reply, by thread: what a post reads.
create index face_down_reply_waiting on face_down_reply (thread) where passed_by is null;

-- A row changes once, from waiting to passed, and is never deleted.
create function face_down_reply_once() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'a face-down card''s reply is never deleted'; end if;
  if old.passed_by is not null or new.passed_by is null or new.play <> old.play or new.thread <> old.thread then
    raise exception 'a face-down card''s reply changes once, from waiting to passed';
  end if;
  return new;
end $$;
revoke execute on function face_down_reply_once() from public, anon, authenticated;
create trigger face_down_reply_once before update or delete on face_down_reply for each row execute function face_down_reply_once();
create trigger face_down_reply_no_truncate before truncate on face_down_reply for each statement execute function ledger_append_only();
alter table face_down_reply enable always trigger face_down_reply_once;
alter table face_down_reply enable always trigger face_down_reply_no_truncate;
alter table face_down_reply enable row level security;
revoke all on face_down_reply from public, anon, authenticated;

-- One row for every back set already: passed by the first post in its thread after the set by a character other than the back's
-- post's author, at that post's time; else waiting.
create function face_down_reply_backfill() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into face_down_reply (play, thread, passed_by, passed_at)
  select f.play, f.thread, n.id, n.created_at
  from face_down f
  join acts s on s.id = f.play
  join acts b on b.id = f.post
  left join lateral (
    select p.id, p.created_at from acts p
    where p.thread = f.thread and p.kind = 'post' and p.created_at > s.created_at and p.character is distinct from b.character
    order by p.seq limit 1
  ) n on true
  on conflict (play) do nothing
$$;
revoke execute on function face_down_reply_backfill() from public, anon, authenticated;
select face_down_reply_backfill();

-- ------------------------------------------------------------------------- the locks ----

-- The backs a write may spring or pass, locked in `play` order with their reply rows, then the count rows of the writer and of every
-- setter of those backs, in character-id order (the paragraph above). Returns the backs this write passes: those still waiting in
-- `in_thread` whose post is by another character than `writer`, read from the rows as locked (a post that passed one while this
-- waited has stamped it, and it is not this write's to pass). With no thread, none. Called before any Act is written.
create function lock_backs(plays uuid[], writer uuid, in_thread uuid default null) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held record;
  passes uuid[] := '{}';
  setters uuid[] := array[writer];
begin
  for held in
    select f.play, s.character as setter, (r.passed_by is null and r.thread = in_thread and p.character is distinct from writer) as passes
    from face_down f
    join face_down_reply r on r.play = f.play
    join acts s on s.id = f.play
    join acts p on p.id = f.post
    where f.play = any (plays)
    order by f.play
    for update of f, r
  loop
    setters := setters || held.setter;
    if held.passes then passes := passes || held.play; end if;
  end loop;
  insert into character_post_counts (character) select c from (select distinct c from unnest(setters) c where c is not null) s order by c
  on conflict (character) do nothing;
  perform 1 from character_post_counts n where n.character = any (setters) order by n.character for no key update;
  return passes;
end $$;
revoke execute on function lock_backs(uuid[], uuid, uuid) from public, anon, authenticated;

-- Whether `post` carries a live back that is not among `held`, the backs this write locked (a back set after its locks were taken).
-- The same index probe for every card, a Bluff's too.
create function has_unlocked_back(post uuid, held uuid[]) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from face_down f where f.post = has_unlocked_back.post and f.ends_at > now() and f.play <> all (held))
$$;
revoke execute on function has_unlocked_back(uuid, uuid[]) from public, anon, authenticated;

-- ------------------------------------------------------------------------------ set_card ----

-- set_card (0054), with the back's reply row written beside it. Everything else as 0054 wrote it.
create or replace function set_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  kind_of card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
begin
  perform played_by(through, who);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = set_card.card;
  if coalesce(held, 0) < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  select * into kind_of from card_kinds k where k.key = set_card.card;
  if kind_of.play is distinct from 'set' then raise exception '% is not set face down; it is played another way', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if target_kind is distinct from 'post' then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from through then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Public, since the back is.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at)
    values (written, who, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')));
    -- Its reply moment, waiting for the first post by another character (a row for every card alike, a Bluff's too).
    insert into face_down_reply (play, thread) values (written, in_thread);
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return act_projection(written);
end $$;

-- ---------------------------------------------------------------------------------- post ----

-- post (0058), in the order above, before the Act: 1. the quoted post's live back and the waiting backs of the thread on posts of
-- other characters are locked with their reply rows, then 2. the count rows of the poster and of every setter among them; 3. the post
-- is written; 4. the quote's trap springs as before; 5. every waiting back it locked is stamped passed by this post; 6. if nothing
-- sprang, the newest reply trap among them springs, at most one. The alert for the author of a quoted Act is written after, as 0058
-- wrote it. Everything else as 0058 wrote it.
create or replace function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  maybe uuid[];
  passes uuid[];
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The backs this post may spring or pass: the quoted post's live one, and the thread's waiting ones on others' posts (the partial index).
  select coalesce(array_agg(m.play), '{}') into maybe from (
    select r.play from face_down_reply r join face_down f on f.play = r.play join acts p on p.id = f.post
    where r.thread = in_thread and r.passed_by is null and p.character is distinct from through
    union
    select f.play from face_down f where f.post = quoting and f.ends_at > now()
  ) m;
  passes := lock_backs(maybe, through, in_thread);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (the header's note on has_unlocked_back).
  if quoting is not null and not has_unlocked_back(quoting, maybe) then sprung := spring_traps('quote', quoting, written); end if;
  update face_down_reply set passed_by = written, passed_at = now() where play = any (passes);
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.play = any (passes)
      group by f.post, p.seq order by p.seq desc
    loop
      if not has_unlocked_back(candidate, maybe) then sprung := spring_traps('reply', candidate, written); end if;
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ------------------------------------------------------------------------------ play_card ----

-- play_card (0058), with a cast's lock order above: the target's live back with its reply row, then the count rows of the caster and of
-- the back's setter, before the cast's trap check and its card Act. Everything else as 0058 wrote it.
create or replace function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text default '',
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
  target_name text;
  locked uuid[];
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
    if kind_of.play = 'cast' then
      -- The post's live back, then the count rows of the caster and of the back's setter, before any Act is written (the order above).
      locked := array(select f.play from face_down f where f.post = target and f.ends_at > now());
      perform lock_backs(locked, through);
      if not has_unlocked_back(target, locked) then sprung := spring_traps('cast', target, written, null, kind_of.rarity, who, price); end if;
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
      if kind_of.play = 'use' and target is distinct from through then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.title into target_name from threads t where t.id = target;
      in_thread := target;
      select a.id into on_post from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
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
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name)
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
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, who);
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ------------------------------------------------------------------------- my_face_down ----

-- my_face_down (0054), with `passed_at` last: when the first post by another character passed the back, or null while it waits. The
-- setter's own row, read for the log's line that a reply passed a reply trap by (the card is the setter's own, so the line may name it).
create or replace view my_face_down as
  select f.play, f.card, f.config, f.post, f.thread, a.created_at as set_at, f.ends_at, s.id as spring, s.created_at as sprung_at,
    coalesce(s.created_at, case when f.ends_at <= now() then f.ends_at end) as ended_at, r.passed_at
  from face_down f join acts a on a.id = f.play left join acts s on s.kind = 'spring' and (s.payload ->> 'set') = f.play::text
    left join face_down_reply r on r.play = f.play
  where f.account = auth.uid();
