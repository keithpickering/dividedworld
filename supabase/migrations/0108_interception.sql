-- Interception, tails and the visit trap (the Mod Bots design, sections 6 and 7, "Ways out" and "What could slip a mask"; its plan, Task 9).
--
-- Interception. A visit's Mod can be talked down: by a quiz (one question drawn when the visit starts, the same for everyone, with its choices shown on the page and its answer
-- kept in `staff_quiz_questions`, which the seed fills and no client can read), by a bribe (paid in, going nowhere) or by a distraction (any card Cast at thread reach on the
-- visit's thread). `intercept(through, visit, answer)` is the player's door for the first two; a distraction is `place_cast`'s, and always succeeds. Each is an `intercept` Act
-- (by the interceptor, on the visited post, `{visit_act, kind, answer?, succeeded, card?}`), public, taking no seq. One per character per visit (a unique index): a character, never
-- an account, so a player may try once with each mask, and the author may intercept their own post's visit. Success ends the visit (`visit_end` intercepted, `by_act` the
-- intercept). A quiz answered wrong is the only failure, and it starts a tail.
--
-- Masks. Every refusal is about the visit, the character's own standing or the caller's own wallet, in the same words for everyone: a visit over, a character that has tried,
-- a banned character, a short wallet. No result depends on who owns the post or any other character. The quiz's answer is checked in SQL and never read by any page.
--
-- Tails. A failed quiz writes a row in `tails(character, staff, until)` (append-only; `until` is `modBots.tailHours` on). The tail is OPEN while `until` has not passed and it has
-- drawn no visit: the next post by the character, and only that one, draws a visit for Obstruction (minor, cause tail) by the Mod that was intercepted, or by the board's beat Mod
-- where that one has left. `tail_visits` records the visit a tail drew (written by `draw_visits`), which spends the tail; where no visit is drawn (a repeat charge, no Mod on the
-- beat) the tail stays open. The visit itself then files, is intercepted, trapped or reversed like any other.
-- Ways out: a tail ends by itself at its time whether or not its Mod is still on staff, and a visit drawn by a Mod who has left still files (0105).
--
-- The visit trap. A trap set on a post springs when a visit starts on it (`start_visit` calls `spring_traps('visit', ...)` always now) and the sprung trap ends the visit
-- (`visit_end` trapped, `by_act` the spring). A visit trigger is accepted by `card_kinds_trap_shape`, `card_kinds_problem` and `instanceProblems`; it nullifies only (a payout is a
-- cast's, a strike lands on a reply or a quote). `visit_traps_wired()` is gone.

-- ------------------------------------------------------------------------------------------------------ the Acts ----

alter table acts drop constraint acts_kind_check;
-- (0100's 'announce' kept: an announce Act is already in the table on a database that has run 0100.)
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'announce', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept'));

-- The shape of an interception: the visit, how it was tried, what was said (a quiz's choice), whether it worked, and the card that did it (a distraction).
alter table acts add constraint acts_intercept_payload check (
  case kind
    when 'intercept' then payload - 'visit_act' - 'kind' - 'answer' - 'succeeded' - 'card' = '{}'::jsonb
      and jsonb_typeof(payload -> 'visit_act') = 'string' and payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload ->> 'kind' in ('quiz', 'bribe', 'distraction')
      and jsonb_typeof(payload -> 'succeeded') = 'boolean'
      and (not payload ? 'answer' or (jsonb_typeof(payload -> 'answer') = 'string' and char_length(payload ->> 'answer') <= 200))
      and (not payload ? 'card' or (jsonb_typeof(payload -> 'card') = 'string' and payload ->> 'card' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    else true
  end is true);

-- One attempt per character per visit; a thread's open visits are found by the thread (a thread-reach card reads them).
create unique index acts_one_intercept on acts (character, (payload ->> 'visit_act')) where kind = 'intercept';
create index acts_visits_by_thread on acts (thread, created_at, id) where kind = 'visit';

-- acts_take_seq (0107), also leaving an interception out of its thread's seq; everything else as 0107 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- An interception is a player's character's Act on the post a visit is of, in its thread, of the kind the visit's challenge is, written only by intercept and by the card hook.
create function acts_intercept_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v acts%rowtype;
begin
  if coalesce(current_setting('kayfabb.intercept_writer', true), '') <> 'on' then
    raise exception 'an interception is made only through intercept or a card at thread reach' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is null or exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'an intercept is a player''s character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  select * into v from acts a where a.id = (new.payload ->> 'visit_act')::uuid and a.kind = 'visit';
  if not found or v.target_act_id is distinct from new.target_act_id or v.thread is distinct from new.thread then
    raise exception 'an intercept is of a visit, on its post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if v.payload #>> '{challenge,kind}' is distinct from new.payload ->> 'kind' then
    raise exception 'an intercept is of the kind the visit''s challenge is' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function acts_intercept_guard() from public, anon, authenticated;
create trigger acts_intercept_guard before insert on acts for each row when (new.kind = 'intercept') execute function acts_intercept_guard();

-- ---------------------------------------------------------------------------------------------------- the money ----

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem', 'report', 'refund', 'bribe'));

-- ------------------------------------------------------------------------------------------------------ the tables ----

-- A quiz persona's questions: the question, its choices (in the order the page shows them) and the right one. Filled by the seed from the instance's roster, replaced by a reseed.
-- No client can read it: row security is on and nothing is granted. The page reads a question's text and choices through `visit_quiz` and never the answer.
create table staff_quiz_questions (
  staff text not null references characters (staff),
  idx integer not null check (idx >= 0),
  question text not null check (btrim(question) <> ''),
  choices jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) >= 2),
  answer text not null check (choices ? answer),
  primary key (staff, idx)
);
alter table staff_quiz_questions enable row level security;
revoke all on staff_quiz_questions from public, anon, authenticated;

-- A tail: a failed interception follows the character for a while. Append-only, one per failed interception.
create table tails (
  id uuid primary key default gen_random_uuid(),
  character uuid not null references characters (id),
  staff text not null references characters (staff),
  intercept_act uuid not null unique references acts (id),
  until timestamptz not null,
  created_at timestamptz not null default now(),
  check (until > created_at)
);
create index tails_by_character on tails (character, until desc);
alter table tails enable row level security;
revoke all on tails from public, anon, authenticated;

-- The visit a tail drew: a tail draws one, and is over once it has.
create table tail_visits (
  tail uuid not null references tails (id),
  visit_act uuid not null references acts (id),
  primary key (tail)
);
create index tail_visits_by_visit on tail_visits (visit_act);
alter table tail_visits enable row level security;
revoke all on tail_visits from public, anon, authenticated;

create function tails_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a tail is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger tails_no_update before update or delete on tails for each row execute function tails_append_only();
create trigger tails_no_truncate before truncate on tails for each statement execute function tails_append_only();
alter table tails enable always trigger tails_no_update;
alter table tails enable always trigger tails_no_truncate;
create trigger tail_visits_no_update before update or delete on tail_visits for each row execute function tails_append_only();
create trigger tail_visits_no_truncate before truncate on tail_visits for each statement execute function tails_append_only();
alter table tail_visits enable always trigger tail_visits_no_update;
alter table tail_visits enable always trigger tail_visits_no_truncate;
revoke execute on function tails_append_only() from public, anon, authenticated;

-- The tails a character is under now: open while `until` has not passed and the tail has drawn no visit. By character, never by account. The latest first.
create function open_tails(who uuid) returns setof tails
language sql stable security definer set search_path = public, pg_temp as $$
  select t.* from tails t
  where t.character = who and t.until > now()
    and not exists (select 1 from tail_visits v where v.tail = t.id)
  order by t.created_at desc, t.id
$$;
revoke execute on function open_tails(uuid) from public, anon, authenticated;

-- The hook 0105 left empty: the staff member whose tail the character is under, or null. A character with an open tail draws a visit for Obstruction on its next post.
create or replace function open_tail_staff(who uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select t.staff from open_tails(who) t limit 1 $$;

-- ------------------------------------------------------------------------------------------------ the visit trap ----

-- start_visit (0107), springing a visit trap always and ending the visit it springs on. Everything else as 0107 wrote it.
create or replace function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  ch jsonb;
  open_visit uuid;
  held jsonb;
  top text;
  same boolean;
  ends timestamptz;
  written uuid;
  joined uuid;
  sprung jsonb;
begin
  select a.id, a.thread, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind in ('post', 'spin');
  if not found then raise exception 'there is no such post to visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then return null; end if;
  if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe') or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail', 'backfire') then
    raise exception 'a charge names its band and its cause' using errcode = '22023';
  end if;
  ch := jsonb_strip_nulls(jsonb_build_object('predicate', charge -> 'predicate', 'rule', charge -> 'rule')) || jsonb_build_object(
    'rule_number', coalesce(charge -> 'rule_number', 'null'::jsonb), 'board', coalesce(charge ->> 'board', p.board::text), 'band', charge ->> 'band', 'cause', charge ->> 'cause',
    'about_act', coalesce(charge ->> 'about_act', post_act::text));
  -- One decision per post at a time: two charges drawn at once meet here, and the second joins.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.visit:' || post_act::text, 0));
  -- The open row is taken for update: a filing (or any end) holding it makes this wait, and then it finds the visit gone and decides afresh, never joining a visit that
  -- has ended.
  select o.visit_act into open_visit from visits_open o where o.post = post_act for update;
  same := visit_charge_repeats(post_act, ch);
  if same then
    return case when open_visit is not null then jsonb_build_object('visit', open_visit, 'joined', false) else jsonb_build_object('visit', null, 'repeat', true) end;
  end if;
  if open_visit is not null then
    -- A second charge joins; the band the visit holds is the highest of its charges.
    held := visit_charges(open_visit);
    top := (select c ->> 'band' from jsonb_array_elements(held || jsonb_build_array(ch)) c
            order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc limit 1);
    joined := (write_staff_act(staff, 'visit_join', p.thread, open_visit, jsonb_build_object('charge', ch, 'band', top)) ->> 'id')::uuid;
    return jsonb_build_object('visit', open_visit, 'joined', true, 'join', joined);
  end if;
  ends := now() + visit_window(post_act, staff);
  written := (write_staff_act(staff, 'visit', p.thread, post_act, jsonb_build_object(
    'charges', jsonb_build_array(ch), 'ends_at', ends, 'challenge', visit_challenge(post_act, staff), 'line', visit_line('visitArrived', staff, jsonb_build_array(ch)))) ->> 'id')::uuid;
  -- A trap set on the post springs when a visit starts on it, and the sprung trap ends the visit (trapped, by the spring): its Acts stay.
  sprung := spring_traps('visit', post_act, written);
  if sprung is not null then
    perform end_visit(written, 'trapped', (sprung ->> 'id')::uuid, 'A trap set on this post sprang as the visit began, and the visit ended.');
  end if;
  return jsonb_build_object('visit', written, 'joined', false, 'ends_at', ends) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

revoke execute on function start_visit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function start_visit(uuid, text, jsonb) to service_role;

drop function visit_traps_wired();

-- The card checks accept a visit trigger. It nullifies only: a payout is a cast's, and a strike lays its card on a reply or a quote.
alter table card_kinds drop constraint card_kinds_trap_shape;
alter table card_kinds add constraint card_kinds_trap_shape check (trap is null or (
    trap #>> '{trigger,on}' in ('cast', 'reaction', 'reply', 'quote', 'visit')
    and (trap #>> '{trigger,on}' <> 'reaction' or trap #>> '{trigger,quadrant}' in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'))
    and trap #>> '{outcome,do}' in ('nullify', 'payout', 'strike')
    and (trap #>> '{outcome,do}' <> 'payout' or trap #>> '{trigger,on}' = 'cast')
    and (trap #>> '{outcome,do}' <> 'strike' or (trap #>> '{trigger,on}' in ('reply', 'quote') and jsonb_typeof(trap #> '{outcome,card}') = 'string'))) is true);

-- card_kinds_problem (0055), with a visit trigger no longer refused (a strike on one is). Everything else as 0055 wrote it.
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
      case when c.trigger_on = 'reaction' and c.trap #>> '{trigger,quadrant}' not in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative') is not false
           then format('card "%s" springs on a reaction of %s, which is no quadrant; it names one of excitedPositive, excitedNegative, calmPositive, boredNegative', c.key, coalesce(c.trap #> '{trigger,quadrant}', 'null'::jsonb)) end,
      case when c.trap is not null and c.outcome not in ('nullify', 'payout', 'strike') is not false
           then format('card "%s" does %s when it springs; a trap does nullify, payout, strike', c.key, coalesce(to_jsonb(c.outcome)::text, 'null')) end,
      case when c.outcome = 'payout' and c.trigger_on in ('reaction', 'reply', 'quote', 'visit') then format('card "%s" pays out on a %s; it pays out only on a cast, since only a cast is paid for', c.key, c.trigger_on) end,
      case when c.outcome = 'strike' and c.trigger_on in ('cast', 'reaction', 'visit') then format('card "%s" strikes on a %s; a strike lays its card on a reply or a quote, until cards reach characters', c.key, c.trigger_on) end,
      case when c.outcome = 'strike' and c.trigger_on not in ('cast', 'reaction', 'visit') and s.rarity is null then format('card "%s" strikes with "%s", which the instance does not have', c.key, c.struck) end,
      case when c.outcome = 'strike' and c.trigger_on not in ('cast', 'reaction', 'visit') and rarity_rank(c.rarity) < rarity_rank(s.rarity)
           then format('card "%s" strikes with "%s", which is rarer than the trap (%s)', c.key, c.struck, c.rarity) end
    ]) with ordinality w(why, n)
  ) p where why is not null
$$;


-- ---------------------------------------------------------------------------------------------------- the tails ----

-- draw_visits (0105), recording the visit a tail drew. Everything else as 0105 wrote it.
create or replace function draw_visits(post_act uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  r rules_now%rowtype;
  who text;
  tail text;
  words text;
  broke integer;
  drew jsonb;
begin
  begin
  if not coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false) then return; end if;
  select a.character, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind in ('post', 'spin');
  if not found or p.by_staff then return; end if;
  for r in select * from rules_now x where x.board is null or x.board = p.board order by x.board nulls first, x.number loop
    begin
      select count(*) into broke from rule_breaks(post_act, r.move_act);
      if broke > 0 then
        if who is null then who := beat_of(p.board); end if;
        exit when who is null;
        select 'Rule ' || r.number || ': ' || fill_tokens(x.plain, jsonb_build_object('param', coalesce(r.param #>> '{}', ''))) into words from rule_predicates x where x.key = r.predicate;
        if r.board is null then words := 'House ' || words; end if;
        perform start_visit(post_act, who, jsonb_build_object('rule_number', r.number, 'board', p.board, 'band', r.band, 'cause', 'rule', 'about_act', post_act,
          'predicate', r.predicate, 'rule', words));
      end if;
    exception when others then
      raise warning 'draw_visits: post % drew no visit for rule %: % (%)', post_act, r.number, sqlerrm, sqlstate;
      insert into visit_draw_failures (post_act, rule_number, error) values (post_act, r.number, left(sqlerrm || ' (' || sqlstate || ')', 500));
    end;
  end loop;
  begin
    -- A tailed character's posts are drawn one at a time: two posts at once would each find the tail open. The lock is taken only for a character with a tail not yet run out
    -- (the index on tails), and held to the end of the post's transaction, so the second finds the tail spent. Several open tails draw one Obstruction visit between them (the
    -- latest tail's Mod's, or the beat's where it has left), and all are spent by it.
    if exists (select 1 from tails k where k.character = p.character and k.until > now()) then
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.tail:' || p.character::text, 0));
    end if;
    tail := open_tail_staff(p.character);
    if tail is not null then
      who := coalesce(who, beat_of(p.board));
      if who is not null then
        drew := start_visit(post_act, coalesce((select n.staff from staff_now n where n.staff = tail), who), jsonb_build_object('rule_number', null, 'board', p.board, 'band', 'minor',
          'cause', 'tail', 'about_act', post_act, 'rule', 'Obstruction'));
        -- The visit is the tail's, and spends it: a tail draws one visit. (A charge that joined a visit already open makes that visit the tail's.)
        if drew ->> 'visit' is not null then
          insert into tail_visits (tail, visit_act) select t.id, (drew ->> 'visit')::uuid from open_tails(p.character) t on conflict do nothing;
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'draw_visits: post % drew no tail visit: % (%)', post_act, sqlerrm, sqlstate;
    insert into visit_draw_failures (post_act, rule_number, error) values (post_act, null, left(sqlerrm || ' (' || sqlstate || ')', 500));
  end;
  -- Nothing raises out of here, not even the reads above: the post is already written.
  exception when others then
    raise warning 'draw_visits: post % was not checked: % (%)', post_act, sqlerrm, sqlstate;
    begin
      insert into visit_draw_failures (post_act, rule_number, error) values (post_act, null, left(sqlerrm || ' (' || sqlstate || ')', 500));
    exception when others then null;
    end;
  end;
end $$;

revoke execute on function draw_visits(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------- the seed ----

-- What is wrong with a persona's quiz, or null (engine/rules/instance.ts holds the same for the TypeScript side): a quiz persona carries as many questions as its challenge
-- says, each a question, two to eight distinct choices and an answer that is one of them, none with a space at its start or end (an answer is trimmed when it is given, so it
-- would never match); any other persona carries none.
create function quiz_problem(challenge jsonb, quiz jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  q jsonb;
  n integer := 0;
  has_quiz boolean := quiz is not null and jsonb_typeof(quiz) <> 'null';
begin
  if coalesce(challenge ->> 'kind', '') <> 'quiz' then
    if has_quiz then return 'a quiz belongs to a persona whose challenge is a quiz'; end if;
    return null;
  end if;
  if not has_quiz or jsonb_typeof(quiz) <> 'array' then return 'a quiz persona carries its quiz: a list of questions, each with its choices and its answer'; end if;
  if jsonb_array_length(quiz) <> (challenge ->> 'questions')::integer then
    return format('the quiz has %s questions and its challenge says %s', jsonb_array_length(quiz), challenge ->> 'questions');
  end if;
  for q in select x from jsonb_array_elements(quiz) x loop
    n := n + 1;
    if jsonb_typeof(q) <> 'object' or q - 'question' - 'choices' - 'answer' <> '{}'::jsonb then return format('quiz question %s is a question, its choices and its answer', n); end if;
    if jsonb_typeof(q -> 'question') is distinct from 'string' or btrim(q ->> 'question') = '' or char_length(q ->> 'question') > 280 then return format('quiz question %s has no question to ask (at most 280 characters)', n); end if;
    if q ->> 'question' <> btrim(q ->> 'question') then return format('quiz question %s has a space at the start or the end of its question', n); end if;
    if jsonb_typeof(q -> 'choices') is distinct from 'array' or jsonb_array_length(q -> 'choices') not between 2 and 8
       or exists (select 1 from jsonb_array_elements(q -> 'choices') c where jsonb_typeof(c) <> 'string' or btrim(c #>> '{}') = '' or char_length(c #>> '{}') > 200) then
      return format('quiz question %s has two to eight choices, each text of at most 200 characters', n);
    end if;
    if exists (select 1 from jsonb_array_elements_text(q -> 'choices') c where c <> btrim(c)) then return format('quiz question %s has a choice with a space at the start or the end', n); end if;
    if (select count(distinct c) from jsonb_array_elements_text(q -> 'choices') c) <> jsonb_array_length(q -> 'choices') then return format('quiz question %s lists a choice twice', n); end if;
    if jsonb_typeof(q -> 'answer') is distinct from 'string' or not (q -> 'choices') ? (q ->> 'answer') then return format('quiz question %s has an answer that is not one of its choices', n); end if;
  end loop;
  return null;
end $$;
revoke execute on function quiz_problem(jsonb, jsonb) from public, anon, authenticated;

-- seed_instance (0105), also seeding each quiz persona's questions. Everything else as 0105 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
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
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card's price must outlive the card
  -- (0006). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
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
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The name of the member group every persona is in, which the instance gives.
  insert into settings (key, value)
  select 'staffGroup', payload -> 'system' -> 'staffGroup' where jsonb_typeof(payload -> 'system' -> 'staffGroup') = 'object'
  on conflict (key) do update set value = excluded.value;
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
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
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '' from made m;
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;


-- --------------------------------------------------------------------------------------------------------- the page ----

-- The question a quiz visit drew and its choices, for that visit alone (no id of a Mod or a question to walk the bank by): all the page may show. Never the answer. Security definer, because the table is no client's.
create function visit_quiz(visit uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('question', q.question, 'choices', q.choices)
  from acts v join characters c on c.id = v.character join staff_quiz_questions q on q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer
  where v.id = visit_quiz.visit and v.kind = 'visit'
$$;
revoke execute on function visit_quiz(uuid) from public, anon;
grant execute on function visit_quiz(uuid) to authenticated, service_role;

-- thread_page (0105), also carrying a quiz visit's question and its choices in its challenge (`visit_quiz`): never which choice is right. Everything else as 0105 wrote it.
create or replace function thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  -- The refusal, before anything is read.
  select case when coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) is null
                or coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) not between 1 and 100
              then screen_refusal('a page holds 1 to 100 posts') end;

  with pp as materialized (
    select coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) as n
  ),
  s as materialized (
    select o.*, greatest(1, ceil(o.last_seq::numeric / (select pp.n from pp)))::integer as last_page
    from thread_open o where o.id = thread_page.in_thread
  ),
  pg as materialized (
    select s.*,
           least(s.last_page, greatest(1, coalesce(case when thread_page.in_seq is not null then greatest(1, ceil(thread_page.in_seq::numeric / (select pp.n from pp)))::integer end,
                                                   thread_page.in_page, 1))) as page
    from s
  ),
  rng as materialized (
    select pg.*, (pg.page - 1) * (select pp.n from pp) + 1 as first_seq, pg.page * (select pp.n from pp) as end_seq from pg
  ),
  page_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
  ),
  posts as materialized (select a.id, a.character from page_acts a where a.kind = 'post'),
  -- At most PLAYS_PER_POST layers a post, oldest first.
  on_posts as materialized (
    select l.* from (
      select a.*, row_number() over (partition by a.target_act_id order by a.created_at, a.id) as n
      from acts_public a where a.kind in ('card', 'set', 'spring') and a.target_act_id in (select p.id from posts p)
    ) l where l.n <= 8
  ),
  -- An admin's end of each of those plays (0092), as cardsOnMany answers it beside them: the client marks a play reversed only from
  -- its card_end (engine/ui/cards/plays.ts), so a page without it would draw an ended effect over its post. One per play at most.
  ends_on_posts as materialized (
    select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select o.id from on_posts o)
  ),
  above as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act
    from effects_above(array(select distinct p.character from posts p where p.character is not null), (select rng.id from rng), (select rng.board from rng)) x
  ),
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
  ),
  -- Each of the page's posts' latest visit (0105), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select a.id from page_acts a where a.kind in ('post', 'spin'))
    order by v.target_act_id, v.created_at desc, v.id desc
  ),
  ids as materialized (select a.id from page_acts a union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select p.character from played p union select v.character from vis v) w where c is not null
  ),
  wanted_plays as materialized (select p.id from played p where p.card = any (coalesce(thread_page.effect_cards, '{}'))),
  spun as materialized (
    select l.* from (
      select t.*, row_number() over (partition by t.origin_act_id order by t.created_at, t.id) as n
      from thread_list t where t.origin_act_id in (select i.id from ids i)
    ) l where l.n <= 200
  )
  select case when not exists (select 1 from rng) then null else jsonb_build_object(
    'summary', (select to_jsonb(s) - 'last_page' from s),
    'page', (select rng.page from rng),
    'acts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.seq), '[]'::jsonb) from page_acts a),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
          'warn_points', c.warn_points, 'banned_until', c.banned_until),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style)
                    from character_profiles p where p.character = c.id),
        'posts', coalesce((select n.posts from character_post_counts n where n.character = c.id), 0),
        'standing', coalesce((select st.standing from current_standings st where st.character = c.id), 0),
        'reveals', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'character', r.character, 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread)
                      order by r.at, r.act), '[]'::jsonb) from class_reveals r where r.character = c.id),
        'turns', (select coalesce(jsonb_agg(jsonb_build_object('act', u.act, 'character', u.character, 'at', u.at, 'was', u.was) order by u.at, u.act), '[]'::jsonb)
                  from turns_announced u where u.character = c.id)
      ) order by c.id), '[]'::jsonb)
      from characters_public c where c.id in (select w.c from who w)),
    'plays', (select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) from (
                select to_jsonb(o) - 'n' as j, o.created_at, o.id from on_posts o
                union all
                select to_jsonb(e), e.created_at, e.id from ends_on_posts e
              ) x),
    'above', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from above x),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object(
        'visit', v.id, 'post', v.post, 'mod', v.character, 'at', v.created_at, 'ends_at', v.payload -> 'ends_at', 'line', v.payload -> 'line',
        'charges', (v.payload -> 'charges') || coalesce((select jsonb_agg(j.payload -> 'charge' order by j.created_at, j.id) from acts_public j where j.kind = 'visit_join' and j.target_act_id = v.id), '[]'::jsonb),
        'challenge', jsonb_strip_nulls(jsonb_build_object('kind', v.payload #>> '{challenge,kind}', 'question_index', v.payload #> '{challenge,question_index}', 'price', v.payload #> '{challenge,price}'))
          || coalesce(visit_quiz(v.id), '{}'::jsonb),
        'end', (select jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', e.payload ->> 'outcome', 'by_act', e.payload -> 'by_act', 'line', e.payload -> 'line')
                from acts_public e where e.kind = 'visit_end' and e.target_act_id = v.id limit 1)
      ) order by v.created_at, v.id), '[]'::jsonb) from vis v),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select i.id from ids i)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m.character)), '[]'::jsonb)
             from my_reactions m where m.act in (select i.id from ids i)),
    'spun', (select coalesce(jsonb_agg(to_jsonb(l) - 'n' order by l.created_at, l.id), '[]'::jsonb) from spun l),
    'reading', (select r.furthest_seq from reading r where r.thread = thread_page.in_thread limit 1),
    'board', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act)
              from boards_now b where b.id = (select rng.board from rng)),
    'following', following_thread(thread_page.in_thread),
    'presence', presence_box('thread', thread_page.in_thread),
    'unread', my_alerts_unread()
  ) end;
