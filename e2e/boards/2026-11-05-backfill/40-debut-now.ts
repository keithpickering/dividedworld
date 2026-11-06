/**
 * Board 40, the Debut dialog, dropping now (docs/research/2026-11-05-backfill/40-debut-now.html, 1440 by 1000): `24-debut.html`'s frame with its own
 * title ("Drop Waiting Wanda now"), its Silent line ("Waiting Wanda's first post is its entrance", the line a character that drops now has) and
 * its footer ("Waiting Wanda goes on the board at once and can post at once, instead of at the next settlement."). The build is the same story as board 24's,
 * reached by Drop Waiting Wanda now. The departures are 24's, which this manifest shares its parts with (`debutLandmarks`); the footer's line here
 * needs no countdown, so it is the board's words exactly.
 */
import type { BoardManifest } from '../../board-match.ts';
import { debutLandmarks } from './24-debut.ts';

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/40-debut-now',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-characters--waiting' },
  press: [{ role: 'button', name: 'Drop Waiting Wanda now' }],
  landmarks: debutLandmarks({
    title: 'DROP WAITING WANDA NOW', buildTitle: 'Drop Waiting Wanda now',
    foot: 'Waiting Wanda goes on the board at once and can post at once, instead of at the next settlement.',
    save: 'DROP WAITING WANDA NOW', buildSave: 'Drop Waiting Wanda now', silent: "Nobody is told. Waiting Wanda's first post is its entrance.", where: 'At once',
  }),
};

export default manifest;
