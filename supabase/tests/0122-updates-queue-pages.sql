-- updates_page(update, before, handover_season) and queue_page() (supabase/migrations/0121_updates_queue_pages.sql; the glass-load design, section 7; its
-- plan, Task 8): /updates and /admin/queue in one read each. Every piece equals the matching read made directly; the open update's `mine` holds only
-- the caller's own reactions; the queue is absent from the updates page for a player and present for an admin writing a handover; the queue page is
-- null for a player and holds the four reads for an admin; a visitor is refused both.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('uq-ann');
  bob uuid := tests.account('uq-bob');
  adm uuid := tests.account('uq-admin');
  a1 uuid := tests.character(ann, 'Uq Ann', 'alpha', now() - interval '60 days');
  b1 uuid := tests.character(bob, 'Uq Bob', 'alpha', now() - interval '60 days');
  u1 uuid; u2 uuid; u3 uuid;
  doc jsonb;
  want jsonb;
  why text;
  i integer;
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.')));
  insert into admins (account) values (adm);
  perform tests.become(adm);
  u1 := (post_update('First news', 'Body one.', '[]') ->> 'act')::uuid;
  u2 := (post_update('Second news', 'Body two.', '[{"label": "New", "text": "A change."}]') ->> 'act')::uuid;
  u3 := (post_update('Third news', 'Body three.', '[]') ->> 'act')::uuid;
  perform tests.unbecome();
  -- The three share one instant here, so the newest is the one updates() lists first; the reactions go on that one and on another.
  u3 := (select act from updates(null, 20) limit 1);
  u1 := (select act from updates(null, 20) where act <> u3 limit 1);
  u2 := (select act from updates(null, 20) where act not in (u1, u3) limit 1);
  -- Ann and Bob react to the newest update; Ann to the first as well.
  perform tests.become(ann);
  perform react(u3, a1, 'up');
  perform react(u1, a1, 'wow');
  perform tests.unbecome();
  perform tests.become(bob);
  perform react(u3, b1, 'boo');
  perform tests.unbecome();

  -- ---- updates_page ----
  perform tests.become(ann);
  doc := updates_page(null, null, null);
  if doc -> 'updates' is distinct from (select jsonb_agg(to_jsonb(u)) from updates(null, 20) u) or jsonb_array_length(doc -> 'updates') is distinct from 3 then raise exception 'updates: %', doc -> 'updates'; end if;
  if doc #>> '{updates,0,act}' is distinct from u3::text then raise exception 'the first listed is the open one: %', doc -> 'updates'; end if;
  -- No update named: the newest is open.
  if doc -> 'tallies' is distinct from (select jsonb_agg(to_jsonb(t) order by t.kind) from (select act, kind, count from reaction_tallies where act = u3) t) or jsonb_array_length(doc -> 'tallies') is distinct from 2 then
    raise exception 'tallies of the newest: %', doc -> 'tallies';
  end if;
  if doc -> 'mine' is distinct from (select jsonb_agg(to_jsonb(m) order by m.kind) from (select act, kind, character from my_reactions where act = u3) m) or jsonb_array_length(doc -> 'mine') is distinct from 1 then
    raise exception 'mine of the newest: %', doc -> 'mine';
  end if;
  if doc #>> '{mine,0,kind}' is distinct from 'up' or doc::text like '%' || b1::text || '%' then raise exception 'mine holds only the caller''s own reaction: %', doc -> 'mine'; end if;
  if doc ? 'queue' then raise exception 'no handover asked, no queue'; end if;
  -- An update named: its tallies and the caller's marks.
  doc := updates_page(u1, null, null);
  if doc -> 'tallies' is distinct from (select jsonb_agg(to_jsonb(t) order by t.kind) from (select act, kind, count from reaction_tallies where act = u1) t) or doc #>> '{mine,0,kind}' is distinct from 'wow' then raise exception 'the named update: %', doc; end if;
  -- An update named that is not on the page (an older one, or none at all): the newest of the page is open, as Updates.tsx shows it, and its reactions are read.
  doc := updates_page(gen_random_uuid(), null, null);
  if doc -> 'tallies' is distinct from (select jsonb_agg(to_jsonb(t) order by t.kind) from (select act, kind, count from reaction_tallies where act = u3) t) or doc #>> '{mine,0,kind}' is distinct from 'up' then
    raise exception 'an update off the page opens the newest: %', doc;
  end if;
  doc := updates_page(u1, now() + interval '1 day', null);
  if doc -> 'tallies' is distinct from (select jsonb_agg(to_jsonb(t) order by t.kind) from (select act, kind, count from reaction_tallies where act = u1) t) then raise exception 'an update on the page is open: %', doc -> 'tallies'; end if;
  doc := updates_page(u1, now(), null);
  if doc -> 'tallies' is distinct from '[]'::jsonb or doc -> 'mine' is distinct from '[]'::jsonb then raise exception 'an update off an empty page opens nothing: %', doc; end if;
  -- An update with no reaction: empty lists, not null.
  doc := updates_page(u2, null, null);
  if doc -> 'tallies' is distinct from '[]'::jsonb or doc -> 'mine' is distinct from '[]'::jsonb then raise exception 'no reactions are empty lists: %', doc; end if;
  -- Paging: `before` is the cursor, exclusive (the three share this transaction's instant, so one after it holds all and the instant itself none).
  doc := updates_page(null, now() + interval '1 day', null);
  if doc -> 'updates' is distinct from (select jsonb_agg(to_jsonb(u)) from updates(now() + interval '1 day', 20) u) or jsonb_array_length(doc -> 'updates') is distinct from 3 then raise exception 'a later cursor: %', doc -> 'updates'; end if;
  doc := updates_page(null, now(), null);
  if doc -> 'updates' is distinct from '[]'::jsonb then raise exception 'the cursor is exclusive: %', doc -> 'updates'; end if;
  if doc -> 'tallies' is distinct from '[]'::jsonb then raise exception 'no update open, no tallies: %', doc -> 'tallies'; end if;
  -- A handover asked by a player: no queue.
  doc := updates_page(null, null, 3);
  if doc ? 'queue' then raise exception 'a player is given no queue: %', doc; end if;
  perform tests.unbecome();

  -- An admin writing a handover gets the queue, as admin_queue gives it; one asking for none does not.
  perform tests.become(adm);
  doc := updates_page(null, null, 3);
  if doc -> 'queue' is distinct from admin_queue() then raise exception 'queue: %', doc -> 'queue'; end if;
  if updates_page(null, null, null) ? 'queue' then raise exception 'no handover asked, no queue'; end if;
  perform tests.unbecome();

  -- ---- queue_page ----
  perform tests.become(ann);
  if queue_page() is not null then raise exception 'queue_page is null for a player'; end if;
  perform tests.unbecome();
  perform tests.become(adm);
  doc := queue_page();
  if doc -> 'queue' is distinct from admin_queue() then raise exception 'queue_page queue'; end if;
  if doc -> 'bosses' is distinct from boss_roster_names() then raise exception 'bosses: %', doc -> 'bosses'; end if;
  if doc -> 'contact' is distinct from admin_contact() then raise exception 'contact: %', doc -> 'contact'; end if;
  want := (select jsonb_agg(jsonb_build_object('id', n.id, 'slug', n.slug, 'name', n.name, 'was', coalesce(b.name, n.name)) order by n.created_at, n.id)
           from boards_now n left join boards b on b.id = n.id);
  if doc -> 'boardNames' is distinct from want or jsonb_array_length(doc -> 'boardNames') < 1 then raise exception 'boardNames: %', doc -> 'boardNames'; end if;
  perform tests.unbecome();

  -- A visitor is refused both.
  perform tests.become_anon();
  why := pg_temp.refusal('select updates_page(null, null, null)');
  if why is null or why not like '42501%' then raise exception 'anon must be refused updates_page(), got %', why; end if;
  why := pg_temp.refusal('select queue_page()');
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'anon must be refused queue_page(), got %', why; end if;
end $$;
