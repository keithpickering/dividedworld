-- A retired character's player washes its splat clean (#85; supabase/migrations/0038_retired_author_washes.sql;
-- the glass cleanup's design, section 2): save_effect_state accepts a `through` that is the post's author, owned by the
-- caller and debuted, retired or not. Every other refusal stands in today's words, and the one another player meets for
-- a retired character is the one they meet for any character they do not play, so nothing says it is retired. A save is
-- a row in effect_state and never an Act.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('raw-ann');
  bob uuid := tests.account('raw-bob');
  cat uuid := tests.account('raw-cat');
  boss uuid := tests.account('raw-admin');
  gone uuid := tests.character(ann, 'Raw Gone');
  spare uuid := tests.character(ann, 'Raw Spare');
  caster uuid := tests.character(bob, 'Raw Caster');
  cats_gone uuid := tests.character(cat, 'Raw Cats Gone');
  cats_here uuid := tests.character(cat, 'Raw Cats Here');
  waiting uuid;
  t uuid := tests.thread();
  p uuid := tests.post(gone, t, 'Splat me.');
  the_play uuid;
  acts_before bigint;
  why text;
  stranger text;
begin
  insert into characters (owner, name) values (ann, 'Raw Waiting') returning id into waiting;
  insert into wallets (account, balance) values (bob, 300);
  insert into admins (account) values (boss);
  perform tests.become_service();
  perform buy_card(bob, 'splat', 100);
  the_play := (play_card(bob, 'splat', caster, p, '{"color": "red"}', 0) ->> 'id')::uuid;
  perform tests.unbecome();

  perform tests.become(boss);
  perform retire_character(gone);
  perform retire_character(spare);
  perform retire_character(cats_gone);
  perform tests.unbecome();

  acts_before := (select count(*) from acts);
  perform tests.become_service();

  -- The post's own player washes it clean through the retired mask that wrote it.
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, gone, the_play, '{"strokes": []}'));
  if why is not null then raise exception 'a retired author''s player could not wash their own post: %', why; end if;

  -- A retired mask of theirs that did not write the post is refused as a retired character, as today.
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, spare, the_play, '{"strokes": []}'));
  if why is distinct from '55000 that character is retired; an admin can restore it' then raise exception 'a retired non-author: %', why; end if;

  -- A waiting one is refused, as today.
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, waiting, the_play, '{"strokes": []}'));
  if why is distinct from '55000 that character debuts at the next settlement' then raise exception 'a waiting character: %', why; end if;

  -- The caster, who is not the author, is refused, as today.
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, caster, the_play, '{"strokes": []}'));
  if why is distinct from '42501 only the post''s author saves what is on it' then raise exception 'the caster: %', why; end if;

  -- Another player's retired character is any character they do not play: the same words and code as one that is not retired,
  -- and the same as the retired author's own mask named by someone who does not play it.
  stranger := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, cats_here, the_play, '{"strokes": []}'));
  if stranger is distinct from '42501 you do not play that character' then raise exception 'another''s character: %', stranger; end if;
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, cats_gone, the_play, '{"strokes": []}'));
  if why is distinct from stranger then raise exception 'another player''s retired character read differently: % against %', why, stranger; end if;
  why := pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', cat, gone, the_play, '{"strokes": []}'));
  if why is distinct from stranger then raise exception 'a retired author named by another player read differently: % against %', why, stranger; end if;
  perform tests.unbecome();

  -- No Act is written: a save is effect_state's row.
  if (select count(*) from acts) <> acts_before then raise exception 'a save wrote an Act'; end if;

  -- Another reader loads the layer as the author washed it.
  perform tests.become(bob);
  if (select state from effect_state where play = the_play) is distinct from '{"strokes": []}' then
    raise exception 'another reader did not load the washed layer: %', (select state from effect_state where play = the_play);
  end if;
  perform tests.unbecome();
end $$;
