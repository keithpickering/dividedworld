/**
 * The Staff, second build (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R7): every mechanism the Staff run, filmed close, in the cast's
 * names. Each take is two to three and a half seconds at the DESKTOP layout (the camera's 1440 x 810 CSS px at 2x density, written at 2880 x 1620), so the glass is laid out as a desktop draws it and a
 * paused frame reads at once (the edit crops in: each take's json says how). The glass takes are level, and a REAL pointer does every
 * press (a button that is not where the pointer lands is a take that throws); takes 8 to 11 play under the full orchestra, when the camera has lost control,
 * so the board is turned a few degrees in space and no pointer aims.
 *
 *   node tools/hype/shot-staff-2.mjs [--only s-visit|s-quiz|s-hallpass|s-filing-qc|s-filing-ontopic|s-report|s-appeal|s-made|s-moved|s-merged|
 *                                     s-memo|s-stars|s-farewell|s-seat|s-warn-full] [--port 4323]
 *
 *   s-visit            QC-1000's visit opens on a post: its mark and countdown, the pointer opens the Lens and "How it went", the opener on screen
 *   s-quiz             a visit with the quiz, filmed from the seat of the post's author: the pointer presses a wrong choice; the game's answer
 *   s-hallpass         the author's Hall Pass, set face down when the visit began, turns over as the visit is trapped and ends
 *   s-filing-qc        QC-1000 files a reply that says "respectfully, no.": the mark turns to Filed, the author's warn bar rises, the filing's words
 *   s-filing-ontopic   ONTOPIC 5.0 files a post: the same shape
 *   s-report           a player reports a post: the Report button, a reason typed with real keys, "Report · 0.25 Aura"
 *   s-appeal           the filed player appeals: the Filed mark, the Appeal tile, a plea typed with real keys, "Appeal · 0.50 Aura"
 *   s-made, s-moved, s-merged   the Boss's board moves as the announcements show them, each with his reason
 *   s-memo             FanGaME's memo (a memo of his to a Mod) posted in the thread
 *   s-stars            ONTOPIC 5.0's one-star review of the thread titled "a"
 *   s-farewell         FanGaME's last post as Boss
 *   s-seat             QC-1000 takes the seat (after `handover()`)
 *   s-warn-full        a character's warn bar full in the postbit, from five real filings
 *
 * Every word the Staff say is a line of instances/divided-world/ui/hype/staff-lines.json (the rehearsal's own, recast to the cast's names), and each take
 * asserts that its line's exact `text` is on the page; the one exception is the quiz, the game's fixture quiz. A take that cannot show what it claims
 * throws. Nothing waits on the wall clock: every wait is a count of frames of the page's virtual clock, or a condition.
 *
 * Writes .runs/hype/<take>.mp4 and <take>.json ({ landed: [{ what, frame }] }).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { openFilm } from './camera.mjs';
import { glide } from './pointer.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

const LINES = JSON.parse(readFileSync('instances/divided-world/ui/hype/staff-lines.json', 'utf8'));
const SIZE = { width: 2880, height: 1620 };
const CSS = { width: 1440, height: 810 };
const FPS = 60;
const only = flag('only', null);
const PORT = Number(flag('port', 4323));
const easeInOut = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** In the page: how a take names an element to aim at (a CSS selector, or `{ sel, text, within }` for the button of a text), and its place in the window. */
const cam = (h) => h.cam;
const FIND_JS = `(() => {
  window.__aim = {
    el(spec) {
      if (typeof spec === 'string') return document.querySelector(spec);
      const root = spec.within ? document.querySelector(spec.within) : document;
      if (!root) return null;
      return [...root.querySelectorAll(spec.sel ?? 'button')].find((b) => b.textContent.trim().replace(/\\s+/g, ' ').startsWith(spec.text)) ?? null;
    },
    at(spec) {
      const e = this.el(spec);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    },
    /** Whether the words \`snippet\` are in view in the Lens's body (not scrolled out of it, nor under its foot); null where nothing holds them. */
    shown(snippet) {
      const body = document.querySelector('.kb-lens-body');
      const low = (x) => (x.innerText ?? '').replace(/\\s+/g, ' ').toLowerCase();
      const e = [...document.querySelectorAll('.kb-lens *')].filter((x) => low(x).includes(snippet.toLowerCase()) && ![...x.children].some((c) => low(c).includes(snippet.toLowerCase()))).pop();
      if (!e || !body) return null;
      const r = e.getBoundingClientRect(), b = body.getBoundingClientRect();
      return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    },
    /** Whether a named element is in view in the Lens's body. */
    inBody(spec) {
      const e = this.el(spec), body = document.querySelector('.kb-lens-body');
      if (!e || !body) return null;
      const r = e.getBoundingClientRect(), b = body.getBoundingClientRect();
      return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    },
    /** Whether a post of the page holds the line (its runs of space made one; the first sixty characters, which is what a post's words start with). */
    has(line) { const want = line.replace(/\\s+/g, ' ').trim().slice(0, 60); return [...document.querySelectorAll('article.kb-act')].some((a) => a.innerText.replace(/\\s+/g, ' ').includes(want)); },
    /** The page's text with its runs of space made one, to compare a line to. */
    text() { return document.body.innerText.replace(/\\s+/g, ' '); },
    /** Where an element stands on the page by layout (offsets), unmoved by a turn. */
    top(sel) { let e = document.querySelector(sel), y = 0; for (; e; e = e.offsetParent) y += e.offsetTop; return y; },
  };
})()`;
const squash = (s) => s.replace(/\s+/gu, ' ').trim();

