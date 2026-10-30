# The MFGG wiki, mined for The System

Record, written 2026-10-30. A survey of the MFGG wiki (wiki.mfgg.net), the community's own history of Mario Fan Games
Galaxy, read on that date for two things: how MFGG's administration (the "Old Guard") spoke and ruled, which is the
attitude The System and its Mod Bots are written in, and the in-jokes, fads and lore a Divided World board can draw
on. The owner, asking for it: "there is no better source on earth for the 'system attitude' than the MFGG
administration [...] No better source for random in-jokes than the annals of this wiki. This is how we dial in the
system prompt(s)."

## What was read

Every page in the wiki's main namespace that is not a redirect: 1,730 pages, read through the wiki's MediaWiki API
(`https://wiki.mfgg.net/api.php`, `action=query`, `generator=allpages`, `gapnamespace=0`,
`gapfilterredir=nonredirects`, `prop=revisions|categories`, `rvprop=content|timestamp`, `rvslots=main`, 50 pages to a
request with a pause between requests). The pages were split by category and title into four lanes, and each lane was
read in full and distilled into one record here.

- `old-guard.md`: lane A, the administration. How staff spoke, the ranks, warns and bans, moderation played as a
  spectacle, the eras, and the staff archetypes.
- `forums-and-events.md`: lane B, the boards. Board eras, secret and penalty forums, prunings and hacks, April Fools by
  year, staged storylines, seasonal events, contests and forum games.
- `lexicon.md`: lane C, the culture. The community's words, fads and running jokes, its bots, the fangames that became
  jokes, groups and awards.
- `members-and-games.md`: lane D, the member and game pages. Admin voice as it shows on members' pages, masks and
  dupes, catchphrases, and the games that became canon.
- `system-voice.md`: what the four lanes give The System's prompts, gathered in one place.

Each item cites the wiki page it comes from by title in brackets, so it can be found again on the wiki.

## What was kept out

**The dump itself is not in this repository.** The wiki states no license, and this repository is public, so only
these distilled records are committed, with short quotes attributed to their pages. The API call above fetches the
same pages again.

**People.** The wiki is about real people, many of them teenagers when it was written, and some of them may play
Divided World. Staff are named only for what they did as staff. A member is named only where the item is affectionate
or neutral (a beloved mask, a catchphrase the community owns), marked *(individual: owner's call)* so the owner can
decide whether it reaches the game. Where an item is unflattering to a member (a ban, a dupe, a flamewar, a game
mocked), the phenomenon is kept and the member is not named. Personal details on any page were read and not copied.
Pages built around slurs, Nazi jokes or similar were left out entirely, and are not named.

**Nothing here is a decision.** Each record's suggestions for Divided World are ideas, held to `CLAUDE.md`'s rules
when one is designed: The System acts inside bounded effects, nothing destroys what a player wrote, no player is ever
stuck, the log never lies, and nothing is computed from a private fact.

## What is still wanted

- **A full Minus World export**, the source most wanted: the forum's own posts would show how its players spoke, which
  the wiki only reports on.
- **Minus World's own pages**, saved from the Wayback Machine the way the owner saved the Strategy Guide
  (`docs/research/minus-world/strategy-guide.md`): the Spell Reference, the Inventory, the Killing Game Wiki and The
  Goods. From this session's container `web.archive.org` did not answer.
