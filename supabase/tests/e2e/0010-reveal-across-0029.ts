/**
 * A season revealed before supabase/migrations/0029_reveal_rolls_over.sql keeps its Acts as they were
 * written, every class in them ("Append-only"); a season revealed after it shows only what was made
 * public (the class reveal plan, Task 3). On a database of its own, made here beside the scratch one
 * tools/test-sql.mjs made, from the migrations before 0029 and the test instance's fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { databaseBefore } from './psql-db.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

test('a season revealed before 0029 keeps its Acts, every class in them; the next is revealed by the new rule', () => {
  // A database as the migrations before 0029 left it, from the runner's snapshot of its replay; only the migrations from 0029 on are applied here.
  const old = databaseBefore('0029', 'reveal');
  assert.equal(old.crossing, '0029_reveal_rolls_over.sql', 'the migration this holds is there');
  const db = new URL(old.url);
  try {
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8'));
    // Season 1 revealed before the migration: a character with a silent Turn in it.
    psqlOn(db.toString(), `
      do $$
      declare a uuid := tests.character(tests.account('old-reveal'), 'Revealed Before', 'alpha', '2000-01-02');
      begin
        insert into class_history (character, class_key, started_at) values (a, 'beta', '2000-02-01');
        perform reveal_season('2000-01-01'::timestamptz + span_interval(setting('seasonLength')));
      end $$;`);
    const before = psqlOn(db.toString(), `select jsonb_agg(to_jsonb(a) order by a.seq)::text from acts a where a.kind = 'reveal'`);
    assert.match(before, /"classes": \[\{"from": "[^"]+", "class": "alpha"\}, \{"from": "[^"]+", "class": "beta"\}\]/, 'the old reveal showed every class, the silent Turn among them');
    for (const m of old.remaining) psqlOn(db.toString(), m);
    assert.equal(psqlOn(db.toString(), `select jsonb_agg(to_jsonb(a) order by a.seq)::text from acts a where a.kind = 'reveal'`), before, 'the earlier season\'s reveal is as it was written');
    // The migrations that came after copied the old reveal's facts into the season's results, and left its Acts alone (0099): the old reveal
    // showed every class in `classes` and no `shown`, so the character shows nothing public.
    assert.equal(psqlOn(db.toString(), `select name || '/' || place || '/' || shown::text from season_results where name = 'Revealed Before' and season = (select id from seasons where number = 1)`), 'Revealed Before/1/[]', 'the old reveal is copied into the results');
    assert.notEqual(psqlOn(db.toString(), `select results_at from seasons where number = 1`), '', 'and the season says when its results landed');
    // Season 2 revealed after it: the same character, whose player made nothing public, shows no class.
    const after = psqlOn(db.toString(), `
      select reveal_season(starts_at + span_interval(setting('seasonLength'))) is not null from seasons where ends_at is null;
      select to_jsonb(r)::text from season_results r where r.name = 'Revealed Before' and r.season = (select id from seasons where number = 2);`).split('\n').at(-1)!;
    const entry = JSON.parse(after);
    assert.deepEqual(entry.shown, [], 'nothing was made public');
    assert.equal('classes' in entry, false);
    assert.doesNotMatch(after, /alpha|beta/);
    assert.equal(psqlOn(db.toString(), `select jsonb_agg(to_jsonb(a) order by a.seq)::text from acts a where a.kind = 'reveal'`), before, 'and no reveal Act was written for the second season');
  } finally {
    old.drop();
  }
});
