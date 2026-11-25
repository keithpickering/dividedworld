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
 *    Face's differs from the board's too, so their names are compared by box only; Jabroni's and the
 *    Technician's match and are compared in full. The board's peeking card is the Lurker and the
 *    build's the Tweener (below), so that name is compared by its place only.
 *  - Choose a class is the carousel the Technician design redrew this board with (its section 3):
 *    four cards in view, a fifth peeking (the board's Lurker; the build's Tweener, the Lurker being
 *    the sixth and out of view), the count and the two arrows on the legend's line. The
 *    arrows' glyphs are drawn in the glass's own text tokens on its ground, not the board's
 *    translucent ones, so they are compared by where they stand.
 *  - A name quotes the whole line the post carries (from previews.ts, one source), so the tile wraps and the dialog is taller than the board's; its place is compared, not its height.
 *  - The preview's words are previews.ts's, held equal to the thread's (no board crumb line), so
 *    only The System's name is compared.
 *  - The footer's sentence says the settlement's time in the reader's zone where the board counts
 *    down ("in 7 h 42 min"), so it is left out. An announced Turn is also written at once and stands (the staff board threads design,
 *    0427): the build's footer says it can't be changed or withdrawn, and a thread picker (Board, Thread, shared with Reveal) stands between
 *    the two names and the preview, which the board does not draw, so everything under the names stands lower and is compared by size only.
 *  - The post's line ends "It takes effect at the next settlement.", which the name tiles and the preview quote.
 *  - The board's portrait is a placeholder; the build's is the character's, so it is not compared.
 */
import type { BoardManifest } from '../board-match.ts';

/**
 * An announced Turn is always written ahead of its settlement (0427), so the line the post carries ends with the sentence that says when it takes
 * effect (announceWords, engine/ui/thread/lines.tsx), and the dialog's checkbox quotes it whole.
 */
const OLD_NAMED = 'Name the old class. Adds “Pipewrench has Turned, leaving Heel. It takes effect at the next settlement.” to the post.';

