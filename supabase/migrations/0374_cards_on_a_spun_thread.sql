-- A spun thread's opening Act is a post for every card (docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 1; design docs/plans/2026-11-16-cards-on-a-spun-thread-design.md, sections 1 to 3).
--
-- What was found (section 1): a spin makes a new thread out of an Act, and the thread's opening Act (seq 1) is a `spin` Act with words of its own. Every card check that asked "is this target a post?"
-- compared its kind with 'post' by hand, so the opening post of a spun thread refused every card: a post card cast on it (place_cast), a post Gimmick used on it (place_cast), a card set face down on it
-- (place_set), a reply-carrying card (play_card), a character card cast from it (place_cast's from_post), a spin pressed at it (spin_written), and every thread card on the spun thread, whose card Act
-- is written pointing at the thread's first Act (the spin), which acts_well_formed then refused in words about a post. A thread Move set face down in a spun thread could be sprung by a quote and never land
-- (spring_facts reads the thread's first post).
--
-- The rule (section 3): the opening post is a post for every card. "Is a post" is one named predicate, post_kind, true for 'post' and for 'spin', and each place that decided it by hand asks it. A `spin` Act is
-- only ever a spun thread's opening Act (spin_written is its only writer, at seq 1 of the thread it creates), so the predicate needs no seq. Nothing here writes a row. The refusals keep their words: "a card
-- lands on a post" is still said of an edit, a card Act or anything else that is no post.
--
--   1. post_kind          the predicate, new.
--   2. acts_well_formed   a card, a set, a spring and a take_back take a post_kind target. The edit test stays as it is: a spin is not edited (design section 10).
--   3. place_cast         the target's kind test and the two reads of from_post.
--   4. place_set          the target's kind test.
--   5. play_card          the version lock and a reply-carrying card's thread read.
--   6. post_under_guard   the count of parent and reply.
--   7. spring_facts       the thread's first post.
--   8. spin_written       the pressed post.
-- Each function is copied whole from its latest body, with only the named lines changed. The reads (thread_page, play_moment, card_target_reach and the views) are Task 2.
--
-- Ways out: no state is added. The opening post is put in states every post can be in, and each names its way out already (a play's time, a take-back, a spring, a wash, an admin's reverse_card).
-- Masks: every refusal compares characters and kinds of Acts, both public, and says the same words to every caller.

-- ---- 1. post_kind ----
--
-- Whether an Act's kind is a post for the purposes of a card: a post, or a spin (a spun thread's opening Act, which has words of its own and is drawn as a post). No client calls it, and a definer's
-- body calls it with its owner's rights, so the API roles keep no right to it (supabase/tests/0005-default-deny.sql holds every function to that). A single expression, so Postgres inlines it.
create function post_kind(kind text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select kind in ('post', 'spin')
$$;
revoke execute on function post_kind(text) from public, anon, authenticated;

-- ---- 2. acts_well_formed ----
--
-- A card, a set, a spring and a take_back each need a post for a target: `not post_kind(t.kind)` where 0317 wrote `t.kind <> 'post'`. The edit test stays: a spin is not edited.
-- Everything else as 0317_surfaces.sql wrote it.
create or replace function public.acts_well_formed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through the game''s own moves' using hint = 'kayfabb.refusal', errcode = '42501';
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
  if new.kind in ('draw', 'wash') and coalesce(current_setting('kayfabb.surface_writer', true), '') <> 'on' then
    raise exception 'a draw or a wash is written only through draw_on_surface and wash_surface' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) and new.kind <> 'wash' then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'announce' then
    if new.payload ->> 'what' is distinct from 'debut' and new.payload ->> 'what' is distinct from 'turn' then
      raise exception 'an announcement is a debut or a Turn' using errcode = '23514';
    end if;
    if new.payload ->> 'what' = 'debut' and new.payload ? 'was' then
      raise exception 'a debut has no class it was' using errcode = '23514';
    end if;
  end if;
  if (new.kind = 'unmask' or (new.kind = 'announce' and new.payload ? 'class'))
     and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an % names the class its character holds', new.kind using errcode = '23514';
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
  if new.kind = 'card' and not post_kind(t.kind) then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (not post_kind(t.kind) or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (not post_kind(t.kind) or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A take-back is of a card set face down on the post it is on, by the one who set it, in the post's thread, while the back is live as of the take-back: not sprung, not taken back before (acts_one_take_back
  -- holds that), and not past its time. The card's own account is read from face_down, never named in the Act.
  if new.kind = 'take_back' and (not post_kind(t.kind) or t.thread <> new.thread or not exists (
       select 1 from acts s join face_down f on f.play = s.id
       where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character and f.ends_at > new.created_at
         and not exists (select 1 from acts p where p.kind = 'spring' and (p.payload ->> 'set') = s.id::text))) then
    raise exception 'a take-back is of a live card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A gift is on a drive's opening play, in the play's thread: a card play whose card has a drive and whose payload names the play as its own drive. Whether the drive is still open and the amounts are donate's to say.
  if new.kind = 'donation' and (t.kind <> 'card' or t.thread <> new.thread or t.payload ->> 'drive' is distinct from t.id::text
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.drive is not null)) then
    raise exception 'a gift is to a drive, the first play of a drive card' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A draw or a wash is of a surface card's play that landed, in its thread; a wash is by the character that wrote the post under it.
  if new.kind in ('draw', 'wash') and (t.kind <> 'card' or t.thread <> new.thread or t.payload ? 'caught'
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.surface) or not exists (select 1 from surfaces s where s.play = t.id)) then
    raise exception 'a % is of a surface card''s play, in its thread', new.kind using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'wash' and new.character is distinct from (select p.character from acts p where p.id = t.target_act_id) then
    raise exception 'a wash is by the post''s own character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $function$;