/**
 * One take: the stage opened on its own port, `setup` run in the page before any frame is filmed, then `play(h)` with the hand `h`. The camera is level
 * unless the take turns it. Throws, and films nothing worth keeping, if the page does not show what the take claims.
 *
 * @param {string} name
 * `move` is the crop the edit frames the take with (moves.mjs's `{ from, to, ease }`, rectangles as shares of the frame): the glass takes are filmed whole at the desktop layout and magnified there.
 * @param {{ as?: string | null, quiet?: string[], setup?: (cam: any) => Promise<void>, play: (h: any) => Promise<void>, handsOff?: boolean, move?: object | null }} take
 */
async function film(name, { as = null, quiet = ['toasts', 'host', 'hud'], setup = async () => {}, play, handsOff = false, move = null }) {
  const cam = await openStage({ as, css: CSS, scale: 2, quiet, port: PORT });
  try {
    await cam.evaluate(FIND_JS);
    await setup(cam);
    await settle(cam, 40);
    await cam.drawPointer();
    const out = openFilm({ path: `${OUT}/${name}.mp4`, fps: cam.fps, out: SIZE });
    await cam.freeze();
    await cam.move(handsOff ? CSS.width + 60 : CSS.width * 0.72, handsOff ? CSS.height * 0.5 : CSS.height * 0.55);
    await cam.evaluate('window.__shot.zero()');
    /** @type {{ what: string, frame: number }[]} */
    const landed = [];
    let n = 0;
    let hand = { x: CSS.width * 0.72, y: CSS.height * 0.55 };
    const h = {
      cam, landed,
      get f() { return n; },
      /** One frame, with `each(i)` run before it. */
      async frames(count, each) { for (let i = 0; i < count; i++, n++) { if (each) await each(i, count); await out.write(await cam.frame(true)); } },
      land(what) { landed.push({ what, frame: n }); },
      /** The page now: an expression's value. */
      ev: (js) => cam.evaluate(js),
      /** Where a named element is in the window; throws when it is not there or is under the foot of the window. */
      async at(spec) {
        const p = await cam.evaluate(`window.__aim.at(${JSON.stringify(spec)})`);
        if (!p) throw new Error(`${name}: nothing to aim at: ${JSON.stringify(spec)}`);
        if (p.y < 0 || p.y > CSS.height || p.x < 0 || p.x > CSS.width) throw new Error(`${name}: ${JSON.stringify(spec)} is off the window at ${Math.round(p.x)},${Math.round(p.y)}`);
        return p;
      },
      /** The pointer travels to a named element in `seconds`, as a hand does. */
      async go(spec, seconds, { seed = 1, dx = 0, dy = 0 } = {}) {
        const to = await h.at(spec);
        const g = glide(hand, { x: to.x + dx, y: to.y + dy }, seconds, { seed });
        const count = Math.max(1, Math.round(seconds * FPS));
        await h.frames(count, async (i) => { await cam.move(...Object.values(hand = g.at((i + 1) / FPS))); });
        hand = g.at(seconds);
      },
      /** A press and release of the pointer where it is: the page gets a real click. */
      async click() {
        await cam.press();
        await h.frames(3);
        await cam.release();
      },
      /** Frames until `expression` is true on the page, or throws after `max` frames. */
      async until(expression, label, max = 150) {
        for (let i = 0; i < max; i++) {
          if (await cam.evaluate(`Boolean(${expression})`)) return i;
          await h.frames(1);
        }
        throw new Error(`${name}: the page never showed ${label}`);
      },
      /** The wheel turns over the Lens's body, a notch every other frame, until the words `snippet` are in view in it (a person scrolls to read what opened below). */
      async reveal(snippet, label) {
        for (let i = 0; i < 40; i++) {
          const seen = await cam.evaluate(`window.__aim.shown(${JSON.stringify(snippet)})`);
          if (seen === true) return;
          if (seen === null) { await h.frames(1); continue; }
          await cam.wheel(46);
          await h.frames(2);
        }
        throw new Error(`${name}: the words of ${label} never came into view in the Lens`);
      },
      /** The wheel turns over the Lens's body until a named element (a button below the fold) is in view in it. */
      async bring(spec) {
        for (let i = 0; i < 40; i++) {
          const seen = await cam.evaluate(`window.__aim.inBody(${JSON.stringify(spec)})`);
          if (seen === true) return;
          if (seen === null) throw new Error(`${name}: nothing in the Lens to bring into view: ${JSON.stringify(spec)}`);
          await cam.wheel(46);
          await h.frames(2);
        }
        throw new Error(`${name}: ${JSON.stringify(spec)} never came into view in the Lens`);
      },
      /** A text typed key by key, `every` frames apart. */
      async type(text, every = 4) {
        for (const ch of text) { cam.key(ch); await h.frames(every); }
      },
      /** The page's text holds `line`'s exact words (their spacing squashed, as a page's is), or the take throws. */
      async said(line, label) {
        const on = squash(await cam.evaluate('window.__aim.text()'));
        if (!on.includes(squash(line))) throw new Error(`${name}: the page does not show ${label}: ${line.slice(0, 90)}`);
      },
      /** Scrolls the page so a named element's top is `top` px down the window: at once, before a take, or eased over `count` frames. */
      async scroll(sel, top = 10, count = 0) {
        const goal = () => cam.evaluate(`window.__aim.top(${JSON.stringify(sel)}) - ${top}`);
        const to = await goal(), from = await cam.evaluate('scrollY');
        const set = (y) => cam.evaluate(`document.scrollingElement.scrollTop = ${Math.max(0, y)}`);
        if (count === 0) { await set(to); return; }
        await h.frames(count, (i) => set(from + (to - from) * easeInOut((i + 1) / count)));
      },
    };
    await play(h);
    await h.frames(Math.max(12, 126 - n)); // the page is still for the last 0.2 s, and a take is two seconds at least
    await out.end();
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ landed, move }, null, 2));
    console.log(`${name}: ${n} frames, ${(n / FPS).toFixed(2)} s; landed`, landed.map((l) => `${l.what}@${l.frame}`).join(' '), '; errors:', cam.errors);
  } finally {
    await cam.close();
  }
}

