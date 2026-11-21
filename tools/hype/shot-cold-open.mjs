/**
 * The cold open, shots C1 to C3 (docs/plans/2026-11-14-hype-video-storyboard.md): a plain thread, held still, with one sincere post
 * about a sprite sheet. The pointer drifts to the post's React button, hesitates, opens the picker, cannot decide, and leaves a
 * thumbs up. The stamp lands, and in the edit the first orchestral hit lands on the same frame.
 *
 *   node tools/hype/shot-cold-open.mjs [--still] [--skin default] [--port 4319]
 *
 * The film's player is Chadluminum's: a player cannot react to their own post, and the post is Snuckles's.
 *
 * Writes .runs/hype/cold-open.mp4, and says at which frame the reaction was left and at which the stamp strikes, for the edit to put
 * the hit on (with --still, one picture with the picker open and no film).
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const still = process.argv.includes('--still');
const POST = '#post-1', KIND = '👍', DOUBT = '🔥';
const cam = await openStage({ skin: flag('skin', 'default'), as: 'Chadluminum', css: { width: 1280, height: 720 }, quiet: ['toasts', 'host', 'hud', 'selection'] });
/* The middle of an element the page finds, or null. */
const mid = (find) => cam.evaluate(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
const reactButton = `[...document.querySelectorAll('${POST} button')].find((b) => b.textContent.trim().replace(/^\\+\\s*/u, '') === 'React')`;
const kind = (emoji) => `[...document.querySelectorAll('.kb-picker-kind')].find((b) => b.textContent.includes('${emoji}'))`;

try {
  await cam.evaluate(`(() => { const p = document.querySelector('${POST}'); p.scrollIntoView({ block: 'start' }); scrollBy(0, -70); })()`);
  await settle(cam, 40);
  await cam.drawPointer();
  const button = await mid(reactButton);
  if (!button) throw new Error(`${POST} has no React button for this player`);
  console.log('the React button:', button);

  if (still) {
    await cam.move(button.x, button.y);
    await settle(cam, 5);
    await cam.press(); await settle(cam, 3); await cam.release();
    await settle(cam, 120);
    writeFileSync(`${OUT}/cold-open-still.jpg`, await cam.frame(true));
    console.log('the kinds:', await cam.evaluate(`[...document.querySelectorAll('.kb-picker-kind')].map((b) => b.textContent.trim()).join(' ')`), 'errors:', cam.errors);
  } else {
    const film = openFilm({ path: `${OUT}/cold-open.mp4`, fps: cam.fps });
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const F = cam.fps;
    let f = 0;
    const shoot = async (seconds) => { for (let i = 0, n = Math.round(seconds * F); i < n; i++, f++) await film.write(await cam.frame(true)); };
    const follow = async (path) => { for (let i = 0, n = Math.round(path.seconds * F); i <= n; i++, f++) { const p = path.at(i / F); await cam.move(p.x, p.y); await film.write(await cam.frame(true)); } };
    /* A hand that has stopped is not still: it drifts a few px while its owner thinks. */
    const waver = async (at, seconds, seed) => { for (let i = 0, n = Math.round(seconds * F); i < n; i++, f++) { const u = i / F; await cam.move(at.x + 2.5 * Math.sin(u * 2.3 + seed), at.y + 2 * Math.sin(u * 3.1 + seed * 2)); await film.write(await cam.frame(true)); } };
    const off = { x: cam.css.width * 0.78, y: cam.css.height + 30 };
    const near = { x: button.x + 150, y: button.y + 46 };
    /* C1: the thread, held. Nothing moves. */
    await cam.move(off.x, off.y);
    await shoot(3.0);
    /* C2: the pointer comes up, stops short of the button, thinks about it, and goes. */
    await follow(glide(off, near, 1.5, { seed: 11 }));
    await waver(near, 0.9, 1);
    await follow(glide(near, button, 0.7, { seed: 12 }));
    await waver(button, 0.5, 2);
    await cam.press(); await shoot(0.07); await cam.release();
    await shoot(0.9);
    const doubt = await mid(kind(DOUBT)), pick = await mid(kind(KIND));
    if (!doubt || !pick) throw new Error(`the picker does not offer ${!doubt ? DOUBT : KIND}`);
    await follow(glide(button, doubt, 0.8, { seed: 13 }));
    await waver(doubt, 0.8, 3);
    await follow(glide(doubt, pick, 0.6, { seed: 14 }));
    await waver(pick, 0.7, 4);
    /* C3: the reaction is left. */
    const leftAt = f;
    await cam.press(); await shoot(0.07); await cam.release();
    await shoot(2.6);
    await film.end();
    /* The stamp waits for the picker to leave (the smooth feel's exit, 300ms) and strikes 32% into its 720ms beat (reactions.css). */
    const strike = leftAt + Math.round((0.07 + 0.3 + 0.32 * 0.72) * F);
    console.log(`filmed ${f} frames; the reaction is left at frame ${leftAt} (${(leftAt / F).toFixed(2)}s) and the stamp should strike near frame ${strike} (${(strike / F).toFixed(2)}s); errors:`, cam.errors);
  }
} finally {
  await cam.close();
}
