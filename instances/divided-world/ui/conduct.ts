/**
 * Divided World's code of conduct (docs/plans/2026-11-02-conduct-design.md, section 9; the owner accepted the draft and said it can be
 * refined over time). Version 1. A player accepts it beside the 18+ checkbox at registration, and an account that has not accepted the
 * current version accepts it at its next sign-in. Changing the words in a way that needs a new acceptance means a new version.
 *
 * Plain, out of character and American English: the glass never speaks as The System or a character (CLAUDE.md, "The fiction may lie; the log
 * never does"). Each `text` is Markdown, drawn through the guide's renderer.
 */
import type { ConductUi } from '../../../engine/ui/types.ts';

export const conduct: ConductUi = Object.freeze({
  version: 1,
  sections: Object.freeze([
    { key: 'person', title: 'The mask is fair game; the person isn\'t.', text: 'Roast a character all you like. Don\'t go after the real person behind it: their looks, their job, their family, their real life.' },
    { key: 'hate', title: 'No hate.', text: 'No slurs, and no attacks on anyone\'s race, gender, sexuality, religion or disability, in character or out of it.' },
    { key: 'harassment', title: 'No sexual harassment.', text: 'That includes sexual content aimed at anyone.' },
    { key: 'stop', title: 'Stop when asked.', text: 'If someone tells you out of character that something isn\'t fun for them, it stops, even if it\'s "just the game."' },
    { key: 'onBoard', title: 'Keep it on the board.', text: 'No threats, and nothing that follows a player off the site.' },
    { key: 'reportAbuse', title: 'Don\'t report play as abuse to win.', text: 'Reporting play as abuse to win the game is itself a breach of this code.' },
    { key: 'outing', title: 'Don\'t out a mask with outside knowledge.', text: 'Don\'t reveal on the board who plays a mask using what you know from outside the game. Guessing in character from clues is the game.' },
  ]),
});