/** Whether the Lens (the float box a mark opens) is open. */
const LENS = `document.querySelector('.kb-lens')`;
/** The warn bar on a post's postbit, as the text "Warnings: 2/10" (null where there is no bar yet). */
const WARN = (sel) => `(document.querySelector('${sel} .kb-postbit-warn')?.innerText ?? '').replace(/\\s+/g, ' ').match(/(\\d+)\\s*\\/\\s*(\\d+)/)?.[0] ?? null`;
const warnPoints = (s) => (s === null ? 0 : Number(/^(\d+)/u.exec(s)[1]));

/**
 * The Mod's verdict on a report or an appeal is the fake's own invented line (\`seed.judging\`: "Dismissed. Do not waste the staff's time.", "...has heard it:
 * upheld."), and the rehearsal's logs hold no such words, so no Staff line on screen may be one: the page's confirmation (the element that holds it) is asserted
 * to be there and is drawn invisible, so the layout stays as the game's.
 */
const HIDE_VERDICT = `(() => { const sheet = new CSSStyleSheet(); sheet.insertRule('.kb-visit-result { visibility: hidden !important; }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; })()`;

/* ---- the takes ---- */

/** 1. A visit opens on a post: the mark and countdown, then the Lens opens and "How it went" shows the opener. */
async function visit() {
  const LINE = LINES.openerQcHelp.text;
  await film('s-visit', {
    move: { from: { x: 0.2, y: 0, w: 0.8, roll: 0 }, to: { x: 0.34, y: 0, w: 0.66, roll: 0 }, ease: 'out' },
    setup: async (cam) => {
      const v = await cam.evaluate(`window.__shot.staff.visit('qc', null, {}).then((r) => { window.__shot.show('thread:' + r.key); return r; })`);
      if (v.line !== LINE) throw new Error(`the visit's opener is ${v.line}`);
      await settle(cam, 20);
      await cam.evaluate(`document.querySelector('#post-${v.seq}').scrollIntoView()`);
      await settle(cam, 10);
    },
    async play(h) {
      h.land('mark');
      await h.frames(14);
      await h.go('.kb-visit-mark', 0.55, { seed: 3 });
      await h.click();
      await h.until(LENS, 'the Lens');
      h.land('lens');
      await h.go({ sel: '.kb-lens button', text: 'How it went' }, 0.45, { seed: 4 });
      await h.click();
      await h.until(`window.__aim.text().includes(${JSON.stringify(LINE)})`, 'the opener');
      await h.reveal(LINE, 'the opener');
      h.land('line');
      await h.frames(18);
      await h.said(LINE, "QC-1000's opener");
    },
  });
}

