/**
 * The tour of the game's own interface, for narration v07 to v09 (docs/plans/2026-11-21-commentary-video-revision-design.md, section 11, beats 6 to 8):
 * the class carousel, the Aura bar filling, the Vending Machine, a booster pack, the hand and a card played, and a quick run of post effects. These are
 * the game's "glass" (its out-of-character screens, dark and smoky, which a skin does not change) and the board where a post is in frame (`fan-site`).
 * Every take is driven by the page's real pointer on the stage (instances/divided-world/ui/hype/Stage.board.stories.tsx), signed in as Snuckles's player,
 * so the cast and the HUD are the film's. Desktop viewport (1440 x 810 CSS px) at 2x, written at 2880 x 1620, unless a take says otherwise.
 *
 *   node tools/hype/shot-v4-tour.mjs [--only g-classes|g-aura|g-vending|g-pack|g-hand|g-play|g-fx-rainbow|g-fx-chair|g-fx-ink|g-fx-tape|g-fx-smoke|g-fx-glitter|g-fx-graffiti] [--port 4319]
 *
 *   g-classes   v07, 11 s: the new-character screen, the pointer choosing Face, Heel, Jabroni, Technician, Tweener and Lurker as he names them, then My characters (2 of 6).
 *   g-aura      v08, 6 s: the Aura bar's settlement cascade, one orb after another, then the mask swapped by the keyboard with the wallet unchanged.
 *   g-vending   v09, 3.5 s: the Vending Machine, a card picked and bought, the price leaving the orbs.
 *   g-pack      v09, 5 s: a Booster bought and torn open, its cards turned.
 *   g-hand      v09, 3 s: the hand fanned open, the pointer crossing it, a card lifted.
 *   g-play      v09, 5 s: a card chosen in the hand, armed, a post pressed, the form, Play, and the card landing on the post.
 *   g-fx-*      2 s each: a post effect landing on a post's body (Fan Site).
 *
 * Nothing waits on the wall clock once a film starts: every wait is a count of frames of the page's virtual clock, or a condition. Each take writes
 * .runs/hype/<take>.mp4 and <take>.json ({ landed: [{ what, frame }] }, frames at 60 a second), and throws if the page does not show what the film claims.
 */
import { writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { reach } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const FPS = 60;
const only = flag('only', null);
const port = Number(flag('port', 4322));

/** A page expression for the middle of the first element `find` names (an expression), or null. */
const centerOf = (find, fx = 0.5, fy = 0.5) => `(() => { const e = ${find}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy}, w: r.width, h: r.height }; })()`;
/** The button whose label (aria-label, else its words) starts with `name`, among those with a box. */
const button = (name) => `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent).trim().startsWith(${JSON.stringify(name)}) && b.getBoundingClientRect().width > 0)`;
const fail = (msg) => { throw new Error(msg); };

/**
 * Starts the film of a take: the clocks are made one, and from here a frame is `shoot`ed, a pointer `go`es to a place, `click`s, and a beat is `mark`ed.
 * `end(seconds)` pads the take with still frames to its length and writes the file and its json.
 */
async function begin(cam, name, extra = {}) {
  const w = cam.css.width * cam.scale, h = cam.css.height * cam.scale;
  const film = openFilm({ path: `${OUT}/${name}.mp4`, fps: FPS, out: { width: w, height: h }, preset: 'medium' });
  console.log(`${name}: the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
  let f = 0, at = extra.from ?? { x: cam.css.width * 0.62, y: cam.css.height * 0.9 };
  const landed = [];
  await cam.move(at.x, at.y);
  const t = {
    cam, landed, get frame() { return f; }, get seconds() { return f / FPS; }, get at() { return at; },
    /** One frame of the film. */
    async step() { await film.write(await cam.frame(true)); f++; },
    async shoot(seconds) { for (let i = 0, n = Math.round(seconds * FPS); i < n; i++) await t.step(); },
    /** Frames until the take is `seconds` in. */
    async until(seconds) { while (f < Math.round(seconds * FPS)) await t.step(); },
    /** The pointer reaches `to` (a point, or a page expression for one, read as it sets off) in `seconds`. */
    async go(to, seconds, { seed = 1, settle: s = true } = {}) {
      const dest = typeof to === 'string' ? await cam.evaluate(to) : to;
      if (!dest) fail(`${name}: nothing on the page to go to: ${to}`);
      const path = reach(at, dest, seconds, { seed, settle: s });
      for (let i = 1, n = Math.max(1, Math.round(seconds * FPS)); i <= n; i++) { const p = path.at(Math.min(seconds, i / FPS)); await cam.move(p.x, p.y); await t.step(); }
      at = { x: dest.x, y: dest.y };
    },
    /** A beat of the take, at this frame. */
    mark(what) { landed.push({ what, frame: f }); console.log(`${name}: ${what} at frame ${f}`); },
    /** A press: down for `hold` seconds, then up; the beat is marked as it goes down. */
    async click(what, hold = 0.07) { if (what) t.mark(what); await cam.press(); await t.shoot(hold); await cam.release(); },
    /** The page's answer, waited for in frames of its own clock: `expression` is true within `limit` seconds, else the take throws with `label`. */
    async holds(expression, label, limit = 3) {
      for (let i = 0; i <= limit * FPS; i++) { if (await cam.evaluate(expression)) return; await t.step(); }
      fail(`${name}: the page never showed ${label}\n${cam.errors.join('\n')}`);
    },
    async end(seconds, json = {}) {
      await t.until(Math.round(seconds * FPS) / FPS);
      await film.end();
      writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ landed, frames: f, seconds: f / FPS, ...extra.json, ...json }, null, 2)}\n`);
      console.log(`${name}: ${f} frames (${(f / FPS).toFixed(2)} s) written; landed`, landed.map((l) => `${l.what}@${l.frame}`).join(' '), 'errors:', cam.errors);
    },
  };
  return t;
}

