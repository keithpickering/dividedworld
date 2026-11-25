/**
 * The handover tables' change on rows already held (supabase/migrations/0403_departed_personas.sql, "table part", docs/plans/2026-11-21-departed-personas-plan.md, Task 1).
 * The suite replays the migrations from zero, so season_handovers and handover_dismissals hold no rows when 0403 runs there, and the migration has already run on the database a
 * SQL assertion file reads. The honest proof is the migration's own lines run against rows written by the old schema: the table part is read out of the migration file between its two
 * marker comments (a copy in this file would be a subject this test built, free to drift from the one that ships), the old shapes (0051, 0063, 0082 and 0090: a handover keyed by its
 * season, a dismissal keyed by the season, its append-only guard firing always) are built in a schema of their own with a roll-over and a dismissal in them, and the extracted lines run
 * there by search path. Every old handover is then a roll-over with an id of its own, every dismissal names its season's handover and keeps its season, the guard is still on, the one
 * roll-over per season stays, a second row for a season (a departure) is allowed, and a dismissal naming another season than its handover's is refused. All inside one transaction that rolls back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from './psql-db.ts';

const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../../migrations/0403_departed_personas.sql'), 'utf8');

/** The migration's own lines between its two markers. */
export function tablePart(text: string): string {
  const begin = text.split('-- table part: begin\n');
  const end = text.split('-- table part: end\n');
  assert.equal(begin.length, 2, 'the migration has one "-- table part: begin" marker');
  assert.equal(end.length, 2, 'the migration has one "-- table part: end" marker');
  assert.ok(text.indexOf('-- table part: begin\n') < text.indexOf('-- table part: end\n'), 'the begin marker comes before the end marker');
  const part = begin[1]!.split('-- table part: end\n')[0]!;
  assert.ok(part.includes('season_handovers') && part.includes('handover_dismissals') && part.trim().length > 200, 'the lines between the markers are the table part');
  return part;
}

/** The old shapes, in a schema of their own: what 0051, 0063, 0082 and 0090 left (the seasons they reference are the database's own). */
const OLD_SHAPE = `
create schema dp_held;
create table dp_held.season_handovers (
  season bigint primary key references public.seasons (id),
  outgoing text references public.characters (staff),
  boss text references public.characters (staff),
  how text not null check (how in ('nomination', 'rotation', 'unchanged', 'none')),
  note text,
  at timestamptz not null default now(),
  landed_at timestamptz not null default now(),
  arrival_act uuid references public.acts (id)
);
create table dp_held.handover_dismissals (
  season bigint primary key references dp_held.season_handovers (season),
  admin uuid not null,
  at timestamptz not null default now()
);
create trigger handover_dismissals_no_update before update or delete on dp_held.handover_dismissals for each row execute function public.handover_dismissals_append_only();
alter table dp_held.handover_dismissals enable always trigger handover_dismissals_no_update;
insert into public.seasons (number, starts_at, ends_at) values (9001, '1990-01-01', '1991-01-01'), (9002, '1991-01-01', '1992-01-01');
insert into dp_held.season_handovers (season, how) select id, 'none' from public.seasons where number in (9001, 9002);
insert into dp_held.handover_dismissals (season, admin) select id, gen_random_uuid() from public.seasons where number = 9002;
`;

const asserts = `
do $$
declare
  said text;
begin
  if (select count(*) from season_handovers) <> 2 or (select count(*) from season_handovers where cause = 'rollover' and id is not null) <> 2 or (select count(distinct id) from season_handovers) <> 2 then
    raise exception 'an old handover row is not a roll-over with an id of its own';
  end if;
  if (select count(*) from handover_dismissals) <> 1
    or (select d.handover from handover_dismissals d) is distinct from (select h.id from season_handovers h where h.season = (select id from public.seasons where number = 9002))
    or (select d.season from handover_dismissals d) is distinct from (select id from public.seasons where number = 9002) then
    raise exception 'the old dismissal was not carried to its season''s handover, with its season kept';
  end if;
  begin update handover_dismissals set at = now(); said := null; exception when others then said := sqlstate; end;
  if said is null then raise exception 'the dismissals'' append-only guard did not survive the migration (update accepted)'; end if;
  begin delete from handover_dismissals; said := null; exception when others then said := sqlstate; end;
  if said is null then raise exception 'a dismissal was removed after the migration'; end if;
  begin
    insert into season_handovers (season, how, cause) select id, 'rotation', 'departure' from public.seasons where number = 9002; said := null;
  exception when others then said := sqlstate || ' ' || sqlerrm; end;
  if said is not null then raise exception 'a second row for a season (a departure) was refused: %', said; end if;
  begin insert into season_handovers (season, how) select id, 'rotation' from public.seasons where number = 9002; said := null; exception when others then said := sqlstate; end;
  if said is distinct from '23505' then raise exception 'a second roll-over for a season was accepted (%)', coalesce(said, 'accepted'); end if;
  begin
    insert into handover_dismissals (season, handover, admin) select (select id from public.seasons where number = 9001), h.id, gen_random_uuid() from season_handovers h where h.season = (select id from public.seasons where number = 9002) and h.cause = 'departure'; said := null;
  exception when others then said := sqlstate; end;
  if said is distinct from '23503' then raise exception 'a dismissal whose season is not its handover''s was accepted (%)', coalesce(said, 'accepted'); end if;
end $$;
`;

test('the migration\'s table part, run on old rows, makes each a roll-over with an id and carries each dismissal to its handover', () => {
  const part = tablePart(migration);
  const out = sql(`begin;\n${OLD_SHAPE}\nset local search_path to dp_held, public;\n${part}\n${asserts}\nreset search_path;\nrollback;\nselect 'ok';`);
  assert.ok(out.endsWith('ok'), out);
});
