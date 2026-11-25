Record, written 2026-11-25.

# Licensing: the plan

Carries out `docs/plans/2026-11-25-licensing-design.md`. Read it whole first; this plan names its sections as "design §n".
Every task tests first and shows its red run. Nothing here touches a deployed database, bucket or connector.

## Task 1: The guard, red first

**Model:** sonnet

**Files:**
- New: `tools/test-licenses.mjs` and `tools/check-licenses.mjs`.
- Changed: `tools/build.mjs`'s `STEPS`, with the test immediately before the check (the file's header says where).

**What the check does.** It walks `engine/`, `instances/`, `web/` and `supabase/` (skipping `node_modules`) for the
media extensions in design §6, and collects declarations from:
- every `art.json`;
- every `sounds.json`;
- every `CREDITS.md`: the files in backticks in the first column of its table;
- each `licenses.json`.

Paths resolve against the declaring file's folder. Write the check as a pure function over a file list and file
contents, with a thin edge that reads the disk, as `tools/check-card-art.mjs` does, so the test can feed it fixtures.

**It refuses, naming the predicate and the path:**
- a media file declared nowhere;
- a file declared by two declarations (say which two);
- a declared file that does not exist;
- a `licenses.json` row whose `maker` is blank, or whose `terms` is neither `"layer"` nor `{ name, url }` with both
  non-blank;
- a row with terms of its own and no `source`;
- a font (`.woff .woff2 .ttf .otf`) declared with terms of its own whose `licenseFile` is missing, or names no file in
  the font's folder;
- a `licenses.json` that is not JSON, or not an array of rows.

**The self-test's poisons.** Each must drive the check red, and a clean fixture must pass:
1. an undeclared `x.woff2`;
2. a `licenses.json` row listing `gone.png`, which does not exist;
3. `art.webp` declared by its folder's `art.json` and again by `licenses.json`;
4. a row with `terms: { name: "", url: "https://x" }`;
5. a font row with `terms: { name: "OFL-1.1", url: "…" }` and no `licenseFile`. This is today's `public/mail/fonts`
   defect.

Then a red run of the real check against the repository shows the undeclared files (Task 2 makes it green). Commit the
guard with the build red only if the build session's own rules allow; otherwise land Tasks 1 and 2 in one commit, with
the red run shown in the PR body.

## Task 2: Declare every file; remove Human Josh; ship the missing license texts

**Model:** sonnet

**Files:**
- New: `engine/licenses.json` and `instances/divided-world/licenses.json`.
- New: `.claude/skills/impeccable/LICENSE`, the Apache 2.0 text (Debian ships it at
  `/usr/share/common-licenses/Apache-2.0`; copy it verbatim).
- Changed: `tools/make-mail-assets.mjs` copies the `OFL.txt` that sits beside the fonts it copies into
  `<ui>/public/mail/fonts/`, recorded in `outputs`. Run it to regenerate `instances/divided-world/mail/assets.json` and
  `ui/public/mail/fonts/OFL.txt`, and keep `tools/check-mail.mjs` and its test green. If `check-mail` holds an exact
  output list, extend its test to expect the license file.
- Deleted: `instances/divided-world/ui/avatars/human.jpg`.
- Changed: `instances/divided-world/ui/hype/stage-world.ts` loses the `joshPicture` import and Human Josh's
  `avatarPortrait` and `avatarSquare`. Confirm in `ui/hype/Nodes.tsx` and `Camera.tsx`, with a test, that a stage
  persona with no picture draws its initial and nothing breaks. If the stage cannot draw one, stop and tell the owner;
  do not invent art.

**Rows.** Every media file the Task 1 red run listed gets exactly one row. Write `files` as paths relative to the
`licenses.json`. `"layer"` terms with maker "Divided World" is the row for a file this repository's own tools or
sessions made; establish that from the file's `make*.py`/`scene.py`/`tools/make-*.mjs`, its plan, or its research
folder, and cite which in a `note`. **A file whose origin you cannot establish that way is not declared as ours: stop
and list it for the owner.** The known rows:

