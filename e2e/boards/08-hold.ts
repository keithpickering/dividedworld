/**
 * Board 08, the Hold board (docs/research/2026-10-29-two-worlds/08-hold.html, 1440 by 980), rewritten from the approved
 * stories of Stick Around's full-screen view (cards plan, Task 4 as amended 2026-10-30; the owner approved them on #74).
 * The build side is the story `View`, instances/divided-world/ui/stick-around/Hold.board.stories.tsx, Thwompson's view of
 * #44 on the boards fixture's `08-hold` moment, the view's bar held at 40% as the board draws it.
 *
 * The board drew the held post still in its thread, framed, with the card's tag over it and the release and the bar
 * under it. The view lifts the post out of its thread into a glass view of its own, so what the board keeps is what the
 * view keeps: the tag, the release in the caster's words, the bar and its words. Where the view differs from the board by
 * a decision the owner approved, the landmark says so:
 *  - the post is not drawn as the board's boxed 2003 post at 1000 by 480 at a fixed place: the view shows the post's
 *    own head and words, scrolling in the view's body, with the release at its end, so the post and the release stand where
 *    the view puts them (they are compared by their words and type, not by their places);
 *  - the bar and the BREAK FREE button stand in the view's foot, beside the release panel's end, where the board put
 *    the bar to the release's right; the bar is compared by its size and its words by their type;
 *  - the board has no BREAK FREE button (the button is the view's accessible way to do what scrolling does), so it is not
 *    a landmark here: that it is named "Break free" and says how it works is held by hold.test.tsx;
 *  - the board draws the tag on the post's top edge; the view sets it in the dialog's bar after the title, the title
 *    "Stick Around" and the caster's words as the tag's two parts;
 *  - the board's labels are 21px and its certification line 22px, two sizes the glass's closed list (tokens.css) does not
 *    have: the view sets its labels in the glass's label size, 20px, and the line in its lead size, 24px, so those
 *    landmarks are held to the sizes by decision (`buildSize`) and to the board in everything else (family, weight,
 *    color, letter-spacing). The 24px line stands at 3:1 or better on the effect smoke as large text; the rendered
 *    measurement (e2e/glass-text.spec.ts) covers it.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '08-hold',
  size: { width: 1440, height: 980 },
  build: { story: 'boards-08-hold--view' },
  landmarks: [
    { id: 'post', role: 'article', name: 'Held post: Spritey, #44', type: false, box: 'none' },
    { id: 'tag-card', role: 'text', name: 'STICK AROUND', buildName: 'Stick Around', buildSize: 20, box: 'none' },
    { id: 'tag-words', role: 'text', name: 'Gloomba: “required reading”', box: 'none' },
    { id: 'release', role: 'region', name: 'Release', type: false, box: 'none' },
    { id: 'check', role: 'checkbox', name: 'CHECK TO BE RELEASED I have read every word of Spritey\'s changelog and I feel changed.', buildName: 'Check to be released I have read every word of Spritey\'s changelog and I feel changed.', within: 'release', type: false, box: 'none' },
    { id: 'check-head', role: 'text', name: 'CHECK TO BE RELEASED', buildName: 'Check to be released', within: 'release', buildSize: 20, box: 'none' },
    { id: 'check-words', role: 'text', name: 'I have read every word of Spritey\'s changelog and I feel changed.', within: 'release', buildSize: 24, box: 'none' },
    { id: 'bar', role: 'progressbar', name: 'Break free', type: false, box: 'none' },
    { id: 'bar-head', role: 'text', name: 'BREAK FREE', buildName: 'Break free', buildSize: 20, box: 'none' },
    { id: 'bar-percent', role: 'text', name: '40%', buildSize: 20, box: 'none' },
    { id: 'hint', role: 'text', name: 'Keep scrolling away to break free for this visit. Next visit, it holds you again until you check.', box: 'none' },
  ],
};

export default manifest;
