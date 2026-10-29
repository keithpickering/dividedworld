-- Characters as the lists show them. The screens' engine plan, Tasks 9 and 10.
--
-- The season's standings: every character that has debuted, ranked by its settled standing in the
-- open season. A mask appears in a list only from the settlement that debuts it (PR #7's Task F:
-- masks change at the tally), so a new one never shows up live, and nobody's sitting can be read
-- from when it does; a debuted character with nothing settled yet stands at 0. Ties share a place.
-- Standings move only at a settlement (0003), so the list does too. The view runs as its owner and
-- names only these four columns: never a player, never a class.

create view season_standings as
  select c.id as character, c.name, coalesce(s.amount, 0) as standing,
    rank() over (order by coalesce(s.amount, 0) desc) as place
  from characters c
  left join standings s on s.character = c.id and s.season = (select id from seasons where ends_at is null)
  where c.debuted_at is not null;

revoke all on season_standings from anon, authenticated;
grant select on season_standings to authenticated;
