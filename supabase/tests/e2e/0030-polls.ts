/**
 * Polls, end to end (supabase/migrations/0394_polls.sql and 0395_poll_reads.sql; docs/plans/2026-11-20-polls-plan.md, Task 9, "The masks"):
 * ballots cast through the Edge Function's own core (supabase/functions/act/core.ts) as players, against the real migrations, and every read another
 * account can make of a secret poll, which holds no character of a secret ballot ("A response never proves a private fact").
 *
 * Three accounts: Cy writes the polls; Ann plays two characters (Alpha and Beta), Bob one (Gamma). Alpha, Beta and Gamma write no post anywhere here, so a name or an id
 * of theirs found anywhere in what Bob or Cy reads can only have come from a ballot.
 *
 *  1. The event: what the function broadcasts for each ballot on a secret poll, built from the answer, names no character and no pick; the counts in it count characters.
 *  2. The page (thread_page): for Bob and for Cy the whole page names no one of the three, and the poll's parts are byte for byte the same; Ann's `myBallots` alone differs, and holds her two.
 *  3. poll_ballots: refused in the one sentence, whoever asks. A public poll's is read, so the check can see a name when there is one.
 *  4. The origin (thread_open's origin_place, thread_page's origin): a spun poll is named, a public ballot names its character, a secret ballot (which a spin refuses, so one is planted) names no one.
 *  5. The digest (system_digest): the poll's counts and no one.
 *  6. Refusals: the same words for every caller of every ownership; a closed poll's page keeps the masks.
 *  7. Time: a ballot, and a refusal of one, take as long whether the poll's other voters are the caller's own characters or someone else's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runAction } from '../../functions/act/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { DatabaseError } from '../../functions/_shared/rpc.ts';

type Row = Record<string, unknown>;

const make = (label: string, names: string[]) => {
  const account = sql(`with u as (insert into auth.users (email) values ('polls-e2e-${label}@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
  const characters = names.map((name) => sql(`with c as (insert into characters (owner, name, debuted_at) values ('${account}', '${name}', now()) returning id)
    insert into class_history (character, class_key) select id, 'heel' from c returning character`));
  return { account, characters };
};

/** What a read as a signed-in player returns, or the words the database refused it in. */
const refusal = async (go: () => Promise<unknown>): Promise<string | null> => {
  try { await go(); return null; } catch (e) { return e instanceof DatabaseError ? e.message : String(e); }
};

/** A query's rows as a signed-in player reads them (a view, which a Db's rpc cannot call). */
const readAs = (account: string, query: string): string => sql(`set role authenticated;
  select set_config('request.jwt.claims', :'claims', false) \\g /dev/null
  ${query}`, { claims: JSON.stringify({ sub: account, role: 'authenticated' }) });

/** What a page or a payload names of the three voting characters: ids and names. */
const named = (json: unknown, voters: { id: string; name: string }[]): string[] => {
  const text = JSON.stringify(json);
  return voters.flatMap((v) => [text.includes(v.id) ? v.id : null, text.includes(v.name) ? v.name : null]).filter((x): x is string => x !== null);
};

/** The poll's parts of a page, as every caller reads them (`myBallots` is the caller's own and is left out). */
const parts = (page: Row): Row => {
  const polls = (b: Row) => ({ polls: b.polls, voters: b.voters, votersMore: b.votersMore, voterCast: b.voterCast });
  const origin = page.origin as Row | null | undefined;
  return { ...polls(page), origin: origin ? { ...polls(origin), act: origin.act } : null };
};

