/**
 * The commentary video's part three, nodes 9 to 11 (docs/plans/2026-11-21-commentary-video-plan.md, Tasks 7 and 8a; the design, sections 4 and
 * 5a): the full orchestra and the camera's loss of control. Every take is filmed at the camera's native double density (1440 x 810 CSS px at
 * 2x) and written at 2880 x 1620, so the edit's pushes and punches have room.
 *
 *   node tools/hype/shot-commentary-3.mjs [--only c-n09-wide|c-n09-tight|c-n09-turned|c-n11] [--port 4319]
 *
 *   c-n09-wide    "Everything, on one post": the plays of `pile` land on Snuckles's sprite sheet, a play about every 1.4 s, then Stick
 *   c-n09-tight   Around lands and the reader tries to wheel away twice and is held. One script, three framings: wide (the whole post
 *   c-n09-turned  and the glass, level), tight (the post's body fills the frame), and turned (the board a plane in space, turned further
 *                 with each landing and in a full slow spin from 15.8 s to 20.8 s). The three run the SAME script on the SAME
 *                 virtual clock, so frame N is the same moment of the page in all three; every landing's frame is written to c-n09.json.
 *   (c-n10, "The Staff arrive", is retired: the Staff's takes are tools/hype/shot-staff-2.mjs's, each with a real line of the rehearsal's.)
 *   c-n11         "The chords": one take of five stretches of 3.5 s with a hard cut between them: three steel chairs tumbling in and denting (in the Midnight skin, for that stretch alone)
 *                 the body of post 1, filmed tight, the ink-covered
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
/* The skin node 11's first stretch (the chairs) is filmed in: the chairs are pale gray on the default skin's white, so Midnight (dark) is used for that stretch alone (judged on stills: the dents and chairs read on it and not on the white; `--chairs-skin default` films the old way). */
const CHAIRS_SKIN = flag('chairs-skin', 'midnight');

