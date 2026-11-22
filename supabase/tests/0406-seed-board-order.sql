-- seed_instance (supabase/migrations/0406_seed_board_order.sql; the launch design, section 3): each seeded board is made one microsecond after
-- the one before it, in the payload's order, so index_page() shows them in the instance's order; seeding again moves nothing.
do $$
declare
  payload jsonb := jsonb_build_object(
    'boards', jsonb_build_array(
      jsonb_build_object('slug', 'zz-last-made-first', 'name', 'Zulu', 'description', 'First in the payload.'),
      jsonb_build_object('slug', 'aa-second', 'name', 'Alpha', 'description', 'Second.'),
      jsonb_build_object('slug', 'mm-third', 'name', 'Mike', 'description', 'Third.')));
  reader uuid := tests.account('sbo-reader');
  want jsonb := '["zz-last-made-first","aa-second","mm-third"]';
  got jsonb;
  stamps jsonb;
  stamps_again jsonb;
begin
  perform seed_instance(payload);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', reader, 'role', 'authenticated')::text, true);
  select jsonb_agg(e ->> 'slug' order by o) into got
    from jsonb_array_elements(index_page() -> 'boards') with ordinality x(e, o) where e ->> 'slug' = any (array['zz-last-made-first', 'aa-second', 'mm-third']);
  if got is distinct from want then raise exception 'index_page should list the boards in the payload''s order, got %', got; end if;
  select jsonb_object_agg(slug, created_at) into stamps from boards where slug = any (array['zz-last-made-first', 'aa-second', 'mm-third']);

  perform seed_instance(payload);
  select jsonb_agg(e ->> 'slug' order by o) into got
    from jsonb_array_elements(index_page() -> 'boards') with ordinality x(e, o) where e ->> 'slug' = any (array['zz-last-made-first', 'aa-second', 'mm-third']);
  if got is distinct from want then raise exception 'seeding again changed the order: %', got; end if;
  select jsonb_object_agg(slug, created_at) into stamps_again from boards where slug = any (array['zz-last-made-first', 'aa-second', 'mm-third']);
  if stamps_again is distinct from stamps then raise exception 'seeding again moved a board''s created_at: % then %', stamps, stamps_again; end if;
end $$;
