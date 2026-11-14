-- The veil's cover is stored (docs/plans/2026-11-14-veil-cover-plan.md, Task 2; design docs/plans/2026-11-14-veil-cover-design.md, sections 2, 4, 5 and 6).
--
-- What was found: after 0357 a thread page's first call on a connection plans for hundreds of milliseconds and a few hundred megabytes, because acts_public's two selects each carry the whole derivation of which Acts a live
-- author veil covers (five subqueries over acts, post_veils_live and post_veil_cards), and a page reads the view about a dozen times in one statement. The derivation is the same at every read and changes only when a veil
-- lands or an Act is written on a veiled post, so it is written once, at those two moments, and read by key.
--
-- post_veil_cover (act, play): the Acts that one author veil covers, one row per pair. Written by three triggers and by the fill below, never edited (the append-only pair post_veils has), read by no API role: acts_public reads it
-- as the view's owner. The four kinds of covered Act are 0357's own: the veiled post itself; every Act of the post's author on it that is no post or spin (its edit, set, take-back, use card, spring); every draw or wash of that
-- author on a card that is on the post; and every card a back of the author's laid on a quote (post_veil_cards). A quote of the post, a spin from it and another character's Act are not covered, as before.
-- Whether the cover is shown is still decided at the read: the view joins post_veils_live, so a veil that has run out or that an admin ended (reverse_card, a refunded write) stops covering by itself, exactly as it did, and no
-- row is ever removed. A veil ends the way it always did: at its time, or by an admin.
--
-- The triggers (none `enable always`: an import writes as a replica, tools/import-instance.mjs, and carries the rows it exported):
--   post_veils_cover       after a post_veils row of an author veil: the post, and what its author has already written on it, found by the indexes acts already has.
--   acts_veil_cover        after an Act that targets another Act and is no post or spin: it reads the target's id, kind and target by key, and, where the target is a card and the Act a draw or a wash, the post the card is on.
--                          Where the post's own character wrote it (an edit, a set, a draw on a card of the post...), the post's live author veils cover it. An Act with no target, a post and a spin read nothing; every other
--                          character's Act reads those same rows by key and no veil table: what is read depends on the Act's kind and target, never on who owns a character.
--   post_veil_cards_cover  after a post_veil_cards row: the card is covered by the live veils on its post and author.
-- veil_cover_lock(post): an advisory transaction lock on the post, taken by all three triggers before each reads post_veils or the Acts and cards a veil covers. A veil landing and its author's Act on the post, or a spring
-- writing a card while a second veil lands, committed from two sessions at once, would each miss the other (neither sees the other's uncommitted row); the lock makes the second wait for the first's commit and then read it.
-- Only the post's own character's Acts, a card laid by a back, and the veil's landing take it, so another character's Act on a veiled post never waits, and no row is locked by the trigger, so the lock order (post, then
-- visits_open, then character) is kept: the advisory lock comes after every row lock those functions take.
--
-- Live, twice over: the fill below reads post_veils_live, so it skips a veil an admin has already ended, while the triggers ask only the time (ends_at > now()) and so cover under a veil that an admin ended an instant ago
-- (design section 4). Both are fine because the cover is only ever read through post_veils_live: a row under a veil that is not live shows nothing, and an ended veil never becomes live again.
--
-- Masks: what a response could prove is who owns a character, and nothing here reads an owner. The work on an Act is keyed on its kind, its target and its character, never on a player: the post's own character's Act gains a
-- probe of post_veils_post and the lock, and no other Act waits on anything.
--
-- acts_public is made again with the same columns in the same order and the concealment as 0357 has it. Its two selects still read `acts` alone, with no WHERE and no join of their own, so the union stays one appendrel;
-- `ok` is now a probe of post_veil_cover by the Act's id and post_veils_live by the play.

create table post_veil_cover (
  act uuid not null references acts (id),
  play uuid not null references post_veils (play),
  primary key (act, play)
);
create trigger post_veil_cover_no_update before update or delete on post_veil_cover for each row execute function post_veils_append_only();
create trigger post_veil_cover_no_truncate before truncate on post_veil_cover for each statement execute function post_veils_append_only();
alter table post_veil_cover enable always trigger post_veil_cover_no_update;
alter table post_veil_cover enable always trigger post_veil_cover_no_truncate;
alter table post_veil_cover enable row level security;
revoke all on post_veil_cover from public, anon, authenticated, service_role;

create function veil_cover_lock(post uuid) returns void
language sql set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtext('kayfabb.veil_cover'), hashtext(veil_cover_lock.post::text))
$$;
revoke all on function veil_cover_lock(uuid) from public, anon, authenticated, service_role;

