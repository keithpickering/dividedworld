Record, written 2026-11-27.

# A banned mask is stamped in the glass: design

Designed with the owner on 2026-11-27. The owner asked whether the pause menu or the HUD showed a ban (the game's
ban, which a full warn bar earns, holds one character, and ends by itself at its time). Neither did: in the glass, a
ban was said only by the composer's, New thread's and a poll's note (`engine/ui/composer/BannedNote.tsx`). The owner
asked for an indicator in the glass, "something fun that indicates the other characters are still playable."

The plan is `docs/plans/2026-11-27-ban-stamp-plan.md`. The mockups the owner chose from are in
`docs/research/2026-11-27-ban-stamp/`.

## 1. Where it shows

**Decided** (the owner, "All three"): every place the glass draws the player's own masks.

- **My characters, the roster card** (`engine/ui/characters/Characters.tsx`): the portrait grayed and dimmed with the
  stamp on it, and a red line "Banned until Nov 30, 9:00 PM" above the card's Turn line.
- **My characters, the panel**: a plain note: "Pipewrench is banned until Sunday, Nov 30 at 9:00 PM. The ban ends by
  itself then, and it holds only this character: your other characters can post as usual." with the existing Appeal
  button (`BanAppeal`, `engine/ui/cards/Forms.tsx`) beside it.
- **The HUD's plate, wide** (`engine/ui/frame/Hud.tsx`): the stamp on the 84px avatar, the avatar link's name
  extended to "My characters. Pipewrench is banned until …".
- **The HUD's plate, phone**: the 44px avatar is below what letters at the glass's phone floor (16px) fit, so it
  shows the stamp's frame alone; the words are in the picker.
- **The Swap mask / Posting as picker**: the banned mask's option reads "Pipewrench (banned)", and so does the
  phone's overlaid name.

Alternatives weighed: the HUD plate and roster only (the picker left plain), and the roster only. The picker is where
a player chooses whom to post as, so it says it there too.

## 2. The look: a rubber stamp

**Decided** (the owner: "B is the funniest, rubber stamp reads as Staff bureaucracy. It could use a bit of a drop
shadow to stand out against the image"): a neon red BANNED stamp, about −16°, its ink broken up like a real stamp's,
with a hard drop shadow and a soft one under it so it stands out on any picture. The portrait under it is grayed and
dimmed. The player's other masks keep their regular look.

Alternatives weighed: caution tape strung across the portrait (louder; "crime scene" rather than "processed"), and a
benched card behind cell bars with a TAG IN tab on each mask that can still post. The owner turned TAG IN down: "the
rest of the characters keeping regular styling does enough."

The stamp is decoration (`aria-hidden`): the words in section 1 carry the ban to every reader. It covers the portrait
box it sits in, border to border, the way the Roster board's portrait box is drawn; nothing in that box is pressable.

## 3. Motion: it slams once per ban

**Decided** (the owner, "Slam once per ban"): the first time the glass draws a given ban, the stamp drops in large and
lands with a small shake of the portrait, on the reactions' stamp curve (`engine/ui/reactions/reactions.css`,
`kb-stamp-thud`) at the feel's timing. The browser remembers each ban it has slammed, by character and end time, so a
later visit, a second place (the roster after the HUD) or a reload shows it already landed; a new ban on the same mask
slams again. The memory is a per-viewer convenience in `localStorage`, every read and write in try/catch: where it
cannot be kept, the stamp slams again, which harms nothing. With motion Off (the device's reduced motion, or the
setting) the stamp is simply there.

Alternatives weighed: slamming every time it is drawn (the joke wears out on the third page), and no motion.

## 4. Ways out

The ban already names its way out (CLAUDE.md, "No player is ever stuck"): it ends by itself at its time, a player may
appeal to the Boss, and an admin may lift it. The stamp leaves at the ban's end without a read, by the hook every
timed state uses (`useAhead`, `engine/ui/composer/until.ts`); the panel's note names the end time and offers the
appeal.

## 5. The masks

A ban is a public fact about a character, already on every postbit ("BANNED"). Every place here draws it from the
player's own characters (`my_characters.banned_until`, already in `MyCharacter.bannedUntil`), so nothing new is read,
sent or computed from who owns the mask. The slam memory holds the player's own characters' ids and end times, in
their own browser, and is never sent.

## 6. The layers

Engine only. The stamp and its words are the engine's (the postbit already says BANNED in the engine); no instance
content is added, and no interface changes.

## 7. Tidying

`BannedNote` says "switch to another in the HUD to post as {them}", where {them} is the banned mask's own pronoun: it
reads as posting as the banned mask. The note is reworded to "switch to another in the HUD to post as usual." in the
same change.

## 8. Open

- **Board bars and thread lockouts** (the owner: out of scope, recorded as open). A character barred from a board or
  locked out of a thread is not banned; those keep their composer notes and get nothing in the glass from this design.
  Whether they should is a question for a later session.
