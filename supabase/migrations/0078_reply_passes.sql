-- A reply passes each card back once, and a post reads only the backs still waiting. The cost-at-scale design, sections 4 to 6
-- (docs/plans/2026-11-03-cost-at-scale-design.md); the plan's Task 4; #136 F2, F3 and F5. It builds on 0075_trap_locks.sql
-- (docs/plans/2026-11-03-trap-locks-design.md), whose header states the lock order and which function takes which; read that first.
--
-- The defect. Every post locked and probed every live back in its thread, including backs that had already sprung or been passed
-- (0075 narrowed that to the unsprung ones), so a post's cost grew with the thread's card backs (the card design's section 12 says
-- "one probe"). The loop also departed from the card design's section 4, where a reply trap springs on "the first post in the thread
-- after it by another character": a post that met two reply traps sprang the newest, and the older sprang on some later post.
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
-- Locks. The order is 0075_trap_locks.sql's, steps 1 to 6 (accounts; the target post's acts row; face_down rows by `play`, all in
-- one statement; the threads row a post's `seq` comes from; character_post_counts rows by character; wallets), with one addition
-- at step 3: a post locks the face_down_reply row of each unsprung back it may pass together with the back's face_down row, in the
-- same statement and in `play` order. Only post() writes a reply row after set_card creates it. It stamps the rows it locked in step 3
-- while holding them. A waiting back that has already sprung is not locked in step 3, and its row is stamped after step 5 with
-- `for update skip locked`, so that stamp never waits: a row another post holds is left waiting for the next post, and the stamp
-- cannot be one side of a lock cycle.
-- What changes is which backs post() locks (0075: every live unsprung back in its thread; here: the quoted post's live unsprung back,
-- and the thread's WAITING backs on posts of other characters, from the partial index). A waiting back that has already sprung (by a
-- quote or a cast, which do not pass it) is still stamped, or every later post would read it; it is not locked, as in 0075 (a spring
-- is public and its row is nobody's to wait on). The backs a write springs are the backs it locked: a
-- back that set_card commits after the post took its locks is not sprung by that post (it was set after the post began), and the
-- post says so to spring_traps through `held`, whose probe reads only those plays in the same statement that locks the row it
-- springs. play_card needs no replacement: a cast locks and springs the one back on its target post, and holds no reply row.
-- react adds no counted Act before its spring and keeps its order. 0075 left both as they stood.
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


-- ------------------------------------------------------------------------ spring_traps ----

-- spring_traps (0075_trap_locks.sql), whole, with one addition: a write that locked its backs passes them as `held`, and only a back
-- among them springs. The probe is the same index read for every card, a Bluff's too, and restricts by `held` in the statement that
-- locks the row it springs. Everything else, 0075's reads before the decision included, as 0075 wrote it. Its argument list grows,
-- so it is dropped and made again (callers name it, never its signature), with 0054's revoke. No other function calls it with
-- `held`; react (0054) and play_card (0058) call it with the arguments they had, and `held` null probes as 0075 does.
drop function spring_traps(text, uuid, uuid, text, text, uuid, integer);
create function spring_traps(trigger text, post uuid, by_act uuid, quadrant text default null, incoming_rarity text default null,
                             caster uuid default null, price integer default 0, held uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  kind_of card_kinds%rowtype;
  struck card_kinds%rowtype;
  setter_character uuid;
  setter_retired timestamptz;
  setter_debuted timestamptz;
  by_kind text;
  springs boolean;
  outcome text;
  sprung uuid;
  struck_play uuid;
  layer integer;
  up integer;
begin
  select f.* into fd from face_down f
  where f.post = spring_traps.post and f.ends_at > now() and (held is null or f.play = any (held))
  order by f.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  select * into kind_of from card_kinds k where k.key = fd.card;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  -- The same reads for every back, before anything is decided.
  select a.character into setter_character from acts a where a.id = fd.play;
  select c.retired_at, c.debuted_at into setter_retired, setter_debuted from characters c where c.id = setter_character;
  select * into struck from card_kinds k where k.key = coalesce(kind_of.trap #>> '{outcome,card}', fd.card);
  -- A strike that cannot land leaves the trap set: its target already carries its stack of the card, counted as play_card counts
  -- it (the plays still up), with the layer going on from the last one taken.
  select count(*) filter (where k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()),
         greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
    into up, layer
  from acts k where k.kind = 'card' and k.target_act_id = by_act and (k.payload ->> 'card') is not distinct from struck.key and not (k.payload ? 'caught')
    and coalesce(k.payload ->> 'reach', 'post') = 'post';
  select a.kind into by_kind from acts a where a.id = by_act;
  -- The decision.
  springs := kind_of.trap #>> '{trigger,on}' is not distinct from trigger
    and (trigger <> 'reaction' or kind_of.trap #>> '{trigger,quadrant}' is not distinct from quadrant)
    and (trigger <> 'cast' or coalesce(rarity_rank(incoming_rarity) <= rarity_rank(kind_of.rarity), false));
  if not springs then return null; end if;
  outcome := kind_of.trap #>> '{outcome,do}';
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its trap stays set until its
  -- time, and the write that met it lands as if no trap were there (acts_well_formed would refuse the spring, and with it the write).
  if setter_retired is not null or setter_debuted is null then return null; end if;
  if outcome = 'strike' then
    if kind_of.trap #>> '{outcome,card}' is null or struck.key is null or by_act is null or up >= struck.stack or by_kind is distinct from 'post' then return null; end if;
  end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'outcome', kind_of.trap -> 'outcome', 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and outcome in ('nullify', 'payout') then by_act::text end))) returning id into sprung;
  perform write_alert(setter_character, 'trapSprang', null, sprung, coalesce(caster, auth.uid()));
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
    perform write_alert((select a.character from acts a where a.id = by_act), 'trapStruck', null, struck_play,
      (select c.owner from characters c where c.id = setter_character));
    -- The struck card's play goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(struck_play));
  end if;
  return act_projection(sprung);
end $$;
revoke execute on function spring_traps(text, uuid, uuid, text, text, uuid, integer, uuid[]) from public, anon, authenticated;

-- ------------------------------------------------------------------------------ set_card ----

-- set_card (0054, unchanged since), with the back's reply row written beside it. Everything else as 0054 wrote it.
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

-- post (0075_trap_locks.sql), with the backs it locks changed and the reply moment spent. In 0075's order, before the Act:
--   3. the quoted post's live unsprung back and the thread's waiting, unsprung backs on posts of other characters, each with its
--      reply row, in one statement by `play`;
--   4. the thread row;
--   5. the count rows of the poster and of every setter of a back locked, by character, each made first where it is missing.
-- Then the post is written; the quote's trap springs; every waiting back this post passes is stamped (those it locked that were
-- still waiting when it got them, and the sprung ones it did not lock); and if nothing sprang, the newest reply trap among the
-- passed backs springs, at most one. Everything else as 0075 wrote it (the alert for the author of a quoted Act included).
create or replace function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  maybe uuid[];
  parked uuid[];
  locked uuid[];
  passes uuid[];
  setters uuid[];
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- What this post may pass: the thread's waiting backs on others' posts (the partial index), those that have sprung apart, since a
  -- sprung back is neither locked nor probed for a lock (a spring is public, and acts_one_spring finds it by index).
  select coalesce(array_agg(w.play) filter (where not w.sprung), '{}'), coalesce(array_agg(w.play) filter (where w.sprung), '{}') into maybe, parked
  from (select r.play, exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = r.play::text) as sprung
        from face_down_reply r join face_down f on f.play = r.play join acts p on p.id = f.post
        where r.thread = in_thread and r.passed_by is null and p.character is distinct from through) w;
  -- Plus the quoted post's live, unsprung back, passed or not.
  maybe := maybe || array(select f.play from face_down f
                          where f.post = quoting and f.ends_at > now() and f.play <> all (maybe)
                            and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text));
  -- Step 3: those backs with their reply rows, in `play` order, in one statement. A reply row is read as locked: a post that passed a
  -- back while this waited has stamped it, and it is not this post's to pass. spring_traps then finds each row already held.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.play) filter (where b.waits and b.poster is distinct from through), '{}'),
         coalesce(array_agg(b.setter), '{}')
    into locked, passes, setters
  from (select f.play, s.character as setter, p.character as poster, (r.passed_by is null and r.thread = in_thread) as waits
        from face_down f join face_down_reply r on r.play = f.play join acts s on s.id = f.play join acts p on p.id = f.post
        where f.play = any (maybe)
        order by f.play for update of f, r) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || through) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || through) order by character for update;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (the header's note on `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  -- Locked and read as waiting in step 3, so no other post can have stamped them.
  update face_down_reply set passed_by = written, passed_at = now() where play = any (passes);
  -- The sprung ones are stamped without waiting: a post that locked one in step 3 (it read the back unsprung) may hold the row and
  -- wait on this post's thread or count row, so a wait here could cross. A row held by another is skipped and stays waiting; the next
  -- post by another character stamps it.
  if cardinality(parked) > 0 then
    update face_down_reply set passed_by = written, passed_at = now()
    where play in (select r.play from face_down_reply r where r.play = any (parked) and r.passed_by is null order by r.play for update skip locked);
  end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.play = any (passes)
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written, held => locked);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
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
