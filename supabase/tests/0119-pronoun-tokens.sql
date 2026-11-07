-- Staff pronoun tokens in stock lines (supabase/migrations/0119_pronoun_tokens.sql; docs/plans/2026-11-07-pronouns-plan.md, Task 9; the amendment, section 1).
--
-- 1. fill_tokens reads `{mod.they}`: a token may hold dots. A token with no value (a form that does not exist, a prefix nothing gave) stays as written, as it always has.
-- 2. visit_line fills `{mod.they}` from the Mod's own set: "how they felt" for a they/them Mod, "how it felt" for an it/its one; `{mod.They} {mod.is}` reads "They are" and
--    "It is"; the capitalized forms and the verbs follow the set (Themself, were, have, does/do, the s).
-- 3. report_line and appeal_line fill the Mod's forms; `{reporter.they}` and `{appellant.they}` are not tokens and stay as written (a reporter's pronouns are never read).
-- 4. system_line fills `{boss.their}` from the Boss's set, and `{mod.they}` is no token there.
-- 5. pronoun_tokens falls back to the `pronouns` setting, then the it-set, for a character with no profile row or no character at all, and gives every form the engine names.

create function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '%: got "%", wanted "%"', label, got, want; end if;
end $$;
create function pg_temp.lines(line_key text, line text) returns void language plpgsql as $$
begin
  update settings set value = jsonb_set(settings.value, array[line_key], jsonb_build_array(line)) where settings.key = 'systemLines';
end $$;

