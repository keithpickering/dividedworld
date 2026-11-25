/**
 * Board 23, New character (docs/research/2026-11-05-backfill/23-new-character.html, 1440 by 1720): a name typed, Face chosen, as the story
 * `Boards/00 New character` (engine/ui/characters/NewCharacter.board.stories.tsx) draws it and the manifest presses it. The backfill design's
 * section 5 and the plan's Task 8 list what is compared: the lead under the title, the name's count on its field's own line, the classes with
 * each card's hurt set apart, the three sections 44px from the next (the glass's `--kb-glass-section-gap`), and the footer's one line beside Cancel
 * and Make the character.
 *
 * Departures by decision:
 *  - The board draws a "When it debuts" choice, "How loud" with Silent, Announced and Announced, with its class, and a "What everyone will see" preview; the build has
 *    none of them (a new character is on the board at once and nobody is told, 0428), so they are not compared, and the footer's one line is the build's words.
 *  - The page head (engine/ui/glass/PageHead.tsx) is the roster pages' 96px title where the board draws 112px, and it leaves 36px under the lead
 *    (the glass polish, design section 2), so the title is compared by its type at 96 and everything under it by its place from the form's own
 *    corner (`origin`), which the head's height does not move.
 *  - The class cards are the carousel's, 216px wide at the board's 14px gap (the Technician design, section 3), where the board draws them 236px
 *    wide and 33px apart so that all five fill the row, with the count and the arrows drawn. The build has a sixth, the Tweener (the Tweener
 *    plan's Task 6), which the board does not draw; six cards of 216px do not fit 1312px, so the build's row overflows and draws its count and
 *    arrows, which the board does not (the arrows are held on the Turn board, and by the layout check's cut-control refusal). The cards are
 *    therefore compared by their names' words and not by place, and the marks and the words by their type alone.
 *  - New character's surface draws no class's large text (engine/ui/glass/apply.ts `classLargeText`), so a class's name stands in the glass's text with
 *    the class's color on its card's edge and marks, where the board draws the name in the class's color; and the card's words are the body's 21px
 *    (600) where the board draws 20px (500). So the cards' names and hurts are compared by their words and not by their type.
 *  - Field labels are the lead's 24px at 1.5px (the character forms' boards, 23 to 26, all set them so), and section labels (the legends, "What
 *    everyone will see") the glass's body-size label in its quieter text where the board draws 22px in the full text, so those are compared by
 *    their words and place.
 *  - A button's measure is the glass's own (48px of the body's size, parts.test.tsx), where the board's `.btn` is 52px, so Cancel and Make the
 *    character are compared by their words' type and place, and their size not at all.
 *  - The glass sets its labels, hints and counts at the type scale (the glass polish, design section 7), so the board's 19px count and hint are
 *    the build's label size, and the lines under a section's label stand a few px apart from the board's: `buildShift`, from what the first run measured.
 *  - The Face's hurt says when stolen thunder is not charged (docs/plans/2026-11-18-face-thunder-design.md, section 3), which the board,
 *    drawn before that rule, does not: `buildName` holds the build's sentence.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part held by its place from the form's top-left corner and its type. */