test('the masks of a secret poll hold in every read another account can make, and a ballot costs the same whoever owns the other voters', async () => {
  const service = psqlDb();
  await service.rpc('seed_instance', { payload: scratchSeed(instance) });
  const cy = make('cy', ['Pollster Cy']);
  const ann = make('ann', ['Voter Alpha', 'Voter Beta']);
  const bob = make('bob', ['Voter Gamma']);
  const voters = [{ id: ann.characters[0]!, name: 'Voter Alpha' }, { id: ann.characters[1]!, name: 'Voter Beta' }, { id: bob.characters[0]!, name: 'Voter Gamma' }];
  const asCy = { player: psqlDb(cy.account), service };
  const asAnn = { player: psqlDb(ann.account), service };
  const asBob = { player: psqlDb(bob.account), service };
  const db = { cy: psqlDb(cy.account), ann: psqlDb(ann.account), bob: psqlDb(bob.account) };
  // A board of its own: 0021-a-season-of-fangame, which runs before this file in the same scratch database, merges General away.
  sql(`insert into boards (slug, name, description) values ('polls-e2e', '000 Polls', 'Where the polls are started.') on conflict (slug) do nothing`);
  const since = sql('select clock_timestamp()');

  const start = async (title: string, secret: boolean) => {
    const made = await runAction(asCy, instance, { action: 'startThread', board: 'polls-e2e', character: cy.characters[0], title, body: 'Vote, friends.',
      poll: { question: title, options: ['Pipe Frame', 'Badwagon', 'Mach Bike'], pick: 2, secret, lasts: '3 days' } });
    assert.equal(made.status, 200, JSON.stringify(made));
    const { thread, act } = made.body as { thread: { id: string }; act: { id: string } };
    const poll = sql(`select id from acts where kind = 'poll' and target_act_id = '${act.id}'`);
    return { thread: thread.id, post: act.id, poll };
  };
  const cast = (who: { player: ReturnType<typeof psqlDb>; service: ReturnType<typeof psqlDb> }, poll: string, character: string, picks: number[]) =>
    runAction(who, instance, { action: 'castBallot', poll, character, picks });

  const secret = await start('Which kart, in secret?', true);
  const open = await start('Which kart, in the open?', false);

  // ---- 1. The event, as the function builds it from the answer ----
  const shown = (r: Awaited<ReturnType<typeof cast>>) => {
    assert.equal(r.status, 200, JSON.stringify(r));
    return r;
  };
  const one = shown(await cast(asAnn, secret.poll, voters[0]!.id, [0]));
  const two = shown(await cast(asAnn, secret.poll, voters[1]!.id, [0, 1]));
  const three = shown(await cast(asBob, secret.poll, voters[2]!.id, [2]));
  const changed = shown(await cast(asBob, secret.poll, voters[2]!.id, [1]));
  for (const [label, r] of [['first', one], ['second', two], ['third', three], ['changed', changed]] as const) {
    assert.deepEqual(named([r.broadcasts], voters), [], `the ${label} ballot's broadcasts name no character`);
    const events = (r.broadcasts ?? []) as { topic: string; event: string; payload: Row }[];
    assert.deepEqual(events.map((e) => `${e.topic} ${e.event}`), [`thread:${secret.thread} act`, `thread:${secret.thread} poll`], `the ${label} ballot is heard as an Act and as the poll's numbers`);
    const heard = events[0]!.payload;
    assert.equal(heard.character, null, `the ${label} ballot's Act has no character`);
    assert.deepEqual(heard.current_payload, { secret: true }, `the ${label} ballot's Act holds no pick`);
    assert.deepEqual(heard.payload, { secret: true }, `the ${label} ballot's Act holds no pick, as first written either`);
  }
  // The counts count characters: Alpha and Beta are one player and are two voters; Gamma's change moves her one ballot.
  const numbers = (r: Awaited<ReturnType<typeof cast>>) => { const p = (r.broadcasts as unknown as { event: string; payload: Row }[]).find((e) => e.event === 'poll')!.payload; return { counts: p.counts, voters: p.voters, closed: p.closed }; };
  assert.deepEqual(numbers(one), { counts: [1, 0, 0], voters: 1, closed: false });
  assert.deepEqual(numbers(two), { counts: [2, 1, 0], voters: 2, closed: false }, 'two characters of one player are two voters');
  assert.deepEqual(numbers(three), { counts: [2, 1, 1], voters: 3, closed: false });
  assert.deepEqual(numbers(changed), { counts: [2, 2, 0], voters: 3, closed: false }, 'a changed ballot is counted once, at its latest');
  // The same on a public poll's event: its Act names the character, as a public ballot does.
  const publicOne = shown(await cast(asAnn, open.poll, voters[0]!.id, [2]));
  assert.equal(((publicOne.broadcasts as unknown as { payload: Row }[])[0]!.payload).character, voters[0]!.id, 'a public ballot\'s Act names its character, so the check above can see a name');
  shown(await cast(asBob, open.poll, voters[2]!.id, [0, 2]));

  // ---- 2. The page ----
  const page = async (who: ReturnType<typeof psqlDb>, thread: string) => await who.rpc<Row>('thread_page', { in_thread: thread, in_page: 1, in_seq: null, per_page: 100, effect_cards: [] });
  const [forBob, forCy, forAnn] = [await page(db.bob, secret.thread), await page(db.cy, secret.thread), await page(db.ann, secret.thread)];
  // The page names no voter to a reader whose own ballot is not in question: Cy cast none, and Bob's own Gamma is his to see, so Bob's is checked for the other two.
  assert.deepEqual(named(forCy, voters), [], 'the page Cy reads names no voter');
  const { myBallots: bobsOwn, ...bobsRest } = forBob as Row;
  assert.deepEqual(named(bobsRest, voters), [], 'the page Bob reads names no voter, his own Gamma included, outside his own ballots');
  assert.deepEqual(named(forBob, [voters[0]!, voters[1]!]), [], 'Bob\'s page, his own ballots included, names neither of Ann\'s characters');
  assert.deepEqual(parts(forBob), parts(forCy), 'the poll\'s parts are the same for every reader');
  assert.deepEqual(parts(forAnn), parts(forCy), 'and for a reader who cast two of the ballots');
  const polls = (forCy.polls as Row[]);
  assert.equal(polls.length, 1);
  assert.deepEqual({ counts: polls[0]!.counts, voters: polls[0]!.voters, closed: polls[0]!.closed }, { counts: [2, 2, 0], voters: 3, closed: false }, 'the page counts characters');
  assert.deepEqual(forCy.voters, [], 'a secret poll lists no voter');
  assert.deepEqual(forCy.myBallots, [], 'Cy cast none');
  assert.deepEqual((bobsOwn as Row[]).map((m) => [m.character, m.picks]), [[voters[2]!.id, [1]]], 'Bob reads his own counted ballot, and only that');
  assert.deepEqual((forAnn.myBallots as Row[]).map((m) => [m.character, m.picks]).sort(), [[voters[0]!.id, [0]], [voters[1]!.id, [0, 1]]].sort(), 'Ann reads her own two');
  // On the public poll the same page lists them: the voters part is where a name would be.
  const openPage = await page(db.cy, open.thread);
  assert.deepEqual((openPage.voters as Row[]).map((v) => v.character).sort(), [voters[0]!.id, voters[2]!.id].sort(), 'a public poll\'s page lists its voters');

  // ---- 3. poll_ballots ----
  const words = new Set<string | null>();
  for (const who of Object.values(db)) words.add(await refusal(() => who.rpc('poll_ballots', { poll: secret.poll })));
  assert.deepEqual([...words], ['poll_ballots: that poll\'s ballots are secret'], 'a secret poll\'s ballots are refused in one sentence for every caller');
  const listed = await db.bob.rpc<{ ballots: Row[] }>('poll_ballots', { poll: open.poll });
  assert.equal(listed.ballots.length, 2, 'a public poll\'s ballots are listed');

  // ---- 4. The origin ----
  const spunPoll = await runAction(asBob, instance, { action: 'spin', origin: secret.poll, character: voters[2]!.id, title: 'On the secret poll' });
  assert.equal(spunPoll.status, 200, JSON.stringify(spunPoll));
  const spunThread = (spunPoll.body as { thread: { id: string } }).thread.id;
  const refused = await runAction(asAnn, instance, { action: 'spin', origin: one.body && (one.body as { act: { id: string } }).act.id, character: voters[0]!.id, title: 'On a ballot' });
  assert.equal(refused.status, 400, 'a secret ballot cannot be spun');
  const place = (account: string, thread: string) => JSON.parse(readAs(account, `select origin_place from thread_open where id = '${thread}';`) || 'null') as Row | null;
  assert.deepEqual(place(bob.account, spunThread), { kind: 'poll', question: 'Which kart, in secret?', on: { kind: 'post', thread: secret.thread, title: 'Which kart, in secret?', seq: 1 }, board: sql(`select board from threads where id = '${secret.thread}'`) }, 'a spun poll is named by its question');
  // A public ballot is an origin that names its character; a secret one, which no spin writes, is planted here as a direct write would, and names no one.
  const ballotOf = (poll: string, character: string) => sql(`select id from acts where kind = 'ballot' and target_act_id = '${poll}' and character = '${character}' order by created_at desc, id desc limit 1`);
  const origins = {
    open: ballotOf(open.poll, voters[0]!.id),
    secret: ballotOf(secret.poll, voters[0]!.id),
  };
  const plant = (ballot: string, title: string) => {
    const t = sql(`with t as (insert into threads (board, title, origin_act_id) select b.id, '${title}', '${ballot}' from boards b where b.slug = 'polls-e2e' returning id)
      insert into acts (character, kind, thread, target_act_id, payload) select '${voters[2]!.id}', 'spin', t.id, '${ballot}', jsonb_build_object('title', '${title}', 'body', 'Spun.') from t returning thread`);
    return t;
  };
  const fromOpen = plant(origins.open, 'From a public ballot');
  const fromSecret = plant(origins.secret, 'From a secret ballot');
  const openPlace = place(cy.account, fromOpen);
  assert.deepEqual((openPlace?.character as Row | undefined)?.name, 'Voter Alpha', 'a public ballot as an origin names its character');
  for (const who of [cy, bob, ann]) {
    assert.equal(readAs(who.account, `select count(*) from thread_open where id = '${fromSecret}';`), '1', 'the thread spun from a secret ballot is listed, so the null below is no missing row');
    const p = place(who.account, fromSecret);
    assert.equal(p, null, 'a secret ballot as an origin is named by no one');
    assert.deepEqual(named(p, voters), []);
  }
  for (const who of [db.cy, db.bob]) {
    const origin = await page(who, fromSecret);
    assert.deepEqual(named(origin, [voters[0]!, voters[1]!]), [], 'the page of a thread spun from a secret ballot names the voter of neither');
  }
  assert.deepEqual(parts(await page(db.cy, fromSecret)), parts(await page(db.bob, fromSecret)), 'and its poll parts are the same for every reader');

  // ---- 5. The digest ----
  const digest = await service.rpc<{ excerpts: Row[] }>('system_digest', { since: new Date(Date.parse(since) - 60_000).toISOString(), until: new Date(Date.now() + 60_000).toISOString() });
  // 0433's standouts name the characters who cast the most PUBLIC ballots (top three, ties by name: in a database that earlier files left public ballots in, Gamma may be crowded out by a name that sorts first, so only Alpha and Gamma are allowed there,
  // not required), and the digest's `characters` list names whoever the digest names. Beta, who voted on the secret poll alone, is named nowhere, and no voter is named anywhere else.
  const { standouts, characters: shownChars, ...rest } = digest as unknown as { standouts: Record<string, Row[]>; characters: Row[] } & Record<string, unknown>;
  assert.deepEqual(named(digest, [voters[1]!]), [], 'the digest names no voter of a secret poll alone');
  // The one other place a public voter appears is the spin planted from a public ballot above, whose origin names its character as the board's own origin_place does (checked at 4); the spin from the secret ballot names no one.
  const { spins, ...others } = rest as { spins: { title: string }[] } & Record<string, unknown>;
  assert.deepEqual(named(others, voters), [], 'no voter, public or secret, is named outside the standouts, the characters they add and the spin from a public ballot');
  assert.deepEqual(named(spins.filter((x) => x.title !== 'From a public ballot'), voters), [], 'the spin from a secret ballot names no one');
  assert.deepEqual(named(spins.filter((x) => x.title === 'From a public ballot'), voters), [voters[0]!.id, voters[0]!.name], 'the spin from a public ballot names its character and no other voter');
  assert.deepEqual(Object.entries(standouts).filter(([k, v]) => k !== 'days' && k !== 'ballots' && k !== 'spun' && named(v, voters).length > 0).map(([k]) => k), [], 'a voter is named in the ballots standouts and the spun ones alone (Gamma wrote the two spins planted at 4; no voter writes a post, card or poll here)');
  assert.deepEqual(named(shownChars.filter((c) => !JSON.stringify(standouts).includes(String(c.id))), voters), [], 'the characters list names a voter only where the standouts do');
  const excerpt = digest.excerpts.find((e) => e.act === secret.post);
  assert.deepEqual(excerpt?.poll, { question: 'Which kart, in secret?', options: [{ text: 'Pipe Frame', count: 2 }, { text: 'Badwagon', count: 2 }, { text: 'Mach Bike', count: 0 }], closed: false }, 'the digest carries the poll\'s counts of characters');

  // ---- 6. Refusals ----
  // The same words for every caller, whoever owns the other voters: Alpha's sibling has voted, Gamma has, and Cy's character and a stranger's have not.
  const dee = make('dee', ['Voter Delta']);
  const callers = [{ db: db.ann, c: ann.characters[0]! }, { db: db.ann, c: ann.characters[1]! }, { db: db.bob, c: bob.characters[0]! }, { db: db.cy, c: cy.characters[0]! }, { db: psqlDb(dee.account), c: dee.characters[0]! }];
  const bad: [string, number[]][] = [['an option out of range', [9]], ['a repeated option', [1, 1]], ['too many options', [0, 1, 2]], ['a negative option', [-1]]];
  for (const [what, picks] of bad) {
    const said = new Set<string | null>();
    for (const w of callers) said.add(await refusal(() => w.db.rpc('cast_ballot', { poll: secret.poll, through: w.c, picks })));
    assert.equal(said.size, 1, `${what} is refused in the same words for every caller: ${JSON.stringify([...said])}`);
    assert.deepEqual([...said], ['cast_ballot: pick up to 2 options'], what);
  }
  // The caller's own character is the one fact a refusal may read (acting): another player's character, one that is not there and a staff-free stranger's are refused in one sentence, whoever owns them.
  const unowned = new Set<string | null>();
  for (const through of [ann.characters[0]!, '00000000-0000-4000-8000-0000000000aa', cy.characters[0]!]) unowned.add(await refusal(() => db.bob.rpc('cast_ballot', { poll: secret.poll, through, picks: [0] })));
  assert.equal(unowned.size, 1, `Bob casting through Ann's character, through none and through Cy's is refused in the same words: ${JSON.stringify([...unowned])}`);
  assert.match([...unowned][0] ?? '', /^cast_ballot: .+/, 'and it is a refusal');
  const nothing = new Set<string | null>();
  for (const w of callers) nothing.add(await refusal(() => w.db.rpc('cast_ballot', { poll: '00000000-0000-4000-8000-000000000000', through: w.c, picks: [0] })));
  assert.equal(nothing.size, 1, 'a poll that is not there is refused in the same words for every caller');
  // Cy closes it early; every caller is then told the same, and a closed secret poll's page keeps the masks.
  const closed = await runAction(asCy, instance, { action: 'closePoll', poll: secret.poll, character: cy.characters[0] });
  assert.equal(closed.status, 200, JSON.stringify(closed));
  assert.deepEqual(named(closed.broadcasts, voters), [], 'the close\'s broadcasts name no voter');
  const late = new Set<string | null>();
  for (const w of callers) late.add(await refusal(() => w.db.rpc('cast_ballot', { poll: secret.poll, through: w.c, picks: [0] })));
  assert.deepEqual([...late], ['cast_ballot: that poll has closed'], 'a closed poll refuses every caller in the same words');
  const closedPage = await page(db.bob, secret.thread);
  assert.equal((closedPage.polls as Row[])[0]!.closed, true);
  assert.deepEqual(named(closedPage, [voters[0]!, voters[1]!]), [], 'a closed secret poll\'s page names neither of Ann\'s characters to Bob');
  assert.deepEqual(parts(closedPage), parts(await page(db.cy, secret.thread)), 'and is the same for every reader');

  // ---- 7. Time ----
  // Four secret polls with the same thousands of voters: two open, two closed; on one open and one closed poll the voters are Ann's Timer's own characters, on the others Dee's. Timer casts a ballot on each open
  // poll and is refused on each closed one (each refusal is checked to be the closed poll's sentence), over and over, every try rolled back, interleaved. What each try read is counted by the tuples the transaction has
  // fetched (medians, within a few of each other: see the asserts), and the time by medians. Nothing a ballot or a refusal reads or takes may depend on who owns another character.
  const n = 2000;
  const timer = make('timer', ['Timer One']);
  // (Past the six characters a player may run, which a trigger holds: the many here are only so that what a read of them costs is measurable. Disabled and enabled in one transaction.)
  const crowd = (account: string, label: string) => sql(`begin;
    alter table characters disable trigger characters_within_cap;
    with c as (insert into characters (owner, name, debuted_at) select '${account}', '${label} ' || g, now() from generate_series(1, ${n}) g returning id)
      select string_agg(id::text, ',') from c \\gset
    alter table characters enable trigger characters_within_cap;
    commit;
    select :'string_agg'`).split(',');
  const kin = crowd(timer.account, 'Kin');
  const strangers = crowd(dee.account, 'Stranger');
  const timed: Record<string, string> = {};
  for (const [label, who, closes] of [['kinCast', kin, false], ['strangersCast', strangers, false], ['kinRefused', kin, true], ['strangersRefused', strangers, true]] as const) {
    const made = await start(`Timing, ${label}`, true);
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at)
      select c, 'ballot', '${made.thread}', '${made.poll}', '{"picks": [0]}', now() from unnest('{${who.join(',')}}'::uuid[]) c`);
    if (closes) sql(`insert into acts (character, kind, thread, target_act_id, payload) values ('${cy.characters[0]}', 'poll_close', '${made.thread}', '${made.poll}', '{"by": "author"}')`);
    timed[label] = made.poll;
  }
  sql(`create or replace function tests.ballot_timing(account uuid, caller uuid, polls uuid[], tries integer) returns jsonb language plpgsql as $$
    declare t0 timestamptz; r0 bigint; r1 bigint; ms double precision[][]; rows bigint[][]; i integer; k integer; out jsonb := '{}';
    function_dummy integer;
    begin
      ms := array_fill(0::double precision, array[4, tries + 1]); rows := array_fill(0::bigint, array[4, tries + 1]);
      perform tests.become(account);
      -- Index reads only: a sequential scan of a small table (threads) stops at the row it wants, so its tuple count is where that row sits in the heap, which differs from one poll's thread to the next and says nothing of who owns a voter.
      set local enable_seqscan = off;
      -- Try 0 is a warm-up and is not measured: the first read of rows a statement has just written finds them still to be marked (hint bits, index entries not yet known dead), and
      -- on a first try that has read one tuple more than the tries after it. Every try that is kept starts from the same state.
      for i in 0..tries loop
        for k in 1..4 loop
          select coalesce(sum(coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)), 0) into r0 from pg_stat_xact_user_tables;
          t0 := clock_timestamp();
          begin
            perform cast_ballot(polls[k], caller, '{0}');
            if k > 2 then raise exception 'a closed poll took a ballot'; end if;
            ms[k][i + 1] := extract(epoch from clock_timestamp() - t0) * 1000;
            select coalesce(sum(coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)), 0) - r0 into r1 from pg_stat_xact_user_tables; rows[k][i + 1] := r1;
            raise exception 'undone' using errcode = 'P0001';
          exception when others then
            if k <= 2 and sqlerrm <> 'undone' then raise; end if;
            if k > 2 then
              ms[k][i + 1] := extract(epoch from clock_timestamp() - t0) * 1000;
              if sqlerrm <> 'that poll has closed' then raise exception 'a closed poll was refused in other words: %', sqlerrm; end if;
              select coalesce(sum(coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)), 0) - r0 into r1 from pg_stat_xact_user_tables; rows[k][i + 1] := r1;
            end if;
          end;
        end loop;
      end loop;
      perform tests.unbecome();
      for k in 1..4 loop
        out := out || jsonb_build_object('ms' || k, (select (array_agg(x order by x))[tries / 2 + 1] from (select ms[k][g] x from generate_series(2, tries + 1) g) q),
                                         'rowsMed' || k, (select (array_agg(x order by x))[tries / 2 + 1] from (select rows[k][g] x from generate_series(2, tries + 1) g) q),
                                         'rowsMin' || k, (select min(rows[k][g]) from generate_series(2, tries + 1) g), 'rowsMax' || k, (select max(rows[k][g]) from generate_series(2, tries + 1) g));
      end loop;
      return out;
    end $$;`.replace('    function_dummy integer;\n', ''));
  const tries = 30;
  const m = JSON.parse(sql(`select tests.ballot_timing('${timer.account}', '${timer.characters[0]}', array['${timed.kinCast}', '${timed.strangersCast}', '${timed.kinRefused}', '${timed.strangersRefused}']::uuid[], ${tries})`)) as Record<string, number>;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  console.log(`# ballot timing, ${n} voters a poll, medians of ${tries} in ms: cast kin ${round(m.ms1!)} strangers ${round(m.ms2!)}; refused kin ${round(m.ms3!)} strangers ${round(m.ms4!)}; tuples read: cast ${m.rowsMin1}-${m.rowsMax1} / ${m.rowsMin2}-${m.rowsMax2}, refused ${m.rowsMin3}-${m.rowsMax3} / ${m.rowsMin4}-${m.rowsMax4}`);
  for (const [a, b, what] of [[1, 2, 'a ballot'], [3, 4, 'a refusal']] as const) {
    // Not exact: every try is undone (an exception), and each undone ballot leaves a dead tuple and a dead index entry that a later try may or may not step over before the index marks it dead, so a try's
    // idx_tup_fetch wanders by one or two mid-loop (CI printed 2023-2023 against 2023-2025). A read that grew with the poll's 2000 voters, or with who owns them, would be off by hundreds, so what is held is
    // that the polls' median counts are within 3 of each other and that no poll's own spread passes 3.
    assert.ok(Math.abs(m[`rowsMed${a}`]! - m[`rowsMed${b}`]!) <= 3, `${what} reads the same tuples whoever owns the poll's other voters (medians ${m[`rowsMed${a}`]} and ${m[`rowsMed${b}`]})`);
    for (const k of [a, b]) assert.ok(m[`rowsMax${k}`]! - m[`rowsMin${k}`]! <= 3, `${what} reads about the same tuples every time (poll ${k} read ${m[`rowsMin${k}`]} to ${m[`rowsMax${k}`]})`);
    const ratio = m[`ms${a}`]! / m[`ms${b}`]!;
    assert.ok(ratio > 0.6 && ratio < 1.67, `${what} takes the same time whoever owns the other voters (medians ${m[`ms${a}`]} ms and ${m[`ms${b}`]} ms, ratio ${ratio.toFixed(2)})`);
  }
});