-- ---- 0. The world: a Boss (she/her), a Mod (they/them) and a Mod (no set named: it/its) ----
do $$
declare
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  they jsonb := '{"subject": "they", "object": "them", "determiner": "their", "possessive": "theirs", "reflexive": "themself", "plural": true}';
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'), 'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule', 'renameBoard', 'the renaming of a board')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Pt Gabe', 'title', 'Made this. Sorry.'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'pt-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'pt-boss', 'name', 'Pt Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'pronouns', she),
        jsonb_build_object('key', 'pt-m1', 'name', 'Pt Theymod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb, 'pronouns', they,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'pt-m2', 'name', 'Pt Itmod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('pt-m1', 'pt-m2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
                                 jsonb_build_object('key', 'renameBoard', 'structural', true), jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  if (select p.pronouns ->> 'subject' from characters c join character_profiles p on p.character = c.id where c.staff = 'pt-m2') is distinct from 'it' then
    raise exception 'the world: the Mod with no set named is not it/its';
  end if;
end $$;

-- ---- 1. fill_tokens: a token may hold dots; an unknown one stays as written ----
do $$
begin
  perform pg_temp.expect('a dotted token', fill_tokens('{mod.they} and {mod}', '{"mod.they": "xe", "mod": "Em"}'), 'xe and Em');
  perform pg_temp.expect('a dotted token with no value', fill_tokens('{mod.zzz} {a.b.c} {x}', '{"mod.they": "xe"}'), '{mod.zzz} {a.b.c} {x}');
  perform pg_temp.expect('a dotted value is not read again', fill_tokens('{a.b}', '{"a.b": "{mod.they}", "mod.they": "xe"}'), '{mod.they}');
  perform pg_temp.expect('a plain token as before', fill_tokens('Hi {boss}!', '{"boss": "Bo"}'), 'Hi Bo!');
end $$;

-- ---- 2. visit_line: the Mod's own set ----
do $$
declare charges jsonb := jsonb_build_array(jsonb_build_object('rule', 'Rule 1: no all-caps posts'));
begin
  perform pg_temp.lines('visitFiled', 'Case closed by {mod}, with the finding {rule}. {mod} has already forgotten how {mod.they} felt about this.');
  perform pg_temp.expect('visit they/them', visit_line('visitFiled', 'pt-m1', charges),
    'Case closed by Pt Theymod, with the finding Rule 1: no all-caps posts. Pt Theymod has already forgotten how they felt about this.');
  perform pg_temp.expect('visit it/its', visit_line('visitFiled', 'pt-m2', charges),
    'Case closed by Pt Itmod, with the finding Rule 1: no all-caps posts. Pt Itmod has already forgotten how it felt about this.');

  perform pg_temp.lines('visitFiled', '{mod.They} {mod.is} done. {mod.They} {mod.was} thorough, {mod.They} {mod.has} a stamp, {mod.They} {mod.does} not forgive.');
  perform pg_temp.expect('visit They are', visit_line('visitFiled', 'pt-m1', charges), 'They are done. They were thorough, They have a stamp, They do not forgive.');
  perform pg_temp.expect('visit It is', visit_line('visitFiled', 'pt-m2', charges), 'It is done. It was thorough, It has a stamp, It does not forgive.');

  perform pg_temp.lines('visitFiled', '{mod.Them} {mod.Their} {mod.Theirs} {mod.Themself} / {mod.them} {mod.their} {mod.theirs} {mod.themself} / {mod.they}{mod.s}');
  perform pg_temp.expect('visit every form they', visit_line('visitFiled', 'pt-m1', charges), 'Them Their Theirs Themself / them their theirs themself / they');
  perform pg_temp.expect('visit every form it', visit_line('visitFiled', 'pt-m2', charges), 'It Its Its Itself / it its its itself / its');

  perform pg_temp.lines('visitFiled', 'x {mod.theyy} {mod.THEY} {mod.} {boss.they} {mod.they');
  perform pg_temp.expect('visit unknown forms left as written', visit_line('visitFiled', 'pt-m1', charges), 'x {mod.theyy} {mod.THEY} {mod.} {boss.they} {mod.they');
end $$;

-- ---- 3. report_line and appeal_line: the Mod's forms; the other party's are no tokens ----
do $$
begin
  update settings set value = value || jsonb_build_object('reportDismissed', jsonb_build_array('{mod} read it; {mod.they} {mod.was} unmoved by {reporter}. {reporter.they} should not see this.'),
    'appealUpheld', jsonb_build_array('{mod.They} {mod.has} turned {appellant} down. {appellant.their} appeal is over.')) where key = 'systemLines';
  perform pg_temp.expect('report they/them', report_line('reportDismissed', 'pt-m1', 'Pt Ann'), 'Pt Theymod read it; they were unmoved by Pt Ann. {reporter.they} should not see this.');
  perform pg_temp.expect('report it/its', report_line('reportDismissed', 'pt-m2', 'Pt Ann'), 'Pt Itmod read it; it was unmoved by Pt Ann. {reporter.they} should not see this.');
  perform pg_temp.expect('appeal they/them', appeal_line('appealUpheld', 'pt-m1', 'Pt Ann'), 'They have turned Pt Ann down. {appellant.their} appeal is over.');
  perform pg_temp.expect('appeal it/its', appeal_line('appealUpheld', 'pt-m2', 'Pt Ann'), 'It has turned Pt Ann down. {appellant.their} appeal is over.');
end $$;

-- ---- 4. system_line: the Boss's forms ----
do $$
begin
  update settings set value = value || jsonb_build_object('bossFarewell', jsonb_build_array('{boss} leaves, taking {boss.their} stapler. {boss.They} {boss.is} gone. {mod.they} stays.')) where key = 'systemLines';
  perform pg_temp.expect('system_line she/her', system_line('bossFarewell', 'nameSuccessor', '{}', 'pt-boss'), 'Pt Boss leaves, taking her stapler. She is gone. {mod.they} stays.');
  perform pg_temp.expect('system_line a they/them staff', system_line('bossFarewell', 'nameSuccessor', '{}', 'pt-m1'), 'Pt Theymod leaves, taking their stapler. They are gone. {mod.they} stays.');
  perform pg_temp.expect('system_line, no such staff', system_line('bossFarewell', 'nameSuccessor', '{}', 'pt-nobody'), ' leaves, taking its stapler. It is gone. {mod.they} stays.');
end $$;

-- ---- 5. pronoun_tokens: the profile, else the setting, else the it-set; every form ----
do $$
declare
  t jsonb;
  forms text[] := array['they', 'They', 'them', 'Them', 'their', 'Their', 'theirs', 'Theirs', 'themself', 'Themself', 'is', 'was', 'has', 'does', 's'];
  f text;
  who uuid := (select id from characters where staff = 'pt-m1');
begin
  t := pronoun_tokens('mod', who);
  if (select count(*) from jsonb_object_keys(t)) is distinct from 15 then raise exception 'pronoun_tokens did not give fifteen keys: %', t; end if;
  foreach f in array forms loop
    if jsonb_typeof(t -> ('mod.' || f)) is distinct from 'string' then raise exception 'pronoun_tokens has no mod.%: %', f, t; end if;
  end loop;
  perform pg_temp.expect('they set', t::text, '{"mod.s": "", "mod.is": "are", "mod.has": "have", "mod.was": "were", "mod.does": "do", "mod.Them": "Them", "mod.They": "They", "mod.them": "them", "mod.they": "they", "mod.Their": "Their", "mod.their": "their", "mod.Theirs": "Theirs", "mod.theirs": "theirs", "mod.Themself": "Themself", "mod.themself": "themself"}'::jsonb::text);

  -- No such character: the it-set; then the setting once there is one.
  perform pg_temp.expect('no character, no setting', pronoun_tokens('boss', null) ->> 'boss.They', 'It');
  perform pg_temp.expect('no character, no setting, verb', pronoun_tokens('boss', null) ->> 'boss.is', 'is');
  delete from character_profiles where character = who;
  perform pg_temp.expect('no profile row, no setting', pronoun_tokens('mod', who) ->> 'mod.themself', 'itself');
  insert into settings (key, value) values ('pronouns', '{"subject": "xe", "object": "xem", "determiner": "xyr", "possessive": "xyrs", "reflexive": "xemself", "plural": false}')
    on conflict (key) do update set value = excluded.value;
  perform pg_temp.expect('no profile row, the setting', pronoun_tokens('mod', who) ->> 'mod.Themself', 'Xemself');
  perform pg_temp.expect('no character, the setting', pronoun_tokens('mod', null) ->> 'mod.their', 'xyr');
  -- A set of its own beats the setting; a plural custom set takes the plural verbs.
  insert into character_profiles (character, pronouns) values (who, '{"subject": "ze", "object": "zir", "determiner": "zir", "possessive": "zirs", "reflexive": "zirself", "plural": true}');
  perform pg_temp.expect('own set beats the setting', pronoun_tokens('mod', who) ->> 'mod.they', 'ze');
  perform pg_temp.expect('plural custom verb', pronoun_tokens('mod', who) ->> 'mod.was', 'were');
end $$;
