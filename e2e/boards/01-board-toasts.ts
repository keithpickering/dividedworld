/**
 * Board 01, the toasts board (docs/research/2026-11-02-alerts/01-board-toasts.html, 1440 by 1120): the Main board's moment with the hand closed,
 * the HUD's new Alerts button above Hand with its count, and a column of toasts rising above the seam with "+N more" over them (the alerts
 * design, section 8). The build is the app at the fixture's moment of the same name (web/src/data/fixtures/boards.ts), where five alerts
 * arrive as the HUD first listens, so three toasts show and two fold into the "+2 more" link, as the board draws them.
 *
 * Compared: the HUD as the Main board's manifest compares it (this design adds the Alerts button to it, which e2e/boards/01-main.ts, a
 * record of the board before it, does not draw), the Alerts button by its box, its word and its count, Hand closed, and the toasts' column: its
 * "+N more" link, each toast's line, its dismiss button, and the dismiss buttons' boxes.
 *
 * Not the board's words: the board's three toasts are a quote, a card and a hint, written by characters the player does not own and a pattern
 * of reactions; the fixture's five are rulings and traps on the player's own posts (the written kinds that toast by default, which a seed can
 * announce), so each toast's own words are found by the build's name and the toasts are compared by their box and type. A hint does not toast
 * by default (engine/ui/alerts/toast-kinds.ts), so the board's third toast, a hint, is a kind the player has switched on there. Each toast's
 * time is "now" in the build and "2 min", "1 min" and "now" on the board, so it is not compared. The thread above the HUD is the Main board's
 * and is compared by e2e/boards/01-main.ts.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '01-board-toasts',
  size: { width: 1440, height: 1120 },
  build: { moment: '01-board-toasts' },
  landmarks: [
    { id: 'hud', role: 'region', name: 'Game HUD', type: false },
    { id: 'hud-name', role: 'text', name: 'Pipewrench', within: 'hud' },
    { id: 'hud-class', role: 'text', name: 'Heel', within: 'hud' },
    { id: 'hud-secret', role: 'text', name: 'Only you see this', within: 'hud' },
    { id: 'hud-swap', role: 'combobox', name: 'Swap mask', within: 'hud' },
    { id: 'hud-orbs', role: 'img', name: 'Aura: 4.62 of 6.00 settled, about 0.30 more estimated', buildName: 'Wallet 4.62 of 6 orbs, 0.30 pending until the next settlement (estimate)', within: 'hud', type: false },
    { id: 'hud-estimate', role: 'text', name: '+0.30 est.', within: 'hud' },
    { id: 'hud-clock', role: 'text', name: 'Next settlement', within: 'hud', box: 'position' },

    /* Alerts: the bell (named "Alerts 5 new" in the build, without the comma, so its visible words "Alerts 5" are inside its name: WCAG 2.5.3),  its word and its gold count, above Hand and beside the clock. Its word and count are each compared by their own type. */
    { id: 'hud-alerts', role: 'link', name: 'Alerts, 5 new', buildName: 'Alerts 5 new', within: 'hud', type: false },
    { id: 'hud-alerts-word', role: 'text', name: 'Alerts', within: 'hud-alerts' },
    /* The count's ink is the instance's ink-ready (#1a1403) where the board draws #14100a, so its box is compared and not its color. */
    { id: 'hud-alerts-count', role: 'text', name: '5', within: 'hud-alerts', type: false },

    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud', type: false },
    { id: 'hud-menu-word', role: 'text', name: 'Menu', within: 'hud-menu' },
    { id: 'hud-esc', role: 'text', name: 'ESC', within: 'hud' },
    /* Hand, closed: where the Main board's manifest presses it open, this board draws it unopened, three postcards in it. */
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards', within: 'hud' },

    /*
     * The column of toasts. The board's toasts say less than the build's, which holds the words of the Alerts row (so a toast and its row say the same
     * thing, words.ts), each with its link, so a toast is taller in the build and the column's places down the page are not the board's. What is
     * compared is what does not move with the words: the dismiss buttons' 44px, and each line's type. The "+N more" link is the build's own
     * short words ("+2 more", named "+2 more alerts") where the board draws a sentence, so it is found and not compared.
     */
    { id: 'more', role: 'link', name: '+2 MORE ON THE ALERTS PAGE', buildName: '+2 more alerts', box: 'none', type: false },
    { id: 'dismiss-1', role: 'button', name: 'Dismiss', nth: 0, box: 'size', type: false },
    { id: 'dismiss-2', role: 'button', name: 'Dismiss', nth: 1, box: 'size', type: false },
    { id: 'dismiss-3', role: 'button', name: 'Dismiss', nth: 2, box: 'size', type: false },
    { id: 'toast-1', role: 'text', name: 'Mrs. Hooligan quoted Pipewrench', buildName: 'A ruling landed on Pipewrench', box: 'none' },
    { id: 'toast-2', role: 'text', name: 'Glitter Bomb was played on Spritey', buildName: 'A face-down card struck a post of Spritey\'s', box: 'none' },
    { id: 'toast-3', role: 'text', name: 'Your post is picking up heat', buildName: 'A ruling landed on Mrs. Hooligan', box: 'none' },
  ],
};

export default manifest;