-- ---- 3. place_cast ----
--
-- The target's kind test, and the two reads of `from_post` (the share lock and the acts_public read), ask post_kind.
-- Everything else as 0370_caught_casts_never_end.sql wrote it.
create or replace function public.place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb DEFAULT '{}'::jsonb)
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
  -- A relief or an unban is over when it lands (card notes, Part 5): it leaves no effect, takes no place in a stack and has no time up, so it writes no `ends` and no play_reach row.
  is_relief := kind_of.discipline ->> 'kind' = 'relief';
  is_instant := coalesce(kind_of.discipline ->> 'kind' in ('relief', 'unban'), false);

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if not coalesce(post_kind(target_kind), false) then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
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
    -- A live ward Gimmick on the post turns away a cast its rarity, flavor or name covers, in the same words for everyone (cards.ts's wardWords).
    if kind_of.play = 'cast' then
      warded := ward_refusal('post', target, kind_of);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      -- What the card's landing refuses on this post (land_refusal): public facts alone, the same words for every caster, and before anything is written.
      landing := land_refusal(kind_of, target, coalesce(config, '{}'));
      if landing is not null then raise exception '%', landing using hint = 'kayfabb.refusal', errcode = land_refusal_code(landing); end if;
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
      and coalesce(k.payload ->> 'reach', 'post') = 'post';
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
    if kind_of.play = 'cast' then
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it; a ride back lets it land and is paid by its votes (`did` is
      -- rode). Nothing pays out here, so spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      sprung := spring_traps('cast', target, written, card, actor => payer);
      rode := sprung is not null and sprung -> 'payload' ->> 'did' = 'rode';
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
      in_thread := setting_thread('systemAnnouncements');
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
    -- A live ward Gimmick on the character, thread or board turns away a cast its rarity, flavor or name covers, on its own target only.
    if kind_of.play = 'cast' then
      warded := ward_refusal(reach, target, kind_of);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
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
    elsif is_instant then
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
                        else jsonb_build_object('instant', true, 'lifted', lifts) end
              when sprung is not null and not rode then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set') else jsonb_build_object('layer', layer) end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      -- A play a back caught never lands and is never in effect, so it holds no end (0370): settle.ts boosts and skims only with a play's `ends`.
      || case when reach = 'post' and kind_of.lasts is not null and (sprung is null or rode) then jsonb_build_object('ends', ends) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- What a landed play on a post needs beside its Act (a veil's row): not for a play a back caught, which never lands.
  if reach = 'post' and (sprung is null or rode) then perform land_rows(written, kind_of, on_post, coalesce(config, '{}'), caster); end if;
  if kind_of.surface and reach = 'post' and (sprung is null or rode) then perform open_surface(written); end if;
  if reach <> 'post' and not is_instant then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- What a relief took, and what an unban lifted, as rows beside the play (the play's own Act is never changed): the rows the walk above gave, the ones `took` is the sum of; an unban lifts each ban it found.
  if is_relief then
    insert into warn_reliefs (play, infraction, points) select written, (e ->> 'infraction')::uuid, (e ->> 'points')::integer from jsonb_array_elements(relief_rows) e;
  elsif is_instant then
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
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;
revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated;


-- ---- 4. place_set ----
--
-- The target's kind test asks post_kind.
-- Everything else as 0316_card_notes_part_4.sql wrote it.
create or replace function public.place_set(setter uuid, card text, target uuid, config jsonb, payer uuid, price integer, catches text DEFAULT NULL::text, phrase text DEFAULT NULL::text, passage text DEFAULT NULL::text, named uuid[] DEFAULT NULL::uuid[], who_except boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  kind_of card_kinds%rowtype;
  caught_kind card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
  staff_setter boolean;
  body text;
  off_board integer;
  nq_name text;
  nq_ends timestamptz;
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
  if kind_of.play is distinct from 'cast' and kind_of.play is distinct from 'set' then
    raise exception '% is %', kind_of.name, case kind_of.play when 'use' then 'used on your own post' else 'kept in the hand' end using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A set card with no trap could never spring, and its setter would not know (decideSet's words). It is refused at seed time too; this is for a row that held one before.
  if kind_of.play = 'set' and kind_of.trap is null then
    raise exception '% has no trap to spring', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A Reversal that waits for a cast waits for a named card or for a match; one set with neither could catch nothing, and its setter would not know. Naming and matching are one or the other.
  if catches is null and kind_of.play = 'set' and kind_of.trap #>> '{trigger,on}' = 'cast' and jsonb_typeof(kind_of.trap -> 'match') is distinct from 'object' then
    raise exception '% names no card to catch', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null and jsonb_typeof(kind_of.trap -> 'match') = 'object' then
    raise exception '% names a card or matches cards, never both', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A ride is read in a quadrant, which the setter names when setting it.
  if kind_of.play = 'set' and jsonb_typeof(kind_of.trap -> 'outcome') = 'object'
     and not coalesce(coalesce(config, '{}') ->> 'quadrant' = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
    raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A match reaches only cards at or below its own rarity, and so does a name (decideSet's words).
  if jsonb_typeof(kind_of.trap -> 'match') = 'object' and kind_of.trap #>> '{match,upTo}' is not null
     and rarity_rank(kind_of.trap #>> '{match,upTo}') > rarity_rank(kind_of.rarity) then
    raise exception '% names cards up to %', kind_of.name, kind_of.rarity using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null then
    if kind_of.play is distinct from 'set' or kind_of.trap #>> '{trigger,on}' is distinct from 'cast' then
      raise exception '% catches no card', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select * into caught_kind from card_kinds k where k.key = place_set.catches;
    if caught_kind.key is null or caught_kind.play is distinct from 'cast' or not ('post' = any (caught_kind.reaches)) then
      raise exception '% names a card that is cast on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if rarity_rank(caught_kind.rarity) > rarity_rank(kind_of.rarity) then
      raise exception '% names cards up to %', kind_of.name, kind_of.rarity using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end if;
  if phrase is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% waits for no phrase', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if btrim(phrase) = '' then raise exception '% needs a phrase to wait for', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- The engine's bound (SET_PHRASE_MOST, engine/rules/cards.ts, which decideSet holds in the same words): phrase_pattern is one length for every back only up to it.
    if char_length(phrase) > 100 then raise exception '% waits for a phrase of at most 100 characters', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- The conditions of a Move (design sections 3 and 4). A Gimmick takes none.
  if passage is not null or named is not null or who_except is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% takes no conditions', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  if passage is not null then
    if btrim(passage) = '' or phrase_norm(passage) = '' then raise exception 'the passage needs a letter or a digit' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if char_length(passage) > 100 then raise exception 'the passage is at most 100 characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  if (named is null) is distinct from (who_except is null) then
    raise exception 'a list of characters comes with Only these or Anyone but these' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if named is not null then
    if cardinality(named) not between 1 and 5 then raise exception 'a list names one to five characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- The same message for an id that is missing and one that has not debuted: what is read is the debut alone, as suggest_characters reads `characters`, never the owner.
    select min(i) into off_board from generate_subscripts(named, 1) i
    where named[i] is null or not exists (select 1 from characters c where c.id = named[i] and c.debuted_at is not null);
    if off_board is not null then raise exception '% is not a character on the board', off_board using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if (select count(distinct x) from unnest(named) x) <> cardinality(named) then raise exception 'a character is named once in a list' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if not coalesce(post_kind(target_kind), false) then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from setter then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- The passage must be in the post's current words (its latest edit's body, else its own), read as the probe reads them. The post is public, so the refusal reads nothing private.
  if passage is not null then
    select p.current_payload ->> 'body' into body from acts_public p where p.id = target;
    if not phrase_in(bbcode_plain(coalesce(body, '')), passage) then raise exception 'that passage is not in this post''s words' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- Public, since the back is.
  -- A back is live until it springs, is taken back or its time passes; the three are public.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
             and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  -- A post that holds a live No quote takes no back until it ends (public: the play is a face-up card on the post). The refusal names the card and its end, the same for every setter.
  select n.name, n.ends into nq_name, nq_ends from no_quote_on(target) n order by n.ends desc limit 1;
  if nq_name is not null then
    raise exception 'this post''s % stops quotes until %, so no card is set face down here until then', nq_name, refusal_time(nq_ends) using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (setter, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at, catches, phrase, passage, who, who_except)
    values (written, payer, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')), place_set.catches, place_set.phrase,
            place_set.passage, place_set.named, place_set.who_except);
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  return act_projection(written);
end $function$;
revoke execute on function place_set(uuid, text, uuid, jsonb, uuid, integer, text, text, text, uuid[], boolean) from public, anon, authenticated;


-- ---- 5. play_card ----
--
-- The version lock and a reply-carrying card's thread read take a post by post_kind.
-- Everything else as 0348_post_under.sql wrote it.
create or replace function public.play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text DEFAULT ''::text, reach text DEFAULT 'post'::text, from_post uuid DEFAULT NULL::uuid, version uuid DEFAULT NULL::uuid, tokens integer DEFAULT NULL::integer, reply text DEFAULT NULL::text, framing uuid[] DEFAULT '{}'::uuid[])
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
    || (case when carries then jsonb_build_object('reply', reply_id) else '{}'::jsonb end));
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
revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[]) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid, integer, text, uuid[]) to service_role;


-- ---- 6. post_under_guard ----
--
-- A reply is drawn under a post of its own thread: the count of parent and reply takes post_kind.
-- Everything else as 0348_post_under.sql wrote it.
create or replace function public.post_under_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists (select 1 from post_under u where u.reply = new.parent and not card_ended(u.play)) then
    raise exception 'a reply drawn under a post takes no reply under it' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if (select count(*) from acts a where a.id in (new.parent, new.reply) and post_kind(a.kind) and a.thread = new.thread) is distinct from 2 then
    raise exception 'a reply is drawn under a post of its own thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $function$;
revoke execute on function post_under_guard() from public, anon, authenticated;
grant execute on function post_under_guard() to service_role;


-- ---- 7. spring_facts ----
--
-- The thread's first post, which a thread Move springs on, takes post_kind: in a spun thread it is the spin.
-- Everything else as 0360_setting_thread.sql wrote it.
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
  f.kind_play := k.play; f.kind_trap := k.trap; f.kind_stack := k.stack; f.kind_seeded := k.seeded;
  f.kind_skim := k.skim is not null; f.kind_scores := k.scores_as; f.kind_veil := k.veil;
  f.reach := coalesce(k.reaches[1], 'post');
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post and the announcements thread a board card would be written in. For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, case when coalesce(version_hidden(a.id), false) then null else a.payload ->> 'body' end, t.board into f.by_kind, f.by_character, f.by_thread, raw_body, f.by_board
  from acts a left join threads t on t.id = a.thread where a.id = by_act;
  select a.id into f.first_post from acts a where a.thread = f.by_thread and a.seq = 1 and post_kind(a.kind);
  f.announce_thread := setting_thread('systemAnnouncements');
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
  select w.plain, w.excerpt, w.unquoted into walked_plain, walked_excerpt, f.by_body from bbcode_walk(raw_body, fd.post) w;
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
revoke execute on function spring_facts(face_down, text, uuid, text) from public, anon, authenticated;


-- ---- 8. spin_written ----
--
-- The pressed post of a spin takes post_kind: a spin may be pressed at a spun thread's opening post.
-- Everything else as 0357_post_veils.sql wrote it.
create or replace function public.spin_written(origin uuid, through uuid, title text, body text, check_bar boolean, framing uuid[], at_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The post a spin is pressed at: a post by the character a landed, live play was cast on. Public facts only; one sentence for every predicate that fails.
  if at_post is not null then
    if not exists (
      select 1 from acts k join play_reach r on r.play = k.id join acts p on p.id = at_post
      where k.id = origin and k.kind = 'card' and not (k.payload ? 'caught')
        and r.reach = 'character' and post_kind(p.kind) and shown_author(p.id, p.character) = r.character
        and r.ends_at > now()
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = k.id)
    ) then raise exception 'that card is not on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  if check_bar then perform not_barred(through, on_board); end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin,
          jsonb_build_object('title', title, 'body', coalesce(body, '')) || case when at_post is not null then jsonb_build_object('at', at_post) else '{}'::jsonb end)
  returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;
revoke execute on function spin_written(uuid, uuid, text, text, boolean, uuid[], uuid) from public, anon, authenticated;
grant execute on function spin_written(uuid, uuid, text, text, boolean, uuid[], uuid) to service_role;