| Files (under `instances/divided-world/`) | maker | terms | note |
| --- | --- | --- | --- |
| `ui/front-door/wiggler-sheet.gif`, `ui/front-door/wiggler-sheet-dropshadow.gif`, `ui/hype/wiggler-sheet.gif` | Keith Pickering | layer | "Drawn by Keith Pickering, first published on MFGG on 2005-04-17. Wiggler is a character and trademark of Nintendo and is not licensed here." |
| `ui/avatars/fangame-portrait.webp`, `ui/avatars/fangame-square.webp` | Divided World | layer | "Made with Gemini in November 2026. It uses Nintendo's trademarks, which are not licensed here. A machine-made image may hold no copyright for this license to cover." |
| `ui/avatars/dguy_portrait.jpg`, `ui/avatars/dguy_square.jpg` | Divided World | layer | "Made with ChatGPT before 2025. It refers to Nintendo's Toad, which is not licensed here. A machine-made image may hold no copyright for this license to cover." |
| `ui/avatars/robochad_*.jpg`, `ui/avatars/deer_*.jpg` (list each file) | Divided World | layer | "Made with ChatGPT before 2025. A machine-made image may hold no copyright for this license to cover." |
| `ui/avatars/snuckles_portrait.png`, `ui/avatars/snuckles_square.png` | Keith Pickering | layer | "Art by Keith Pickering, 2025. This license covers this image only and grants no rights in the Snuckles character, created by Keith Pickering, Elliot Wallis and Jacob Stacy." |
| `ui/avatars/gabe.png` | Keith Pickering | layer | "Drawn by Keith Pickering, 2025." |
| `ui/fonts/Anton-Regular.woff2`, `ui/fonts/BarlowCondensed-*.woff2` (each), `ui/fonts/Silkscreen-Regular.woff2` | Each font's copyright holder, as `OFL.txt` names it (one row per family) | `{ "name": "SIL Open Font License 1.1", "url": "https://openfontlicense.org" }` | `licenseFile: "OFL.txt"`; `source` is the family's repository from `OFL.txt` |
| `ui/public/mail/fonts/*.woff2` (each) | as above | as above | "Copied from ui/fonts/ by tools/make-mail-assets.mjs"; `licenseFile: "OFL.txt"` |
| `cards/autocorrect/fonts/GochiHand-Regular.woff2` | as its `OFL.txt` names | OFL as above | `licenseFile: "OFL.txt"` |
| `ui/this/fonts/PermanentMarker-Regular.woff2` | as its `LICENSE.txt` names, or "Font Diner" if it names none | `{ "name": "Apache License 2.0", "url": "https://www.apache.org/licenses/LICENSE-2.0" }` | `licenseFile: "LICENSE.txt"` |

Already declared, so they get no row:
- the card, back and pack folders (`art.json`);
- `ui/sounds/` (`sounds.json`);
- `ui/themes/hot-debate/` and `ui/jimmy-wails/plates/` (`CREDITS.md`).

`engine/licenses.json` declares `engine/ui/cards/card-template.svg` and `engine/ui/vending/pack-test-*.webp` with
maker "KayfaBB" and `"layer"` terms, once their origin is established as above.

**Done when** `node tools/test-licenses.mjs && node tools/check-licenses.mjs` passes and `npm run build:ci` is green.
Show both.

## Task 3: The repository's license texts

**Model:** sonnet

**Files:**
- New: `LICENSE`. This is the GNU AGPL version 3 text, verbatim. Take the FSF's canonical
  `https://www.gnu.org/licenses/agpl-3.0.txt`. This sandbox's proxy reset that host on 2026-11-25; if it still does,
  use `licenseText` of `licenses/AGPL-3.0-or-later.json` in the npm package `spdx-license-list@6.9.0`
  (`npm pack spdx-license-list@6.9.0`, in the scratchpad). That is the same text reflowed. Say in the PR which one
  you used.
- New: `LICENSING.md`, current, as design §4 lists. It must:
  - name the engine's paths and the instance's (design §1, §2) with each one's terms, and the copyright line;
  - give the preferred credit "Divided World (https://dw.gripe)";
  - say that a file's own terms, where they differ, are declared beside it in `art.json`, `sounds.json`, `CREDITS.md`
    or `licenses.json`, are checked by `tools/check-licenses.mjs`, and are listed on each instance's License &
    credits page;
  - say that the CC0 card art stays CC0;
  - give the `docs/research/` exclusion and the names paragraph;
  - say that the terms are the owner's and not legal advice.

  It copies no rows from the manifests.
- New: `instances/divided-world/LICENSE.md`, current. It states the dual offer (AGPL-3.0-or-later, see `../../LICENSE`,
  or CC BY 4.0, https://creativecommons.org/licenses/by/4.0/legalcode), the credit line, that files declared with
  other terms are under those, and the Snuckles and Nintendo carve-outs in one sentence each.
- New: `CONTRIBUTING.md`, current, with inbound = outbound (design §4). It points artists to
  `instances/divided-world/ui/cards/README.md`, and says a new media file needs its declaration or the build refuses it.
- New: `.github/pull_request_template.md`. Today there is none, so keep it to what this plan needs: a "Summary" heading
  and a checkbox line, "I license this contribution under the terms of the folders it changes (see
  CONTRIBUTING.md)".
