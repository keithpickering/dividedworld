-- Springing on the conditions (supabase/migrations/0144_quote_conditions.sql, Task 5; docs/plans/2026-11-08-quote-conditions-plan.md, the design is
-- docs/plans/2026-11-08-quote-conditions-design.md, sections 5 and 6): a quote springs a Move only when the quoting post says its Says phrase, the quoted excerpt holds its Quotes passage and the
-- quoter is, or is not, among its Who. The spring names what matched (`when`) and the quoter for an Only list (`for`), never an Anyone but list. Every quote that meets a back does the same
-- work whatever the back holds: one walk, two probes and the Who check (spring_facts). The cards are this file's own (cq...), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 14)
$$;

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
  ('cqmove', 'Cq Move', 'salty', 'common', 'cast', null, '{post}', null),
  ('cqidle', 'Cq Idle', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}', '{post}', null);
insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values ('cqward', 'Cq Ward', 'sweet', 'uncommon', 'use', null, '{post}', interval '7 days', '{"kind": "ward", "upTo": "uncommon"}');

-- A back on a fresh post of `setter`'s, a quote of that post by `quoter` (the quoting post's words are `says`, then a real quote of the back's post holding `quoted`), and the call a quote makes.
-- Returns the spring's payload, or null when nothing sprang (and then checks nothing was written).
create function pg_temp.meet(setter_account uuid, setter uuid, in_thread uuid, quoter uuid, says text, quoted text,
                             phrase text default null, passage text default null, named uuid[] default null, but boolean default null, old boolean default false) returns jsonb language plpgsql as $$
declare
  p uuid := tests.post(setter, in_thread, 'The trapped post: the punchline, and zebra stripes.');
  the_set uuid;
  quoting uuid;
  made jsonb;
begin
  perform pg_temp.hand(setter_account, 'cqmove');
  if old then
    the_set := tests.act(setter, 'set', in_thread, '{}', p);
    insert into face_down (play, account, card, post, thread, round, ends_at) values (the_set, setter_account, 'cqmove', p, in_thread, 1, now() + interval '7 days');
  else
    the_set := (set_card(setter_account, 'cqmove', setter, p, '{}', 0, null, phrase, passage, named, but) ->> 'id')::uuid;
  end if;
  quoting := tests.post(quoter, in_thread, says || ' [quote=' || p || ']' || quoted || '[/quote]');
  made := spring_traps('quote', p, quoting);
  if made is null then
    if exists (select 1 from acts where kind = 'spring' and payload ->> 'set' = the_set::text) then raise exception 'a back that answered null had sprung'; end if;
    return null;
  end if;
  return (select s.payload from acts s where s.kind = 'spring' and s.payload ->> 'set' = the_set::text);
end $$;

do $$
declare
  ann uuid := tests.account('cq-ann'); bob uuid := tests.account('cq-bob');
  a uuid := tests.character(ann, 'Cq Ann'); a2 uuid := tests.character(ann, 'Cq Ann Two');
  b uuid := tests.character(bob, 'Cq Bob'); c uuid := tests.character(bob, 'Cq Cat'); d uuid := tests.character(bob, 'Cq Dee');
  t uuid := tests.thread('Springs');
  r jsonb;
  why text;
