-- A card that writes: its queue, its texts and its refund (the plan for the card that writes, Task 4; its design
-- sections 3, 4, 6, 12, 14 and 15).
--
-- A card kind whose `writes` is true has a text made for it after it lands, by the server, once for each version of the post it is on.
-- The SQL knows nothing of which card that is, only `card_kinds.writes`, which seed_instance sets from the card's rules.
--
--   card_texts          what was made, one row for each (play, version): a text, or the predicate that failed. Append-only, as play_moments is.
--   card_writes         the queue, a job and not an Act: one row for each play, the newest version only (primary key `play`). A newer version
--                       replaces the waiting one, so a run of edits makes one call for each play and not one for each edit (design, section 15).
--   card_write_refunds  the end of a play whose first generation failed, once for each play (the primary key), as appeal_refunds is: the refund
--                       paid (the amount that actually moved; 0 for a play that cost nothing) or, for a play nobody paid for (a Mod Bot's), a row
--                       with no amount. A play with a row is over (below).
--
-- A refunded play is over (card_ended, below, says so wherever "in force" is read): an edit queues nothing for it, no claim returns it, a job
-- that races in with the refund is deleted by it and dropped by the claim, it is no earlier play in a tail's chain, and a post's stack
-- of plays does not count it, so a failed cast never uses up one of a post's places. Its way out is the card, back in the caster's hand to cast
-- again; a Mod Bot's play has no hand and simply ends. post_tails keeps its failed row, which a reader draws nothing for.
--
-- A regeneration waits for the editing to settle: a job an edit queues is claimable only `Settings.cardWriteSettleSeconds` after the post's
-- last edit (`not_before`, pushed out by each further edit), and the first generation after a cast is claimable at once.
--
-- The enqueue is a trigger on acts, so every path that writes a play or an edit is covered without being edited. An edit Act on a post with
-- no writing play costs one probe of the post's layers (live_writing_plays, through the index acts_layers, 0072) and writes nothing.
-- "A live writing play" is the codebase's own "in force": a card Act on the post's own reach, not caught by a trap, not worn off, and not
-- ended by an admin (card_ended, 0092).
--
-- The worker (supabase/functions/write) claims jobs with claim_card_writes, oldest first, and finishes each with finish_card_write. The chain
-- (design, section 6): a play's job is not claimed while an earlier play on the same post still has a job, so a later tail is made from the
-- text before it. A job whose earlier play keeps failing is never stranded: claim_card_writes counts each claim in `attempts` and returns it,
-- the worker finishes a job past its third as `unreachable`, and a finish deletes the job, which frees the next one.
--
-- The masks (design, section 12): nothing here reads who owns a post, a play or a character. A job, a claim, a finish, the broadcast (the
-- play and the version alone) and post_tails depend only on public facts, and answer every caller alike. A refund reads the payer from the
-- wallet and the hand, which are the caster's own and show nowhere else; the public sees only that the tail did not come.
--
-- A busy instance (design, section 15): a job exists only for a play still waiting, a claim is a batch with an index probe for each job, and
-- the queue is read by its primary key, its post and its age. Tails are read for a page of posts at once (post_tails(uuid[])).

-- -------------------------------------------------------------------------------------------------------- the catalog ----

alter table card_kinds add column writes boolean not null default false;

-- Whether the instance runs its old voice (Settings.oldVoice): a missing setting reads as off, so a database seeded before it never offers a
-- card that writes.
create function old_voice_on() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'oldVoice'), false)
$$;

-- The refusal of a card that writes where the instance has no old voice, in the words the engine's decidePlay says (OLD_VOICE_OFF,
-- engine/rules/cards.ts). Called before anything is spent.
create function require_old_voice(card text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from card_kinds k where k.key = require_old_voice.card and k.writes) and not old_voice_on() then
    raise exception 'The old voice isn''t running on this forum, so this card can''t be played.' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------------------- tables ----

create table card_texts (
  id bigint generated always as identity primary key,
  play uuid not null references acts (id),
  -- The post's own Act or an edit of it: the version of the post the text continues.
  version uuid not null references acts (id),
  text text check (char_length(text) between 1 and 4000),
  -- The predicate that failed (`unreachable`, `scrub:<predicate>`, `nonEmpty`): for the ledger and the caster's log, never shown to a reader.
  failed text check (char_length(failed) between 1 and 200),
  -- The model call that made it. No foreign key: the ledger is the instance's own bookkeeping and a test truncates it, as it does for a call a failure never recorded.
  call bigint,
  created_at timestamptz not null default clock_timestamp(),
  unique (play, version),
  check ((text is null) <> (failed is null))
);

create table card_writes (
  play uuid primary key references acts (id),
  post uuid not null references acts (id),
  version uuid not null references acts (id),
  queued_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_until timestamptz,
  -- Claimable from here: now for a cast, the settle wait after the last edit for an edit.
  not_before timestamptz not null default now()
);
-- The chain's probe (an earlier play on the post with a job) and a kick's claim for one post.
create index card_writes_post on card_writes (post);
-- The claim reads jobs oldest first.
create index card_writes_queue on card_writes (queued_at, play);

