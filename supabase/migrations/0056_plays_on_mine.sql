-- The log names a play's place. docs/plans/2026-11-02-alerts-plan.md, Task 1; docs/plans/2026-11-02-alerts-design.md, sections 9 and 10.
--
-- my_posts_played_on (0043, then 0055) is the plays other players landed on the caller's own things. 0055 narrowed it to a post's
-- plays, because a character or thread play sits on a post and the post's author's log would otherwise say it was played on their
-- post ("The fiction may lie; the log never does"). It now says each play for what it is: the plays on a post one of the caller's
-- characters wrote, on one of their characters (play_reach.character), and on a thread one of their characters started
-- (play_reach.thread; the thread's first Act's author, who is the thread's starter). Each row gains
--   reach        'post', 'character' or 'thread'; a play written before 0055 names none and is a post's
--   target_name  the target's public name as the play's Act wrote it (below), else as it stands: the character's name, or the thread's title; null for a post, which the log names by
--                its author and number from the Acts it reads
-- `post` stays the post the play sits on (a character play's is the post it was played from, a thread play's the thread's first), so
-- the log still links one.
--   target_character  the caller's character the row is about: the character played on, the thread's starter, or the post's author, so
--                a row is filed under it and not under whoever wrote the post the card was played from. A play by one of the caller's own characters is left out, as it always was: it is the caller's card ledger's.
-- A board has no owner, so a board play is no one's row; the caller who played it reads it in their own card ledger.
--
-- The masks: the view is each caller's own rows, filtered by auth.uid() on the target's owner as 0043 filtered on the post's, and a
-- name here is a public one (characters.name and threads.title are on every public page). Nothing is computed from who played it.
-- Everything else, and the grants, as 0055 wrote them.
create or replace view my_posts_played_on as
  select k.id as play, k.target_act_id as post, k.created_at as at, e.saved_at,
         coalesce(pr.reach, 'post') as reach,
         case pr.reach when 'character' then coalesce(k.payload ->> 'targetName', tc.name) when 'thread' then coalesce(k.payload ->> 'targetName', th.title) end as target_name,
         case coalesce(pr.reach, 'post') when 'post' then pc.id when 'character' then tc.id when 'thread' then sc.id end as target_character
  from acts k
  join characters by_whom on by_whom.id = k.character
  left join play_reach pr on pr.play = k.id
  left join acts p on p.id = k.target_act_id
  left join characters pc on pc.id = p.character
  left join characters tc on tc.id = pr.character
  left join threads th on th.id = pr.thread
  left join acts opening on opening.thread = pr.thread and opening.seq = 1
  left join characters sc on sc.id = opening.character
  left join effect_state e on e.play = k.id
  where k.kind = 'card' and by_whom.owner is distinct from auth.uid()
    and (case coalesce(pr.reach, 'post')
           when 'post' then pc.owner
           when 'character' then tc.owner
           when 'thread' then sc.owner
         end) = auth.uid()
    and (pr.play is not null or coalesce(k.payload ->> 'reach', 'post') = 'post');

revoke all on my_posts_played_on from anon, public;
grant select on my_posts_played_on to authenticated;

-- play_card (0055), with the target's public name written into a play beyond a post's payload as `targetName`: the character's name,
-- the thread's title, or the board's name as boards_now gives it at that moment (a board can be renamed by a move, 0046). A log line
-- names a play's target as it was called when the card was played (design, section 9: "from the play's Act"), and the Act is
-- append-only, so a later rename changes no line. A play written before this has no `targetName`; the log then reads the name as
-- it stands (no instance is deployed, so none exists in practice). Everything else as 0055 wrote it, and the grants.
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
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;
revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid) to service_role;
