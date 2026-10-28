-- One player's two characters reacting to one Act at the same instant are held to the cap
-- between them (react(), supabase/migrations/0002_reactions.sql). Two sessions at once, through
-- tests.race(); the rows are committed, in the scratch database the run drops.
do $$
declare
  ann uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  p uuid;
  said text[];
  kinds integer;
  rounds integer := 12;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-ann@test.invalid'), (%2$L, 'race-bob@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name) values (%3$L, %1$L, 'Racer One'), (%4$L, %1$L, 'Racer Two'), (%5$L, %2$L, 'Racer Post');
    insert into class_history (character, class_key) values (%3$L, 'alpha'), (%4$L, 'alpha'), (%5$L, 'alpha');
    insert into threads (id, board, title) select %6$L, id, 'Race' from boards where slug = 'general';
  $sql$, ann, bob, a1, a2, b1, t));
  for i in 1..rounds loop
    p := gen_random_uuid();
    -- Two reactions already there; the third and a fourth are raced, through two characters.
    perform tests.commit(format($sql$
      insert into acts (id, character, kind, thread, payload) values (%1$L, %2$L, 'post', %3$L, '{"body": "Race me."}');
    $sql$, p, b1, t));
    perform tests.commit(format($sql$
      begin; select tests.become(%1$L); select react(%2$L, %3$L, 'up'); select react(%2$L, %4$L, 'boo'); commit;
    $sql$, ann, p, a1, a2));
    said := tests.race(ann, format('select react(%L, %L, ''calm'')', p, a1), ann, format('select react(%L, %L, ''meh'')', p, a2));
    select count(*) into kinds from reactions where act = p and reactor_account = ann;
    if kinds > 3 then raise exception 'round %: one player left % kinds through two characters at once (%)', i, kinds, said; end if;
    if kinds < 3 then raise exception 'round %: neither raced reaction landed (%)', i, said; end if;
    if (select sum(count) from reaction_tallies where act = p) <> kinds then raise exception 'round %: the tally drifted from the rows', i; end if;
  end loop;
end $$;

-- The same kind from one player's two characters at once lands once.
do $$
declare
  ann uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  p uuid;
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'twin-ann@test.invalid'), (%2$L, 'twin-bob@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name) values (%3$L, %1$L, 'Twin One'), (%4$L, %1$L, 'Twin Two'), (%5$L, %2$L, 'Twin Post');
    insert into class_history (character, class_key) values (%3$L, 'alpha'), (%4$L, 'alpha'), (%5$L, 'alpha');
    insert into threads (id, board, title) select %6$L, id, 'Twins' from boards where slug = 'general';
  $sql$, ann, bob, a1, a2, b1, t));
  for i in 1..12 loop
    p := gen_random_uuid();
    perform tests.commit(format($sql$ insert into acts (id, character, kind, thread) values (%L, %L, 'post', %L); $sql$, p, b1, t));
    said := tests.race(ann, format('select react(%L, %L, ''up'')', p, a1), ann, format('select react(%L, %L, ''up'')', p, a2));
    if (select count(*) from reactions where act = p) <> 1 then raise exception 'round %: one kind landed twice from one player (%)', i, said; end if;
    if (select count from reaction_tallies where act = p and kind = 'up') <> 1 then raise exception 'round %: the tally counted it twice', i; end if;
  end loop;
end $$;
