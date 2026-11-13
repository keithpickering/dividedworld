-- A claim on a card write that a slow job renews (docs/plans/2026-11-12-old-voice-window-design.md section 5; issue #584).
--
-- claim_card_writes (0149, 0340) holds a job for five minutes, and a job that re-rolls can run longer than that: it was then claimed again and written
-- twice at once (finish_card_write keeps the first finish, so no player is harmed, but the instance pays for the second run). The worker now renews the
-- claim before each re-roll with this function. Nothing else changes: claim_card_writes, finish_card_write, the table and the crash cap are as they were.
--
-- A claim has no token of its own. What tells one claim from the next is the job's `attempts` (each claim adds one, and an edit, which queues the job afresh,
-- sets it back to 0) together with its `version` (an edit changes it). So a renewal names the play, the version and the attempts the claim handed the worker, and
-- moves `claimed_until` to five minutes from now only where the row still holds all three, the claim has not run out, and the job is not finished (a finished
-- job's row is gone). It answers whether the claim was still the caller's. A worker whose claim lapsed and was taken again, or replaced by an edit, gets false
-- and the row is left as it is. `attempts` is never changed: a renewal is not a claim, so the crash cap still counts claims alone.
create function renew_card_write(play uuid, version uuid, attempts integer) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kept uuid;
begin
  update card_writes w set claimed_until = clock_timestamp() + interval '5 minutes'
  where w.play = renew_card_write.play and w.version = renew_card_write.version and w.attempts = renew_card_write.attempts
    and w.claimed_until is not null and w.claimed_until >= clock_timestamp()
  returning w.play into kept;
  return kept is not null;
end $$;
revoke execute on function renew_card_write(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function renew_card_write(uuid, uuid, integer) to service_role;
