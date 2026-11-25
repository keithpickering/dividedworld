-- pool_read reads by key, never by a plan (docs/plans/2026-11-23-whole-posts-plan.md, Task 2 follow-up; the read it replaces is 0421_whole_posts.sql, section 3).
-- 0421's pool_read was one SQL statement whose bounds held only while the planner chose the plan its author had in mind. With statistics on `acts` older than the rows a thread had just been given (a new instance, a restored one, a
-- big import before autovacuum has run) it priced quote_refs, whose rows it believed to be one, as the outer side of a nested loop and walked the whole thread's posts (acts_patrol_posts, a merge append through acts_public) once
-- for each seed: the hop and each post's `quotes` read ~4,400 rows of `acts` for every one of ~90 seeds in a 4,000-post thread, and the same shape over a larger table is every row of `acts`, once per seed. 0421's own test failed
-- on exactly that in CI (`pool_read reads 1585819 rows of acts in a 4,000-post thread ...`) while passing on runs whose statistics happened to be fresh. A cost estimate is not a bound.
--
-- It is rebuilt here so that no read of `acts` is larger than its key says, on any plan the planner might take, save the one estimate named in the guarantee below (which would read a thread, never the table):
--   - a post is read by its id: one equality on acts' primary key through acts_public, one statement for one id (pool_probe); the thread, the kind and the hidden flag are checked on the row it returns, not in the query, so there
--     is no other index a cost estimate could prefer. The seeds, the window, the named posts, the persona's own, the replies, the quoted posts and the page are each a loop of those probes over a list bounded by a constant;
--   - the newest `window` posts are found by number: pool_seq_ids probes the unique key acts_thread_seq_key (thread, seq) once for each of the thread's last 2 x window + 60 numbers (at most 460), newest first;
--   - a post's quotes are the rows of quote_refs for its act (the primary key's leading column), each quoted post probed by id (pool_quoted) and the newest 10 kept in the function: quote_refs is never joined to the view;
--   - the persona's newest posts and the replies to a post are the two ordered, limited, single-table index reads of 0421 (pool_own_post_ids, pool_reply_ids), redefined below so that one index is the only plan that does not cost
--     a disabled node. 0421's versions were bounded only while the planner priced them well: where the persona dominates `acts` (30,000 posts in another thread, 60 old posts among 4,600 in this one) and the price of a random
--     read tipped the estimate, it took the whole table in a sort (40,600 rows of `acts` for 40 ids in 0425's test, at random_page_cost 100), and once, with another row layout, acts_created backward with a filter.
-- Same signature, same security (security definer, owned by kayfabb_digest, the service role's only, search_path = public, pg_temp, jit off) and the same result as 0421's pool_read; 0421's test passes unchanged, and
-- supabase/tests/0425-pool-read-bounded.sql sets the statistics that made it fail and shows this one bounded (and 0421's definition, kept there as a copy, failing).
-- The exact guarantee of the two helpers: each runs with enable_seqscan, enable_bitmapscan, enable_sort and enable_incremental_sort off. The newest n by (created_at desc, id desc) can then be had in order without a disabled node
-- only from the index whose key is that order under the query's equalities: acts_thread_posts (thread, character, created_at, id) where kind = 'post' for the persona's posts, acts_target (target_act_id, kind, created_at desc, id desc)
-- where kind <> 'edit' for the replies. A table scan, a bitmap scan, acts_created, acts_character and acts_posts_by_time can serve the filter only by sorting what they kept, and each then costs a disabled node, which Postgres 16 prices
-- at +1e10 (a path with no such node wins unless its own estimate is past that, which a limit of at most 100 rows is not). One other path has no disabled node: acts_patrol_posts (thread, created_at desc, id desc) where kind in
-- ('post', 'spin') gives the thread's posts in the requested order with the character, or the target, as a filter, and reads the thread's posts until it has n. Between it and the ordered index the choice rests on the estimate,
-- not on a disabled node: the ordered index is the cheaper by about a tenth in the spec review's measurements, and was taken under every setting tried (random_page_cost 0.01 to 100, cpu costs zeroed, empty statistics, a persona
-- holding 99% of the table), but no setting forbids the other. Taken, it would read at most the thread's posts and spins, never the rest of `acts`. With the ordered index, the rows of `acts` read are the rows returned, n at most 100
-- (and, for replies, the post's replies in other threads that sit before them in the index, of which the game makes none: a reply is made in its post's thread). It is a guarantee over the two indexes as 0004 and 0421 define them: an instance without one has no ordered path, and the helper then reads what it must, which a build or
-- drift check of the indexes would show and is not part of this file.
-- Ways out: no state is added. Masks: the same Acts and characters are read through the same views as before; nothing here reads an owner, a class or who reacted.

-- The ids of the Acts numbered lo..hi in a thread, newest number first, and nothing else (as pool_own_post_ids: the digest role has no column of `acts`). One probe of the unique key (thread, seq) for each number, at most 500.
create function pool_seq_ids(in_thread uuid, lo integer, hi integer) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp set enable_seqscan = off as $$
declare
  ids uuid[] := '{}'::uuid[];
  s integer;
  got uuid;
begin
  if in_thread is null or lo is null or hi is null then return ids; end if;
  for s in reverse hi .. greatest(lo, hi - 499) loop
    got := null;
    select a.id into got from acts a where a.thread = in_thread and a.seq = s;
    if got is not null then ids := ids || got; end if;
  end loop;
  return ids;
end $$;
revoke execute on function pool_seq_ids(uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function pool_seq_ids(uuid, integer, integer) to kayfabb_digest;

-- 0421's two helpers, same signatures, owner and grants (create or replace keeps them), the n newest ids by (created_at desc, id desc) as before, with the settings above: see the guarantee in this file's header.
-- enable_indexscan stays on because the ordered index is an index scan.
create or replace function pool_own_post_ids(in_thread uuid, by_character uuid, n integer) returns uuid[]
language sql stable security definer set search_path = public, pg_temp set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
  select coalesce(array(select y.id from acts y where y.thread = in_thread and y.kind = 'post' and y.character = by_character order by y.created_at desc, y.id desc limit least(greatest(coalesce(n, 0), 0), 100)), '{}'::uuid[])
$$;
create or replace function pool_reply_ids(in_thread uuid, to_act uuid, n integer) returns uuid[]
language sql stable security definer set search_path = public, pg_temp set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
  select coalesce(array(select y.id from acts y where y.target_act_id = to_act and y.thread = in_thread and y.kind = 'post' order by y.created_at desc, y.id desc limit least(greatest(coalesce(n, 0), 0), 100)), '{}'::uuid[])
$$;

grant create on schema public to kayfabb_digest;

-- One Act, by its id, through acts_public; ok is false when there is none. The caller checks the thread, the kind and `hidden`.
-- `ref` is the id its quote_refs hang on: its latest edit's id when it has one (as acts_public's current_payload is), else its own.
create function pool_probe(pid uuid, out ok boolean, out thread uuid, out kind text, out seq integer, out created_at timestamptz, out author uuid, out target uuid, out hidden boolean, out body text, out ref uuid)
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
declare
  r record;
begin
  ok := false;
  if pid is null then return; end if;
  select a.id, a.thread, a.kind, a.seq, a.created_at, a."character", a.target_act_id, a.hidden, a.current_payload into r from acts_public a where a.id = pid;
  if r.id is null then return; end if;
  ok := true; thread := r.thread; kind := r.kind; seq := r.seq; created_at := r.created_at; author := r."character"; target := r.target_act_id; hidden := r.hidden;
  body := coalesce(r.current_payload ->> 'body', '');
  select e.id into ref from acts_public e where e.kind = 'edit' and e.target_act_id = pid order by e.created_at desc, e.id desc limit 1;
  ref := coalesce(ref, pid);
end $$;

-- The posts of the thread that the Act `of_ref` quotes, newest 10, as pool_read says them: public, not hidden, a post or the thread's spin opener.
create function pool_quoted(in_thread uuid, of_ref uuid) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
declare
  q uuid;
  p record;
  ids uuid[] := '{}'::uuid[];
  ats timestamptz[] := '{}'::timestamptz[];
begin
  for q in select r.quoted from quote_refs r where r.act = of_ref loop
    select * into p from pool_probe(q);
    if p.ok and p.thread = in_thread and p.hidden is not true and (p.kind = 'post' or (p.kind = 'spin' and p.seq = 1)) then
      ids := ids || q; ats := ats || p.created_at;
    end if;
  end loop;
  return coalesce(array(select u.id from unnest(ids, ats) as u(id, at) order by u.at desc, u.id desc limit 10), '{}'::uuid[]);
end $$;

-- The rows of pool_read's `posts`, in no order: the seeds and the one hop, each with its quotes.
create function pool_read_rows(in_thread uuid, staff_key text, named uuid[], "window" integer)
returns table (act uuid, seq integer, at timestamptz, author uuid, name text, pronouns jsonb, body text, reply_to uuid, quotes jsonb)
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
declare
  me uuid := (select c.id from characters_public c where c.staff = pool_read_rows.staff_key);
  w integer := least(greatest(coalesce("window", 0), 0), 200);
  last_n integer := coalesce((select t.last_seq from thread_list t where t.id = in_thread), 0);
  seeds uuid[] := '{}'::uuid[];
  seen uuid[];
  mine_ids uuid[]; mine_ats timestamptz[];
  rep_ids uuid[]; rep_ats timestamptz[];
  hop uuid[] := '{}'::uuid[];
  x uuid;
  m uuid;
  p record;
  who record;
  kept integer := 0;
  chars jsonb := '{}'::jsonb;
  qs uuid[];
  opener uuid[] := pool_seq_ids(in_thread, 1, 1);
begin
  -- The opener.
  foreach x in array opener loop
    select * into p from pool_probe(x);
    if p.ok and p.thread = in_thread and p.seq = 1 and p.kind in ('post', 'spin') and p.hidden is not true then seeds := seeds || x; end if;
  end loop;
  -- The newest `window` posts, by number: only the thread's last 2 x window + 60 numbers are looked at (hidden posts and the few numbered Acts that are no post are inside that margin).
  if w > 0 then
    foreach x in array pool_seq_ids(in_thread, greatest(last_n - 2 * w - 60 + 1, 1), last_n) loop
      select * into p from pool_probe(x);
      if p.ok and p.thread = in_thread and p.kind = 'post' and p.hidden is not true then
        seeds := seeds || x; kept := kept + 1;
        exit when kept >= w;
      end if;
    end loop;
  end if;
  -- What is named (the first 50).
  if named is not null then
    foreach x in array named[1:50] loop
      select * into p from pool_probe(x);
      if p.ok and p.thread = in_thread and p.kind = 'post' and p.hidden is not true then seeds := seeds || x; end if;
    end loop;
  end if;
  if me is not null then
    -- The persona's newest 20 posts in the thread (a spin it started counts as one): the newest 40 ids by acts_thread_posts' order, a margin for the few acts_public leaves out.
    mine_ids := '{}'::uuid[]; mine_ats := '{}'::timestamptz[];
    foreach x in array pool_own_post_ids(in_thread, me, 40) loop
      select * into p from pool_probe(x);
      if p.ok and p.thread = in_thread and p.author = me and p.kind = 'post' and p.hidden is not true then mine_ids := mine_ids || x; mine_ats := mine_ats || p.created_at; end if;
    end loop;
    foreach x in array opener loop
      select * into p from pool_probe(x);
      if p.ok and p.thread = in_thread and p.seq = 1 and p.kind = 'spin' and p.author = me and p.hidden is not true then mine_ids := mine_ids || x; mine_ats := mine_ats || p.created_at; end if;
    end loop;
    mine_ids := coalesce(array(select u.id from (select distinct k.id, k.at from unnest(mine_ids, mine_ats) as k(id, at)) u order by u.at desc, u.id desc limit 20), '{}'::uuid[]);
    seeds := seeds || mine_ids;
    -- The newest 10 replies to each.
    foreach m in array mine_ids loop
      rep_ids := '{}'::uuid[]; rep_ats := '{}'::timestamptz[];
      foreach x in array pool_reply_ids(in_thread, m, 20) loop
        select * into p from pool_probe(x);
        if p.ok and p.hidden is not true then rep_ids := rep_ids || x; rep_ats := rep_ats || p.created_at; end if;
      end loop;
      seeds := seeds || coalesce(array(select u.id from unnest(rep_ids, rep_ats) as u(id, at) order by u.at desc, u.id desc limit 10), '{}'::uuid[]);
    end loop;
  end if;

  -- Each seed once, with its quotes; the posts those quote (the one hop) after them. Only ids were kept above, so that nothing held grows with a body.
  seeds := coalesce(array(select distinct s from unnest(seeds) s), '{}'::uuid[]);
  seen := seeds;
  foreach x in array seeds loop
    select * into p from pool_probe(x);
    qs := pool_quoted(in_thread, p.ref);
    foreach m in array qs loop
      if not (m = any (seen)) then seen := seen || m; hop := hop || m; end if;
    end loop;
    continue when not p.ok or p.thread is distinct from in_thread or p.hidden is true;
    if not chars ? p.author::text then
      select c.name as n, cp.pronouns as pr into who from characters_public c left join character_profiles cp on cp.character = c.id where c.id = p.author;
      chars := chars || jsonb_build_object(p.author::text, case when who.n is null then null else jsonb_build_object('name', who.n, 'pronouns', who.pr) end);
    end if;
    continue when jsonb_typeof(chars -> p.author::text) is distinct from 'object';
    act := x; seq := p.seq; at := p.created_at; author := p.author; name := chars -> p.author::text ->> 'name'; pronouns := chars -> p.author::text -> 'pronouns';
    body := p.body; reply_to := p.target;
    quotes := coalesce((select jsonb_agg(to_jsonb(o.q) order by o.n) from unnest(qs) with ordinality as o(q, n)), '[]'::jsonb);
    return next;
  end loop;
  foreach x in array hop loop
    select * into p from pool_probe(x);
    continue when not p.ok or p.thread is distinct from in_thread or p.hidden is true;
    if not chars ? p.author::text then
      select c.name as n, cp.pronouns as pr into who from characters_public c left join character_profiles cp on cp.character = c.id where c.id = p.author;
      chars := chars || jsonb_build_object(p.author::text, case when who.n is null then null else jsonb_build_object('name', who.n, 'pronouns', who.pr) end);
    end if;
    continue when jsonb_typeof(chars -> p.author::text) is distinct from 'object';
    qs := pool_quoted(in_thread, p.ref);
    act := x; seq := p.seq; at := p.created_at; author := p.author; name := chars -> p.author::text ->> 'name'; pronouns := chars -> p.author::text -> 'pronouns';
    body := p.body; reply_to := p.target;
    quotes := coalesce((select jsonb_agg(to_jsonb(o.q) order by o.n) from unnest(qs) with ordinality as o(q, n)), '[]'::jsonb);
    return next;
  end loop;
end $$;

-- 0421's signature and result, now the rows above gathered in thread order.
drop function pool_read(uuid, text, uuid[], integer);
create function pool_read(in_thread uuid, staff_key text, named uuid[], "window" integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'self', (select c.id from characters_public c where c.staff = pool_read.staff_key),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('act', p.act, 'seq', p.seq, 'at', p.at, 'author', p.author, 'name', p.name, 'pronouns', p.pronouns,
                                          'body', p.body, 'replyTo', p.reply_to, 'quotes', p.quotes)
                       order by p.at, p.act)
      from pool_read_rows(in_thread, staff_key, named, "window") p), '[]'::jsonb))
$$;

alter function pool_probe(uuid) owner to kayfabb_digest;
alter function pool_quoted(uuid, uuid) owner to kayfabb_digest;
alter function pool_read_rows(uuid, text, uuid[], integer) owner to kayfabb_digest;
alter function pool_read(uuid, text, uuid[], integer) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function pool_probe(uuid), pool_quoted(uuid, uuid), pool_read_rows(uuid, text, uuid[], integer), pool_read(uuid, text, uuid[], integer) from public, anon, authenticated, service_role;
grant execute on function pool_read(uuid, text, uuid[], integer) to service_role;
