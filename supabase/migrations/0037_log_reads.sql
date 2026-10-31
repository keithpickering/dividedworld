-- What the player's log reads beside my_ledger, my_ledger_shares and my_wallet_events: the log
-- shares plan's Task 4 (docs/plans/2026-10-30-log-shares-plan.md) and the cards plan's Task 6,
-- which the log carries. Three facts the log must say truly that no view gave it:
--
--   - which card a purchase bought, and a play that cost nothing: wallet_events names no card for a
--     purchase (its ref is null) and wallet_spend writes no event for a play at no cost (0006), so
--     the player's own card ledger is read through my_card_ledger;
--   - a play another player landed on one of the player's own posts, and when that post's effect
--     was last saved (a layer washed clean is told from the save's state, which effect_states
--     already gives any reader): my_posts_played_on;
--   - whether a settlement was made once its shares were kept (0034): a settlement with none was
--     either made before, or made after with no post the estimate valued, and the log says which
--     (the log shares design, sections 3 and 5). ledger_shares_kept holds the first settlement made
--     with them, and my_ledger gains `shares_kept`.
--
-- Each my_* view runs as its owner, filtered to the caller, as 0030's do, so the tables stay
-- unreadable by the API roles; each answers from the caller's own rows alone. my_posts_played_on
-- reads who owns the post a play landed on, which is private, and answers only that post's own
-- player, who knows it; the play and who made it are public Acts already.

-- The first settlement made with its shares kept: at most one row, and none means every settlement
-- was (the first is 1). It is written here only on an instance that settled before 0034, set to its
-- next settlement (no instance was deployed between 0034 and this, so none was made with shares in
-- between); a new instance holds no row, so an import into one is not refused as holding rows
-- (tools/import-instance.mjs). An instance's export carries the row, so an import keeps what each
-- settlement was.
create table ledger_shares_kept (
  one boolean primary key default true check (one),
  from_settlement bigint not null check (from_settlement >= 1)
);
insert into ledger_shares_kept (from_settlement) select max(id) + 1 from settlements having count(*) > 0;
alter table ledger_shares_kept enable row level security;
revoke all on ledger_shares_kept from anon, authenticated, public;

-- my_ledger (0030), with whether its settlement was made with its shares kept, as its last column.
create or replace view my_ledger as
  select l.settlement, s.starts_at, s.ends_at, l.character, l.reason, l.amount,
         l.settlement >= coalesce((select k.from_settlement from ledger_shares_kept k), 1) as shares_kept
  from ledger l join settlements s on s.id = l.settlement
  where l.account = auth.uid();

-- The caller's card ledger (0006): each card bought and played, its price and, for a play, its Act.
-- Never the account or the row's id.
create view my_card_ledger as
  select l.card, l.kind, l.act, l.price, l.at
  from card_ledger l
  where l.account = auth.uid();

-- The plays on the caller's posts made through another player's characters, with when each was made
-- and when its effect was last saved, or null. A play through one of the caller's own characters is
-- the caller's card ledger's, and is left out here. Never the account, the owner, who saved or what
-- the state holds. The read is the caller's posts' plays: one probe of acts_target (0001) per post the
-- caller has written, then the plays in time order.
create view my_posts_played_on as
  select k.id as play, k.target_act_id as post, k.created_at as at, e.saved_at
  from acts k
  join acts p on p.id = k.target_act_id
  join characters c on c.id = p.character
  join characters by_whom on by_whom.id = k.character
  left join effect_state e on e.play = k.id
  where k.kind = 'card' and c.owner = auth.uid() and by_whom.owner <> auth.uid();

revoke all on my_card_ledger, my_posts_played_on from anon, public;
grant select on my_card_ledger, my_posts_played_on to authenticated;
