-- When a play landed, for a card's hold to read (supabase/migrations/0373_play_landed_at.sql, Task 1 of
-- docs/plans/2026-11-16-autocorrect-hold-plan.md). A card Act's own time comes back; anything that is not a card Act gives null.
-- The card is the test set's, never an instance's.
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); th uuid := gen_random_uuid(); p uuid := gen_random_uuid(); k uuid := gen_random_uuid();
  landed timestamptz;
begin
  insert into auth.users (id, email) values (ann, 'landed@test.invalid');
  insert into accounts (id) values (ann);
  insert into characters (id, owner, name, debuted_at) values (a, ann, 'Lands', now());
  insert into threads (id, board, title) select th, b.id, 'Landing' from boards b where b.slug = 'general';
  insert into acts (id, character, kind, thread, payload) values (p, a, 'post', th, '{"body": "lands here"}');
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at)
    values (k, a, 'card', th, p, '{"card": "sparkly"}', '2026-11-16 09:30:00+00');
  landed := play_landed_at(k);
  if landed is distinct from '2026-11-16 09:30:00+00'::timestamptz then raise exception 'a play''s landing time is its Act''s time, not %', landed; end if;
  if play_landed_at(p) is not null then raise exception 'a post is not a play, so it has no landing time'; end if;
  if play_landed_at(gen_random_uuid()) is not null then raise exception 'an unknown id has no landing time'; end if;
end $$;
