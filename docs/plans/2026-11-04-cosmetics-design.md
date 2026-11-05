# Cosmetics: avatar gear, trophies and belts, and Random Events: design

Record, written 2026-11-04. A design session made with the owner. Each section was confirmed by the owner before the plan
was written. The plan is `docs/plans/2026-11-04-cosmetics-plan.md`, built by one build session in one PR, after the
booster packs plan (`docs/plans/2026-11-04-booster-packs-plan.md`) is merged. The boards are in
`docs/research/2026-11-04-cosmetics/`.

It takes up three idea boards: #35 (Random Events, gear and The System's smallest acts), #209's cosmetic half (trading's
half stays open there), and the in-world rank the alerts design left open (`docs/plans/2026-11-02-alerts-design.md`,
"Open": "trophies or avatar gear in place of a numbered standing"). The Random Events it builds are the ones the staff
design decided in outline (`docs/plans/2026-10-31-the-staff-design.md`, section 12), with gear and found cards added to
their outcomes.

The owner, opening the session: "equippable avatar gear (drag/drop/resize/rotate, shows anywhere the full uncropped 1:2
avatar is shown) and trophies (regular forum badges, given for winning events, by admins or by the Boss). Random events
are part of this since they are the main way to find gear."

## 0. Where it starts

- **An avatar is two crops** (`supabase/migrations/0025_avatars.sql`): a portrait from 1 to 2 times as tall as it is
  wide, and a square cut from inside it, whose frame is held as fractions of the portrait. The side postbit
  (`engine/ui/postbit/postbit.css`) draws the portrait in a 1:2 box with `object-fit: cover`, which trims a shorter
  portrait's sides; the profile (`engine/ui/profile/Avatar.tsx`) does the same. Roster and Turn crop it to a fixed height.
- **Cards are held per account** (`card_ledger.account`), and the booster plan makes the hand a sum of ledger rows by
  source in one function, `card_held`, with a pack's draw done by rarity, then uniformly within it.
- **The Boss's moves** are a catalog with an effect, limits and a hard expiry (`engine/system/moves.ts`,
  `supabase/migrations/0046_moves.sql`); a met demand ends a move in the tick (`0053_stored_progress.sql`).
