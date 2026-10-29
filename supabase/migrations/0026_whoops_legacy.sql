-- Saved states of 0006's stroke shape, moved aside. The clues design, section 6 (from #11); the
-- clues plan, Task 5.
--
-- Whoops!'s author strokes were first saved with no `tool`, each "down" a fraction of the post's
-- height. Today's are measured in widths of the post's fixed layout (instances/divided-world/
-- cards/whoops.ts), and an old stroke cannot be turned into one without the post's laid-out
-- height, which only a browser knows. So each saved state holding a stroke with no `tool` becomes
-- `{"strokes": [], "legacy": <the old state>}`: the splat and its ink are untouched, the author's
-- old strokes are kept for an admin and no longer drawn, and the author's next save starts clean
-- (a card's validateState takes no `legacy` from a save, so the save replaces it). The rows are
-- found by their shape, not by the card's name, which the engine does not know; only Whoops!
-- saves strokes.
--
-- Its way out is none needed: the post is no more held than before, and a save with new strokes
-- or `clean: true` is taken, as it is now.

-- A wrapped state is its old state and a few bytes more, so the bound on a state (0006) holds the
-- old state within it, and the wrapping beside it.
alter table effect_state drop constraint effect_state_state_check;
alter table effect_state add constraint effect_state_state_check check (octet_length(state::text) <= 262144
  or (state - 'legacy' = '{"strokes": []}'::jsonb and octet_length((state -> 'legacy')::text) <= 262144));

-- Run once below; a state already wrapped has no stroke without a tool, so a second run changes nothing.
create function effect_states_of_0006() returns void
language sql security definer set search_path = public, pg_temp as $$
  update effect_state set state = jsonb_build_object('strokes', '[]'::jsonb, 'legacy', state)
  where jsonb_typeof(state -> 'strokes') = 'array'
    and exists (select 1 from jsonb_array_elements(state -> 'strokes') s where jsonb_typeof(s) = 'object' and not s ? 'tool');
$$;
select effect_states_of_0006();

revoke execute on function effect_states_of_0006() from public, anon, authenticated;