create table card_write_refunds (
  play uuid primary key references acts (id),
  -- What moved back into the payer's wallet (the cap may clamp a refund; 0 for a play that cost nothing); null for a play with no payer.
  amount integer check (amount is null or amount >= 0),
  at timestamptz not null default now()
);

create function card_texts_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a card''s text is never edited; every generation is a row of its own' using errcode = '55000';
end $$;
create trigger card_texts_no_update before update or delete on card_texts for each row execute function card_texts_append_only();
create trigger card_texts_no_truncate before truncate on card_texts for each statement execute function card_texts_append_only();
-- The truncate guard fires on a restore too, as play_moments' does.
alter table card_texts enable always trigger card_texts_no_truncate;
revoke execute on function card_texts_append_only() from public, anon, authenticated;

-- The server's alone: no direct grant. A reader gets tails through post_tails; the worker and the refund through the functions below.
alter table card_texts enable row level security;
alter table card_writes enable row level security;
alter table card_write_refunds enable row level security;
revoke all on card_texts, card_writes, card_write_refunds from public, anon, authenticated;

-- The refund finds its payer by the play: no index led by either column before.
create index wallet_events_play on wallet_events (ref) where kind = 'play';
create index card_ledger_play on card_ledger (act) where kind = 'played';

-- ----------------------------------------------------------------------------------------------------------- the model ----

-- The card play a call was made for (a card that writes), beside the meeting a call can name.
alter table model_calls add column play uuid references acts (id);
create index model_calls_play on model_calls (play) where play is not null;

