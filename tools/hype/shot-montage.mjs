/**
 * The arsenal, shots A1 to A7 (docs/plans/2026-11-14-hype-video-storyboard.md): one card a shot, a second or two of each in the cut, each
 * in a skin of its own. Each is filmed longer than the cut needs.
 *
 *   node tools/hype/shot-montage.mjs --shot autocorrect|glitter|hold|laugh|jimmy|warn [--skin key] [--still] [--port 4319]
 *
 * Each shot plays on a post the stage wrote for it (`scenes` in instances/divided-world/ui/hype/Stage.board.stories.tsx):
 *
 *   autocorrect  three strips of tape land on Chadluminum's kind words, one after another, and rewrite them
 *   glitter      a Glitter Bomb goes off on Serious Deer; the pointer drags through it and carries glitter off down the page
 *   hold         a bystander reaches D-Guy's review, is held on it by Stick Around, and tries the wheel twice
 *   laugh        the pointer finds the joke in Human Josh's post, and the Laugh Track plays it
 *   jimmy        a Jimmy Wails appeal lands on Snuckles's post
 *   warn         a post a Mod Bot has been to, and the warning it left on its author
 *
 * Writes .runs/hype/montage-<shot>.mp4 (with --still, one picture after the shot's action and no film).
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const shot = flag('shot', '');
const still = process.argv.includes('--still');

/* Each shot: its post, who watches, its skin, and how far down the view the post's top stands. */
const SHOTS = {
  autocorrect: { scene: 'kind', as: null, skin: 'midnight', top: 150 },
  glitter: { scene: 'recount', as: null, skin: 'default', top: 190 },
  hold: { scene: 'review', as: 'Ringside', skin: 'fan-site', top: 520 },
  laugh: { scene: 'joke', as: null, skin: 'blue-steel', top: 170 },
  jimmy: { scene: 'appeal', as: 'Chadluminum', skin: 'hot-rod', top: 120 },
  warn: { scene: 'filed', as: 'Chadluminum', skin: 'midnight', top: 150 },
};
const S = SHOTS[shot];
if (!S) throw new Error(`there is no shot "${shot}": the shots are ${Object.keys(SHOTS).join(', ')}`);

