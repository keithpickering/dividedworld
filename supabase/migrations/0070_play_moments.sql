-- A play's moment: the post as it read when a play landed on it, with every play on it then, as each stood.
-- docs/plans/2026-11-03-effect-history-plan.md, Task 1; docs/plans/2026-11-03-effect-history-design.md, sections 2, 6 and 7.
--
-- What a play saved (effect_state, 0006) is overwritten at each of the author's saves, so once a Whoops! is washed clean nobody can
-- see what it did. When a layer Act lands on a post (a card on the post, a Set, a spring: LAYER_KINDS), the trigger below copies, in
-- the same transaction, the version of the post then and what every other layer on that post had saved:
--   play_moments        one row per play on a post, naming the post's latest edit at the insert, or the post where it has none
--   play_moment_layers  one row per other layer on that post then, with a copy of its saved state and when it was saved, or none where
--                       it had saved none. The rows list the moment's layers exactly, so nothing reads them by time (a card Act takes
--                       no seq since 0035).
-- A trigger, so every path that lands a play takes one without being edited: play_card, set_card, and spring_traps' spring and Strike.
-- A play beyond a post takes none (its reach is not a post's), and is no layer of the post it sits on. A play with no row landed
-- before this migration; the read answers it from its time (Task 2, design section 6).
--
-- The masks (design, section 7): the trigger reads only the Acts and effect_state, which every signed-in player already reads. It never
-- reads face_down, so a Set's moment and a Set's layer row are the same as any play's, and the work done is the same whether a trap is
-- set or not. A card back's layer carries the Set's saved state, which is none.
--
-- A busy instance (design, section 8): a landing copies at most the post's other layers (a few rows: a stack of three of one card and
-- one of each other card), each at most 256KB, through acts_target and effect_state's primary key. Storage grows with plays, which are
-- paid, and never with washes. Both tables are append-only, as play_reach is, and the trigger is an ordinary one, not `enable always`,
-- so an import written as a replica (tools/import-instance.mjs) writes the exported moments as they were and takes none of its own.
--
-- A race at landing: the copy reads effect_state as committed when the trigger runs, takes no lock, and never waits on a save; a save
-- committed in the same instant lands in the next play's moment.

create table play_moments (
  play uuid primary key references acts (id),
  post_version uuid not null references acts (id),
  taken_at timestamptz not null default clock_timestamp()
);

create table play_moment_layers (
  play uuid not null references play_moments (play),
  layer uuid not null references acts (id),
  state jsonb,
  saved_at timestamptz,
  primary key (play, layer)
);

create function play_moments_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a play''s moment is never edited; it is what was on the post when the play landed' using errcode = '55000';
end $$;
create trigger play_moments_no_update before update or delete on play_moments for each row execute function play_moments_append_only();
create trigger play_moments_no_truncate before truncate on play_moments for each statement execute function play_moments_append_only();
create trigger play_moment_layers_no_update before update or delete on play_moment_layers for each row execute function play_moments_append_only();
create trigger play_moment_layers_no_truncate before truncate on play_moment_layers for each statement execute function play_moments_append_only();
-- The truncate guards fire on a restore too, as the ledgers' and play_reach's do.
alter table play_moments enable always trigger play_moments_no_truncate;
alter table play_moment_layers enable always trigger play_moment_layers_no_truncate;

-- Read as effect_state and play_reach are, by a signed-in player: a layer's saved state is already theirs to read. Written by the
-- trigger alone.
alter table play_moments enable row level security;
alter table play_moment_layers enable row level security;
revoke all on play_moments, play_moment_layers from public, anon, authenticated;
grant select on play_moments, play_moment_layers to authenticated;
create policy read on play_moments for select to authenticated using (true);
create policy read on play_moment_layers for select to authenticated using (true);

-- The moment of the play just written: the post's version, and every other layer on the post with what it had saved.
create function take_play_moment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into play_moments (play, post_version)
  values (new.id, coalesce((select e.id from acts e where e.kind = 'edit' and e.target_act_id = new.target_act_id
                            order by e.created_at desc, e.id desc limit 1), new.target_act_id));
  insert into play_moment_layers (play, layer, state, saved_at)
  select new.id, k.id, s.state, s.saved_at
  from acts k left join effect_state s on s.play = k.id
  where k.target_act_id = new.target_act_id and k.kind in ('card', 'set', 'spring') and k.id <> new.id
    and coalesce(k.payload ->> 'reach', 'post') = 'post';
  return null;
end $$;
revoke execute on function take_play_moment(), play_moments_append_only() from public, anon, authenticated;

create trigger acts_take_play_moment after insert on acts for each row
  when (new.kind in ('card', 'set', 'spring') and new.target_act_id is not null and coalesce(new.payload ->> 'reach', 'post') = 'post')
  execute function take_play_moment();

-- ------------------------------------------------------------------------------ the read ----

-- A play's moment, read by a signed-in player as the Acts, effect_state and play_reach are (Task 2; design, sections 3, 6 and 8):
--   version   the post as acts_public shows it, with the version's payload as its current payload, and edited_at and shown_edited_at
--             as acts_public would have shown them then
--   layers    the play's own Act, as it landed, then each layer row's Act with the state it had saved then and when (savedAt)
--   above     each play beyond a post that was live on the post's author, its thread or its board when the play landed (its Act came
--             before the play's and it ends after it), as effects_above gives it
--   recorded  whether the snapshot was taken; a play from before 0070 answers with the version current at its time (acts_edits, as
--             History orders it) and itself alone
-- The same bytes to every caller: nothing here reads face_down or who is asking, so a Set's moment and a card back in another's moment
-- show no card, for its setter as for anyone. Its cost is probes: the play and its post by primary key, the snapshot by play, its
-- layers by play_moment_layers' key, the version by id (or one probe of acts_edits), and play_reach's three indexes; it does not grow
-- with the thread, the board or the instance (supabase/tests/0074-play-moments.sql measures it).
create function play_moment(play uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  recorded boolean;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
begin
  select * into k from acts a where a.id = play_moment.play;
  if k.id is not null and k.kind in ('card', 'set', 'spring') and k.target_act_id is not null and coalesce(k.payload ->> 'reach', 'post') = 'post' then
    select * into on_post from acts a where a.id = k.target_act_id;
  end if;
  if on_post.kind is distinct from 'post' then raise exception 'that is no play on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select * into v from acts a where a.id = (select m.post_version from play_moments m where m.play = k.id);
  recorded := v.id is not null;
  if not recorded then
    select * into v from acts e where e.kind = 'edit' and e.target_act_id = on_post.id and e.created_at <= k.created_at
    order by e.created_at desc, e.id desc limit 1;
    if v.id is null then v := on_post; end if;
  end if;
  select t.board into on_board from threads t where t.id = on_post.thread;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', v.payload,
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from play_moment_layers l join acts_public a on a.id = l.layer where l.play = k.id), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > k.created_at
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > k.created_at
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > k.created_at
      ) r join acts_public a on a.id = r.play
      where a.created_at < k.created_at), '[]'::jsonb),
    'recorded', recorded);
end $$;
revoke execute on function play_moment(uuid) from public, anon, authenticated;
grant execute on function play_moment(uuid) to authenticated;