-- record_model_call (0042), writing `play` from the payload too.
create or replace function record_model_call(payload jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made bigint;
begin
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'a model call is recorded from an object' using errcode = '22023'; end if;
  if payload ->> 'outcome' is null or payload ->> 'outcome' not in ('ok', 'rejected', 'failed') then
    raise exception 'a model call ends ok, rejected or failed, not %', coalesce(payload ->> 'outcome', 'nothing') using errcode = '22023';
  end if;
  insert into model_calls (duty, staff, provider, model, service_tier, input_tokens, output_tokens, cache_read_tokens,
    cache_write_5m_tokens, cache_write_1h_tokens, gpu_seconds, cost_microdollars, outcome, predicate, trims, retries, meeting, play)
  values (payload ->> 'duty', payload ->> 'staff', payload ->> 'provider', payload ->> 'model', payload ->> 'service_tier',
    (payload ->> 'input_tokens')::integer, (payload ->> 'output_tokens')::integer, (payload ->> 'cache_read_tokens')::integer,
    (payload ->> 'cache_write_5m_tokens')::integer, (payload ->> 'cache_write_1h_tokens')::integer, (payload ->> 'gpu_seconds')::numeric,
    (payload ->> 'cost_microdollars')::bigint, payload ->> 'outcome', payload ->> 'predicate', coalesce(payload -> 'trims', '[]'::jsonb),
    coalesce((payload ->> 'retries')::integer, 0), (payload ->> 'meeting')::bigint, (payload ->> 'play')::uuid)
  returning id into made;
  return made;
end $$;

-- ----------------------------------------------------------------------------------------------------------- the queue ----

-- card_ended (0092), also true for a play whose write failed and was refunded (or, with no payer, ended): that play is over, so every reader of
-- "in force" (the stack a post carries, the effects, the edit's probe below) leaves it out. One more probe of the refunds' primary key.
create or replace function card_ended(play uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = card_ended.play)
      or exists (select 1 from card_write_refunds r where r.play = card_ended.play)
$$;

-- The live writing plays on a post: the one probe an edit makes. It reads the post's layers through acts_layers (0072) and joins the card by
-- its key. Not security definer and with no `set`, so a caller's plan can inline it; every name is qualified, and its callers pin their own
-- search_path.
create function live_writing_plays(post uuid) returns setof uuid
language sql stable as $$
  select k.id
  from public.acts k join public.card_kinds ck on ck.key = k.payload ->> 'card'
  where k.kind = 'card' and k.target_act_id = live_writing_plays.post
    and coalesce(k.payload ->> 'reach', 'post') = 'post' and ck.writes
    and not (k.payload ? 'caught') and (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now())
    and not public.card_ended(k.id)
$$;
revoke execute on function live_writing_plays(uuid) from public, anon, authenticated;

-- A play of a writing card queues its job at the post's current version; an edit queues every live writing play on the post again at the edit,
-- which replaces a waiting job (newest only) and resets its attempts. A cast's job is claimable at once; an edit's only after the settle wait
-- from this edit, so a run of edits is waited out and a play's job is made for the version the editing stopped at.
create function card_writes_enqueue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  settle integer := coalesce(((select s.value from settings s where s.key = 'cardWriteSettleSeconds') #>> '{}')::integer, 30);
begin
  if new.kind = 'card' then
    if coalesce(new.payload ->> 'reach', 'post') = 'post' and not (new.payload ? 'caught')
       and exists (select 1 from card_kinds k where k.key = new.payload ->> 'card' and k.writes) then
      insert into card_writes (play, post, version, not_before) values (new.id, new.target_act_id, post_version(new.target_act_id), clock_timestamp());
    end if;
  else
    insert into card_writes (play, post, version, not_before)
    select p, new.target_act_id, new.id, clock_timestamp() + make_interval(secs => settle) from live_writing_plays(new.target_act_id) p
    on conflict (play) do update set version = excluded.version, queued_at = clock_timestamp(), attempts = 0, claimed_until = null, not_before = excluded.not_before;
  end if;
  return null;
end $$;
revoke execute on function card_writes_enqueue() from public, anon, authenticated;
create trigger acts_card_writes after insert on acts for each row
  when (new.kind in ('card', 'edit') and new.target_act_id is not null) execute function card_writes_enqueue();

-- Takes up to `most` jobs, oldest first, whose claim has run out, skipping any whose post has an earlier writing play with a job still
-- waiting, and holds each for five minutes (a model call may take four, and the worker runs no more jobs at once than it claims) and counts the
-- attempt. A job is taken only once its `not_before` has passed (an edit's settle wait), but a later play's job still waits behind an earlier play's
-- job while that one settles. `only_post` takes that post's jobs alone (the kick after a play or an edit),
-- under the same row locks, so a kick and a sweep never take one job. A job takes the post's version as it stands at the claim. The jobs of plays an
-- admin has ended, or whose write was refunded, are let go first. Each job carries the frame's inputs: the post's author's name and words, the thread's title, the public
-- posts before it (`pool.chatterThreadPosts` of them), and the earlier plays' texts for this version (the latest text of one that failed).
create function claim_card_writes(most integer, only_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  nearby integer := coalesce((((select s.value from settings s where s.key = 'pool') ->> 'chatterThreadPosts'))::integer, 8);
  claimed jsonb;
begin
  delete from card_writes w where w.play in (
    select x.play from card_writes x where card_ended(x.play) and (claim_card_writes.only_post is null or x.post = claim_card_writes.only_post) for update skip locked);
  with picked as materialized (
    select c.play from card_writes c join acts a on a.id = c.play
    where (c.claimed_until is null or c.claimed_until < clock_timestamp()) and c.not_before <= clock_timestamp() and not card_ended(c.play)
      and (claim_card_writes.only_post is null or c.post = claim_card_writes.only_post)
      and not exists (select 1 from card_writes e join acts ea on ea.id = e.play
                      where e.post = c.post and e.play <> c.play and not card_ended(e.play) and (ea.created_at, ea.id) < (a.created_at, a.id))
    order by c.queued_at, c.play limit greatest(claim_card_writes.most, 0) for update of c skip locked
  ), taken as (
    update card_writes w set claimed_until = clock_timestamp() + interval '5 minutes', attempts = w.attempts + 1, version = post_version(w.post)
    from picked where w.play = picked.play
    returning w.play, w.post, w.version, w.attempts, w.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'play', t.play, 'version', t.version, 'post', t.post, 'thread', pa.thread, 'attempts', t.attempts,
      'card', pl.payload ->> 'card', 'config', coalesce(pl.payload -> 'config', '{}'::jsonb),
      'author', ch.name, 'body', coalesce(v.payload ->> 'body', ''), 'title', th.title,
      'before', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'body', x.body) order by x.seq), '[]'::jsonb)
                 from (select n.seq, cn.name, coalesce(n.current_payload ->> 'body', '') as body
                       from acts_public n join characters_public cn on cn.id = n.character
                       where n.thread = pa.thread and n.kind = 'post' and n.seq < pa.seq
                       order by n.seq desc limit greatest(nearby, 0)) x),
      'earlier', (select coalesce(jsonb_agg(jsonb_build_object('play', q.id, 'text', q.text) order by q.created_at, q.id), '[]'::jsonb)
                  from (select ea.id, ea.created_at,
                          coalesce((select x.text from card_texts x where x.play = ea.id and x.version = t.version and x.text is not null),
                                   (select x.text from card_texts x where x.play = ea.id and x.text is not null order by x.created_at desc, x.id desc limit 1)) as text
                        from live_writing_plays(t.post) lp join acts ea on ea.id = lp
                        where (ea.created_at, ea.id) < (pl.created_at, pl.id)) q
                  where q.text is not null)
    ) order by t.queued_at, t.play), '[]'::jsonb) into claimed
  from taken t
  join acts pl on pl.id = t.play
  join acts pa on pa.id = t.post
  join characters ch on ch.id = pa.character
  join threads th on th.id = pa.thread
  join acts v on v.id = t.version;
  return claimed;
