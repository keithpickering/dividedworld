# The Pound: giving up a mask, and adopting one

Record, written 2026-11-21. A design session with the owner, taking up the Pound that `spec.md` §3.2 sketched, which
the core loop design listed as waiting (`docs/plans/2026-10-28-core-loop-design.md` §11). The plan is
`docs/plans/2026-11-21-the-pound-plan.md`.

## 0. What was found

- **The sketch.** `spec.md` §3.2: a player abandons a character to free one of their six slots, any other player with
  an open slot adopts it, the character keeps its Aura, Trophies, post history and baggage, and the change is a public
  Act that names no player.
- **What changed since.** Aura and cards are no longer the mask's. The wallet, the cards held, face-down traps, packs
  and owned gear are the account's (`0003_aura.sql`, `card_ledger`, `face_down`, `packs`, `gear_ledger`). What is the
  mask's: its season standing, trophies, class history, warn points and bans, a Mod Bot's tail, worn gear, the cards in
  force on it, its posts and their effect state.
- **Nothing moves a mask today.** `characters.owner` is never updated by any migration, and `0038` says so in words.
  `retire_character` and `restore_character` (latest `0205_gear.sql`, `0043_staff.sql`) are admin-only, and a restore
  goes back to the same player. `characters_staff_has_no_owner` (`0043`) forbids a player character with no owner.
- **Designs already waiting on this one.** The screens design (`2026-10-29-screens-design.md` §8): a full roster has no
  way to free a slot until the Pound. The System design (`2026-10-30-the-system-design.md` §10): a permaban takes a
  slot "until the Pound frees one". The glass cleanup (`2026-10-31-glass-cleanup-design.md` §2): the adopter inherits
  the retired author's wash path, "the Pound's design names that". `react` (latest body) says the session that moves a
  character "decides what becomes of reactions between its old and new owner's characters".
- **Every private read takes the owner now.** 19 views (`my_appeals`, `my_bans`, `my_infractions`, `my_scored_as`,
  `my_posts_played_on` and the rest), about 40 functions and the `own` policies of `characters`, `class_history` and
  `pending_turns` read `characters.owner`. Moved as it stands, a mask's whole private history (its old classes among
  it) would pass to the adopter and vanish from the old player's log.
- **Settlement takes one player per character, over all time.** `settlement_input` (latest `0398`) sends
  `'player', c.owner`; `engine/rules/settle.ts` throws when a reaction's character "names a player who does not own
  it", drops a player's reactions to their own characters by the current owner, and `apply_settlement` refuses an
  entry whose character's current owner is not its player. Settlement does not read `retired_at`, so a retired mask's
  old posts still pay its player.
- **A trap's spring alerts its card's account** (`write_alert(..., 'trapStruck', ...)` reads `face_down.account`); a
  spring is a public Act, so the alert tells its owner nothing a reader could not see.
- **The Turn's cooldown** runs from the latest `class_history` row after a character's first (`turn`, latest `0074`),
  so any class row written later starts it.

## 1. Giving a mask up

