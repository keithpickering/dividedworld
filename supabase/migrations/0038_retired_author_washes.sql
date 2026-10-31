-- A retired character's player washes its splat clean (#85; the glass cleanup's design, section 2,
-- docs/plans/2026-10-31-glass-cleanup-design.md). A Whoops! landed on a post whose author was later
-- retired left a splat nobody could wash: only the post's author saves what is on it, and
-- played_by (0021) refuses a retired character for every action. Nothing frees it later either:
-- a character's owner never changes, and restore_character gives it back only with an admin's help.
--
-- So save_effect_state skips played_by for one case alone: `through` is the post's author, owned by
-- the caller and debuted, retired or not. Every other case goes through played_by exactly as before,
-- in its words and codes: a waiting character, one the caller does not play, and a retired one that
-- did not write the post. Another player naming a retired mask therefore meets "you do not play that
-- character", the words any character they do not play gets, and nothing says it is retired; only
-- its own player, who knows, can tell. A reader sees a layer marked clean, as when any author washes.
--
-- effect_state is not an Act: a save is that row, written over by the next, so "Append-only" and
-- acts_well_formed's refusal of a retired character's Acts are untouched. Every other path keeps
-- refusing a retired character (release, play, post, react).
create or replace function save_effect_state(who uuid, through uuid, on_play uuid, state jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare author uuid;
begin
  select t.character into author from acts k join acts t on t.id = k.target_act_id where k.id = on_play and k.kind = 'card';
  -- The post's own player answers for the mask that wrote it, retired or not.
  if not (author is not distinct from through
          and exists (select 1 from characters c where c.id = through and c.owner = who and c.debuted_at is not null)) then
    perform played_by(through, who);
  end if;
  if author is null then raise exception 'there is no such card on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if author <> through then raise exception 'only the post''s author saves what is on it' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- Timed when written, after any save it waited on, so the newest saved_at is the state kept.
  insert into effect_state as e (play, state, saved_by, saved_at) values (on_play, state, through, clock_timestamp())
  on conflict on constraint effect_state_pkey do update set state = excluded.state, saved_by = excluded.saved_by, saved_at = clock_timestamp();
  return (select jsonb_build_object('play', e.play, 'thread', (select thread from acts where id = on_play), 'state', e.state, 'saved_at', e.saved_at)
          from effect_state e where e.play = on_play);
end $$;

revoke execute on function save_effect_state(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function save_effect_state(uuid, uuid, uuid, jsonb) to service_role;
