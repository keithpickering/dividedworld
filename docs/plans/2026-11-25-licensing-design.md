Record, written 2026-11-25.

# Licensing: KayfaBB, Divided World, and what they carry

A design session with the owner. Until now the only original work in this repository with terms of its own was the card
art (CC0, `specs/card-art.md`). The code had no license, which means nobody but its authors could lawfully use, copy or
fork it: the opposite of an engine meant to be open, shareable and forkable by anyone. This design gives each layer its
terms, says which files are not ours to license, and adds a guard so that a file's terms are always declared.

## 1. The engine: AGPL-3.0-or-later

**Decided.** KayfaBB's code is licensed under the GNU Affero General Public License, version 3 or (at the reuser's
option) any later version. The copyright line is "Copyright (C) 2026 Keith Pickering and the KayfaBB contributors".

The owner's worry was a fork repackaged and sold to customers who don't know they could have the same thing for free.
No open-source license forbids selling, and a license that did would not be open source. It would also catch a
community instance that takes donations. Copyleft is the tool that fits: anyone may sell a fork, but whoever receives it
gets the full source under the same license and may share it freely. A web forum is run, not handed out, so the plain
GPL would not reach a hosted fork. The AGPL's section 13 does: whoever runs a modified KayfaBB for users must offer those
users its source.

Weighed and set aside:
- **MPL-2.0** (file-level copyleft): a hosted fork owes nobody its source.
- **MIT**: a closed, resold fork with no word of where it came from is exactly the outcome the owner named.
- **A source-available non-commercial license** (PolyForm Noncommercial and the like): not open source, and it bans the
  community instance that runs ads or takes donations.

**What is the engine:** `engine/`, `supabase/`, `tools/`, `web/`, `e2e/`, `scripts/`, the root configuration files, and
the repository's own documents and skills (`docs/`, `specs/`, `.claude/`, `CLAUDE.md`, `README.md`, `PRODUCT.md`,
`spec.md`). Its own pictures (the card template, the vending test art) are the engine's and carry its terms. The
machinery copied from currents (`docs/plans/port-manifest.md`) is the owner's own work and is licensed here like the
rest of the engine. The engine carries its `LICENSE` with it when it moves to a repository of its own (CLAUDE.md,
"KayfaBB never knows which instance it runs").

## 2. Divided World: AGPL-3.0-or-later or CC BY 4.0, the reuser's choice

**Decided.** Everything Divided World made in `instances/divided-world/` (its code, its words, its pictures, its prompts
and its personas) is offered under AGPL-3.0-or-later or Creative Commons Attribution 4.0 International, whichever the
reuser picks. The credit CC BY asks for is "Divided World (https://dw.gripe)", and the instance's license statement
offers that line as the preferred one.

Much of the instance's writing (personas, Mod Bot lines, class descriptions, card text) lives inside its `.ts` files, so
a split by file type would have left the words under the AGPL. With the dual offer, anyone can lift a persona, a prompt
or a card's words with credit alone. No closed fork of the game comes out of it, because the instance's code does
nothing without the engine, and the engine stays AGPL only.

Weighed and set aside:
- **CC BY-SA 4.0**: share-alike would bind anyone who mixes our content with their own, and it doesn't mix cleanly
  with CC0 or many other licenses.
- **CC0 with a credit request**: no guaranteed credit, and the owner wanted the backlink.
- **A split by file type**: it leaves the writing in `.ts` files under the AGPL.
- **SPDX-marked regions inside files**: every new card and persona would have to remember the marker, and a check
  would have to police it.

**Card art already published under CC0 stays CC0.** A CC0 dedication cannot be withdrawn from copies already out, and
each `art.json` already says CC0. A new art set names its own terms in its `art.json`, as `specs/card-art.md` already
provides; the cards README tells a contributor that the instance's default is the dual offer.

## 3. What is not ours to license, and fan art

Every file whose terms are not the layer's default says so where it is declared (section 6). The files known today:

