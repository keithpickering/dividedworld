-- Staff never react (the staff roster design, section 9; its plan, Task 5). The schema already holds it: `react` asks `played_by`,
-- which finds a staff character owned by no one, and `reactions.reactor_account` is `not null`, so a reaction with no account
-- cannot be written. This file pins both, so a later writer who opens a staff reaction path (a pool card, a Mod Bot's tally, a
-- "reaction" through a persona) meets the owner's decision in section 9 and breaks here first. Each check names the specific
-- refusal, never "some error". The poison is react's played_by check skipped, and reactor_account's not null dropped: both named below.

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'nr-boss',
      'staffGroup', jsonb_build_object('name', 'Test Cores'),
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'nr-boss', 'name', 'Nr Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'nr-mod', 'name', 'Nr Mod', 'title', 'Mod', 'signature', 'b')),
      'firstStaff', jsonb_build_array('nr-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
end $$;

do $$
declare
  ann uuid := tests.account('nr-ann');
  a1 uuid := tests.character(ann, 'Anvil');
  t uuid := tests.thread();
  p uuid := tests.post(a1, t, 'By Anvil.');
  boss uuid := (select id from characters where staff = 'nr-boss');
  modbot uuid := (select id from characters where staff = 'nr-mod');
  kind text := (select key from reaction_kinds order by key limit 1);
  state text;
  msg text;
begin
  if boss is null or modbot is null then raise exception 'the seed made no staff characters'; end if;
  if kind is null then raise exception 'the test set has no reaction kind'; end if;

  -- A player reacting through a staff character (the Boss, then a debuted Mod Bot): refused by played_by.
  perform tests.become(ann);
  foreach boss in array array[boss, modbot] loop
    begin
      perform react(p, boss, kind);
      raise exception 'a reaction through a staff character went through';
    exception when others then
      get stacked diagnostics state = returned_sqlstate, msg = message_text;
      if state is distinct from '42501' or msg is distinct from 'you do not play that character' then
        raise exception 'a staff character''s reaction was refused for another reason (% %)', state, msg;
      end if;
    end;
  end loop;
  perform tests.unbecome();

  -- A direct insert with a staff reactor_character and no account: refused by reactor_account's not null.
  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot) values (p, modbot, null, kind, 1);
    raise exception 'a staff reaction with no account was written';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    if state is distinct from '23502' or msg not like '%reactor_account%' then
      raise exception 'a staff reaction row was refused for another reason (% %)', state, msg;
    end if;
  end;

  if exists (select 1 from reactions where act = p) then raise exception 'a refused staff reaction left a row'; end if;
end $$;