begin
  -- Says. The phrase is in the quoting post's own words (not in the quote it holds): it springs; without it, or with it only inside the quote, it does not.
  r := pg_temp.meet(ann, a, t, b, 'Nice try, friend.', 'the punchline', phrase => 'nice try');
  if r is null then raise exception 'Says: a quote saying the phrase did not spring'; end if;
  if r -> 'when' is distinct from '{"says": "nice try"}'::jsonb or r ? 'for' then raise exception 'Says: the spring names %', r; end if;
  if pg_temp.meet(ann, a, t, b, 'Hello there.', 'the punchline', phrase => 'nice try') is not null then raise exception 'Says: a quote without the phrase sprang'; end if;
  if pg_temp.meet(ann, a, t, b, 'Hello there.', 'nice try, said the quote', phrase => 'nice try') is not null then raise exception 'Says: the phrase inside the quote counted as the quoter''s own words'; end if;

  -- Quotes. The passage is in the excerpt of the quote of the trapped post: it springs; said outside the quote, or in no quote of it, it does not.
  r := pg_temp.meet(ann, a, t, b, 'Hello there.', 'Here is the punchline, ok', passage => 'the punchline');
  if r is null then raise exception 'Quotes: a quote of the passage did not spring'; end if;
  if r -> 'when' is distinct from '{"passage": "the punchline"}'::jsonb or r ? 'for' then raise exception 'Quotes: the spring names %', r; end if;
  if pg_temp.meet(ann, a, t, b, 'Hello there.', 'some other words', passage => 'the punchline') is not null then raise exception 'Quotes: a quote without the passage sprang'; end if;
  if pg_temp.meet(ann, a, t, b, 'The punchline, said aloud.', 'some other words', passage => 'the punchline') is not null then raise exception 'Quotes: the passage in the quoter''s own words sprang it'; end if;

  -- Who, Only these: a quoter on the list springs it and the spring names the quoter; another does not.
  r := pg_temp.meet(ann, a, t, b, 'Hello.', 'x', named => array[b, c], but => false);
  if r is null or r ->> 'for' is distinct from b::text or r ? 'when' then raise exception 'Only these: a listed quoter, spring %', r; end if;
  if pg_temp.meet(ann, a, t, d, 'Hello.', 'x', named => array[b, c], but => false) is not null then raise exception 'Only these: an unlisted quoter sprang it'; end if;
  -- Who, Anyone but these: an unlisted quoter springs it and nothing of the list or the quoter is written; a listed quoter does not.
  r := pg_temp.meet(ann, a, t, d, 'Hello.', 'x', named => array[b, c], but => true);
  if r is null then raise exception 'Anyone but: an unlisted quoter did not spring it'; end if;
  if r ? 'for' or r ? 'when' or r::text like '%' || b::text || '%' or r::text like '%' || c::text || '%' or r::text like '%who%' then raise exception 'Anyone but wrote its list or the quoter: %', r; end if;
  if pg_temp.meet(ann, a, t, b, 'Hello.', 'x', named => array[b, c], but => true) is not null then raise exception 'Anyone but: a listed quoter sprang it'; end if;
  -- The setter's own other mask on the list.
  if pg_temp.meet(ann, a, t, a2, 'Hello.', 'x', named => array[a2], but => false) is null then raise exception 'Only these: the setter''s other mask on the list did not spring it'; end if;

  -- Combinations: each condition must hold.
  r := pg_temp.meet(ann, a, t, b, 'Nice try!', 'the punchline', phrase => 'nice try', passage => 'the punchline');
  if r is null or r -> 'when' is distinct from '{"says": "nice try", "passage": "the punchline"}'::jsonb then raise exception 'Says and Quotes met: %', r; end if;
  if pg_temp.meet(ann, a, t, b, 'Hello.', 'the punchline', phrase => 'nice try', passage => 'the punchline') is not null then raise exception 'Says and Quotes: Says missing sprang'; end if;
  if pg_temp.meet(ann, a, t, b, 'Nice try!', 'another line', phrase => 'nice try', passage => 'the punchline') is not null then raise exception 'Says and Quotes: Quotes missing sprang'; end if;
  r := pg_temp.meet(ann, a, t, c, 'Nice try!', 'the punchline', phrase => 'nice try', passage => 'the punchline', named => array[c], but => false);
  if r is null or r ->> 'for' is distinct from c::text or r -> 'when' is distinct from '{"says": "nice try", "passage": "the punchline"}'::jsonb then raise exception 'all three met: %', r; end if;
  if pg_temp.meet(ann, a, t, d, 'Nice try!', 'the punchline', phrase => 'nice try', passage => 'the punchline', named => array[c], but => false) is not null then raise exception 'all three: Who missing sprang'; end if;
  if pg_temp.meet(ann, a, t, c, 'Nice try!', 'another line', phrase => 'nice try', passage => 'the punchline', named => array[c], but => false) is not null then raise exception 'all three: Quotes missing sprang'; end if;
  if pg_temp.meet(ann, a, t, c, 'Hello.', 'the punchline', phrase => 'nice try', passage => 'the punchline', named => array[c], but => false) is not null then raise exception 'all three: Says missing sprang'; end if;
  r := pg_temp.meet(ann, a, t, d, 'Nice try!', 'the punchline', phrase => 'nice try', named => array[b], but => true);
  if r is null or r ? 'for' or r -> 'when' is distinct from '{"says": "nice try"}'::jsonb then raise exception 'Says and Anyone but: %', r; end if;

  -- An old back, set with no condition (and a spring written before `when` and `for`), springs on any quote.
  r := pg_temp.meet(ann, a, t, b, 'Anything at all.', 'whatever', old => true);
  if r is null or r ? 'when' or r ? 'for' then raise exception 'an old back did not spring plainly: %', r; end if;
  -- A back set now with no condition is the same.
  r := pg_temp.meet(ann, a, t, b, 'Anything at all.', 'whatever');
  if r is null or r ? 'when' or r ? 'for' then raise exception 'a back with no condition did not spring plainly: %', r; end if;

  -- The payload check: `when` and `for` are optional and shaped.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (%L, 'spring', %L, %L)$s$, a, t,
    jsonb_build_object('card', 'cqmove', 'trigger', 'quote', 'did', 'landed', 'set', gen_random_uuid()::text, 'by', gen_random_uuid()::text, 'when', '"nice try"'::jsonb)));
  if why is null then raise exception 'a spring whose when is not an object was accepted'; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (%L, 'spring', %L, %L)$s$, a, t,
    jsonb_build_object('card', 'cqmove', 'trigger', 'quote', 'did', 'landed', 'set', gen_random_uuid()::text, 'by', gen_random_uuid()::text, 'when', jsonb_build_object('who', 'x'))));
  if why is null then raise exception 'a spring whose when holds another key was accepted'; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (%L, 'spring', %L, %L)$s$, a, t,
    jsonb_build_object('card', 'cqmove', 'trigger', 'quote', 'did', 'landed', 'set', gen_random_uuid()::text, 'by', gen_random_uuid()::text, 'for', 5)));
  if why is null then raise exception 'a spring whose for is not a string was accepted'; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (%L, 'spring', %L, %L)$s$, a, t,
    jsonb_build_object('card', 'cqmove', 'trigger', 'quote', 'did', 'landed', 'set', gen_random_uuid()::text, 'by', gen_random_uuid()::text, 'for', b::text, 'when', jsonb_build_object('says', 'x'), 'extra', 1)));
  if why is null then raise exception 'a spring with another key was accepted'; end if;
