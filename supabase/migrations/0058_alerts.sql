-- Alerts, written with the Acts they are about. The alerts plan, Task 3; the alerts design, sections 2, 10 and 11.
--
-- An alert is a nudge to a player that something public happened to what is theirs: a post of theirs was quoted, a card was
-- played on their post, their character or a thread their character started, a trap struck their post, or their own trap
-- sprang. A row holds no content: it names the account, the kind (engine/rules/alerts.ts), an optional sub-key (a ruling's),
-- the public Act it is about, the character of the player's it concerns, and the time. Words and the target's name are read
-- from the Act and its target when the alert is shown, so an alert can never say more than the board does.
--
-- It is written by the function that writes the Act, in the same transaction, and by nothing else: no API role holds an
-- insert, an update or a delete, and the table is in no publication (supabase/tests/0014-realtime.sql fails a table with an
-- account column in one). An account reads its own rows alone. Rows are only ever added, as Acts are; "new" is the account's
-- one mark (0057), never a flag on a row. Its way out: a row is a line in a list, not a state; there is nothing to be stuck in.
--
-- "A response never proves a private fact": write_alert writes a row for a character's owner and none for a staff
-- character (its owner is null, and staff is public) or for the account that is acting (it knows what it did). The caster's
-- answer is computed before and without it: write_alert returns nothing, and the writers that call it return what they
-- returned. Its broadcast on the owner's private channel `account:<owner>` is queued in broadcasts_due (0007) and sent by the
-- settle function after the answer, so neither the answer nor its timing carries the owner's identity. The broadcast is the
-- alert's public projection: kind, sub, Act, character, time. It never names the caster or who reacted.

create table alerts (
  id bigint generated always as identity primary key,
  account uuid not null references accounts (id),
  kind text not null check (kind in ('quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling')),
  sub text,
  act uuid not null references acts (id),
  character uuid references characters (id),
  at timestamptz not null default now()
);
create index alerts_by_account on alerts (account, at desc);
create index alerts_by_act on alerts (act);

alter table alerts enable row level security;
revoke all on alerts from public, anon, authenticated, service_role;
create policy own on alerts for select to authenticated using (account = auth.uid());
grant select on alerts to authenticated;

-- One alert for the owner of `of_character`, about the Act `about`; none where the character has no owner (staff) or its owner is
-- `acting`, the account that did the thing. `acting` is null where the writer cannot name one. Called inside the writers, after the
-- Act it points at is written; no API role calls it.
create function write_alert(of_character uuid, kind text, sub text, about uuid, acting uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_of uuid;
  made timestamptz;
begin
  if of_character is null then return; end if;
  select c.owner into owner_of from characters c where c.id = of_character;
  if owner_of is null or owner_of is not distinct from acting then return; end if;
  insert into alerts (account, kind, sub, act, character) values (owner_of, kind, sub, about, of_character) returning at into made;
  perform broadcast_later('account:' || owner_of, 'alert',
    jsonb_build_object('kind', kind, 'sub', sub, 'act', about, 'character', of_character, 'at', made));
end $$;
revoke execute on function write_alert(uuid, text, text, uuid, uuid) from public, anon, authenticated, service_role;

-- post (0054), with an alert for the author of a quoted Act, after the traps its quote or reply springs: the quote's. Everything else
-- as 0054 wrote it.
create or replace function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Every live back this post may spring, the quoted post's and the thread's, locked in one statement and one order (by set), so
  -- two posts that each quote and reply cannot hold one each and wait on the other. spring_traps then finds each row already held.
  perform 1 from face_down f
  where f.ends_at > now() and (f.post = quoting or (f.thread = in_thread and f.post <> written))
  order by f.play for update;
  if quoting is not null then sprung := spring_traps('quote', quoting, written); end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.thread = in_thread and f.ends_at > now() and p.character <> through and p.id <> written
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- play_card (0056), with an alert for the owner of what the card landed on: a post's author, the character, or the character that
-- started the thread; none for a board, which has no owner. Everything else as 0056 wrote it.
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

-- spring_traps (0055), with an alert for the setter whose trap sprang (about the spring) and, where a strike lands, for the author of
-- the struck post (about the card that struck). The trap's setter is who did it to the struck post, so trapStruck skips only where
-- the setter's owner is the struck post's own owner ("what your own other masks did to your characters" is never alerted), and a
-- reply or quote that sets off another player's trap writes the replier a trapStruck: their own account's, so it tells no one else
-- anything. trapSprang skips the account that set the trap off (the caster of a cast, else the signed-in player), who has their
-- answer. Everything else as 0055 wrote it.
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
