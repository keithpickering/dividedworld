-- Hints: a nudge to the player whose post or card play is drawing a pattern of reactions. The alerts plan, Task 12; the alerts design,
-- sections 5, 10 and 11.
--
-- The engine decides the pattern (engine/rules/hints.ts) from the public per-quadrant counts of one Act's reactions inside a window;
-- SQL does two small things. act_window_counts reads those counts, and fire_hint records that a pattern fired for an Act and, the first
-- time only, writes the alert (0058) for the Act's own player. Both are the service's, called by the act function after a reaction's
-- answer has gone (supabase/functions/act/core.ts); no API role can call either.
--
-- "A response never proves a private fact": a hint is computed from the counts any reader sees on the chips and the time each reaction
-- landed, never from who reacted; it goes to the Act's author's account alone; and nothing a reactor is answered depends on it, since
-- it is written after their answer. A reactor cannot react to their own masks (react, 0002), so a hint never tells a player something
-- about their own other mask's reactions. The hint's existence says only what the Act's public counts say.
--
-- Once per Act and pattern: hints_fired holds one row per (Act, pattern), and fire_hint writes the alert only for the insert that
-- made the row, so a reaction sent twice, two reactions racing, or a retry after a timeout fires a pattern once. Rows are only ever
-- added, as Acts are. Its way out: a row is a record that a hint was sent, not a state of a player's; there is nothing to be stuck in.

create table hints_fired (
  act uuid not null references acts (id),
  pattern text not null check (pattern ~ '^(leading:(excitedPositive|excitedNegative|calmPositive|boredNegative)|divisive|thunder)$'),
  at timestamptz not null default now(),
  primary key (act, pattern)
);
alter table hints_fired enable row level security;
revoke all on hints_fired from public, anon, authenticated, service_role;

-- The window read (act_window_counts) is one range of an Act's reactions by time, counted by kind: this index answers it without
-- touching the table, however many reactions an Act has drawn, and it costs one entry per reaction.
create index reactions_window on reactions (act, created_at) include (kind);

-- The public reaction counts of one Act since `since`, by quadrant, and, where the Act is a card played on a post, that post: the thunder
-- compares a card with the post it landed on. A reaction exactly at `since` is inside the window. The counts are the four quadrants'
-- and nothing finer (no kind, no account, no character), so what leaves is what a reader of the thread can add up. An Act nobody
-- reacted to, and one that is not there, both read as four zeros.
create function act_window_counts(about uuid, since timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'excitedPositive', count(*) filter (where k.quadrant = 'excitedPositive'),
      'excitedNegative', count(*) filter (where k.quadrant = 'excitedNegative'),
      'calmPositive', count(*) filter (where k.quadrant = 'calmPositive'),
      'boredNegative', count(*) filter (where k.quadrant = 'boredNegative')),
    -- A play beyond a post (a character, a thread or a board; 0055) names its reach in its payload; a play on a post names none.
    'cardOn', (select a.target_act_id from acts a where a.id = about and a.kind = 'card' and coalesce(a.payload ->> 'reach', 'post') = 'post'))
  from reactions r join reaction_kinds k on k.key = r.kind
  where r.act = about and r.created_at >= since
$$;

-- Record that `pattern` fired for the Act `about`, and write the hint alert for its author's player the first time. Answers whether
-- it fired now: false for a pattern already fired for this Act, and for an Act written by staff (no player's, and staff is public).
-- `acting` is null: no one acted, the counts did, so write_alert's own-account skip (the caster knows what they did) has nothing to
-- skip, and a hint always reaches the author's player. A pattern outside the engine's list, and an Act that is not there, are refused.
create function fire_hint(about uuid, pattern text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  author uuid;
  owner_of uuid;
  written integer;
begin
  if about is null or pattern is null or pattern !~ '^(leading:(excitedPositive|excitedNegative|calmPositive|boredNegative)|divisive|thunder)$' then
    raise exception 'a hint names an Act and one of the engine''s patterns' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select a.character into author from acts a where a.id = about;
  if not found then raise exception 'there is no such Act' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select c.owner into owner_of from characters c where c.id = author;
  if owner_of is null then return false; end if;
  insert into hints_fired (act, pattern) values (about, pattern) on conflict do nothing;
  get diagnostics written = row_count;
  if written is distinct from 1 then return false; end if;
  perform write_alert(author, 'hint', pattern, about, null);
  return true;
end $$;

revoke execute on function fire_hint(uuid, text), act_window_counts(uuid, timestamptz) from public, anon, authenticated;
grant execute on function fire_hint(uuid, text), act_window_counts(uuid, timestamptz) to service_role;