| Files | Terms | Why |
| --- | --- | --- |
| `ui/themes/hot-debate/fire.gif`, `fire-still.png` | CC BY-SA 3.0 | Nevit Dilmen's work on Wikimedia Commons, credited in `CREDITS.md` and on the footer |
| `ui/jimmy-wails/plates/*.png` | CC BY-SA 3.0 | Wikimedia Commons photographs, credited in `CREDITS.md` and on the banner |
| `ui/fonts/*.woff2` (Anton, Barlow Condensed, Silkscreen) and `cards/autocorrect/fonts/GochiHand-Regular.woff2` | SIL Open Font License 1.1 | Their `OFL.txt` sits beside them |
| `ui/public/mail/fonts/*.woff2` | SIL OFL 1.1 | Byte copies of `ui/fonts/` made by `tools/make-mail-assets.mjs`. **Today they are served with no `OFL.txt`**, and the OFL asks that the license go with every copy; this plan copies it |
| `ui/this/fonts/PermanentMarker-Regular.woff2` | Apache 2.0 | `LICENSE.txt` beside it |
| `ui/sounds/*.mp3` | ElevenLabs' terms | Made with ElevenLabs on a paid plan. Divided World may use them; whether it may pass rights on to others is open (section 8), so they are **not** offered under CC BY |
| `engine/system/tokenizers/gpt2/` | Modified MIT (OpenAI) | Its `LICENSE` is beside it |
| `.claude/skills/impeccable/` | Apache 2.0 | Declared in its `SKILL.md`. **No license text ships with it today**; this plan adds it |

**Fan art goes under the instance's terms, with what isn't ours named.** The owner's word:
- **The Wiggler sprite sheet** (`ui/front-door/wiggler-sheet.gif` and its `-dropshadow` copy): drawn by Keith
  Pickering and first published on MFGG on 2005-04-17. Wiggler is Nintendo's character and mark, not licensed here.
- **FanGaME** (`fangame-portrait.webp`, `fangame-square.webp`): made with Gemini in November 2026. It uses Nintendo's
  marks, which are not licensed here.
- **D-Guy, Chadluminum and Serious Deer** (`dguy_*`, `robochad_*`, `deer_*`): made with ChatGPT more than two years
  ago. D-Guy refers to Nintendo's Toad, which is not licensed here.
- **Snuckles** (`snuckles_*`): this image is Keith Pickering's own take, drawn in 2025, and the CC BY offer covers this
  image only. **It grants no rights in the Snuckles character**, which Keith Pickering, Elliot Wallis and Jacob Stacy
  created together. Licensing the character itself would need all three, so it is not offered (section 8). The image's
  credit is "Art by Keith Pickering", with the character's creators named beside it.
