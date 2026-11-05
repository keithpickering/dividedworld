-- The staff card path (the staff roster design, section 7; its plan, Task 7).
--
-- A pool post may carry one card play: a Cast on the post it replies to, or a Set on its own post. It goes through every rule a
-- player's does (reach, wards, the stack, the layer, the trap probe, the Act), and its cost is paid by nobody: a staff character has no
-- wallet, no hand and no standing. So play_card and set_card (0058, 0078) are split. Each keeps its signature, grants and behavior and
-- now only authorizes, checks the hand and spends; the rules after that are place_cast and place_set, which a player's play and a staff
-- persona's play both go through. staff_play_card and staff_set_card are the staff's doors, for the service role.
--
--   - A staff play passes `payer` null and price 0; a player's play passes the account and its price. The two must agree with the
--     caster: a staff caster with a payer, or a player's character with none, is refused inside place_cast and place_set, so a door that
--     forgot to hold the line cannot make a player's play free or bill a persona.
--   - A staff door refuses a waiting, benched or developer persona (as write_staff_act does), a card above the setting
--     `poolCardRarityMost`, and a Set whose trap pays out (a staff character has no wallet, so its trap never pays: it is not offered).
--   - face_down.account is null exactly when the setter is a staff character.
--   - spring_traps opens `kayfabb.staff_writer` for the one insert of a spring or a strike when the trap's setter is staff, so a staff
--     trap never refuses the write that sets it off, and puts the flag back to what it was the moment that insert is done: a player's
--     own Act, written after the spring, is checked with the flag closed, so a player's write can never pass as staff.
--   - A player's trap that catches a staff Cast and pays out credits the trapper the card's base price, made new and taken from no
--     wallet (wallet_events kind 'trapSystem'), whatever the trapper holds: the amount is the economy's number for the caught card,
--     never read from the trapper's account. The pool's one card per post and its rarity cap bound how much can be made.
--
-- The settlement is unchanged: is_staff_side (0054) leaves a staff caster's play unpaid, and the post it lands on is judged as for any
-- card. `poolCardRarityMost` is held flat for now, in a trigger of its own (as 0083 holds notesRead); the pool's settings (the plan's
-- Task 9) group it with the rest. Ways out: nothing here holds a player in a state. A staff card on a player's post is a card like any
-- other, and ends as it does.

-- ------------------------------------------------------------------------------------------------------ the ledger kind ----

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem'));

-- ------------------------------------------------------------------------------------------------------- face_down.account ----

alter table face_down alter column account drop not null;

