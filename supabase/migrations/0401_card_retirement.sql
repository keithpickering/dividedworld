-- Retiring a card (docs/plans/2026-11-20-card-retirement-plan.md, Task 2; design docs/plans/2026-11-20-card-retirement-design.md, sections 1 to 3, 5 and 8; closes #612).
-- A card leaves the game one of three ways, each said in the instance's code and written by seed_instance: out of print (`retired_at`: nothing gives a new copy, every copy stays playable, and listing it again clears the date),
-- renamed (`became`, `gone_at`: every copy an account holds, held or face down, moves to the new key) and withdrawn (`refund`, `gone_at`: every such copy is refunded). Nothing is edited or deleted ("Append-only"): a move
-- is rows beside the ones before them, in each account's own ledger and wallet, read by that account alone. A pack kind the payload stops listing is out of print too (`pack_kinds.retired_at`).
-- Each object that is not new is copied whole from its latest version on main, with only the change named.
--
--   1. card_kinds, pack_kinds   `retired_at`, `gone_at`, `became` (a card, by key) and `refund` (hundredths, positive); became and refund only with gone_at, never both, one of them always with gone_at, and retired_at and gone_at never both.
--                               pack_kinds gains `retired_at`.
--   2. card_ledger, wallet      the kinds `renamedOut`, `renamedIn` and `withdrawn` (a withdrawn row carries the refund as its price; renamedIn and renamedOut cost nothing) and the wallet's `withdrawal`. card_ledger_check (0149) now
--                               needs an Act for played, caught and returned, none for bought, pulled, found and renamedIn, and lets renamedOut and withdrawn carry either: a back's play (the live back the seed moved, so card_held does not
--                               count it twice) or none (a held copy, or a copy of a sealed pack). card_ledger_pulled_from_pack (0139) lets a `withdrawn` row name the pack it was refunded from. An index on (act) for the two kinds is the probe's.
--   3. card_held, my_card_ledger  card_held (0340's) counts renamedIn and subtracts renamedOut and withdrawn rows that name no Act and no pack (a live back's row only marks its back), and leaves out a back that such a row names, so an
--                               ended back of a key that left adds nothing. my_card_ledger (0377's) shows the new rows as they are and leaves out the synthesized `returned` row for such a back. my_cards reads card_held, so it follows.
--   4. draw_pool                (0207's) leaves out a card with retired_at or gone_at: one change covers roll_pack, buy_pack and the Random Event's card outcome.
--   5. machine_now              (0140's) leaves out a slot whose card has retired_at or gone_at, or whose pack kind has retired_at, a flash sale or a Pull open on it included: slot_for_sale, buy_card and buy_pack then refuse it
--                               in the words a missing slot has. The slot row is untouched, so listing the card again brings it back as it was.
--   6. admin_machine            (0141's, with 0368's plan settings) carries `retired`, `became` (the new card's KEY, null otherwise; the client names it) and `withdrawn` for a card slot, and `retired` for a pack slot.
--   7. open_pack                (0377's) takes the account's row first (as play_card does), writes a card with `became` as `pulled` under the new key and a withdrawn one as a `withdrawn` row with its refund as price, credits the pack's
--                               refunds in one wallet_move ('withdrawal'), and answers its contents with the new keys and `refunds: [{index, refund}]` (0-based, hundredths).
--   8. spring_facts, take_back  spring_facts (0393's): a back whose card has gone_at is read as a card with no play and no trap, so it matches nothing. take_back (0317's): a back whose card is gone is refused after the setter check, in
--                               plain words naming the dates of gone_at and of the back's end, hint kayfabb.refusal.
--   9. seed_instance            (0397's): the guard and steps below, run for a payload that carries `formerly` or `withdrawn` (the engine's always does; a seed built with neither is a partial one, as the suite's older tests send):
--                                 a. a card_kinds key the payload lists in none of cards, formerly and withdrawn, a key in two of them, a formerly entry that became a card the payload does not list (or itself), and a key with gone_at
--                                    listed as a card are each refused, naming the keys, before anything is written;
--                                 b. every card's `retired` sets retired_at (kept while the flag stays, cleared when it goes);
--                                 c. each formerly key not yet gone, and each withdrawn key not yet gone, is moved by card_leaves (new, below): every account holding the key or a live back of it is locked first, `for no key update`, in id
--                                    order (the row play_card and take_back take), then one grouped statement writes the held copies' rows, the live backs' rows and the new key's, and a withdrawal takes one wallet_move per account;
--                                 d. a pack kind the payload does not list is retired, one it lists is not;
--                                 e. the answer gains `retired` (keys), `renamed` [{from, to, copies}] and `withdrawn` [{key, copies, refunded}]: totals of this seed, never a row per account.
--
-- Ways out: nothing here is a state a player is in. A held copy of an out-of-print card plays as ever; a copy of a card that left is a copy of the new card or an orb refund at once; a back of such a card ends by itself at its time and
-- adds nothing. Masks: the pools and the machine read the catalog alone; the rows are each account's own; the seed answers the service role with totals; take_back's new refusal is reached by the back's own setter alone.

-- ---- 1. card_kinds, pack_kinds ----

alter table card_kinds add column retired_at timestamptz;
alter table card_kinds add column gone_at timestamptz;
alter table card_kinds add column became text references card_kinds (key);
alter table card_kinds add column refund integer check (refund > 0);
alter table card_kinds add constraint card_kinds_gone_with check ((became is null and refund is null) or gone_at is not null);
alter table card_kinds add constraint card_kinds_gone_one_way check (became is null or refund is null);
alter table card_kinds add constraint card_kinds_gone_says check (gone_at is null or became is not null or refund is not null);
alter table card_kinds add constraint card_kinds_gone_not_retired check (retired_at is null or gone_at is null);
alter table pack_kinds add column retired_at timestamptz;

-- ---- 2. card_ledger, wallet_events ----

alter table card_ledger drop constraint card_ledger_kind_check;
alter table card_ledger add constraint card_ledger_kind_check check (kind in ('bought', 'played', 'pulled', 'caught', 'returned', 'found', 'renamedOut', 'renamedIn', 'withdrawn'));
alter table card_ledger drop constraint card_ledger_check;
alter table card_ledger add constraint card_ledger_check check (
  case when kind in ('played', 'caught', 'returned') then act is not null
       when kind in ('bought', 'pulled', 'found', 'renamedIn') then act is null
       else true end);
alter table card_ledger drop constraint card_ledger_pulled_from_pack;
alter table card_ledger add constraint card_ledger_pulled_from_pack check ((kind = 'pulled') = (pack is not null) or (kind = 'withdrawn' and pack is not null));
alter table card_ledger add constraint card_ledger_moved_price check (case kind when 'renamedOut' then price = 0 when 'renamedIn' then price = 0 when 'withdrawn' then price > 0 else true end);
create index card_ledger_moved_back on card_ledger (act) where kind in ('renamedOut', 'withdrawn');

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem', 'report', 'refund', 'bribe', 'appeal', 'grant', 'gift_out', 'gift_in', 'crowd', 'withdrawal'));

-- ---- 3. card_held, my_card_ledger ----

-- card_held (0340's), with the three kinds. A renamedOut or withdrawn row with no Act and no pack is a copy that left the hand (its back's row, which names the play, only marks the back: the play already took the copy out, and an ended back
-- that such a row names is not counted back). A withdrawn row that names a pack is a copy that never entered the hand (an opened pack's refund), so it takes none out.
create or replace function card_held(who uuid, card text) returns integer
language sql stable set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'pulled', 'caught', 'returned', 'found', 'renamedIn'))
          - count(*) filter (where l.kind = 'played' or (l.kind in ('renamedOut', 'withdrawn') and l.act is null and l.pack is null))
          + (select count(*) from face_down f
             where f.account = card_held.who and f.card = card_held.card and f.ends_at <= now() and not back_closed(f.play)
               and not exists (select 1 from card_ledger m where m.kind in ('renamedOut', 'withdrawn') and m.act = f.play)))::integer
  from card_ledger l where l.account = card_held.who and l.card = card_held.card
$$;

-- my_card_ledger (0377's), without the synthesized `returned` row for a back that a renamedOut or withdrawn row names; its other rows are as they were, the new kinds among them.
create or replace view my_card_ledger as
  select l.card, l.kind, l.act, l.price, l.at,
         case when l.kind = 'played' and a.kind = 'set' then k.trap is not null or k.play = 'cast' end as springs,
         l.pack, l.repriced, pk.pack as pack_kind, pk.source as pack_source
  from card_ledger l
  left join card_kinds k on k.key = l.card
  left join acts a on a.id = l.act
  left join packs pk on pk.id = l.pack
  where l.account = auth.uid()
  union all
  select f.card, 'returned'::text, null::uuid, 0, f.ends_at, null::boolean, null::uuid, false, null::text, null::text
  from face_down f
  where f.account = auth.uid() and f.ends_at <= now()
    and (select s.id from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text limit 1) is null
    and (select tb.id from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = f.play::text limit 1) is null
    and not exists (select 1 from card_ledger m where m.kind in ('renamedOut', 'withdrawn') and m.act = f.play);

-- ---- 4. draw_pool ----

-- draw_pool (0207's), without a card that is out of print or gone.
create or replace function draw_pool(pool text, leaves text[], voice boolean) returns table (key text, rarity text)
language sql stable set search_path = public, pg_temp as $$
  select k.key, k.rarity from card_kinds k where pool = 'card' and k.key <> all (leaves) and (voice or not k.writes) and k.retired_at is null and k.gone_at is null
  union all
  select g.key, g.rarity from gear_kinds g where pool = 'gear' and g.key <> all (leaves)
$$;

-- ---- 5. machine_now ----

-- machine_now (0140's), without a slot whose card is out of print or gone, or whose pack kind is out of print: a flash sale or a Pull open on it is not shown and slot_for_sale finds no slot to sell.
create or replace view machine_now as
  select s.id as slot, s.position, s.card, s.pack, k.rarity,
         case
           when s.availability = 'soldOut' then 'soldOut'
           when s.availability = 'hidden' then case when mv.kind = 'flashSale' then 'onSale' else 'hidden' end
           when mv.kind = 'pullSlot' then 'soldOut'
           else 'onSale'
         end as availability,
         case when s.availability = 'onSale' and mv.kind = 'repriceSlot' and mv.percent is not null then least(2147483647, greatest(1, round(s.price * mv.percent / 100.0)))::integer else s.price end as price,
         case when mv.move_act is null then null
              else jsonb_build_object('kind', mv.kind, 'act', mv.move_act, 'ends', mv.expires_at, 'demand', mv.demand, 'progress', mv.progress, 'was', s.price,
                                      'percent', mv.percent, 'hours', mv.hours) end as move
  from machine_slots s
  left join card_kinds k on k.key = s.card
  left join pack_kinds pk on pk.key = s.pack
  left join (select distinct on (m.slot) m.* from machine_moves_open m where m.slot is not null order by m.slot, m.landed_at desc, m.move_act desc) mv on mv.slot = s.id
  where (s.availability <> 'hidden' or mv.kind = 'flashSale')
    and k.retired_at is null and k.gone_at is null and pk.retired_at is null;

-- ---- 6. admin_machine ----

-- admin_machine (0141's; 0368 set its plan cache mode and jit, set again below, since replacing a function resets them), with `retired`, `became` (the new card's key) and `withdrawn` for a card slot and `retired` for a pack slot.
create or replace function admin_machine() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the machine');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slot', s.id, 'position', s.position, 'card', s.card, 'pack', s.pack, 'rarity', k.rarity, 'availability', s.availability, 'price', s.price,
      'move', (select jsonb_build_object('kind', m.kind, 'act', m.move_act, 'ends', m.expires_at, 'percent', m.percent, 'hours', m.hours)
               from machine_moves_open m where m.slot = s.id order by m.landed_at desc, m.move_act desc limit 1),
      'retired', coalesce(k.retired_at, pk.retired_at) is not null
    ) || case when s.card is not null then jsonb_build_object('became', k.became, 'withdrawn', k.gone_at is not null and k.became is null) else '{}'::jsonb end order by s.position)
    from machine_slots s left join card_kinds k on k.key = s.card left join pack_kinds pk on pk.key = s.pack), '[]'::jsonb);
end $$;
alter function public.admin_machine() set plan_cache_mode = force_generic_plan;
alter function public.admin_machine() set jit = off;

-- ---- 7. open_pack ----

-- A card's current key and refund: following `became` (a card renamed twice since a pack was made reaches the last), the card it is now and, where the chain ends in a withdrawal, its refund. At most eight links.
create function card_now(card text) returns table (key text, refund integer)
language sql stable set search_path = public, pg_temp as $$
  with recursive r(key, became, refund, n) as (
    select k.key, k.became, k.refund, 0 from card_kinds k where k.key = card_now.card
    union all
    select k.key, k.became, k.refund, r.n + 1 from r join card_kinds k on k.key = r.became where r.n < 8
  )
  select r.key, r.refund from r order by r.n desc limit 1
$$;
revoke execute on function card_now(text) from public, anon, authenticated;

-- open_pack (0377's), taking the account's row before it reads what the cards have become (a seed that moves a key takes the same row, so a copy is never written under a key after the seed counted it), writing a renamed card
-- under the new key, a withdrawn one as a `withdrawn` row at its refund, and the pack's refunds as one wallet move. The answer's contents are the keys as they stand, and `refunds` names the withdrawn cards' places.
create or replace function open_pack(pack uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  mine packs;
  total bigint;
  shown jsonb;
  paid jsonb;
begin
  -- A caller with no account is refused before any pack is looked at, in the same words whatever the pack's id, so it says nothing about a pack.
  select p.* into mine from packs p where p.id = open_pack.pack and p.account = caller for update;
  if not found then raise exception 'there is no such pack' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if mine.opened_at is not null or exists (select 1 from pack_openings o where o.pack = mine.id) then
    raise exception 'this pack is already open' using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  perform 1 from accounts a where a.id = mine.account for no key update;
  insert into pack_openings (pack) values (mine.id);
  with c as (
    select x.i, n.key, n.refund from unnest(mine.contents) with ordinality x(card, i) cross join lateral card_now(x.card) n
  ), written as (
    insert into card_ledger (account, card, kind, price, pack)
    select mine.account, c.key, case when c.refund is null then 'pulled' else 'withdrawn' end, coalesce(c.refund, 0), mine.id from c order by c.i
    returning 1
  )
  select coalesce(sum(c.refund), 0), to_jsonb(array_agg(c.key order by c.i)),
         coalesce(jsonb_agg(jsonb_build_object('index', c.i - 1, 'refund', c.refund) order by c.i) filter (where c.refund is not null), '[]'::jsonb)
    into total, shown, paid
  from c;
  if total > 0 then perform wallet_move(mine.account, total, 'withdrawal', null, null); end if;
  return jsonb_build_object('pack', mine.id, 'kind', mine.pack, 'contents', shown, 'refunds', paid);
end $$;
revoke execute on function open_pack(uuid) from public, anon, service_role;
grant execute on function open_pack(uuid) to authenticated;

-- ---- 8. spring_facts, take_back ----

-- spring_facts (0393's), a back whose card has gone matches nothing: its kind is read as no play and no trap, so spring_traps finds no trigger it answers to.
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
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post and the announcements thread a board card would be written in. For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, case when coalesce(version_hidden(a.id), false) then null else a.payload ->> 'body' end, act_forged(a.payload), t.board into f.by_kind, f.by_character, f.by_thread, raw_body, raw_forged, f.by_board
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

-- take_back (0317's), a back whose card has gone is refused after the setter check and the check that it is still up, in plain words: when the card left, what became of this copy and when the back ends by itself.
create or replace function take_back(who uuid, through uuid, set_act uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_post uuid;
  fd face_down%rowtype;
  author uuid;
  written uuid;
  nothing constant text := 'there is no face-down card to take back there';
  gone card_kinds%rowtype;
  day constant text := 'FMMon FMDD, YYYY';
begin
  perform played_by(through, take_back.who);
  perform not_banned(through);
  -- 1. The account's row, as set_card takes it.
  perform 1 from accounts a0 where a0.id = take_back.who for no key update;
  -- The caller's own back, found without a lock; anything else is no back to them, and takes no more.
  select f.post into on_post from face_down f where f.play = take_back.set_act and f.account = take_back.who;
  if on_post is not null then
    -- 2. The post's row, as set_card takes it, then 3. the back's, as a spring does; read again under the lock, so a spring or a take-back that landed while this waited is seen.
    perform 1 from acts a where a.id = on_post for no key update;
    select f.* into fd from face_down f where f.play = take_back.set_act for update;
    select a.character into author from acts a where a.id = take_back.set_act;
  end if;
  -- A set Act that is not the caller's own back, by the character the caller acts through.
  if on_post is null or author is distinct from through then
    raise exception '%', nothing using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  -- A back already sprung, taken back or past its time.
  if fd.ends_at <= now()
     or exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = fd.play::text)
     or exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = fd.play::text) then
    raise exception '%', nothing using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  -- A back of a card that left: its copy moved or was refunded when the seed ran, so there is nothing to take back, and the words say what happened. Only the back's own setter reaches this.
  select k.* into gone from card_kinds k where k.key = fd.card and k.gone_at is not null;
  if found then
    raise exception '%', case when gone.became is null
      then format('%s was withdrawn on %s, and this copy was refunded then. Its back ends by itself on %s.', gone.name, to_char(gone.gone_at at time zone 'UTC', day), to_char(fd.ends_at at time zone 'UTC', day))
      else format('%s was renamed to %s on %s, and this copy is in your hand as one. Its back ends by itself on %s.', gone.name, (select n.name from card_kinds n where n.key = gone.became), to_char(gone.gone_at at time zone 'UTC', day), to_char(fd.ends_at at time zone 'UTC', day)) end
      using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (author, 'take_back', fd.thread, fd.post, jsonb_build_object('set', fd.play::text)) returning id into written;
  insert into card_ledger (account, card, kind, act, price) values (take_back.who, fd.card, 'returned', written, 0);
  -- A surface card's draft goes with the back: nothing can spring it now.
  delete from face_down_draws d where d.play = fd.play;
  return act_projection(written);
end $$;
revoke execute on function take_back(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function take_back(uuid, uuid, uuid) to service_role;


-- ---- 9. card_leaves, seed_instance ----

-- A card leaves the game (0401): marks `old` gone, as renamed to `became` or as withdrawn with `refund` hundredths, and moves every copy an account holds, once. Every account that holds the key or a live back of it is locked first,
-- `for no key update` in id order: the row play_card and take_back take, so no copy is played or taken back between the count and the write. A live back is a face-down card still up and not sprung or taken back; a held copy is as
-- card_held counts it (an ended back that never sprang included). One statement counts them by account and writes every row: the held copies' rows (naming no Act), the live backs' rows (naming the back's play, since that play
-- already took the copy out of the hand) and, for a rename, the new key's rows. A withdrawal then credits each account once, refund times copies, through wallet_move as every credit goes (the wallet's cap overflows as it does for
-- any). Answers the copies moved, and moves none for a key that is already gone. The seed's alone: no API role runs it.
create function card_leaves(old text, became text, refund integer) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pays jsonb;
  pay jsonb;
  copies bigint := 0;
begin
  if (card_leaves.became is null) = (card_leaves.refund is null) then raise exception 'a card leaves renamed or withdrawn, not both and not neither' using errcode = '22023'; end if;
  perform 1 from accounts a
  where a.id in (select l.account from card_ledger l where l.card = card_leaves.old union select f.account from face_down f where f.card = card_leaves.old and f.account is not null)
  order by a.id for no key update;
  -- After the locks, so a card that left while this waited is seen.
  update card_kinds k set gone_at = now(), became = card_leaves.became, refund = card_leaves.refund, retired_at = null where k.key = card_leaves.old and k.gone_at is null;
  if not found then return 0; end if;
  with held as materialized (
    select a.account, sum(a.n) as n from (
      select l.account, count(*) filter (where l.kind in ('bought', 'pulled', 'caught', 'returned', 'found', 'renamedIn'))
                        - count(*) filter (where l.kind = 'played' or (l.kind in ('renamedOut', 'withdrawn') and l.act is null and l.pack is null)) as n
      from card_ledger l where l.card = card_leaves.old group by l.account
      union all
      select f.account, count(*) from face_down f
      where f.card = card_leaves.old and f.account is not null and f.ends_at <= now() and not back_closed(f.play)
        and not exists (select 1 from card_ledger m where m.kind in ('renamedOut', 'withdrawn') and m.act = f.play)
      group by f.account) a
    group by a.account having sum(a.n) > 0
  ), live as materialized (
    select f.account, f.play from face_down f where f.card = card_leaves.old and f.account is not null and f.ends_at > now() and not back_closed(f.play)
  ), tot as materialized (
    select coalesce(h.account, v.account) as account, coalesce(h.n, 0) + coalesce(v.n, 0) as n
    from held h full join (select x.account, count(*) as n from live x group by x.account) v on v.account = h.account
  ), out_held as (
    insert into card_ledger (account, card, kind, price)
    select h.account, card_leaves.old, case when card_leaves.became is not null then 'renamedOut' else 'withdrawn' end, coalesce(card_leaves.refund, 0) from held h, generate_series(1, h.n::integer)
    returning 1
  ), out_live as (
    insert into card_ledger (account, card, kind, price, act)
    select v.account, card_leaves.old, case when card_leaves.became is not null then 'renamedOut' else 'withdrawn' end, coalesce(card_leaves.refund, 0), v.play from live v
    returning 1
  ), in_new as (
    insert into card_ledger (account, card, kind, price)
    select t.account, card_leaves.became, 'renamedIn', 0 from tot t, generate_series(1, t.n::integer) where card_leaves.became is not null
    returning 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('account', t.account, 'n', t.n) order by t.account), '[]'::jsonb) into pays from tot t;
  for pay in select p from jsonb_array_elements(pays) p loop
    copies := copies + (pay ->> 'n')::bigint;
    if card_leaves.refund is not null then perform wallet_move((pay ->> 'account')::uuid, card_leaves.refund::bigint * (pay ->> 'n')::bigint, 'withdrawal', null, null); end if;
  end loop;
  return copies;
end $$;
revoke execute on function card_leaves(text, text, integer) from public, anon, authenticated;
grant execute on function card_leaves(text, text, integer) to service_role;

-- seed_instance (0397's), with the three ways a card leaves (see the header, 9): the guard before the cards are written, the steps after them and after the packs, and the answer's three lists. Everything else as 0397 wrote it.
create or replace function public.seed_instance(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
  was text := current_setting('kayfabb.seeding', true);
  retiring boolean := payload ? 'formerly' or payload ? 'withdrawn';
  moving record;
  copies bigint;
  renamed jsonb := '[]'::jsonb;
  withdrawn_out jsonb := '[]'::jsonb;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- The settings trigger (settings_tuned) marks a row tuned for any write but a seed's: this transaction is the seed's, so its writes leave no mark.
  perform set_config('kayfabb.seeding', 'on', true);
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  perform seed_setting(e.key, e.value) from jsonb_each(payload -> 'settings') e;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
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
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- The three ways a card leaves (0401). A seed that carries `formerly` or `withdrawn` says where every card the database holds stands, and is refused, naming the keys, where it does not: a key in none of cards, formerly and withdrawn,
  -- a key in more than one, a renaming into a card the seed does not list (or into itself), a refund that is not a positive whole number, and a card that left listed as a card again (a card that comes back takes a new key).
  -- The refusal does not depend on who holds what. Nothing is written before it.
  if retiring then
    select string_agg(k.key, ', ' order by k.key) into unknown from card_kinds k
    where not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e where e ->> 'key' = k.key)
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) e where e ->> 'key' = k.key)
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) e where e ->> 'key' = k.key);
    if unknown is not null then
      raise exception 'the seed lists % as no card, no former name and no withdrawn card: a card the database holds is listed as one of the three, never left out', unknown using errcode = '22023';
    end if;
    select string_agg(d.key, ', ' order by d.key) into unknown
    from (select x.key from (select e ->> 'key' as key from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e
                             union all select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) e
                             union all select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) e) x group by x.key having count(*) > 1) d;
    if unknown is not null then raise exception 'the seed lists % in more than one of its cards, former names and withdrawn cards: a card is in one', unknown using errcode = '22023'; end if;
    select string_agg(f.e ->> 'key' || ' (renamed to ' || coalesce(f.e ->> 'became', 'nothing') || ')', ', ' order by f.e ->> 'key') into unknown
    from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) f(e)
    where f.e ->> 'became' is null or f.e ->> 'became' = f.e ->> 'key' or not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) c where c ->> 'key' = f.e ->> 'became');
    if unknown is not null then raise exception 'a card is renamed to another card the seed lists as a card, never to itself or to nothing: %', unknown using errcode = '22023'; end if;
    select string_agg(w.e ->> 'key', ', ' order by w.e ->> 'key') into unknown
    from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w(e)
    where jsonb_typeof(w.e -> 'refund') is distinct from 'number' or (w.e ->> 'refund') !~ '^[1-9][0-9]{0,8}$';
    if unknown is not null then raise exception 'a withdrawn card is refunded a positive whole number of hundredths: %', unknown using errcode = '22023'; end if;
    select string_agg(k.key, ', ' order by k.key) into unknown from card_kinds k
    where k.gone_at is not null and exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e where e ->> 'key' = k.key);
    if unknown is not null then
      raise exception '% already left the game and cannot be listed as a card again: a card that comes back takes a new key', unknown using errcode = '22023';
    end if;
  end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, its discipline, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface;
  -- Out of print (0401): the flag sets retired_at, kept while it stays and cleared when it goes.
  update card_kinds k set retired_at = case when coalesce((e.c ->> 'retired')::boolean, false) then coalesce(k.retired_at, now()) end
  from jsonb_array_elements(payload -> 'cards') e(c)
  where k.key = e.c ->> 'key' and k.retired_at is distinct from case when coalesce((e.c ->> 'retired')::boolean, false) then coalesce(k.retired_at, now()) end;
  -- Renamed and withdrawn (0401): each key not yet gone is moved by card_leaves, once ever, and its copies are counted for the answer.
  if retiring then
    for moving in
      select f.e ->> 'key' as old, f.e ->> 'became' as became, null::integer as refund from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) f(e) join card_kinds k on k.key = f.e ->> 'key' where k.gone_at is null
      union all
      select w.e ->> 'key', null, (w.e ->> 'refund')::integer from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w(e) join card_kinds k on k.key = w.e ->> 'key' where k.gone_at is null
      order by 1
    loop
      copies := card_leaves(moving.old, moving.became, moving.refund);
      if moving.became is not null then renamed := renamed || jsonb_build_object('from', moving.old, 'to', moving.became, 'copies', copies);
      else withdrawn_out := withdrawn_out || jsonb_build_object('key', moving.old, 'copies', copies, 'refunded', copies * moving.refund); end if;
    end loop;
  end if;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  -- A pack is a pull pack (its pulls and what it leaves out) or a fixed one (its cards in order, 0377); the table holds exactly one of the two.
  insert into pack_kinds (key, pulls, leaves, contents)
  select e ->> 'key', nullif(e -> 'pulls', 'null'), coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}'),
         case when jsonb_typeof(e -> 'contents') = 'array' then array(select jsonb_array_elements_text(e -> 'contents')) end
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves, contents = excluded.contents;
  -- A pack kind the payload does not list is out of print, one it lists is not (0401): its slot is left out of the machine, and a sealed pack of it still opens.
  if retiring then
    update pack_kinds k set retired_at = x.want
    from (select p.key, case when l.key is null then coalesce(p.retired_at, now()) end as want
          from pack_kinds p left join (select distinct e ->> 'key' as key from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e) l on l.key = p.key) x
    where x.key = k.key and k.retired_at is distinct from x.want;
  end if;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  if payload ? 'eventLines' then
    insert into event_lines (key, outcome, text) select e ->> 'key', e ->> 'outcome', e ->> 'text' from jsonb_array_elements(payload -> 'eventLines') e
    on conflict (key) do update set outcome = excluded.outcome, text = excluded.text;
    delete from event_lines l where not exists (select 1 from jsonb_array_elements(payload -> 'eventLines') e where e ->> 'key' = l.key);
  end if;
  -- The instance's trophy kinds (0206): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
  -- dropped removed unless an award names it. An admin-made kind is never touched, and an instance key that begins `made-` is refused (those are the admin page's).
  if payload ? 'trophies' then
    select string_agg(e ->> 'key', ', ') into unknown from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' like 'made-%';
    if unknown is not null then raise exception 'a trophy key begins "made-" only on the admin page: %', unknown using errcode = '22023'; end if;
    select string_agg(k, ', ') into unknown
    from (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]') || coalesce(payload -> 'trophies' -> 'boss', '[]')
                                           || case when payload -> 'trophies' ? 'demandMet' then jsonb_build_array(payload -> 'trophies' ->> 'demandMet') else '[]'::jsonb end) k) n
    where not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = n.k);
    if unknown is not null then raise exception 'the trophy catalog names kinds it does not define: %', unknown using errcode = '22023'; end if;
    -- The flags are cleared and set again, so that the unique indexes never see a place twice.
    update trophy_kinds set season_place = null, boss_gives = false, demand_met = false where made_by is null and (season_place is not null or boss_gives or demand_met);
    insert into trophy_kinds (key, name, line, belt) select e ->> 'key', e ->> 'name', nullif(e ->> 'line', ''), coalesce((e ->> 'belt')::boolean, false)
    from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e
    on conflict (key) do update set name = excluded.name, line = excluded.line, belt = excluded.belt;
    update trophy_kinds k set season_place = p.n::smallint
    from jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]')) with ordinality p(key, n) where k.key = p.key;
    update trophy_kinds k set boss_gives = true where k.key in (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'boss', '[]')));
    update trophy_kinds k set demand_met = true where k.key = payload -> 'trophies' ->> 'demandMet';
    delete from trophy_kinds k where k.made_by is null and not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = k.key)
      and not exists (select 1 from trophy_awards a where a.trophy = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The welcome pack's backfill (0377): every account with a character and no welcome pack yet gets one, when `startingPack` names a fixed pack. One insert with a semi-join to characters
  -- (characters_owner) and an anti-join to packs (packs_one_welcome), which writes nothing on a second seed; the unique index makes it once ever, so a seed racing a character's creation
  -- grants once, and an instance that changes `startingPack` later gives no second.
  insert into packs (account, pack, price, contents, source)
  select a.id, k.key, 0, k.contents, 'welcome'
  from pack_kinds k
  join accounts a on exists (select 1 from characters c where c.owner = a.id)
  where k.key = welcome_pack_kind()
    and not exists (select 1 from packs w where w.account = a.id and w.source = 'welcome')
  on conflict (account) where source = 'welcome' do nothing;
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
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
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
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, lasting, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false), coalesce((e ->> 'lasting')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, lasting = excluded.lasting, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The conditions that unlock a beat (0332), as the engine lists them (engine/system/conditions.ts). A reseed upserts; a condition is never removed, since a persona's arc may name it.
  insert into condition_kinds (key, plain)
  select e ->> 'key', e ->> 'plain' from jsonb_array_elements(coalesce(payload -> 'system' -> 'conditions', '[]')) e
  on conflict (key) do update set plain = excluded.plain;
  -- A persona's arc (0332): one row each, rewritten by a reseed. An arc naming a condition the catalog lacks is refused, naming it: the check that no beat waits on a condition nothing reads.
  unknown := (select string_agg(distinct c ->> 'kind', ', ')
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p, jsonb_array_elements(coalesce(p -> 'arc', '[]')) b, jsonb_array_elements(coalesce(b -> 'unlock', '[]')) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into persona_arcs (staff, beats, holds_back, phase_days)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  perform seed_setting('bossRoster', r.roster)
  from (select jsonb_agg(e.value ->> 'key' order by e.ord) as roster
        from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
        having count(*) > 0) r;
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
     and setting_thread('systemAnnouncements') is null then
    insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id into opened;
    perform seed_setting('systemAnnouncements', to_jsonb(opened::text));
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      perform seed_setting('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'));
    end if;
    if setting_thread('updatesThread') is null then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      perform seed_setting('updatesThread', to_jsonb(opened::text));
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  -- The anonymous poster (0357): a seed with an `anonymous` entry ({ name, title, avatar, pronouns }) makes the one stand-in, once, as it makes the developer: debuted at seed time, the tagline its profile title, the pronouns
  -- rewritten on every seed when the seed names them, the avatar's asset key the instance's to change. What an admin wrote is never written over. A seed with none makes none, and stand_in() is then null (land_refusal
  -- refuses a veil until one exists); seed.ts always sends one, the engine's own when the instance names none.
  if jsonb_typeof(payload -> 'anonymous') = 'object' then
    if payload -> 'anonymous' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'anonymous' -> 'pronouns')) then
      raise exception 'the anonymous poster has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'anonymous' ->> 'name', 'anonymous', 'anonymous', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'anonymous' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'anonymous' -> 'pronouns'), new_pronouns()) from made m;
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'anonymous' -> 'pronouns')
    from characters c
    where payload -> 'anonymous' ? 'pronouns' and c.staff = 'anonymous' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'anonymous' -> 'pronouns');
    if nullif(payload -> 'anonymous' ->> 'avatar', '') is not null then
      perform seed_setting('anonymousAvatar', to_jsonb(payload -> 'anonymous' ->> 'avatar'));
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards),
    'retired', (select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb) from card_kinds k where k.retired_at is not null), 'renamed', renamed, 'withdrawn', withdrawn_out);
end $function$;

-- ---- 4. acts_spring_payload ----


