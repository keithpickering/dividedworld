-- An admin ends a card play (the bot-card-options design, docs/plans/2026-11-05-bot-card-options-design.md, section 3; its plan,
-- docs/plans/2026-11-05-bot-card-options-plan.md). One migration, in sections by the plan's tasks; each task appends its own.
--
-- ============================================================================ Task 1: the card_end Act and reverse_card ====
--
--   card_end   The plain record that an admin ended a card play, as a move_end is of a move (0046): a null character, the play
--              (a `card` Act) for its target, in the play's thread, `{why: 'reversed', by: 'admin'}`, taking no seq (a card takes
--              none, 0035 and 0054), one per play (a unique partial index) and written only by reverse_card, which sets
--              `kayfabb.card_end_writer` for the one insert as end_move sets `kayfabb.move_end_writer`. The admin's account is not on
--              the Act, as with moves. An Act is never edited: a play is ended by this Act beside it, and what it shows now is
--              computed from the two. card_ended(play) is the one definition of "ended by an admin" every reader calls.
--
-- What changed, each redefined whole from its latest definition:
--   - acts_kind_check (0062) gains 'card_end'.
--   - acts_character_null (0046) lists 'card_end' with the kinds that belong to no character.
--   - acts_seq_check (0054) and acts_take_seq (0054) leave a card_end without a seq, as a card, a set and a spring are.
--   - acts_well_formed (0054) refuses a card_end written outside reverse_card, and one that is not of a card play in its thread.
--     Everything else is as 0054 wrote it.
--   - acts_check1 (0062) needs no change: a card_end is not among the kinds that point at nothing, so it must name its play.
--
-- A play that landed beyond a post is ended by its card_end too, never by rewriting play_reach.ends_at (play_reach refuses UPDATE).
-- Ways out: a reversal is final and the card can simply be played again. reverse_card refuses, in plain words that say nothing
-- about a face-down card's back, a play that is not a card play, was caught, has worn off, or is already ended.

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end'));

alter table acts drop constraint acts_character_null;
alter table acts add constraint acts_character_null check ((character is null) = (kind in ('tally', 'reveal', 'move_end', 'card_end')));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end'));

-- Exactly the reason and the maker, nothing else.
alter table acts add constraint acts_card_end_payload check (kind <> 'card_end' or (
  payload = '{"why": "reversed", "by": "admin"}'::jsonb) is true);

-- One end per play, and the index every reader asks whether a play has ended by.
create unique index acts_one_card_end on acts (target_act_id) where kind = 'card_end';

-- acts_take_seq (0054), with a card_end among the kinds that take no place in their thread; everything else as 0054 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- acts_well_formed (0054), with a card_end held to reverse_card and to its play; everything else as 0054 wrote it.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through The System' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card_end' and coalesce(current_setting('kayfabb.card_end_writer', true), '') <> 'on' then
    raise exception 'a card ends only through reverse_card' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'unmask' and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an unmask names the class its character holds' using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card_end' and (t.kind <> 'card' or t.thread <> new.thread) then
    raise exception 'a card_end is of a card play, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (t.kind <> 'post' or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;

-- Whether an admin has ended a play. Every SQL reader of "in force" calls this, so one definition says what an ended play is.
create function card_ended(play uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = play)
$$;
revoke execute on function card_ended(uuid) from public, anon;
grant execute on function card_ended(uuid) to authenticated;

-- An admin ends a card play. Refusals read the play's own public facts and say nothing of a face-down card or its back: a Set is
-- not a `card` Act, so it is answered as any Act that is not a card play. Returns the card_end's projection and the play.
create function reverse_card(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  written uuid;
begin
  perform only_admins('ends a card');
  -- The play's row is locked, so two admins at once write one end between them and the second sees the first's.
  select * into p from acts a where a.id = play and a.kind = 'card' for no key update;
  if not found then raise exception 'that is not a card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.payload ? 'caught' then raise exception 'that card was caught by a trap, so it never landed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if (p.payload ->> 'ends')::timestamptz <= now() or exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now()) then
    raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if card_ended(p.id) then raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'card_end', p.thread, p.id, jsonb_build_object('why', 'reversed', 'by', 'admin')) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  -- Task 4 writes the caster's alert here, from the play and its caster's account.
  return act_projection(written) || jsonb_build_object('play', p.id);
end $$;
revoke execute on function reverse_card(uuid) from public, anon;
grant execute on function reverse_card(uuid) to authenticated;

-- ============================================================================ Task 2: a reversed play stops counting ====
--
-- A play with a card_end (card_ended, above) is not in force, wherever the server asks whether a card is. Each function below is
-- redefined whole with `create or replace` from its latest definition, with `not card_ended(<play>.id)` beside its existing `caught`
-- and `ends` tests, its grants and security as before. What a reversed play still does: it keeps its layer, since `layer` counts every
-- play (acts_card_layers refuses a reused layer, so the fourth Whoops! after one of three was reversed is layer 4, never 3); only the
-- stack count `up` drops it. play_reach is append-only and is never updated: a beyond-post play is ended by its card_end alone.
-- card_ended is security definer, and every function here is too, so none of them needs the caller to hold execute on it.
-- spring_traps (0086), with a strike's stack leaving out a play an admin ended (its layer still counts it). Everything else as 0086
-- wrote it, the reads before the decision included.
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
  select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
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
    perform write_alert((select a.character from acts a where a.id = by_act), 'trapStruck', null, struck_play, setter_owner);
    -- The struck card's play goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(struck_play));
  end if;
  return act_projection(sprung);
