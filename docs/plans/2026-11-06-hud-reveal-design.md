Record, written 2026-11-06.

# The Reveal from the HUD: design

Part of #206, the owner's notes on the glass polish preview: its "Meta acts belong to the glass" bullet on the Reveal,
which the meta acts design (`docs/plans/2026-11-06-meta-acts-design.md`) left to its own session. It also fixes what the
owner found while asking about it: the HUD says "Only you see this" under a class its player has already revealed. Made
with the owner. The plan is `docs/plans/2026-11-06-hud-reveal-plan.md`.

The owner's note in #206: "The Reveal is always glass. The HUD's 'Only you see this' becomes its trigger: no change of
style beyond a hover and focus state. It opens the glass Reveal with the thread select pre-filled when a thread is open.
The board's 2003 'Reveal…' button and modal go, so the worlds no longer cross the way Marks were designed to avoid."

## 0. Where it starts

On main at cc2b6a3:

- **Two Reveal dialogs share one core.** `engine/ui/characters/reveal.ts` holds the rules and words (the glass reveal
  design, `docs/plans/2026-11-03-glass-reveal-design.md`, section 3). The board's `RevealModal.tsx` is opened by the
  composer's "Reveal…" (`engine/ui/composer/Composer.tsx`, `ComposerBody`) in its own thread. The glass's
  `RevealOverlay.tsx` is opened by My characters' "Reveal…" (`engine/ui/characters/Characters.tsx`) with board and
  thread selects. `RevealModal` is the last user of the board's `Modal` (`engine/ui/modal.tsx`).
- **The HUD's "Only you see this" is plain text** (`engine/ui/frame/Hud.tsx`, `.kb-hud-secret`), drawn for every mask
  whatever its class's state. On the phone, the HUD hides the whole block it sits in (`frame.css`, `.kb-hud-who`).
- **Nothing the client reads says whether a class is public.** `my_characters` (last redefined in
  `supabase/migrations/0074_settle_claim.sql`) has the class and when it began, and nothing more. Public statements of
  class are in `class_reveals` (`supabase/migrations/0100_announce.sql`): a player's reveal, a debut with its class,
  and a Turn announced with its class.
- **A second reveal of the same class is accepted.** `unmask()` (last in `0074_settle_claim.sql`) refuses a retired
  or undebuted character, The System's board and a due Turn, but not a class already public. My characters offers
  "Reveal…" for every live character.

## 1. One Reveal, on the glass

**Decided:** `RevealOverlay` is the only Reveal. `RevealModal.tsx`, the composer's "Reveal…" and the board's `Modal`
component go. `useModalLayer` stays, as the layer the glass's `Overlay` and the Spotlight are built on. `reveal.ts`
stays as the core. Nothing on the board opens a meta act.

- **The overlay takes an optional thread to start on** (`at: { id, title, board }`). Given one, the Board and Thread
  selects open on it. That thread is in the Thread list even when it isn't on the board's first page of 20, and the
  player can still change both. A thread on The System's board is never given, since `unmask()` refuses there.
- **On the desk, the HUD's "Only you see this" is a button** that opens the overlay, with the open thread as `at` and
  the kicker "Reveal". Its look doesn't change beyond a hover and focus state. Its accessible name, "Only you see this:
  reveal Pipewrench's class", starts with the words it shows (WCAG 2.5.3, label in name). It is a button only for a
  live mask (debuted, not retired), the test My characters' own "Reveal…" uses. For any other mask the line stays
  plain text.
- **My characters opens the same overlay**, kicker "My characters › Reveal". On the phone this is the way in, because
  the phone's HUD has no class line. When the player came from a thread, the overlay starts on it: the HUD's three ways
  to My characters (the avatar, Menu and Esc) carry the open thread in the navigation's state, the way the HUD's log
  link carries its character. No address names it.
- **Revealed.** When the mask's current class is public, the HUD's line reads "Revealed" beside an open lock and is not
  a button. My characters shows "Revealed" where "Reveal…" was. After a Turn to a class not yet public, both go back.

Weighed, on what a public class shows in the HUD:
- The line disappears. It's quieter, but the HUD would then say nothing about the class being public, and a missing
  lock is easy to miss.
- It still opens the Reveal, to post the class again. That keeps a way to restate a class, but it invites a pointless
  repeat, and §2 refuses one anyway.

Weighed, on the phone:
- An item in the phone's Menu, or a lock in the phone's HUD row. Either gives the phone the desk's way in. The owner
  chose My characters alone, with the thread the player came from filled in.

## 2. The server knows when a class is public

**Decided:**

- **`my_characters` gains `class_shown_at`**, carried as `MyCharacter.classShownAt: string | null`. It is the date of
  the latest `class_reveals` row for the character whose class is the one it holds now and whose date is on or after
  `class_since`, or null when there is none. A Turn into a class not yet public reads null. So does a Turn back to a
  class revealed before, because that reveal predates the new `class_since`. It reads Acts alone, through the existing
  view, so every way a class is made public counts.
- **`unmask()` refuses a class that is already public**: "that character's class is already public; after a Turn, the
  new class can be revealed". The check comes after `acting()` and after the character's row lock, so two presses at
  once cannot both pass. It is in `unmask()` alone, the player's own act, and not in `write_unmask()`, which debuts and
  Turn announcements also call.
- **The Acts an instance already holds stay as they are**, repeat reveals included ("Append-only").

Weighed:
- Hiding "Reveal…" in the screens only, and leaving `unmask()` as it is. It's smaller, but the rule would live only in
  the screens, and a screen could offer a repeat by mistake.
- Keeping repeats as a deliberate restatement. A player can say the same thing in a post.

## 3. What it adds, by the rules

- **Ways out ("No player is ever stuck").** The Revealed state ends with a Turn, and `unmask()`'s refusal says so. The
  overlay is left by Cancel, Close or Esc, as now. The pre-filled selects can be changed or cleared.
- **The masks ("A response never proves a private fact").** `class_shown_at` is read only through `my_characters`,
  which holds the caller's own characters. The refusal is reached only past `acting()`, which refuses anyone else's
  character exactly as before, so its words and timing reach only the mask's own player. "Revealed" restates what the
  reveal Act already made public. The open thread carried to My characters stays in the player's own browser history.
- **The fiction and the log.** Every word added is the glass's, out of character and plainly true.
- **Layers.** Everything is engine (`engine/ui/`, `supabase/`), with no instance content and no new interface.
- **A busy instance.** `class_shown_at` reads `class_reveals` per character, served by the indexes `acts_unmask` and
  `acts_announce_character`, for a player's own few characters. Nothing grows with the instance.
- **Accessibility.** The HUD's button keeps its words, takes the glass's focus ring and has a name that begins with its
  visible text. The overlay is unchanged.

## 4. Not in this design

- **Searching the thread select.** The owner: "we definitely need search/autocomplete of some kind for these thread
  selects". That is a separate concern, filed as its own issue. This design keeps the thread picker one piece inside
  `RevealOverlay`, so that a search can replace it.
- The reveal Act itself, its preview and its words are unchanged.

## 5. Open

Nothing.