- Changed: `package.json` gets `"license": "AGPL-3.0-or-later"`.
- Changed: `README.md` gets a short "License" section pointing to `LICENSING.md`.
- Changed: `instances/divided-world/ui/cards/README.md`, the paragraph at lines 146 to 149 ("That is the art's license
  alone; the repository's code has none yet"). The existing art stays CC0. New art offered without other terms comes
  under the instance's dual offer. Its `art.json` names the terms either way.

`tools/check-doc-references.mjs` must stay green: every path these documents name must exist. All copy is in American
English and plain.

## Task 4: `InstanceUi.licensing`, the footer and Divided World's value

**Model:** sonnet

**Files:**
- `engine/ui/types.ts`: new required `readonly licensing: Licensing`, with:

  ```ts
  /** Where this deployment's source can be had (AGPL section 13), its content terms, and its credits (the licensing design, section 5). */
  export interface Licensing {
    /** An https URL where the source this deployment runs can be had. */
    readonly source: string;
    /** The instance's own terms, Markdown, drawn on /license through the guide's renderer. */
    readonly terms: string;
    /** The credits /license lists (Task 5 fills it; [] until then). */
    readonly credits: readonly LicenseCredit[];
  }
  export interface LicenseCredit {
    readonly work: string;
    readonly maker: string;
    readonly terms: string;
    readonly termsUrl?: string;
    readonly source?: string;
    readonly note?: string;
  }
  ```
- `engine/ui/tips/problems.ts`, `instanceUiProblems`: add `'licensing'` to its `Pick`, and refuse a `source` that is
  blank or not `https:`, and blank `terms`.
- `engine/ui/frame/Frame.tsx`: the footer reads "Powered by KayfaBB", then a **Source** link (`ui.licensing.source`)
  and a **License & credits** link to `/license`. Update the comment above it. `frame.css` styles the links in the
  house style.
- `engine/ui/frame/Frame.test.tsx`: the test at line 177 says the footer "links nothing". Rewrite it to say the footer
  links exactly the source and `/license`, and keep the rest of it.
- `instances/divided-world/ui/index.ts`: Divided World's `licensing`:
  - `source: 'https://github.com/keithpickering/dividedworld'`;
  - `terms`: Markdown saying what `instances/divided-world/LICENSE.md` says, with links to both licenses;
  - `credits: []`.
- Every test fixture that builds an `InstanceUi` gets the field. Let the type check find them.

**Tests first:**
- a problems test for a blank and an `http:` source;
- the footer test above.

## Task 5: The `/license` page and the credits

**Model:** sonnet

**Files:**
- New: `engine/ui/license/License.tsx`, `license.css`, `License.test.tsx` and `License.stories.tsx`, modeled on
  `engine/ui/conduct/Conduct.tsx`. It is a public glass page: a `PageHead` titled "License & credits", then three
  sections.
  1. **KayfaBB.** The engine's own words: "KayfaBB is free software: you can redistribute it and/or modify it under the
     terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of
     the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but
     WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE."
     Then the copyright line, a link to https://www.gnu.org/licenses/agpl-3.0.html, and "Get the source this site
     runs" linking `licensing.source`.
  2. **This site.** `licensing.terms` through `parse` and `Blocks` (`engine/ui/guide/`), as the conduct page draws its
     sections.
  3. **Credits.** A list of `licensing.credits`. Each credit shows the work, "by" the maker, its terms (a link when
     `termsUrl` is set), and the source (a link) and note when set. An empty list shows no section.
- `engine/ui/glass-routes.tsx`: a `license` screen in `GlassScreens` and the route `{ path: '/license', … }`, loading
  its chunk alone like `/conduct`.
- `web/src/App.tsx` and `engine/ui/loaded.tsx`: register the screen as the others are. Update every test that lists
  the routes (`engine/ui/routes.test.tsx` and any `check-story-picks` expectation).
- New: `instances/divided-world/ui/credits.ts` builds `licensing.credits` from the manifests the guard reads, so the
  page and the guard read one set of facts:
  - `licenses.json` rows whose terms are their own, or whose maker is not "Divided World", or that carry a note;
  - `sounds.json`, as one credit;
  - the card, back and pack `art.json` files that share a maker and terms, as one credit ("Card art: every card's
    picture and mark, the card back, the pack art");
  - Hot Debate's credit (from the theme's `credit` in `ui/index.ts`);
  - each Jimmy Wails plate's credit (from `ui/jimmy-wails/plates.ts`).

  Import the JSON the way `ui/sounds.ts` and `ui/packs.ts` already do. A test holds the list to the manifests: every
  `licenses.json` row that qualifies appears.
- `instances/divided-world/ui/index.ts`: `credits` comes from `credits.ts`.

**Tests first:**
- the page shows the engine's notice, the source link, the instance's terms rendered, and a credit with each optional
  field present and absent;
- the page is reachable signed out;
- the route exists;
- the credits test above.

**The masks.** The page reads only `InstanceUi`. It makes no request and shows nothing computed from a private fact.

## Review focus

- **The poisons:** whether the guard's self-test drives each of the five red, and whether a media extension missing
  from its list lets a third-party file in unseen.
- **Exactly one declaration per file:** a file under a card folder that is not one of the four `art.json` names (a
  stray `.png` beside `scene.py`) must be caught, not silently covered.
- **A fork must name its own source:** the required `licensing.source` must actually refuse an empty or `http:` value
  in `instanceUiProblems`, and the footer must link that value, not a URL the engine knows.
- **The engine knows no instance:** no Divided World URL, name or credit enters `engine/`
  (`tools/check-engine-boundary.mjs` stays green).
- **No file declared as ours without its origin shown:** every `"layer"` row's note or commit says where the file came
  from. A guess about an avatar's or picture's origin is the defect this design exists to prevent.
- **The mail fonts:** `OFL.txt` is now among the deployed mail assets, and the regenerated `assets.json` matches.
- **Human Josh:** the hype stage with no picture renders, and nothing else imported `human.jpg`.
