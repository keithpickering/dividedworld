# Minus World's Spellbook, as it looked

Record, written 2026-10-30. Two screenshots of Minus World's Spellbook that the owner supplied, in
`docs/research/minus-world/screenshots/`. Both are from a thread of December 23, 2017. Below is what each shows and
what each suggests for Divided World. The owner, sending them: "The new Postcard system seems like it might be able to
unify the idea of spells and items under one easy-to-use mechanic. One item is a 'trap card' which is a yugioh gag,
but could potentially be an actual category of card." Each suggestion is an idea, not a decision.

## What they show

**`spellbook-active-spell-and-inventory-desktop.png`**: the Spellbook opened on a post that already carries a spell.

- The header shows the caster's level (93), 9229 EXP and their Rally (1.00x). Below it: "1 Spell is currently active
  on this post."
- **The active spell is listed with its caster.** Heads Will Roll (Pepperoni): "Look at those emoji go!", "Cast by
  God", with its own Good Sh\*t button (0). A spell on a post could be credited like a post.
- **The Inventory sits inside the Spellbook**, under the active spells, with an ALL ITEMS button, and each item has a
  quantity and a USE button:
  - **Respellent** (4): "Prevents any additional Spells from being cast on a single post for 1 week."
  - **Spell Trap** (5): "Set a trap so when a user casts a Spell on your post, the Spell is nullified and you gain EX
    equal to its cost."
  - **Spell Trap (Played)** (3): "This card has seen better days, but it might still work..." The art is the same
    card, creased.
- A HELP button closes the panel.

**`spellbook-cast-list-desktop.png`**: the Spellbook opened on someone else's post, to cast.

- It opens on a line in The System's voice: "It seems this user's post has captivated you, for better or worse. How
  shall you thank them?"
- **Each spell shows its price and the Rally it adds:** Feelin' Fab (Sweet), 100 EX and +0.02x; Size Matters (Salty),
  100 EX and +0.02x; Jimmy Wails (Sweet), 200 EX and +0.05x; Outta Sight (Salty), 200 EX and +0.05x; Whoops! (Salty),
  200 EX and +0.05x; Overreaction (Pepperoni), 200 EX.
- **Alignment icons:** a lollipop for Sweet, a salt shaker for Salty, a slice of pizza for Pepperoni.
- **The descriptions as shipped:**
  - Size Matters: "Shrink this post, providing a magnifying glass for users who wish to read it."
  - Jimmy Wails: "Dear readers, we'll get right to it: this Spell adds a Good Sh\*t donation drive below the post,
    with your customized plea."
  - Outta Sight: "Convert this post's text to Braille. Anyone wishing to read it must press a button, after which a
    friendly digital voice will narrate it to them. 1 EX per character, 200 EX minimum." The Season 1 roster planned
    a 100 EX minimum (`season-1-spellbook-roster.csv`); what shipped is 200.
  - Whoops!: "Cover this post with an ink splat, making it unreadable. The poster will have to clean up the spill to
    make it go away."
  - Overreaction: "Pick a single reaction emoji to be made huge on this post."
- **One postbit carries a DUPE rank.** On Minus World a second account could be labeled as one, in public.
- A post's star button opens out to read SPELLS on hover.

## What they suggest

- **Minus World was already halfway to one mechanic.** Spells were cast from the Spellbook on someone else's post.
  Items were used from the Inventory on your own post, and the Inventory was shown inside the Spellbook. Divided
  World's postcard is bought from the Vending Machine and held until played (`engine/rules/cards.ts`), so a hand
  already exists. What would separate a spell from an item is how the card is played: cast on another's post, used on
  your own, set face down, or worn.
- **The trap is a real category.** A Spell Trap is set on your own post, and the next spell cast there springs it.
  Hidden until it springs, it is a bluff the game can hold. Respellent is the open version: a ward that deters by being
  seen.
- **A played card might still work.** A worn copy of a card, cheaper and with a chance of failing, fits postcards
  that pass through the mail creased and stamped. The draw is seeded and logged, and the player's own log says plainly
  whether it worked ("The fiction may lie; the log never does").
- **A card in play shows who cast it and takes reactions.** This matches Divided World's design, where playing a card
  is an Act in the thread, open to reactions (`docs/plans/2026-10-28-core-loop-design.md`, section 7).
- **A per-character price with a floor** (Outta Sight) is how Whoops! is already priced by its post's length.
- **The DUPE rank cannot come to Divided World.** Who owns a character is a private fact ("A response never proves a
  private fact"). A mask is never labeled as anyone's second.
- **The opening line** ("It seems this user's post has captivated you, for better or worse") is the register for the
  Vending Machine and the card screens.