end $$;

-- ------------------------------------------------------------------------------------------------------ finish, refund ----

-- The refund of a failed write (the pattern of refund_appeal, 0109): under an advisory lock for the play, once (card_write_refunds' primary
-- key), the payer read from the hand's `played` row and the amount from the play's own wallet event, the wallet moved as a `refund`, and the
-- card returned to the hand as a `returned` ledger row naming the play. The amount recorded is what the wallet actually moved (its cap may
-- clamp it). A play that already has a text refunds nothing and is not over. A play with no payer (a Mod Bot's) refunds nothing and returns
-- nothing, but is over all the same: its row has no amount. Either way the play's job goes with the refund.
create function refund_card_write(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k acts%rowtype;
  payer record;
  paid integer;
  moved integer := 0;
begin
  select * into k from acts a where a.id = refund_card_write.play and a.kind = 'card';
  if not found then raise exception 'there is no such card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.card_write.' || k.id::text, 0));
  if exists (select 1 from card_write_refunds r where r.play = k.id) then return jsonb_build_object('refunded', false, 'already', true); end if;
  if exists (select 1 from card_texts x where x.play = k.id and x.text is not null) then return jsonb_build_object('refunded', false, 'kept', true); end if;
  select l.account, l.card into payer from card_ledger l where l.kind = 'played' and l.act = k.id;
  if payer.account is null then
    insert into card_write_refunds (play, amount) values (k.id, null);
    delete from card_writes w where w.play = k.id;
    return jsonb_build_object('refunded', false, 'payer', false, 'over', true);
  end if;
  select coalesce(-sum(w.change), 0)::integer into paid from wallet_events w where w.kind = 'play' and w.ref = k.id and w.account = payer.account;
  if paid > 0 then
    perform wallet_move(payer.account, paid, 'refund', null, k.id);
    select e.change into moved from wallet_events e where e.kind = 'refund' and e.ref = k.id and e.account = payer.account order by e.id desc limit 1;
  end if;
  insert into card_write_refunds (play, amount) values (k.id, moved);
  delete from card_writes w where w.play = k.id;
  insert into card_ledger (account, card, kind, act, price) values (payer.account, payer.card, 'returned', k.id, moved);
  return jsonb_build_object('refunded', true, 'amount', moved);
end $$;

-- Writes the row the worker made (a text, or the predicate that failed) and clears the job if it is still the version queued; a job a newer
-- version replaced stays, and the row is kept for History. The thread is told through the outbox, in words of the play and the version alone.
-- A failure refunds, unless a newer job still waits for the play (that one decides), or the play already has a text. A second finish of one
-- version writes nothing, tells nothing and refunds nothing.
create function finish_card_write(play uuid, version uuid, text text, failed text, call bigint default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k acts%rowtype;
  made bigint;
  refund jsonb := null;
begin
  if (finish_card_write.text is null) = (finish_card_write.failed is null) then
    raise exception 'a finish is a text or a failure, one of the two' using errcode = '22023';
  end if;
  select * into k from acts a where a.id = finish_card_write.play and a.kind = 'card';
  if not found then raise exception 'there is no such card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if finish_card_write.version is distinct from k.target_act_id and not exists (
       select 1 from acts e where e.id = finish_card_write.version and e.kind = 'edit' and e.target_act_id = k.target_act_id) then
    raise exception 'that is no version of the play''s post' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.card_write.' || k.id::text, 0));
  -- A play that is over (its write failed and was refunded) makes no text: a late finish, a second worker after a reclaim, writes nothing.
  if exists (select 1 from card_write_refunds r where r.play = k.id) then return jsonb_build_object('written', false, 'refund', null, 'over', true); end if;
  insert into card_texts (play, version, text, failed, call)
  values (k.id, finish_card_write.version, finish_card_write.text, finish_card_write.failed, finish_card_write.call)
  on conflict on constraint card_texts_play_version_key do nothing returning id into made;
  delete from card_writes w where w.play = k.id and w.version = finish_card_write.version;
  if made is not null then
    insert into broadcasts_due (topic, event, payload)
    values ('thread:' || k.thread, 'card_text', jsonb_build_object('play', k.id, 'version', finish_card_write.version));
    if finish_card_write.failed is not null and not exists (select 1 from card_writes w where w.play = k.id) then
      refund := refund_card_write(k.id);
    end if;
  end if;
  return jsonb_build_object('written', made is not null, 'refund', refund);
end $$;

-- ------------------------------------------------------------------------------------------------------------- the read ----

