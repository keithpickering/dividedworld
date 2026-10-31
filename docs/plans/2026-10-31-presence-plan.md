# Presence: who is browsing a thread, a board and the index: plan

Record, written 2026-10-31. The plan for Part 2 of The System's build order, from section 2 of
`docs/plans/2026-10-31-the-staff-design.md`, whose design session confirmed the screen with the owner (the mock is
`docs/research/2026-10-31-the-staff/mock-p1-presence.html`). It depends on nothing of The System, so it can be built
before Part 1. It is written against main at 8d054ea: migrations up to `0039_card_economy.sql`, SQL tests up to
`supabase/tests/0044-card-economy.sql`. Each new file takes the next free number when it is written, and a number that
moved is reported under `Plan gaps` in the PR. The numbers below are this plan's own; the marks-and-the-lens plan
(`docs/plans/2026-10-31-marks-and-the-lens-plan.md`) already names 0040 and 0045 for its own files, so whichever builds
second moves.

## What it builds

phpBB's three boxes in the board's world: "Users browsing this thread" at a thread's foot, "Users browsing this board"
under a board's thread list, and "Who is online" at the index's foot.

- **What each box lists.** The debuted, unretired characters active there within `presenceWindow` (5 minutes), names
  only, each linked to its profile. Up to `presenceNames` (15) are shown, longest present first, then "and N others".
- **How it refreshes.** A poll every `presencePollSeconds` (30) that is also the viewer's heartbeat. The HUD's mask
  arrives on its first poll and leaves only by aging out. Polling pauses while the tab is hidden.
- **The hide switch.** Each mask has one in My characters, and the HUD marks a hidden current mask. A hidden mask is
  listed nowhere, except to its own player, from their own session.

## The layers

All of it is engine: the table, the RPCs, the hook and the box, in `engine/ui/presence/` (new) and
`supabase/migrations/`. The instance gives only the three numbers, as settings in `instances/divided-world/settings.ts`.
The words of the boxes are the engine's plain forum words ("Users browsing this thread", "Who is online"), as the
index's and the board's headings already are.

## Tasks

### Task 1. The three settings

- **`engine/rules/types.ts`.** `Settings` gains:
  - `presenceWindow: Span`: how long after its last poll a mask stays listed;
  - `presenceNames: number`: the most names a box shows;
  - `presencePollSeconds: number`: how often a page polls.

  Each gets a doc comment saying what it does to a player.
- **`engine/rules/instance.ts`.** Add the three to `SETTINGS`:
  - `presenceWindow`: `isSpan(v, GRACE_UNITS)`, as `editGrace` is;
  - `presenceNames`: a whole number, at least 1;
  - `presencePollSeconds`: a whole number from 10 to 300. The floor keeps a deployed instance from being polled into
    load; the ceiling keeps the window meaningful.
- **`instances/divided-world/settings.ts`.** `{ unit: 'minute', count: 5 }`, `15`, `30`.
- **`engine/ui/data/api.ts`.** `ScreenSettings` gains `presencePollSeconds`, and the fake's and the client's defaults
  carry it.
- **The literal fixtures.** Every literal `Settings` in the tests gains the three, which the type check enforces:
  `engine/rules/actions.test.ts`, `settle.test.ts`, `settle.scale.test.ts`, `instance.test.ts`, and any other the build
  finds with `grep -rn "viewCountCron: '" engine instances supabase`.

**Tests first.**
- `engine/rules/instance.test.ts`: a missing `presenceWindow` is a problem; `presencePollSeconds: 5` and `400` are
  problems naming the setting; a `presenceWindow` in days passes.
- `instances/divided-world/settings.test.ts`: the instance's values validate.
- Red against main, where the keys don't exist.

### Task 2. Presence in SQL

**Migration `0040_presence.sql`,** with a header comment that carries the reasoning (the design's section 2, and why a
swap never removes a mask).

- **Table `presence`:**
  - `character uuid primary key references characters (id)`;
  - `place_kind text not null check (place_kind in ('thread', 'board', 'index'))`;
  - `place uuid` (null for the index), with a check that it is null exactly when `place_kind = 'index'`;
  - `board uuid`: the board's id for a board or one of its threads, null for the index;
  - `place_since timestamptz not null`;
  - `online_since timestamptz not null`;
  - `seen_at timestamptz not null`.

  One row per character, never per account, overwritten by that character's own polls; this is not an Act and holds no
  Act's content. Indexes on `(place, seen_at)`, `(board, seen_at)` and `(seen_at)`. RLS on, and no grant to anon or
  authenticated.