end $$;

-- ---- Every back costs the same reads and the same walk before its decision, whatever it holds ----
-- Reads, as 0135-face-down-moves.sql counts them: rows fetched and index entries returned in this transaction so far, per table and its indexes, compared as vectors.
create function pg_temp.reads() returns bigint[] language sql as $$
  select array_agg(x.n order by x.relname) from (
    select t.relname, sum(pg_stat_get_xact_tuples_fetched(o.oid) + pg_stat_get_xact_tuples_returned(o.oid))::bigint as n
    from pg_class t cross join lateral (select t.oid union all select i.indexrelid from pg_index i where i.indrelid = t.oid) o(oid)
    where t.relname in ('characters', 'card_kinds', 'acts', 'face_down', 'play_reach', 'threads', 'settings') and t.relnamespace = 'public'::regnamespace
    group by t.relname) x
$$;
create function pg_temp.since(before bigint[]) returns text language sql as $$
  select array_agg(n.v - before[n.i] order by n.i)::text from unnest(pg_temp.reads()) with ordinality n(v, i)
$$;
-- The calls of a function made in this transaction so far (track_functions = all).
create function pg_temp.calls(f regprocedure) returns bigint language sql as $$ select coalesce(pg_stat_get_xact_function_calls(f::oid), 0) $$;

