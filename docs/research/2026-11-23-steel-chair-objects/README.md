Record, written 2026-11-23.

# Steel Chair's other objects: the sounds the owner picked

The design session for `docs/plans/2026-11-23-steel-chair-objects-design.md` generated four takes of each sound with
ElevenLabs Sound Effects (model `eleven_text_to_sound_v3`, prompt influence 0.3, on the owner's paid subscription, in
the flow "Divided World: Steel Chair objects"), and the owner picked these on 2026-11-23. They wait here, outside
`instances/divided-world/ui/sounds/`, because that folder's test holds every file in its manifest to a slot in
`sounds.ts`, and slots are product code. The plan's Task 9 moves each one in under the same name, adds its manifest
entry and measures it with `node tools/measure-sounds.mjs`.

| File | Take | Prompt |
|---|---|---|
| `steel-chair-can-hit.mp3` | can hit, take 1 | A metal garbage can thrown hard against a wall: one loud hollow galvanized-steel BANG with a tinny boomy ring, pro wrestling arena impact, dry, under 1.5 seconds |
| `steel-chair-can-settle-1.mp3` | can settle, take 3 | An empty galvanized metal trash can falls onto a hard floor and rolls a short way, hollow rattling clatter, then settles, about 2 seconds |
| `steel-chair-can-settle-2.mp3` | can settle, take 4 | (the same) |
| `steel-chair-ladder-hit.mp3` | ladder hit, take 3 | An aluminum step ladder slams flat against a wall: sharp clanging metallic crack with rattling rungs, wrestling arena impact, dry, under 1.5 seconds |
| `steel-chair-ladder-settle-1.mp3` | ladder settle, take 2 | A folded aluminum step ladder drops onto a hard floor, bounces once and clatters flat, light rattling metal, about 1.5 seconds |
| `steel-chair-ladder-settle-2.mp3` | ladder settle, take 4 | (the same) |
| `steel-chair-extinguisher-hit.mp3` | extinguisher hit, take 3, raised | A heavy steel fire extinguisher hits a wall: deep dull metallic thunk with a short ring, heavy and solid, dry, under 1 second |
| `steel-chair-extinguisher-settle-1.mp3` | extinguisher settle, take 3 | A heavy fire extinguisher canister drops on a hard floor and rolls briefly, heavy metallic clunk and rolling rumble, about 1.5 seconds |
| `steel-chair-extinguisher-settle-2.mp3` | extinguisher settle, take 4 | (the same) |
| `steel-chair-extinguisher-hiss.mp3` | extinguisher hiss, take 4 | A fire extinguisher discharging: a sudden loud pressurized whoosh-hiss of powder spraying out, then trailing off, about 2.5 seconds |

The owner found the extinguisher's hit too quiet. As generated it measured -24.3 LUFS with a true peak of -5.8 dBFS, so
`gainOf` (`instances/divided-world/ui/sounds.ts`) would have been held by the peak ceiling to about -19.5 LUFS, 1.5 dB
under the other sounds. It was raised 6 dB through a limiter:
`ffmpeg -i take3.mp3 -af "volume=6dB,alimiter=limit=0.84:attack=1:release=40:level=disabled" -c:a libmp3lame -b:a 128k`,
giving -19.0 LUFS at a -1.9 dBFS peak, which `gainOf` brings to the shared -18.

A lid sound was generated and is not here. The owner was unsure the lid needed a noise of its own, and the can's hit
(a hollow bang with a tinny ring) already covers the lid leaving; the take that worked best measured -27.2 LUFS. The
design records it as decided, and the owner may strike that in review.

Source and license for the manifest, as the chair's own sounds carry them: `source` "ElevenLabs Sound Effects",
`maker` "Divided World", and the license string of `steel-chair-hit.mp3`'s entry, word for word.
