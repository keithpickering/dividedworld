/**
 * The commentary video's part three, node 9 (docs/plans/2026-11-21-commentary-video-plan.md, Task 7; the design, sections 4, 5a and 10): the full
 * orchestra and the camera's loss of control. Every take is filmed at the camera's native double density (1440 x 810 CSS px at
 * 2x) and written at 2880 x 1620, so the edit's pushes and punches have room.
 *
 *   node tools/hype/shot-commentary-3.mjs [--only c-n09-wide|c-n09-tight|c-n09-turned] [--port 4319]
 *
 *   c-n09-wide    "Everything, on one post": the plays of `pile` land on Snuckles's sprite sheet, a play about every 1.1 s (so something lands in
 *   c-n09-tight   nearly every second), then Stick Around lands and the reader tries to wheel away twice and is held. One script, three framings:
 *   c-n09-turned  wide (the whole post and the glass, level), tight (the post's body fills the frame), and turned (the board a plane in space,
 *                 swung further with each landing and, from 9 s to 10.6 s, a fast partial spin that returns: no axis passes about 70 degrees,
 *                 so the board never shows its back or goes edge-on). The three run the SAME script on the SAME virtual clock, so frame N is
 *                 the same moment of the page in all three; every landing's frame is written to c-n09.json.
 *   (c-n10, "The Staff arrive", is retired: the Staff's takes are tools/hype/shot-staff-2.mjs's, each with a real line of the rehearsal's.
 *    c-n11, "The chords", is retired too: the coda is now cut from other takes and ends on a title, so its function is removed.)
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

/* The pile's steps are landed in the order the stage names (stage-play.ts's FILM_ORDER, which Stage.test.tsx holds to the rules: every play of it is one a real cast is allowed); a take reads it from the page. */
/** The Rope Break set face down on post 1 catches the first Salty common cast there (as node 3 showed it do): the film springs it before the clock starts, with a real cast, so the plays that follow land as the rules let them. */
const SPRING_ROPE = `window.__shot.cast('D-Guy', 1, 'whoops', { color: '#3d77ff' }).then((c) => { if (!c.caught) throw new Error('the Rope Break did not catch the first Whoops!'); })`;
const LEAD = 45, GAP = 66; // three quarters of a second of lead-in, then a play every 1.1 s (the earlier cut's 1.4 s left a static ink blob between landings)
/* Stick Around lands three seconds after Hot Box (the last of the eleven, at 12 s): the page holds the reader on a screen of its own about 1.5 s after it lands, and that screen is the game's, so what the camera has to show of the heap comes first. */
const STICK = 15 * FPS;
const N9 = Math.round(24 * FPS); // the node 9 takes: 24 s, with the hold screen on for the last of them
/* The turned take's fast partial spin, in frames: it leaves level, swings to about 46 degrees about the vertical and comes back, 1.6 s in all, well before Stick Around lands (once it holds the page its screen is the game's own and does not turn). */
const SPIN = [Math.round(9 * FPS), Math.round(10.6 * FPS)];
const TRIES = [Math.round(17.4 * FPS), Math.round(18.9 * FPS)]; // the frames of the reader's two tries at wheeling away
/** 0 outside [0, 1], and inside a smooth bump up to 1 and back to 0: the partial spin that returns. */
const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);

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
      /* turned: a few degrees off to begin with, swung further with each landing, and one fast partial spin that returns (spin is 0 to 1 and back). Each axis is clamped well short of edge-on and of the board's back. */
      amp += (landings / 12 - amp) * 0.06;
      const t = f / 60;
      const tau = Math.PI * 2;
      const lim = (v, m) => Math.max(-m, Math.min(m, v));
      const ry = lim((5 + 18 * amp) * Math.sin(tau * t / 4.3 + 0.9) + 46 * spin, 66);
      const rx = lim(3 + 10 * amp * Math.sin(tau * t / 6.1 + 0.3), 15);
      const rz = lim(1 + 4 * amp + 6 * amp * Math.sin(tau * t / 9), 12);
      window.__film.worst = Math.max(window.__film.worst ?? 0, Math.abs(rx), Math.abs(ry), Math.abs(rz));
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
    const ORDER = (await cam.evaluate('window.__shot.pileOrder')).n09;
    for (const s of ORDER) if (!steps.includes(s)) throw new Error(`the pile has no step ${s}: it has ${steps.join(', ')}`);
    await cam.evaluate(SPRING_ROPE);
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
      const spin = framing === 'turned' ? bump((f - SPIN[0]) / (SPIN[1] - SPIN[0])) : 0;
      await cam.evaluate(`window.__film.step(${JSON.stringify(framing)}, ${f}, ${landed.length}, ${f < STICK + 30}, ${spin})`);
      await film.write(await cam.frame(true));
    }
    /* The take claims the reader was held: after the wheel's two tries the hold screen (Stick Around's, with its Break free bar) is on the page. */
    const held = await cam.evaluate(`Boolean(document.querySelector('.kb-hold-foot [role="progressbar"][aria-label="Break free"]'))`);
    if (!held) throw new Error(`${name}: the reader was not held by Stick Around: no hold screen is on the page after the wheel's tries`);
    if (framing === 'turned') {
      const worst = await cam.evaluate(`window.__film.worst`);
      if (!(worst <= 70)) throw new Error(`${name}: the board turned ${worst} degrees on one axis, past about 70: it would show its back or go edge-on`);
      console.log(`${name}: the board's largest turn on any axis was ${worst.toFixed(1)} degrees`);
    }
    await film.end();
    const out = { landed, tries: TRIES, spin: SPIN };
    writeFileSync(`${OUT}/c-n09.json`, JSON.stringify(out, null, 2));
    console.log(`${name}: ${N9} frames; landed`, landed.map((l) => `${l.what}@${l.frame}`).join(' '), '; errors:', cam.errors);
  } finally {
    await cam.close();
  }
}

const TAKES = {
  'c-n09-wide': () => n09('wide'),
  'c-n09-tight': () => n09('tight'),
  'c-n09-turned': () => n09('turned'),
};
if (only !== null && !TAKES[only]) throw new Error(`there is no take "${only}": the takes are ${Object.keys(TAKES).join(', ')}`);
for (const [name, take] of Object.entries(TAKES)) if (only === null || only === name) await take();
