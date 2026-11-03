-- The settle run's claim, held until its window is applied: docs/plans/2026-11-03-settle-claim-plan.md, built from
-- docs/plans/2026-11-03-settle-claim-design.md. Each function replaced here is copied from its latest definition and changed only
-- as its header says.

-- ------------------------------------------------------------------------ the settle run's claim ----

-- Task 1 (#179's second and fourth follow-ups, the design's section 1). A claim (0072) refused a reveal only while it was under five
-- minutes old, and one window's settlement_input, settle() and apply_settlement can together outlast five minutes on a busy instance:
-- a reveal after that named the class a Turn replaces, dated after the Turn took effect (#22). No clock can tell a live run from a
-- dead one, so a claim now holds until a settlement past its start is written: its own window's, or, for a stale claim made by an
-- overlapping run whose window ended differently, the other run's. A claim on a window that has not yet ended refuses nothing.
--
-- A claim is a run's clock, never an Act, and no instance is deployed, so the claims standing are dropped rather than given a start.
delete from settlement_claims;
alter table settlement_claims add column window_start timestamptz not null;
alter table settlement_claims add constraint settlement_claims_window check (window_end > window_start);

drop function claim_settlement_window(timestamptz);
create function claim_settlement_window(window_start timestamptz, window_end timestamptz) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into settlement_claims (window_start, window_end, claimed_at) values (claim_settlement_window.window_start, claim_settlement_window.window_end, now())
  on conflict on constraint settlement_claims_pkey do update set window_start = excluded.window_start, claimed_at = now()
$$;
revoke execute on function claim_settlement_window(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function claim_settlement_window(timestamptz, timestamptz) to service_role;

-- The claims a settlement voids, deleted in the transaction that writes it (apply_settlement's), so the table holds only claims still
-- waiting: every claim whose window starts before the settlement's end. A claim on a later window is kept.
create function settlement_voids_claims() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from settlement_claims k where k.window_start < new.ends_at;
  return null;
end $$;
revoke execute on function settlement_voids_claims() from public, anon, authenticated;
create trigger settlement_voids_claims after insert on settlements for each row execute function settlement_voids_claims();

-- unmask() (0072), its claim held until a settlement past the claim's start is written, with no clock, and refusing only once the
-- claimed window has ended; both refusals say one sentence that names the player's way out (#177, the design's section 2). The
-- refusal turns on the caller's own character's own Turn and on the run's state, never on another player; that a settlement is due
-- or running is public, since when The System settles is the same for everyone. Its ways out: the run applies the window, by itself
-- (a dead run's claim gives way when the next firing applies it), and the player may withdraw the Turn at any time, on My characters.
-- Everything else as 0072 wrote it.
create or replace function unmask(through uuid, in_thread uuid, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  if exists (select 1 from pending_turns p where p.character = through and (
       next_settlement_at(p.asked_at) <= now()
       or exists (select 1 from settlement_claims k
                  where k.window_end > p.asked_at and k.window_end <= now()
                    and not exists (select 1 from settlements s where s.ends_at > k.window_start)))) then
    raise exception 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return write_unmask(through, in_thread, 'act', now(), said);
end $$;
