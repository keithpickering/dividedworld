/**
 * Board 05, the phone board (docs/research/2026-11-02-alerts/05-phone.html, 1760 by 924): four phone screens, 390 by 844, side by side in one
 * page: the board with toasts over the HUD (its bell between Posting as and Menu), the Alerts page, one Updates post, and the Season page's
 * News tab (the alerts design, sections 4, 6, 7 and 8). The match opens both pages at one size, so the page is read at the phone's 390 by 844
 * and the first screen is found inside it, where it stands at 40px, and compared as it sits from its own HUD (`origin`). The build is the app at
 * the toasts moment (web/src/data/fixtures/boards.ts), five alerts arriving as the HUD listens.
 *
 * Compared: the HUD's size and the places of Posting as, the bell, Menu and Hand from the HUD's corner, and the toasts' dismiss buttons (44px).
 *
 * NOT compared: the other three screens (Alerts, Updates, Season news on a phone). They were tried against the build at this width and differ in
 * type by the phone's sizes (the menu's tabs and Back at 20px where the board draws 17px, Back's weight, the menu bar 8px taller, the Alerts
 * heading's width), which is a decision between the board and the glass's phone sizes that no part of the design or plan has made, so no
 * manifest can honestly pass them. The words of those pages are held by the desk boards' manifests (02-alerts, 03-updates, 04-season-news),
 * and their phone layouts by the phone stories (engine/ui/alerts, updates and season board stories) in the a11y and glass-text suites.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '05-phone',
  size: { width: 390, height: 844 },
  build: { moment: '01-board-toasts' },
  landmarks: [
    /* The first screen: the HUD, 124px of it at the foot, with the bell between Posting as and Menu. */
    { id: 'hud', role: 'region', name: 'Game HUD', type: false, box: 'size' },
    /* The select is the phone's display size (20px) where the board draws 19px, so its type is not compared; its width is what the row leaves it. */
    { id: 'hud-swap', role: 'combobox', name: 'Posting as', within: 'hud', origin: 'hud', box: 'position', type: false },
    { id: 'hud-alerts', role: 'link', name: 'Alerts, 5 new', buildName: 'Alerts 5 new', within: 'hud', origin: 'hud', type: false },
    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud', origin: 'hud', type: false },
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards', within: 'hud', origin: 'hud', type: false },
    { id: 'dismiss-1', role: 'button', name: 'Dismiss', nth: 0, box: 'size', type: false },
    { id: 'dismiss-2', role: 'button', name: 'Dismiss', nth: 1, box: 'size', type: false },
  ],
};

export default manifest;
