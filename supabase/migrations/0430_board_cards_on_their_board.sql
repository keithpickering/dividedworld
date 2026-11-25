-- A board card lands in a thread on its board (docs/plans/2026-11-24-staff-board-threads-plan.md, Task 5; the design, section 7).
--
-- A board card used to be written in the one announcements thread on The System's board, whatever board it landed on. It is now written in a thread on the board it lands on, so the board's own readers meet it where they are:
--   1. play_card and place_cast take `in_board_thread`. The thread must be on the target board (threads.board, which every reader reads as a thread's place); a card with none named, or a thread of another board, is refused with "pick a thread on <board> to play it in",
--      and a board with no thread at all with "start a thread on <board> first". The caster is held to the thread's lockout (not_locked_out) as in any play in it. A board card on the system board is allowed, in a thread on it
--      (a staff thread, or the announcements thread an instance already has). Both functions are replaced by a signature with one more argument, so the old ones are dropped and the grants put back.
--   2. lay_sprung lands a sprung board card in the thread its set was laid in when that thread is on the target board, else in the target board's most recently active thread (threads_board_last_at; ties are the index's order, not tie-broken, so the read stays one entry). spring_traps' `lands`
--      no longer asks for an announcements thread: a quote that meets a back has a thread on its board, the one it is in. spring_facts stops reading the setting (its `announce_thread` column stays in the type, now always null).
--   3. thread_page returns `boardCards`: the board cards written in the thread (they sit on no post) from the page's first Act up to the next page's first (page 1 from its start, the last page to its end), at most 100, with their
--      reactions (their ids are in the page's `played`, so its tallies and the caller's reactions are read for them) and their casters among its people. The plan bounded them by the page's first and last post; a card played after the
--      last post would then have no page, so the bound is the next page's first Act. thread_page reads as its caller, who reads no column of `acts`, so board_card_ids (security definer, ids only) finds them by the partial index
--      acts_board_cards (thread, created_at, id) over board plays, and they join the ids `on_posts` already reads through acts_public, so the page's plan holds no more of that view than before (the cold-read budget,
--      supabase/tests/e2e/0028-cold-read-budget.ts, counts what a connection keeps of a plan, and a new reference to the view is about 0.3 MB of it). `plays` leaves them out (a play on a post has a target; a board card has none)
--      and `boardCards` is made of them.
--
-- Copied from the latest definitions: place_cast 0413_rewind (the plan said 0413:1002), play_card 0374_cards_on_a_spun_thread, spring_facts 0411_post_effects, spring_traps 0413_rewind (the plan did not name it: the `lands` test
-- that needed the announcements thread is there, not in spring_facts), lay_sprung 0360_setting_thread, thread_page 0413_rewind (the plan said 0396_poll_reads).
-- Cost at a busy instance: a play reads one row of threads by key (the named thread, and its board), or one probe of threads_board when it is refused; a spring one probe of threads_board_last_at; a page one probe of
-- acts_board_cards and two of acts' (thread, seq) key. None grows with the threads, boards or Acts an instance holds (supabase/tests/0430-board-cards.sql counts the reads of threads). Ways out: no state is added; the
-- refusals each say what to do, and a card's end is the card's own. Masks: a thread's place and its board's threads are public, and the words are the same for every caller; nothing private is read.

create index acts_board_cards on acts (thread, created_at, id) where kind = 'card' and payload ->> 'reach' = 'board';

-- ---- 1. place_cast, play_card ----
drop function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb);
drop function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[]);

