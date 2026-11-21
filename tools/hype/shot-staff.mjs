/**
 * The Staff, shots B1 to B6 (docs/plans/2026-11-14-hype-video-storyboard.md): the robots in charge, played straight. Each shot is a slow
 * read down a screen the staff have been at, so a pull-quote laid over it in the edit has the post it comes from under it.
 *
 *   node tools/hype/shot-staff.mjs --shot memo|declined|stars|farewell|arrival|profile|index [--skin key] [--still] [--port 4319]
 *
 *   memo      the Boss walks into an argument (FanGaME's post in "is a fangame a video game")
 *   declined  QC-1000 reviews the same argument as a submission, and declines it
 *   stars     ONTOPIC 5.0 rates it
 *   farewell  the Boss's last memo
 *   arrival   QC-1000 takes the chair, and reviews the farewell
 *   profile   the Boss's profile, with the moves he made and the reason he gave for each
 *   index     the board index, with the boards he made
 *
 * Every word the staff say on these screens is from the second season rehearsal's logs (tools/hype/staff-lines.mjs).
 *
 * Writes .runs/hype/staff-<shot>.mp4 (with --still, one picture and no film).
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const shot = flag('shot', '');
const still = process.argv.includes('--still');
/* Each shot: the screen, the post it reads (by its author's name, the first of theirs on the page), the skin, and how long it reads for. */
const SHOTS = {
  memo: { view: 'thread:argued', by: 'FanGaME', skin: 'blue-steel', seconds: 5 },
  declined: { view: 'thread:argued', by: 'QC-1000', skin: 'midnight', seconds: 5 },
  stars: { view: 'thread:argued', by: 'ONTOPIC 5.0', skin: 'fan-site', seconds: 4 },
  farewell: { view: 'thread:goodbye', by: 'FanGaME', skin: 'default', seconds: 6 },
  arrival: { view: 'thread:goodbye', by: 'QC-1000', skin: 'hot-rod', seconds: 5 },
  profile: { view: 'profile:fangame', by: null, skin: 'midnight', seconds: 6 },
  index: { view: 'index', by: null, skin: 'default', seconds: 4 },
};
const S = SHOTS[shot];
if (!S) throw new Error(`there is no shot "${shot}": the shots are ${Object.keys(SHOTS).join(', ')}`);

const cam = await openStage({ skin: flag('skin', S.skin), view: S.view, css: { width: 1120, height: 630 }, quiet: ['toasts', 'host', 'hud', 'selection'] });
try {
  /* The post the shot reads, brought to the top of the view: where its top stands on the page, and how tall it is. */
  const post = S.by === null ? { top: 0, height: await cam.evaluate('document.documentElement.scrollHeight') } : await cam.evaluate(`(() => {
    const a = [...document.querySelectorAll('article.kb-act')].find((e) => e.querySelector('.kb-postbit-name')?.textContent.trim() === ${JSON.stringify(S.by)});
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { top: r.top + scrollY, height: r.height };
  })()`);
  if (!post) throw new Error(`the screen has no post by ${S.by}`);
  const from = Math.max(0, post.top - 40);
  /* The read: from the post's top, down as far as it goes or a view's worth, whichever is less. */
  const travel = Math.max(0, Math.min(post.height - cam.css.height + 120, cam.css.height * 0.9));
  await cam.evaluate(`document.scrollingElement.scrollTop = ${from}`);
  await settle(cam, 50);
  console.log(`${shot}: reading from ${Math.round(from)} for ${Math.round(travel)}px; the post is ${Math.round(post.height)}px tall`);
  if (still) {
    writeFileSync(`${OUT}/staff-${shot}-still.jpg`, await cam.frame(true));
    console.log('errors:', cam.errors);
  } else {
    const film = openFilm({ path: `${OUT}/staff-${shot}.mp4`, fps: cam.fps });
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const n = Math.round(S.seconds * cam.fps);
    for (let f = 0; f < n; f++) {
      /* Held for the first half second, then one slow, even drift down the post. */
      const u = Math.max(0, (f / n - 0.1) / 0.9), e = u * u * (3 - 2 * u);
      /* The scroll is set, not asked for: the page's own scrollTo answers with something that never settles while its time stands still. */
      await cam.evaluate(`document.scrollingElement.scrollTop = ${from} + ${travel} * ${e}`);
      await film.write(await cam.frame(true));
    }
    await film.end();
    console.log(`filmed ${n} frames; errors:`, cam.errors);
  }
} finally {
  await cam.close();
}