/* The pile's steps are landed in the order the stage names (stage-play.ts's FILM_ORDER, which Stage.test.tsx holds to the rules: every play of it is one a real cast is allowed); a take reads it from the page. */
/** The Rope Break set face down on post 1 catches the first Salty common cast there (as node 3 showed it do): the film springs it before the clock starts, with a real cast, so the plays that follow land as the rules let them. */
const SPRING_ROPE = `window.__shot.cast('D-Guy', 1, 'whoops', { color: '#3d77ff' }).then((c) => { if (!c.caught) throw new Error('the Rope Break did not catch the first Whoops!'); })`;
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
      const spin = framing === 'turned' ? easeInOut((f - SPIN[0]) / (SPIN[1] - SPIN[0])) : 0;
      await cam.evaluate(`window.__film.step(${JSON.stringify(framing)}, ${f}, ${landed.length}, ${f < STICK + 30}, ${spin})`);
      await film.write(await cam.frame(true));
    }
    /* The take claims the reader was held: after the wheel's two tries the hold screen (Stick Around's, with its Break free bar) is on the page. */
    const held = await cam.evaluate(`Boolean(document.querySelector('.kb-hold-foot [role="progressbar"][aria-label="Break free"]'))`);
    if (!held) throw new Error(`${name}: the reader was not held by Stick Around: no hold screen is on the page after the wheel's tries`);
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
    const { chairs, heap } = (await cam.evaluate('window.__shot.pileOrder')).n11;
    const at = (s) => steps.indexOf(s);
    await cam.evaluate(SPRING_ROPE);
    await cam.drawPointer();
    const r = reel(cam, 'c-n11');
    console.log(`c-n11: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    await cam.move(cam.css.width + 40, cam.css.height * 0.4);
    await cam.evaluate('window.__shot.zero()');
    const landed = [];
    const STRETCH = 210; // 3.5 s
    /**
     * A stretch: a hard cut onto `y`, the board turned as given, `play` at its frame, and a slow push in the turn through the stretch.
     * `lead` frames run on the page's clock BEFORE the cut, unfilmed, so the plays are already in the air on the cut's first frame (a play's `at` is
     * then counted from the start of the lead); `tight` is a body's share to hold in the middle of the frame (`fx`, `fy` of the body `lay`) and the scale.
     */
    const stretch = async (y, pose, plays, { lead = 0, tight = null } = {}) => {
      const set = (i, u) => cam.evaluate(`(() => {
        window.__lay.scroll(${y});
        const hud = document.querySelector('.kb-hud-glass'); if (hud) hud.style.display = ${tight ? "'none'" : "''"};
        const k = ${tight ? tight.scale + 0.05 * u : 1.1 + 0.04 * u};
        const aim = ${tight ? `{ x: ${tight.lay.bx + tight.lay.bw * tight.fx}, y: ${tight.lay.by + tight.lay.bh * tight.fy} - scrollY }` : 'null'};
        window.__shot.turn({ scale: k, ...(aim ? { x: -k * (aim.x - innerWidth / 2), y: -k * (aim.y - innerHeight / 2) } : {}), rx: ${pose.rx * (1 + 0.3 * u)}, ry: ${pose.ry * (1 + 0.3 * u)}, rz: ${pose.rz * (1 + 0.3 * u)} });
      })()`);
      for (let i = -lead; i < 0; i++) {
        for (const p of plays) if (p.at === i + lead) await p.run();
        await set(i, 0);
        await cam.frame(false);
      }
      landed.push({ what: 'cut', frame: r.f });
      await r.frames(STRETCH, async (i) => {
        for (const p of plays) if (p.at - lead === i && p.at >= lead) await p.run();
        await set(i, i / STRETCH);
      });
    };
    const pile = (s) => cam.evaluate(`window.__shot.pile(${at(s)})`);

    /* 1: three steel chairs, a few frames apart, tight on the body of Snuckles's first post (Brighter Effects is on, in the stage's costume): the throw, the dent and the chairs' fall. A chair takes about 1.2 s from its play to be seen, so the page runs 65 frames before the cut, unfilmed, and the first filmed frame has the first chair arriving; its dents then have the rest of the 3.5 s. */
    if (CHAIRS_SKIN !== 'default') { await cam.evaluate(`window.__shot.skin(${JSON.stringify(CHAIRS_SKIN)})`); await settle(cam, 20); }
    const post1 = await cam.evaluate(`window.__lay.top('#post-1')`);
    const lay1 = await cam.evaluate(`(() => { const b = document.querySelector('#post-1 .kb-act-main'); const abs = (e) => { let x = 0, y = 0; for (; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return { x, y }; }; const q = abs(b); return { bx: q.x, by: q.y, bw: b.offsetWidth, bh: b.offsetHeight }; })()`);
    await stretch(lay1.by - 140, { rx: 4, ry: -9, rz: 1 }, chairs.map((s, k) => ({ at: 7 * k, run: () => pile(s) })), { lead: 65, tight: { lay: lay1, fx: 0.6, fy: 0.45, scale: 1.7 } });
    if (CHAIRS_SKIN !== 'default') { await cam.evaluate(`window.__shot.skin('default')`); await settle(cam, 20); }
    /* 2: the ink-covered review: Whoops! lands on D-Guy's review, and rides in on 4D Chess's face-down move. */
    const review = await cam.evaluate(`window.__lay.top('#post-14')`);
    await stretch(review - 14, { rx: -3, ry: 6, rz: -4 }, [{ at: 6, run: () => cam.evaluate(`window.__shot.cast('Serious Deer', 14, 'whoops', { color: '#ff2bd6', seed: 77 })`) }]);
    /* 3: the Boss's post. */
    await stretch(boss.top - 40, { rx: 3, ry: 4, rz: 5 }, []);
    /* 4: the heap on post 1, built in a rush. */
    await stretch((await cam.evaluate(`window.__lay.top('#post-1')`)) - 14, { rx: -5, ry: -6, rz: -2 }, heap.map((s, k) => ({ at: 4 + 17 * k, run: () => pile(s) })));
    /* 5: the settlement summary, opening on the glass (the story "Boards/12 Log", whose row is closed and opened again): a page of its own, so the stage is left. */
    landed.push({ what: 'cut', frame: r.f });
    await cam.evaluate(`location.href = ${JSON.stringify(`http://localhost:${flag('port', 4319)}/?fixture=boards&story=boards-12-log--open`)}`);
    await cam.until(`Boolean(document.querySelector('.kb-log'))`, { label: 'the log story drawn' });
    /* The row's breakdown is closed and opened again, so the summary is seen opening. */
    /* A button that is not there is a take that does not show what the film claims: it throws. */
    const press = async (re) => {
      const found = await cam.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
      if (!found) throw new Error(`the log has no button matching ${re}: its buttons are ${await cam.evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).join(' | ')`)}`);
    };
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
  'c-n11': n11,
};
if (only !== null && !TAKES[only]) throw new Error(`there is no take "${only}": the takes are ${Object.keys(TAKES).join(', ')}`);
for (const [name, take] of Object.entries(TAKES)) if (only === null || only === name) await take();
