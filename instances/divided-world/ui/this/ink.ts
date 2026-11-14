/**
 * THIS's ink (docs/plans/2026-11-13-this-design.md, section 2): the note's red and the highlighter's swipe, each with a light and a dark value.
 * `this.css` holds the same values as `--dw-this-ink` and `--dw-this-swipe`, and ink.test.ts holds them to each other and to the board: the ink at 4.5:1
 * against both post rows of every theme the instance lists, in the mode the theme is shown in, and the post's own words at 4.5:1 over the swipe.
 *
 * Both inks start from the mocks' red (docs/research/2026-11-12-this/), moved until the least ratio over the themes passed: the light one darker
 * (#e0261b was 3.64:1 on Blue Steel's second row), the dark one lighter (#ff6a5c was 3.52:1 on Fan Site's blue rows). The swipe is the mocks' yellow,
 * strong over a light post and faint over a dark one, where the words are light (0.32 took Fan Site's words to 3.66:1).
 */
export const INK = Object.freeze({ light: '#c01c12', dark: '#ff988a' });
export const SWIPE = Object.freeze({ light: 'rgb(255 228 0 / 0.9)', dark: 'rgb(255 228 0 / 0.2)' });