do $$
declare
  ann uuid := tests.account('cq-even-ann'); bob uuid := tests.account('cq-even-bob');
  s uuid := tests.character(ann, 'Even Setter'); q uuid := tests.character(bob, 'Even Quoter'); other uuid := tests.character(bob, 'Even Other');
  t uuid := tests.thread('Even work');
  labels text[] := array['idle', 'none', 'says unmet', 'says met', 'quotes unmet', 'quotes met', 'only unmet', 'only met', 'anyone-but unmet', 'anyone-but met', 'all met'];
  springs boolean[] := array[false, true, false, true, false, true, false, true, false, true, true];
  posts uuid[] := '{}'; p uuid; quoting uuid; free uuid; body text;
  fd face_down; one uuid; i integer; n integer;
  before bigint[]; b_walk bigint; b_probe bigint; b_norm bigint;
  facts_reads text[] := '{}'; full_reads text[] := '{}'; walks bigint[] := '{}'; probes bigint[] := '{}'; norms bigint[] := '{}';
  said jsonb; the_spring jsonb;
begin
  perform set_config('track_functions', 'all', true);
  perform set_config('enable_seqscan', 'off', true);
  discard plans;
  perform pg_temp.hand(ann, 'cqmove', 'cqidle');
  for i in 1 .. array_length(labels, 1) loop
    p := tests.post(s, t, 'Trapped ' || i || ': the punchline, and zebra stripes.');
    posts := posts || p;
    perform case i
      when 1 then set_card(ann, 'cqidle', s, p, '{}', 0)
      when 2 then set_card(ann, 'cqmove', s, p, '{}', 0)
      when 3 then set_card(ann, 'cqmove', s, p, '{}', 0, null, 'zebra')
      when 4 then set_card(ann, 'cqmove', s, p, '{}', 0, null, 'nice try')
      when 5 then set_card(ann, 'cqmove', s, p, '{}', 0, null, null, 'zebra')
      when 6 then set_card(ann, 'cqmove', s, p, '{}', 0, null, null, 'the punchline')
      when 7 then set_card(ann, 'cqmove', s, p, '{}', 0, null, null, null, array[other], false)
      when 8 then set_card(ann, 'cqmove', s, p, '{}', 0, null, null, null, array[q], false)
      when 9 then set_card(ann, 'cqmove', s, p, '{}', 0, null, null, null, array[q], true)
      when 10 then set_card(ann, 'cqmove', s, p, '{}', 0, null, null, null, array[other], true)
      else set_card(ann, 'cqmove', s, p, '{}', 0, null, 'nice try', 'the punchline', array[q], false) end;
  end loop;
  -- The quoting post says "nice try" and quotes each trapped post with "the punchline"; it is warded, so the Moves that would spring cannot land through it.
  body := 'Nice try! ' || (select string_agg('[quote=' || x || ']the punchline[/quote]', ' ') from unnest(posts) x);
  quoting := tests.post(q, t, body);
  update characters set debuted_at = debuted_at where id = s;
  perform tests.act(q, 'card', t, jsonb_build_object('card', 'cqward', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), quoting);

  -- Warm: each statement planned, so a call's reads are its execution's alone.
  for n in 1 .. 8 loop
    foreach one in array posts loop
      select * into fd from face_down f where f.post = one;
      perform spring_facts(fd, 'quote', quoting, null);
    end loop;
  end loop;

  -- The reads and the calls of the facts, for each back: the same for every one, the walk once, and a probe for each condition whatever the back holds.
  foreach one in array posts loop
    select * into fd from face_down f where f.post = one;
    before := pg_temp.reads();
    b_walk := pg_temp.calls('bbcode_walk(text, uuid)'::regprocedure); b_probe := pg_temp.calls('phrase_probe(text, text, text)'::regprocedure); b_norm := pg_temp.calls('phrase_norm(text)'::regprocedure);
    perform spring_facts(fd, 'quote', quoting, null);
    facts_reads := facts_reads || pg_temp.since(before);
    walks := walks || (pg_temp.calls('bbcode_walk(text, uuid)'::regprocedure) - b_walk);
    probes := probes || (pg_temp.calls('phrase_probe(text, text, text)'::regprocedure) - b_probe);
    norms := norms || (pg_temp.calls('phrase_norm(text)'::regprocedure) - b_norm);
  end loop;
  if (select count(distinct r) from unnest(facts_reads) r) is distinct from 1::bigint then raise exception 'the backs make different reads before a quote''s decision: % = %', labels, facts_reads; end if;
  if (select sum(v) from unnest(facts_reads[1]::bigint[]) v) < 8 then raise exception 'the reads were not counted (%)', facts_reads[1]; end if;
  if walks <> array_fill(1::bigint, array[array_length(labels, 1)]) then raise exception 'a back did not make exactly one walk of the quoting post: % = %', labels, walks; end if;
  if (select count(distinct x) from unnest(probes) x) is distinct from 1::bigint or probes[1] < 2 then raise exception 'the backs make different probes before a quote''s decision: % = %', labels, probes; end if;
  -- The text is normalized twice for every back (once for each probe, whatever it holds); a back with a phrase or a passage also normalizes that one (phrase_probe's header: bounded by the 100-character
  -- phrase, never by the text), twice each, by the matcher's own work.
  if norms <> array[2, 2, 4, 4, 4, 4, 2, 2, 2, 2, 6]::bigint[] then raise exception 'the backs normalize more than the text twice and what they hold: % = %', labels, norms; end if;

  -- The whole call: through the Ward no back lands, so those met and those not all answer null, write nothing and read alike.
  for n in 1 .. 8 loop
    foreach one in array posts loop perform spring_traps('quote', one, quoting); end loop;
  end loop;
  foreach one in array posts loop
    before := pg_temp.reads(); said := spring_traps('quote', one, quoting); full_reads := full_reads || pg_temp.since(before);
    if said is not null then raise exception 'a back sprang through a Ward: %', said; end if;
  end loop;
  if exists (select 1 from acts where kind = 'spring' and target_act_id = any (posts)) then raise exception 'a back that cannot land wrote a spring'; end if;
  if (select count(distinct r) from unnest(full_reads) r) is distinct from 1::bigint then raise exception 'the backs read differently through a Ward: % = %', labels, full_reads; end if;

  -- Unwarded, a back springs exactly where its conditions are met, and the spring names them.
  for i in 1 .. array_length(labels, 1) loop
    free := tests.post(q, t, body);
    said := spring_traps('quote', posts[i], free);
    if springs[i] is distinct from (said is not null) then raise exception 'back % (%): sprang or not wrongly: %', i, labels[i], said; end if;
  end loop;
  select s2.payload into the_spring from acts s2 where s2.kind = 'spring' and s2.target_act_id = posts[11];
  if the_spring -> 'when' is distinct from '{"says": "nice try", "passage": "the punchline"}'::jsonb or the_spring ->> 'for' is distinct from q::text then raise exception 'the spring does not name its conditions: %', the_spring; end if;
  select s2.payload into the_spring from acts s2 where s2.kind = 'spring' and s2.target_act_id = posts[10];
  if the_spring ? 'for' or the_spring ? 'when' or the_spring::text like '%' || other::text || '%' then raise exception 'an Anyone but spring wrote its list: %', the_spring; end if;
  perform set_config('enable_seqscan', 'on', true);
  perform set_config('track_functions', 'none', true);
end $$;