/** 2. The quiz, from the seat of the post's author: a wrong choice, and the game's answer to it. */
async function quiz() {
  await film('s-quiz', {
    move: { from: { x: 0.3, y: 0.05, w: 0.7, roll: 0 }, to: { x: 0.38, y: 0.15, w: 0.62, roll: 0 }, ease: 'out' },
    setup: async (cam) => {
      const v = await cam.evaluate(`window.__shot.staff.visit('qc', null, { quiz: true }).then((r) => { window.__shot.show('thread:' + r.key); return r; })`);
      await settle(cam, 20);
      await cam.evaluate(`document.querySelector('#post-${v.seq}').scrollIntoView()`);
      await settle(cam, 10);
      await cam.evaluate(`document.querySelector('.kb-visit-mark').click()`);
      await settle(cam, 30);
      /* The Lens's body is scrolled to the question, as a reader's would be, so it and all three choices are in view. */
      await cam.evaluate(`(() => { const body = document.querySelector('.kb-lens-body'), q = [...body.querySelectorAll('*')].find((e) => e.children.length < 3 && /asks/.test(e.textContent) && e.textContent.length < 120); body.scrollTop += q.getBoundingClientRect().top - body.getBoundingClientRect().top - 6; })()`);
      await settle(cam, 6);
    },
    async play(h) {
      await h.until(LENS, 'the Lens');
      for (const c of ['Form 1-A', 'Form 0', 'Form 27-B/6']) if (await h.ev(`window.__aim.shown(${JSON.stringify(c)})`) !== true) throw new Error(`s-quiz: the choice ${c} is not in view in the Lens`);
      h.land('choices');
      await h.said('Which form is used to request another form?', 'the quiz question');
      await h.frames(10);
      await h.go({ sel: '.kb-lens .kb-visit-choice', text: 'Form 1-A' }, 0.6, { seed: 5 });
      await h.click();
      h.land('press');
      await h.until(`window.__aim.text().includes('That was not the answer')`, "the game's answer");
      await h.reveal('That was not the answer', "the game's answer");
      h.land('wrong');
      await h.frames(24);
      await h.said('That was not the answer. QC-1000 will visit Snuckles\'s next post within 24 hours.', "the game's answer");
    },
  });
}

