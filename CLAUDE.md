# Working rules for this repository

A rule enters this file when an incident earns it. Each section opens with its rule in one bold sentence, so the file
can be scanned; the conditions a session acts on follow it. Each rule's incident and the owner's words that earned it
are in `docs/working-rules/<slug>.md`, where the slug is the rule's heading, or a standing permission's bold name, in
lowercase with each run of other characters turned into a hyphen. Read it when a rule is in question. The rules carried
in at the first commit were earned in the project this machinery was first built in. Their incidents are not retold
here, and that project's subjects and data do not appear in this repository. `tools/check-working-rules.mjs` holds the
shape: a heading, one bold sentence, then prose, and a record for every heading.

This repository builds **KayfaBB**, an open-source engine for a kayfabe forum game: a message board where each person
plays several masked characters with hidden classes, everything anyone does is a public Act, and an arbitrary machine,
The System, runs the board. It is built for a small circle of people who know each other, so that any character might
be someone you know; small is a choice of play, never a limit of the architecture. **Divided World** (dw.gripe) is its
first instance, for the MFGG and Minus World community. The words this file uses: a **player** is the person behind the
masks; an **account** is their login; a **character** is a mask; an **Act** is the unit everything is made of; **The
System** is the machine (board turnover, Mod Bots, appeals). The design that settled these is
`docs/plans/2026-10-28-kit-step-1-design.md`.

**How a task starts here:** a plan before code, made with the owner by a design session
(`.claude/skills/design-session/SKILL.md`); the plan carried out task by task by a build session
(`.claude/skills/build-session/SKILL.md`); each step tests first, with its red run; a claim of done shown with the
output that proves it; a root cause found before a fix; and a spec reviewer and a quality reviewer on each task. No
process skill is read for these. This repository holds only its own skills (`.claude/skills/`), which carry the
practices to the sessions that use them. This file and the person's own instructions take precedence over the
repository's skills, which take precedence over default behaviour.

## Nobody is waiting on a hotfix

**The game is pre-alpha, with no players yet, so a design is never scoped down for a deadline or for how little is in
play today; it is built the way it should stand, however long that takes.**