end $$;

-- place_cast (0086), with a play an admin ended counting for nothing: the ward check, the post stack (`up` only; `layer` still counts
-- every play), the one live board card and the beyond-post stack each leave it out. Everything else as 0086 wrote it. Create or
-- replace keeps 0086's grants (none to an API role); the revoke is stated again.
create or replace function place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb default '{}')
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
        and (w.payload ->> 'ends' is null or (w.payload ->> 'ends')::timestamptz > now()) and not card_ended(w.id)
        and rarity_rank(kind_of.rarity) <= rarity_rank(wk.rarity)
      order by rarity_rank(wk.rarity) desc limit 1;
      if warded.name is not null then
        raise exception 'this post''s % turns away cards up to %', warded.name, warded.rarity using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
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
      select max(r.ends_at) into live_board from play_reach r where r.board = target and r.ends_at > now() and not card_ended(r.play);
      if live_board is not null then
        raise exception 'this board already carries a board card until %', refusal_time(live_board) using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    select count(*) into up from play_reach r join acts k on k.id = r.play
    where r.ends_at > now() and not card_ended(r.play) and k.payload ->> 'card' = card
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
      || case when reach = 'post' and kind_of.play = 'use' and kind_of.lasts is not null then jsonb_build_object('ends', now() + kind_of.lasts) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
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
revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;

-- pinned_threads (0055), with a pin an admin ended not live. Everything else, and the grants, as 0055 wrote them.
create or replace function pinned_threads(board uuid) returns table (thread jsonb, play uuid, ends_at timestamptz, act jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(t), r.play, r.ends_at, to_jsonb(a)
  from play_reach r join thread_list t on t.id = r.thread join acts_public a on a.id = r.play
  where r.pins_board = pinned_threads.board and r.ends_at > now() and not card_ended(r.play)
  order by a.created_at desc, a.id desc
$$;

-- reach_effects (0055), with a play an admin ended not among a target's live plays. Everything else, and the grants, as 0055 wrote them.
create or replace function reach_effects(of_reach text, of_target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id, 'reach', r.reach,
      'ends', to_jsonb(r.ends_at), 'ward', case when ck.ward then ck.rarity end)) order by k.created_at, k.id), '[]')
  from play_reach r join acts k on k.id = r.play left join card_kinds ck on ck.key = k.payload ->> 'card'
  where r.ends_at > now() and not card_ended(r.play) and case of_reach when 'character' then r.character = of_target when 'thread' then r.thread = of_target
                                            when 'board' then r.board = of_target else false end
$$;

-- effects_above (0055), with a play an admin ended left out of all three probes. Everything else, and the grants, as 0055 wrote them.
create or replace function effects_above(characters uuid[], thread uuid, board uuid)
returns table (play uuid, reach text, target uuid, ends_at timestamptz, act jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if cardinality(characters) > 200 then
    raise exception 'effects_above reads at most 200 characters at once' using hint = 'kayfabb.refusal', errcode = '54000';
  end if;
  return query
    select r.play, r.reach, coalesce(r.character, r.thread, r.board), r.ends_at, to_jsonb(a)
    from (
      select x.* from play_reach x where x.character = any (coalesce(effects_above.characters, '{}')) and x.ends_at > now() and not card_ended(x.play)
      union all
      select x.* from play_reach x where x.thread = effects_above.thread and x.ends_at > now() and not card_ended(x.play)
      union all
      select x.* from play_reach x where x.board = effects_above.board and x.ends_at > now() and not card_ended(x.play)
    ) r join acts_public a on a.id = r.play
    order by a.created_at, a.id;
end $$;

-- card_target (0070), with a play an admin ended not among the post's effects. Everything else as 0070 wrote it.
create or replace function card_target(target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'ward', case when ck.ward then ck.rarity end, 'ends', k.payload ->> 'ends')) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught') and not card_ended(k.id) and coalesce(k.payload ->> 'reach', 'post') = 'post'
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
  from acts_public a where a.id = target
$$;

-- save_effect_state (0055), refusing a play an admin ended ("an admin ended that card"), after the author's checks, so it is said only to
-- the post's own author. Everything else as 0055 wrote it.
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
  if card_ended(on_play) then raise exception 'an admin ended that card' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- Timed when written, after any save it waited on, so the newest saved_at is the state kept.
  insert into effect_state as e (play, state, saved_by, saved_at) values (on_play, state, through, clock_timestamp())
  on conflict on constraint effect_state_pkey do update set state = excluded.state, saved_by = excluded.saved_by, saved_at = clock_timestamp();
  return (select jsonb_build_object('play', e.play, 'thread', (select thread from acts where id = on_play), 'state', e.state, 'saved_at', e.saved_at)
          from effect_state e where e.play = on_play);
end $$;

-- release_effect (0016), refusing a play an admin ended ("an admin ended that card"). Everything else, and the grants, as 0016 wrote it.
create or replace function release_effect(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare caller uuid := signed_in_account();
begin
  if not exists (select 1 from acts a where a.id = play and a.kind = 'card') then
    raise exception 'there is no such card on a post' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if card_ended(play) then raise exception 'an admin ended that card' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  insert into effect_releases (account, play) values (caller, play) on conflict do nothing;
  return (select jsonb_build_object('play', r.play, 'released_at', r.released_at) from effect_releases r where r.account = caller and r.play = release_effect.play);
end $$;