/** 3. The Hall Pass: set face down as the visit begins, then it springs and the visit ends. */
async function hallpass() {
  const NOTICE = 'A trap set on this post sprang when the visit began, and the visit ended';
  let held;
  await film('s-hallpass', {
    move: { from: { x: 0.25, y: 0, w: 0.75, roll: 0 }, to: { x: 0.34, y: 0, w: 0.66, roll: 0 }, ease: 'inOut' },
    setup: async (cam) => {
      held = await cam.evaluate(`window.__shot.staff.hallPass(null, { hold: true }).then((r) => { window.__shot.show('thread:' + r.key); return r; })`);
      await settle(cam, 20);
      await cam.evaluate(`document.querySelector('#post-${held.seq}').scrollIntoView()`);
      await settle(cam, 10);
      const back = await cam.evaluate(`document.querySelector('#post-${held.seq} [data-kb-back]')?.getAttribute('data-kb-back') ?? null`);
      if (back === null || back === 'sprung') throw new Error(`the Hall Pass back is not face down before the spring: ${back}`);
    },
    async play(h) {
      h.land('begin');
      /* The countdown is seen to tick: the page's time runs a minute on, twice, with the take's frames between, so the mark reads 3:00, 2:59, 2:58 before the pass springs. */
      const mark = () => h.ev(`document.querySelector('.kb-visit-mark .kb-visit-time')?.textContent ?? null`);
      const seen = [await mark()];
      await h.frames(10);
      for (let i = 0; i < 2; i++) { await cam(h).skip(60_000); await h.frames(20); seen.push(await mark()); }
      if (new Set(seen).size !== 3) throw new Error(`s-hallpass: the countdown did not tick: ${seen.join(', ')}`);
      await h.ev(`window.__shot.staff.springPass(${JSON.stringify(held.set)}, ${JSON.stringify(held.visit)})`);
      h.land('spring');
      await h.until(`document.querySelector('#post-${held.seq} [data-kb-back="sprung"]') && document.querySelector('.kb-visit-mark')?.getAttribute('data-kb-visit') === 'trapped'`, 'the spring');
      await h.frames(8);
      await h.go('.kb-visit-mark', 0.4, { seed: 6 });
      await h.click();
      await h.until(`${LENS} && window.__aim.text().includes(${JSON.stringify(NOTICE)})`, 'the trapped notice');
      h.land('ended');
      await h.frames(14);
      await h.said(NOTICE, 'the trapped notice');
    },
  });
}

/** 4 and 5. A Mod files a post: the mark turns to Filed, the author's warn bar rises, the filing's words open in the Lens. */
async function filing(name, mod, key) {
  const LINE = LINES[key].text;
  let held, seq;
  await film(name, {
    move: { from: { x: 0, y: 0.05, w: 0.65, roll: 0 }, to: { x: 0.35, y: 0, w: 0.65, roll: 0 }, ease: 'inOut' },
    setup: async (cam) => {
      /* The author has a mark against them already, so the bar is seen to rise and not to appear. */
      await cam.evaluate(`window.__shot.staff.filing('qc', null, 'filingQcGames', { by: ${JSON.stringify(LINES[key].post.by)} })`);
      held = await cam.evaluate(`window.__shot.staff.filing(${JSON.stringify(mod)}, null, ${JSON.stringify(key)}, { hold: true }).then((r) => { window.__shot.show('thread:' + r.key); return r; })`);
      seq = held.seq;
      await settle(cam, 20);
      await cam.evaluate(`document.querySelector('#post-${seq}').scrollIntoView()`);
      await settle(cam, 10);
    },
    async play(h) {
      const bar = `${WARN(`#post-${seq}`)}`;
      const before = await h.ev(bar);
      await h.frames(34);
      await h.ev(`window.__shot.staff.endFiling(${JSON.stringify(key)}, ${JSON.stringify(held.visit)})`);
      h.land('filed');
      await h.until(`document.querySelector('.kb-visit-mark')?.getAttribute('data-kb-visit') === 'filed'`, 'the Filed mark');
      const after = await h.ev(bar);
      if (warnPoints(after) <= warnPoints(before)) throw new Error(`${name}: the warn bar did not rise: ${before} -> ${after}`);
      h.land('bar');
      await h.frames(26);
      await h.go('.kb-visit-mark', 0.5, { seed: 7 });
      await h.click();
      await h.until(LENS, 'the Lens');
      await h.go({ sel: '.kb-lens button', text: 'How it went' }, 0.4, { seed: 8 });
      await h.click();
      await h.until(`window.__aim.text().includes(${JSON.stringify(squash(LINE))})`, "the filing's words");
      await h.reveal(LINE.slice(0, 50), "the filing's words");
      await h.frames(16);
      await h.said(LINE, "the filing's words");
      console.log(`${name}: the warn bar went ${before} -> ${after}`);
    },
  });
}