const at = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, within: 'form', origin: 'form', box: 'position', ...more });

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/23-new-character',
  size: { width: 1440, height: 1720 },
  build: { story: 'boards-00-new-character--new-character-form' },
  press: [
    { role: 'textbox', name: 'Name', fill: 'Waiting Wanda' },
    { role: 'radio', name: 'Face' },
  ],
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
    { id: 'title', role: 'heading', name: 'New character', box: 'position', buildSize: 96 },
    { id: 'lead', role: 'text', name: 'This page is out of character and only you can see it. Nobody else can tell who plays a character.', box: 'none', type: false },
    { id: 'form', role: 'form', name: 'New character', type: false, box: 'across' },

    at('name-label', 'text', 'NAME'),
    at('name-hint', 'text', 'Letters, marks, digits and single spaces. Names are unique, look-alikes included.', { type: false }),
    at('name-count', 'text', '13 of 40', { type: false }),

    at('classes', 'radiogroup', 'Class', { buildRole: 'group', type: false, box: 'none' }),
    at('face', 'text', 'Face', { within: 'classes', box: 'none', type: false }),
    at('heel', 'text', 'Heel', { within: 'classes', box: 'none', type: false }),
    at('jabroni', 'text', 'Jabroni', { within: 'classes', box: 'none', type: false }),
    at('technician', 'text', 'Technician', { within: 'classes', box: 'none', type: false }),
    at('lurker', 'text', 'Lurker', { within: 'classes', box: 'none', type: false }),
    at('face-hurt', 'text', 'Hurt by bored reactions, and by a card that outdraws the post it was played on.', { buildName: 'Hurt by bored reactions, and by stealing a non-Salty post\'s thunder.', within: 'classes', box: 'none', type: false }),
    at('note', 'text', 'Only you will know its class, unless you choose to reveal it.', { type: false, origin: 'classes', originEdge: 'bottom', buildShift: { y: 0 } }),

    at('foot-line', 'text', 'Waiting Wanda is on the board as soon as you make it, and The System announces it. Its class stays yours alone.', { buildName: 'Waiting Wanda is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays yours alone.', box: 'none' }),
    at('cancel', 'button', 'CANCEL', { buildName: 'Cancel', buildRole: 'link', type: false, box: 'none' }),
    at('make', 'button', 'MAKE THE CHARACTER', { buildName: 'Make the character', type: false, box: 'none' }),
  ],
};

export default manifest;

/*
 * Board 27, the characters on a phone (docs/research/2026-11-05-backfill/27-characters-phone.html): four phone screens at 390 by 844 side by side on one
 * page, New character's class carousel, the Debut dialog as a sheet (gone: a character is on the board when it is made), Edit profile, and My characters' title with its count on its own line. A phone
 * board has one parent and is compared at 390 by 844 (e2e/boards.spec.ts), so this export is the whole board: New character is its own side, and the
 * other three are further sides (the Debut sheet, the second, is gone, so the build compares two of them) (`also`), each its own story against the same page. The board page is opened at 390 wide with its four screens at
 * x = 20, 430, 840 and 1250; each landmark of a screen is found as that screen's nth (`nth`, where the build has one of each) and measured from a
 * landmark of that screen (`origin`), so a screen's place on the page is never compared. This is the manner of board 18's, as Task 6 held it.
 *
 * What the phone board draws that the build does not follow, by decision:
 *  - The board is drawn in the desktop's sizes; the build sets a phone in the glass's phone tokens (engine/ui/glass/tokens.css), so no type on this board is
 *    compared (`type: false`), and a part is compared by its place, x and y, at the shift the first run measured (`buildShift`).
 *  - The first screen is the page scrolled to its classes, with no head and no name field above them; the build's page starts at the top, so its parts are
 *    held from the CLASS label (`origin`), not from the menu. The board draws the class row as one card of 300px with the next peeking under the
 *    fade and "1 OF 5"; the build's carousel says "1–1 of 6" or "1–2 of 6" for the cards it shows whole, so the count is held by its place.
 *  - Edit profile on the board is the head, the lead, Title, Signature and the save button; the build adds the character's select above Title, and the pip style,
 *    the avatar and the preview under the save, so Title and what follows stand lower by the select's height.
 *  - The build's New character and Edit profile each carry the pronoun picker (the pronouns plan, docs/plans/2026-11-07-pronouns-plan.md), which the board
 *    predates: on New character it stands under the class note, where the board's When it debuts and Drop now stood (gone: a character is on the board when it is made);
 *    on Edit profile it stands above the save, which stands 472.5px lower.
 *  - The Face's hurt says when stolen thunder is not charged (docs/plans/2026-11-18-face-thunder-design.md, section 3), a longer sentence than the board's, which wraps
 *    onto more lines in the phone's narrow card, and a line count that also moves with how a browser breaks it. The class note and what is held from it stand lower
 *    by those lines, so the note is held from the bottom of the Face's hurt (`origin`, `originEdge: 'bottom'`) and not from the CLASS label, and `face-hurt` holds the
 *    build's sentence in `buildName`.
 *  - The class carousel's row is as tall as its tallest card, and the cards' words differ in length: the Tweener's description (the Tweener plan, and longer again
 *    with the debate rule) makes its card the tallest, 382.5px where the Face's is 359px, so the Face's hurt does not move while the note under the row stands
 *    23.5px lower, and a longer line in any class's words would move it again. So the note is held from the bottom of the row, which the tallest class card sets,
 *    and not from the bottom of the Face's hurt. The board draws one card with no landmark of its own, whose bottom is its hurt's bottom and the card's
 *    padding; the build's row is the Class group (the carousel's fieldset). `row` is therefore found by the board's hurt and the build's Class group, and the
 *    note's `buildShift` (20px across, -20px down) is the card's padding and gap that the board's hurt does not include, measured from the first run.
 *  - My characters' count stands on its own line under the title: the board's "3 OF 6" is the build's "(3 of 6)", its box a line of its own that is not broken.
 */
