Record, written 2026-11-26.

# Event rarity and fixed-item events: design

Asked by the owner on 2026-11-26. A Random Event today rolls its three parts apart: an outcome by weight (line, gear,
card or none), then for gear or a card an item by rarity and uniformly within it (`draw_by_rarity`), then a line
uniformly among that outcome's lines. The item rarity works and stays. The owner asked for two things beside it:

1. **An event can name its item.** "You find the Nostalgic Hat in the attic" gives the Nostalgic Hat, every time.
2. **An event has a rarity.** Common, uncommon, rare or legendary, weighted by rarity and then uniform within it, as
   items and pack pulls are, so that no event carries a weight of its own that every new event would retune.

"Event" below means what the code calls an event line (`EventLine`, `event_lines`): the words a Random Event says, now
with a rarity and, for a gear or card outcome, maybe an item.

This extends section 5 of `docs/plans/2026-11-04-cosmetics-design.md`. That design weighed and turned down "a weight
per gear item (every new item retunes the rest)"; this design keeps that reasoning and applies it to events.

## 1. Where event rarity sits in the roll

**Decided** (the owner chose the recommendation): inside the outcome roll.

1. The **outcome** is rolled as today, by `events.outcomes`.
2. An **event rarity** is rolled by a new weight table, `events.eventRarity`, among the rarities that hold an eligible
   event of that outcome. Then an event is picked uniformly within it, ordered by key as today.
3. If the event names an **item**, that item is given. If not, the item is drawn as today, by `gearRarity` or
   `cardRarity`.

The outcome weights still say how often a player finds gear and how often a card. Event rarity only says which gear
event (or card event, or line) it is. Adding an event changes the odds only of the events that share its outcome and
its rarity.

An event is **eligible** when it can give what it says:
- an event that names an item: that item can be given now (a card in print, not gone, and not withheld for want of the
  old voice, as `draw_pool` holds it);
- an event of gear or a card that names none: `draw_by_rarity` has something at a weighted rarity;
- a line-only event: always.

A rarity with no eligible event is skipped, as `draw_by_rarity` skips a rarity with no item. A roll whose outcome has
no eligible event finds nothing, closes the window and writes nothing, as today's roll does when an outcome has no line.

Weighed:
- One pool of every event, of every outcome, drawn by event rarity alone, with the outcome weights gone. Then how often
  a card drops would hang on how many card events had been written at each rarity, and a new line would retune it.
- A separate roll for special events before the outcome roll. That adds a second set of numbers and splits events into
  two kinds.

## 2. An event's rarity against its item's

**Decided** (the owner chose the recommendation): an event that names an item is **at least as rare as the item**.
The instance's check refuses a common event that names a rare piece of gear, and the message names the event, the item
and both rarities. A rare event may name a common item (a rare joke that hands over a cap). So an item's label stays
true: no rare item is found more easily than "rare" says.

Weighed: no tie at all (a rare item made common by one careless line, with nothing to catch it); the two rarities
multiplied (neither label then says the odds).

## 3. Showing an event's rarity

**Decided** (the owner, after the prototype below): an event rarer than common is shown in the dialog's **title bar**.
"SOMETHING HAPPENED!" stays where it is, and at the bar's other end stands the rarity's gem and its name, "★ RARE
EVENT", in the rarity's color. The frame does not change. A common event looks exactly as every event does today. The
item's own line stays below the event's words ("Common gear, now in your wardrobe."), so a rare event that gives a
common cap says both.

The gem and colors are those the vending odds and the wardrobe already draw (`.kb-gem`, `gemOf`, `rarityName`): ◆
uncommon in the glass's sweet cyan, ★ rare in its ready gold, ✴ legendary in its salty pink. A rarity is told by the
gem's shape and the word, never by color alone. The owner asked that it read subtly, and judged the bar's tag "not
too loud". This is the glass, so the tag is plain and true: it says how rare the event was, which is a fact about
the roll and only the player's own.

The prototype was drawn on the live dialog in Storybook (`Glass/Random Event`), three treatments at uncommon, rare
and legendary. It was not committed: (A) a gem and word at the bar's end, chosen; (B) the frame in the rarity's color
with a lone gem, no word; (C) B with a glow and the word under the title. It also showed that uncommon's cyan is the
dialog frame's own, which is one reason a recolored frame was not chosen.

The event row keeps the event's rarity **as it was when the event happened**, beside the line's key and text it
already keeps. A later seed can then retune an event without rewriting history, and an export carries it. The log
line is unchanged: it already says what was found and by which mask.

Weighed: hidden (a legendary line would look like any other); a tag on every event, common included (noise on most of
them); the frame and glow treatments (B, C) above.

## 4. Writing an event's rarity, and the starting weights

**Decided** (the owner chose the recommendation):
- `rarity` on an event is **optional and defaults to common**, so an everyday line needs no field, and today's fifteen
  lines are all common with no edit.
- `events.eventRarity` starts at `{ common: 80, uncommon: 15, rare: 4, legendary: 1 }`: one table for all three
  outcomes, each weight a setting the season review retunes. With every event common, nothing changes. A single rare
  gear event is then about 4% of gear events, which is about one roll in 120 at today's outcome weights. A single
  legendary gear event is about one roll in 470.

## 5. Event-only items

**Decided** (the owner chose the recommendation over leaving it for later): a piece of gear or a card may be marked
**`eventOnly`**. Such an item is never drawn at random: not by a gear or card event that names no item, and not by a
pack's pull. It is found only through the events that name it. An admin may still give it, as an admin gives anything.

The instance's check holds what this opens:
- an event-only item that no event names, and that is not out of print, is refused. It could never be found, which is
  a dead end ("No player is ever stuck").
- the machine's slot or a fixed pack's contents (the starting pack among them) that name an event-only card is
  refused. Those are other ways to hand out a card, and an event-only card has one way.
- a pack's `leaves` may name one: it is left out anyway, so this changes nothing.

The vending odds (`packOdds`) and the TypeScript roll (`rollPack`) leave an event-only card out as they leave out a
card out of print, so the odds a player reads are the odds the SQL rolls.

Weighed: every item stays in the random draws (a fixed event is then only a scripted way to find something common);
leaving it open for a later design.

## 6. The layers and the masks

**The layers.** The engine holds the rules: the roll, the checks, the `eventOnly` flag, the dialog's tag. The instance
holds the content through interfaces it already has: `Instance.events.lines` gains `rarity?` and `item?` on
`EventLine`, `GearRules` and `CardRules` gain `eventOnly?`, and `Settings.cosmetics.events` gains `eventRarity`. The
SQL knows the flags and keys, never which instance.

**The masks.** Nothing here reads anything but the caller's own account and the instance's content. The roll reads
the account's own past rolls, as it does today. The new fields in its answer (the event's rarity) are about the
caller's own roll, and the dialog says "Only you see this" as before. No response, payload, Realtime event or timing
depends on another account. Whether an item is event-only is public content of the instance, as its rarity is.

**Ways out.** This adds no state a player, a character or a post can be put in.

## 7. Placeholder content

To exercise the feature, the instance gains one example: a rare gear event, "You find the {item} in the attic", that
names the Nostalgic Hat, and the Nostalgic Hat marked `eventOnly`. The names, the line and the art are placeholders
the owner replaces with the Minus World gear, as the rest of `instances/divided-world/gear.ts` and `events.ts` are.
The owner approves them in review, as the glass's other copy is approved.

## 8. Open

- Whether a legendary event should do more than its tag (a sound, a motion) is not designed. The tag is the whole of
  it for now.
- Event-only cards add no line to the vending machine's own screens. A player learns of one by finding it.