- **Table `presence_hidden`:** `character uuid primary key references characters (id)`, `hidden_at timestamptz not null
  default now()`. A row means hidden. RLS on, and no grant.
- **`here(in_kind text, in_place uuid, through uuid) returns jsonb`,** security definer, granted to authenticated only.
  1. `caller := signed_in_account()`. Refuse an unknown `in_kind`, or a `thread` or `board` whose id does not exist,
     with `kayfabb.refusal` and `P0002`, as `mark_read` does. Derive `board` from `threads.board` for a thread.
  2. If `through` is not null:
     - `perform played_by(through, caller)`;
     - unless the character is retired or has a `presence_hidden` row, upsert its `presence` row:
       - `online_since` resets to `now()` when the old row's `seen_at` is older than `presenceWindow` (or there was
         none);
       - `place_since` resets when the place changed or `online_since` reset;
       - `seen_at = now()`.

     A hidden or retired mask writes nothing. **No other row is touched:** above all, no other character of the
     caller's is removed or changed. This is the line the design holds ("never a paired leave and arrival").
  3. Read the box:
     - **Rows:** those with `seen_at >= now() - span_interval(presenceWindow)`, joined to `characters` where
       `debuted_at is not null and retired_at is null and owner is not null`, and with no `presence_hidden` row (a mask
       hidden since its last poll drops at once);
     - **Filter:** for a thread, `place = in_place`; for a board, `board = in_place`; for the index, all;
     - **Order:** by `place_since`, then by `online_since` for the index, then by `character` for a stable tie;
     - **Answer:** `{names: [{id, name}] (at most presenceNames), others: count - shown}`.

     The answer names no account and carries no flag for "yours".
- **`set_presence_hidden(in_character uuid, hidden boolean) returns jsonb`,** security definer, granted to authenticated.
  It checks ownership with `played_by`'s owner check (a retired mask may still be toggled; a waiting one is refused as
  `played_by` refuses it). Hiding inserts the `presence_hidden` row and deletes that character's `presence` row in the
  same statement's transaction. Showing deletes the `presence_hidden` row. It answers `{character, hidden}`.
- **`my_characters`** (`0030_screens_reads.sql:48`; read its current form, since later migrations may have replaced it)
  is replaced with the same columns plus `presence_hidden boolean`, from `exists (select 1 from presence_hidden h where
  h.character = c.id)`.
- **`screen_settings`** (current form in `0039_card_economy.sql:19`) is replaced with `presencePollSeconds` added to its
  key list.
- `revoke execute ... from public, anon` on both functions, as `0023_views.sql`'s end does for `mark_read`.

**Tests first** (`supabase/tests/0045-presence.sql`, red against main where `here` does not exist), each with fixtures
of two accounts and three debuted characters, one account playing two of them:

- **Answering from rows.** `here('thread', t, a1)` lists a1. A second account's `here('thread', t, b1)` lists a1 and
  b1, in arrival order.
- **The swap (the poison).** Through a1, then at once through a2 (the same account), on the same thread. The box lists
  both a1 and a2. An implementation that keeps one row per account, or deletes the caller's other masks, makes a1 vanish
  at once and fails here. With a1's `seen_at` set back past the window, a1 is gone and a2 stays.
- **Not your mask.** `here` through a character the caller does not play raises 42501. Through a character waiting to
  debut, it raises 55000, as `played_by` does.
- **Retired.** A retired character writes nothing and is listed nowhere, even with a fresh row.
- **Hidden.**
  - `set_presence_hidden(a1, true)`: a1's row is gone, a later `here` through a1 writes nothing, b1's box omits a1, and
    `my_characters` shows `presence_hidden` true for a1.
  - Showing it again lists it on its next poll.
  - Another account's call to `set_presence_hidden(a1, …)` raises 42501.
- **The cap.** With `presenceNames` set to 2 and three masks present, the thread box names the first two by
  `place_since` and gives `others` 1.
- **The board and the index.** A mask in a thread on board B is in board B's box and in the index box, and not in board
  C's.
- **The answer's shape.** Its keys are exactly `names` and `others`, and each name's are exactly `id` and `name`. An
  answer that grows an `account` or `mine` key fails.
- **The window.** A row with `seen_at` older than `presenceWindow` is not listed; moving the setting to 10 minutes lists
  it again.
