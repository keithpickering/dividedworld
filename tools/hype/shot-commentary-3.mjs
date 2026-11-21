/**
 * The commentary video's part three, nodes 9 to 11 (docs/plans/2026-11-21-commentary-video-plan.md, Tasks 7 and 8a; the design, sections 4 and
 * 5a): the full orchestra and the camera's loss of control. Every take is filmed at the camera's native double density (1440 x 810 CSS px at
 * 2x) and written at 2880 x 1620, so the edit's pushes and punches have room.
 *
 *   node tools/hype/shot-commentary-3.mjs [--only c-n09-wide|c-n09-tight|c-n09-turned|c-n10|c-n11] [--port 4319]
 *
 *   c-n09-wide    "Everything, on one post": the plays of `pile` land on Snuckles's sprite sheet, a play about every 1.4 s, then Stick
 *   c-n09-tight   Around lands and the reader tries to wheel away twice and is held. One script, three framings: wide (the whole post
 *   c-n09-turned  and the glass, level), tight (the post's body fills the frame), and turned (the board a plane in space, turned further
 *                 with each landing and in a full slow spin from 15.8 s to 20.8 s). The three run the SAME script on the SAME
 *                 virtual clock, so frame N is the same moment of the page in all three; every landing's frame is written to c-n09.json.
 *   c-n10         "The Staff arrive": three beats of about 4.5 s, cut inside the take: FanGaME's memo, the merge (the index, then the
 *                 Staff Announcements thread, where the move's notice carries his reason), a Mod's filing of Snuckles's sprite post. The board turns a little in each.
 *   c-n11         "The chords": one take of five stretches of 3.5 s with a hard cut between them: a chair mid-fall, the ink-covered
 *                 review, the Boss's post, the heap on post 1, and the settlement summary opening (the story "Boards/12 Log").
 *
 * Nothing waits on the wall clock: every wait is a count of frames of the page's own virtual clock, or a condition. A take ends with two seconds
 * of a still page. The turned take never reads an element's place or aims the pointer: its plays all go through `pile`, and the per-frame step
 * reads only layout (offsets), which a transform does not change.
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const SIZE = { width: 2880, height: 1620 };
const FPS = 60;
const only = flag('only', null);

/** The pile's steps in the order they land (stage-play.ts names them): chosen so each can be seen, with Hot Box's smoke late. */
const ORDER = ['whoops-1', 'steel-chair-1', 'whoops-2', 'steel-chair-2', 'laugh-track', 'whoops-3', 'steel-chair-3', 'jimmy-wails', 'you-were-saying', 'off-day', 'hot-box', 'stick-around'];
const LEAD = 60, GAP = 84; // a second of lead-in, then a play every 1.4 s
/* Stick Around lands six seconds after Hot Box, once the smoke has thinned and the board has turned its last: the page holds the reader on a screen of its own about 1.5 s after it lands, and that screen is the game's, so what the camera has to show of the heap comes first. */
const STICK = 21 * FPS;
const N9 = Math.round(28.5 * FPS); // the node 9 takes: 28.5 s, the last two of them a still page
/* The turned take's full slow spin, in frames: the five seconds before Stick Around lands, since once it holds the page its screen is the game's own and does not turn. */
const SPIN = [Math.round(15.8 * FPS), Math.round(20.8 * FPS)];
const TRIES = [Math.round(23.4 * FPS), Math.round(24.9 * FPS)]; // the frames of the reader's two tries at wheeling away
const easeInOut = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** In the page: the per-frame step of node 9, the same arithmetic for all three framings. */
const FILM_JS = `(() => {
  const abs = (e) => { let x = 0, y = 0; for (; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return { x, y }; };
  let amp = 0;
  window.__film = {
    /** Where post 1 and its body stand on the page (layout, not the picture: a transform does not change it). */
    lay() {
      const post = document.querySelector('#post-1'), body = post.querySelector('.kb-act-main');
      const p = abs(post), b = abs(body);
      return { top: p.y, h: post.offsetHeight, bx: b.x, by: b.y, bw: body.offsetWidth, bh: body.offsetHeight };
    },
    /** One frame: scroll the post into place while the script drives the scroll, then set the framing. */
    step(mode, f, landings, scripted, spin) {
      const L = this.lay();
      if (scripted) document.scrollingElement.scrollTop = L.top - 4 + Math.max(0, L.h - 590) * 0.35;
      if (mode === 'wide') return L;
      if (mode === 'tight') {
        const s = 1.4, cx = L.bx + L.bw / 2, cy = L.by + L.bh / 2 - scrollY;
        window.__shot.turn({ scale: s, x: -s * (cx - innerWidth / 2), y: -s * (cy - innerHeight / 2) });
        return L;
      }
      /* turned: a few degrees off to begin with, further with each landing, and one full slow spin at the end. */
      amp += (landings / 12 - amp) * 0.06;
      const t = Math.min(f, ${SPIN[1]}) / 60;
      const tau = Math.PI * 2;
      const ry = (5 + 20 * amp) * Math.sin(tau * t / 4.3 + 0.9) + 360 * spin;
      const rx = 3 + 12 * amp * Math.sin(tau * t / 6.1 + 0.3);
      const rz = 1 + 4 * amp + 7 * amp * Math.sin(tau * t / 9);
      window.__shot.turn({ rx, ry, rz, scale: 0.8 });
      return L;
    },
  };
})()`;

