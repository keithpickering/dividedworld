# Contributing

Thank you for helping. The working rules every session follows are in `CLAUDE.md`; the terms are mapped in
`LICENSING.md`.

## Your contribution's license

What you contribute is licensed under the terms of the folder it lands in: the AGPL-3.0-or-later for the engine, and the
AGPL-3.0-or-later or CC BY 4.0, the reuser's choice, for `instances/divided-world/`. Where your contribution's own
declaration names other terms (an artist's `art.json`), those are its terms. There is no CLA and no DCO. The consequence
is that changing the engine's license later would need every contributor's agreement.

## Artists

Card art has its own steps in `instances/divided-world/ui/cards/README.md`. Art you offer without other terms comes
under the instance's dual offer, and its `art.json` names the terms either way.

## New media files

A new picture, font or sound needs its declaration (`art.json`, `sounds.json`, `CREDITS.md` or a `licenses.json` row) in
the same change, or the build refuses it. `tools/check-licenses.mjs` is the check.