- **Gabe** (`gabe.png`, from the owner's sprite): drawn by Keith Pickering in 2025.
- **The machine-made images** each say they were machine-made, and that such an image may hold no copyright for the
  license to cover. The offer is made as far as there are rights to offer.

**Human Josh is removed.** `ui/avatars/human.jpg` comes from a depixelizer's "reconstruction" of a pixelated
photograph of Barack Obama (tg-bomze/Face-Depixelizer). That brings in a photographer's copyright we cannot trace and a
real person's likeness, so no credit line makes it ours to offer. The owner agreed to its removal. Its one use, Human
Josh on the hype stage (`ui/hype/stage-world.ts`), loses its picture and is drawn as the initial the engine draws for
any persona without one (`InstanceUi.avatars`, "a persona with none is drawn as an initial").

**`docs/research/`** holds captures of other sites and works made for research. They are records, kept for what they
show, and are not offered under any license here. `LICENSING.md` says so.

## 4. Names, contributions, and the root documents

- **`LICENSING.md`** (current) is the one map. It covers:
  - which paths are the engine and which are an instance, and each one's terms;
  - where a file's own terms are declared (section 6);
  - the preferred credit line;
  - the `docs/research/` exclusion;
  - the names (below).

  It points to the manifests and to the License & credits page rather than copying their rows, so it holds no list
  that could drift from them (CLAUDE.md, "Two lists that must agree are one list").
- **`LICENSE`** at the root is the AGPL's full text, verbatim. **`instances/divided-world/LICENSE.md`** states the
  dual offer and the credit line, and links CC BY 4.0's legal code.
- **Names, in `LICENSING.md`:** neither license grants the names "KayfaBB" or "Divided World". Forks are welcome and may
  say they are based on KayfaBB or Divided World, but may not present themselves as the official KayfaBB or Divided
  World. No AGPL section 7 term is added. Weighed and set aside:
  - **A section 7(b) term requiring a visible "Powered by KayfaBB" credit** would guarantee the backlink. But it
    modifies the license, and every fork inherits it.
  - **Saying nothing** would let a fork sell itself as "KayfaBB".
- **Contributions are inbound = outbound.** A contribution is licensed under the terms of the folder it lands in, or
  under the terms its own declaration names (an artist's `art.json`). This goes in a new `CONTRIBUTING.md` and a line
  in a new `.github/pull_request_template.md`. There is no DCO and no CLA. The consequence, accepted: relicensing the
  engine later would need every contributor's agreement.
- `package.json` gets `"license": "AGPL-3.0-or-later"`.

## 5. What players see

The board footer (`engine/ui/frame/Frame.tsx`) reads "Powered by KayfaBB · Source · License & credits":
- **Source** links to `InstanceUi.licensing.source`, a new required field: the URL where this deployment's source can
  be had. It is required so that a fork must name its own source; an empty or non-`https:` value is refused by
  `instanceUiProblems`. Divided World's is `https://github.com/keithpickering/dividedworld`. This is how a deployment
  meets AGPL section 13.
- **License & credits** links to a new public glass page at `/license`.

The page is the glass, plain and never in character (CLAUDE.md, "The fiction may lie; the log never does"), and is
modeled on the code of conduct page (`engine/ui/conduct/Conduct.tsx`), public and signed-out alike. It holds:
1. **The engine's notice**, in the engine's own words: KayfaBB's copyright line, that it is free software under
   AGPL-3.0-or-later, that it comes with no warranty, and the Source link.
2. **The instance's terms**, as the instance's own Markdown (`InstanceUi.licensing.terms`), drawn through the guide's
   renderer as the code of conduct's sections are.
3. **The credits:** every declared file whose terms or maker differ from the instance's default, as a list of work,
   maker, terms (linked where there is a URL) and note. Divided World builds the list from the same manifests the guard
   reads (section 6), so the page cannot say something the manifests don't.

The engine knows no instance's name or URL; every word and link on the page apart from the engine's notice comes
through `InstanceUi.licensing`. The page reads nothing from the server and depends on no private fact, so it adds
nothing that could prove one (CLAUDE.md, "A response never proves a private fact"). It adds no state a player can be
put in.

## 6. The guard: every media file's terms are declared

`tools/check-licenses.mjs` and its self-test `tools/test-licenses.mjs`, added to `STEPS` in `tools/build.mjs`.

**Media files:** `.png .jpg .jpeg .gif .webp .svg .ico .mp3 .ogg .wav .mp4 .webm .woff .woff2 .ttf .otf` under
`engine/`, `instances/`, `web/` and `supabase/`.

**Each must be declared exactly once**, by one of the declarations the repository already has or one new one:
1. An `art.json` declares its own folder's `art.svg`, `art.webp`, `mark.svg` and `relief.webp`. Its `license` is the
   terms and its `credit` the maker.
2. A `sounds.json` declares each row's `file`. Its `license` is the terms and its `maker` the maker.
3. A `CREDITS.md` declares each file named in backticks in the first column of its table. The terms are that row's.
4. **New:** a layer's `licenses.json` (`engine/licenses.json`, `instances/divided-world/licenses.json`) declares the
   files its rows list, by path relative to the file's own folder. Each row is
   `{ files, maker, terms, work?, source?, note?, licenseFile? }`:
   - `terms` is `"layer"` (the layer's own terms, as section 1 or 2 states them) or
     `{ name, url }` for terms of its own.
   - A row with terms of its own names its `source`.
   - A font row with terms of its own names a `licenseFile` that exists in the font's folder.

**It fails** on a media file declared nowhere, a file declared twice, a declared file that doesn't exist, a blank
`maker` or terms, and a font with terms of its own and no license file beside it.

**It reads only the repository's files**, so no database question arises (CLAUDE.md, "A test that builds its own
subject cannot tell you the subject is missing" does not apply).

## 7. Layers

Each part, by layer:
- **Engine:**
  - the `licensing` field on `InstanceUi` (`engine/ui/types.ts`) and its problems in `instanceUiProblems`;
  - the footer;
  - the `/license` page and its route;
  - `engine/licenses.json`;
  - the guard.
- **Instance:**
  - Divided World's `licensing` value: the source URL, its terms Markdown, and the credits it assembles from its
    manifests;
  - `instances/divided-world/licenses.json`;
  - `instances/divided-world/LICENSE.md`;
  - the removal of Human Josh's picture.
- **Repository:** `LICENSE`, `LICENSING.md`, `CONTRIBUTING.md`, the PR template, `package.json`, and the impeccable
  license text.

## 8. Open

- **The ElevenLabs sounds:** whether ElevenLabs' terms let Divided World pass rights in the sounds on to others. Until
  someone reads those terms and confirms it, the sounds are used here and not offered.
- **The Snuckles character:** licensing it, as distinct from this image, needs Elliot Wallis and Jacob Stacy. Not
  pursued now, and it blocks nothing.
- **Real people in parody:** Jimmy Wails parodies a real person. A license covers copyright, not anyone's likeness or
  name, and the engine's licenses say nothing about it. Not settled here.
- **A legal read.** This design is the owner's choice of terms, written carefully, and not legal advice. A lawyer's
  read is worth having before anyone relies on these terms beyond a fan community's reuse.
- **Players' posts** are not in the repository, and their terms belong to an instance's terms of use, a separate
  design.
