-- A surface card is cast face up and never set face down (docs/plans/2026-11-12-graffiti-face-up-design.md, section 1; plan Task 2).
--
-- A wall's first draw is the caster's, made on the card's own screen after it lands on a post; a back set face down held a drawing the setter made before anyone had seen the post it would spring on, and
-- the game would rather a wall be drawn where it is. So a card with a surface joins the cards that are only cast now and face up (engine faceUpOnly), and the server refuses its back as it refuses theirs:
--   1. face_down_never_writes   widened (0153, section 11): a card with a surface is refused a back in the general sentence the engine's decideSet gives. The trigger itself stays as 0149 made it.
--   2. set_surface_card         dropped (0317): nothing sets a surface card face down now, so nothing writes a draft.
-- Nothing else changes. face_down_draws, lay_sprung's draft branch and take_back's draft delete stay for backs already set before this migration, which still spring with their draft written in, or are taken back
-- with it deleted; a back that ran out is no longer swept by a later set, and its private draft row lies unread until that back's post is gone.
--
-- Ways out: a refused back writes nothing and costs nothing (the Act, the spend and the back are one statement); a back set before this migration springs, is taken back or runs out as it always did.
-- Privacy: nothing here reads who owns a character or a hand. The refusal depends on the card alone, so it is the same for everyone who sets it.

create or replace function face_down_never_writes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare k card_kinds;
begin
  select * into k from card_kinds c where c.key = new.card;
  if k.writes then
    raise exception '% writes, so it is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.draws is not null or k.drive is not null or k.needs_message is not null or k.surface then
    raise exception '% is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return new;
end $$;

drop function set_surface_card(uuid, text, uuid, uuid, jsonb, integer, text, text, text, uuid[], boolean, jsonb, bit, integer, integer);
