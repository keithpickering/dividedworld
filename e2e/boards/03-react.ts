/**
 * Board 03, the React board (docs/research/2026-10-29-two-worlds/03-react.html, 900 by 700): the
 * rival's view of Mrs. Hooligan's #42 with the picker open. The build side is its story,
 * engine/ui/reactions/Picker.board.stories.tsx, on the boards fixture's `03-react` moment, opened
 * through the end-to-end build's story route and pressed open as the player opens it. The glass
 * plan's section 7 lists what is compared, all in full: the dialog by its name, its heading and its
 * count, the four quadrants' groups, each emoji's button by its name, and the hint; the two axes'
 * words and Groan's label are compared too.
 *
 * The picker opens by its post's reactions row (Overlay.tsx's anchor), and the post under it is the
 * board's drawing on one side and the thread's own article on the other (the app's postbit column,
 * the fixture's two paragraphs of #42 where the board drew one), so the row, and with it the picker,
 * stands elsewhere on the page: about 100px left and 36px up. The picker is compared by its size
 * (`size`), and every part of it by its place measured from the picker's own corner (`origin`), in
 * full; where the picker stands by its post is held by e2e/reactions.spec.ts ("a wide window") and
 * engine/ui/glass/Overlay.test.tsx.
 *
 * Where the build differs by a decision:
 *  - each button is named by its emoji's name and its quadrant (web Task 6, "each button named by its
 *    emoji's name and quadrant"), so "Tomato" is "Tomato, Heat", and the rival's own Tea is "Tea,
 *    Calm, your reaction"; a name is its key made readable, so "Star-struck" is "Star struck";
 *  - the buttons' type is not compared: their only text is the emoji, which the board leaves bare
 *    and the build hides from a screen reader behind the button's name, and an emoji's face is the
 *    system's, not the glass's;
 *  - the groups' type is not compared: a group's first text is its label in the top quadrants and an
 *    emoji in the bottom ones on the board, which draws the bottom labels after the kinds, where the
 *    build keeps the label first (it names the group) and sets it below by style; and the labels of
 *    Heat, Hype and Calm are in the large text of the class the instance gives each quadrant
 *    (InstanceUi.quadrantClasses, glass.json's classes), which the board drew a shade apart (Heat
 *    #ff8a96, where the owner lifted Heel's large text to #ff959f; Hype #9fdcff and Calm #8af7c9,
 *    where Face's and the Technician's are #8fd6ff and #7dffc8). Groan's is the same on both, so its label's
 *    type is compared, and every group's box is.
 *
 * Not compared: the post under the picker, which is the 2003 board's (its chips and its React are
 * the thread's own, and the build's #42 carries a fourth chip the board left out, the fixture's
 * handshake), the smoke, and the cross through the quadrants.
 */
import type { BoardManifest, Landmark } from '../board-match.ts';

/** Each quadrant's emoji, as the board names its buttons, with the build's quadrant label. */
const KINDS: readonly (readonly [string, string])[] = [
  ['Tomato', 'Heat'], ['Angry', 'Heat'], ['Cursing', 'Heat'], ['Thumbs down', 'Heat'],
  ['Fire', 'Hype'], ['Heart', 'Hype'], ['Raised hands', 'Hype'], ['Star-struck', 'Hype'],
  ['Zzz', 'Groan'], ['Eye roll', 'Groan'], ['Trash', 'Groan'], ['Yawn', 'Groan'],
  ['Relieved', 'Calm'], ['Handshake', 'Calm'], ['Meditating', 'Calm'],
];

const buttons: Landmark[] = KINDS.map(([name, quadrant]) => ({
  id: `kind-${name.toLowerCase().replace(/\W+/g, '-')}`, role: 'button', name, buildName: `${name.replace('-', ' ')}, ${quadrant}`, within: 'picker', origin: 'picker', type: false,
}));

const manifest: BoardManifest = {
  board: '03-react',
  size: { width: 900, height: 700 },
  build: { story: 'boards-03-react--board' },
  press: [{ role: 'button', name: 'React' }],
  landmarks: [
    { id: 'picker', role: 'dialog', name: 'React to Mrs. Hooligan\'s post', box: 'size' },
    { id: 'heading', role: 'heading', name: 'React', within: 'picker', origin: 'picker' },
    { id: 'left', role: 'text', name: '2 of 3 left', within: 'picker', origin: 'picker' },
    { id: 'excited', role: 'text', name: 'Excited', within: 'picker', origin: 'picker' },
    { id: 'low-key', role: 'text', name: 'Low-key', within: 'picker', origin: 'picker' },
    { id: 'heat', role: 'group', name: 'Heat', within: 'picker', origin: 'picker', type: false },
    { id: 'hype', role: 'group', name: 'Hype', within: 'picker', origin: 'picker', type: false },
    { id: 'groan', role: 'group', name: 'Groan', within: 'picker', origin: 'picker', type: false },
    /* 24px where the board draws 22px: WCAG's large size, so a class's large color stands at 3:1 on the react smoke (the owner's answer on #54). */
    { id: 'groan-label', role: 'text', name: 'Groan', within: 'groan', origin: 'picker', buildSize: 24 },
    { id: 'calm', role: 'group', name: 'Calm', within: 'picker', origin: 'picker', type: false },
    ...buttons,
    { id: 'kind-tea', role: 'button', name: 'Tea, your reaction', buildName: 'Tea, Calm, your reaction', within: 'picker', origin: 'picker', type: false },
    { id: 'hint', role: 'text', name: 'Arrow keys move, Enter reacts. Outlined: yours.', within: 'picker', origin: 'picker' },
  ],
};

export default manifest;