-- The tails of a page of posts, as one read, in version order then play order: every row of every writing play on them, and each job still
-- waiting for a version that has no row yet (`waiting`). `failed` is a flag and never the predicate, and `text` is null where it failed. Public
-- per post: nothing here reads the caller, so it is the same to every signed-in player, as effect_state (0006) is. (No board is restricted
-- from reading, 0060, so the read rule for a post is the same as for its effect state.)
create function post_tails(posts uuid[]) returns table (post uuid, play uuid, version uuid, text text, failed boolean, waiting boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if cardinality(posts) > 200 then raise exception 'tails are read for at most 200 posts at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return query
  select r.post, r.play, r.version, r.text, r.failed, r.waiting, r.at
  from (
    select u.id as post, k.id as play, x.version, x.text, (x.failed is not null) as failed, false as waiting, x.created_at as at, u.ord, kv.created_at as vat, k.created_at as pat
    from unnest(posts) with ordinality u(id, ord)
    join acts k on k.target_act_id = u.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
    join card_kinds ck on ck.key = k.payload ->> 'card' and ck.writes
    join card_texts x on x.play = k.id
    join acts kv on kv.id = x.version
    union all
    select w.post, w.play, w.version, null::text, false, true, null::timestamptz, u.ord, kv.created_at, k.created_at
    from unnest(posts) with ordinality u(id, ord)
    join card_writes w on w.post = u.id
    join acts k on k.id = w.play
    join acts kv on kv.id = w.version
    where not exists (select 1 from card_texts x where x.play = w.play and x.version = w.version) and not card_ended(w.play)
  ) r
  order by r.ord, r.vat, r.pat, r.play;
end $$;

-- ------------------------------------------------------------------------------------------------------------- the hand ----

alter table card_ledger drop constraint card_ledger_kind_check;
alter table card_ledger add constraint card_ledger_kind_check check (kind in ('bought', 'played', 'pulled', 'caught', 'returned'));
-- A returned card names its play, as a played and a caught card name theirs.
alter table card_ledger drop constraint card_ledger_check;
alter table card_ledger add constraint card_ledger_check check ((kind in ('played', 'caught', 'returned')) = (act is not null));

-- card_held (0142), counting `returned` as it counts bought, pulled and caught.
create or replace function card_held(who uuid, card text) returns integer
language sql stable set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'pulled', 'caught', 'returned')) - count(*) filter (where l.kind = 'played'))::integer
  from card_ledger l where l.account = card_held.who and l.card = card_held.card
$$;

-- ----------------------------------------------------------------------------------------------- the refusals, the roll ----

-- play_card (0139), refusing a card that writes where the instance has no old voice. Everything else as 0139 wrote it.
CREATE OR REPLACE FUNCTION public.play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text DEFAULT ''::text, reach text DEFAULT 'post'::text, from_post uuid DEFAULT NULL::uuid)
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
begin
  perform played_by(through, who);
  perform not_banned(through);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform require_old_voice(card);
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  held := card_held(who, play_card.card);
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  played := place_cast(through, card, target, config, said, reach, from_post, who, price);
  written := (played ->> 'id')::uuid;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return played;
end $function$;

