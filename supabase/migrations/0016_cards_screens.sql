-- Cards for the screens: a card stacks on a post up to its stack, each play its own layer; a
-- seeded card's play carries a seed the server chooses, so every reader draws the same splat and
-- no caster picks theirs; every play carries its caster's message; and a reader's release from an
-- effect (Stick Around's certificate) is kept on the server, per account, so it follows them from
-- device to device. The screens' engine plan, Task 4; the screens' design, sections 6, 9, 10, 11.
--
-- On an instance that already holds 0006's plays: a play written before layers has none in its
-- payload, and counts as one when the next is laid over it, which takes layer 2. 0006's index
-- made each such play the only one of its card on its post, so no post holds two without layers.
-- A reader treats a play with no layer as layer 1.

alter table card_kinds add column stack integer not null default 1 check (stack >= 1),
  add column seeded boolean not null default false;

-- seed_instance (0013), writing each card's stack and seed. Everything else as 0013 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
begin
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's stack and whether it is seeded are the code's, as its name and price are.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- One play per card and layer on a post, held as a constraint: two plays at once that read the
-- same count take the same layer, and one is refused. play_card counts under the target's lock,
-- so they wait on each other instead.
drop index acts_one_card_per_post;
create unique index acts_card_layers on acts (target_act_id, (payload ->> 'card'), ((payload ->> 'layer')::integer)) where kind = 'card';

-- play_card (0006), with the caster's message, the layer and the seed. The message is plain text,
-- at most 200 characters (engine/rules/cards.ts's MESSAGE_MOST), and may be empty; the screens show
-- it as text, never as markup. A seed sent in a seeded card's configuration is dropped: the seed is
-- the server's, a 31-bit integer every reader draws the effect from.
drop function play_card(uuid, text, uuid, uuid, jsonb, integer);
create function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  held integer;
  target_kind text;
  in_thread uuid;
  written uuid;
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
begin
  perform played_by(through, who);
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if price is null or price < 0 or price > (setting('walletCap'))::integer then raise exception 'a play costs between 0 and the wallet''s cap' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- One player's plays at a time, so two at once cannot both spend the last card.
  perform 1 from accounts where id = who for no key update;
  select count(*) filter (where kind = 'bought') - count(*) filter (where kind = 'played') into held
  from card_ledger l where l.account = who and l.card = play_card.card;
  if held < 1 then raise exception 'you hold no "%" card; the Vending Machine sells them', card using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  select * into kind_of from card_kinds k where k.key = play_card.card;
  -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
  select a.kind, a.thread into target_kind, in_thread from acts a where a.id = target for no key update;
  if target_kind is distinct from 'post' then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select count(*) + 1 into layer from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card;
  if layer > kind_of.stack then
    if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  begin
    insert into acts (character, kind, thread, target_act_id, payload)
    values (through, 'card', in_thread, target, jsonb_build_object('card', card, 'layer', layer, 'message', said,
      'config', case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end)
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end) returning id into written;
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- After the Act, so the wallet's record names what the Aura went on.
  perform wallet_spend(who, price, 'play', written);
  insert into card_ledger (account, card, kind, act, price) values (who, card, 'played', written, price);
  return act_projection(written);
end $$;

-- A reader's release from an effect: one row per account and play, kept from the first. Private,
-- read by its own account; nothing about it is broadcast or counted. Breaking free of Stick Around
-- lasts a visit and is never written here; certifying is. Its way out is none needed: a release
-- frees the reader, and the post is read as before.
create table effect_releases (
  account uuid not null references accounts (id),
  play uuid not null references acts (id),
  released_at timestamptz not null default now(),
  primary key (account, play)
);

create function release_effect(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare caller uuid := signed_in_account();
begin
  if not exists (select 1 from acts a where a.id = play and a.kind = 'card') then
    raise exception 'there is no such card on a post' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into effect_releases (account, play) values (caller, play) on conflict do nothing;
  return (select jsonb_build_object('play', r.play, 'released_at', r.released_at) from effect_releases r where r.account = caller and r.play = release_effect.play);
end $$;

alter table effect_releases enable row level security;
revoke all on effect_releases from anon, authenticated;
grant select on effect_releases to authenticated;
create policy own on effect_releases for select to authenticated using (account = auth.uid());

revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text) to service_role;
revoke execute on function release_effect(uuid) from public, anon;
grant execute on function release_effect(uuid) to authenticated;