const cam = await openStage({ skin: flag('skin', S.skin), as: S.as, css: { width: 1120, height: 630 }, quiet: ['toasts', 'host', 'hud', 'selection'] });
const page = (expression) => cam.evaluate(expression);
try {
  const seq = await page(`window.__kbStage.scenes.${S.scene}`);
  const POST = `#post-${seq}`;
  /* The post's body, where it stands now. */
  const body = () => page(`(() => { const r = document.querySelector('${POST} .kb-act-main').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  /* The middle of an element the page finds, or null. */
  const mid = (find) => page(`(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  const place = (top) => page(`(() => { const p = document.querySelector('${POST}'); p.scrollIntoView({ block: 'center' }); scrollBy(0, p.querySelector('.kb-act-main').getBoundingClientRect().top - ${top}); })()`);
  /* A card played on the shot's post by a character of the cast, landing on the open page. */
  const play = (name, card, options) => page(`(() => { const { fake, cast, thread } = window.__kbStage; return fake.acts(thread, ${seq}, ${seq}).then(([a]) => { fake.clock.advance(60000); return fake.seed.card(cast[${JSON.stringify(name)}], a.id, ${JSON.stringify(card)}, { live: true, ...${JSON.stringify(options)} }); }); })()`);

  await place(S.top);
  await settle(cam, 40);
  await cam.drawPointer();
  const box = await body();
  console.log(`${shot}: post ${seq}, its body`, box);

  const F = cam.fps;
  let film = null, f = 0;
  /* With --still the camera only draws, on the wall clock; with a film every frame is kept. */
  const shoot = async (seconds) => { for (let i = 0, n = Math.round(seconds * F); i < n; i++, f++) { if (film) await film.write(await cam.frame(true)); else { await cam.frame(false); await new Promise((r) => { setTimeout(r, 8); }); } } };
  const follow = async (path) => { for (let i = 0, n = Math.round(path.seconds * F); i <= n; i++, f++) { const p = path.at(i / F); await cam.move(p.x, p.y); if (film) await film.write(await cam.frame(true)); else await cam.frame(false); } };
  const off = { x: cam.css.width + 30, y: cam.css.height * 0.7 };
  if (!still) {
    film = openFilm({ path: `${OUT}/montage-${shot}.mp4`, fps: F });
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
  }
  await cam.move(off.x, off.y);

  if (shot === 'autocorrect') {
    await shoot(0.7);
    for (const config of [{ phrase: 'a genuine talent', replacement: 'legally a horse' }, { phrase: 'beautiful', replacement: 'a cry for help' }, { phrase: 'sincerely', replacement: 'under duress' }]) {
      await play('D-Guy', 'autocorrect', { config, message: '' });
      await shoot(0.75);
    }
    await shoot(2.5);
  } else if (shot === 'glitter') {
    await shoot(0.6);
    await page(`(() => { const { fake, cast, thread } = window.__kbStage; return fake.acts(thread, ${seq}, ${seq}).then(([a]) => fake.seed.reach(cast['Chadluminum'], 'character', a.character, 'glitter-bomb', { post: a.id, ends: Date.now() + 5 * 86400000, message: 'You earned this.', live: true })); })()`);
    await shoot(2.4);
    /* Through the glitter, side to side, and then off down the page with what stuck. */
    const from = { x: box.x + box.w * 0.92, y: box.y + box.h * 0.5 };
    await follow(glide(off, from, 0.6, { seed: 21, settle: false }));
    for (let i = 0, n = Math.round(2.6 * F); i <= n; i++, f++) {
      const u = i / n;
      await cam.move(box.x + box.w * (0.5 + 0.42 * Math.cos(u * Math.PI * 5)), box.y + box.h * (0.5 + 0.3 * Math.sin(u * Math.PI * 3.1)));
      if (film) await film.write(await cam.frame(true)); else await cam.frame(false);
    }
    await follow(glide({ x: box.x + box.w * 0.08, y: box.y + box.h * 0.5 }, { x: box.x + box.w * 0.4, y: cam.css.height - 30 }, 1.3, { seed: 22, settle: false }));
    await shoot(1.2);
  } else if (shot === 'hold') {
    /* The bystander reads down the page with the wheel; the post takes hold; the wheel is tried twice more. */
    await play('D-Guy', 'stick-around', { layer: 1, message: 'required reading', config: { sentence: 'I have read all nine parts and I feel changed.' } });
    await cam.move(cam.css.width * 0.6, cam.css.height * 0.5);
    await shoot(0.6);
    for (let i = 0; i < 26; i++) { await cam.wheel(18); await shoot(1 / 30); }
    await shoot(1.6);
    for (let n = 0; n < 2; n++) {
      /* A real try at leaving: the bar climbs while the wheel turns, and falls back when it stops. */
      for (let i = 0; i < 26; i++) { await cam.wheel(110 + 60 * n); await shoot(1 / 30); }
      await shoot(1.0);
    }
    await shoot(1.0);
  } else if (shot === 'laugh') {
    await shoot(0.8);
    const cue = await mid(`document.querySelector('${POST} .dw-lt-cue')`);
    if (!cue) throw new Error('the joke has no cue drawn');
    await follow(glide(off, cue, 1.0, { seed: 31 }));
    await shoot(0.4);
    await cam.press(); await shoot(0.07); await cam.release();
    await shoot(2.6);
  } else if (shot === 'jimmy') {
    await shoot(1.2);
    /* The pointer goes to the largest gift and gives it. */
    /* The gifts are buttons named by their amounts. */
    const gift = await mid(`[...document.querySelectorAll('${POST} button')].find((b) => b.textContent.trim() === '1.00')`);
    console.log('the gift button:', gift);
    if (gift) {
      await follow(glide(off, gift, 1.0, { seed: 51 }));
      await shoot(0.4);
      await cam.press(); await shoot(0.07); await cam.release();
    }
    await shoot(2.4);
  } else if (shot === 'warn') {
    await shoot(1.0);
    const meter = await mid(`document.querySelector('${POST} .kb-postbit-warn')`);
    console.log('the warn meter:', meter);
    if (meter) { await follow(glide(off, { x: meter.x + 30, y: meter.y + 26 }, 1.1, { seed: 41 })); }
    await shoot(2.0);
  }

  if (film) { await film.end(); console.log(`filmed ${f} frames; errors:`, cam.errors); }
  else {
    writeFileSync(`${OUT}/montage-${shot}-still.jpg`, await cam.frame(true));
    console.log('errors:', cam.errors);
  }
} finally {
  await cam.close();
}