/** A small scroll by the wheel, spread over `frames` frames, from the pointer's place. */
async function wheelBy(t, dy, frames) {
  let sent = 0;
  for (let i = 1; i <= frames; i++) {
    const u = i / frames, want = Math.round(dy * (u * u * (3 - 2 * u))), step = want - sent;
    if (step !== 0) { await t.cam.wheel(step); sent = want; }
    await t.step();
  }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

const CLASSES = ['Face', 'Heel', 'Jabroni', 'Technician', 'Tweener', 'Lurker'];

/** v07: "These are the six classes: Face, Heel, Jabroni, Technician, Tweener, and Lurker. You get six characters, so you can try all of them if you want." */
async function classes() {
  const cam = await openStage({ skin: 'fan-site', view: 'glass:new-character', quiet: ['toasts', 'host', 'hud'], port });
  try {
    await settle(cam, 60);
    await cam.drawPointer();
    const card = (c) => `document.querySelector('label[data-kb-class="${c.toLowerCase()}"]')`;
    const names = await cam.evaluate(`[...document.querySelectorAll('label[data-kb-class] .kb-class-name')].map((e) => e.textContent.trim())`);
    if (names.join() !== CLASSES.join()) fail(`the carousel's classes are ${names.join(', ')}, not ${CLASSES.join(', ')}`);
    const t = await begin(cam, 'g-classes');
    /* The page opens at its top; a lazy scroll brings the carousel up, and the pointer arrives at the first card. */
    await wheelBy(t, 300, 70);
    /* Each class is chosen as it is named: the cue's second, the press a moment before it lands. */
    const CUES = [2.6, 3.3, 4.0, 4.9, 5.9, 6.9];
    for (const [i, c] of CLASSES.entries()) {
      const to = centerOf(card(c), 0.5, 0.18);
      await t.go(to, Math.max(0.25, Math.min(0.55, CUES[i] - 0.1 - t.seconds)), { seed: 10 + i });
      await t.until(CUES[i] - 0.06);
      await t.click(`class-${c.toLowerCase()}`);
      await t.shoot(0.12);
      /* The card is chosen and whole in the row's window as it is named. */
      const seen = await cam.evaluate(`(() => { const e = ${card(c)}; const r = e.getBoundingClientRect(), row = e.parentElement.getBoundingClientRect(); return { chosen: e.hasAttribute('data-kb-chosen'), name: e.querySelector('.kb-class-name').textContent.trim(), whole: r.left >= row.left - 1 && r.right <= row.right + 1 && r.width > 0 }; })()`);
      if (!seen.chosen || seen.name !== c) fail(`g-classes: ${c} was not chosen: ${JSON.stringify(seen)}`);
      await t.holds(`(() => { const e = ${card(c)}; const r = e.getBoundingClientRect(), row = e.parentElement.getBoundingClientRect(); return r.left >= row.left - 1 && r.right <= row.right + 1; })()`, `${c} whole in the carousel`, 1.2);
    }
    /* "You get six characters": the pointer goes to My characters, which says how many of six are used. */
    await t.go(centerOf(`[...document.querySelectorAll('a')].find((a) => /my characters/i.test(a.textContent) && a.getBoundingClientRect().width > 0)`), 0.5, { seed: 31 });
    await t.until(7.9);
    await t.click('my-characters');
    await t.holds(`/2 of 6/i.test(document.querySelector('main h1, h1')?.parentElement?.textContent ?? document.body.textContent)`, 'Your characters (2 of 6)', 2);
    t.mark('six');
    await t.end(11);
  } finally { await cam.close(); }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------------------------------------------------------------ */

/** The Aura figure the HUD shows now (the wallet), in hundredths, and the name on its mask. */
const HUD = `(() => { const g = document.querySelector('.kb-hud-glass'); const m = /(\\d+\\.\\d\\d)\\s*\\/\\s*\\d+\\.\\d\\d/.exec(g.innerText); const sel = g.querySelector('select'); return { aura: m ? Math.round(Number(m[1]) * 100) : null, mask: sel ? sel.options[sel.selectedIndex].text : null, filled: g.querySelectorAll('.kb-orb-fill, [class*="orb"][data-kb-fill]').length }; })()`;

/** v08: "They all share the same aura, so you can farm reactions as one class to power up another class." */
async function aura() {
  /* At 3x so the edit can crop in on the HUD (the declared move) and stay sharp. */
  const cam = await openStage({ skin: 'fan-site', css: { width: 1440, height: 810 }, scale: 3, port });
  try {
    await cam.evaluate(`(() => { document.querySelector('#post-' + window.__kbStage.posts.heel).scrollIntoView({ block: 'center' }); })()`);
    await settle(cam, 60);
    await cam.drawPointer();
    const before = await cam.evaluate(HUD);
    /* A settlement has moved the wallet by 2.00 while this device last saw 2.40: when the player is read again the orbs run the cascade from what was last seen. */
    await cam.evaluate(`(() => { const { fake, viewer } = window.__kbStage; fake.seed.settle({ wallet: { [viewer]: ${before.aura + 200} } }); })()`);
    const t = await begin(cam, 'g-aura', { from: { x: 760, y: 520 } });
    await cam.evaluate('window.__shot.zero()');
    await t.shoot(0.3);
    t.mark('settlement');
    await cam.evaluate('window.__kbStage.refreshPlayer()');
    await t.holds(`${HUD}.aura === ${before.aura + 200}`, `the wallet at ${(before.aura + 200) / 100}`, 2);
    const risen = await cam.evaluate(HUD);
    if (!(risen.aura > before.aura)) fail(`g-aura: the Aura did not rise: ${before.aura} then ${risen.aura}`);
    /* The cascade is one orb a second: the pointer rests by the mask select meanwhile. */
    const sel = centerOf(`document.querySelector('.kb-hud-glass select')`);
    await t.go(sel, 1.0, { seed: 41 });
    t.mark('cascade');
    await t.until(3.6);
    /* The mask is swapped by the keyboard, on the focused select. */
    await cam.evaluate(`document.querySelector('.kb-hud-glass select').focus()`);
    await t.shoot(0.15);
    const was = (await cam.evaluate(HUD)).mask;
    cam.key('ArrowUp');
    t.mark('swap');
    await t.holds(`${HUD}.mask !== ${JSON.stringify(was)}`, 'the mask swapped', 1);
    await t.shoot(0.4);
    const after = await cam.evaluate(HUD);
    if (after.aura !== risen.aura) fail(`g-aura: the Aura changed with the mask: ${risen.aura} then ${after.aura}`);
    console.log(`g-aura: ${before.aura} -> ${risen.aura} as ${was}; as ${after.mask} still ${after.aura}`);
    /* The HUD's own region of the frame, for the edit to crop to (a share of the frame: x, y, w). */
    await t.end(6, { move: { from: { x: 0.035, y: 0.38, w: 0.62, roll: 0 }, to: { x: 0.035, y: 0.38, w: 0.62, roll: 0 }, ease: 'linear' }, wallet: { before: before.aura, risen: risen.aura, afterSwap: after.aura, masks: [was, after.mask] } });
  } finally { await cam.close(); }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

/** The slot's button for the card `name` on the Vending Machine, and the machine's own Buy button ("Buy Steel Chair · 1.00"). */
const slotOf = (name) => `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(`Buy ${name},`)}) && b.getBoundingClientRect().width > 0)`;
const BUY = `[...document.querySelectorAll('button')].find((b) => /^Buy .+ · \\d/.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0)`;
const HAND = `Number(/Hand, (\\d+) postcards?/.exec(document.querySelector('.kb-hud-hand')?.getAttribute('aria-label') ?? document.querySelector('.kb-hud-hand')?.textContent ?? '')?.[1])`;

/** v09 (the first of its four): the Vending Machine, a card picked and bought, the price leaving the orbs. */
async function vending() {
  const cam = await openStage({ skin: 'fan-site', view: 'glass:vending', port });
  try {
    await settle(cam, 60);
    /* The machine's slots, price display and Buy button are in view above the HUD before the film starts. */
    await cam.evaluate(`(() => { const e = ${slotOf('Steel Chair')}; const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 230); })()`);
    await settle(cam, 30);
    await cam.drawPointer();
    const cardsBefore = await cam.evaluate(HAND);
    const auraBefore = (await cam.evaluate(HUD)).aura;
    const t = await begin(cam, 'g-vending', { from: { x: 1000, y: 500 } });
    await t.go(centerOf(slotOf('Steel Chair')), 0.45, { seed: 51 });
    await t.click('pick');
    await t.holds(`/Selected: [A-Z]\\d, Steel Chair/.test(document.body.innerText)`, 'the Steel Chair selected', 1);
    await t.go(centerOf(BUY), 0.5, { seed: 52 });
    await t.shoot(0.1);
    await t.click('buy');
    await t.holds(`${HAND} === ${cardsBefore + 1}`, 'the hand one card fuller', 2);
    await t.holds(`${HUD}.aura === ${auraBefore - 100}`, `the orbs ${auraBefore / 100} down to ${(auraBefore - 100) / 100}`, 2);
    t.mark('paid');
    console.log(`g-vending: aura ${auraBefore} -> ${(await cam.evaluate(HUD)).aura}, hand ${cardsBefore} -> ${await cam.evaluate(HAND)}`);
    await t.end(3.5);
  } finally { await cam.close(); }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

const TURN = `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent).trim() === 'Turn the next card' && b.getBoundingClientRect().width > 0)`;

/** v09: a booster pack torn open, the cards turning. The take starts as the tear begins: the Booster is already selected, and the pointer is by its Buy button. */
async function pack() {
  const cam = await openStage({ skin: 'fan-site', view: 'glass:vending', port });
  try {
    await settle(cam, 60);
    /* The wallet is the Booster's price and more (3.00): a settlement this device has already seen, so the HUD runs no cascade over the take. */
    await cam.evaluate(`(() => { const { fake, viewer } = window.__kbStage; fake.seed.settle({ wallet: { [viewer]: 600 } }); localStorage.setItem('kb-wallet-seen:' + viewer, '600'); return window.__kbStage.refreshPlayer(); })()`);
    await cam.until(`${HUD}.aura === 600`, { label: 'the wallet read again' });
    await cam.evaluate(`(() => { const b = ${slotOf('Booster')}; window.scrollBy(0, b.getBoundingClientRect().top - 260); b.click(); })()`);
    await cam.until(`Boolean(${BUY})`, { label: 'the Booster selected' });
    /* The Buy button is brought clear of the HUD, where the pointer can press it. */
    await cam.evaluate(`window.scrollBy(0, ${BUY}.getBoundingClientRect().top - 300)`);
    await settle(cam, 30);
    await cam.drawPointer();
    const cardsBefore = await cam.evaluate(HAND);
    const buy = await cam.evaluate(centerOf(BUY));
    const t = await begin(cam, 'g-pack', { from: { x: buy.x + 120, y: buy.y + 90 } });
    await t.go(buy, 0.35, { seed: 61 });
    await t.click('tear');
    /* The pack opens by itself: its first card is there to turn. */
    await t.holds(`Boolean(${TURN})`, 'the pack opened (a card to turn)', 9);
    t.mark('opened');
    /* The cards are dealt out by the pack's own motion (about two seconds), and the pointer waits at the first, a hand's pace. */
    /* The pointer sets off toward the button and reads where it stands again as it arrives: the dealt cards are still sliding into place under it. */
    await t.holds(`(${centerOf(TURN)}).y < ${cam.css.height - 60}`, 'the Turn button in view', 6);
    t.mark('dealt');
    await t.go(centerOf(TURN), 0.5, { seed: 62 });
    for (let i = 0, last = null; ; i++) {
      const now = await cam.evaluate(centerOf(TURN));
      if (last && Math.abs(now.y - last.y) < 0.5 && Math.abs(now.x - last.x) < 0.5) break;
      if (i > 240) fail('g-pack: the Turn button never came to rest');
      last = now;
      await t.shoot(0.05);
    }
    await t.go(centerOf(TURN), 0.25, { seed: 63, settle: false });
    for (let n = 1; n <= 5; n++) {
      await t.click(`turn-${n}`);
      try { await t.holds(`new RegExp('${n} of 5', 'i').test(document.body.innerText)`, `${n} of 5 cards turned`, 1.5); } catch (e) { writeFileSync('.runs/hype/stills/pack-debug.jpg', await cam.frame(true)); console.log(JSON.stringify(await cam.evaluate(centerOf(TURN))), JSON.stringify(t.at), JSON.stringify(await cam.evaluate('(() => { const e = [...document.querySelectorAll("button")].filter((b) => /turn/i.test(b.textContent)); return e.map((b) => [b.textContent.trim(), JSON.stringify(b.getBoundingClientRect())]); })()'))); throw e; }
      await t.shoot(n === 5 ? 0.5 : 0.12);
    }
    if (await cam.evaluate(`Boolean(${TURN})`)) fail('g-pack: a card is left to turn');
    const cardsAfter = await cam.evaluate(HAND);
    if (cardsAfter !== cardsBefore + 5) fail(`g-pack: the hand holds ${cardsAfter}, not ${cardsBefore + 5}`);
    console.log(`g-pack: hand ${cardsBefore} -> ${cardsAfter}, aura ${(await cam.evaluate(HUD)).aura}`);
    await t.end(5);
  } finally { await cam.close(); }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

/** The cards of the open hand (buttons labelled "<name>, <class>, <kind>. …postcard"), each with its box. */
const CARDS = `[...document.querySelectorAll('button.kb-postcard')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { name: (b.getAttribute('aria-label') ?? b.textContent).trim(), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top }; })`;
/** Where to point at the hand's card `name`: the nearest place to its upper middle where it is the card on top (the cards overlap). A page expression for the point, or null. */
const spotOn = (name) => `(() => {
  const b = [...document.querySelectorAll('button.kb-postcard')].find((e) => (e.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(name)}) && e.getBoundingClientRect().width > 0);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  let best = null;
  for (let fy = 0.03; fy < 0.97; fy += 0.03) for (let fx = 0.03; fx < 0.97; fx += 0.03) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (document.elementFromPoint(x, y)?.closest('button') !== b) continue;
    const d = Math.hypot(fx - 0.5, fy - 0.3);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
})()`;
/** The post's number in the thread, put in the middle of the window (done before a film starts), and the HUD's Hand button. */
const scrollTo = (seq) => `document.querySelector('#post-${seq}').scrollIntoView({ block: 'center' })`;
const HAND_BUTTON = `document.querySelector('.kb-hud-hand')`;
const OPEN = `document.querySelectorAll('button.kb-postcard').length > 10`;

/** v09: the hand fanned open, the pointer crossing it, a card lifted. */
async function hand() {
  const cam = await openStage({ skin: 'fan-site', port });
  try {
    await settle(cam, 60);
    await cam.evaluate(scrollTo(await cam.evaluate('window.__kbStage.posts.kind2')));
    await settle(cam, 40);
    await cam.drawPointer();
    const btn = await cam.evaluate(centerOf(HAND_BUTTON));
    const t = await begin(cam, 'g-hand', { from: { x: btn.x - 190, y: btn.y - 160 } });
    await t.go(btn, 0.3, { seed: 71 });
    await t.click('open');
    await t.holds(OPEN, 'the hand open', 3);
    const cards = await cam.evaluate(CARDS);
    if (cards.length < 10) fail(`g-hand: the open hand shows ${cards.length} cards`);
    t.mark('fanned');
    /* The front row, crossed from the right by one pass, each card standing up as it is crossed; it ends on Whoops!, which is lifted. */
    const mid = (Math.min(...cards.map((c) => c.y)) + Math.max(...cards.map((c) => c.y))) / 2;
    const row = cards.filter((c) => c.y >= mid).sort((a, b) => b.x - a.x);
    const from = { x: row[0].x, y: row[0].y - 30 };
    await t.go(from, 0.35, { seed: 72, settle: false });
    t.mark('cross');
    const spot = await cam.evaluate(spotOn('Whoops!'));
    if (!spot) fail('g-hand: no part of Whoops! shows in the open hand');
    const topBefore = (await cam.evaluate(CARDS)).find((c) => c.name.startsWith('Whoops!')).top;
    await t.go(spot, 0.9, { seed: 73 });
    /* The fan moves under the pointer as each card it crosses stands up: the hand reads where Whoops! is now, and corrects. */
    for (let tries = 0; tries < 5; tries++) {
      const here = await cam.evaluate(`document.elementFromPoint(${t.at.x}, ${t.at.y})?.closest('button')?.getAttribute('aria-label') ?? ''`);
      if (here.startsWith('Whoops!')) break;
      await t.go(spotOn('Whoops!'), 0.2, { seed: 74 + tries, settle: false });
    }
    await t.shoot(0.2);
    /* The card under the pointer is Whoops!, and it has stood up. */
    const under = await cam.evaluate(`document.elementFromPoint(${t.at.x}, ${t.at.y})?.closest('button')?.getAttribute('aria-label') ?? null`);
    const lifted = (await cam.evaluate(CARDS)).find((c) => c.name.startsWith('Whoops!')).top;
    if (!under?.startsWith('Whoops!') || !(lifted < topBefore - 4)) fail(`g-hand: Whoops! is not standing up under the pointer (under it: ${under}; its top ${topBefore} then ${lifted})`);
    t.mark('lifted');
    console.log(`g-hand: ${cards.length} cards; Whoops! stood up ${(topBefore - lifted).toFixed(0)} px`);
    await t.end(3);
  } finally { await cam.close(); }
}

/** v09: "the process of selecting and playing a card": the hand, Feelin' Fab armed, the posts it can land on lit, a post pressed, the form, Play, and the rainbow landing. */
async function play() {
  const cam = await openStage({ skin: 'fan-site', port });
  try {
    await settle(cam, 60);
    const seq = await cam.evaluate('window.__kbStage.posts.heel');
    await cam.evaluate(scrollTo(seq));
    await settle(cam, 40);
    await cam.drawPointer();
    const rainbows = (n) => `Number(/Feelin' Fab, (\\d+) plays?/.exec([...document.querySelectorAll('#post-${n} button')].map((b) => b.getAttribute('aria-label') ?? '').join('|'))?.[1] ?? 0)`;
    const before = await cam.evaluate(rainbows(seq));
    const btn = await cam.evaluate(centerOf(HAND_BUTTON));
    const t = await begin(cam, 'g-play', { from: { x: btn.x - 160, y: btn.y - 120 } });
    await t.go(btn, 0.25, { seed: 81 });
    await t.click('hand');
    await t.holds(OPEN, 'the hand open', 3);
    /* The card is pointed at where it is on top, and pressed: armed, the hand is put away and the posts it can land on show their marks. */
    await t.holds(`Boolean(${spotOn("Feelin' Fab, Sweet")})`, "Feelin' Fab showing in the fan", 2);
    await t.go(spotOn("Feelin' Fab, Sweet"), 0.4, { seed: 82 });
    for (let tries = 0; tries < 5; tries++) {
      const here = await cam.evaluate(`document.elementFromPoint(${t.at.x}, ${t.at.y})?.closest('button')?.getAttribute('aria-label') ?? ''`);
      if (here.startsWith("Feelin' Fab, Sweet")) break;
      await t.go(spotOn("Feelin' Fab, Sweet"), 0.2, { seed: 85 + tries, settle: false });
    }
    await t.click('arm');
    await t.holds(`Boolean(document.querySelector('#post-${seq} button[aria-label="Play Feelin\\' Fab on post ${seq}"]'))`, 'the post marked to play on', 2);
    t.mark('lit');
    await t.go(centerOf(`document.querySelector('#post-${seq} button[aria-label="Play Feelin\\' Fab on post ${seq}"]')`), 0.5, { seed: 83 });
    await t.click('post');
    await t.holds(`Boolean(document.querySelector('.kb-play-dialog'))`, 'the play form', 2);
    t.mark('form');
    await t.go(centerOf(`[...document.querySelectorAll('.kb-play-dialog button')].find((b) => /^Play as/.test(b.textContent.trim()))`), 0.5, { seed: 84 });
    await t.click('play');
    await t.holds(`!document.querySelector('.kb-play-dialog') && ${rainbows(seq)} === ${before + 1}`, `the rainbow landed on post ${seq} (${before + 1} Feelin' Fab)`, 3);
    t.mark('landed');
    console.log(`g-play: Feelin' Fab on post ${seq}: ${before} -> ${await cam.evaluate(rainbows(seq))}`);
    await t.end(5);
  } finally { await cam.close(); }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

/** How many plays of the card `name` the post `seq` shows (the labels of its stack buttons: "Feelin' Fab, 2 plays, 2 of 3 stacked. …"). */
const playsOf = (seq, name) => `(() => { const esc = ${JSON.stringify(name)}.replace(/[.*+?^$()|[\\]\\\\{}]/g, '\\\\$&'); const re = new RegExp('^' + esc + ', (\\\\d+) plays?'); let n = 0; for (const b of document.querySelectorAll('#post-${seq} button')) { const m = re.exec(b.getAttribute('aria-label') ?? ''); if (m) n += Number(m[1]); } return n; })()`;

/**
 * One post effect, 2 s, tight on a post's body (a small CSS viewport at a high density, the HUD quiet): the card is cast on the post through the stage's real
 * play path (`__shot.cast`) at `at` seconds, the page is read to show the post carries one more play of it, and `hand(t, post)` is the pointer's part.
 * `casts` is [{ at, by, card, name, config, message }]: the card's key, its name on the post's stack, and who plays it.
 * @param {string} id
 * @param {{ post: string, casts: any[], run?: { at: number, js: string, mark: string }[], prep?: string, css?: { width: number, height: number }, skin?: string, seconds?: number, top?: number, check?: (cam: any, seq: number) => Promise<void>, hand?: (t: any, seq: number, cam: any) => Promise<void> }} spec
 */
async function effect(id, { post, casts, run = [], prep, css = { width: 640, height: 360 }, skin = 'fan-site', seconds = 2, top = 40, check, hand }) {
  const cam = await openStage({ skin, css, scale: 2880 / css.width, port, quiet: ['toasts', 'host', 'hud'] });
  try {
    const seq = await cam.evaluate(`window.__kbStage.posts.${post}`);
    await cam.evaluate(`(() => { const p = document.querySelector('#post-${seq}'); p.scrollIntoView({ block: 'center' }); const r = p.querySelector('.kb-act-main').getBoundingClientRect(); scrollBy(0, r.top - ${top}); })()`);
    if (prep && !flag('noprep', null)) await cam.evaluate(prep);
    await settle(cam, 60);
    await cam.drawPointer();
    const before = {};
    for (const c of casts) before[c.name] = await cam.evaluate(playsOf(seq, c.name));
    const t = await begin(cam, id, { from: { x: css.width + 30, y: css.height * 0.75 } });
    await cam.evaluate('window.__shot.zero()');
    let n = 0;
    for (const c of casts) {
      await t.until(c.at);
      /* The play is made on the page's own clock: frames are filmed until the backend has answered it. */
      /** @type {any} */
      let done = null;
      const asked = cam.evaluate(`window.__shot.cast(${JSON.stringify(c.by)}, ${seq}, ${JSON.stringify(c.card)}, ${JSON.stringify(c.config ?? {})}, ${JSON.stringify(c.message ?? '')}).then((r) => ({ ok: true, caught: r.caught }), (e) => ({ ok: false, error: String(e.message ?? e) }))`).then((r) => { done = r; });
      for (let i = 0; i < 120 && !done; i++) await t.step();
      await asked;
      if (!done?.ok) fail(`${id}: the cast of ${c.card} was refused: ${done?.error}`);
      t.mark(c.mark ?? `land-${++n}`);
    }
    for (const r of run) {
      await t.until(r.at);
      /* Asked, and frames are filmed until the page has answered (its promises may wait on its own clock). */
      let answered = false;
      const asked = cam.evaluate(r.js).then(() => { answered = true; });
      for (let i = 0; i < 120 && !answered; i++) await t.step();
      await asked;
      for (let i = 0; i < 3; i++) await t.step();
      t.mark(r.mark);
    }
    if (hand && !flag('nohand', null)) await hand(t, seq, cam);
    await t.until(seconds - 0.05);
    for (const c of casts) {
      const now = await cam.evaluate(playsOf(seq, c.name));
      const want = before[c.name] + casts.filter((x) => x.name === c.name).length;
      if (now !== want) fail(`${id}: post ${seq} shows ${now} plays of ${c.name}, not ${want}`);
    }
    if (check) await check(cam, seq);
    await t.end(seconds);
  } finally { await cam.close(); }
}

/** Where the words of the post's body are: the box the pointer works on. */
const bodyBox = (seq) => `document.querySelector('#post-${seq} .kb-act-main')`;

const fxRainbow = () => effect('g-fx-rainbow', {
  post: 'kind1',
  casts: [{ at: 0.15, by: 'Aisle Seat', card: 'feelin-fab', name: "Feelin' Fab", mark: 'rainbow' }, { at: 0.95, by: 'Nosebleeds', card: 'feelin-fab', name: "Feelin' Fab", mark: 'stack' }],
  async hand(t, seq) { await t.go(centerOf(bodyBox(seq), 0.6, 0.5), 0.5, { seed: 91 }); },
});
const fxChair = () => effect('g-fx-chair', {
  skin: flag('chair-skin', 'fan-site'),
  post: 'kind2',
  css: { width: 960, height: 540 }, top: 120, seconds: 2.4,
  /* The real play path (`cast`) writes the play but not the live flag the page animates a throw on, so the chair is played as the stage's seed does (shot-closeups.mjs, `throwChair`): live, by Serious Deer. */
  /* The throw's direction is the reader's own (crypto.getRandomValues): a seeded stand-in makes the take repeatable. */
  prep: `(() => { let a = ${Number(flag('seed', 1))} * 2654435761 >>> 0; const g = (arr) => { for (let i = 0; i < arr.length; i++) { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); arr[i] = (t ^ (t >>> 14)) >>> 0; } return arr; }; crypto.getRandomValues = g; return 1; })()`,
  casts: [],
  run: [{ at: 0.05, mark: 'chair', js: `(() => { const { fake, cast, thread, posts } = window.__kbStage; return fake.acts(thread, posts.kind2, posts.kind2).then(([a]) => { fake.clock.advance(60000); return fake.seed.card(cast['Serious Deer'], a.id, 'steel-chair', { layer: 1, message: '', live: true, ends: new Date(Date.now() + 3 * 86400000).toISOString() }); }); })()` }],
  async hand(t, seq, cam) {
    /* The hit is read back from the page (the dent is drawn), the pointer goes to the chair's post as it comes to rest. */
    for (let i = 0; i < 120 && !(await cam.evaluate(`document.querySelectorAll('#post-${seq} .dw-chair-dent').length`)); i++) await t.step();
    t.mark('hit');
    await t.go(centerOf(bodyBox(seq), 0.35, 0.6), 0.7, { seed: 92 });
  },
  async check(cam, seq) {
    const layers = await cam.evaluate(`document.querySelectorAll('#post-${seq} .dw-chair-layer').length`), plays = await cam.evaluate(playsOf(seq, 'Steel Chair'));
    console.log(`g-fx-chair: ${layers} chair layer(s), ${plays} Steel Chair play(s) on post ${seq}`);
    const pieces = await cam.evaluate(`document.querySelectorAll('#post-${seq} .dw-chair-piece').length`);
    if (layers < 1 || plays !== 1 || pieces < 1) fail('g-fx-chair: no chair drawn on the post');
  },
});
const fxInk = () => effect('g-fx-ink', {
  post: 'kind3',
  casts: [{ at: 0.2, by: 'Hotel Bro', card: 'whoops', config: { color: '#ff2bd6', seed: 101 }, message: 'classy', name: 'Whoops!', mark: 'splat' }],
  async hand(t, seq) { await t.go(centerOf(bodyBox(seq), 0.5, 0.5), 0.6, { seed: 93 }); },
});
const fxTape = () => effect('g-fx-tape', {
  post: 'kind4', css: { width: 360, height: 203 }, top: 40,
  casts: [{ at: 0.2, by: 'Front Row', card: 'autocorrect', config: { phrase: 'hard to make', replacement: 'easy to fake' }, name: 'Autocorrect', mark: 'tape' }],
  async hand(t, seq) { await t.go(centerOf(`document.querySelector('#post-${seq} .kb-act-main')`, 0.55, 0.12), 0.6, { seed: 94 }); },
});
const fxSmoke = () => effect('g-fx-smoke', {
  post: 'chad',
  casts: [{ at: 0.2, by: 'Hotel Bro', card: 'hot-box', config: { color: '#32cd32' }, name: 'Hot Box', mark: 'smoke' }],
  async hand(t, seq) { await t.go(centerOf(bodyBox(seq), 0.15, 0.5), 0.5, { seed: 95 }); },
});
/** Glitter Bomb lands on a character, not a post (the rules say so), so it is played as the reach it is: Front Row's, live, on Chadluminum, whose posts then sparkle. */
const GLITTER_ON_CHAD = `(() => { const { fake, cast, acts } = window.__kbStage; fake.clock.advance(60000); const post = acts.chad.id ?? acts.chad; return fake.seed.reach(cast['Front Row'], 'character', cast['Chadluminum'], 'glitter-bomb', { post, ends: Date.now() + 5 * 86400000, message: 'You earned this.', live: true }); })()`;
const fxGlitter = () => effect('g-fx-glitter', {
  post: 'chad',
  casts: [],
  run: [{ at: 0.2, js: GLITTER_ON_CHAD, mark: 'glitter' }],
  async hand(t, seq) { await t.go(centerOf(bodyBox(seq), 0.5, 0.5), 0.6, { seed: 96 }); },
  async check(cam, seq) { console.log('g-fx-glitter: sparkle elements', await cam.evaluate(`document.querySelectorAll('#post-${seq} [class*="glitter"], #post-${seq} [data-kb-glitter]').length`)); },
});

const TAKES = { 'g-classes': classes, 'g-aura': aura, 'g-vending': vending, 'g-pack': pack, 'g-hand': hand, 'g-play': play, 'g-fx-rainbow': fxRainbow, 'g-fx-chair': fxChair, 'g-fx-ink': fxInk, 'g-fx-tape': fxTape, 'g-fx-smoke': fxSmoke, 'g-fx-glitter': fxGlitter };
for (const [name, run] of Object.entries(TAKES)) {
  if (only && only !== name) continue;
  await run();
}
