-- A class is revealed once (docs/plans/2026-11-06-hud-reveal-design.md, section 2), and the server says when it became public.
--
-- my_characters (0138), with one last column: `class_shown_at`, the latest date the character's current class was made public since it
-- took that class, read from class_reveals (0100: a reveal, a debut announced with its class, a Turn announced with its new class) by
-- the character and the class held. Null while it is not public, and again after a Turn, since an older reveal predates the class's
-- new start. It is read only through this view, bounded by the caller's own characters. Everything else as 0138 wrote it.
--
-- unmask() (0104, which added not_banned to 0074's), refusing a class that is already public: a class_reveals row for the
-- character's current class dated on or after that class's start. Its way out is the sentence's own: after a Turn, the new class can be revealed. The check follows acting(), so
-- another player's character gets the refusal it always did, whether or not the class is public; and it follows the character's row
-- lock, so two reveals racing cannot both land. write_unmask() is untouched. Everything else as 0104 wrote it.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until,
         (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
         group_now(c.id) as "group",
         coalesce((select jsonb_agg(jsonb_build_object('board', b.board, 'move', b.move_act, 'group', b."group", 'expires_at', b.expires_at) order by b.board, b.move_act)
                   from bars_of(c.id) b), '[]'::jsonb) as bars,
         (select max(r.at) from class_reveals r where r.character = c.id and r.class = h.class_key and r.at >= h.started_at) as class_shown_at
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();

create or replace function unmask(through uuid, in_thread uuid, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  perform not_banned(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  if exists (select 1 from class_reveals r
             cross join lateral (select x.class_key, x.started_at from class_history x where x.character = through order by x.started_at desc limit 1) h
             where r.character = through and r.class = h.class_key and r.at >= h.started_at) then
    raise exception 'that character''s class is already public; after a Turn, the new class can be revealed' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from pending_turns p where p.character = through and (
       next_settlement_at(p.asked_at) <= now()
       or exists (select 1 from settlement_claims k
                  where k.window_end > p.asked_at and k.window_end <= now()
                    and not exists (select 1 from settlements s where s.ends_at > k.window_start)))) then
    raise exception 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return write_unmask(through, in_thread, 'act', now(), said);
end $$;
