-- When a play landed: its card Act's own time, for a card whose rules hold its state for a while after it lands (CardRules.stateHeldUntil,
-- engine/rules/cards.ts). The act function reads it before an author's save and refuses one made inside the hold
-- (docs/plans/2026-11-16-autocorrect-hold-design.md, section 3). The time a play landed is public, as every Act's is, and no character is
-- answered; null for anything that is not a card Act. A definer, as card_of_play is (0006), so the read is the same for every caller.
create function play_landed_at(play uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select a.created_at from acts a where a.id = play and a.kind = 'card'
$$;
revoke execute on function play_landed_at(uuid) from public, anon;
grant execute on function play_landed_at(uuid) to authenticated;