/** 6. A player reports a post: the real Report button, a reason typed with real keys, the send. */
async function report() {
  await film('s-report', {
    move: { from: { x: 0.15, y: 0.15, w: 0.85, roll: 0 }, to: { x: 0.4, y: 0.1, w: 0.6, roll: 0 }, ease: 'out' },
    as: 'Chadluminum',
    setup: async (cam) => {
      await cam.evaluate(`window.__shot.staff.report('Chadluminum', 5)`);
      await cam.evaluate(HIDE_VERDICT);
      await cam.evaluate(`document.querySelector('#post-5').scrollIntoView()`);
      await settle(cam, 10);
    },
    async play(h) {
      h.land('open');
      await h.frames(8);
      await h.go({ within: '#post-5', text: 'Report' }, 0.5, { seed: 9 });
      await h.click();
      await h.until(`${LENS} && document.querySelector('.kb-lens textarea')`, 'the report form');
      await h.go('.kb-lens textarea', 0.35, { seed: 10 });
      await h.click();
      await h.type('off topic', 3);
      h.land('typed');
      const reason = await h.ev(`document.querySelector('.kb-lens textarea').value`);
      if (reason !== 'off topic') throw new Error(`s-report: the reason typed is "${reason}"`);
      await h.bring({ within: '.kb-lens', sel: 'button.kb-visit-appeal', text: 'Report' });
      await h.go({ within: '.kb-lens', sel: 'button.kb-visit-appeal', text: 'Report' }, 0.4, { seed: 11 });
      await h.click();
      await h.until(`document.querySelector('.kb-lens .kb-visit-result')?.textContent.includes('Your report was heard')`, 'the report sent (the page\'s confirmation)');
      h.land('sent');
      await h.reveal('reports left today', 'the count of reports left');
      await h.frames(30);
    },
  });
}

/** 7. The filed player appeals: the Filed mark, the Appeal tile, a plea typed with real keys, the send. */
async function appeal() {
  await film('s-appeal', {
    quiet: ['toasts', 'host'],
    move: { from: { x: 0.3, y: 0.05, w: 0.7, roll: 0 }, to: { x: 0.3, y: 0.3, w: 0.7, roll: 0 }, ease: 'inOut' },
    setup: async (cam) => {
      await cam.evaluate(HIDE_VERDICT);
      const a = await cam.evaluate(`window.__shot.staff.appeal('Snuckles').then((r) => { window.__shot.show('thread:' + r.key); return r; })`);
      await settle(cam, 20);
      await cam.evaluate(`document.querySelector('#post-${a.seq}').scrollIntoView()`);
      await settle(cam, 10);
    },
    async play(h) {
      /* The HUD is in frame, so the price is seen to leave the orbs: its Aura reading is read here and again once the appeal is sent. */
      const aura = async () => Number(await h.ev(`(document.querySelector('.kb-hud-glass')?.innerText ?? '').replace(/\\s+/g, ' ').match(/(\\d+\\.\\d\\d) \\/ \\d/)?.[1] ?? 'NaN'`));
      const before = await aura();
      if (Number.isNaN(before)) throw new Error('s-appeal: the HUD shows no Aura reading');
      h.land('open');
      await h.frames(6);
      await h.go('.kb-visit-mark', 0.4, { seed: 12 });
      await h.click();
      await h.until(`${LENS} && document.querySelector('.kb-lens .kb-visit-appeal')`, 'the Appeal tile');
      await h.go('.kb-lens .kb-visit-appeal', 0.4, { seed: 13 });
      await h.click();
      await h.until(`document.querySelector('.kb-lens textarea')`, 'the appeal form');
      await h.go('.kb-lens textarea', 0.3, { seed: 14 });
      await h.click();
      await h.type('it was a joke', 2);
      h.land('typed');
      const plea = await h.ev(`document.querySelector('.kb-lens textarea').value`);
      if (plea !== 'it was a joke') throw new Error(`s-appeal: the plea typed is "${plea}"`);
      await h.bring({ within: '.kb-lens', sel: 'button.kb-visit-appeal', text: 'Appeal' });
      await h.go({ within: '.kb-lens', sel: 'button.kb-visit-appeal', text: 'Appeal' }, 0.35, { seed: 15 });
      await h.click();
      await h.until(`document.querySelector('.kb-lens .kb-visit-result')?.textContent.includes('heard it')`, 'the appeal filed (the page\'s confirmation)');
      h.land('sent');
      let after = before;
      for (let i = 0; i < 60 && Math.abs(before - after - 0.5) > 0.005; i++) { await h.frames(1); after = await aura(); }
      if (Math.abs(before - after - 0.5) > 0.005) throw new Error(`s-appeal: the Aura went ${before} -> ${after}, not down by 0.50`);
      h.land('price');
      await h.frames(30);
      console.log(`s-appeal: the Aura went ${before} -> ${after}`);
    },
  });
}