A bug found in a deployed instance harms no player, because none is waiting. So there is no hotfix, no stopgap and no
"smallest change to unblock" anything: a design session plans the form the change should keep, and a follow-up is for
a separate concern, never the proper version of this one. A first PR may be small where it is the first step of the
full design and the plan says what follows. Where this file says "a player", it means the player the game is built
for, not one waiting today. How many players or Acts an instance holds says what a change gains now ("Weigh a design at
the scale of a busy instance"), never how far to build it. A session that finds itself trimming a design to save time
asks the owner instead. This section is rewritten when the owner says the game has players.

## This repository copies; it never imports

**Machinery arrives here by copy from currents, the project it was first built in; nothing here depends on that
project, and none of its product enters this repository.**

No shared git history, no package dependency, no submodule, no fetch at build time. Copied files lose their origin's
literals and keep their header comments' reasoning, and each check arrives with the test that drives it red. The
porting session attaches currents read-only and works from `docs/plans/port-manifest.md`, which names what was copied,
what it became and what was left behind.

## KayfaBB never knows which instance it runs

**The engine never imports from an instance; Divided World's classes, postcards, Mod Bot personas, prompts, theme and
copy plug into the engine's interfaces, and the engine moves to a repository of its own when KayfaBB is first
published as open source.**

Until then both live here, in two layers: the engine, and each instance's content beside it. The boundary is held by a
build check from the first commit that adds code to either side, driven red once on a planted import. A feature that
cannot be built without the engine knowing an instance's name is a sign the interface is missing, and the plan says
which interface it adds. Once the engine has its own repository, this one holds Divided World alone and maintains no
other community's instance.

## The System acts; it never destroys what a player wrote

**The System decides on its own, inside effects the code defines and bounds; nothing it or any player does destroys
the words a player wrote, and the weekly board list is shown to admins before it goes live.**

The System's arbitrariness is the game's chance: a model encouraged to be unreasonable, reading the state of play the
way a game director does, so that a ruling feels earned or cruel rather than a coin flip. So no person signs its
rulings in play. What bounds it is the code: every verdict, reward and punishment it can give is one of a fixed list
of choices the code maps to an effect with limits, and free text a model returns is shown, never acted on. A player's
post may be shredded, redacted, splatted or autocorrected, but each of those is a layer over the original, which
survives and can come back by the game's own means or an admin's. The weekly turnover's new boards go to admins about
24 hours before they go live and go live unless one holds them, so an admin can override a board while the illusion
holds, and an instance whose admins are away never stalls.

## Append-only

**An Act is never edited in place; every change is a new Act, and what a post or a character shows now is computed
from its Acts.**

An edit, a postcard, a punishment, a reversal and a transfer are each an Act beside the ones before them. A state that
changes often during play (how much of a splat is washed away) lives in a row of its own that the Act it belongs to
points at, never in the Act. Nothing here has an UPDATE on an Act's content.

## No player is ever stuck

**Every state a player, a character or a post can be put in names its way out, and a dead end found anywhere is filed
as an issue the day it is found.**

The game may be unfair; it may never be a trap. A ban from a board, a splat, a timebomb, an appeal waiting on The
System, an archived board and every state added later each say how they end: by themselves within a stated time, by a
player's act on the screen where the state shows, or by an admin. A plan that adds a state names its way out, and a
change that adds one builds that way out in the same change.

## The fiction may lie; the log never does

**What The System and its Mod Bots say in character may bluff and mislead; what a player's own log says was done to
their characters is always true, and the out-of-character screens speak plainly.**

The bluffing is the game. The log is what lets a frustrated friend step back and see that a game is being played. So
the log names which Act did a thing, what it changed and how much Aura moved, in plain words, and it never reveals
what is hidden: who reacted, or anyone's class. Settings, the account, errors and anything about real moderation are
written plainly and honestly, for a player's understanding, never in character.

## A response never varies with a private fact

**No page, payload, Realtime event, presence update or timing may differ with a private fact; who owns a character,
a character's class, who reacted, and whether an address has an account are private.**

A message that varies with a private fact is a way of reading that fact. Before a response, a status code, a
redirect, a delay or a broadcast depends on something private, ask who else can trigger it and what they learn by
watching. A player may work out who is behind a mask by reading and guessing; the system never tells them, and never
lets them measure it.

## Portable by construction

**Supabase is the platform and self-hosted Supabase is the way out; the game's rules live in plain SQL and pure
TypeScript, every model call goes through one provider-neutral interface, and an instance's export is complete and
round-trips.**

No rules module imports a vendor client; a Supabase client lives only at the edges. Migrations, policies and functions
are plain SQL. An instance can swap its model provider or switch The System off. A test proves that an instance
exported and imported again is the same forum, because the community this is built for has lost forums to the software
under them before.

## Weigh a design at the scale of a busy instance

**A design choice is weighed against a busy instance, with many players, characters, threads and Acts; a count from
today says what a change gains now, never on its own whether it is worth building.**

A small cast is how the game is meant to be played, and that is a choice about play. Many players may become a problem
for the game's design; they must never become a problem for its architecture. Where a design's cost grows with players,
characters, threads, Acts, reactions or viewers, the design says how it behaves at a busy instance's scale, and that is
what it is chosen on.

## A guard that has never been red is not known to work

**Every check has a self-test that drives it red on a poisoned input before the check is trusted, and the pair travels
together.**

A check that has only ever passed proves that it runs, not that it detects. Write the self-test with the defect the
check exists to catch, watch it fail, then make it pass. `check-*.mjs` and `test-*.mjs` are one unit; the build refuses
a check without its test.

## Two lists that must agree are one list

**A build step is added once, in the one `STEPS` list in `tools/build.mjs`; a relation between two lists that is only
stated has already drifted.**

Two command chains that are "the same except for one step" diverge the first time somebody types a step into one of
them. The runner is one array; `--check` prepends the type check to it, and a self-test asserts that is the only
difference. CI runs the same two commands: `npm run typecheck` as its own step, then `npm run build:ci`.

## A test that builds its own subject cannot tell you the subject is missing

**Every check that reads a database says which database it reads, refuses when it cannot tell, and something compares
the repository's migrations against the deployed one.**

A migration suite replayed from zero into a throwaway proves the migrations' content and says nothing about whether
they were applied anywhere. A guard that could be pointed at the throwaway by mistake would report perfect agreement
over exactly the question it exists to ask.

## Record every schema change as a migration in the same change

**Every SQL change applied to any database gets a migration file in the same commit.**

Applying SQL by hand works and leaves the repository behind the deployed database. Both directions drift: a migration
written and never applied is the same defect mirrored, which is why the rule above exists beside this one.

## Write in American English

**What a player reads is in American English ("select" and not "tick", "-ize" and not "-ise", "color" and not
"colour"), and so is every current document written or edited here; a record is left as written.**

## Cost is a column, not a report

**Every model call lands in a ledger row against an instance, priced from the provider's own usage block; the tier the
usage block reports is the sole authority on what was billed.**

Prices live in one table per provider with a verification date, and a model missing from the table throws rather than
pricing at zero. The ledger is reconciled against each provider's bill monthly, because the table drifts and an
unpriced call disappearing from the budget is the silent failure the ledger exists to prevent.

## A validator tighter than the schema is a place a paid answer goes to die

**Trim a bound the model overshoots by one, reject only what cannot be repaired without inventing content, and name
the predicate that failed.**

A provider's structured output cannot express a list length or a word count, so those bounds are checked after the
fact. Rejection is right for a field that cannot be repaired without inventing content and wrong for a bound overshot
by one, which is the ordinary way a model treats "at most six". Ask what a rejection costs before choosing it, and
write the trim on the call's record.

## Three unrelated timeouts are not a poison pill

**Retry a transport failure on the request itself, count only consecutive crashes toward a cap, and keep a dead run's
full record.**

A scheduled job collects any background failure rate there is. A crash counter with no window is a lifetime counter. A
5xx or a fetch that never answered is retried where it happened; a database error is a fact about the request and is
thrown at once.

## A path in prose is a claim, and it rots in silence

**A path or script named in a current document must exist, or the sentence must say it is gone; a record is left as
written and only reported on.**

Documents declare which kind they are (`specs/2026-10-28-doc-layers.md`). A dead reference in a current document fails
the build; a dead reference in a record is listed in the build's tail and never edited away, because the record's date
is what it is for.

## A rule that fights the product is asked about, not obeyed into a worse product

**Where a rule followed to the letter fights the game's premise and could make it worse to play, the owner is asked to
clarify it, since it is likely the rule that is the problem; until the owner answers, the work that turns on it waits
and every other rule applies unchanged.**

The premise a rule is read against is the one this file states: a kayfabe game among people who know each other, where
The System's arbitrariness is the fun ("The System acts; it never destroys what a player wrote"), the masks hold
("A response never varies with a private fact"), and a player can always step back and see the game ("The fiction may
lie; the log never does").

Asking is the whole of the remedy. The rule is neither followed into the worse result nor set aside: the work that
turns on it waits, and the rest goes on. The question names the rule, what following its letter would do to a player,
the case that shows it, and a proposed rewording. It is filed as an issue the day the conflict is found, so that it
outlives the conversation, and the owner's answer is written into the rule before the work that waited goes on. Ask
once per rule and kind of case, and never about friction that costs a player nothing: a rule that only makes the work
slower is not fighting the product.

## A standing permission is written down, or it is only remembered

**What the owner lets a session do without asking is listed here; anything not listed is asked, each time.**

A permission a session relies on is a rule like any other, and a rule lives in this file. The owner starts each
session from the app: a design session designs with the owner and commits a design and a plan; a build session builds
one plan, reviews it and owns its PR. The owner merges.

- **Closing an issue.** An issue is closed with the kind of close and a link to where its work went. *Fixed*: a merged
  PR's `Closes #N` closes it, and where a PR did not say so, a session closes it with the merged PR's link once main is
  shown to carry the fix. *Duplicate*: closed with a link to the issue kept, after anything only the duplicate held is
  copied onto the kept issue. *Won't fix or obsolete*: only on the owner's word. A dead end, a rule that fights the
  product or a question waiting on the owner is never closed as won't-fix or obsolete; it closes when it is fixed or
  answered, or as a duplicate of an open issue of the same kind.
- **Build sessions, and every subagent**, touch no deployed database, bucket or connector, and test against Postgres
  on localhost.
- **Secrets** are never printed, pasted or asked for.
- **Tidying.** A change may tidy what it passes through, and leaves it cleaner than it found it.
