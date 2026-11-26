/**
 * A Turn waiting across supabase/migrations/0028_loud_classes.sql: asked "revealed" before it, it
 * takes effect after it as asked, announced with its old class named, and so does an announced Turn queued the same way
 * after it and before 0435 (which posts a Turn when it is asked, and dropped turn()'s three-argument form).
 * On a database of its own, made here beside the scratch one tools/test-sql.mjs made, from the
 * migrations before 0028, so the row is written by the schema that wrote such rows.
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

test('a Turn asked "revealed" before 0028 takes effect after it with its old class named, as asked', () => {
  // A database as the migrations before 0028 left it, from the runner's snapshot of its replay; only the migrations from 0028 on are applied here.
  const old = databaseBefore('0028', 'turns');
  assert.equal(old.crossing, '0028_loud_classes.sql', 'the migration this holds is there');
  const db = new URL(old.url);
  try {
    // A Turn waiting, asked "revealed" as a client before 0028 asked it.
    // The test instance's settings, as supabase/tests/setup/fixtures.sql writes them.
    const fixtures = fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8');
    const settings = fixtures.indexOf('insert into settings');
    psqlOn(db.toString(), fixtures.slice(settings, fixtures.indexOf("');\n", settings) + 3));
    psqlOn(db.toString(), `
      insert into class_kinds (key, name) values ('alpha', 'Alpha'), ('beta', 'Beta');
      insert into boards (slug, name, is_system) values ('general', 'General', false), ('the-system', 'The System', true);
      insert into seasons (number, starts_at) values (1, now() - interval '100 days');
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'old@test.invalid');
      insert into accounts (id) values ('00000000-0000-4000-8000-000000000001');
      insert into characters (id, owner, name, created_at, debuted_at) values
        ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'Asked Before', now() - interval '60 days', now() - interval '60 days'),
        ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'Asked After', now() - interval '60 days', now() - interval '60 days');
      insert into class_history (character, class_key, started_at) values
        ('00000000-0000-4000-8000-0000000000c1', 'alpha', now() - interval '60 days'), ('00000000-0000-4000-8000-0000000000c2', 'alpha', now() - interval '60 days');
      insert into pending_turns (character, class_key, loudness) values ('00000000-0000-4000-8000-0000000000c1', 'beta', 'revealed');`);
    for (const m of old.remaining) psqlOn(db.toString(), m);

    assert.equal(psqlOn(db.toString(), `select loudness || ',' || show_from || ',' || show_to from pending_turns where character = '00000000-0000-4000-8000-0000000000c1'`), 'announced,true,false',
      'a waiting "revealed" Turn becomes announced, naming its old class');
    // An older client's "revealed" no longer reaches turn() (0435 dropped the three-argument form, and an announced Turn is posted when it is asked); a Turn of the same
    // shape queued before 0435 is a row with no announcement, which the settlement writes the old way.
    psqlOn(db.toString(), `
      insert into pending_turns (character, class_key, loudness, show_from, show_to) values ('00000000-0000-4000-8000-0000000000c2', 'beta', 'announced', true, false);`);
    // Two statements: the second sees the announcements the first wrote.
    const written = psqlOn(db.toString(), `select masks_change(now() + interval '1 minute')`);
    assert.ok(written, 'the settlement announces the Turns');
    for (const who of ['Asked Before', 'Asked After']) {
      const announced = JSON.parse(psqlOn(db.toString(), `select a.payload::text from acts a join characters c on c.id = a.character where a.kind = 'announce' and c.name = '${who}'`));
      assert.equal(announced.what, 'turn', `${who}'s announcement is of a Turn`);
      assert.equal(announced.was, 'alpha', `${who}'s Turn names its old class: ${JSON.stringify(announced)}`);
      assert.equal(announced.class, undefined, `${who}'s Turn names no new class`);
    }
    assert.equal(psqlOn(db.toString(), `select count(*) from acts where kind = 'unmask'`), '0', 'naming the old class alone writes no unmask');
  } finally {
    old.drop();
  }
});