/**
 * 8 to 14. A board page with a notice or a staff post, which is not glass: it keeps its framing (the page as the board draws it, a few degrees off level and
 * drifting, as the camera loses control under the full orchestra) and gives a second of looking a reason: the notice or post ARRIVES in frame. The page is
 * scrolled before the take so that the last post of the thread has just left the top of the window; `live` then runs in the page, a moment into the take (the
 * Staff post as the camera watches), and the new post comes in under where the last one ended. A post long enough or low enough not to be in view where it
 * lands is then scrolled to, eased. The board is turned by `turn` every frame (at most 6 degrees about any axis, never near its back). Nothing is aimed.
 */
async function turned(name, { setup, live, line, label, drift = 1 }) {
  await film(name, {
    handsOff: true,
    setup: async (cam) => {
      await setup(cam);
      await settle(cam, 20);
      /* At the thread's foot with the last post just out of the top of the window: a post that comes in is in frame as it lands, and is not held behind the "new post" pill. */
      await cam.evaluate(`(() => { const last = [...document.querySelectorAll('article.kb-act')].at(-1); document.scrollingElement.scrollTop += last.getBoundingClientRect().bottom - 36; })()`);
      await settle(cam, 6);
      if (await cam.evaluate(`window.__aim.has(${JSON.stringify(line)})`)) throw new Error(`${name}: the line is on the page before it is posted: ${label}`);
    },
    async play(h) {
      const COUNT = 168; // 2.8 s of drift; the post arrives a quarter second in
      const turn = (i) => {
        const t = i / FPS;
        return `window.__shot.turn({ rx: ${(2.4 * drift * Math.sin(t * 1.3 + 0.4)).toFixed(3)}, ry: ${(-6 * drift * Math.sin(t * 0.9 + 1.1)).toFixed(3)}, rz: ${(1.6 * drift * Math.sin(t * 0.7)).toFixed(3)}, scale: 1.04 })`;
      };
      let arrived = -1, from = 0, place = 0;
      await h.frames(COUNT, async (i) => {
        if (i === 14) await h.ev(live);
        if (arrived < 0 && i > 14 && await h.ev(`window.__aim.has(${JSON.stringify(line)})`)) {
          arrived = i;
          h.land('notice');
          place = await h.ev(WHERE(line));
          from = await h.ev('scrollY');
        }
        if (arrived >= 0 && Math.abs(place - from) > 24) await h.ev(`document.scrollingElement.scrollTop = ${from + (place - from) * easeInOut((i - arrived) / 40)}`);
        await h.ev(turn(i));
      });
      if (arrived < 0) throw new Error(`${name}: the post never arrived: ${label}`);
      await h.said(line, label);
    },
  });
}

/** Where a staff line's words stand on the page, with some of the post above it. */
const WHERE = (line) => `(() => {
  const want = ${JSON.stringify(squash(line).slice(0, 60))};
  const e = [...document.querySelectorAll('article.kb-act')].find((a) => a.innerText.replace(/\\s+/g, ' ').includes(want));
  if (!e) throw new Error('the post with the line is not on the page: ' + want);
  return window.__aim.top('#' + e.id) - 46;
})()`;

/** The Staff Announcements thread, named to the stage (the Boss's beats name it only when they first post in it) and shown. */
const ANNOUNCEMENTS = `window.__kbStage.fake.boardPage('announcements', 1, []).then((p) => { window.__kbStage.threads.announcements = p.threads[0].id; window.__shot.show('thread:announcements'); })`;

