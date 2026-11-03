-- Settings' Tips row (the onboarding plan's Task 9; the onboarding design's section 7). Two functions act on the caller's own
-- account_preferences row, answering the whole preferences as 0068's functions do (preferences_answer), and a third is dropped:
--  * resume_tips: the switch turned on. Tips are on again and nothing is forgotten: what was seen stays seen, so the tips that were
--    skipped come back one at a time as they were and the ones already read do not repeat. (restore_tips, "Show tips again", is the
--    one that forgets.) Undone by skip_tips.
--  * replay_tour (0068) also sets welcomed_at when it is empty. The tour waits on the welcome having been seen, and an account made
--    before the welcome existed has never seen it, so without this "Replay the HUD tour" would do nothing for it. Setting the mark
--    is what seeing the welcome does (see_welcome), and an account that has it keeps its first time.
--  * forget_cards_met (0040, 0057, 0064, 0068) is dropped: it was restore_tips under its old name for the old Card tips row, which
--    Settings no longer has. The client that stops calling forget_cards_met ships in the same deploy as this migration.

create function resume_tips() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account) values (caller)
  on conflict (account) do update set tips = 'on'
  returning * into kept;
  return preferences_answer(kept);
end $$;

create or replace function replay_tour() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account, welcomed_at) values (caller, now())
  on conflict (account) do update set tips = 'on', welcomed_at = coalesce(p.welcomed_at, excluded.welcomed_at),
    tips_seen = coalesce((select array_agg(k order by n) from unnest(p.tips_seen) with ordinality t(k, n) where k <> all (array['tour-plate', 'tour-orbs', 'tour-hand'])), '{}')
  returning * into kept;
  return preferences_answer(kept);
end $$;

revoke execute on function resume_tips() from public, anon;
grant execute on function resume_tips() to authenticated;

drop function forget_cards_met();