- **Default deny.** Add `presence` and `presence_hidden` to `supabase/tests/0005-default-deny.sql`'s lists, and `here`
  and `set_presence_hidden` to its function lists, so anon can execute neither and no client reads either table.

### Task 3. The API

- **`engine/ui/data/api.ts`:**
  - `export type PresencePlace = { kind: 'thread'; thread: Id } | { kind: 'board'; board: Id } | { kind: 'index' }`;
  - `export interface Presence { readonly names: readonly { readonly id: Id; readonly name: string }[]; readonly others:
    number }`;
  - `KayfaApi` gains `here(place: PresencePlace, through: Id | null): Promise<Presence>` and `setPresenceHidden(character:
    Id, hidden: boolean): Promise<Answer<boolean>>`;
  - `MyCharacter` gains `readonly presenceHidden: boolean`.
- **`web/src/data/supabase.ts`:** `here` calls the RPC through `rpcWrite`, as `markRead` does (line 699), and throws on
  a refusal so the hook can count failures. `setPresenceHidden` answers as the other preference writes do. `toMyCharacter`
  reads `presence_hidden`. A board's id: `here` takes the board's uuid; `BoardScreen` has it from `api.board()`.
- **`engine/ui/data/fake.ts`:** the same semantics in memory. One row per character, aging by the fake's clock, the
  swap leaving the old mask listed, hidden masks omitted, and the cap. The component tests run on it.
- **`tools/check-web-reads.mjs`:** `ALLOWED_RPCS` gains `here` and `set_presence_hidden`.
  `tools/test-web-reads.mjs` already drives a call outside the list red, so no new poison is needed. Run it to confirm.

**Tests first** (`engine/ui/data/fake.test.tsx`):
- the swap leaves both masks listed until the window passes;
- a hidden mask is omitted for another account;
- the cap gives `others`.

### Task 4. The box on three screens

- **`engine/ui/presence/presence.ts`:** `usePresence(place: PresencePlace | null): Presence | null`. While the place is
  set and `document.visibilityState === 'visible'`, it calls `api.here(place, player.hudCharacter?.id ?? null)` at once
  and every `settings.presencePollSeconds` seconds. On `visibilitychange` to visible it polls at once; while hidden it
  stops.
  - **A failed poll** keeps the last answer. After three failures in a row it answers `null`, and the box drops out
    quietly. It is ambient, so it raises no notice.
  - **A change of place or HUD mask** polls at once, so the new mask arrives without waiting.
  - **Answers in order.** A sequence number drops a stale answer.
- **`engine/ui/presence/PresenceBox.tsx`:** `PresenceBox({ place, heading })`. It renders the mock's box: a `section`
  labelled by its heading (`h2` styled as the mock's bold Courier header), and a paragraph of names joined by commas.
  - Each name is a `Link` to `/c/<id>`.
  - Past the cap, " and N others" follows (with "1 other" for one).
  - **The viewer's own hidden mask:** when `player.hudCharacter?.presenceHidden` is true, the box adds that mask's name
    in italics with "(hidden, only you see this)". This is from the player's own context, never from the answer.
  - It renders nothing while the first answer is pending, or when the hook answers `null`.
  - **No live region:** it carries no `aria-live`.
  - `engine/ui/presence/presence.css` uses the board's tokens only (`tools/check-ui-tokens.mjs` holds this): a 1px rule
    and the system face for the header.
- **Placement:**
  - `engine/ui/thread/Thread.tsx`, at the thread's foot after the reply box and its notes (after the block that ends
    near line 553), with heading "Users browsing this thread";
  - `engine/ui/board/Board.tsx`, after the bottom pager (line 133's `pager('bottom')` and the table's fragment), with
    "Users browsing this board", given the board's id;
  - `engine/ui/index/Index.tsx`, after the board table, with "Who is online" and the small muted line "Characters active
    in the past N minutes", N from the settings' span via the words helper the screens already use for spans
    (`spanWords` in `engine/ui/characters/format.ts`);
  - on a phone the heading shortens to "Browsing this thread" and "Browsing this board", as in the mock, by the
    screens' existing narrow-width pattern.
- **Stories:** `engine/ui/presence/PresenceBox.stories.tsx`, with an empty box (your own mask only), three names, past
  the cap, and your hidden mask.