const PHONE = '2026-11-05-backfill/27-characters-phone';

/** The menu bar of the screen that is the board page's `nth` (the sheet has none), and Back in it, as the phone's bar draws them. */
const bar = (nth: number): Landmark[] => [
  { id: 'menu', role: 'navigation', name: 'Menu', nth, buildNth: 0, type: false, box: 'none' },
  { id: 'menu-back', role: 'link', name: '‹ BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', origin: 'menu', box: 'height', type: false },
];

/** A part held by its place from its screen's origin landmark, by the shift the phone's type and the build's fuller screen make. */
const held = (origin: string, id: string, role: string, name: string, shift: { x?: number; y?: number } = {}, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin, box: 'position', type: false, buildShift: shift, ...more,
});

export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-00-new-character--new-character-phone' },
  press: [{ role: 'radio', name: 'Face' }],
  landmarks: [
    { id: 'class-label', role: 'text', name: 'CLASS', type: false, box: 'none' },
    held('class-label', 'count', 'text', '1 OF 5', { x: -20 }, { buildName: '1–1 of 6' }),
    { id: 'face-hurt', role: 'text', name: 'Hurt by bored reactions, and by a card that outdraws the post it was played on.', buildName: 'Hurt by bored reactions, and by stealing a non-Salty post\'s thunder.', type: false, box: 'none' },
    { id: 'row', role: 'text', name: 'Hurt by bored reactions, and by a card that outdraws the post it was played on.', buildRole: 'group', buildName: 'Class', type: false, box: 'none' },
    held('class-label', 'note', 'text', 'Only you will know its class, unless you choose to reveal it.', { x: 20, y: -20 }, { origin: 'row', originEdge: 'bottom' }),
  ],
  also: [
    {
      name: 'Edit profile',
      build: { story: 'boards-00-edit-profile--edit-profile-phone' },
      press: [
        { role: 'textbox', name: 'Title', fill: 'Magenta enthusiast (classier)' },
        { role: 'textbox', name: 'Signature', fill: '[i]not the ink. never the ink.[/i]' },
      ],
      landmarks: [
        ...bar(1),
        held('menu', 'title', 'heading', 'EDIT MRS. HOOLIGAN', { y: 51 }, { buildName: 'Edit Mrs. Hooligan' }),
        held('menu', 'lead', 'text', "What you set here is public: it shows beside Mrs. Hooligan's posts.", { y: -45 }),
        held('menu', 'title-label', 'text', 'TITLE', { y: 80 }),
        held('menu', 'title-count', 'text', '29 of 40', { y: 75.6 }),
        held('menu', 'signature-label', 'text', 'SIGNATURE', { y: 90.1 }),
        held('menu', 'signature-count', 'text', '34 of 500', { y: 106.7 }),
        held('menu', 'save', 'button', 'SAVE THE PROFILE', { y: 698 }, { buildName: 'Save the profile' }),
      ],
    },
    {
      name: 'My characters',
      build: { story: 'boards-00-characters--characters-phone' },
      landmarks: [
        ...bar(2),
        held('menu', 'title', 'heading', 'YOUR CHARACTERS', { y: 51 }, { buildName: 'Your characters (3 of 6)' }),
        held('menu', 'count', 'text', '3 OF 6', { y: -39 }, { buildName: '(3 of 6)' }),
        held('menu', 'lead', 'text', 'This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them.', { y: -55 }),
      ],
    },
  ],
};