/** A card's key from a step's name: whoops-1 is a whoops, steel-chair-3 a steel-chair. */
const kind = (step) => step.replace(/-\d$/u, '');

/** Node 9, one framing of the one script. */
async function n09(framing) {
  const name = `c-n09-${framing}`;
  /* The reader is a bystander (Ringside, as round 1's hold shot has it): the page holds a reader of a post, and in the first run, as the post's own author, it did not hold. */
  const cam = await openStage({ as: 'Ringside', quiet: framing === 'tight' ? ['toasts', 'host', 'hud', 'selection'] : ['toasts', 'host', 'selection'] });
  try {
    const steps = await cam.evaluate('window.__shot.pileSteps');
    for (const s of ORDER) if (!steps.includes(s)) throw new Error(`the pile has no step ${s}: it has ${steps.join(', ')}`);
    await cam.evaluate(FILM_JS);
    await cam.evaluate(`window.__film.step('wide', 0, 0, true, 0)`);
    await settle(cam, 40);
    await cam.drawPointer();
    const film = openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, out: SIZE });
    console.log(`${name}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    /* The reader's hand rests on the post; it never aims at anything. */
    await cam.move(cam.css.width * 0.6, cam.css.height * 0.45);
    await cam.evaluate('window.__shot.zero()');
    /** @type {{ what: string, frame: number }[]} */
    const landed = [];
    let next = 0;
    /* Two tries at leaving: 26 turns of the wheel, two frames apart, the second harder. */
    const wheels = TRIES.flatMap((start, n) => Array.from({ length: 26 }, (_, i) => ({ at: start + i * 2, dy: 110 + 60 * n })));
    for (let f = 0; f < N9; f++) {
      while (next < ORDER.length && f >= (next < ORDER.length - 1 ? LEAD + next * GAP : STICK)) {
        const step = ORDER[next++];
        await cam.evaluate(`window.__shot.pile(${steps.indexOf(step)})`);
        landed.push({ what: kind(step), frame: f });
      }
      for (const w of wheels) if (w.at === f) await cam.wheel(w.dy);
      const spin = framing === 'turned' ? easeInOut((f - SPIN[0]) / (SPIN[1] - SPIN[0])) : 0;
      await cam.evaluate(`window.__film.step(${JSON.stringify(framing)}, ${f}, ${landed.length}, ${f < STICK + 30}, ${spin})`);
      await film.write(await cam.frame(true));
    }
    await film.end();
    const out = { landed, tries: TRIES, spin: SPIN };
    writeFileSync(`${OUT}/c-n09.json`, JSON.stringify(out, null, 2));
    console.log(`${name}: ${N9} frames; landed`, landed.map((l) => `${l.what}@${l.frame}`).join(' '), '; errors:', cam.errors);
  } finally {
    await cam.close();
  }
}

/* ---- node 10 and node 11 ---- */

/** The take's film and its frame count, with `each` run before every frame (the camera's drift, the scroll). */
function reel(cam, name) {
  const film = openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, out: SIZE });
  const r = {
    f: 0,
    async frames(n, before) {
      for (let i = 0; i < n; i++, r.f++) {
        if (before) await before(i, n);
        await film.write(await cam.frame(true));
      }
    },
    end: () => film.end(),
  };
  return r;
}

/** In the page: where something stands on the page by layout (offsets), the foot of the page, and a scroll set at once. */
const LAYOUT_JS = `(() => {
  const abs = (e) => { let y = 0; for (; e; e = e.offsetParent) y += e.offsetTop; return y; };
  window.__lay = {
    top: (sel) => abs(document.querySelector(sel)),
    last: () => { const a = [...document.querySelectorAll('article.kb-act')].pop(); return { top: abs(a), height: a.offsetHeight, name: a.querySelector('.kb-postbit-name')?.textContent.trim() }; },
    textTop: (text) => { const e = [...document.querySelectorAll('main *')].filter((x) => x.textContent.includes(text) && ![...x.children].some((c) => c.textContent.includes(text))).pop(); return e ? abs(e) : null; },
    foot: () => document.documentElement.scrollHeight - innerHeight,
    scroll: (y) => { document.scrollingElement.scrollTop = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)); },
  };
})()`;

/** A slow drift of the turned board: degrees about each axis, a function of the seconds into a beat. */
const drift = (t, seed) => ({
  rx: 2.5 * Math.sin(t * 1.1 + seed),
  ry: 7 * Math.sin(t * 0.9 + seed * 1.7),
  rz: 1.5 * Math.sin(t * 0.7 + seed * 2.3),
  scale: 0.94,
});

async function n10() {
  const cam = await openStage({ quiet: ['toasts', 'host', 'selection'] });
  try {
    await cam.evaluate(LAYOUT_JS);
    await cam.evaluate('window.__lay.scroll(1e9)');
    await settle(cam, 40);
    await cam.drawPointer();
    const reelOf = reel(cam, 'c-n10');
    console.log(`c-n10: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    await cam.move(cam.css.width + 40, cam.css.height * 0.4);
    await cam.evaluate('window.__shot.zero()');
    const landed = [];
    const turn = (y, t, seed) => cam.evaluate(`(() => { window.__lay.scroll(${y}); window.__shot.turn(${JSON.stringify(drift(t, seed))}); })()`);
    const BEAT = 270; // 4.5 s

    /* Beat 1: the Boss's memo appears at the foot of the thread, and the view settles on his post. */
    landed.push({ what: 'memo', frame: reelOf.f });
    let y = await cam.evaluate('window.__lay.foot()');
    await reelOf.frames(36, (i) => turn(y, i / FPS, 1));
    await cam.evaluate(`window.__shot.staff('memo')`);
    const memo = await cam.evaluate('window.__lay.last()');
    if (memo.name !== 'FanGaME') throw new Error(`the last post of the thread is ${memo.name}'s, not FanGaME's: the memo did not land`);
    const memoText = await cam.evaluate(`document.querySelector('article.kb-act:last-of-type, article.kb-act:last-child')?.innerText ?? ''`);
    if (!memoText.includes('writing per my own initiative')) throw new Error(`the memo's words are not on the page: ${memoText.slice(0, 120)}`);
    const from = y;
    await reelOf.frames(BEAT - 36, async (i) => {
      const goal = Math.max(0, memo.top - 70);
      const u = easeInOut(i / 45);
      await turn(from + (Math.min(goal, await cam.evaluate('window.__lay.foot()')) - from) * u, (i + 36) / FPS, 1);
    });

    /* Beat 2: the merge. The index, then the Staff Announcements thread, where the move's notice carries his reason. */
    landed.push({ what: 'merge', frame: reelOf.f });
    await cam.evaluate(`window.__shot.staff('merge')`);
    await cam.evaluate(`window.__shot.show('index')`);
    await cam.evaluate('window.__lay.scroll(0)');
    await reelOf.frames(120, (i) => turn(0, i / FPS, 2));
    await cam.evaluate(`window.__shot.show('thread:announcements')`);
    await reelOf.frames(3, (i) => turn(0, (120 + i) / FPS, 2));
    const REASON = 'Nobody posted on my board anyway. (That is fine.)';
    const reasonTop = await cam.evaluate(`window.__lay.textTop(${JSON.stringify(REASON)})`);
    if (reasonTop === null) throw new Error(`the Staff Announcements thread does not show his reason: ${REASON}`);
    await reelOf.frames(BEAT - 123, (i) => turn(Math.max(0, reasonTop - 200) * easeInOut(i / 30), (123 + i) / FPS, 2));
    const merged = await cam.evaluate(`document.body.innerText.includes(${JSON.stringify(REASON)})`);
    if (!merged) throw new Error('the reason is not legible on the page');

    /* Beat 3: a Mod files Snuckles's sprite post: the visit's Filed mark and its finding on the post and the warn bar ticking up. */
    landed.push({ what: 'filing', frame: reelOf.f });
    await cam.evaluate(`window.__shot.show('thread')`);
    await reelOf.frames(2, (i) => cam.evaluate('window.__lay.scroll(0)'));
    const post1 = await cam.evaluate(`window.__lay.top('#post-1')`);
    const warn = () => cam.evaluate(`document.querySelector('#post-1 .kb-postbit-warn')?.innerText.replace(/\\s+/g, ' ') ?? null`);
    const before = await warn();
    await reelOf.frames(36, (i) => turn(post1 - 12, (i + 2) / FPS, 3));
    await cam.evaluate(`window.__shot.staff('file', 1)`);
    await reelOf.frames(BEAT - 38, (i) => turn(post1 - 12 + 0.25 * i, (i + 38) / FPS, 3));
    const after = await warn();
    const text = await cam.evaluate(`document.querySelector('#post-1').innerText`);
    console.log('c-n10: warn bar', before, '->', after);
    if (before === after) throw new Error(`Snuckles's warn bar did not move: ${before}`);
    if (!text.includes('Filed') || !text.includes('found in violation')) throw new Error(`the Mod's filing is not on the post: ${text.slice(0, 200)}`);

    /* The take ends on a still page. */
    await reelOf.frames(2 * FPS, (i) => turn(post1 - 12 + 0.25 * (BEAT - 38), (BEAT + i) / FPS, 3));
    await reelOf.end();
    writeFileSync(`${OUT}/c-n10.json`, JSON.stringify({ landed }, null, 2));
    console.log(`c-n10: ${reelOf.f} frames; landed`, landed.map((l) => `${l.what}@${l.frame}`).join(' '), '; errors:', cam.errors);
  } finally {
    await cam.close();
  }
}