create function post_veils_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform veil_cover_lock(new.post);
  insert into post_veil_cover (act, play)
  select new.post, new.play
  union
  select a.id, new.play from acts a
  where a.target_act_id = new.post and a.character = new.author and a.kind not in ('post', 'spin')
  union
  select d.id, new.play from acts k join acts d on d.target_act_id = k.id
  where k.kind = 'card' and k.target_act_id = new.post and d.kind in ('draw', 'wash') and d.character = new.author
  union
  select c.card, new.play from post_veil_cards c where c.post = new.post and c.author = new.author
  on conflict do nothing;
  return null;
end $$;
revoke all on function post_veils_cover() from public, anon, authenticated, service_role;
create trigger post_veils_cover after insert on post_veils for each row when (new.veil = 'author') execute function post_veils_cover();

create function acts_veil_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tgt record;
  pst uuid;
  pc uuid;
begin
  select t.id, t.kind, t.target_act_id into tgt from acts t where t.id = new.target_act_id;
  if new.kind in ('draw', 'wash') and tgt.kind = 'card' then pst := tgt.target_act_id; else pst := tgt.id; end if;
  select a.character into pc from acts a where a.id = pst;
  if pc is not null and pc = new.character then
    perform veil_cover_lock(pst);
    insert into post_veil_cover (act, play)
    select new.id, v.play from post_veils v
    where v.post = pst and v.veil = 'author' and v.author = new.character and v.ends_at > now()
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function acts_veil_cover() from public, anon, authenticated, service_role;
create trigger acts_veil_cover after insert on acts for each row when (new.target_act_id is not null and new.kind not in ('post', 'spin')) execute function acts_veil_cover();

create function post_veil_cards_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform veil_cover_lock(new.post);
  insert into post_veil_cover (act, play)
  select new.card, v.play from post_veils v
  where v.post = new.post and v.veil = 'author' and v.author = new.author and v.ends_at > now()
  on conflict do nothing;
  return null;
end $$;
revoke all on function post_veil_cards_cover() from public, anon, authenticated, service_role;
create trigger post_veil_cards_cover after insert on post_veil_cards for each row execute function post_veil_cards_cover();

-- The fill: the same four kinds for every author veil whose time has not passed and that no admin has ended (post_veils_live), in one statement. A veil that is over covers nothing now and is never read as live.
insert into post_veil_cover (act, play)
select v.post, v.play from post_veils_live v where v.veil = 'author'
union
select a.id, v.play from post_veils_live v join acts a on a.target_act_id = v.post and a.character = v.author and a.kind not in ('post', 'spin') where v.veil = 'author'
union
select d.id, v.play from post_veils_live v join acts k on k.target_act_id = v.post and k.kind = 'card' join acts d on d.target_act_id = k.id and d.kind in ('draw', 'wash') and d.character = v.author where v.veil = 'author'
union
select c.card, v.play from post_veils_live v join post_veil_cards c on c.post = v.post and c.author = v.author where v.veil = 'author'
on conflict do nothing;

create or replace view acts_public as
  select u.id, u."character", u.kind, u.thread, u.target_act_id, u.seq, u.created_at,
         shown_payload(u.payload, h.own, co.refs, co.ready, co.body) as payload,
         shown_payload(coalesce(e.payload, u.payload), h.cur, coalesce(cc.refs, co.refs), coalesce(cc.ready, co.ready), coalesce(cc.body, co.body)) as current_payload,
         e.created_at as edited_at,
         case when e.created_at > u.created_at + coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0')
           then e.created_at end as shown_edited_at,
         case when u.kind = 'card' then exists (select 1 from card_write_refunds r where r.play = u.id) end as untaken,
         case when u.kind = 'set' then (select f.ends_at from face_down f where f.play = u.id) end as ends_at,
         h.cur as hidden,
         u.kind = 'post' and quote_hidden(u.id) as any_hidden,
         not h.cur and coalesce(cc.refs, co.refs) and not coalesce(cc.ready, co.ready) as concealing,
         h.own as payload_hidden,
         not h.own and co.refs and not co.ready as payload_concealing
  from (
    select a.id, a."character" as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id) as ok
    from acts a
    union all
    select a.id, (select k.id from characters k where k.staff_kind = 'anonymous') as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id) as ok
    from acts a
  ) u
  left join lateral (
    select x.id, x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = u.id
    order by x.created_at desc, x.id desc limit 1
  ) e on u.kind = 'post'
  cross join lateral (
    select o.own, case when e.id is null then o.own else version_hidden(e.id, u.id) end as cur
    from (select u.kind in ('post', 'edit') and version_hidden(u.id, case when u.kind = 'edit' then u.target_act_id else u.id end) as own) o
  ) h
  cross join lateral conceal_layer(u.id) co
  left join lateral conceal_layer(e.id) cc on e.id is not null
  where u.g and u.ok;