-- Null exactly when the setter is a staff character. (A trigger and not a check: the setter's kind lives on another table.) Append-only
-- as the table is, so a row is read once, when it is written.
create function face_down_account_matches() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  staff_setter boolean;
begin
  select c.staff is not null into staff_setter from acts a join characters c on c.id = a.character where a.id = new.play;
  if (new.account is null) is distinct from coalesce(staff_setter, false) then
    raise exception 'a card face down belongs to its setter''s player, and to no one when a staff character set it' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger face_down_account_matches before insert on face_down for each row execute function face_down_account_matches();
revoke execute on function face_down_account_matches() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------- the setting ----

-- `poolCardRarityMost`: the rarest card a pool persona may play (common, uncommon, rare or legendary). The TypeScript rule is the same
-- name in engine/rules/instance.ts, and supabase/tests/0079-settings-held.sql lists its poisons and goods.
create function settings_held_pool_cards() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key = 'poolCardRarityMost' and (jsonb_typeof(new.value) is distinct from 'string' or rarity_rank(new.value #>> '{}') is null) then
    raise exception 'poolCardRarityMost is a rarity: common, uncommon, rare or legendary' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_held_pool_cards before insert or update on settings for each row execute function settings_held_pool_cards();
revoke execute on function settings_held_pool_cards() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------- spring_traps ----

-- spring_traps (0078), whole, with three additions and its signature as it was (callers name it, and 0078's revoke stands):
--   1. Where the trap's setter is a staff character, `kayfabb.staff_writer` is open for the insert of the spring and again for the
--      strike's, and is put back to the value it held when the insert is done (not to closed: a staff Cast that springs a staff trap
--      is itself inside a staff write). A player's own Act, written after the spring, is therefore checked as it always was.
--   2. trapStruck is written only where the trap's setter has an owner; a staff trap has none to name as the one who did it.
--   3. A Cast with no paying account is a staff character's (place_cast passes the account of a player's, and for a staff one the
--      card's base price as `price`). When it is caught by a trap that pays out, the trapper is credited that price through wallet_move,
--      made new and taken from no wallet, kind 'trapSystem', whatever the trapper holds.
-- Everything else as 0078 wrote it, the reads before the decision included.
create or replace function spring_traps(trigger text, post uuid, by_act uuid, quadrant text default null, incoming_rarity text default null,
                             caster uuid default null, price integer default 0, held uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  kind_of card_kinds%rowtype;
  struck card_kinds%rowtype;
  setter_character uuid;
  setter_retired timestamptz;
  setter_debuted timestamptz;
  setter_owner uuid;
  setter_staff boolean;
  flag text;
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
  select c.retired_at, c.debuted_at, c.owner, c.staff is not null into setter_retired, setter_debuted, setter_owner, setter_staff
  from characters c where c.id = setter_character;
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
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if setter_staff then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'outcome', kind_of.trap -> 'outcome', 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and outcome in ('nullify', 'payout') then by_act::text end))) returning id into sprung;
  if setter_staff then perform set_config('kayfabb.staff_writer', flag, true); end if;
  perform write_alert(setter_character, 'trapSprang', null, sprung, coalesce(caster, auth.uid()));
  if outcome = 'payout' and coalesce(price, 0) > 0 and caster is not null then
    -- Both wallets, in account order, so two players' casts on each other's traps cannot wait on each other.
    insert into wallets (account) values (caster), (fd.account) on conflict (account) do nothing;
    perform 1 from wallets w where w.account in (caster, fd.account) order by w.account for update;
    perform wallet_move(fd.account, price, 'trap', null, sprung);
  elsif outcome = 'payout' and trigger = 'cast' and caster is null and coalesce(price, 0) > 0 and fd.account is not null then
    -- A staff Cast, caught: nobody paid for it, so the trapper is paid the card's base price by The System, from no wallet. The amount
    -- is place_cast's (the economy's number for the caught card), never a function of the trapper's account.
    perform wallet_move(fd.account, price, 'trapSystem', null, sprung);
  elsif outcome = 'strike' then
    if setter_staff then perform set_config('kayfabb.staff_writer', 'on', true); end if;
    insert into acts (character, kind, thread, target_act_id, payload)
    select setter_character, 'card', a.thread, by_act, jsonb_build_object('card', struck.key, 'layer', layer, 'message', '', 'spring', sprung::text,
      'config', case when struck.seeded then fd.config - 'seed' else fd.config end)
      || case when struck.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
    from acts a where a.id = by_act returning id into struck_play;
    if setter_staff then perform set_config('kayfabb.staff_writer', flag, true); end if;
    if setter_owner is not null then
      perform write_alert((select a.character from acts a where a.id = by_act), 'trapStruck', null, struck_play, setter_owner);
    end if;
    -- The struck card's play goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(struck_play));
  end if;
  return act_projection(sprung);
end $$;

-- ------------------------------------------------------------------------------------------------------------ place_cast ----

-- The rules of a Cast or a Use after authorization, from play_card (0058) whole: the config, message and reach, the card's kind, the
-- target's reach, wards, stack and layer, spring_traps, the Act, play_reach, the card ledger's row (a player's only) and the alert.
-- `caster` is the character playing; `payer` is the account that pays, null for a staff character and never for a player's, with
-- `price` 0 for the one that pays nothing. It does not spend: the wallet is the caller's, after this has come back without a refusal
-- (the player's charge for a play refused here is therefore none). Callable by no API role.
create function place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer)
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
  warded record;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
  target_name text;
  base integer;
  staff_caster boolean;
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

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if kind_of.play = 'use' and author is distinct from caster then
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
      -- A staff Cast is worth its base price to a trap that catches it (spring_traps), the economy's number and no one's wallet.
      base := case when payer is null then coalesce((setting('economy') ->> kind_of.price_setting)::numeric::integer, 0) else price end;
      sprung := spring_traps('cast', target, written, null, kind_of.rarity, payer, base);
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
      and case place_cast.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
    if up >= kind_of.stack then
      where_words := 'this ' || reach;
      if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
  end if;

  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
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
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;
revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer) from public, anon, authenticated, service_role;

-- play_card (0058), split: it authorizes, checks the hand, hands the rules to place_cast, and only then spends the wallet and writes the
-- card ledger's row, so a play refused anywhere in place_cast costs nothing. The order of its refusals is 0058's: the inputs, the price,
-- the reach, the hand, then the card's kind and the target in place_cast. Signature and grants as they were.
create or replace function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text default '',
                          reach text default 'post', from_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  said text := coalesce(message, '');
  played jsonb;
  written uuid;
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
  played := place_cast(through, card, target, config, said, reach, from_post, who, price);
  written := (played ->> 'id')::uuid;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return played;
end $$;

-- ------------------------------------------------------------------------------------------------------------- place_set ----

