-- write_staff_act stamps a move with the office it landed under (supabase/migrations/0128_move_office.sql).
-- A Boss's move says boss, a Mod's says mod, whatever the persona holds later; a post is not stamped; a payload that names an office keeps it.
do $$
declare
  seed jsonb;
  ann uuid;
  m1 uuid;
  m2 uuid;
  p1 uuid;
begin
  seed := jsonb_build_object('settings', jsonb_build_object('systemEnabled', true), 'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment')), 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'mo-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'mo-boss', 'name', 'Office Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
                                 jsonb_build_object('key', 'mo-mod', 'name', 'Office Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', jsonb_build_array('mo-mod'), 'moves', jsonb_build_array(jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))), 'demands', '[]'::jsonb, 'predicates', '[]'::jsonb));
  perform seed_instance(seed);
  ann := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  m1 := (write_staff_act('mo-boss', 'move', ann, null, jsonb_build_object('kind', 'conferGroup', 'body', 'x', 'params', jsonb_build_object('character', gen_random_uuid()::text, 'group', 'trialMembers'))) ->> 'id')::uuid;
  if (select payload ->> 'office' from acts where id = m1) is distinct from 'boss' then raise exception 'the Boss''s move says boss: %', (select payload from acts where id = m1); end if;
  if (select o.office from staff_office_now o where o.staff = 'mo-mod') is distinct from 'mod' then raise exception 'the world has a Mod: %', (select o.office from staff_office_now o where o.staff = 'mo-mod'); end if;
  m2 := (write_staff_act('mo-mod', 'move', ann, null, jsonb_build_object('kind', 'conferGroup', 'body', 'x', 'params', jsonb_build_object('character', gen_random_uuid()::text, 'group', 'trialMembers'))) ->> 'id')::uuid;
  if (select payload ->> 'office' from acts where id = m2) is distinct from 'mod' then raise exception 'a Mod''s move says mod: %', (select payload from acts where id = m2); end if;
  p1 := (write_staff_act('mo-boss', 'post', ann, null, jsonb_build_object('body', 'hello')) ->> 'id')::uuid;
  if (select payload ? 'office' from acts where id = p1) then raise exception 'a post is not stamped'; end if;
  m1 := (write_staff_act('mo-boss', 'move', ann, null, jsonb_build_object('kind', 'conferGroup', 'body', 'x', 'params', jsonb_build_object('character', gen_random_uuid()::text, 'group', 'trialMembers'), 'office', 'mod')) ->> 'id')::uuid;
  if (select payload ->> 'office' from acts where id = m1) is distinct from 'mod' then raise exception 'a given office is kept'; end if;
end $$;
