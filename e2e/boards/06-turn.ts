/**
 * Board 06, the Turn board (docs/research/2026-10-29-two-worlds/06-turn.html): My characters at
 * 00:34 on Oct 30, a minute before the Turn is made, with the Turn modal open on Pipewrench and Face
 * chosen, the menu bar in view behind it, dimmed and inert. The glass plan's section 7 lists what
 * is compared. The build is reached as the player reaches it: Turn Pipewrench, then Face, then the
 * old class named.
 *
 * Departures, by decision:
 *  - How loud: the board draws three radios, the last "Announced with old class". The build keeps
 *    web Task 9's two (Silent, Announced) and the class reveal design's two names (the old class,
 *    the new class), which the owner chose over the board's radios (issue #51). The names stand in
 *    the board's third tile, lit as the board's chosen tile is, so the build names the old class by
 *    its toggle and that toggle's word is placed where the board's third radio's is.
 *  - The class cards' words are the instance's descriptions, longer than the board's, so the cards
 *    are taller and everything under them stands lower: from the map down, a landmark whose words are
 *    the board's is compared by its size, and the foot, held to the dialog's own foot, by its place
 *    from the dialog's corner.
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
  press: [
    { role: 'button', name: 'Turn Pipewrench' },
    { role: 'radio', name: 'Face' },
    { role: 'checkbox', name: 'Name the old class. “Was a Heel” becomes public.' },
  ],
  landmarks: [
    /*
     * The menu bar behind the modal is inert on both sides, so no role finds it: that it stays in
     * view and dimmed is held by e2e/characters.spec.ts.
     */

    /* The modal, chamfer step 5. */
    { id: 'dialog', role: 'dialog', name: 'Turn Pipewrench', type: false },
    { id: 'kicker', role: 'text', name: 'MY CHARACTERS › TURN', buildName: 'My characters › Turn', within: 'dialog' },
    { id: 'title', role: 'heading', name: 'Turn Pipewrench', within: 'dialog' },
    /* The board's Close is an icon; the build's word is drawn off its square, so its box only. */
    { id: 'close', role: 'button', name: 'Close', within: 'dialog', type: false },

    /* The character. */
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
    /* Drawn in Heel's large color, the owner's lifted one (above), so by its box. */
    { id: 'heel-now', role: 'text', name: 'Now', within: 'classes', type: false, box: 'position' },
    { id: 'lurker', role: 'text', name: 'Lurker', within: 'classes', type: false },
    { id: 'jabroni', role: 'text', name: 'Jabroni', within: 'classes' },
    { id: 'face-marks', role: 'img', name: 'Earns from hype, hurt by the groan', within: 'classes', type: false },
    { id: 'heel-marks', role: 'img', name: 'Earns from heat, hurt by the calm', within: 'classes', type: false },
    /* The instance's words, not the board's: their type only. */
    {
      id: 'face-words', role: 'text',
      name: 'Earns from hype on its posts and cards, and from Sweet cards it plays on others\' posts that then draw hype.',
      buildName: 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there. Hurt by bored reactions, and by a card that outdraws the post it was played on.',
      within: 'classes', box: 'none',
    },

    /* Below the cards: by size where the words are the board's (the module comment says why). */
    { id: 'map', role: 'text', name: 'THE MAP: HEAT · HYPE on top, GROAN · CALM below, the same grid as the React picker.', within: 'dialog', box: 'size' },
    /*
     * How loud's two radios and the third tile's first name, placed from the group's corner. A bold
     * word is as wide as the line under it, which is the screen's words, so its size is not compared.
     */
    /* The third tile holds two names where the board's holds one line, so the group is taller and its own box is not compared. */
    { id: 'loud', role: 'group', name: 'How loud', within: 'dialog', type: false, box: 'none' },
    { id: 'silent', role: 'text', name: 'SILENT', buildName: 'Silent.', within: 'loud', box: 'position', origin: 'loud' },
    { id: 'announced', role: 'text', name: 'ANNOUNCED', buildName: 'Announced.', within: 'loud', box: 'position', origin: 'loud' },
    { id: 'name-old', role: 'text', name: 'ANNOUNCED WITH OLD CLASS', buildName: 'Name the old class.', within: 'loud', box: 'position', origin: 'loud' },
    { id: 'preview-head', role: 'text', name: 'What everyone will see', within: 'dialog', box: 'size' },
    { id: 'preview-by', role: 'text', name: 'The System', within: 'dialog', box: 'size' },
    { id: 'preview-line', role: 'text', name: 'Pipewrench has Turned. Now a Face. Before this, Pipewrench was a Heel.', buildName: 'Pipewrench has Turned from Heel', within: 'dialog', box: 'none' },

    /*
     * The foot: Cancel by its size, and Confirm Turn in full from Cancel's corner. Where the foot
     * stands follows the footer's sentence, which is left out (above).
     */
    { id: 'cancel', role: 'button', name: 'Cancel', within: 'dialog', box: 'size' },
    { id: 'confirm', role: 'button', name: 'Confirm Turn', within: 'dialog', origin: 'cancel' },
  ],
};

export default manifest;
