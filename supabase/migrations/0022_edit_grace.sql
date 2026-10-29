-- The edit grace period. The screens' engine plan, Task 11; the screens' design, section 6: an
-- edit made within editGrace of its post (two minutes, an instance setting) records a version and
-- does not set "Last edited", so a typo fixed at once is not a confession. Every edit is still a
-- new Act ("Append-only") in the post's public history, and edited_at still says when the latest
-- was made; shown_edited_at is what "Last edited" shows: the latest edit made after the grace, or
-- null when every edit fell inside it.

-- A span may count minutes for the grace alone (engine/rules/instance.ts holds the same), which
-- span_interval (0007) now reads.
create or replace function span_interval(span jsonb) returns interval
language sql immutable set search_path = public, pg_temp as $$
  select (span ->> 'count')::integer * case span ->> 'unit' when 'minute' then interval '1 minute' when 'day' then interval '1 day'
    when 'week' then interval '1 week' when 'month' then interval '1 month' end
$$;

create function settings_grace_holds() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key = 'editGrace' and not (
       jsonb_typeof(new.value) = 'object' and new.value ->> 'unit' in ('minute', 'day', 'week', 'month')
       and jsonb_typeof(new.value -> 'count') = 'number' and (new.value ->> 'count')::numeric >= 1
       and (new.value ->> 'count')::numeric <= 1000
       and (new.value ->> 'count')::numeric = trunc((new.value ->> 'count')::numeric)) then
    raise exception 'editGrace is a span: a unit of minute, day, week or month and a whole count from 1 to 1000' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_grace_holds before insert or update on settings for each row execute function settings_grace_holds();

-- acts_public (0001), with shown_edited_at last, so every column before it is as it was. The grace
-- is read from its row once per query and written out as span_interval reads it, since a view
-- calls a function with its caller's privileges; an instance not yet seeded with editGrace shows
-- every edit, as before.
create or replace view acts_public as
  select a.id, a.character, a.kind, a.thread, a.target_act_id, a.seq, a.created_at,
         a.payload,
         coalesce(e.payload, a.payload) as current_payload,
         e.created_at as edited_at,
         shown.created_at as shown_edited_at
  from acts a
  left join lateral (
    select x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = a.id
    order by x.created_at desc, x.id desc limit 1
  ) e on a.kind = 'post'
  left join lateral (
    select x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = a.id
      and x.created_at > a.created_at + coalesce((
        select (g.value ->> 'count')::integer * case g.value ->> 'unit' when 'minute' then interval '1 minute' when 'day' then interval '1 day'
          when 'week' then interval '1 week' when 'month' then interval '1 month' end
        from settings g where g.key = 'editGrace'), interval '0')
    order by x.created_at desc, x.id desc limit 1
  ) shown on e.created_at is not null;

revoke execute on function settings_grace_holds() from public, anon, authenticated;