async function n11() {
  const cam = await openStage({ quiet: ['toasts', 'host', 'selection'] });
  try {
    await cam.evaluate(LAYOUT_JS);
    /* Before the film: the Boss's memo is posted, so his post is on the page. */
    await cam.evaluate('window.__lay.scroll(1e9)');
    await settle(cam, 20);
    await cam.evaluate(`window.__shot.staff('memo')`);
    await settle(cam, 30);
    const boss = await cam.evaluate('window.__lay.last()');
    if (boss.name !== 'FanGaME') throw new Error('the Boss\'s post is not on the page');
    const steps = await cam.evaluate('window.__shot.pileSteps');
    const at = (s) => steps.indexOf(s);
    await cam.drawPointer();
    const r = reel(cam, 'c-n11');
    console.log(`c-n11: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    await cam.move(cam.css.width + 40, cam.css.height * 0.4);
    await cam.evaluate('window.__shot.zero()');
    const landed = [];
    const STRETCH = 210; // 3.5 s
    /** A stretch: a hard cut onto `y`, the board turned as given, `play` at its frame, and a slow push in the turn through the stretch. */
    const stretch = async (y, pose, plays) => {
      landed.push({ what: 'cut', frame: r.f });
      await r.frames(STRETCH, async (i) => {
        for (const p of plays) if (p.at === i) await p.run();
        const u = i / STRETCH;
        await cam.evaluate(`(() => { window.__lay.scroll(${y}); window.__shot.turn(${JSON.stringify({ scale: 1.1 + 0.04 * u, rx: pose.rx * (1 + 0.3 * u), ry: pose.ry * (1 + 0.3 * u), rz: pose.rz * (1 + 0.3 * u) })}); })()`);
      });
    };
    const pile = (s) => cam.evaluate(`window.__shot.pile(${at(s)})`);

    /* 1: a steel chair mid-fall on the sprite sheet, caught by its throw. */
    const post1 = await cam.evaluate(`window.__lay.top('#post-1')`);
    await stretch(post1 - 14, { rx: 4, ry: -9, rz: 1 }, [{ at: 8, run: () => pile('steel-chair-1') }, { at: 40, run: () => pile('steel-chair-2') }]);
    /* 2: the ink-covered review: Whoops! lands on D-Guy's review, and rides in on 4D Chess's face-down move. */
    const review = await cam.evaluate(`window.__lay.top('#post-14')`);
    await stretch(review - 14, { rx: -3, ry: 6, rz: -4 }, [{ at: 6, run: () => cam.evaluate(`window.__shot.cast('Serious Deer', 14, 'whoops', { color: '#ff2bd6', seed: 77 })`) }]);
    /* 3: the Boss's post. */
    await stretch(boss.top - 40, { rx: 3, ry: 4, rz: 5 }, []);
    /* 4: the heap on post 1, built in a rush. */
    const heap = ['whoops-1', 'whoops-2', 'whoops-3', 'steel-chair-3', 'laugh-track', 'jimmy-wails', 'you-were-saying', 'off-day'];
    await stretch(post1 - 14, { rx: -5, ry: -6, rz: -2 }, heap.map((s, k) => ({ at: 4 + 17 * k, run: () => pile(s) })));
    /* 5: the settlement summary, opening on the glass (the story "Boards/12 Log", whose row is closed and opened again): a page of its own, so the stage is left. */
    landed.push({ what: 'cut', frame: r.f });
    await cam.evaluate(`location.href = ${JSON.stringify(`http://localhost:${flag('port', 4319)}/?fixture=boards&story=boards-12-log--open`)}`);
    await cam.until(`Boolean(document.querySelector('.kb-log'))`, { label: 'the log story drawn' });
    /* The row's breakdown is closed and opened again, so the summary is seen opening. */
    const press = (re) => cam.evaluate(`[...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent))?.click()`);
    await r.frames(STRETCH + 2 * FPS, async (i) => {
      if (i === 6) await press('/hide posts/i');
      if (i === 40) await press('/show posts/i');
    });
    await r.end();
    writeFileSync(`${OUT}/c-n11.json`, JSON.stringify({ landed }, null, 2));
    console.log(`c-n11: ${r.f} frames; landed`, landed.map((l) => `${l.what}@${l.frame}`).join(' '), '; errors:', cam.errors);
  } finally {
    await cam.close();
  }
}

const TAKES = {
  'c-n09-wide': () => n09('wide'),
  'c-n09-tight': () => n09('tight'),
  'c-n09-turned': () => n09('turned'),
  'c-n10': n10,
  'c-n11': n11,
};
if (only !== null && !TAKES[only]) throw new Error(`there is no take "${only}": the takes are ${Object.keys(TAKES).join(', ')}`);
for (const [name, take] of Object.entries(TAKES)) if (only === null || only === name) await take();