**Tests first** (`engine/ui/presence/PresenceBox.test.tsx` and `presence.test.ts`, on the fake, red against main):
- **What it shows.** The box lists the names in order with links; past the cap it says "and 3 others"; one past says
  "and 1 other".
- **Your own hidden mask.** With the HUD's mask hidden, its name shows in italics with the words "only you see this";
  another account's render of the same place does not show it.
- **Polling.** With fake timers, it polls again after `presencePollSeconds`; it does not poll while
  `visibilityState` is `hidden`; a change of HUD mask polls at once.
- **Failure.** Three rejected polls in a row remove the box; one doesn't.
- **No live region.** The box contains no element with `aria-live`.
- **Placement.** `Thread.test.tsx`, `Board.test.tsx` and `Index.test.tsx` each find their box by its heading's
  accessible name.

### Task 5. The hide switch and the HUD's mark

- **`engine/ui/characters/Characters.tsx`,** in `panel` beside "Pip style" (the `kb-roster-pip` label near line 272): for
  a live character, a labelled `kb-glass-select` "Online status" with "Shown online" and "Hidden".
  - Changing it calls `api.setPresenceHidden`, then `player.refresh()`.
  - A refusal shows in the panel's existing `problem` line, as the pip style's does.
  - It is disabled while saving, by the same `aria-disabled` pattern.
  - Its help text, in a `kb-roster-line`: "Hidden: this character isn't listed in Who is online or Users browsing. Only
    you see it there."
- **`engine/ui/frame/Hud.tsx`,** in the `kb-hud-who` block (near line 246): when `hud.presenceHidden`, a small glass tag
  "HIDDEN" after the name. It is styled as the class line's tags, with its text in plain words for a screen reader
  ("hidden from online lists").

**Tests first:**
- `engine/ui/characters/Characters.test.tsx`: the select shows the character's state; choosing "Hidden" calls
  `setPresenceHidden(id, true)` and the HUD's mark appears after the refresh; a refusal shows in the panel.
- `engine/ui/frame/Frame.test.tsx`: the mark shows for a hidden HUD mask and not for a shown one.

### Task 6. The whole

- Run `npm run build` (the SQL tests, the component tests, `check-web-reads`, `check-ui-tokens`,
  `check-engine-boundary`, `check-doc-references`) and show it passing.
- Run `.claude/skills/impeccable/scripts/impeccable detect --json` over `engine/ui/presence/`, `engine/ui/characters/`
  and `engine/ui/frame/`, and answer what it finds.
- Take the box's screenshots on the stories at 1440 and 390 wide, in light and dark, and put them in the PR beside the
  mock.

## Ways out of the states this adds

| State | Its way out |
| --- | --- |
| A mask listed in a box | It ages out `presenceWindow` after its last poll, or its player hides it at once |
| A mask hidden | Its own switch in My characters, any time |
| A box that stopped answering | It drops out quietly; the next page load starts polling again |

## What could vary with a private fact, and how it does not

- **The answer** names characters and a count of characters, never an account. No key says which names are the caller's
  (Task 2's shape test).
- **A swap** writes only the new mask's row; the old mask ages out by its own `seen_at` (Task 2's poison). The pair's
  timing is each mask's own activity, a clue as post times are.
- **Who may present a mask:** only the account that plays it (`played_by`), so no client can place someone else's mask.
- **A hidden mask** is never written or sent. Its italic line is drawn from the player's own context. There is no count
  of hidden masks.
- **A retired or waiting mask** is never listed, whoever asks.
- **The poll's timing** is the same for every viewer and never depends on what is listed.

## Review focus

- **The cost at a busy instance.** `here` is one upsert and one read per viewer every 30 seconds. Check that the read
  uses `(place, seen_at)` and `(board, seen_at)` and that the index box's count over the whole window stays an index
  scan (an `explain` on a fixture of a few thousand rows), since the index box is the one whose rows grow with everyone
  online.
- **A mask removed as a side effect anywhere.** Grep the migration for every `delete from presence`. Only
  `set_presence_hidden` may delete, and only the named character's row.
- **`my_characters` replaced from its current form,** not from 0030's text, if a later migration redefined it.
- **The export round trip** (`supabase/tests/e2e/0003-export.ts`) with the two new tables: `presence` rows reference
  characters, so the import must load them after `characters` (read how `tools/import-instance.mjs` orders tables).
- **A tab left open in the background** stops polling and ages out. A tab on a phone that the browser freezes behaves
  the same, and the hook's resume polls at once.
