/**
 * The hand, shots H1 to H3 (docs/plans/2026-11-14-hype-video-storyboard.md): the player holds one of every card in the game; the hand
 * fans open, the pointer crosses the fan in one unhurried pass, each card standing up as it is crossed, then comes back and picks one.
 *
 *   node tools/hype/shot-hand.mjs [--still] [--skin default] [--port 4319]
 *
 * Writes .runs/hype/hand.mp4 (with --still, one picture of the open hand and what the page says of its cards, and no film).
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const still = process.argv.includes('--still');
const cam = await openStage({ skin: flag('skin', 'fan-site'), css: { width: 1440, height: 810 }, quiet: ['toasts', 'host'] });
const rect = (sel) => cam.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
/* The cards in the open hand, left to right: where each one's button stands. */
const CARDS = `[...document.querySelectorAll('button')].filter((b) => /postcard/.test(b.getAttribute('aria-label') ?? b.textContent ?? '') && !b.classList.contains('kb-hud-hand')).map((b) => { const r = b.getBoundingClientRect(); return { name: (b.getAttribute('aria-label') ?? b.textContent).slice(0, 40), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, cls: b.className }; }).filter((c) => c.w > 0)`;

try {
  await cam.evaluate('window.__shot.place(120)');
  await settle(cam, 40);
  await cam.drawPointer();
  const button = await rect('.kb-hud-hand');
  if (!button) throw new Error('the HUD has no hand button');
  const at = { x: button.x + button.w / 2, y: button.y + button.h / 2 };
  console.log('the hand button:', button);

  if (still) {
    await cam.move(at.x, at.y);
    await settle(cam, 5);
    await cam.press(); await settle(cam, 3); await cam.release();
    await settle(cam, 150);
    writeFileSync(`${OUT}/hand-still.jpg`, await cam.frame(true));
    const cards = await cam.evaluate(CARDS);
    console.log(`${cards.length} cards; the first three:`, cards.slice(0, 3), 'the last:', cards.at(-1), 'errors:', cam.errors);
  } else {
    const film = openFilm({ path: `${OUT}/hand.mp4`, fps: cam.fps });
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const F = cam.fps;
    const start = { x: cam.css.width * 0.52, y: cam.css.height * 0.42 };
    let frame = 0;
    const shoot = async (n) => { for (let i = 0; i < n; i++, frame++) await film.write(await cam.frame(true)); };
    const follow = async (path) => { for (let i = 0, n = Math.round(path.seconds * F); i <= n; i++, frame++) { const p = path.at(i / F); await cam.move(p.x, p.y); await film.write(await cam.frame(true)); } };
    await cam.move(start.x, start.y);
    await shoot(Math.round(0.6 * F));
    await follow(glide(start, at, 0.9, { seed: 5 }));
    await shoot(8);
    await cam.press(); await shoot(4); await cam.release();
    /* The fan opens: the hand is left alone for all of it. */
    await shoot(Math.round(1.6 * F));
    const cards = await cam.evaluate(CARDS);
    if (cards.length < 2) throw new Error(`the open hand shows ${cards.length} cards`);
    /* The fan stands in rows, the front one lower: the pointer crosses the front row from the right, and comes back along the row behind. */
    const mid = (Math.min(...cards.map((c) => c.y)) + Math.max(...cards.map((c) => c.y))) / 2;
    const front = cards.filter((c) => c.y >= mid).sort((a, b) => b.x - a.x), back = cards.filter((c) => c.y < mid).sort((a, b) => a.x - b.x);
    const rows = back.length > 1 ? [front, back] : [front];
    /* A point on a row at `x`: between the two cards either side, a little above their middles, where a card's picture is. */
    const on = (row, x) => {
      const near = [...row].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x)), [a, c = a] = near;
      const u = a === c || a.x === c.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (c.x - a.x)));
      return { x, y: a.y + (c.y - a.y) * u - 28 };
    };
    let last = at;
    for (const row of rows) {
      const from = row[0].x + (row[0].x > row.at(-1).x ? 40 : -40), to = row.at(-1).x + (row[0].x > row.at(-1).x ? -40 : 40);
      await follow(glide(last, on(row, from), 0.7, { seed: 6 + row.length, settle: false }));
      /* One pass along the row, unhurried and at an even pace, with a hand's small wander. */
      const n = Math.round(3.4 * F);
      for (let i = 0; i <= n; i++) {
        const u = i / n, e = u * u * (3 - 2 * u), p = on(row, from + (to - from) * e);
        last = { x: p.x, y: p.y + 4 * Math.sin(u * 23) };
        await cam.move(last.x, last.y);
        await film.write(await cam.frame(true));
        frame++;
      }
      await shoot(Math.round(0.25 * F));
    }
    /* Back to one card, and the press that picks it. */
    /* The card the film ends on: the Unban, one of the game's two legendary cards and the strongest thing a hand can hold. */
    const PICK = flag('pick', 'Ultra Happy Heart');
    const picked = cards.find((c) => c.name.startsWith(PICK));
    if (!picked) throw new Error(`the hand holds no ${PICK}: it holds ${cards.map((c) => c.name.split(',')[0]).join(', ')}`);
    /*
     * Where to point: the cards overlap, so the middle of a card's own box is often another card's. The place is one where this card
     * is the one on top, the nearest such to its upper middle.
     */
    const spot = await cam.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').startsWith(${JSON.stringify(PICK)}));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      let best = null;
      for (let fy = 0.06; fy < 0.96; fy += 0.06) for (let fx = 0.06; fx < 0.96; fx += 0.06) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y)?.closest('button') !== b) continue;
        const d = Math.hypot(fx - 0.5, fy - 0.3);
        if (!best || d < best.d) best = { x, y, d };
      }
      return best;
    })()`);
    if (!spot) throw new Error(`no part of ${PICK} shows in the open hand`);
    await follow(glide(last, spot, 1.0, { seed: 7 }));
    /* It stands up under the pointer, and is looked at; then the press. */
    await shoot(Math.round(1.1 * F));
    console.log(`the press is at frame ${frame}`);
    await cam.press(); await shoot(4); await cam.release();
    await shoot(Math.round(1.6 * F));
    console.log('the hand button now says:', await cam.evaluate(`document.querySelector('.kb-hud-hand')?.textContent.trim()`));
    await film.end();
    console.log(`filmed; ${cards.length} cards in the hand; picked ${picked.name}; errors:`, cam.errors);
  }
} finally {
  await cam.close();
}