end;


-- ------------------------------------------------------------------------------------------------- the distraction ----

-- A card Cast at thread reach by `caster`: each open visit on the thread whose challenge is a distraction, and that the caster has not tried, ends intercepted by an `intercept`
-- Act of kind distraction that always succeeds. No other Mod's visit is touched. Returns how many it ended. The open row is taken first, so a filing racing it ends the visit once.
create function distract_visits(caster uuid, in_thread uuid, card_act uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  iid uuid;
  ended integer := 0;
  me text := (select c.name from characters c where c.id = caster);
  said text;
begin
  for v in
    select a.id, a.target_act_id, (select m.name from characters m where m.id = a.character) as mod_name
    from acts a join visits_open o on o.visit_act = a.id
    where a.kind = 'visit' and a.thread = in_thread and a.payload #>> '{challenge,kind}' = 'distraction'
    order by a.created_at, a.id
  loop
    perform 1 from visits_open o where o.visit_act = v.id for update;
    continue when not found;
    continue when exists (select 1 from acts i where i.kind = 'intercept' and i.character = caster and i.payload ->> 'visit_act' = v.id::text);
    perform set_config('kayfabb.intercept_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload)
    values (caster, 'intercept', in_thread, v.target_act_id, jsonb_build_object('visit_act', v.id, 'kind', 'distraction', 'succeeded', true, 'card', card_act))
    returning id into iid;
    perform set_config('kayfabb.intercept_writer', '', true);
    said := me || ' drew ' || v.mod_name || '''s attention away from this post with a card.';
    perform end_visit(v.id, 'intercepted', iid, said);
    ended := ended + 1;
  end loop;
  return ended;
end $$;
revoke execute on function distract_visits(uuid, uuid, uuid) from public, anon, authenticated;

-- place_cast (0092), also ending the distraction-weak visits on the thread of a card Cast at thread reach. Everything else as 0092 wrote it. Create or replace keeps 0092's
-- grants (none to an API role); the revoke is stated again.
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
  -- A card Cast at thread reach talks down the open visits on the thread whose Mod a distraction moves (0108), once for each, as this caster's attempt.
  if reach = 'thread' and not staff_caster then perform distract_visits(caster, target, written); end if;
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

revoke execute on function place_cast(uuid, text, uuid, jsonb, text, text, uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- intercept ----

-- A player's character tries to talk a Mod out of a visit, once. A quiz compares the answer with the persona's question drawn at the start; a bribe spends the visit's price
-- (it goes nowhere); a distraction takes no answer (a card does it). Refused, before anything is written or spent: a character the caller does not play, a banned character, a
-- visit that is over, a character that has tried, no answer to a quiz, a short wallet. Right or paid: the visit ends intercepted by the Act. Wrong: a tail for `tailHours`.
-- Returns {intercept, visit, kind, succeeded, ended, tail_until}.
create function intercept(through uuid, visit_act uuid, answer text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  v acts%rowtype;
  ckind text;
  price integer;
  mod_key text;
  mod_name text;
  me text;
  said text := btrim(coalesce(answer, ''));
  wanted text;
  shown jsonb;
  ok boolean;
  iid uuid;
  until timestamptz;
  hours integer := coalesce((select (m.value ->> 'tailHours')::integer from settings m where m.key = 'modBots'), 24);
  held numeric;
begin
  caller := acting(through);
  perform not_banned(through);
  select * into v from acts a where a.id = intercept.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The visit's open row, taken for update: a filing or another interception waits, then finds the visit over. A visit with no open row has ended.
  perform 1 from visits_open o where o.visit_act = v.id for update;
  if not found then raise exception 'this visit is over' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if exists (select 1 from acts i where i.kind = 'intercept' and i.character = through and i.payload ->> 'visit_act' = v.id::text) then
    raise exception 'this character has already tried this visit' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  ckind := v.payload #>> '{challenge,kind}';
  select c.staff, c.name into mod_key, mod_name from characters c where c.id = v.character;
  select c.name into me from characters c where c.id = through;
  if ckind = 'quiz' then
    if said = '' then raise exception 'pick an answer' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    select q.answer, q.choices into wanted, shown from staff_quiz_questions q where q.staff = mod_key and q.idx = (v.payload #>> '{challenge,question_index}')::integer;
    if not found then raise exception 'this Mod has no question to ask right now; the visit ends by itself at its time' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    -- An answer is one of the choices shown: anything else (or something far too long) is refused the same way for everyone, before anything is written.
    if char_length(said) > 200 or not shown ? said then raise exception 'pick one of the answers shown' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    ok := said = wanted;
  elsif ckind = 'bribe' then
    price := (v.payload #>> '{challenge,price}')::integer;
    select w.balance into held from wallets w where w.account = caller;
    if coalesce(held, 0) < price then
      raise exception 'that costs %, and your wallet holds %', price, coalesce(held, 0) using hint = 'kayfabb.refusal', errcode = 'P0001';
    end if;
    ok := true;
    said := '';
  else
    raise exception 'this Mod is moved by a card played on the thread, not by an answer or a payment' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform set_config('kayfabb.intercept_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'intercept', v.thread, v.target_act_id, jsonb_build_object('visit_act', v.id, 'kind', ckind, 'succeeded', ok) || case when ckind = 'quiz' then jsonb_build_object('answer', said) else '{}'::jsonb end)
  returning id into iid;
  perform set_config('kayfabb.intercept_writer', '', true);
  if ckind = 'bribe' then perform wallet_spend(caller, price, 'bribe', iid); end if;
  if ok then
    perform end_visit(v.id, 'intercepted', iid, me || ' got past ' || mod_name || '''s ' || case ckind when 'quiz' then 'quiz' else 'price' end || '.');
  else
    until := now() + make_interval(hours => hours);
    insert into tails (character, staff, intercept_act, until) values (through, mod_key, iid, until);
  end if;
  return jsonb_build_object('intercept', iid, 'visit', v.id, 'kind', ckind, 'succeeded', ok, 'ended', ok, 'tail_until', until);
end $$;
revoke execute on function intercept(uuid, uuid, text) from public, anon;
grant execute on function intercept(uuid, uuid, text) to authenticated, service_role;