const manifest: BoardManifest = {
  board: '06-turn',
  size: { width: 1440, height: 1420 },
  build: { moment: '06-turn' },
  press: [
    { role: 'button', name: 'Turn Pipewrench' },
    { role: 'radio', name: 'Face' },
    { role: 'checkbox', name: OLD_NAMED },
    /* The board draws no thread picker; the build's (shared with Reveal) must be there for an announced Turn, which is posted at once in a thread named. Pressing its Board select shows it is. */
    { role: 'combobox', name: 'Board (optional)' },
  ],
  landmarks: [
    /*
     * The menu bar behind the modal is inert on both sides, so no role finds it: that it stays in
     * view and dimmed is held by e2e/characters.spec.ts.
     */

    /*
     * The modal, chamfer step 5. Its height is not compared: each name quotes the whole line the post will carry ("Pipewrench has Turned,
     * leaving Heel.", the quality review of Task 11), which wraps in the tile where the board's third radio is one short line.
     */
    { id: 'dialog', role: 'dialog', name: 'Turn Pipewrench', type: false, box: 'position' },
    { id: 'kicker', role: 'text', name: 'MY CHARACTERS › TURN', buildName: 'My characters › Turn', within: 'dialog' },
    { id: 'title', role: 'heading', name: 'Turn Pipewrench', within: 'dialog' },
    /* The board's Close is an icon; the build's word is drawn off its square, so its box only. */
    /* Close stands on the middle line of the kicker and the title (the owner, 2026-11-17: the bar's parts share one middle line, glass/shell.css), where the board tops it with the kicker. */
    { id: 'close', role: 'button', name: 'Close', within: 'dialog', type: false, buildShift: { y: 20.5 } },

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
    { id: 'jabroni', role: 'text', name: 'Jabroni', within: 'classes' },
    /* "TECHNICIAN", the longest name, set smaller to clear its radio, as the board sets it at 34px. */
    { id: 'technician', role: 'text', name: 'Technician', within: 'classes' },
    /*
     * The board's peeking card is the Lurker; the build's, with the Tweener before the Lurker (the Tweener plan's Task 6), is the Tweener, in its
     * own color and a wider name, so it stands in the board's Lurker by its place. The Lurker is now the sixth card, out of view, and so is not drawn.
     */
    { id: 'peeking-card', role: 'text', name: 'Lurker', buildName: 'Tweener', within: 'classes', type: false, box: 'position' },
    { id: 'count', role: 'text', name: '1–4 OF 5', buildName: '1–4 of 6', within: 'classes' },
    { id: 'earlier', role: 'button', name: 'Earlier classes', within: 'classes', type: false, box: 'position' },
    { id: 'more', role: 'button', name: 'More classes', within: 'classes', type: false, box: 'position' },
    { id: 'face-marks', role: 'img', name: 'Earns from hype, hurt by the groan', within: 'classes', type: false },
    { id: 'heel-marks', role: 'img', name: 'Earns from heat, hurt by the calm', within: 'classes', type: false },
    /* The instance's words, not the board's: their type only. */
    {
      id: 'face-words', role: 'text',
      name: 'Earns from hype on its posts and cards, and from Sweet cards it plays on others\' posts that then draw hype.',
      buildName: 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there.',
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
    /*
     * The two names stand 66.2px lower than the board's: the third tile's sentence now ends with "It takes effect at the next settlement." (above), which wraps
     * it to a line more, and the tiles are one row, so the other two stretch to it and center their words.
     */
    { id: 'silent', role: 'text', name: 'SILENT', buildName: 'Silent.', within: 'loud', box: 'position', origin: 'loud', buildShift: { y: 66.2 } },
    { id: 'announced', role: 'text', name: 'ANNOUNCED', buildName: 'Announced.', within: 'loud', box: 'position', origin: 'loud', buildShift: { y: 66.2 } },
    { id: 'name-old', role: 'text', name: 'ANNOUNCED WITH OLD CLASS', buildName: 'Name the old class.', within: 'loud', box: 'position', origin: 'loud' },
    { id: 'preview-head', role: 'text', name: 'What everyone will see', within: 'dialog', box: 'size' },
    /* The preview's words are the type scale's (the glass polish, design section 7): 15px where the board draws 12px, so "The System" is 1.25 times as wide. */
    { id: 'preview-by', role: 'text', name: 'The System', buildName: 'Pipewrench', buildNth: -1, within: 'dialog', box: 'size', buildSize: 15, buildShift: { width: 19.8 } },
    { id: 'preview-line', role: 'text', name: 'Pipewrench has Turned. Now a Face. Before this, Pipewrench was a Heel.', buildName: 'Pipewrench has Turned, leaving Heel. It takes effect at the next settlement.', within: 'dialog', box: 'none', buildSize: 15 },

    /*
     * The foot: Cancel and Confirm Turn are GlassButtons in one ButtonRow (the glass polish, design section 2, and the owner's correction that Reveal's
     * Cancel and Reveal are one row at one size; the Turn is the same), 48px of Barlow Condensed at the body's 21px where the board draws 60px of Anton
     * at 26px. The parts' measure is held by parts.test.tsx and the layout check, so neither is compared here. Where the foot stands follows the
     * footer's sentence, which is left out (above).
     */
    /*
     * The board's footer says when the Turn takes effect and that it can be canceled from My characters. An announced Turn is posted at once and
     * cannot be changed or withdrawn, so the build's says that instead (COMMITS, engine/ui/characters/TurnDialog.tsx), before the settlement's time. Its place is the
     * foot's, which follows the thread picker the board does not draw, so it is found by its words and not compared.
     */
    {
      id: 'foot-words', role: 'text', within: 'dialog', box: 'none', type: false,
      name: 'Takes effect at the next settlement, in 7 h 42 min; today is still scored as a Heel. You can cancel it from My characters until then. Pipewrench\'s next Turn opens 30 days after this one.',
      buildName: 'Once announced, this Turn can\'t be changed or withdrawn. It takes effect at the next settlement. Next settlement: Oct 30, 8:17 AM.',
    },
    { id: 'cancel', role: 'button', name: 'Cancel', within: 'dialog', box: 'none', type: false },
    { id: 'confirm', role: 'button', name: 'Confirm Turn', within: 'dialog', box: 'none', type: false },
  ],
};

export default manifest;