-- staff_play_card (0086), refusing it too, so a persona's play of a card that writes is turned away as a player's is.
create or replace function staff_play_card(staff_key text, card text, target uuid, config jsonb default '{}', message text default '', pool_day date default null) returns jsonb
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
  perform require_old_voice(staff_play_card.card);
  -- Refused when the setting cannot be read as a rarity either, so a broken setting plays no card.
  if not coalesce(rarity_rank(kind_of.rarity) <= rarity_rank(setting('pool') #>> '{cardRarityMost}'), false) then
    raise exception '% is above the rarity the pool plays', kind_of.name using errcode = '55000';
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  played := place_cast(who, card, target, coalesce(config, '{}'), coalesce(message, ''), 'post', null, null, 0,
    case when pool_day is null then '{}'::jsonb else jsonb_build_object('pool', pool_day::text) end);
  perform set_config('kayfabb.staff_writer', flag, true);
  return played;
end $$;

-- buy_card (0140), refusing a card that writes where the instance has no old voice, before the wallet is touched.
create or replace function buy_card(who uuid, slot uuid, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_now;
  left_over integer;
begin
  seen := slot_for_sale(slot, 'card', price);
  perform require_old_voice(seen.card);
  left_over := wallet_spend(who, seen.price, 'purchase', null);
  insert into card_ledger (account, card, kind, price, repriced) values (who, seen.card, 'bought', seen.price, coalesce(seen.move ->> 'kind' = 'repriceSlot' and seen.price is distinct from (seen.move ->> 'was')::integer, false));
  return jsonb_build_object('card', seen.card, 'balance', left_over, 'held', card_held(who, seen.card));
end $$;

-- roll_pack (0139): a card that writes is never eligible where the instance has no old voice, and a rarity with no eligible card is not rolled
-- (the engine's rollPack and packOdds, engine/rules/packs.ts, agree): the weights are those of the rarities that have a card to give, and a
-- pull with none is refused in words naming the rarities it weighed.
create or replace function roll_pack(pulls jsonb, leaves text[]) returns text[]
language plpgsql set search_path = public, pg_temp as $$
declare
  pull jsonb;
  total numeric;
  r numeric;
  upto numeric;
  w record;
  picked_rarity text;
  eligible integer;
  picked text;
  got text[] := '{}';
  voice boolean := old_voice_on();
begin
  for pull in select e.pull from jsonb_array_elements(pulls) with ordinality e(pull, i) order by e.i loop
    select sum((x.value #>> '{}')::numeric) into total from jsonb_each(pull -> 'weights') x
    where (x.value #>> '{}')::numeric > 0 and exists (select 1 from card_kinds k where k.rarity = x.key and k.key <> all (leaves) and (voice or not k.writes));
    if total is null then
      raise exception 'this pack has no % card to give', (select string_agg(x.key, ', ' order by x.key) from jsonb_each(pull -> 'weights') x) using hint = 'kayfabb.refusal', errcode = 'P0001';
    end if;
    r := random() * total;
    upto := 0;
    picked_rarity := null;
    for w in select x.key, (x.value #>> '{}')::numeric as weight from jsonb_each(pull -> 'weights') x
             where (x.value #>> '{}')::numeric > 0 and exists (select 1 from card_kinds k where k.rarity = x.key and k.key <> all (leaves) and (voice or not k.writes))
             order by x.key loop
      upto := upto + w.weight;
      if r < upto then picked_rarity := w.key; exit; end if;
    end loop;
    select count(*) into eligible from card_kinds k where k.rarity = picked_rarity and k.key <> all (leaves) and (voice or not k.writes);
    select k.key into picked from card_kinds k where k.rarity = picked_rarity and k.key <> all (leaves) and (voice or not k.writes) order by k.key offset floor(random() * eligible)::integer limit 1;
    got := got || picked;
  end loop;
  return got;
end $$;

-- settings_held (0130), also holding oldVoice (true or false) and cardWriteSettleSeconds (a whole number from 0 to 600). Everything else as 0130 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $$;

-- seed_instance (0139), also writing whether each card writes. Everything else as 0139 wrote it.
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
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
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
  -- A card's play, rarity, trap, ward and time up (0054), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap, whether it is a ward, how long a Use of it is up, where it reaches and whether it pins.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, ward, lasts, reaches, pins, writes)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
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
  insert into move_kinds (key, structural, shapes_board, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices, derived = excluded.derived;
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
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- --------------------------------------------------------------------------------------------------------------- access ----

revoke execute on function old_voice_on(), require_old_voice(text), card_writes_enqueue() from public, anon, authenticated;
revoke execute on function claim_card_writes(integer, uuid), finish_card_write(uuid, uuid, text, text, bigint), refund_card_write(uuid) from public, anon, authenticated;
grant execute on function claim_card_writes(integer, uuid), finish_card_write(uuid, uuid, text, text, bigint), refund_card_write(uuid) to service_role;
-- Read as card_ended is: any signed-in player, never a visitor.
revoke execute on function post_tails(uuid[]) from public, anon;
grant execute on function post_tails(uuid[]) to authenticated;

-- ------------------------------------------------------------------------------------------------------------ the sweep ----

-- Every minute, with the jobs key in apikey and nothing sent until the Vault holds both its secrets (the pattern of schedule_chatter, 0089):
-- the cron is the sweep, and a kick after a play or an edit (supabase/functions/act) is what makes a tail type in seconds.
create function schedule_card_writes() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-write', '* * * * *', $job$
    select net.http_post(
      url := s.base || '/functions/v1/write',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret),
      body := jsonb_build_object('slot', date_trunc('minute', now())),
      timeout_milliseconds := 150000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_jobs_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;
revoke execute on function schedule_card_writes() from public, anon, authenticated;
select schedule_card_writes();

-- ------------------------------------------------------------------------------------------------------------- the log ----

-- What was written on the caller's own posts, for the author's log (the design, section 13): one row for each text or failure of a play on a post
-- one of the caller's characters wrote. `opening` is the play's first row (its first text: "continued it"; its first failure: "didn't take"); a later
-- text is a regeneration for a later version of the post ("made it again"); a failure after an earlier text keeps the tail and says nothing.
--
-- The masks: the rows are the caller's by the post's author, the one fact of ownership read, as my_posts_played_on's are; a text and whether it
-- failed are what post_tails shows every reader, and nothing here names the caster, the play's price or any wallet. It includes plays by the
-- caller's own characters on their own posts (the tail is the author's either way); the caster's own lines are the card ledger's.
--
-- A busy instance: the read starts from the caller's characters (characters_owner), their posts (acts_character), the plays on each post
-- (acts_layers) and the texts of each play (card_texts_play_version_key), so its cost grows with the caller's own posts and never with the
-- instance's texts. The log pages it as it pages every source: newest first at or before the cursor, at most 200 rows (log_page below).
create view my_posts_written_on as
  select x.play, k.target_act_id as post, x.version, (x.failed is not null) as failed,
         not exists (select 1 from card_texts y where y.play = x.play and y.id < x.id) as opening,
         x.created_at as at
  from characters c
  join acts p on p.character = c.id and p.kind = 'post'
  join acts k on k.target_act_id = p.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
  join card_texts x on x.play = k.id
  where c.owner = auth.uid();

revoke all on my_posts_written_on from anon, public;
grant select on my_posts_written_on to authenticated;

-- log_page (0139), also reading the writes as its sixteenth source, `writes` (my_posts_written_on, above, newest first by `at`, at most 200, the columns
-- the adapter's log() reads); the plays and posts they name are among the Acts the page names. Everything else as 0139 wrote it.
create or replace function log_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive
  mine as (
    select m.id, m.class_since from my_characters m
  ), lg as materialized (
    select l.settlement, l.starts_at, l.ends_at, l.character, l.reason, l.amount, l.shares_kept, l.params
    from my_ledger l where in_before is null or l.ends_at <= in_before
    order by l.ends_at desc, l.settlement, l.character, l.reason limit 200
  ), wl as materialized (
    select e.settlement, e.kind, e.change, e.overflow, e.floored, e.balance_after, e.ref, e.at
    from my_wallet_events e where in_before is null or e.at <= in_before
    order by e.at desc, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after limit 200
  ), cd as materialized (
    select c.card, c.kind, c.act, c.price, c.at, c.springs, c.pack, c.repriced
    from my_card_ledger c where in_before is null or c.at <= in_before
    order by c.at desc, c.card, c.kind, c.act, c.price, c.pack limit 200
  ), pk as materialized (
    select p.id, p.pack, p.price, p.repriced, p.contents, p.bought_at
    from my_packs p where in_before is null or p.bought_at <= in_before
    order by p.bought_at desc, p.id limit 200
  ), po as materialized (
    select p.play, p.post, p.at, p.reach, p.target_name, p.target_character
    from my_posts_played_on p where in_before is null or p.at <= in_before
    order by p.at desc, p.play limit 200
  ), wr as materialized (
    select w.play, w.post, w.version, w.failed, w.opening, w.at
    from my_posts_written_on w where in_before is null or w.at <= in_before
    order by w.at desc, w.play, w.version limit 200
  ), sv as materialized (
    select p.play, p.post, p.saved_at
    from my_posts_played_on p where p.saved_at is not null and (in_before is null or p.saved_at <= in_before)
    order by p.saved_at desc, p.play limit 200
  ), se as materialized (
    select f.play, f.card, f.post, f.spring, f.ended_at
    from my_face_down f where f.ended_at is not null and (in_before is null or f.ended_at <= in_before)
    order by f.ended_at desc, f.play limit 200
  ), sp as materialized (
    select f.play, f.card, f.post, f.ends_at, f.passed_at
    from my_face_down f where f.passed_at is not null and f.spring is null and (in_before is null or f.passed_at <= in_before)
    order by f.passed_at desc, f.play limit 200
  ), ca as materialized (
    select c.play, c.card, c.post, c.trap, c.spring, c.price, c.bought_price, c.at
    from my_caught c where in_before is null or c.at <= in_before
    order by c.at desc, c.play limit 200
  ), en as materialized (
    select e.card_end, e.play, e.card, e.at, e.side, e.reach, e.target_name, e.post_author_name, e.caster_name, e.character
    from my_cards_ended e where in_before is null or e.at <= in_before
    order by e.at desc, e.card_end limit 200
  ), inf as materialized (
    select i.infraction, i.character, i.at, i.band, i.points, i.rule_number, i.rule, i.mod_name, i.post, i.post_seq, i.thread, i.expires_at, i.relief, i.emptied_at
    from my_infractions i where in_before is null or i.at <= in_before
    order by i.at desc, i.infraction limit 200
  ), bn as materialized (
    select b.ban, b.character, b.at, b.days, b.until, b.infraction, b.rule, b.thread
    from my_bans b where in_before is null or b.at <= in_before
    order by b.at desc, b.ban limit 200
  ), gm as materialized (
    select g.move, g.character, g.at, g.thread, g.seq, g."group", g.board, g.board_name, g.expires_at, g.landed_until, g.check_at, g.demand, g.office,
           g.ended_why, g.ended_by, g.ended_at, g.ruling, g.ruled_at, g.ruled_until
    from my_group_moves g where in_before is null or g.at <= in_before
    order by g.at desc, g.move limit 200
  ), rp as materialized (
    select r.report, r.character, r.at, r.post, r.post_seq, r.thread, r.verdict, r.verdict_at, r.mod_name, r.refund
    from my_reports r where in_before is null or r.at <= in_before
    order by r.at desc, r.report limit 200
  ), ap as materialized (
    select a.appeal, a.character, a.at, a.punishment, a.punishment_kind, a.post_seq, a.thread, a.verdict, a.ruled_at, a.points_delta, a.hearer_name, a.refund
    from my_appeals a where in_before is null or a.at <= in_before
    order by a.at desc, a.appeal limit 200
  ), sh as materialized (
    select s.settlement, s.character, s.reason, s.act, s.quadrant, s.amount
    from my_ledger_shares s where s.settlement in (select x.settlement from lg x)
  ), tn as materialized (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character in (select m.id from mine m)
  ), named(id) as (
    -- actsNamed (engine/ui/log/lines.ts) over every row read; the Turns are the latest one of each character, the one announced as its class began.
    select x.act from sh x where x.act is not null
    union select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at))
    union select x.act from cd x where x.act is not null
    union select x.play from po x union select x.post from po x where x.post is not null
    union select x.play from wr x union select x.post from wr x
    union select x.play from sv x union select x.post from sv x where x.post is not null
    union select x.post from se x where x.post is not null union select x.spring from se x where x.spring is not null
    union select x.post from sp x where x.post is not null
    union select x.play from ca x union select x.post from ca x where x.post is not null
    union select x.play from en x
    union select x.ref from wl x where x.kind = 'bribe' and x.ref is not null
  ), walk(id, depth) as (
    -- actsFollowed, twice: what the Acts read lead to. A loop costs the two rounds as a chain does.
    select n.id, 0 from named n
    union
    select f.id, w.depth + 1
    from walk w
    join acts_public a on a.id = w.id
    cross join lateral (values
      (case when a.kind in ('card', 'spring', 'set') then a.target_act_id end),
      (case when a.kind = 'intercept' and a.payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'visit_act')::uuid end),
      (case when a.kind in ('spring', 'card') and a.payload ->> 'spring' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'spring')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'caught' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'caught')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'by')::uuid end)
    ) f(id)
    where w.depth < 2 and f.id is not null
  ), ac as materialized (
    select a.* from acts_public a where a.id in (select w.id from walk w)
  ), reach as materialized (
    -- A play beyond a post carries its target's name (play_card, 0056); one written without reads it as it stands, so its target is named here.
    select a.payload ->> 'reach' as kind,
           case when a.payload ->> (a.payload ->> 'reach') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> (a.payload ->> 'reach'))::uuid end as target
    from ac a
    where a.kind = 'card' and jsonb_typeof(a.payload -> 'targetName') is distinct from 'string' and a.payload ->> 'reach' in ('character', 'thread', 'board')
  ), pe(id) as (
    select a.character from ac a where a.character is not null and a.character not in (select m.id from mine m)
    union select r.target from reach r where r.kind = 'character' and r.target is not null and r.target not in (select m.id from mine m)
  ), th(id) as (
    select a.thread from ac a where a.id in (select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at)))
    union select r.target from reach r where r.kind = 'thread' and r.target is not null
  )
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character, x.reason) from lg x), '[]'::jsonb),
      'wallet', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) from wl x), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card, x.kind, x.act, x.price, x.pack) from cd x), '[]'::jsonb),
      'packs', coalesce((select jsonb_agg(to_jsonb(x) order by x.bought_at desc, x.id) from pk x), '[]'::jsonb),
      'playsOnMine', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from po x), '[]'::jsonb),
      'writes', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play, x.version) from wr x), '[]'::jsonb),
      'saves', coalesce((select jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.play) from sv x), '[]'::jsonb),
      'setEnds', coalesce((select jsonb_agg(to_jsonb(x) order by x.ended_at desc, x.play) from se x), '[]'::jsonb),
      'setPasses', coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc, x.play) from sp x), '[]'::jsonb),
      'caught', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from ca x), '[]'::jsonb),
      'ended', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card_end) from en x), '[]'::jsonb),
      'infractions', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from inf x), '[]'::jsonb),
      'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.ban) from bn x), '[]'::jsonb),
      'groupMoves', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.move) from gm x), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.report) from rp x), '[]'::jsonb),
      'appeals', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.appeal) from ap x), '[]'::jsonb)),
    'shares', coalesce((select jsonb_agg(to_jsonb(x) order by x.settlement desc, x.character, x.reason, x.act, x.quadrant) from sh x), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(e) order by e.play::text collate "C") from (
      select s.play, s.state, s.saved_at from effect_state s where s.play in (select v.play from sv v)) e), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name, f.id) from (
        select cp.name, cp.id, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c where c.id in (select p.id from pe p)) cp) f), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id::text collate "C") from thread_open t where t.id in (select h.id from th h)), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(to_jsonb(b) order by b.id::text collate "C") from (
      select n.id, n.slug, n.name, n.description, n.is_system, n.move_act from boards_now n
      where n.id in (select r.target from reach r where r.kind = 'board' and r.target is not null)) b), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(to_jsonb(s) order by s.character::text collate "C") from (
      select c.character, c.standing from current_standings c where c.character in (select m.id from mine m)) s), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'season', (select to_jsonb(s) from current_season s limit 1)
  );
end;

revoke all on function log_page(timestamptz) from public, anon, authenticated;
grant execute on function log_page(timestamptz) to authenticated;