create or replace function public.place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb DEFAULT '{}'::jsonb, in_board_thread uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_kind text;
  author uuid;
  in_thread uuid;
  on_post uuid := target;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded text;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
  target_name text;
  staff_caster boolean;
  drive_id uuid;
  drive_up integer;
  quad text;
  w_why text;
  w_opens timestamptz;
  w_closes timestamptz;
  last_settled timestamptz;
  rode boolean := false;
  is_instant boolean;
  is_relief boolean;
  lightest integer;
  took integer;
  relief_rows jsonb;
  lifts jsonb;
  landing text;
  shown uuid;
  lands boolean := true;
  handed jsonb;
  shot_play uuid;
  shot_up_to text;
  shot_card text;
  shot_tried uuid[] := '{}';
  shot_try integer;
  passed_ward text;
  passed_back boolean := false;
  is_unban boolean;
  cut_play uuid;
  cut_words text;
  full_words text;
  frozen text;
  rewind_to uuid;
  rewind_why text;
  rewind_point timestamptz;
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
  -- A Gimmick never goes on a board, whatever its card lists (the catalog check refuses a card that lists one).
  if kind_of.play = 'use' and reach = 'board' then
    raise exception '% is never used on a board', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A staff character casts no card that carries a gimmick (a cast earn): the settlement leaves a staff character's Acts out, so the play's Lens would claim a boost that is never paid. Plain words, no refusal hint:
  -- a pool persona is never offered one (cards.ts, staffOffers), so this is for a caller that skipped the offer.
  if staff_caster and kind_of.play = 'cast' and kind_of.gimmick is not null then
    raise exception 'a staff character casts no card that carries an earn' using errcode = '22023';
  end if;
  -- Nor a card with a discipline: infract refuses a staff character, and the staff's rulings are The System's own, which these are player moves around. Plain words, no refusal hint, for the same reason.
  if staff_caster and kind_of.play = 'cast' and kind_of.discipline is not null then
    raise exception 'a staff character casts no card that has a discipline' using errcode = '42501';
  end if;
  -- Nor a card that ends a Gimmick: the Gimmick it names is a player's play, and a persona does not choose one (the Buzzkill design, section 2.5). Plain words, no refusal hint, for the same reason.
  if staff_caster and kind_of.cuts is not null then
    raise exception 'a staff character casts no card that ends a Gimmick' using errcode = '42501';
  end if;
  -- A relief or an unban is over when it lands (card notes, Part 5): it leaves no effect, takes no place in a stack and has no time up, so it writes no `ends` and no play_reach row.
  is_relief := kind_of.discipline ->> 'kind' = 'relief';
  is_unban := coalesce(kind_of.discipline ->> 'kind' = 'unban', false);
  -- A card that cuts is over when it lands too: no `ends`, no play_reach row, no layer, no place in a stack. The play it names is read here only when it is a uuid (cut_refusal says the rest).
  is_instant := coalesce(kind_of.discipline ->> 'kind' in ('relief', 'unban'), false) or kind_of.cuts is not null;
  if kind_of.cuts is not null and config ->> 'play' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then cut_play := (config ->> 'play')::uuid; end if;

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if not coalesce(post_kind(target_kind), false) then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- A character locked out of the post's thread plays nothing there. Asked here, before the ward, the back or anything written, so the Move that springs a lockout is not refused by the lockout it springs: the spring is
    -- written below, after this, and nothing after it asks again. It reads the public spring alone, so the same words come whoever owns the caster.
    perform not_locked_out(caster, in_thread);
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- Task 4 (section 3), taking the fall: a fall is played on a post whose author is not hidden, on a player's post, and on another character's. Both read public facts of the post's author (a staff flag, a character: who wrote a post is public),
    -- and compare characters, never accounts, so a second mask of the author's account may take the fall and no refusal differs with who owns the caster or the author. The stack count below is as for any card.
    if kind_of.discipline ->> 'kind' = 'fall' then
      -- A post under a live author veil (0357) is shown under the stand-in to everyone, and a fall is all about whose post it is: the refusals below compare the caster with the TRUE author, so the author's own
      -- masks would meet the own-post words while every other caster's fall landed. So while the veil is up a fall is refused first, in one sentence and one code for every caster alike, before anything is
      -- paid or written (no Mod Bot visits a veiled post, so a fall there could not be taken before the veil ends in any case). The time is the veil's own end, public as the veil is.
      if author_veiled(target) then
        raise exception 'this post''s author is hidden until %; nobody takes the fall for it before then', refusal_time(author_veil_ends(target)) using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
      if exists (select 1 from characters c where c.id = author and c.staff is not null) then
        raise exception '% is played on a player''s post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if author is not distinct from caster then
        raise exception '% is played on another character''s post', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    end if;
    -- A card that stops quotes is not laid on a post that holds a card face down: a back springs on a quote, and the two would pull against each other. A back is live by the predicate place_set uses (public, since
    -- the back is); the post's row is locked above and place_set takes the same row first, so the two are laid one at a time.
    if kind_of.play = 'use' and kind_of.gimmick ->> 'kind' = 'noQuote'
       and exists (select 1 from face_down f where f.post = target and f.ends_at > now()
                   and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
                   and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
      raise exception '% stops quotes, and this post holds a card face down; take that card back first', kind_of.name using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    -- One global order over play_reach rows: every cast takes the caster's live pierce rows up front, in ONE statement ordered by play id (a cut of a Gimmick on a character adds the named play's row to that same
    -- statement), before the loop below chooses which pierce to spend. The loop keeps its own choosing order (oldest first) but then takes no row it does not already hold, so no two casts can hold rows in opposite
    -- orders: a cut of a Cheap Shot and that Cheap Shot's spending cast, or two casts of one character, wait on one another's rows one way round only. cut_refusal is asked after the lock, so a play spent or
    -- ended while this waited is read as it now stands. The pierce loop never chooses the play a cut names: a cut spends no pierce on the Gimmick it ends (else reversing the cut would leave it ended by the pierce clause). (A pierce played after this statement by the same caster in another session is a row this one never holds.)
    if kind_of.play = 'cast' and not staff_caster then
      perform 1 from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
      where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce'
      order by r.play for update of r;
    end if;
    -- The caster's pierce, locked last before the Ward check (no other writer locks a play_reach row), so two casts by one character take it one after the other, and the second, reading after the
    -- lock, finds it spent. A pierce is read by a cast alone (not a Use) and not by a staff character's, which holds none. A pierce found spent once the lock is held (a concurrent cast spent it) is
    -- set aside and the next live, unspent one is locked and asked in turn, at most three tries; a caster holding no other pierce goes on with none.
    if kind_of.play = 'cast' and not staff_caster then
      shot_tried := '{}';
      for shot_try in 1..3 loop
        select r.play, ck.gimmick ->> 'upTo', k.payload ->> 'card' into shot_play, shot_up_to, shot_card
        from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
        where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce' and not card_ended(r.play) and r.play <> all (shot_tried) and r.play is distinct from cut_play
        order by k.created_at, k.id limit 1 for update of r;
        -- Asked again in a statement of its own, after the lock: a cast that held the row first may have spent it.
        exit when shot_play is null or not card_ended(shot_play);
        shot_tried := shot_tried || shot_play;
        shot_play := null; shot_up_to := null; shot_card := null;
      end loop;
    end if;
    -- A live ward Gimmick on the post turns away a cast its rarity, flavor or name covers, in the same words for everyone (cards.ts's wardWords). A pierce passes a ward whose card is no rarer than it.
    if kind_of.play = 'cast' then
      warded := ward_refusal('post', target, kind_of, shot_up_to);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      -- The freeze guards a play whose reach is the post, as the wards do and as the engine does (cards.ts, frozenRefusal): a card played from a rewound post at a character, a thread or a board is not on the post and is not turned away.
      -- A live rewind on the post turns away every card up to its rarity, in the same words for everyone (cards.ts's rewindWords), and a pierce passes a rewind whose card is no rarer than it. It sits right after the Ward and before
      -- the stack, the effects limit (post_room_words) and everything written: the post's row is held (above), as the limit is read under that same lock, so a rewind played at the same moment is seen by the card behind it. A rewind is face up,
      -- so the refusal reads public facts alone (the incoming card's rarity, the rewind's card and its time).
      frozen := rewind_refusal(target, kind_of, shot_up_to);
      if frozen is not null then raise exception '%', frozen using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      if shot_play is not null then
        select w.card into passed_ward from wards_against('post', target, kind_of) w where rarity_rank(w.rarity) <= rarity_rank(shot_up_to) order by w.at, w.play limit 1;
      end if;
      -- What the card's landing refuses on this post (land_refusal): public facts alone, the same words for every caster, and before anything is written.
      landing := land_refusal(kind_of, target, coalesce(config, '{}'));
      if landing is not null then raise exception '%', landing using hint = 'kayfabb.refusal', errcode = land_refusal_code(landing); end if;
      -- A card that cuts: the Gimmick it names is up on this post and no rarer than its upTo (public plays and printed rarity alone, the same words for every caster). The post's row is held, so the Gimmicks are read as they stand.
      cut_words := cut_refusal(kind_of, 'post', target, coalesce(config, '{}'));
      if cut_words is not null then raise exception '%', cut_words using hint = 'kayfabb.refusal', errcode = '55000'; end if;
      -- A rewind names a point of this post's History: `to` is one of its versions, and showing that version must change what the post shows now (rewind_point_problem, the engine's words in the engine's order). A missing or malformed `to`
      -- is no version, so it gets the "pick a point" words and never a cast error. The point it names is written beside `ends` below, so the play is read as the post at that time for as long as it is up. The words read public facts alone
      -- (the post's versions and its plays), the same for every caster.
      if kind_of.rewind is not null then
        rewind_to := case when coalesce(config, '{}') ->> 'to' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (config ->> 'to')::uuid end;
        rewind_why := rewind_point_problem(target, rewind_to);
        if rewind_why is not null then raise exception '%', rewind_why using hint = 'kayfabb.refusal', errcode = '22023'; end if;
        rewind_point := rewind_point_at(target, rewind_to);
      end if;
    elsif kind_of.play = 'use' then
      -- A Use on the author's own post meets a live rewind's freeze as a Move does (a Use has no Ward asked of it and holds no pierce), in the same words and at the same place in the order, before the stack and the limit.
      frozen := rewind_refusal(target, kind_of);
      if frozen is not null then raise exception '%', frozen using hint = 'kayfabb.refusal', errcode = '42501'; end if;
    end if;
    -- A card with a time up ends at it, whatever it holds (a skim, a veil, a use card): the stack below and the end both read the play's `ends`.
    if kind_of.lasts is not null then ends := now() + kind_of.lasts; end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    -- A skim card names the reaction quadrant it skims, one of the four, in its configuration.
    quad := coalesce(config, '{}') ->> 'quadrant';
    if kind_of.skim is not null and not coalesce(quad = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
      raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'instant');
    -- A drive card's stack is counted in the post's open drive only: the drive whose latest play, plus the card's `lasts`, is still ahead. A play joins it, or opens a drive of its own id.
    if kind_of.drive is not null then
      select d.drive, count(*) into drive_id, drive_up from drive_plays(target, card) d
      group by d.drive having max(d.created_at) + span_interval(kind_of.drive -> 'lasts') > now()
      order by max(d.created_at) desc limit 1;
      if drive_id is null then
        drive_id := written;
        up := 0;
      else
        up := drive_up;
        if up >= kind_of.stack then raise exception 'this post''s drive already carries % appeals', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      end if;
    end if;
    if kind_of.skim is not null then
      -- A skim card's stack is one live play of it per quadrant on the post (the plays still up, as above), whatever the card's `stack` says.
      select count(*) into up from acts k
      where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
        and coalesce(k.payload ->> 'reach', 'post') = 'post' and k.payload #>> '{config,quadrant}' = quad
        and (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id);
      if up >= 1 then raise exception 'this post already carries that card for that quadrant' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    elsif up >= kind_of.stack then
      if kind_of.surface then raise exception 'This post is already a wall. Draw on it instead.' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    -- A play that draws an effect takes a slot on the post, and the post's row is held, so two plays racing for the last slot land one at a time (post_room_words, 0411).
    if kind_of.draws_effect then
      full_words := post_room_words(target);
      if full_words is not null then raise exception '%', full_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    end if;
    if kind_of.play = 'cast' then
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it; a ride back lets it land and is paid by its votes (`did` is
      -- rode). Nothing pays out here, so spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      -- A rewind's own play lands frozen (design 2.6 and 4.3): it names a point of the post and takes hold at once, so no back already face down there catches or springs on it (the back stays set, and springs later where a trigger meets
      -- it once the rewind is over). The next play on the post meets the back as it always did, but under the rewind spring_traps springs nothing.
      if kind_of.rewind is null then
        sprung := spring_traps('cast', target, written, card, actor => payer, passing => shot_up_to, locking => caster);
      end if;
      -- A back the pierce passed answers `passed` and wrote nothing: the cast met no back.
      if sprung ->> 'passed' = 'true' then passed_back := true; sprung := null; end if;
      rode := sprung is not null and sprung -> 'payload' ->> 'did' = 'rode';
      -- The cast lands when no back caught it: it met none, or a back that rides, refunds or locks its caster out. The order is the Ward first (above), then the back, then the sign; a cast is handed back once at most.
      lands := sprung is null or sprung -> 'payload' ->> 'did' in ('rode', 'returned', 'lockedOut');
      if lands and payer is not null then
        if sprung -> 'payload' ->> 'did' = 'returned' then
          handed := jsonb_build_object('by', sprung -> 'payload' ->> 'set', 'card', sprung -> 'payload' ->> 'card');
        else
          -- The post's live refunds Gimmick: the latest play on this post whose card has refunds, is still up, names this card's flavor and has handed back fewer casts than its count. A card that cuts is never handed back by the Gimmick it names (the owner's answer, #965): the cutting card is consumed; a cut of another Gimmick is handed back by a refunds Gimmick still up as any Salty Move is. The post's row is locked
          -- above, so two casts are counted one after the other.
          select jsonb_build_object('by', k.id, 'card', k.payload ->> 'card') into handed
          from acts k join card_kinds rk on rk.key = k.payload ->> 'card'
          where k.kind = 'card' and k.target_act_id = target and coalesce(k.payload ->> 'reach', 'post') = 'post' and rk.refunds is not null
            and k.id is distinct from cut_play
            and (k.payload ->> 'ends')::timestamptz > now() and not card_ended(k.id)
            and rk.refunds -> 'flavors' ? kind_of.alignment
            and (select count(*) from acts h where h.kind = 'card' and h.target_act_id = target and h.payload #>> '{handedBack,by}' = k.id::text) < (rk.refunds ->> 'count')::integer
          order by k.created_at desc, k.id desc limit 1;
        end if;
      end if;
    end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      -- The lock order is post, then visits_open, then character, everywhere (a visit's filing takes the post's row first and, in infract, its author's character after): the post the card is played from is held `for share`
      -- before the target character's row, so a card on a character and a filing on that post never hold one each and wait on the other. (Before 0357 the character came first.)
      perform 1 from acts a where a.id = from_post and post_kind(a.kind) for share;
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select c.name into target_name from characters c where c.id = target;
      -- The stand-in is shown in place of an author, so a card on it would be a card on whoever it stands for.
      if target is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      -- The post it is played from is held `for share` before it is read: a veil cast on that post (which takes the row `for no key update`) checks for a card played from it after taking it, so the card and the veil
      -- are laid one at a time, and whichever is second reads what the first left (a veiled post is not its character's, so the card is refused; a post a card was played from takes no veil). The post's row is
      -- held already (above, before the character's), and a veil cast holds the post's row and takes no character's row, so the order closes no cycle.
      select a.thread, a.character into in_thread, shown from acts_public a where a.id = from_post and post_kind(a.kind);
      -- A post under a live author veil is shown under the stand-in to everyone, so a card on a character played from it is a card on the stand-in whoever the caster names, the post's author included: one refusal, in the
      -- words and the code a third player meets naming the stand-in itself, and the same whoever owns the post. (A post that is not veiled is refused as it was, for a character that is not its own.)
      if shown is not null and shown is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      if in_thread is null or shown is distinct from target then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      perform not_locked_out(caster, in_thread);
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from caster then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
      -- A card with a discipline lands on a player's character, never a staff character: who is on staff is public, and the words are the same for every caller.
      if kind_of.discipline is not null and exists (select 1 from characters c where c.id = target and c.staff is not null) then
        raise exception '% lands on a player''s character', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.title into target_name from threads t where t.id = target;
      in_thread := target;
      perform not_locked_out(caster, in_thread);
      select a.id, a.character into on_post, author from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      -- A Gimmick on a thread is a match stipulation, so only on a thread the caster's own character started. Who started a thread is public, and the refusal says nothing of anyone else's.
      if kind_of.play = 'use' and author is distinct from caster then
        raise exception '% is used on a thread your own character started', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    else
      perform 1 from boards b where b.id = target for no key update;
      if not found then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select b.name into target_name from boards_now b where b.id = target;
      -- The card is written in a thread on the board it lands on, the one the caster named: a thread's place is public, and so are the words, the same for every caller. A board with no thread at all is told to start one;
      -- a thread of another board, one that does not exist and none named are told to pick one. The caster is held to the thread's lockout as for any play in it.
      if in_board_thread is null or not exists (select 1 from threads t where t.id = in_board_thread and t.board = target) then
        if not exists (select 1 from threads t where t.board = target) then
          raise exception 'start a thread on % first', target_name using hint = 'kayfabb.refusal', errcode = '22023';
        end if;
        raise exception 'pick a thread on % to play it in', target_name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      in_thread := in_board_thread;
      perform not_locked_out(caster, in_thread);
      on_post := null;
      -- One board card at a time, of any card.
      select max(r.ends_at) into live_board from play_reach r where r.board = target and r.ends_at > now() and not card_ended(r.play);
      if live_board is not null then
        raise exception 'this board already carries a board card until %', refusal_time(live_board) using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- A scored-as card on a character names a class the instance has and a window that can be named, once for the character in that window. The window is public (settlements, seasons, settings).
    if kind_of.scores_as then
      if not exists (select 1 from class_kinds ck where ck.key = coalesce(config, '{}') ->> 'class') then
        raise exception 'there is no such class' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      select w.opens, w.closes, w.why into w_opens, w_closes, w_why from scored_as_window(now()) w;
      if w_why is not null then raise exception '%', w_why using hint = 'kayfabb.refusal', errcode = '55000'; end if;
      select max(x.ends_at) into last_settled from settlements x;
      if exists (select 1 from play_reach r join acts k on k.id = r.play join card_kinds sk on sk.key = k.payload ->> 'card'
                 where r.character = target and sk.scores_as and k.created_at >= last_settled and not card_ended(k.id)) then
        raise exception 'this character already has a class named for the window after the next settlement' using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- One global order over play_reach rows: every cast takes the caster's live pierce rows up front, in ONE statement ordered by play id (a cut of a Gimmick on a character adds the named play's row to that same
    -- statement), before the loop below chooses which pierce to spend. The loop keeps its own choosing order (oldest first) but then takes no row it does not already hold, so no two casts can hold rows in opposite
    -- orders: a cut of a Cheap Shot and that Cheap Shot's spending cast, or two casts of one character, wait on one another's rows one way round only. cut_refusal is asked after the lock, so a play spent or
    -- ended while this waited is read as it now stands. (A pierce played after this statement by the same caster in another session is a row this one never holds.)
    if kind_of.play = 'cast' and not staff_caster then
      perform 1 from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
      where (r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce') or (kind_of.cuts is not null and r.play = cut_play)
      order by r.play for update of r;
    end if;
    -- The caster's pierce, locked last before the Ward check (no other writer locks a play_reach row), so two casts by one character take it one after the other, and the second, reading after the
    -- lock, finds it spent. A pierce is read by a cast alone (not a Use) and not by a staff character's, which holds none. A pierce found spent once the lock is held (a concurrent cast spent it) is
    -- set aside and the next live, unspent one is locked and asked in turn, at most three tries; a caster holding no other pierce goes on with none.
    if kind_of.play = 'cast' and not staff_caster then
      shot_tried := '{}';
      for shot_try in 1..3 loop
        select r.play, ck.gimmick ->> 'upTo', k.payload ->> 'card' into shot_play, shot_up_to, shot_card
        from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
        where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce' and not card_ended(r.play) and r.play <> all (shot_tried) and r.play is distinct from cut_play
        order by k.created_at, k.id limit 1 for update of r;
        -- Asked again in a statement of its own, after the lock: a cast that held the row first may have spent it.
        exit when shot_play is null or not card_ended(shot_play);
        shot_tried := shot_tried || shot_play;
        shot_play := null; shot_up_to := null; shot_card := null;
      end loop;
    end if;
    -- A live ward Gimmick on the character, thread or board turns away a cast its rarity, flavor or name covers, on its own target only. A pierce passes a ward whose card is no rarer than it.
    if kind_of.play = 'cast' then
      warded := ward_refusal(reach, target, kind_of, shot_up_to);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      if shot_play is not null then
        select w.card into passed_ward from wards_against(reach, target, kind_of) w where rarity_rank(w.rarity) <= rarity_rank(shot_up_to) order by w.at, w.play limit 1;
      end if;
      -- A card that cuts: the Gimmick it names is up on this character and no rarer than its upTo, asked after the Ward and after the lock above.
      cut_words := cut_refusal(kind_of, 'character', target, coalesce(config, '{}'));
      if cut_words is not null then raise exception '%', cut_words using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    end if;
    -- A relief or an unban reads the character's public bar or bans with its row held (the lock infract takes, so a filing and a heart on one character go one after the other), and is
    -- refused before anything is spent or written, in the same words for every caller (a bar and a ban are public: warn_points and banned_until are on every postbit).
    if is_relief then
      -- The lightest band is the least of the three band values the settings hold; a bar with fewer points than the card takes gives what it has. The walk is read once, in one statement: the live infractions
      -- (live_infractions, the predicate warn_points sums), oldest first, each giving what is left on it until the card has taken what it says. `took` is the sum of those rows and the rows are what is
      -- written below, so the Act's words and its relief rows cannot disagree (an appeal's ruling takes no lock on the character and may land between two reads).
      lightest := (select min(v::integer) from jsonb_each_text(setting('warnBar') -> 'bands') b(k, v));
      select jsonb_agg(jsonb_build_object('infraction', w.id, 'points', w.pts) order by w.created_at, w.id), coalesce(sum(w.pts), 0)::integer into relief_rows, took
      from (
        select l.id, l.created_at,
               least(l.left_over, greatest(0, least(case when kind_of.discipline ->> 'points' = 'all' then sum(l.left_over) over () else lightest end, sum(l.left_over) over ())
                                                    - (sum(l.left_over) over (order by l.created_at, l.id) - l.left_over))) as pts
        from live_infractions(target) l where l.left_over > 0
      ) w where w.pts > 0;
      if took = 0 then raise exception 'this character''s warn bar is empty' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    elsif is_unban then
      -- Every ban running on the character, by the end each has now: a late filing can lay a second.
      select jsonb_agg(jsonb_build_object('ban', x.id, 'until', x.ends) order by x.created_at, x.id) into lifts
      from (select b.id, b.created_at, ban_ends(b.id) as ends from acts b where b.kind = 'ban' and b.payload ->> 'character' = target::text) x where x.ends > now();
      if lifts is null then raise exception 'this character is not banned' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    end if;
    if not is_instant then
      select count(*) into up from play_reach r join acts k on k.id = r.play
      where r.ends_at > now() and not card_ended(r.play) and k.payload ->> 'card' = card
        and case place_cast.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
      if up >= kind_of.stack then
        where_words := 'this ' || reach;
        if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
        raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
      ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
      -- A scored-as play lasts until its window closes, not a time from now.
      if kind_of.scores_as then ends := w_closes; end if;
    end if;
  end if;

  -- A card that needs words refuses a blank message in its own words, after the landing's refusals as the engine says them (decided, engine/rules/cards.ts); the message is trimmed as casterMessage trims it.
  if kind_of.needs_message is not null and btrim(said, E' \t\r\n\f\v') = '' then
    raise exception '%', kind_of.needs_message using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', (case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end) - case when kind_of.draws is not null then array['drawn'] else '{}'::text[] end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'targetName', target_name)
                || case when not is_instant then jsonb_build_object('ends', ends)
                        when is_relief then jsonb_build_object('instant', true, 'took', took)
                        when kind_of.cuts is not null then jsonb_build_object('instant', true)
                        else jsonb_build_object('instant', true, 'lifted', lifts) end
              when not lands then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              -- A card that cuts is over when it lands: no layer, so no place in a stack and nothing for acts_card_layers to collide on. A back that rode or locked its caster out is still named.
              when kind_of.cuts is not null then jsonb_build_object('instant', true)
                || case when rode then jsonb_build_object('rode', sprung -> 'payload' ->> 'set')
                        when sprung is not null and sprung -> 'payload' ->> 'did' = 'lockedOut' then jsonb_build_object('lockedOut', sprung ->> 'id') else '{}'::jsonb end
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set')
              -- A lockout back's spring names the play (`by`); the play names the spring (`lockedOut`), so the caster's alert and log line read it on from the play as a ride's are read from `rode`.
              when sprung is not null and sprung -> 'payload' ->> 'did' = 'lockedOut' then jsonb_build_object('layer', layer, 'lockedOut', sprung ->> 'id')
              else jsonb_build_object('layer', layer) end
      -- What handed the cast back to its caster's hand (the back's set play or the sign's play, with its card), as a public fact of the cast; the caster's ledger row below is the other half.
      || case when handed is not null then jsonb_build_object('handedBack', handed) else '{}'::jsonb end
      -- The Gimmick a landed cut ended (its play and its card), a public fact of the Move that card_cut_at reads; a play a back caught never lands and carries none.
      || case when kind_of.cuts is not null and lands then jsonb_build_object('cut', jsonb_build_object('play', cut_play, 'card', (select a.payload ->> 'card' from acts a where a.id = cut_play))) else '{}'::jsonb end
      -- The pierce the cast was made under, whether it lands or is caught: its play, its card, and the oldest ward it got past (a public fact of the Move, which the Lens line reads).
      || case when shot_play is not null then jsonb_build_object('pierce', jsonb_strip_nulls(jsonb_build_object('by', shot_play, 'card', shot_card, 'ward', passed_ward))) else '{}'::jsonb end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      -- A play a back caught never lands and is never in effect, so it holds no end (0370): settle.ts boosts and skims only with a play's `ends`.
      || case when reach = 'post' and kind_of.lasts is not null and lands then jsonb_build_object('ends', ends) else '{}'::jsonb end
      -- A rewind's point, the time its version names (rewind_point_at): live_rewind reads it back, and the post is shown as of it while the play is up.
      || case when reach = 'post' and rewind_point is not null and lands then jsonb_build_object('rewind_at', rewind_point) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- A cast handed back returns to its caster's hand: a `returned` row naming the cast, as a take-back writes (card_held counts it). Written beside the Act, once, whichever of the back or the sign handed it.
  if handed is not null then
    insert into card_ledger (account, card, kind, act, price) values (payer, card, 'returned', written, 0);
  end if;
  -- What a landed play on a post needs beside its Act (a veil's row): not for a play a back caught, which never lands.
  if reach = 'post' and lands then perform land_rows(written, kind_of, on_post, coalesce(config, '{}'), caster); end if;
  if kind_of.surface and reach = 'post' and lands then perform open_surface(written); end if;
  if reach <> 'post' and not is_instant then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- What a relief took, and what an unban lifted, as rows beside the play (the play's own Act is never changed): the rows the walk above gave, the ones `took` is the sum of; an unban lifts each ban it found.
  if is_relief then
    insert into warn_reliefs (play, infraction, points) select written, (e ->> 'infraction')::uuid, (e ->> 'points')::integer from jsonb_array_elements(relief_rows) e;
  elsif is_unban then
    insert into ban_lifts (play, ban) select written, (e ->> 'ban')::uuid from jsonb_array_elements(lifts) e;
  end if;
  -- A card Cast at thread reach talks down the open visits on the thread whose Mod a distraction moves (0108), once for each, as this caster's attempt.
  if reach = 'thread' and not staff_caster then perform distract_visits(caster, target, written); end if;
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  -- A caught cast tells its caster, as a card landed from a back tells the struck: a trapStruck on the caught play, naming nothing but the play (the spring names the setter's
  -- character). The setter's account is the alert's actor only so that a player's cast on their own other mask's Trap Card tells nobody; the alert reads no owner into any answer.
  if sprung is not null then
    perform write_alert(caster, 'trapStruck', null, written, (select f.account from face_down f where f.play = (sprung -> 'payload' ->> 'set')::uuid));
  end if;
  -- A back a pierce passed tells the caster alone, in the same alert a caught cast writes with a sub of `passed`; the setter is told nothing (a spring that never was).
  if passed_back then perform write_alert(caster, 'trapStruck', 'passed', written); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;
revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb, uuid) from public, anon, authenticated;

create or replace function public.play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text DEFAULT ''::text, reach text DEFAULT 'post'::text, from_post uuid DEFAULT NULL::uuid, version uuid DEFAULT NULL::uuid, tokens integer DEFAULT NULL::integer, reply text DEFAULT NULL::text, framing uuid[] DEFAULT '{}'::uuid[], in_board_thread uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  held integer;
  said text := coalesce(message, '');
  played jsonb;
  written uuid;
  carries boolean := coalesce((select k.replies from card_kinds k where k.key = play_card.card), false);
  reply_id uuid;
  in_thread uuid;
  under jsonb;
begin
  if version is not null and reach = 'post' then
    perform 1 from accounts where id = who for no key update;
    perform 1 from acts a where a.id = target and post_kind(a.kind) for no key update;
    if found and post_version(target) is distinct from version then
      raise exception 'the post was edited; look again' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A kind that replies carries a reply with a word in it, within the length a post takes, and lands on a post; any other kind is given none.
  if carries then
    if reply is null or reply !~ phrase_word_class() then raise exception 'write the reply this card carries' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    perform within('body', reply, 'postMaxLength');
    if reach <> 'post' then raise exception 'this card lands on %', reach_list('{post}') using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    reply_id := gen_random_uuid();
  elsif reply is not null then
    raise exception 'only a card that carries a reply takes one' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform require_old_voice(card);
  perform require_write_tokens(card, tokens);
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  held := card_held(who, play_card.card);
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  -- A play that also posts takes the locks of a post that quotes the parent, in post()'s order and before its card is inserted (the header's lock order): the parent's row (2),
  -- then its live backs, the thread and the count rows (lock_for_quote, 2b to 5). A target that is no post is place_cast's to refuse.
  if carries then
    select a.thread into in_thread from acts a where a.id = target and post_kind(a.kind) for no key update;
    if in_thread is not null then perform lock_for_quote(through, in_thread, target); end if;
  end if;
  played := place_cast(through, card, target, config, said, reach, from_post, who, price,
    (case when tokens is null then '{}'::jsonb else jsonb_build_object('tokens', tokens) end)
    || (case when carries then jsonb_build_object('reply', reply_id) else '{}'::jsonb end), in_board_thread);
  written := (played ->> 'id')::uuid;
  -- A cast that landed (a ride lets it) writes its reply and the row that draws it under the parent; a caught one writes none, and the id its Act names is no post's.
  if carries and not (played -> 'payload' ? 'caught') then
    perform write_reply(through, in_thread, reply, framing, reply_id);
    insert into post_under (play, parent, reply, thread) values (written, target, reply_id, in_thread);
    under := jsonb_build_object('parent', target, 'play', written, 'act', act_projection(reply_id));
  end if;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return played || case when under is not null then jsonb_build_object('under', under) else '{}'::jsonb end;
end $function$;
revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[], uuid) to service_role;

-- ---- 2. spring_facts, spring_traps, lay_sprung ----
create or replace function public.spring_facts(fd face_down, trigger text, by_act uuid, incoming_card text)
 RETURNS spring_facts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f spring_facts;
  k card_kinds%rowtype;
  named text;
  in_character integer;
  in_thread integer;
  in_board integer;
  walked_plain text;
  raw_body text;
  raw_forged uuid[];
  walked_excerpt text;
  ic card_kinds%rowtype;
  m jsonb;
  ic_rank integer;
  up_rank integer;
  own_rank integer;
  flavor_ok boolean;
  matched boolean;
begin
  -- 1. The setter's character, and what decides whether it can act (retired, not debuted), who it belongs to and whether it is staff.
  select a.character into f.setter_character from acts a where a.id = fd.play;
  select c.retired_at, c.debuted_at, c.owner, c.staff is not null into f.setter_retired, f.setter_debuted, f.setter_owner, f.setter_staff from characters c where c.id = f.setter_character;
  -- 2. The back's card kind.
  select * into k from card_kinds x where x.key = fd.card;
  f.kind_play := case when k.gone_at is null then k.play end; f.kind_trap := case when k.gone_at is null then k.trap end; f.kind_stack := k.stack; f.kind_seeded := k.seeded;
  f.kind_skim := k.skim is not null; f.kind_scores := k.scores_as; f.kind_veil := k.veil;
  f.reach := coalesce(k.reaches[1], 'post');
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post (a board card is written in a thread on the board, which a Act on it always has). For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, case when coalesce(version_hidden(a.id), false) then null else a.payload ->> 'body' end, act_forged(a.payload), t.board into f.by_kind, f.by_character, f.by_thread, raw_body, raw_forged, f.by_board
  from acts a left join threads t on t.id = a.thread where a.id = by_act;
  select a.id into f.first_post from acts a where a.thread = f.by_thread and a.seq = 1 and post_kind(a.kind);
  -- 4. The stack at the would-be target and reach, for every reach: the plays of the card still up on the Act (a post's), the layer to go on from, and the plays of it still up on
  -- the Act's character, thread and board (a play beyond a post's), counted as place_cast counts them. Which reach the card takes is then a choice among values already read.
  f.target := case f.reach when 'post' then by_act when 'character' then f.by_character when 'thread' then f.by_thread else f.by_board end;
  -- Each play found is asked whether an admin ended it, whatever card it is (card_ended is a read of its own, and the subquery cannot be flattened away, so it is made for every play found and not only
  -- for the ones of this back's card): which card is counted is chosen after the reads.
  select count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended),
         greatest(coalesce(max(l.layer) filter (where l.card is not distinct from fd.card), 0), count(*) filter (where l.card is not distinct from fd.card)) + 1,
         count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended and l.quadrant is not distinct from (fd.config ->> 'quadrant'))
    into f.up, f.layer, f.quadrant_up
  from (select k2.payload ->> 'card' as card, (k2.payload ->> 'ends')::timestamptz as ends, (k2.payload ->> 'layer')::integer as layer, card_ended(k2.id) as ended,
               k2.payload #>> '{config,quadrant}' as quadrant
        from acts k2 where k2.kind = 'card' and k2.target_act_id = by_act and not (k2.payload ? 'caught') and coalesce(k2.payload ->> 'reach', 'post') = 'post' offset 0) l;
  f.quadrant_ok := (fd.config ->> 'quadrant') = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']);
  -- The window a scored-as play would name, and whether the quoting character already has a class named for it: a play of any scored-as card made at or after the last settled window's end, not ended.
  select w.opens, w.closes, w.why into f.window_opens, f.window_closes, f.window_why from scored_as_window(now()) w;
  f.class_ok := exists (select 1 from class_kinds ck where ck.key = fd.config ->> 'class');
  select count(*) filter (where l.card = fd.card and not l.ended and l.character = f.by_character), count(*) filter (where l.card = fd.card and not l.ended and l.thread = f.by_thread),
         count(*) filter (where l.card = fd.card and not l.ended and l.board = f.by_board),
         count(*) filter (where l.scores and not l.ended and l.character = f.by_character and l.at >= (select max(x.ends_at) from settlements x)) > 0
    into in_character, in_thread, in_board, f.class_taken
  from (select k2.payload ->> 'card' as card, r.character, r.thread, r.board, card_ended(r.play) as ended, k2.created_at as at, coalesce(ck.scores_as, false) as scores
        from play_reach r join acts k2 on k2.id = r.play left join card_kinds ck on ck.key = k2.payload ->> 'card'
        where r.ends_at > now() and (r.character = f.by_character or r.thread = f.by_thread or r.board = f.by_board) offset 0) l;
  f.reach_up := case f.reach when 'character' then in_character when 'thread' then in_thread else in_board end;
  -- 4b. Whether a live ward Gimmick on the Act turns the card away: place_cast turns a cast away by the same test (ward_refusal), and a Move does not land through it either.
  f.warded := ward_refusal('post', by_act, k) is not null;
  -- 4c. What the card's landing refuses on the Act (land_refusal): the same reads, from public facts, for every back whatever it holds. A Move that is refused here does not land and its back stays set.
  f.land_why := land_refusal(k, by_act, fd.config);
  -- 4d. Whether the Act has room for the card's effect: a card that draws takes a slot there, as place_cast asks of any play (post_room_words). A card that draws nothing always has room. The Act's room is read
  -- for every back whatever it holds, first and on its own, so that whether the probe runs (and how long the read takes) never turns on whether the hidden card draws; only the answer does, as the design accepts.
  f.room := post_room_words(by_act) is null;
  f.room := f.room or not coalesce(k.draws_effect, false);
  -- 5. A board's live card, whatever the card's reach.
  select max(r.ends_at) into f.live_board from play_reach r where r.board = f.by_board and r.ends_at > now() and not card_ended(r.play);
  -- 6. The named catch (a back with none reads its own card's row, so the read finds one row either way: a null key would be a read of nothing), compared with the incoming card.
  select x.key into named from card_kinds x where x.key = coalesce(fd.catches, fd.card);
  -- 6b. The back's match, and the incoming card's printed row, for every back whatever it holds (a back with no match reads the same row and asks the same questions of an empty one): the card's
  -- flavor in the match's `flavors`, its rarity at or below the match's `upTo` and at or below the back's own card's. A cast back springs on the card it names or on one its match holds.
  select * into ic from card_kinds x where x.key = incoming_card;
  m := case when jsonb_typeof(k.trap -> 'match') = 'object' then k.trap -> 'match' else '{}'::jsonb end;
  ic_rank := rarity_rank(ic.rarity); up_rank := rarity_rank(coalesce(m ->> 'upTo', 'legendary')); own_rank := rarity_rank(k.rarity);
  flavor_ok := case when jsonb_typeof(m -> 'flavors') = 'array' then (m -> 'flavors') ? ic.alignment else true end;
  matched := jsonb_typeof(k.trap -> 'match') = 'object' and ic.key is not null and flavor_ok and ic_rank <= up_rank and ic_rank <= own_rank;
  f.caught := (fd.catches is not null and fd.catches = incoming_card and named is not null) or coalesce(matched, false);
  -- 7. ONE walk of the Act's words for every back: its own visible words, and the excerpt of the quotes of the back's post (null for a cast or a visit, whose by_act holds no words). A function in a FROM
  -- clause runs once however many columns are taken from it, and both are taken here, so the walk costs the same whatever the back holds.
  select w.plain, w.excerpt, w.unquoted into walked_plain, walked_excerpt, f.by_body from bbcode_walk(raw_body, fd.post, raw_forged) w;
  -- A quote of a post an admin hid carries its words, so the Quotes condition does not read them (the Act's own words, with every quote cut out, are all `by_body` and Says read).
  if coalesce(quote_hidden(fd.post), false) then walked_excerpt := ''; end if;
  if raw_body is null then f.by_body := null; end if;
  -- 8. Both probes, for every back, whatever it holds: phrase_probe folds the text and compiles and runs a pattern of one shape (a back with no such condition has a pattern built around its own id, which
  -- cannot match), the Says over the Act's own words and the Quotes, on a token of its own, over the excerpt. And the Who check, against an empty list for Anyone.
  f.phrase_hit := coalesce(phrase_probe(walked_plain, fd.phrase, fd.play::text), false);
  f.passage_hit := coalesce(phrase_probe(walked_excerpt, fd.passage, fd.play::text || 'p'), false);
  f.who_hit := coalesce(f.by_character = any (coalesce(fd.who, '{}')), false);
  return f;
end $function$;

create or replace function spring_traps(trigger text, post uuid, by_act uuid, incoming_card text default null, held uuid[] default null, actor uuid default null, passing text default null, locking uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fd face_down%rowtype;
  f spring_facts;
  back_trigger text;
  springs boolean;
  lands boolean;
  did text;
  sprung uuid;
  laid uuid;
  flag text;
  held_when jsonb;
  back_rarity text;
begin
  -- A post under a live rewind springs no back, on any trigger (a cast, a quote, a staff persona's quote, a visit, a reply, a reaction): the post is shown as it was, and nothing may happen to it that its readers could not see on it. The back stays
  -- set, untouched, and springs when the rewind ends and a trigger meets it, as a back does that no trigger met. Asked before the back is locked, so a rewound post never waits on one.
  if exists (select 1 from live_rewind(spring_traps.post)) then return null; end if;
  select x.* into fd from face_down x
  where x.post = spring_traps.post and x.ends_at > now() and (held is null or x.play = any (held))
    and not exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = x.play::text)
  order by x.round desc limit 1 for update;
  if fd.play is null then return null; end if;
  -- After the lock, so a spring that landed while this waited is seen.
  if exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text) then return null; end if;
  if exists (select 1 from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = fd.play::text) then return null; end if;
  -- The same reads for every back, before anything is decided.
  f := spring_facts(fd, trigger, by_act, incoming_card);
  -- The decision, from the locals. A Move springs on a quote that meets every condition its back holds; a Gimmick on its own trigger, or never (a Bluff).
  back_trigger := case f.kind_play when 'cast' then 'quote' else f.kind_trap #>> '{trigger,on}' end;
  springs := back_trigger is not distinct from trigger
    and case trigger when 'quote' then (fd.phrase is null or f.phrase_hit) and (fd.passage is null or f.passage_hit) and (fd.who is null or f.who_hit <> fd.who_except)
                     when 'cast' then f.caught when 'visit' then true else false end;
  -- A Move lands on what quoted it, at its first reach, if it can: its stack there has room, a board has no live card, the thread has its first post and a board card the board it lands on, which holds the thread that met it.
  -- A skim card's stack is one live play per quadrant (its quadrant is a quadrant and free); a scored-as card lands only when its class is one, its window can be named and has no other.
  lands := coalesce(f.by_kind = 'post' and case f.reach
      when 'post' then case when f.kind_skim then f.quadrant_ok and f.quadrant_up = 0 else f.up < f.kind_stack end and not f.warded and f.land_why is null and f.room
      when 'character' then f.by_character is not null and f.reach_up < f.kind_stack and (not f.kind_scores or (f.class_ok and f.window_why is null and not f.class_taken))
      when 'thread' then f.first_post is not null and f.reach_up < f.kind_stack
      else f.by_board is not null and f.live_board is null and f.reach_up < f.kind_stack end, false);
  if not springs then return null; end if;
  -- A staff cast has no hand to hand a card back to, so a refund back passes over it and stays set; the caster's staff flag is public.
  if back_trigger = 'cast' and f.kind_trap #>> '{outcome,kind}' = 'refund' and actor is null then return null; end if;
  -- A setter's character that can no longer act (retired, until an admin restores it) springs nothing: its back stays set until its time, and the write that met it lands as if no
  -- back were there (acts_well_formed would refuse the spring, and with it the write). A Move that cannot land leaves its back set for the next quote.
  if f.setter_retired is not null or f.setter_debuted is null then return null; end if;
  if back_trigger = 'quote' and not lands then return null; end if;
  did := case back_trigger when 'quote' then 'landed' when 'cast' then case f.kind_trap #>> '{outcome,kind}' when 'ride' then 'rode' when 'refund' then 'returned' when 'lockout' then 'lockedOut' else 'caught' end else 'ended' end;
  -- A pierce gets the cast past a catch no rarer than it: the back stays set and unsprung, and nothing is written or told (Cheap Shot's design, section 3.3). A ride or a refund springs as before.
  if trigger = 'cast' and did = 'caught' and passing is not null then
    select k.rarity into back_rarity from card_kinds k where k.key = fd.card;
    if rarity_rank(back_rarity) <= rarity_rank(passing) then return '{"passed": true}'::jsonb; end if;
  end if;
  -- What the quote met, to be shown: the Says phrase and the passage the back held (the setter chose them to be matched, and the spring says so), and the quoter only where the Who was Only these.
  -- An Anyone but list, and with it who it spared, is never written.
  held_when := case when trigger = 'quote' then jsonb_strip_nulls(jsonb_build_object('says', fd.phrase, 'passage', fd.passage)) end;
  if held_when = '{}'::jsonb then held_when := null; end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if f.setter_staff then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (f.setter_character, 'spring', fd.thread, fd.post, jsonb_strip_nulls(jsonb_build_object(
    'card', fd.card, 'trigger', trigger, 'did', did, 'set', fd.play::text, 'by', by_act::text,
    'caught', case when trigger = 'cast' and did = 'caught' then by_act::text end,
    'drawn', case when back_trigger = 'quote' then surface_draft_fits(fd.play) end,
    'quadrant', case when did = 'rode' then fd.config ->> 'quadrant' end,
    -- A lockout locks the character that played the Move out of the back's thread until `until`, fixed now as a ban's is. `locking` is that character: the Move's Act is not written yet when it springs.
    'locks', case when did = 'lockedOut' then coalesce(locking, f.by_character)::text end,
    'until', case when did = 'lockedOut' then now() + make_interval(hours => (f.kind_trap #>> '{outcome,hours}')::int) end,
    'when', held_when,
    -- `for` is the quoter where the Who was Only these: a clue the setter chose, public as the quote's author. A landed author veil hides that author, so its spring never names the quoter (the screens read the quote's
    -- own character, which is the stand-in while the veil is up, and `for` only where the quote could not be read).
    'for', case when trigger = 'quote' and fd.who is not null and not fd.who_except and f.kind_veil is distinct from 'author' then f.by_character::text end))) returning id into sprung;
  if f.setter_staff then perform set_config('kayfabb.staff_writer', flag, true); end if;
  perform write_alert(f.setter_character, 'trapSprang', null, sprung, coalesce(actor, auth.uid()));
  if back_trigger = 'quote' then
    laid := lay_sprung(f.setter_character, fd.card, fd.config, f.target, f.reach, sprung, by_act);
    perform write_alert(f.by_character, 'trapStruck', null, laid, f.setter_owner);
    -- The landed card goes out with the spring, so it reaches readers live as the spring does.
    return act_projection(sprung) || jsonb_build_object('struck', act_projection(laid));
  elsif back_trigger = 'cast' and fd.account is not null and did = 'caught' then
    -- The caught card is the setter's: one more row in their own ledger, beside the caster's `played` row. A staff setter has no hand and takes nothing.
    insert into card_ledger (account, card, kind, act, price) values (fd.account, incoming_card, 'caught', sprung, 0);
  end if;
  return act_projection(sprung);
end $$;

CREATE OR REPLACE FUNCTION public.lay_sprung(setter uuid, card text, config jsonb, target uuid, reach text, spring uuid, from_post uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  kind_of card_kinds%rowtype;
  staff_setter boolean;
  in_thread uuid;
  on_post uuid;
  layer integer;
  ends timestamptz;
  target_name text;
  written uuid := gen_random_uuid();
  flag text;
  w_opens timestamptz;
  w_closes timestamptz;
  draft face_down_draws%rowtype;
  set_thread uuid;
begin
  select * into kind_of from card_kinds k where k.key = lay_sprung.card;
  select c.staff is not null into staff_setter from characters c where c.id = setter;
  if reach = 'post' then
    select a.thread into in_thread from acts a where a.id = target;
    on_post := target;
    select greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1 into layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught') and coalesce(k.payload ->> 'reach', 'post') = 'post';
  elsif reach = 'character' then
    select c.name into target_name from characters c where c.id = target;
    select a.thread into in_thread from acts a where a.id = from_post;
    on_post := from_post;
  elsif reach = 'thread' then
    select t.title into target_name from threads t where t.id = target;
    in_thread := target;
    select a.id into on_post from acts a where a.thread = target and a.seq = 1;
  else
    select b.name into target_name from boards_now b where b.id = target;
    -- The thread its set was laid in, when that thread is on the target board; else the board's most recently active thread (thread_list's order). A board with no thread takes none; spring_traps asks for one that has the
    -- quoted post's thread, so a spring never meets this refusal.
    select s.thread into set_thread from acts s where s.id = (select (sp.payload ->> 'set')::uuid from acts sp where sp.id = lay_sprung.spring);
    if set_thread is not null then
      select t.id into in_thread from threads t where t.id = set_thread and t.board = target;
    end if;
    if in_thread is null then
      select t.id into in_thread from threads t where t.board = target order by t.last_at desc limit 1;
    end if;
    if in_thread is null then
      raise exception 'start a thread on % first', target_name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    on_post := null;
  end if;
  if reach <> 'post' then
    ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
    if kind_of.scores_as then
      select w.opens, w.closes into w_opens, w_closes from scored_as_window(now()) w;
      ends := w_closes;
    end if;
  elsif kind_of.lasts is not null then
    -- A card with a time up lands on a post with its `ends`, as place_cast writes it (a skim, a veil).
    ends := now() + kind_of.lasts;
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if staff_setter then perform set_config('kayfabb.staff_writer', 'on', true); end if;
  insert into acts (id, character, kind, thread, target_act_id, payload)
  values (written, setter, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', '',
    'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end, 'spring', spring::text)
    || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'ends', ends, 'targetName', target_name) else jsonb_build_object('layer', layer) end
    || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) when reach = 'post' and kind_of.lasts is not null then jsonb_build_object('ends', ends) else '{}'::jsonb end
    || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end);
  if staff_setter then perform set_config('kayfabb.staff_writer', flag, true); end if;
  -- The card carries its setter, and its payload names the spring, which targets the post the back was set on: while an author veil is live on that post, the card is shown under the stand-in as the spring is (post_veil_cards,
  -- read by acts_public and the counts), and the true name returns with the veil. Written here, in the transaction of the card it describes, from the live veils of the spring's post.
  insert into post_veil_cards (card, post, author)
  select distinct written, v.post, v.author
  from acts s join post_veils_live v on v.veil = 'author' and v.post = s.target_act_id and v.author = lay_sprung.setter
  where s.id = lay_sprung.spring
  on conflict on constraint post_veil_cards_pkey do nothing;
  -- What a landed play on a post needs beside its Act (a veil's row): the same writer place_cast calls.
  if reach = 'post' then perform land_rows(written, kind_of, target, coalesce(config, '{}'), setter); end if;
  if kind_of.surface and reach = 'post' then
    select d.* into draft from face_down_draws d where d.play = (select (s.payload ->> 'set')::uuid from acts s where s.id = lay_sprung.spring);
    perform open_surface(written, coalesce(draft.most_live, 48));
    if draft.play is not null then
      if bit_count(draft.cells) <= draft.most then perform surface_apply(written, setter, 'draw', draft.payload, draft.cells, draft.most); end if;
      delete from face_down_draws d where d.play = draft.play;
    end if;
  end if;
  if reach <> 'post' then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  return written;
end $function$;

-- ---- 3. thread_page ----
-- board_card_ids: the ids of the board cards written in a thread, from the page's first Act up to the next page's first (page 1 from its start; no next Act, to the end), oldest first, at most 100. Ids and nothing else:
-- the page reads each as acts_public shows it, so a hidden one is not shown. It runs as its owner because the caller reads no column of `acts`.
create function board_card_ids(in_thread uuid, in_page integer, in_first integer, in_end integer) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x.id
  from acts x
  where x.thread = in_thread and x.kind = 'card' and x.payload ->> 'reach' = 'board' and not (x.payload ? 'caught')
    and (in_page = 1 or x.created_at >= (select f.created_at from acts f where f.thread = in_thread and f.seq = in_first))
    and x.created_at < coalesce((select n.created_at from acts n where n.thread = in_thread and n.seq = in_end + 1), 'infinity'::timestamptz)
  order by x.created_at, x.id
  limit 100
$$;
revoke execute on function board_card_ids(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function board_card_ids(uuid, integer, integer, integer) to authenticated, service_role;

-- thread_page (0413_rewind) with the board cards joined to `on_all`, left out of `plays` and `ends_on_posts`, and returned as `boardCards`. Its grants are as they were (replaced in place).
CREATE OR REPLACE FUNCTION public.thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) IS NULL) OR ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) < 1) OR (COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) > 100))) THEN screen_refusal('a page holds 1 to 100 posts'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH pp AS MATERIALIZED (
          SELECT COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1)) AS n
         ), s AS MATERIALIZED (
          SELECT o.id,
             o.board,
             o.title,
             o.origin_act_id,
             o.created_at,
             o.last_at,
             o.last_seq,
             o.replies,
             o.first_act,
             o.first_character,
             o.last_act,
             o.last_character,
             o.replies_this_week,
             o.origin_thread,
             o.origin_place,
             (GREATEST((1)::numeric, ceil(((o.last_seq)::numeric / (( SELECT pp.n
                    FROM pp))::numeric))))::integer AS last_page
            FROM thread_open o
           WHERE (o.id = thread_page.in_thread)
         ), pg AS MATERIALIZED (
          SELECT s.id,
             s.board,
             s.title,
             s.origin_act_id,
             s.created_at,
             s.last_at,
             s.last_seq,
             s.replies,
             s.first_act,
             s.first_character,
             s.last_act,
             s.last_character,
             s.replies_this_week,
             s.origin_thread,
             s.origin_place,
             s.last_page,
             LEAST(s.last_page, GREATEST(1, COALESCE(
                 CASE
                     WHEN (thread_page.in_seq IS NOT NULL) THEN (GREATEST((1)::numeric, ceil(((thread_page.in_seq)::numeric / (( SELECT pp.n
                        FROM pp))::numeric))))::integer
                     ELSE NULL::integer
                 END, thread_page.in_page, 1))) AS page
            FROM s
         ), rng AS MATERIALIZED (
          SELECT pg.id,
             pg.board,
             pg.title,
             pg.origin_act_id,
             pg.created_at,
             pg.last_at,
             pg.last_seq,
             pg.replies,
             pg.first_act,
             pg.first_character,
             pg.last_act,
             pg.last_character,
             pg.replies_this_week,
             pg.origin_thread,
             pg.origin_place,
             pg.last_page,
             pg.page,
             (((pg.page - 1) * ( SELECT pp.n
                    FROM pp)) + 1) AS first_seq,
             (pg.page * ( SELECT pp.n
                    FROM pp)) AS end_seq
            FROM pg
         ), range_acts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a,
             rng
           WHERE ((a.thread = rng.id) AND ((a.seq >= rng.first_seq) AND (a.seq <= rng.end_seq)) AND (a.kind <> ALL (ARRAY['edit'::text, 'card'::text])))
         ), drawn AS MATERIALIZED (
          SELECT r.id,
             r.seq,
             r.kind,
             u.play,
             u.parent
            FROM (range_acts r
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.parent
                    FROM post_under x
                   WHERE (x.reply = r.id)) u)
           WHERE (NOT card_ended(u.play))
         ), page_acts AS MATERIALIZED (
          SELECT r.id,
             r."character",
             r.kind,
             r.thread,
             r.target_act_id,
             r.seq,
             r.created_at,
             r.payload,
             r.current_payload,
             r.edited_at,
             r.shown_edited_at,
             r.untaken,
             r.ends_at,
             r.hidden,
             r.any_hidden,
             r.concealing,
             r.payload_hidden,
             r.payload_concealing
            FROM range_acts r
           WHERE (NOT (EXISTS ( SELECT 1
                    FROM drawn d
                   WHERE (d.id = r.id))))
         ), page_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.created_at
            FROM page_acts a
           WHERE post_kind(a.kind)
         ), nested AS MATERIALIZED (
          SELECT u.play,
             p.id AS parent,
             a.id,
             a."character",
             a.created_at,
             to_jsonb(a.*) AS act
            FROM ((page_posts p
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.reply
                    FROM post_under x
                   WHERE ((x.parent = p.id) AND (NOT card_ended(x.play)))) u)
              JOIN acts_public a ON ((a.id = u.reply)))
         ), posts AS MATERIALIZED (
          SELECT p.id,
             p."character",
             p.created_at
            FROM page_posts p
         UNION ALL
          SELECT n.id,
             n."character",
             n.created_at
            FROM nested n
         ), on_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM post_play_ids(ARRAY( SELECT p.id
                    FROM posts p)) x
         ), on_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM on_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM on_ids i)) r(r)
         UNION ALL
          -- The board cards written in this thread, which sit on no post (target_act_id is null): from this page's first Act up to the next page's first (page 1 from the start, the last page to the end), at most 100.
          -- Read as the page reads every play, through acts_public, by id, in on_posts below; the page's `plays` leave them out and `boardCards` is made of them.
          SELECT b.b AS id
            FROM rng,
             board_card_ids(rng.id, rng.page, rng.first_seq, rng.end_seq) b(b)
         ), on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM on_all o)))
         ), ends_on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE ((a.kind = 'card_end'::text) AND (a.target_act_id IN ( SELECT o.id
                    FROM on_posts o
                   WHERE (o.target_act_id IS NOT NULL))))
         ), above AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM effects_above(ARRAY( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)), ( SELECT rng.id
                    FROM rng), ( SELECT rng.board
                    FROM rng)) x(play, reach, target, ends_at, act)
         ), kept_span AS MATERIALIZED (
          SELECT min(p.created_at) AS lo,
             max(p.created_at) AS hi
            FROM posts p
         ), kept_reach AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             COALESCE(x."character", x.thread, x.board) AS target,
             x.ends_at
            FROM play_reach x,
             kept_span s
           WHERE ((s.lo IS NOT NULL) AND (x.thread = ( SELECT rng.id
                    FROM rng)) AND (tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (x.ends_at <= now()))
         UNION ALL
          SELECT x.play,
             x.reach,
             x."character" AS target,
             x.ends_at
            FROM ((( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)) au
              CROSS JOIN kept_span s)
              CROSS JOIN LATERAL ( SELECT r.play,
                     r.reach,
                     r."character",
                     r.ends_at
                    FROM play_reach r
                   WHERE ((r."character" = au."character") AND (tstzrange(r.started_at, r.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (r.ends_at <= now()))) x)
         ), kept_window AS MATERIALIZED (
          SELECT r.play,
             r.reach,
             r.target,
             r.ends_at,
             a.created_at AS started,
             to_jsonb(a.*) AS act,
             (a.payload ->> 'card'::text) AS card
            FROM (kept_reach r
              JOIN acts_public a ON ((a.id = r.play))),
             kept_span s
           WHERE ((a.created_at <= s.hi) AND (EXISTS ( SELECT 1
                    FROM posts p
                   WHERE ((a.created_at <= p.created_at) AND (p.created_at < r.ends_at) AND ((r.reach <> 'character'::text) OR (p."character" = r.target))))))
         ), kept AS MATERIALIZED (
          SELECT w.play,
             w.reach,
             w.target,
             w.ends_at,
             w.act
            FROM (kept_window w
              JOIN card_kinds ck ON (((ck.key = w.card) AND ck.keeps)))
           WHERE (NOT card_ended(w.play))
           ORDER BY w.started, w.play
          LIMIT 100
         ), played AS MATERIALIZED (
          SELECT o.id,
             o.kind,
             o."character",
             (o.payload ->> 'card'::text) AS card
            FROM on_posts o
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM above x
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM kept x
         ), vis AS MATERIALIZED (
          SELECT DISTINCT ON (v.target_act_id) v.id,
             v.target_act_id AS post,
             v."character",
             v.created_at,
             v.payload
            FROM acts_public v
           WHERE ((v.kind = 'visit'::text) AND (v.target_act_id IN ( SELECT a.id
                    FROM page_acts a
                   WHERE (a.kind = ANY (ARRAY['post'::text, 'spin'::text]))
                 UNION ALL
                  SELECT n.id
                    FROM nested n)))
           ORDER BY v.target_act_id, v.created_at DESC, v.id DESC
         ), o_on AS MATERIALIZED (
          SELECT r.origin_act_id AS id
            FROM rng r
           WHERE ((r.origin_act_id IS NOT NULL) AND (EXISTS ( SELECT 1
                    FROM page_acts a
                   WHERE (a.id = r.first_act))))
         ), o_act AS MATERIALIZED (
          SELECT a.*
            FROM (o_on o
              JOIN acts_public a ON ((a.id = o.id)))
         ), o_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM (o_on o
              CROSS JOIN LATERAL post_play_ids(ARRAY[o.id]) x)
         ), o_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM o_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM o_ids i)) r(r)
         ), o_plays AS MATERIALIZED (
          SELECT a.*
            FROM acts_public a
           WHERE (EXISTS ( SELECT 1
                    FROM o_ids x)) AND (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM o_all o)))
         ), o_shown AS MATERIALIZED (
          SELECT s.*
            FROM o_plays s
         ), o_ends AS MATERIALIZED (
          SELECT e.*
            FROM acts_public e
           WHERE ((e.kind = 'card_end'::text) AND (e.target_act_id IN ( SELECT s.id
                    FROM o_shown s)))
         ), o_cast AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM o_act a
                 UNION
                  SELECT s."character"
                    FROM o_shown s
                 UNION
                  SELECT
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND ((a.payload ->> 'reach'::text) = 'character'::text)) THEN ((a.payload ->> 'character'::text))::uuid
                             ELSE NULL::uuid
                         END AS "character"
                    FROM o_act a) w
           WHERE (w.c IS NOT NULL)
         ), o_post AS MATERIALIZED (
          SELECT x.id
            FROM ( SELECT
                         CASE
                             WHEN post_kind(a.kind) THEN a.id
                             WHEN (a.kind = 'poll'::text) THEN a.target_act_id
                             WHEN (a.kind = 'ballot'::text) THEN ( SELECT q.target_act_id
                                FROM acts_public q
                               WHERE (q.id = a.target_act_id))
                             ELSE NULL::uuid
                         END AS id
                    FROM o_act a) x
           WHERE (x.id IS NOT NULL)
         ), pl_post AS MATERIALIZED (
          SELECT p.id
            FROM posts p
         UNION
          SELECT o.id
            FROM o_post o
         ), pl_cur AS MATERIALIZED (
          SELECT x.id AS post,
             l.id AS poll,
             l.created_at,
             ((l.payload ->> 'secret'::text))::boolean AS secret,
             to_jsonb(l.*) AS act
            FROM (pl_post x
              CROSS JOIN LATERAL ( SELECT a.*
                    FROM acts_public a
                   WHERE ((a.kind = 'poll'::text) AND (a.target_act_id = x.id))
                   ORDER BY a.created_at DESC, a.id DESC
                  LIMIT 1) l)
           WHERE (NOT (l.payload ? 'removed'::text))
         ), pl_polls AS MATERIALIZED (
          SELECT c.post,
             c.poll,
             c.created_at,
             c.secret,
             c.act,
             k.counts,
             k.voters,
             k.ends_at,
             k.closed,
             cl.j AS close,
             EXISTS (SELECT 1 FROM acts b WHERE b.kind = 'ballot'::text AND b.target_act_id = c.poll) AS balloted
            FROM ((pl_cur c
              CROSS JOIN LATERAL ( SELECT n.counts,
                     n.voters,
                     n.ends_at,
                     n.closed
                    FROM poll_counts n
                   WHERE (n.poll = c.poll)) k)
              LEFT JOIN LATERAL ( SELECT to_jsonb(e.*) AS j
                    FROM acts_public e
                   WHERE ((e.kind = 'poll_close'::text) AND (e.target_act_id = c.poll))
                  LIMIT 1) cl ON (true))
         ), pl_voters AS MATERIALIZED (
          SELECT p.post,
             p.poll,
             b.id AS act,
             b."character",
             (b.payload -> 'picks'::text) AS picks,
             b.created_at
            FROM ((pl_polls p
              CROSS JOIN LATERAL poll_voter_acts(p.poll, p.ends_at, 50) v(act))
              CROSS JOIN LATERAL ( SELECT x.id,
                     x."character",
                     x.payload,
                     x.created_at
                    FROM acts_public x
                   WHERE (x.id = v.act)) b)
           WHERE (NOT p.secret)
         ), pl_cast AS MATERIALIZED (
          SELECT DISTINCT v."character" AS c
            FROM pl_voters v
           WHERE (v."character" IS NOT NULL)
         ), pl_mine AS MATERIALIZED (
          SELECT m.act,
             m.poll,
             p.post,
             m."character",
             m.picks,
             m.created_at
            FROM (my_latest_ballots m
              JOIN pl_polls p ON ((p.poll = m.poll)))
           WHERE (m.created_at < p.ends_at)
         UNION ALL
          SELECT b.act,
             l.poll,
             p.post,
             l."character",
             b.picks,
             b.created_at
            FROM ((my_latest_ballots l
              JOIN pl_polls p ON ((p.poll = l.poll)))
              CROSS JOIN LATERAL ( SELECT m.act,
                     m.picks,
                     m.created_at
                    FROM my_ballots m
                   WHERE ((m.poll = l.poll) AND (m."character" = l."character") AND (m.created_at < p.ends_at))
                   ORDER BY m.created_at DESC, m.act DESC
                  LIMIT 1) b)
           WHERE (l.created_at >= p.ends_at)
         ), ids AS MATERIALIZED (
          SELECT a.id
            FROM page_acts a
         UNION
          SELECT n.id
            FROM nested n
         UNION
          SELECT p.id
            FROM played p
         UNION
          SELECT a.id
            FROM o_act a
         UNION
          SELECT s.id
            FROM o_shown s
         UNION
          SELECT p.poll
            FROM pl_polls p
         ), who AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM page_acts a
                 UNION
                  SELECT n."character"
                    FROM nested n
                 UNION
                  SELECT p."character"
                    FROM played p
                 UNION
                  SELECT v."character"
                    FROM vis v) w
           WHERE (w.c IS NOT NULL)
         ), wanted_plays AS MATERIALIZED (
          SELECT p.id
            FROM played p
           WHERE (p.card = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         UNION
          SELECT s.id
            FROM o_shown s
           WHERE ((s.payload ->> 'card'::text) = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         ), heads AS MATERIALIZED (
          SELECT c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'locked_until', locked_out_until(c.id, thread_page.in_thread), 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                    FROM character_profiles p
                   WHERE (p."character" = c.id))) AS head
            FROM (( SELECT w.c
                    FROM who w
                 UNION
                  SELECT o.c
                    FROM o_cast o
                 UNION
                  SELECT v.c
                    FROM pl_cast v) k(id)
              CROSS JOIN LATERAL ( SELECT x.*
                    FROM characters_public x
                   WHERE (x.id = k.id)
                  OFFSET 0) c)
         ), spun AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place,
             l.n
            FROM ( SELECT t.id,
                     t.board,
                     t.title,
                     t.origin_act_id,
                     t.created_at,
                     t.last_at,
                     t.last_seq,
                     t.replies,
                     t.first_act,
                     t.first_character,
                     t.last_act,
                     t.last_character,
                     t.replies_this_week,
                     t.origin_thread,
                     t.origin_place,
                     row_number() OVER (PARTITION BY t.origin_act_id ORDER BY t.created_at, t.id) AS n
                    FROM thread_list t
                   WHERE (t.origin_act_id IN ( SELECT i.id
                            FROM ids i))) l
           WHERE (l.n <= 200)
         ), rw AS MATERIALIZED (
          -- The live rewind plays of the page's posts (and the replies drawn under them) and of the ORIGIN post, from one set-based read (post_rewind_plays), as `on_ids` reads post_play_ids.
          SELECT r.post,
             r.play,
             r.played_at,
             rewind_view(r.play) AS view
            FROM post_rewind_plays(ARRAY( SELECT x.id
                    FROM ( SELECT p.id
                            FROM posts p
                         UNION
                          SELECT o.id
                            FROM o_on o) x)) r
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM rng))) THEN NULL::jsonb
             ELSE jsonb_build_object('summary', ( SELECT (to_jsonb(s.*) - 'last_page'::text)
                FROM s), 'page', ( SELECT rng.page
                FROM rng), 'boardCards', ( SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM on_posts o
               WHERE (o.target_act_id IS NULL)), 'acts', ( SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.seq), '[]'::jsonb) AS "coalesce"
                FROM page_acts a), 'people', ( SELECT COALESCE(jsonb_agg((c.head || jsonb_build_object('posts', COALESCE(( SELECT n.posts
                        FROM character_post_counts n
                       WHERE (n."character" = c.id)), 0), 'standing', COALESCE(( SELECT st.standing
                        FROM current_standings st
                       WHERE (st."character" = c.id)), 0), 'reveals', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'character', r."character", 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread) ORDER BY r.at, r.act), '[]'::jsonb) AS "coalesce"
                        FROM class_reveals r
                       WHERE (r."character" = c.id)), 'turns', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', u.act, 'character', u."character", 'at', u.at, 'was', u.was) ORDER BY u.at, u.act), '[]'::jsonb) AS "coalesce"
                        FROM turns_announced u
                       WHERE (u."character" = c.id)))) ORDER BY c.id), '[]'::jsonb) AS "coalesce"
                FROM heads c
               WHERE (c.id IN ( SELECT w.c
                        FROM who w))), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                FROM ( SELECT to_jsonb(o.*) AS j,
                         o.created_at,
                         o.id
                        FROM on_posts o
                       WHERE (o.target_act_id IS NOT NULL)
                     UNION ALL
                      SELECT to_jsonb(e.*) AS to_jsonb,
                         e.created_at,
                         e.id
                        FROM ends_on_posts e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                FROM post_kind_counts(ARRAY( SELECT p.id
                        FROM posts p)) k), 'above', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM above x), 'kept', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM kept x), 'under', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) ORDER BY ((n.act ->> 'seq'::text))::integer, n.id), '[]'::jsonb) AS "coalesce"
                FROM nested n), 'cut', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', ( SELECT pa.seq
                        FROM acts_public pa
                       WHERE (pa.id = d.parent))) ORDER BY d.seq), '[]'::jsonb) AS "coalesce"
                FROM drawn d
               WHERE (d.kind = 'post'::text)), 'visits', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('visit', v.id, 'post', v.post, 'mod', v."character", 'at', v.created_at, 'ends_at', (v.payload -> 'ends_at'::text), 'line', (v.payload -> 'line'::text), 'charges', ((v.payload -> 'charges'::text) || COALESCE(( SELECT jsonb_agg((j.payload -> 'charge'::text) ORDER BY j.created_at, j.id) AS jsonb_agg
                        FROM acts_public j
                       WHERE ((j.kind = 'visit_join'::text) AND (j.target_act_id = v.id))), '[]'::jsonb)), 'challenge', (jsonb_strip_nulls(jsonb_build_object('kind', (v.payload #>> '{challenge,kind}'::text[]), 'question_index', (v.payload #> '{challenge,question_index}'::text[]), 'price', (v.payload #> '{challenge,price}'::text[]))) || COALESCE(visit_quiz(v.id), '{}'::jsonb)), 'end', ( SELECT jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', (e.payload ->> 'outcome'::text), 'by_act', (e.payload -> 'by_act'::text), 'line', (e.payload -> 'line'::text)) AS jsonb_build_object
                        FROM acts_public e
                       WHERE ((e.kind = 'visit_end'::text) AND (e.target_act_id = v.id))
                      LIMIT 1), 'ruling', ( SELECT (r.payload ->> 'verdict'::text)
                        FROM ((acts_public i
                          JOIN acts_public ap ON (((ap.kind = 'appeal'::text) AND (ap.target_act_id = i.id))))
                          JOIN acts_public r ON (((r.kind = 'appeal_ruling'::text) AND (r.target_act_id = ap.id))))
                       WHERE ((i.kind = 'infraction'::text) AND ((i.payload ->> 'visit_act'::text) = (v.id)::text))
                      LIMIT 1)) ORDER BY v.created_at, v.id), '[]'::jsonb) AS "coalesce"
                FROM vis v), 'faces', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb) AS "coalesce"
                FROM my_face_down f
               WHERE (f.play IN ( SELECT p.id
                        FROM played p
                       WHERE (p.kind = 'set'::text)))), 'veiled', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', v.post, 'character', v."character", 'play', v.play, 'ends_at', v.ends_at) ORDER BY v.post), '[]'::jsonb) AS "coalesce"
                FROM my_veiled_posts v
               WHERE (v.post IN ( SELECT p.id
                        FROM posts p))), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb) AS "coalesce"
                FROM effect_state e
               WHERE (e.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'releases', ( SELECT COALESCE(jsonb_agg(r.play), '[]'::jsonb) AS "coalesce"
                FROM effect_releases r
               WHERE (r.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'spent', ( SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM (on_posts o
                  JOIN card_kinds ck ON (((ck.key = (o.payload ->> 'card'::text)) AND ((ck.discipline ->> 'kind'::text) = 'fall'::text))))
               WHERE ((o.kind = 'card'::text) AND fall_spent(o.id))), 'surfaces', ( SELECT COALESCE(jsonb_object_agg((sf.play)::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb) AS "coalesce"
                FROM surfaces sf
               WHERE (sf.play IN ( SELECT o.id
                        FROM on_posts o
                       WHERE (o.kind = 'card'::text)))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
                FROM reaction_tallies t
               WHERE (t.act IN ( SELECT i.id
                        FROM ids i))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")), '[]'::jsonb) AS "coalesce"
                FROM my_reactions m
               WHERE (m.act IN ( SELECT i.id
                        FROM ids i))), 'polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                FROM pl_voters v), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p
               WHERE ((NOT p.secret) AND (p.voters > 50))), 'voterCast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                FROM heads h
               WHERE (h.id IN ( SELECT v.c
                        FROM pl_cast v))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                FROM pl_mine m), 'spun', ( SELECT COALESCE(jsonb_agg((to_jsonb(l.*) - 'n'::text) ORDER BY l.created_at, l.id), '[]'::jsonb) AS "coalesce"
                FROM spun l), 'reading', ( SELECT r.furthest_seq
                FROM reading r
               WHERE (r.thread = thread_page.in_thread)
              LIMIT 1), 'board', ( SELECT jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act) AS jsonb_build_object
                FROM boards_now b
               WHERE (b.id = ( SELECT rng.board
                        FROM rng))), 'following', following_thread(in_thread), 'presence', presence_box('thread'::text, in_thread), 'unread', my_alerts_unread(), 'rewinds', ( SELECT COALESCE(jsonb_agg(w.view ORDER BY w.played_at DESC, w.play DESC), '[]'::jsonb) AS "coalesce"
                FROM rw w
               WHERE (w.view IS NOT NULL))) ||
             CASE
                 WHEN (EXISTS ( SELECT 1
                    FROM o_on)) THEN jsonb_build_object('origin', jsonb_build_object('act', ( SELECT to_jsonb(a.*) AS to_jsonb
                        FROM o_act a), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.grp, x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                        FROM ( SELECT to_jsonb(s.*) AS j,
                                 0 AS grp,
                                 s.created_at,
                                 s.id
                                FROM o_shown s
                             UNION ALL
                              SELECT to_jsonb(e.*) AS to_jsonb,
                                 1,
                                 e.created_at,
                                 e.id
                                FROM o_ends e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                        FROM post_kind_counts(ARRAY( SELECT o.id
                                FROM o_on o)) k), 'moment', origin_moment(in_thread), 'at', ( SELECT jsonb_build_object('thread', (z.q ->> 'thread'::text), 'seq', ((z.q ->> 'seq'::text))::integer) AS jsonb_build_object
                        FROM ( SELECT
                                 CASE
                                     WHEN ((r.origin_place ->> 'kind'::text) = 'play'::text) THEN COALESCE(NULLIF((r.origin_place -> 'at'::text), 'null'::jsonb),
                                     CASE
                                         WHEN ((r.origin_place #>> '{on,kind}'::text[]) = 'post'::text) THEN (r.origin_place -> 'on'::text)
                                         ELSE NULLIF((r.origin_place -> 'from'::text), 'null'::jsonb)
                                     END)
                                     WHEN ((r.origin_place ->> 'kind'::text) = ANY (ARRAY['poll'::text, 'ballot'::text])) THEN (r.origin_place -> 'on'::text)
                                     ELSE NULL::jsonb
                                 END AS q
                                FROM rng r) z
                       WHERE (jsonb_typeof(z.q) = 'object'::text)), 'cast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                        FROM heads h
                       WHERE (h.id IN ( SELECT o.c
                                FROM o_cast o
                             UNION
                              SELECT v."character"
                                FROM pl_voters v
                               WHERE ((v.post IN ( SELECT op.id
                                        FROM o_post op)) AND (EXISTS ( SELECT 1
                                        FROM o_act a
                                       WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text]))))))))) ||
                     CASE
                         WHEN (EXISTS ( SELECT 1
                            FROM o_act a
                           WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text])))) THEN jsonb_build_object('polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE (p.post IN ( SELECT op.id
                                    FROM o_post op))), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                            FROM pl_voters v
                           WHERE (v.post IN ( SELECT op.id
                                    FROM o_post op))), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE ((NOT p.secret) AND (p.voters > 50) AND (p.post IN ( SELECT op.id
                                    FROM o_post op)))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                            FROM pl_mine m
                           WHERE (m.post IN ( SELECT op.id
                                    FROM o_post op))))
                         ELSE '{}'::jsonb
                     END)
                 ELSE '{}'::jsonb
             END
         END AS jsonb_build_object
  );
end
$function$;