**Decided:** a player gives up a mask of their own from My characters, after a plain confirmation. The mask must have
debuted, and be neither retired nor already waiting; staff masks have no player and cannot. A banned or warned mask can
be given up: that is its baggage (owner, Q3 of the first round: "carrying all of this baggage is the most fun and the
most 'pound-like'").

At the give-up:
- the mask's own `give_up` Act is written in the season's Pound thread (section 8);
- its slot is free at once;
- a Turn not yet landed is withdrawn, its worn gear goes back to its player's hand, its presence clears;
- its class is cleared for whoever has it next (owner: "it's more a playstyle than something inherent to the
  character; a different player can reinvent them").

## 2. Waiting in the Pound

**Decided:** waiting is a state of its own, stasis, beside an admin's retirement, which stays as it is (owner:
"temporary retirement more or less").

- The mask makes no Act, as a retired mask makes none, but its player still washes splats on its posts (0038's path).
- **It earns nothing** (Q3, A). Its class is cleared, so no class is scored while it waits; its standing freezes and no
  wallet is paid from it. Weighed: the standing growing with no wallet paid (a new path through settlement for a number
  nobody banks); the old player earning until an adoption (what retirement does today, and it makes a give-up free).
- **Everything in play runs its course.** Cards in force on it expire as normal (owner: "no need to pause any of
  that"); bans and warn points keep their clocks; an appeal it made gets its ruling.
- **Its traps sleep, and wake for the adopter** (Q4, A). A trap set by a waiting mask springs nothing, as a retired
  setter's springs nothing today, and it still ends on its own clock. Once the mask is adopted its traps spring again:
  the adopter takes the credit and the consequences of what is buried. The card stays the old player's on paper, and
  its spring alerts that account, which a public spring already shows. Weighed: back to the old player's hand at the
  give-up (a watcher sees the traps vanish at the give-up, and the old player keeps cards played through a mask they no
  longer run); thrown away (it costs the old player for using the Pound).
- **Admins.** An admin may still retire a waiting mask, and its restore asks for a slot as it does today.

## 3. Taking a mask back

**Decided** (owner: "the original player can reclaim if nobody else gets it first and they've got room"):
- The old player reclaims from My characters whenever no file is open on the mask (section 4) and they have a free slot.
  A reclaim is free and immediate; its `reclaim` Act is the mask's, in the Pound thread.
- **A reclaim gives back the class the mask had** (Q10, A). For its old player nothing was cleared; the cooldown runs on
  from where it was. Only an adoption brings a fresh class. Weighed: a new class once the cooldown has run since the
  mask's last class change; a new class with no limit (a free Turn that skips the cooldown and the settlement's timing).
  The owner on the one route left, writing a letter for one's own mask: "advanced gameplay more so than an exploit".
- **A reclaim asked while a file is open waits** for the file to close, and lands then only if the agency placed the
  mask with nobody and the old player still has a free slot. Otherwise it is dropped, and their log says why. So a
  player cannot snatch a mask back the moment someone else shows interest.

## 4. Letters, and the file they open

**Decided:**
- **A window of letters** (Q2, B). The first letter on a waiting mask opens a file for 24 hours, a setting. Other
  players write into it until it closes; then the agency reads every letter in one call and places the mask with one
  of them, or with nobody. Letter quality wins, never typing speed. The window opens on the first letter, not at the
  give-up, so a mask nobody wants stays quietly reclaimable. Weighed: each letter judged on arrival (a race); the agency
  deciding on its own schedule (a wait the model decides, which would need its own bound).
- **The price** (Q6, A). A letter costs Aura, a setting (Divided World: 50, the appeal's price), kept win or lose. It is
  refunded only when no ruling comes: the call fails, or the file closes with The System switched off. One letter per
  account per file, at most 8 letters a file (a setting), and the writer must have a free slot both when writing and
  when the file closes; a letter whose writer has none at the close is set aside and refunded. Weighed: free letters
  with limits only (a pure writing contest); refunds to the losers (the bite of applying for everything goes).
- **The old player may write too.** The agency never knows whose letter is whose, and refusing it would take a rule
  that reads the ownership. A win lands as an adoption, with a fresh class.
- **Letters are the account's.** A letter is written by the player, never through one of their masks, and is no Act.

## 5. The agency

**Decided:**
- **A dedicated persona** (Q1, A), supplied by the instance, the way it supplies its Mod Bots. The engine has an
  `adoption` duty; an instance that supplies no agency has its season's Boss rule instead. Weighed: the Boss (a busy
  voice, and a handover mid-file would need rules); the Mod Bot that last dealt with the mask (a clean mask has none).
- **No name of its own.** The owner: it "can just come off as the board itself being protective over its characters."
  It is a staff character of its own kind, which the seed makes once, as it makes the developer and the stand-in.
- **What it may rule** (Q7, A): place the mask with one letter, or with nobody, plus a line of at most 280 characters.
  Nothing else. Weighed: placing on probation, with warn points added (the owner: it "sounds a bit like adding baggage
  to the character to punish the player for not being a 'fit parent', which doesn't totally track"); keeping the file
  open another day (a window's length the model decides).
- **What it reads:** the mask's public record (its name, title, signature, pronouns, its standing, its revealed classes
  as of their dates, a sample of its recent public posts) and the letters, numbered in an order drawn from nothing
  about their writers. Never who wrote a letter, the class a writer chose, or anything about a writer's other masks.
- **The call** is one light-tier call per file, under its own daily allowance (a setting). The answer is a fixed choice
  (`nobody`, or a letter's number) and a line; the model's text is never read as a choice. A number that names no
  letter cannot be repaired without inventing one, so it fails the call; a line overshot is trimmed and the trim
  written on the call's record ("A validator tighter than the schema is a place a paid answer goes to die").
- **Copy.** The adoption framing is kept light (the owner: "we don't have to lean so hard into the adoption verbiage").

## 6. The adoption landing

**Decided:**
- The agency's `placement` Act, in the Pound thread, names the mask and its ruling and carries the line. It never names
  a player or a letter.
- On a placement, in one transaction: the mask's owner becomes the letter's writer, recorded in an append-only ownership
  history; the class the writer chose takes effect at that instant, so the Turn's cooldown starts from it (section 0);
  the mask leaves the Pound; its standing scores again; its traps wake; its wash path is the adopter's (the glass
  cleanup's question, answered).
- **The class is chosen with the letter** (Q8, A), the way character creation asks for one. It is kept beside the letter
  and never sent to the model, since a public ruling would otherwise be computed from a private fact. The owner
  declined an announcement of it: "the existing reveal mechanic covers any desire to make the class public."
- **It is the adopter's** (owner, Q5 of the first round): they may change whatever a creator could, which today is
  everything but the name.
- Every other letter in the file is told plainly in its writer's log that it was not chosen; its price is kept.

## 7. Ownership over time

**Decided** (Q5, A): each owner keeps their own stretch. The owner: "no case file needed, you 'get what you get' so to
speak."
- **One history.** `character_owners` holds who held a mask from when, append-only; `characters.owner` stays the owner
  now, which every write path keeps reading. One function, `held_by(character, account, at)`, answers whether an account
  held a mask at an instant, and every private read of a mask's past asks it at the row's own time.
- **The old player** keeps their log of the mask up to the adoption and nothing after it. Until the adoption the mask is
  still theirs (they wash, they reclaim). **The adopter's** private history of the mask starts at the adoption; its past
  is theirs only as any reader sees it. Old classes stay hidden unless they were revealed; a revealed one is public as
  of its date, and nothing else about it is (CLAUDE.md, "A response never proves a private fact").
- **Settlement** reads ownership over time: each stretch of a window is scored for the player who held the mask then,
  and a waiting stretch is scored for nobody. A reaction is a player's "own" when they held the reacted Act's character
  when the Act was made or hold it now, so neither the old player nor the adopter scores by reacting to what the other
  wrote. `react` refuses the same reaction, and only its caller sees that.
- Weighed: the adopter inheriting the whole file (it proves the old classes to someone who never earned them); nobody
  keeping anything (the old player's log would stop being a true record of what was done to their characters).

## 8. Where it shows

**Decided** (Q9, A):
- **A Pound thread each season, on the staff's board,** opened on its first Act as the Promos thread is
  (`promos_thread`, `0100_announce.sql`). The give-up and the reclaim are the mask's own Acts there; a placement is the
  agency's. Each can be reacted to and spun, as any Act.
- **The Pound page**, a 2003 board page (`/pound`): every waiting mask, as its profile card shows it, with how long it
  has waited, and, where a file is open, "a file is open; it closes <time>", or that it is full. Never how many letters,
  who wrote them, the classes they chose, or who gave the mask up. An open file is a clue that somebody is interested,
  which may draw rivals; it is built from what players did, never from who owns what. The page links each mask's
  "write a letter".
- **The letter form** is in the glass, as the appeal forms are: writing one is private.
- **My characters** (the glass): the give-up, a waiting mask ("In the Pound since …"), its reclaim, or that a reclaim
  waits for an open file.
- **Rankings** marks a waiting mask "in the Pound". Issue #66, the same question for an admin's retirement, stays
  separate.
- **The log** says each step plainly: the give-up, the reclaim (landed, waiting, or dropped and why), a letter written
  and its price, chosen or not, set aside and refunded, a file closed with no ruling and the refund, and, for the old
  player, that the mask was adopted.

## 9. Ways out

| State | Way out |
|---|---|
| A mask waiting in the Pound | Its old player's reclaim, on My characters, while no file is open and a slot is free; or an adoption. It may wait for good, which traps no player: the slot is free. |
| A file open on a mask | It closes by itself after `fileHours`; the staff run rules on it. Past the staff job's bound, the Pound page says it is late (`docs/plans/2026-11-20-job-health-design.md` §4). |
| A file whose ruling never came | The stale sweep refunds every letter and the mask waits again. |
| A file over the day's allowance | It is ruled on the next run after the allowance resets, at most a day later. |
| A reclaim waiting on a file | It lands, or is dropped and said, when the file closes. |
| A letter | Chosen, not chosen, set aside and refunded, or refunded with the file. |
| The System switched off | No letter is taken; a file that closes while it is off closes unruled and refunds its letters. |

## 10. The masks

- **Public:** the `give_up`, `reclaim` and `placement` Acts; the Pound page; a file's being open, its closing time and
  its being full.
- **Never public:** who gave a mask up or adopted it; who wrote a letter; how many letters a file holds short of full;
  the classes chosen; any owner's private history of a mask.
- **Refusals** are computed from the caller's own facts (their slots, their letter in this file, their ownership of the
  mask they give up or reclaim) or from public ones (a file full, a mask not waiting).
- **The prompt** holds no private fact: public record and letter text only, letters numbered by a random key.
- **Timing.** A give-up and a placement land when their player or the staff run acts. That a mask was given up an hour
  before a new mask debuted is a clue built from public Acts, which the game does not hide.

## 11. The layers

- **Engine:** the waiting state, the files and letters, ownership over time, the `adoption` duty and its prompt and
  repair, settlement's stretches, the screens and the log.
- **Instance:** the agency's content (`SystemContent.agency`: its name, voice and self-prompt), the `adoption` duty's
  assignee, the `pound` settings, and its Strategy Guide's words. No engine file names Divided World or its agency.

## 12. Many accounts

Out of scope (owner: "potentially unsolvable, there is not really anything to stop a person from making two accounts
and farming reactions"). The Pound adds one channel: passing a mask from one's own account to another. It costs a file,
a letter's price and a day, and an open file invites rivals, so it is no cheaper than what two accounts can do already.

## Open

- The agency's displayed name. The plan proposes "The Pound", for the owner to approve in the build's PR with the rest
  of the instance's copy.
