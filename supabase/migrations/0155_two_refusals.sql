-- Two refusals, in plain words (docs/plans/2026-11-11-plain-words-plan.md, Task 9).
--
-- unmask() (0147's definition), its refusal "this character's Turn takes effect at the settlement now due; reveal once it has run, or
-- withdraw the Turn" has two arms: the settlement is due by the clock (next_settlement_at(p.asked_at) <= now()), or a run has claimed an
-- unsettled window that ended after the Turn was asked. The claim arm is now skipped where the character already has an unmask Act dated
-- at or after that claim's window_end. That is the condition masks_change (0100, as 0074 wrote it) applies when it passes a Turn over:
-- `exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and a.created_at >= window_end)`, so such a
-- reveal is one the settlement will read and that already rules the Turn out; refusing another reveal with "reveal once it has run"
-- would be wrong, and the rule that a class already public is not revealed twice answers it in its own words. (The plan said "window_end
-- minus the window"; the settlement reads the act's date against window_end itself, so this does too.) The clock arm is unchanged.
-- In every state a player can reach today the skip is defensive: a reveal at or after window_end writes the class's reveal, and the
-- Turn pending leaves the class as it is, so 0147's rule that a class already public is not revealed twice answers a second reveal
-- before this arm is read. The skip keeps the refusal true should that ordering ever change.
-- Everything else as 0147 wrote it.
--
-- wallet_spend() (0006), naming both amounts as orbs through orbs() (0139), hundredths as "3.00". It runs as its owner, which executes
-- orbs(), so no grant changes. Everything else as 0006 wrote it.
create or replace function unmask(through uuid, in_thread uuid, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  perform not_banned(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  if exists (select 1 from class_reveals r
             cross join lateral (select x.class_key, x.started_at from class_history x where x.character = through order by x.started_at desc limit 1) h
             where r.character = through and r.class = h.class_key and r.at >= h.started_at) then
    raise exception 'that character''s class is already public; after a Turn, the new class can be revealed' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from pending_turns p where p.character = through and (
       next_settlement_at(p.asked_at) <= now()
       or exists (select 1 from settlement_claims k
                  where k.window_end > p.asked_at and k.window_end <= now()
                    and not exists (select 1 from settlements s where s.ends_at > k.window_start)
                    and not exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and a.created_at >= k.window_end)))) then
    raise exception 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return write_unmask(through, in_thread, 'act', now(), said);
end $$;

create or replace function wallet_spend(who uuid, amount integer, what text, about uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare was integer;
begin
  if amount is null or amount < 0 then raise exception 'a price is a whole amount, at least zero' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into wallets (account) values (who) on conflict (account) do nothing;
  select balance into was from wallets where account = who for update;
  if was < amount then
    raise exception 'that costs %, and your wallet holds %', orbs(amount), orbs(was) using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  if amount = 0 then return was; end if;
  update wallets set balance = was - amount where account = who;
  insert into wallet_events (account, kind, change, balance_after, ref) values (who, what, -amount, was - amount, about);
  return was - amount;
end $$;
