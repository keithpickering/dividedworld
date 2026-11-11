-- A class is revealed once, and the server says when it became public (docs/plans/2026-11-06-hud-reveal-design.md, section 2).
-- `my_characters.class_shown_at` is the latest date the character's current class was made public since it took that class: a reveal,
-- a debut announced with its class, or a Turn announced with its new class. `unmask()` refuses a class that is already public, so the
-- second reveal of a class is never an Act; after a Turn, the new class can be revealed.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- A class already public is not revealed again; after a Turn, the new class can be ----
do $$
declare
  ann uuid := tests.account('once-ann');
  a uuid := tests.character(ann, 'Once Revealed', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Said once');
  said text;
begin
  perform tests.become(ann);
  perform unmask(a, t, 'First.');
  said := pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, 'Again.'));
  if said is distinct from 'that character''s class is already public; after a Turn, the new class can be revealed' then raise exception 'a second reveal of the same class was taken or refused in other words: %', said; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'unmask' and character = a) is distinct from 1::bigint then raise exception 'a refused reveal wrote an Act'; end if;
  -- A Turn takes effect: the new class is not public, and can be revealed, once.
  insert into class_history (character, class_key, started_at) values (a, 'beta', now() - interval '1 day');
  perform tests.become(ann);
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, 'New mask.')) is not null then raise exception 'the class after a Turn could not be revealed'; end if;
  said := pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, 'And again.'));
  if said is distinct from 'that character''s class is already public; after a Turn, the new class can be revealed' then raise exception 'the class after a Turn was revealed twice: %', said; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'unmask' and character = a) is distinct from 2::bigint then raise exception 'the two classes were revealed once each'; end if;
end $$;

-- ---- Another player's reveal gets the refusal acting() gave, whether or not the class is public ----
do $$
declare
  ann uuid := tests.account('once-owner');
  bob uuid := tests.account('once-other');
  a uuid := tests.character(ann, 'Hidden Class', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Not yours');
  before text;
  after text;
begin
  perform tests.become(bob);
  before := pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, ''));
  perform tests.unbecome();
  perform tests.become(ann);
  perform unmask(a, t, '');
  perform tests.unbecome();
  perform tests.become(bob);
  after := pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, ''));
  perform tests.unbecome();
  if before is distinct from 'you do not play that character' then raise exception 'another player''s reveal was refused in other words: %', before; end if;
  if after is distinct from before then raise exception 'a refusal differs with whether the class is public: % / %', before, after; end if;
  if (select count(*) from acts where kind = 'unmask' and character = a) is distinct from 1::bigint then raise exception 'another player''s reveal wrote an Act'; end if;
end $$;

-- ---- class_shown_at: when the current class was last made public since the character took it ----
do $$
declare
  ann uuid := tests.account('shown-ann');
  a uuid := tests.character(ann, 'Shown Maybe', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Shown');
  first_reveal uuid;
  shown timestamptz;
begin
  perform tests.become(ann);
  if (select count(*) from my_characters where id = a) is distinct from 1::bigint then raise exception 'my_characters lists the caller''s character'; end if;
  if (select class_shown_at from my_characters where id = a) is not null then raise exception 'class_shown_at is null before any reveal'; end if;
  perform tests.unbecome();
  -- A reveal, then a Turn: the new class was never shown; a Turn back is the first class taken again, and that old reveal predates it.
  first_reveal := (write_unmask(a, t, 'act', now() - interval '3 days') ->> 'id')::uuid;
  perform tests.become(ann);
  if (select class_shown_at from my_characters where id = a) is distinct from now() - interval '3 days' then raise exception 'class_shown_at is the reveal''s date'; end if;
  perform tests.unbecome();
  insert into class_history (character, class_key, started_at) values (a, 'beta', now() - interval '2 days');
  perform tests.become(ann);
  if (select class_shown_at from my_characters where id = a) is not null then raise exception 'a Turn makes class_shown_at null again'; end if;
  perform tests.unbecome();
  insert into class_history (character, class_key, started_at) values (a, 'alpha', now() - interval '1 day');
  perform tests.become(ann);
  if (select class_shown_at from my_characters where id = a) is not null then raise exception 'after a Turn back, the old reveal predates the class''s new start'; end if;
  -- The reveal through unmask() is that Act's created_at.
  first_reveal := (unmask(a, t, 'Again, now.') ->> 'id')::uuid;
  shown := (select created_at from acts where id = first_reveal);
  if (select class_shown_at from my_characters where id = a) is distinct from shown then raise exception 'class_shown_at is the Act''s created_at'; end if;
  perform tests.unbecome();
end $$;

-- ---- A debut with its class, and a Turn announced with its new class, each set it ----
do $$
declare
  ann uuid := tests.account('shown-announced');
  a uuid := tests.character(ann, 'Debuted Loud', 'alpha', now() - interval '60 days');
  b uuid := tests.character(ann, 'Turned Loud', 'alpha', now() - interval '60 days');
  on_system uuid;
  elsewhere uuid := tests.thread('Already out');
begin
  insert into threads (board, title) values (system_board(), 'The System announces') returning id into on_system;
  perform tests.act(a, 'announce', on_system, '{"what": "debut", "class": "alpha"}', null, now() - interval '1 hour');
  insert into class_history (character, class_key, started_at) values (b, 'beta', now() - interval '2 days');
  perform tests.act(b, 'announce', on_system, '{"what": "turn", "class": "beta"}', null, now() - interval '1 day');
  perform tests.become(ann);
  if (select class_shown_at from my_characters where id = a) is distinct from now() - interval '1 hour' then raise exception 'a debut announced with its class makes it public'; end if;
  if (select class_shown_at from my_characters where id = b) is distinct from now() - interval '1 day' then raise exception 'a Turn announced with its new class makes it public'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, elsewhere, '')) is distinct from 'that character''s class is already public; after a Turn, the new class can be revealed' then raise exception 'a class made public by its debut was revealed'; end if;
  perform tests.unbecome();
end $$;

-- ---- my_characters answers only for the caller's own characters ----
do $$
declare
  ann uuid := tests.account('shown-private-ann');
  bob uuid := tests.account('shown-private-bob');
  a uuid := tests.character(ann, 'Ann''s Shown', 'alpha', now() - interval '60 days');
begin
  perform write_unmask(a, tests.thread('Private shown'), 'act', now() - interval '1 day');
  perform tests.become(bob);
  if (select count(*) from my_characters where id = a) is distinct from 0::bigint then raise exception 'another player''s character is in my_characters'; end if;
  if (select count(class_shown_at) from my_characters) is distinct from 0::bigint then raise exception 'another player''s class_shown_at was read'; end if;
  perform tests.unbecome();
end $$;
