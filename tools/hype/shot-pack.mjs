/**
 * The pack, shot W4 (docs/plans/2026-11-14-hype-video-storyboard.md): the Vending Machine, a Booster bought, the pack opened and its five
 * cards turned one at a time, the last of them the rare.
 *
 *   node tools/hype/shot-pack.mjs [--still] [--port 4319]
 *
 * It films the booster packs board's own story (`Boards/Booster packs`, Machine: engine/ui/vending/Packs.board.stories.tsx), by the
 * presses a player makes and the board match makes (e2e/boards/2026-11-07-booster-packs/03-hit.ts): select the Booster, Buy, and turn
 * the cards. The story's world is its own, not the stage's.
 *
 * Writes .runs/hype/pack.mp4 (with --still, one picture of the machine and the names of its buttons, and no film).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { openCamera, openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, settle } from './stage.mjs';

const still = process.argv.includes('--still');
mkdirSync(OUT, { recursive: true });
const cam = await openCamera({ url: `http://localhost:${flag('port', 4319)}/?fixture=boards&story=boards-booster-packs--machine`, css: { width: 1440, height: 810 }, scale: 2 });
/* The middle of the button with this name (its label, else its words), or null. */
const button = (name) => cam.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') ?? e.textContent.trim()) === ${JSON.stringify(name)} && e.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const NAMES = `[...document.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('aria-label') ?? e.textContent.trim())`;

try {
  await cam.until(`document.querySelectorAll('button').length > 3`, { label: 'the machine drawn' });
  await settle(cam, 60);
  await cam.drawPointer();
  if (still) {
    writeFileSync(`${OUT}/pack-still.jpg`, await cam.frame(true));
    console.log('the buttons:', await cam.evaluate(NAMES), 'errors:', cam.errors);
  } else {
    const film = openFilm({ path: `${OUT}/pack.mp4`, fps: cam.fps });
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const F = cam.fps;
    let f = 0, at = { x: cam.css.width * 0.7, y: cam.css.height + 30 };
    const marks = {};
    const shoot = async (seconds) => { for (let i = 0, n = Math.round(seconds * F); i < n; i++, f++) await film.write(await cam.frame(true)); };
    const go = async (name, seconds, seed) => {
      const to = await button(name);
      if (!to) throw new Error(`the page has no button named "${name}": it has ${(await cam.evaluate(NAMES)).join(' | ')}`);
      const path = glide(at, to, seconds, { seed });
      for (let i = 0, n = Math.round(seconds * F); i <= n; i++, f++) { const p = path.at(i / F); await cam.move(p.x, p.y); await film.write(await cam.frame(true)); }
      at = to;
    };
    const click = async (mark) => { marks[mark] = f; await cam.press(); await shoot(0.07); await cam.release(); };
    await cam.move(at.x, at.y);
    await shoot(0.8);
    await go('Buy Booster, 3.00 orbs, a pack of 5 postcards', 0.9, 61);
    await shoot(0.25); await click('select'); await shoot(0.6);
    await go('Buy Booster · 3.00', 0.7, 62);
    await shoot(0.3); await click('buy');
    /* The pack opens: the hand is left alone for it. */
    await shoot(2.6);
    for (let n = 1; n <= 5; n++) {
      if (n === 1) await go('Turn the next card', 0.7, 63);
      await shoot(n === 5 ? 0.7 : 0.25);
      await click(`turn${n}`);
      await shoot(n === 5 ? 3.0 : 0.75);
    }
    await film.end();
    console.log(`filmed ${f} frames; the presses, by frame:`, marks, 'errors:', cam.errors);
  }
} finally {
  await cam.close();
}
