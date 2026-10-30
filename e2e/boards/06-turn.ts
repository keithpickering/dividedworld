/**
 * Board 06, the Turn board (docs/research/2026-10-29-two-worlds/06-turn.html): My characters at
 * 00:35 on Oct 30 with the Turn modal open on Pipewrench, Face and "announced with its old class"
 * chosen, the menu bar in view behind it, dimmed and inert. The glass plan's section 7 lists what is
 * compared.
 *
 * At the moment the fixture has made that Turn (it is what the moment is), so the build reaches the
 * board's modal as the player would, by the panel's Change, which opens the Turn with its choices
 * filled in; its heading and its confirm are then the screen's "Change Pipewrench's Turn" and
 * "Change the Turn" (web Task 9's words) for the board's TURN PIPEWRENCH and CONFIRM TURN.
 *
 * Departures, by decision:
 *  - How loud: the board draws three radios; the build keeps web Task 9's two (Silent, Announced)
 *    and the class reveal design's two checkboxes (name the old class, name the new class), so
 *    "Announced with old class" has no landmark.
 *  - The class cards' words are the instance's descriptions, so only Face's is compared, by type.
 *  - The classes' large colors are the instance's (glass.json): Heel's is the owner's lifted
 *    `#ff959f` where the board draws `#ff8a96` (the glass plan, section 6, amended 2026-10-30), and
 *    Face's and Lurker's differ from the board's too, so their names are compared by box only;
 *    Jabroni's matches and is compared in full.
 *  - The preview's words are previews.ts's, held equal to the thread's (no board crumb line), so
 *    only The System's name is compared.
 *  - The footer's sentence says the settlement's time in the reader's zone where the board counts
 *    down ("in 7 h 42 min"), so it is left out.
 *  - The board's portrait is a placeholder; the build's is the character's, so it is not compared.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '06-turn',
  size: { width: 1440, height: 1420 },
  build: { moment: '06-turn' },
  press: [{ role: 'button', name: 'Change Pipewrench\'s Turn' }],
  landmarks: [
    /*
     * The menu bar behind the modal is inert on both sides, so no role finds it: that it stays in
     * view and dimmed is held by e2e/characters.spec.ts.
     */
    /* The modal, chamfer step 5. */
    { id: 'dialog', role: 'dialog', name: 'Turn Pipewrench', buildName: 'Change Pipewrench\'s Turn', type: false },
    { id: 'kicker', role: 'text', name: 'MY CHARACTERS › TURN', buildName: 'My characters › Turn', within: 'dialog', box: 'position' },
    { id: 'title', role: 'heading', name: 'Turn Pipewrench', buildName: 'Change Pipewrench\'s Turn', within: 'dialog', box: 'position' },
    /* The board's Close is an icon; the build's says its word, so its box only. */
    { id: 'close', role: 'button', name: 'Close', within: 'dialog', type: false, box: 'position' },

    /* The character. */
    /* The column runs the height of the choice beside it, which the instance's descriptions make taller (below). */
    { id: 'who', role: 'complementary', name: '', within: 'dialog', type: false, box: 'position' },
    { id: 'who-name', role: 'text', name: 'Pipewrench', within: 'who' },
    { id: 'who-rank', role: 'text', name: 'Enhancement Talent', within: 'who' },
    /* The pips are the postbit's own images (web Task 5), wider than the board's diamonds, so where they are is not compared. */
    { id: 'who-pips', role: 'img', name: 'Rank: 2 of 6 pips', buildName: 'Rank 2 of 6: Enhancement Talent', within: 'who', type: false, box: 'none' },
    { id: 'who-standing', role: 'text', name: 'Season standing', within: 'who' },
    { id: 'who-class-label', role: 'text', name: 'Class now', within: 'who' },
    { id: 'who-class', role: 'text', name: 'Heel', within: 'who' },
    { id: 'who-sees', role: 'text', name: 'Who can see it', within: 'who' },
    { id: 'who-only', role: 'text', name: 'Only you', within: 'who' },

    /* The class cards. */
    { id: 'classes', role: 'group', name: 'Choose a class', buildName: 'Turn to', within: 'dialog', type: false, box: 'position' },
    { id: 'face', role: 'text', name: 'Face', within: 'classes', type: false },
    { id: 'heel', role: 'text', name: 'Heel', within: 'classes', type: false },
    /* Drawn in Heel's large color, which is the owner's lifted one (above), so by its box. */
    { id: 'heel-now', role: 'text', name: 'Now', within: 'classes', type: false, box: 'position' },
    { id: 'lurker', role: 'text', name: 'Lurker', within: 'classes', type: false },
    { id: 'jabroni', role: 'text', name: 'Jabroni', within: 'classes' },
    { id: 'face-marks', role: 'img', name: 'Earns from hype, hurt by the groan', within: 'classes', type: false },
    { id: 'heel-marks', role: 'img', name: 'Earns from heat, hurt by the calm', within: 'classes', type: false },
    {
      id: 'face-words', role: 'text',
      name: 'Earns from hype on its posts and cards, and from Sweet cards it plays on others\' posts that then draw hype.',
      buildName: 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there. Hurt by bored reactions, and by a card that outdraws the post it was played on.',
      within: 'classes', box: 'none',
    },
    /*
     * Below the class cards, where a thing stands follows the cards' height, which is the instance's
     * descriptions' (longer than the board's), so from here down the type is compared and the boxes are not.
     */
    { id: 'map', role: 'text', name: 'THE MAP: HEAT · HYPE on top, GROAN · CALM below, the same grid as the React picker.', within: 'dialog', box: 'none' },

    /* How loud. */
    { id: 'loud', role: 'group', name: 'How loud', within: 'dialog', type: false, box: 'none' },
    { id: 'silent', role: 'text', name: 'SILENT', buildName: 'Silent.', within: 'loud', box: 'none' },
    { id: 'announced', role: 'text', name: 'ANNOUNCED', buildName: 'Announced.', within: 'loud', box: 'none' },

    /* What everyone will see. */
    { id: 'preview-head', role: 'text', name: 'What everyone will see', within: 'dialog', box: 'none' },
    { id: 'preview-by', role: 'text', name: 'The System', within: 'dialog', box: 'none' },

    /* The foot: the confirm's words are the screen's and wider than the board's, which moves both buttons. */
    { id: 'cancel', role: 'button', name: 'Cancel', within: 'dialog', box: 'none' },
    { id: 'confirm', role: 'button', name: 'Confirm Turn', buildName: 'Change the Turn', within: 'dialog', box: 'none' },
  ],
};

export default manifest;