/* The Boss's board notices: the seeded ones before them are on the page already (above the window), and this one is posted as the camera watches. */
const made = () => turned('s-made', {
  setup: (cam) => cam.evaluate(ANNOUNCEMENTS),
  live: `window.__shot.staff.created()`,
  line: LINES.created.text, label: "the Boss's reason for the board",
});
const moved = () => turned('s-moved', {
  setup: (cam) => cam.evaluate(ANNOUNCEMENTS),
  live: `window.__shot.staff.moved()`,
  line: LINES.moved.text, label: "the Boss's reason for the move",
});
const merged = () => turned('s-merged', {
  setup: (cam) => cam.evaluate(ANNOUNCEMENTS),
  live: `window.__shot.staff.merge()`,
  line: LINES.merged.text, label: "the Boss's reason for the merge",
});
const memo = () => turned('s-memo', {
  /* The memo is the twenty-second post of the main thread, which is on its second page: the page's own "Continue to page 2" link is followed. */
  setup: async (cam) => {
    await cam.evaluate(`window.__shot.show('thread')`);
    await settle(cam, 20);
    await cam.evaluate(`[...document.querySelectorAll('a')].find((a) => /Continue to page 2/i.test(a.textContent)).click()`);
    await cam.until(`Boolean(document.querySelector('#post-21'))`, { label: 'the second page of the thread' });
  },
  live: `window.__shot.staff.memo('main', 'orderNoAllowance')`,
  line: LINES.orderNoAllowance.text, label: "FanGaME's memo",
});
const stars = () => turned('s-stars', {
  /* The thread titled "a" and its four replies are there; ONTOPIC 5.0's review is posted under them as the camera watches. */
  setup: (cam) => cam.evaluate(`window.__shot.staff.review('stars', { hold: true }).then((r) => { window.__stars = r.key; window.__shot.show('thread:' + r.key); })`),
  live: `window.__shot.staff.say('ontopic', window.__stars, 'stars')`,
  line: LINES.stars.text, label: "ONTOPIC 5.0's review", drift: 0.8,
});
const farewell = () => turned('s-farewell', {
  /* FanGaME's last post as Boss, posted in the announcements as the camera watches (the stage's `goodbye` thread has it seeded already, which would not arrive). */
  setup: (cam) => cam.evaluate(ANNOUNCEMENTS),
  live: `window.__shot.staff.say('fangame', 'announcements', 'posted')`,
  line: LINES.posted.text, label: "FanGaME's last post",
});
const seat = () => turned('s-seat', {
  setup: (cam) => cam.evaluate(ANNOUNCEMENTS),
  live: `window.__shot.staff.handover()`,
  line: LINES.arrival.text, label: "QC-1000 taking the seat",
});

/** 12. A warn bar at its full 10: five real filings of one author, the last arriving while the camera watches the postbit. */
async function warnFull() {
  const KEYS = ['filingQcHelp', 'filingQcGames', 'filingQcGotcha', 'filingOtThematic', 'filingOtPatience'];
  const last = KEYS.at(-1);
  let held, seq;
  await film('s-warn-full', {
    move: { from: { x: 0, y: 0, w: 0.9, roll: 0 }, to: { x: 0, y: 0.05, w: 0.66, roll: 0 }, ease: 'out' },
    setup: async (cam) => {
      for (const k of KEYS.slice(0, -1)) await cam.evaluate(`window.__shot.staff.filing(${JSON.stringify(LINES[k].by === 'ontopic' ? 'ontopic' : 'qc')}, null, ${JSON.stringify(k)}, { by: 'D-Guy' })`);
      held = await cam.evaluate(`window.__shot.staff.filing('ontopic', null, ${JSON.stringify(last)}, { by: 'D-Guy', hold: true }).then((r) => { window.__shot.show('thread:' + r.key); return r; })`);
      seq = held.seq;
      await settle(cam, 20);
      await cam.evaluate(`document.querySelector('#post-${seq}').scrollIntoView()`);
      await settle(cam, 10);
    },
    async play(h) {
      const bar = WARN(`#post-${seq}`);
      const before = await h.ev(bar);
      await h.frames(30);
      await h.ev(`window.__shot.staff.endFiling(${JSON.stringify(last)}, ${JSON.stringify(held.visit)})`);
      h.land('filed');
      await h.until(`document.querySelector('.kb-visit-mark')?.getAttribute('data-kb-visit') === 'filed'`, 'the Filed mark');
      const after = await h.ev(bar);
      if (warnPoints(after) <= warnPoints(before)) throw new Error(`s-warn-full: the bar did not rise: ${before} -> ${after}`);
      if (!/^10\/10/u.test(after)) throw new Error(`s-warn-full: the bar is ${after}, not full`);
      h.land('bar');
      await h.frames(60);
      console.log(`s-warn-full: the warn bar went ${before} -> ${after}`);
    },
  });
}

const TAKES = {
  's-visit': visit,
  's-quiz': quiz,
  's-hallpass': hallpass,
  's-filing-qc': () => filing('s-filing-qc', 'qc', 'filingQcHelp'),
  's-filing-ontopic': () => filing('s-filing-ontopic', 'ontopic', 'filingOtThematic'),
  's-report': report,
  's-appeal': appeal,
  's-made': made,
  's-moved': moved,
  's-merged': merged,
  's-memo': memo,
  's-stars': stars,
  's-farewell': farewell,
  's-seat': seat,
  's-warn-full': warnFull,
};
if (only !== null && !TAKES[only]) throw new Error(`there is no take "${only}": the takes are ${Object.keys(TAKES).join(', ')}`);
for (const [name, take] of Object.entries(TAKES)) if (only === null || only === name) await take();