- **The season's end** writes each character's place in `reveal_season` (latest `0073_core_loop_answers.sql:298`).
- **No gear, trophy or Random Event exists.** Minus Balls and the Unban wait on bans (the staff design's Part 3).

## 1. Gear is held by the account and worn by its masks

**Decided** (the owner, over a character-bound item): "Account, multiple copies of a gear item can be owned and you can
distribute them between your characters as desired."

- **An item** is instance content, in code as cards are: a key, a name, a one-line description, a rarity (the cards'
  four) and a transparent image. The owner's Minus World gear is the art. The engine names no item.
- **The wardrobe** is an account's copies: a sum of append-only ledger rows by source, `found` (a Random Event) and
  `granted` (an admin). Trading, later, is two more kinds (#209). It is seen by its own player alone.
- **Wearing.** Each copy is worn by at most one mask. A player with six mustaches can put one on each of six masks. A mask
  wears at most 12 pieces (a setting).
- **The clue is chosen knowingly.** Anyone can see what a mask wears, so the same rare hat on two masks is a clue to who
  plays them. It is a clue from public play, never proof, which "A response never proves a private fact" allows. Which
  copies a player holds, and how many, is never shown to anyone else.

Weighed: gear bound to the character that found it (no clue, but no handing out); one shared copy worn by every mask at
once (near proof, beyond a clue).

## 2. Where a piece sits, and where it is drawn

**Decided:**

- **A piece is placed on the portrait as it was cut**, whatever its shape from 1:1 to 1:2: its center as fractions of
  the portrait's width and height, its width as a fraction of the portrait's width (its height follows its art), its
  rotation, and its layer. The owner: "Allow it to be placed anywhere within the actual 'full crop' of the avatar in
  question, whether 1:2 or less."
- **The tall slot shows the portrait whole, at its own shape**, so gear lands where its player put it. The side postbit
  and the profile stop trimming a shorter portrait. The portrait's shape is stored with the avatar, so the slot has
  its height before the picture loads.
- **On the tall portrait, gear may reach past the edge**, up to 40% of the portrait's width on each side (a setting; the
  dashed line on board 02). The owner: "let it overflow but ensure the z-index of surrounding text always wins". So the
  postbit's name, title, rank and counts are drawn over any gear, each on the board's own background, so a dark hat
  never hides black text (board 01, Dr. Bones's top hat).
- **On the square, gear is cut at the square's edge** (the owner: "on the cropped 1:1 version, if we render gear there,
  it should not overflow"). The square is cut from inside the portrait, so the same pieces are drawn through the square's
  frame. A piece below the square never shows there.
- **A new portrait takes every piece off**, back into the wardrobe, since its placements no longer fit. Recropping only
  the square keeps them.
- **The browser draws it** (the owner chose the recommendation). Each piece is the item's own image, one file per item
  cached across every mask, positioned over the avatar. Nothing is baked into the avatar's files.

Weighed: compositing gear into both WebP crops on the server (cheaper to draw, but every change re-encodes two files,
overflow is impossible, and the avatar's Last-Modified date, already a public clue, would move with every outfit);
gear needing a portrait (a mask without one shows none).

## 3. An outfit is the profile's state, not an Act

**Decided** (the owner chose the recommendation): putting gear on or arranging it is like changing the avatar or the
signature. Every post shows the mask as it looks now. Getting a copy and an admin's grant are ledger rows, so the log
stays true. No class reads an outfit and nobody reacts to one.

Weighed: each outfit as a public Act, which an old post could show as worn then (many Acts for nudging a hat, and a
class could read it).

## 4. Trophies and belts

**Decided:**

- **A trophy is held by the character that earned it** (the owner chose the recommendation) and never moves. It records
  what a mask did. A season winner's trophy turning up on a fresh mask would nearly prove who is behind it.
- **Kinds come from two places** (the owner chose the recommendation): the instance's code (its season places, its
  Boss's list, its met-demand trophy, its belts), and admins, who make one-off trophies on an admin page (a name, a line
  and an uploaded image) for events run by hand, such as a sprite contest. Admin-made kinds travel with the export.
- **Who gives them:**

  | Giver | When | What |
  |---|---|---|
  | The season | Its end | Its first, second and third places each get the instance's trophy for that place, dated to the season. Ties share a place. |
  | The Boss | A favor move, `AWARD_TROPHY` | One of the trophies the instance lists for Bosses, to a character it picks |
  | A met demand | When the tick ends a move as met | The instance's met-demand trophy, to every character whose public Acts counted toward it |
  | An admin | Any time | Any trophy, with an optional line |

- **The Boss's move** (the owner chose the recommendation) costs one move from its weekly bank, gloats in character in
  its announcement, and can be reversed by an admin. Each trophy other than a belt goes to a mask at most once a season.
  It never goes to a staff character. It does not expire: a trophy records what happened.
- **A met demand** credits the characters counted from public Acts alone: the posters for a count of posts, the posts'
  authors for a count of reactions, and the pair for a cross-quote. **It never credits a reactor**, since who reacted is
  private.
- **Belts change hands** (the owner: "Ones that could change hands over time like WWE belts would be fun"; the mechanism
  chosen, Boss-held). A belt kind has one holder at a time: the latest award of it that stands. An award of a belt takes
  it from its holder. The Boss's move and an admin both pass belts. Matches, when feuds are designed (#73), become a
  third hand without reshaping anything. Every award is kept, so a belt's lineage is its awards in order, and reversing
  the latest returns the belt to the one before.
- **On a post** (the owner chose the recommendation), under the rank: up to three trophies the player chose for that
  mask, plus any belt it holds, which always shows. Small 2003-style badge images, in the board's world. Each one's name
  is its alt text and its title on hover. In the stacked band and on a phone, only a held belt shows, beside the name.
- **The profile's trophy case** lists every trophy, newest first, with who gave it and when in plain words, and each belt
  the mask holds or held, with its lineage (board 03).
- **The choice of three** is made on the dress-up page (section 6), not in profile edit.
- **Most Aura in a season is the season's places**, not a trophy of its own (the owner).

Weighed: kinds only in code (an admin's weekend contest waits on a deploy); trophies held by the account and shown on a
chosen mask (the near-proof above); the Boss giving honors only at its farewell; each class's top as a trophy; a belt a
code rule passes on by itself (the owner had no example, so none is built; the shape allows one later).

## 5. Random Events

**Decided** (the owner, adding found cards to the recommendation): build the spawn, the per-account cap and the event
dialog, with three outcomes: a line and a picture alone, gear, or a card.

- **Pacing** (the owner chose the recommendation). The server rolls at most once per account in each window (15 minutes
  by default), on the first board page load inside it, and at most 4 events in a rolling day. Reloading only rolls again
  when the clock allows. Each number is a setting. The roll reads the account's own past rolls and nothing else.
- **Granted at once.** Whatever an event gives is in the wardrobe or the hand the moment the dialog shows. There is no
  claim click, as on Neopets.
- **Outcome weights** to start: a line alone 70, gear 20, a card 10, each a setting.
- **What is found** is drawn by rarity (the owner chose the recommendation), then uniformly within it, by the same SQL
  draw a pack's pull uses. The booster plan's `buy_pack` draws inline today, so this plan moves that draw into one
  function both call. The owner asked that found cards not conflict with the booster plan: they do not. A found card is
  one more `card_ledger` kind, `found`, counted in `card_held` with one line, as the onboarding grant's `granted` is.
  Main Event, hidden in the machine, can be found in a rare event, which is what the card mechanic's design foresaw
  ("found from exceptionally rare random events").
- **The dialog** (the owner chose the recommendation over a toast) opens over the page: "SOMETHING HAPPENED!", the line,
  the picture, the item and its rarity in plain words, the mask it happened to, "Only you see this", and Wear it (for gear)
  or OK. It is the glass, so its line may joke about what happened and never bluffs, and it speaks as no character. The lines
  are the instance's, committed and reviewed with it, as the rest of the glass's copy is.
- **No Aura**, as the staff design decided. The System never pays Aura through an event.
- **Logged.** Every event that gave something is a line in its player's log.
- **Kept for later, through the same outcome list:** a public event (an Act naming the character), Minus Balls, the
  Unban, and a brush with a Mod Bot.

Weighed: Random Events in their own plan; a chance per page load with a claim click (reload farming held back only by
the daily cap); a weight per gear item (every new item retunes the rest).

## 6. The screens

Confirmed by the owner on the boards (`docs/research/2026-11-04-cosmetics/`): "Looks good, we will likely need that gear
case to use the carousel component so it can support a large inventory."

| Board | World | What it settles |
|---|---|---|
| `01-postbit` | The board | Gear on the side postbit at the portrait's shape; overflow under the text, which keeps its background; the chosen trophies and a belt under the rank; the stacked band's square, gear clipped |
| `02-dressup` | The glass | The Wardrobe page: the mask's portrait with the reach line, the selected piece's handles, the same moves as buttons, the square's preview, the wardrobe with each item's copies and where they are worn |
| `03-trophy-case` | The board | The profile's gear named in words, the trophy case, a belt's lineage |
| `04-event` | The glass | The Random Event dialog, and its line-only and card variants |
| `05-admin` | The glass | Award a trophy, grant gear, make a trophy, recent awards with reversal |

- **The wardrobe is a carousel**, the one the class cards use (`engine/ui/characters/ClassCards.tsx`, with
  `carousel.ts`), drawn out into a shared component so it holds a large inventory.
- **The dress-up page** is a glass page of its own, `/wardrobe`, opened from My characters and from the HUD. It also holds
  the mask's "Shown on posts" choice of trophies.
- **Accessibility.** The dress-up page is a settings screen, not a game obstacle, so it meets the forum's standards in
  full ("An accessible path costs what the obstacle costs"): every move a pointer makes (place, move, size, turn, layer,
  take off) is a button and a key. The gear is decoration where it is drawn; the profile names what a mask wears in
  words. A trophy is information, so its image carries its name.
- **The look** is the boards. The art in them is a placeholder, and the owner's Minus World gear replaces it.

## 7. Layers, ways out and the masks

**Layers** ("KayfaBB never knows which instance it runs"):
- **The engine** holds the wardrobe, the outfit and its drawing, the dress-up page, trophy and belt mechanics, the season,
  demand and Boss awards, the admin page, the Random Event roll and dialog, and the shared draw.
- **The instance** holds its gear (keys, names, lines, rarities, art), its trophies (season places, the Boss's list, the
  met-demand trophy, belts, their names and art), its event lines and pictures, and every number as a setting.
- They come in through `Instance.gear`, `Instance.trophies`, `Instance.events` and `InstanceUi.gear`/`InstanceUi.trophies`.

**Ways out** ("No player is ever stuck"):

| State | Its way out |
|---|---|
| A piece worn | Taken off on the dress-up page, any time; a new portrait or a retirement takes it off |
| The wardrobe full of copies | Nothing to escape: copies cost nothing to hold |
| A belt held | The Boss's move, an admin's award or reversal; holding it is a reward, never a trap |
| A trophy shown on posts | Unchecked on the dress-up page; a reversed award leaves the postbit at once |
| A Random Event's dialog | OK, Esc, or Wear it |
| A day's events used up | The rolling day; the cap is the player's own and seen by no one else |

**The masks** ("A response never proves a private fact"):
- The wardrobe, the ledger and the event rolls are read by their own account alone.
- An outfit is public and read from the character, never from the account.
- Refusals on the dress-up page ("you hold no free Mustache") are seen only by the player trying, who knows what they hold.
- An admin's grant names a character, lands in its player's wardrobe and answers the same whoever plays it. The admin
  page never names an account.
- Trophies are read from characters and public Acts. A met demand credits authors and posters, never reactors.
- The Boss's move reads public trophies and holdings, and no wardrobe.
- The roll reads the caller's own rolls; its answer and its timing differ only with the caller's own history.

## 8. Open

- **Trading** between players (#209): the gear ledger takes two more kinds, and a trade between one player's own masks
  is the design question it already names.
- **Gear in the machine and in packs**: a third kind of slot item (the booster design's section 9), not built here.
- **A belt a rule passes on by itself**, once there is a good example.
- **Public Random Events**, Minus Balls and the Unban (the staff design's Part 4).
- **Pip styles and other unlocks from trophies** (the screens design's open list).
- **The art**: the owner's Minus World gear, and the trophies' badges.
- **The old voice's event lines** (the staff design, section 13). A line a model writes would be glass copy no one
  reviewed, which "The fiction may lie; the log never does" keeps from the glass. Asked of the owner before any is built.
