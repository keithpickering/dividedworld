-- Trap locks, even trap work, and the set line's springs. docs/plans/2026-11-03-trap-locks-plan.md, Tasks 1 to 3; the design is
-- docs/plans/2026-11-03-trap-locks-design.md.
--
-- ---- The lock order ----
-- Every path that can spring a trap takes its locks in this one order, so two such writes never hold one lock each and wait on the
-- other (Postgres would refuse one of them, 40P01, and "a trap never refuses, delays or rolls back the write that springs it"):
--   1. the player's `accounts` row (play_card, set_card);
--   2. the target post's `acts` row (play_card's and set_card's `for no key update`);
--   3. `face_down` rows, by `play`, all in one statement;
--   4. the `threads` row a post's `seq` comes from (acts_take_seq's update), taken explicitly before the count rows;
--   5. `character_post_counts` rows, by `character`;
--   6. `wallets` rows, by `account` (a payout, as spring_traps already does).
-- A lock taken again later in the same transaction is no wait, so a function may go back to an earlier step it already holds.
--
-- Who takes which, in the functions as they stand after this migration (Task 1's inventory of every function that inserts a counted
-- Act, a `post`, `spin` or `card`, or locks `face_down`, `character_post_counts` or `threads`):
--   - post (here): 3, 4, 5, then its insert (4 and 5 again, held), then spring_traps (3 again, held; a strike's card is written
--     through the setter, whose count row 5 already holds; a payout never follows a reply or a quote).
--   - play_card, nine arguments (0058), and its ten-argument wrapper (0070): 1; then on a post 2, 3 (spring_traps), 6 (a payout) and
--     5 (its card's insert); on a thread 4 then 5; on a character or a board neither 3 nor 4, then 5. A card takes no `seq`. It
--     already keeps the order and is not replaced; 0058's header comment on it stays a record.
--   - set_card (0054): 1, 2, then reads `face_down` without a lock and inserts a set, which is neither counted nor numbered.
--   - spring_traps (here): 3, then a spring (neither counted nor numbered), then 6 or a strike's card (5); never 4.
--   - react (0054): its own `reactions` and `reaction_tallies` rows, which no other step's holder waits on, then 3 (spring_traps);
--     a reaction's spring is neither counted nor numbered, and with no by_act it strikes nothing.
--   - start_thread and spin (0013): a new thread's row, which no other writer can yet hold, then 5. They lock no `face_down`.
--   - edit_post (0005): an edit, neither counted nor numbered.
--   - The System's writers (write_staff_act and post_update, 0062; end_move, 0051; post_tally, 0024; write_unmask, 0027;
--     reveal_season, 0072): 4 and then 5 for a staff character, per Act. They lock no `face_down`, and a staff character can hold no
--     back (set_card's played_by refuses a character with no owner) and is never a poster through post() (acts_well_formed), so no
--     count row they hold is one post() waits on.
--   - acts_take_seq (0054) is 4 and acts_count_character (0030) is 5, as triggers inside each insert above.
--
-- ---- What post() locks, and what it costs ----
-- post() locks every live back it may spring that has not sprung (a spring is public, and acts_one_spring finds it by index): on the
-- quoted post and in the thread. It takes them in one statement, then the thread, then the count rows of the poster and of every
-- setter of a back it locked, whatever card is face down: which rows are locked is computed from public facts alone (a live,
-- unsprung back is public, and so is the character that set it), never from the card ("A response never proves a private fact";
-- a lock is felt as a wait). Holding the setters' rows ahead is what keeps two strikes on each other's posts from crossing: a strike
-- writes a card through the setter's character, a counted Act. A setter with no count row yet gets one with zeros, inserted in
-- character order before the lock, so two writers creating it wait in the same order; a row of zeros reads as a missing row does.
-- Its cost: one probe per live, unsprung back in the thread and on the quoted post (face_down_thread, then acts_one_spring and
-- the set's primary key), plus one count row per distinct setter; the reply loop then visits only the backs it locked.

-- post (0058), with its locks taken in the order above before it writes: the backs, then the thread, then the count rows. A sprung
-- back is neither locked nor probed. Everything else as 0058 wrote it.
create or replace function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  setters uuid[];
  back_posts uuid[];
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- Step 3: every live, unsprung back this post may spring, the quoted post's and the thread's, in one statement and by set, with
  -- the character that set each. spring_traps then finds each row already held.
  select coalesce(array_agg(b.setter), '{}'), coalesce(array_agg(b.post), '{}') into setters, back_posts
  from (select a.character as setter, f.post from face_down f join acts a on a.id = f.play
        where f.ends_at > now() and (f.post = quoting or f.thread = in_thread)
          and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
        order by f.play for update of f) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || through) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || through) order by character for update;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  if quoting = any (back_posts) then sprung := spring_traps('quote', quoting, written); end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.post = any (back_posts) and f.thread = in_thread and f.ends_at > now() and p.character <> through
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ---- spring_traps: the same reads for every back before its decision ----
-- Every back it holds, a Bluff or a trap, matching or not, costs the same statements until the decision: the setter's character and
-- its retired_at and debuted_at; one card_kinds row for the struck card; the stack count on by_act for that card; by_act's kind.
-- Where the back strikes nothing (a Bluff, or a trap of another outcome), the row read is the back's own card's, so the read finds
-- one row either way. A null key would not be the same work: the planner folds `= null` to false and reads nothing. The stack count
-- reads by_act's layers by target and compares the card after the fetch (`is not distinct from`, which no index serves), so which
-- card is counted never changes which rows are read; by_act is the write that met the trap, a fresh post or a card not yet written,
-- so the rows are few, and none at all for a reaction, whose by_act is null. Only then are "springs", the retired check and "can land" decided, from the locals. After the decision, only a spring
-- does more work, and a spring is a public Act. So the time a write takes is never computed from what is face down ("A response
-- never proves a private fact"); supabase/tests/0077-trap-locks.sql holds it there with read counts.

-- spring_traps (0058), with every read moved before the decision. Everything else as 0058 wrote it.
create or replace function spring_traps(trigger text, post uuid, by_act uuid, quadrant text default null, incoming_rarity text default null,
                             caster uuid default null, price integer default 0) returns jsonb
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
  where f.post = spring_traps.post and f.ends_at > now()
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