-- The rules of a Set after authorization, from set_card (0078) whole: the config, the card's kind, the target post and its author, the
-- one card a post holds, the set Act, the face_down row and its reply row. `payer` is the setter's account (null for a staff
-- character's, and then price is 0). It does not spend. Callable by no API role.
create function place_set(setter uuid, card text, target uuid, config jsonb, payer uuid, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind_of card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
  staff_setter boolean;
begin
  select c.staff is not null into staff_setter from characters c where c.id = setter;
  if staff_setter is null then raise exception 'there is no such character' using errcode = 'P0002'; end if;
  if staff_setter is distinct from (payer is null) then
    raise exception 'a staff character''s card is paid by no one, and a player''s by its player' using errcode = '22023';
  end if;
  if payer is null and coalesce(price, 0) <> 0 then raise exception 'a staff character''s card costs nothing' using errcode = '22023'; end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select * into kind_of from card_kinds k where k.key = place_set.card;
  if kind_of.key is null then raise exception 'there is no such card' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if kind_of.play is distinct from 'set' then raise exception '% is not set face down; it is played another way', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if target_kind is distinct from 'post' then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from setter then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Public, since the back is.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (setter, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at)
    values (written, payer, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')));
    -- Its reply moment, waiting for the first post by another character (a row for every card alike, a Bluff's too).
    insert into face_down_reply (play, thread) values (written, in_thread);
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  return act_projection(written);
end $$;
revoke execute on function place_set(uuid, text, uuid, jsonb, uuid, integer) from public, anon, authenticated, service_role;

-- set_card (0078), split as play_card is: authorize, the hand, place_set, then the spend and the ledger's row. Signature and grants as
-- they were.
create or replace function set_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  placed jsonb;
  written uuid;
begin
  perform played_by(through, who);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = set_card.card;
  if coalesce(held, 0) < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  placed := place_set(through, card, target, config, who, price);
  written := (placed ->> 'id')::uuid;
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return placed;
end $$;

-- ---------------------------------------------------------------------------------------------------- the staff's doors ----

-- A staff persona's Cast, for the service role: by staff key, on the post it replies to (a staff card lands on a post). Refuses a
-- persona that is waiting, benched or the developer, a card above `poolCardRarityMost`, and a card that is not a Cast or a Use. The
-- staff flag is open for the one call and put back to what it was after.
create function staff_play_card(staff_key text, card text, target uuid, config jsonb default '{}', message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  held text;
  kind_of card_kinds%rowtype;
  flag text;
  played jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if whose is distinct from 'persona' then raise exception 'only a persona plays a card' using errcode = '42501'; end if;
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then raise exception 'a % persona writes nothing', held using errcode = '55000'; end if;
  select * into kind_of from card_kinds k where k.key = staff_play_card.card;
  if kind_of.key is null then raise exception 'there is no such card' using errcode = 'P0002'; end if;
  -- Refused when the setting cannot be read as a rarity either, so a broken setting plays no card.
  if not coalesce(rarity_rank(kind_of.rarity) <= rarity_rank(setting('poolCardRarityMost') #>> '{}'), false) then
    raise exception '% is above the rarity the pool plays', kind_of.name using errcode = '55000';
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  played := place_cast(who, card, target, coalesce(config, '{}'), coalesce(message, ''), 'post', null, null, 0);
  perform set_config('kayfabb.staff_writer', flag, true);
  return played;
end $$;
revoke execute on function staff_play_card(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function staff_play_card(text, text, uuid, jsonb, text) to service_role;

-- A staff persona's Set, on its own post. As above, and a Set whose trap pays out is refused: a staff character has no wallet, so its
-- trap never pays, and it is not offered.
create function staff_set_card(staff_key text, card text, target uuid, config jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  held text;
  kind_of card_kinds%rowtype;
  flag text;
  placed jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if whose is distinct from 'persona' then raise exception 'only a persona plays a card' using errcode = '42501'; end if;
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then raise exception 'a % persona writes nothing', held using errcode = '55000'; end if;
  select * into kind_of from card_kinds k where k.key = staff_set_card.card;
  if kind_of.key is null then raise exception 'there is no such card' using errcode = 'P0002'; end if;
  if not coalesce(rarity_rank(kind_of.rarity) <= rarity_rank(setting('poolCardRarityMost') #>> '{}'), false) then
    raise exception '% is above the rarity the pool plays', kind_of.name using errcode = '55000';
  end if;
  if kind_of.trap #>> '{outcome,do}' = 'payout' then
    raise exception '% pays out, and a staff character has no wallet to pay into', kind_of.name using errcode = '55000';
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  placed := place_set(who, card, target, coalesce(config, '{}'), null, 0);
  perform set_config('kayfabb.staff_writer', flag, true);
  return placed;
end $$;
revoke execute on function staff_set_card(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function staff_set_card(text, text, uuid, jsonb) to service_role;
