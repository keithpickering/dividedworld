/**
 * Board 26, Edit profile (docs/research/2026-11-05-backfill/26-edit-profile.html, 1440 by 1420): the fields on the left, "What everyone will see" on the
 * right, the picture chosen with a secondary button beside the two crops' frames. The build is the story `Boards/00 Edit profile`
 * (engine/ui/profile-edit/ProfileEdit.board.stories.tsx), the board's title and signature typed by the manifest as a player types them.
 *
 * Every part is compared from the title's own top-left corner (`origin`), so the head's height (below) is never compared; what stands under it
 * is held at the shift the first run measured (`UNDER`).
 *
 * Departures by decision:
 *  - The page head is the roster pages' 96px title where the board draws 112px, with the lead under it and the glass's 36px under the head, so what is
 *    under it stands lower by `UNDER`. The lead's color is the page head's, the quieter text (`type: false`).
 *  - A field's label is the lead's 24px at 1.5px (characters.css, the same on boards 23 to 26); the glass's body-size section label is the quieter text where the board
 *    draws 22px in the full text. Both are compared by their words and place.
 *  - The board's field labels are not tied to their fields, so no name finds them there (the build's are named Character, Title, Signature and Pip style): each is
 *    found as the board's nth select or textbox. A button's measure is the glass's own (48px where the board's `.btn` is 52px).
 *  - The postbit is the thread's own (engine/ui/postbit/Postbit.tsx): its avatar slot, rank and pips are the instance's, and it counts the character's own
 *    posts, so only its box and its name are compared, and the made-up post beside it holds the board's own sample line's place and not its words.
 *  - "Choose a picture" is a GlassButton whose label the board draws as a `<label>`; the two frames are drawn at the board's 120 by 160 and 72 by 72.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** How much lower the build stands what is under the page head than the board draws it: the lead under the title and the glass's 36px under the head. */
const UNDER = { y: -16.5 } as const;

/** A part held by its place from the title's corner. */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'title', box: 'position', buildShift: UNDER, ...more });

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/26-edit-profile',
  size: { width: 1440, height: 1420 },
  build: { story: 'boards-00-edit-profile--edit-profile' },
  press: [
    { role: 'textbox', name: 'Title', fill: 'Magenta enthusiast (classier)' },
    { role: 'textbox', name: 'Signature', fill: '[i]not the ink. never the ink.[/i]' },
  ],
  landmarks: [
    { id: 'title', role: 'heading', name: 'Edit Mrs. Hooligan', box: 'position', buildSize: 96 },
    at('lead', 'text', "What you set here is public: it shows beside Mrs. Hooligan's posts.", { type: false, box: 'none' }),
    { id: 'form', role: 'form', name: 'Profile', type: false, box: 'across' },
    at('character-label', 'text', 'CHARACTER'),
    at('title-label', 'text', 'TITLE'),
    at('title-hint', 'text', 'Under the name on every post.', { type: false }),
    at('title-count', 'text', '29 of 40', { type: false }),
    at('signature-label', 'text', 'SIGNATURE', { buildShift: { y: -8 } }),
    at('signature-hint', 'text', 'BBCode, as in a post.', { type: false }),
    at('signature-count', 'text', '34 of 500', { type: false }),
    at('pip-label', 'text', 'PIP STYLE', { buildShift: { y: -3 } }),
    at('save', 'button', 'SAVE THE PROFILE', { buildName: 'Save the profile', type: false, box: 'none' }),
    at('avatar', 'heading', 'AVATAR', { type: false, box: 'none' }),
    at('avatar-none', 'text', 'No picture yet.', { type: false, box: 'none' }),
    at('choose', 'text', 'CHOOSE A PICTURE', { type: false, box: 'none' }),
    { id: 'aside', role: 'complementary', name: 'WHAT EVERYONE WILL SEE', type: false, box: 'across' },
    at('preview-head', 'text', 'WHAT EVERYONE WILL SEE', { within: 'aside', type: false, box: 'none' }),
    at('preview-name', 'text', 'Mrs. Hooligan', { within: 'aside', type: false, box: 'none' }),
    at('preview-note', 'text', 'The preview follows what you type. Nothing changes on the board until you save.', { within: 'aside', type: false, box: 'none' }),
  ],
};

export default manifest;
